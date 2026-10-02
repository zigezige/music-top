import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtistCandidate, CatalogTrack } from "@music-rank/contracts";
import { createApp, type ApiOptions } from "../src/app.js";
import type { CatalogProvider } from "../src/catalog/provider.js";
import type { CatalogIssueRecord } from "../src/catalog/issue-repository.js";

const artist: ArtistCandidate = {
  id: "artist-http-1",
  name: "HTTP Artist",
  sourceName: "HTTP Artist",
  sourceArtistId: "http-source-1",
};

const track: CatalogTrack = {
  id: "http-track-1",
  title: "HTTP Song",
  creditedArtists: ["HTTP Artist"],
  versionKind: "studio",
  sources: ["qqmusic"],
  outboundLinks: [],
};

const provider: CatalogProvider = {
  searchArtists: async (query) => (query ? [artist] : []),
  getArtist: async (id) => (id === artist.id ? artist : null),
  getArtistCatalog: async () => [track],
};

const apps: Array<ReturnType<typeof createApp>> = [];
function app(overrides: Partial<ApiOptions> = {}) {
  const instance = createApp({ catalogProvider: provider, logger: false, ...overrides });
  apps.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("HTTP API", () => {
  it("uses the QQ Music catalog provider when no provider is injected", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      requests.push(String(input));
      return new Response(JSON.stringify({
        response: {
          code: 0,
          data: { singer: { itemlist: [{ mid: "qq-artist-1", name: "QQ Artist" }] } },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const instance = createApp({ logger: false });
    apps.push(instance);

    const response = await instance.inject({ method: "GET", url: "/api/v1/artists?query=QQ" });

    expect(response.statusCode).toBe(200);
    expect(response.json().artists).toEqual([
      expect.objectContaining({ id: expect.stringContaining("qqmusic:"), name: "QQ Artist" }),
    ]);
    expect(requests).toEqual(["http://localhost:3200/getSmartbox?key=QQ"]);
  });

  it("serves artist search and a versioned catalog snapshot", async () => {
    const response = await app().inject({ method: "GET", url: "/api/v1/artists?query=HTTP" });

    expect(response.statusCode).toBe(200);
    expect(response.json().artists).toEqual([artist]);

    const catalog = await app().inject({
      method: "GET",
      url: `/api/v1/artists/${artist.id}/catalog?versionKind=studio`,
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().tracks).toEqual([track]);
    expect(catalog.json().version).toBeTruthy();
  });

  it("accepts a catalog issue for review and rejects malformed issues", async () => {
    let savedIssue: CatalogIssueRecord | undefined;
    const instance = app({
      issueRepository: {
        insert: async (issue) => {
          savedIssue = issue;
        },
      },
    });
    const accepted = await instance.inject({
      method: "POST",
      url: "/api/v1/catalog-issues",
      payload: { artistId: artist.id, trackId: track.id, kind: "missing" },
    });
    const rejected = await instance.inject({
      method: "POST",
      url: "/api/v1/catalog-issues",
      payload: { artistId: "", kind: "invented" },
    });

    expect(accepted.statusCode).toBe(202);
    expect(rejected.statusCode).toBe(400);
    expect(savedIssue).toMatchObject({
      artistId: artist.id,
      trackId: track.id,
      kind: "missing",
      status: "pending",
    });
  });

  it("creates a share, returns it without indexing, and revokes it with its token", async () => {
    const instance = app();
    const created = await instance.inject({
      method: "POST",
      url: "/api/v1/shares",
      payload: {
        artistName: artist.name,
        tracks: [{ title: track.title, creditedArtists: track.creditedArtists, versionKind: track.versionKind, rank: 1, outboundLinks: [] }],
        status: "complete",
        createdAt: "ignored",
        expiresAt: "ignored",
      },
    });
    const createdBody = created.json();
    const readable = await instance.inject({ method: "GET", url: `/api/v1/shares/${createdBody.shareId}` });
    const revoked = await instance.inject({
      method: "DELETE",
      url: `/api/v1/shares/${createdBody.shareId}`,
      headers: { authorization: `Bearer ${createdBody.revokeToken}` },
    });
    const unavailable = await instance.inject({ method: "GET", url: `/api/v1/shares/${createdBody.shareId}` });

    expect(created.statusCode).toBe(201);
    expect(readable.statusCode).toBe(200);
    expect(readable.headers["x-robots-tag"]).toContain("noindex");
    expect(revoked.statusCode).toBe(204);
    expect(unavailable.statusCode).toBe(404);
  });

  it("throttles anonymous writes per client using configurable limits", async () => {
    const instance = app({ anonymousWriteLimit: { max: 1, windowMs: 60_000 } });
    const first = await instance.inject({
      method: "POST",
      url: "/api/v1/catalog-issues",
      remoteAddress: "192.0.2.44",
      payload: { artistId: artist.id, kind: "missing" },
    });
    const limited = await instance.inject({
      method: "POST",
      url: "/api/v1/shares",
      remoteAddress: "192.0.2.44",
      payload: {},
    });
    const otherClient = await instance.inject({
      method: "POST",
      url: "/api/v1/catalog-issues",
      remoteAddress: "192.0.2.45",
      payload: { artistId: artist.id, kind: "missing" },
    });

    expect(first.statusCode).toBe(202);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeTruthy();
    expect(otherClient.statusCode).toBe(202);
  });

  it("bounds retained rate-limit clients and shares overflow without evicting active buckets", async () => {
    const instance = app({
      anonymousWriteLimit: { max: 1, windowMs: 60_000, maxIpBuckets: 1 },
    });
    const postIssue = (remoteAddress: string) => instance.inject({
      method: "POST",
      url: "/api/v1/catalog-issues",
      remoteAddress,
      payload: { artistId: artist.id, kind: "missing" },
    });

    expect((await postIssue("192.0.2.10")).statusCode).toBe(202);
    expect((await postIssue("192.0.2.11")).statusCode).toBe(202);
    expect((await postIssue("192.0.2.12")).statusCode).toBe(429);
    expect((await postIssue("192.0.2.10")).statusCode).toBe(429);
  });

  it("reclaims expired bucket capacity on the periodic cleanup timer", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const instance = app({
      anonymousWriteLimit: { max: 1, windowMs: 1_000, maxIpBuckets: 1 },
    });
    const postIssue = (remoteAddress: string) => instance.inject({
      method: "POST",
      url: "/api/v1/catalog-issues",
      remoteAddress,
      payload: { artistId: artist.id, kind: "missing" },
    });

    expect((await postIssue("192.0.2.20")).statusCode).toBe(202);
    expect((await postIssue("192.0.2.21")).statusCode).toBe(202);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await postIssue("192.0.2.21")).statusCode).toBe(202);
    expect((await postIssue("192.0.2.22")).statusCode).toBe(202);
  });

  it("does not trust a client-supplied forwarded address by default", async () => {
    const instance = app({ anonymousWriteLimit: { max: 1, windowMs: 60_000 } });
    const postIssue = (forwardedFor: string) => instance.inject({
      method: "POST",
      url: "/api/v1/catalog-issues",
      remoteAddress: "198.51.100.20",
      headers: { "x-forwarded-for": forwardedFor },
      payload: { artistId: artist.id, kind: "missing" },
    });

    expect((await postIssue("203.0.113.1")).statusCode).toBe(202);
    expect((await postIssue("203.0.113.2")).statusCode).toBe(429);
  });

  it("uses forwarded client addresses only when a trusted proxy hop is configured", async () => {
    const instance = app({
      anonymousWriteLimit: { max: 1, windowMs: 60_000 },
      trustProxy: (address) => ["198.51.100.20", "198.51.100.21"].includes(address),
    });
    const postIssue = (remoteAddress: string) => instance.inject({
      method: "POST",
      url: "/api/v1/catalog-issues",
      remoteAddress,
      headers: { "x-forwarded-for": "203.0.113.50" },
      payload: { artistId: artist.id, kind: "missing" },
    });

    expect((await postIssue("198.51.100.20")).statusCode).toBe(202);
    expect((await postIssue("198.51.100.21")).statusCode).toBe(429);
  });

  it("maps malformed JSON bodies to a client error", async () => {
    const response = await app().inject({
      method: "POST",
      url: "/api/v1/catalog-issues",
      headers: { "content-type": "application/json" },
      payload: "{broken",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_JSON");
  });

  it("returns unavailable from readiness when the injected dependency check fails", async () => {
    const response = await app({ readinessCheck: async () => false }).inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe("not_ready");
  });

  it("rejects provider responses with unsafe outbound links", async () => {
    const unsafeProvider: CatalogProvider = {
      ...provider,
      getArtistCatalog: async () => [{ ...track, outboundLinks: [{ provider: "x", url: "javascript:alert(1)", label: "Open" }] }],
    };
    const response = await app({ catalogProvider: unsafeProvider }).inject({
      method: "GET",
      url: `/api/v1/artists/${artist.id}/catalog`,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("INVALID_PROVIDER_RESPONSE");
  });

  it("rejects malformed artist candidates returned by a provider", async () => {
    const invalidProvider: CatalogProvider = {
      ...provider,
      searchArtists: async () => [{ ...artist, id: "" }],
    };
    const response = await app({ catalogProvider: invalidProvider }).inject({
      method: "GET",
      url: "/api/v1/artists?query=HTTP",
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("INVALID_PROVIDER_RESPONSE");
  });
});
