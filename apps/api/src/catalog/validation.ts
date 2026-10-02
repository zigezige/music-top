import type { ArtistCandidate, CatalogTrack, TrackVersionKind } from "@music-rank/contracts";
import { ApiError } from "../errors.js";

const versionKinds: TrackVersionKind[] = ["studio", "live", "instrumental", "remix", "cover", "other"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failProviderResponse(): never {
  throw new ApiError(502, "INVALID_PROVIDER_RESPONSE", "The catalog provider returned invalid data.");
}

function validateOutboundLinks(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 20) return false;
  return value.every((link) => {
    if (
      !isRecord(link) ||
      typeof link.provider !== "string" ||
      !link.provider.trim() ||
      link.provider.length > 100 ||
      typeof link.label !== "string" ||
      !link.label.trim() ||
      link.label.length > 200 ||
      typeof link.url !== "string" ||
      link.url.length > 2048
    ) return false;
    try {
      const parsed = new URL(link.url);
      return parsed.protocol === "https:" && Boolean(parsed.hostname);
    } catch {
      return false;
    }
  });
}

function isArtistCandidate(value: unknown): value is ArtistCandidate {
  return (
    isRecord(value) &&
    typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 200 &&
    typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 200 &&
    typeof value.sourceName === "string" && value.sourceName.trim().length > 0 && value.sourceName.length <= 200 &&
    typeof value.sourceArtistId === "string" && value.sourceArtistId.trim().length > 0 && value.sourceArtistId.length <= 200 &&
    (value.disambiguation === undefined ||
      (typeof value.disambiguation === "string" && value.disambiguation.length <= 500))
  );
}

function isCatalogTrack(value: unknown): value is CatalogTrack {
  return (
    isRecord(value) &&
    typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 200 &&
    typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 300 &&
    Array.isArray(value.creditedArtists) && value.creditedArtists.length <= 30 &&
    value.creditedArtists.every((artist) => typeof artist === "string" && artist.trim().length > 0 && artist.length <= 200) &&
    (value.albumTitle === undefined ||
      (typeof value.albumTitle === "string" && value.albumTitle.length <= 300)) &&
    (value.albumCoverUrl === undefined ||
      (typeof value.albumCoverUrl === "string" && value.albumCoverUrl.length <= 2048 && isHttpsUrl(value.albumCoverUrl))) &&
    (value.releaseDate === undefined ||
      (typeof value.releaseDate === "string" && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value.releaseDate))) &&
    typeof value.versionKind === "string" && versionKinds.includes(value.versionKind as TrackVersionKind) &&
    Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 20 &&
    value.sources.every((source) => typeof source === "string" && source.trim().length > 0 && source.length <= 100) &&
    validateOutboundLinks(value.outboundLinks)
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function validateArtistCandidates(value: unknown): ArtistCandidate[] {
  if (!Array.isArray(value) || value.length > 500 || !value.every(isArtistCandidate)) {
    failProviderResponse();
  }
  return value;
}

export function validateCatalogTracks(value: unknown): CatalogTrack[] {
  if (!Array.isArray(value) || value.length > 10_000 || !value.every(isCatalogTrack)) {
    failProviderResponse();
  }
  return value;
}

export function validateArtistCandidate(value: unknown): ArtistCandidate {
  if (!isArtistCandidate(value)) failProviderResponse();
  return value;
}
