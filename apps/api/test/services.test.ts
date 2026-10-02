import { describe, expect, it } from "vitest";
import type {
  ArtistCandidate,
  CatalogIssuePayload,
  CatalogSnapshot,
  CatalogTrack,
  ShareSnapshot,
} from "@music-rank/contracts";
import {
  createCatalogService,
  createShareService,
  InMemoryShareRepository,
} from "../src/services.js";
import type { CatalogProvider } from "../src/catalog/provider.js";
import { createPostgresShareRepository } from "../src/shares/postgres-repository.js";

const artist: ArtistCandidate = {
  id: "artist-1",
  name: "Example Artist",
  sourceName: "Example Artist",
  sourceArtistId: "fixture-1",
};

const tracks: CatalogTrack[] = [
  {
    id: "track-studio",
    title: "First Song",
    creditedArtists: ["Example Artist"],
    versionKind: "studio",
    sources: ["fixture"],
    outboundLinks: [],
  },
  {
    id: "track-live",
    title: "First Song (Live)",
    creditedArtists: ["Example Artist"],
    versionKind: "live",
    sources: ["fixture"],
    outboundLinks: [],
  },
];

const snapshot: ShareSnapshot = {
  artistName: "Example Artist",
  tracks: tracks.map((track, index) => ({
    title: track.title,
    creditedArtists: track.creditedArtists,
    versionKind: track.versionKind,
    rank: index + 1,
    outboundLinks: track.outboundLinks,
  })),
  status: "complete",
  createdAt: "2026-10-02T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z",
};

function providerStub(): CatalogProvider {
  return {
    searchArtists: async () => [artist],
    getArtist: async (id) => (id === artist.id ? artist : null),
    getArtistCatalog: async () => tracks,
  };
}

describe("catalog service", () => {
  it("searches artists and returns a versioned catalog snapshot", async () => {
    const service = createCatalogService(providerStub(), {
      now: () => new Date("2026-10-02T00:00:00.000Z"),
    });

    const artists = await service.searchArtists("Example");
    const catalog: CatalogSnapshot = await service.getArtistCatalog("artist-1");

    expect(artists).toEqual([artist]);
    expect(catalog.artist).toEqual(artist);
    expect(catalog.version).toBeTruthy();
    expect(catalog.fetchedAt).toBe("2026-10-02T00:00:00.000Z");
    expect(catalog.tracks).toHaveLength(2);
  });

  it("filters catalog tracks by version kind without mutating provider data", async () => {
    const service = createCatalogService(providerStub());

    const catalog = await service.getArtistCatalog("artist-1", { versionKind: "studio" });

    expect(catalog.tracks.map((track) => track.id)).toEqual(["track-studio"]);
    expect(tracks).toHaveLength(2);
  });

  it("rejects blank artist search queries", async () => {
    const service = createCatalogService(providerStub());

    await expect(service.searchArtists("   ")).rejects.toMatchObject({ code: "INVALID_QUERY" });
  });

  it("accepts catalog issue reports into a pending review queue", async () => {
    const reports: CatalogIssuePayload[] = [];
    const service = createCatalogService(providerStub(), {
      onIssue: (issue) => {
        reports.push(issue);
      },
    });

    await service.reportIssue({ artistId: "artist-1", trackId: "track-studio", kind: "duplicate" });

    expect(reports).toEqual([{ artistId: "artist-1", trackId: "track-studio", kind: "duplicate" }]);
  });
});

describe("share service", () => {
  it("retains catalog source provenance in the public snapshot", async () => {
    const service = createShareService(new InMemoryShareRepository(), {
      now: () => new Date("2026-10-02T00:00:00.000Z"),
      token: () => "opaque-test-token",
    });
    const withSources: ShareSnapshot = { ...snapshot, catalogSources: ["授权曲库 A", "授权曲库 B"] };

    const created = await service.create(withSources);
    const readable = await service.read(created.shareId);

    expect(readable?.snapshot.catalogSources).toEqual(["授权曲库 A", "授权曲库 B"]);
  });

  it("creates a 90-day anonymous share and permits read then revoke", async () => {
    const repository = new InMemoryShareRepository();
    const service = createShareService(repository, {
      now: () => new Date("2026-10-02T00:00:00.000Z"),
      token: () => "opaque-test-token",
    });

    const created = await service.create(snapshot);
    const readable = await service.read(created.shareId);

    expect(created.expiresAt).toBe("2026-12-31T00:00:00.000Z");
    expect(created.revokeToken).toBe("opaque-test-token");
    expect(readable?.snapshot).toEqual({
      ...snapshot,
      createdAt: "2026-10-02T00:00:00.000Z",
      expiresAt: "2026-12-31T00:00:00.000Z",
    });

    await service.revoke(created.shareId, created.revokeToken);

    await expect(service.read(created.shareId)).resolves.toBeNull();
  });

  it("treats expired and revoked shares as unavailable", async () => {
    const repository = new InMemoryShareRepository();
    let now = new Date("2026-10-02T00:00:00.000Z");
    const service = createShareService(repository, {
      now: () => now,
      token: () => "opaque-test-token",
    });
    const created = await service.create(snapshot);

    now = new Date(created.expiresAt);

    await expect(service.read(created.shareId)).resolves.toBeNull();
  });

  it("removes expired snapshots from the repository during cleanup", async () => {
    const repository = new InMemoryShareRepository();
    let now = new Date("2026-10-02T00:00:00.000Z");
    const service = createShareService(repository, { now: () => now });
    const created = await service.create(snapshot);
    now = new Date(created.expiresAt);

    await expect(service.cleanupExpired()).resolves.toBe(1);
    await expect(repository.get(created.shareId)).resolves.toBeNull();
  });

  it("rejects a revoke attempt with the wrong token", async () => {
    const service = createShareService(new InMemoryShareRepository(), {
      token: () => "correct-token",
    });
    const created = await service.create(snapshot);

    await expect(service.revoke(created.shareId, "wrong-token")).rejects.toMatchObject({
      code: "INVALID_REVOKE_TOKEN",
    });
  });

  it("rejects malformed ranks and non-HTTPS outbound links", async () => {
    const service = createShareService(new InMemoryShareRepository());
    const invalid = {
      ...snapshot,
      tracks: [
        {
          ...snapshot.tracks[0]!,
          outboundLinks: [{ provider: "fixture", url: "javascript:alert(1)", label: "Open" }],
        },
      ],
    } satisfies ShareSnapshot;

    await expect(service.create(invalid)).rejects.toMatchObject({ code: "INVALID_SHARE_SNAPSHOT" });
  });
});

describe("PostgreSQL share repository", () => {
  it("persists snapshots as JSONB and reconstructs repository records", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = createPostgresShareRepository({
      query: async (sql, values) => {
        calls.push({ sql, ...(values === undefined ? {} : { values }) });
        if (sql.includes("INSERT")) return { rows: [] };
        return {
          rows: [
            {
              id: "share-1",
              snapshot,
              revoke_token_hash: "a".repeat(64),
              revoked_at: null,
            },
          ],
        };
      },
    });

    await repository.insert({
      id: "share-1",
      snapshot,
      revokeTokenHash: "a".repeat(64),
      revokedAt: null,
    });
    const result = await repository.get("share-1");

    expect(calls[0]?.sql).toContain("INSERT INTO shares");
    expect(calls[0]?.sql).toContain("$2::jsonb");
    expect(result).toEqual({
      id: "share-1",
      snapshot,
      revokeTokenHash: "a".repeat(64),
      revokedAt: null,
    });
  });
});
