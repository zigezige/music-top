import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ArtistCandidate,
  CatalogIssuePayload,
  CatalogSnapshot,
  CatalogTrack,
  ShareSnapshot,
} from "@music-rank/contracts";
import { ApiError } from "./errors.js";
import type { CatalogFilters, CatalogProvider } from "./catalog/provider.js";
import {
  validateArtistCandidate,
  validateArtistCandidates,
  validateCatalogTracks,
} from "./catalog/validation.js";
import { InMemoryShareRepository, type ShareRepository } from "./shares/repository.js";

const shareLifetimeMs = 90 * 24 * 60 * 60 * 1000;

export interface CatalogServiceOptions {
  now?: () => Date;
  onIssue?: (payload: CatalogIssuePayload) => void | Promise<void>;
}

export function createCatalogService(
  provider: CatalogProvider,
  options: CatalogServiceOptions = {},
) {
  const now = options.now ?? (() => new Date());

  return {
    async searchArtists(query: string): Promise<ArtistCandidate[]> {
      const normalized = query.trim();
      if (!normalized || normalized.length > 100) {
        throw new ApiError(400, "INVALID_QUERY", "Artist query must be between 1 and 100 characters.");
      }
      return validateArtistCandidates(await provider.searchArtists(normalized)).slice(0, 20);
    },

    async getArtistCatalog(artistId: string, filters: CatalogFilters = {}): Promise<CatalogSnapshot> {
      if (!artistId || artistId.length > 200) {
        throw new ApiError(400, "INVALID_ARTIST_ID", "A valid artist ID is required.");
      }
      const providerArtist = await provider.getArtist(artistId);
      const artist = providerArtist === null ? null : validateArtistCandidate(providerArtist);
      if (!artist) throw new ApiError(404, "ARTIST_NOT_FOUND", "Artist was not found.");
      const allTracks = validateCatalogTracks(await provider.getArtistCatalog(artistId));
      let tracks = allTracks;
      if (filters.versionKind) {
        tracks = tracks.filter((track) => track.versionKind === filters.versionKind);
      }
      const fetchedAt = now().toISOString();
      return {
        artist,
        version: createHash("sha256")
          .update(JSON.stringify([artist.id, allTracks.map((track) => track.id)]))
          .digest("hex")
          .slice(0, 16),
        fetchedAt,
        tracks,
      };
    },

    async reportIssue(payload: CatalogIssuePayload): Promise<void> {
      if (
        !payload ||
        typeof payload.artistId !== "string" ||
        payload.artistId.trim().length === 0 ||
        payload.artistId.length > 200 ||
        !["missing", "duplicate", "misattributed"].includes(payload.kind) ||
        (payload.trackId !== undefined &&
          (typeof payload.trackId !== "string" || payload.trackId.length > 200)) ||
        (payload.details !== undefined &&
          (typeof payload.details !== "string" || payload.details.length > 1000))
      ) {
        throw new ApiError(400, "INVALID_CATALOG_ISSUE", "Catalog issue payload is invalid.");
      }
      await options.onIssue?.({
        ...payload,
        artistId: payload.artistId.trim(),
        ...(payload.details === undefined ? {} : { details: payload.details.trim() }),
      });
    },
  };
}

export interface ShareServiceOptions {
  now?: () => Date;
  token?: () => string;
  shareId?: () => string;
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function validateShareSnapshot(value: ShareSnapshot): void {
  if (
    !value ||
    typeof value.artistName !== "string" ||
    value.artistName.trim().length === 0 ||
    value.artistName.length > 200 ||
    !Array.isArray(value.tracks) ||
    value.tracks.length === 0 ||
    value.tracks.length > 500 ||
    !["complete", "provisional"].includes(value.status)
  ) {
    throw new ApiError(400, "INVALID_SHARE_SNAPSHOT", "Share snapshot is invalid.");
  }
  if (
    value.catalogSources !== undefined &&
    (!Array.isArray(value.catalogSources) ||
      value.catalogSources.length > 10 ||
      value.catalogSources.some((source) => typeof source !== "string" || source.trim().length === 0 || source.length > 100))
  ) {
    throw new ApiError(400, "INVALID_SHARE_SNAPSHOT", "Share catalog sources are invalid.");
  }
  const ranks = new Set<number>();
  const versionKinds = ["studio", "live", "instrumental", "remix", "cover", "other"];
  for (const track of value.tracks) {
    if (
      !track ||
      typeof track.title !== "string" ||
      track.title.length === 0 ||
      track.title.length > 300 ||
      !Array.isArray(track.creditedArtists) ||
      track.creditedArtists.length > 20 ||
      track.creditedArtists.some((name) => typeof name !== "string" || name.length === 0 || name.length > 200) ||
      (track.albumTitle !== undefined &&
        (typeof track.albumTitle !== "string" || track.albumTitle.length > 300)) ||
      (track.albumCoverUrl !== undefined &&
        (typeof track.albumCoverUrl !== "string" || track.albumCoverUrl.length > 2048 || !isHttpsUrl(track.albumCoverUrl))) ||
      !versionKinds.includes(track.versionKind) ||
      !Number.isInteger(track.rank) ||
      track.rank < 1 ||
      ranks.has(track.rank) ||
      !Array.isArray(track.outboundLinks) ||
      track.outboundLinks.length > 10 ||
      track.outboundLinks.some((link) => {
        if (
          !link ||
          typeof link.provider !== "string" ||
          link.provider.length === 0 ||
          link.provider.length > 50 ||
          typeof link.url !== "string" ||
          link.url.length > 2048 ||
          typeof link.label !== "string" ||
          link.label.length === 0 ||
          link.label.length > 100
        ) return true;
        try {
          return new URL(link.url).protocol !== "https:";
        } catch {
          return true;
        }
      })
    ) {
      throw new ApiError(400, "INVALID_SHARE_SNAPSHOT", "Share snapshot contains an invalid track.");
    }
    ranks.add(track.rank);
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function createShareService(
  repository: ShareRepository = new InMemoryShareRepository(),
  options: ShareServiceOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const createToken = options.token ?? (() => randomBytes(32).toString("base64url"));
  const createId = options.shareId ?? (() => randomBytes(18).toString("base64url"));

  return {
    async create(input: ShareSnapshot): Promise<{ shareId: string; revokeToken: string; expiresAt: string }> {
      validateShareSnapshot(input);
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + shareLifetimeMs).toISOString();
      const revokeToken = createToken();
      const shareId = createId();
      const snapshot: ShareSnapshot = {
        artistName: input.artistName.trim(),
        ...(input.catalogSources === undefined ? {} : { catalogSources: [...new Set(input.catalogSources.map((source) => source.trim()))] }),
        tracks: input.tracks.map((track) => structuredClone(track)),
        status: input.status,
        createdAt: createdAt.toISOString(),
        expiresAt,
      };
      await repository.insert({
        id: shareId,
        snapshot,
        revokeTokenHash: digestToken(revokeToken).toString("hex"),
        revokedAt: null,
      });
      return { shareId, revokeToken, expiresAt };
    },

    async read(shareId: string): Promise<{ snapshot: ShareSnapshot } | null> {
      const record = await repository.get(shareId);
      if (!record || record.revokedAt || new Date(record.snapshot.expiresAt).getTime() <= now().getTime()) {
        return null;
      }
      return { snapshot: record.snapshot };
    },

    async revoke(shareId: string, revokeToken: string): Promise<void> {
      const record = await repository.get(shareId);
      if (!record) throw new ApiError(404, "SHARE_NOT_FOUND", "Share was not found.");
      const storedHash = Buffer.from(record.revokeTokenHash, "hex");
      const providedHash = digestToken(revokeToken);
      if (!timingSafeEqual(storedHash, providedHash)) {
        throw new ApiError(403, "INVALID_REVOKE_TOKEN", "Revoke token is invalid.");
      }
      if (!record.revokedAt) await repository.revoke(shareId, now().toISOString());
    },

    async cleanupExpired(): Promise<number> {
      return repository.deleteExpired(now().toISOString());
    },
  };
}

export { InMemoryShareRepository } from "./shares/repository.js";
