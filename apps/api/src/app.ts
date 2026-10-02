import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { CatalogIssuePayload, ShareSnapshot } from "@music-rank/contracts";
import { ApiError } from "./errors.js";
import { QqMusicCatalogProvider } from "./catalog/qqmusic-provider.js";
import {
  InMemoryCatalogIssueRepository,
  type CatalogIssueRepository,
} from "./catalog/issue-repository.js";
import type { CatalogProvider } from "./catalog/provider.js";
import { createCatalogService, createShareService } from "./services.js";
import type { ShareRepository } from "./shares/repository.js";

export interface ApiOptions {
  catalogProvider?: CatalogProvider;
  issueRepository?: CatalogIssueRepository;
  shareRepository?: ShareRepository;
  logger?: boolean;
  anonymousWriteLimit?: { max: number; windowMs: number; maxIpBuckets?: number };
  readinessCheck?: () => boolean | Promise<boolean>;
  trustProxy?: FastifyServerOptions["trustProxy"];
}

export function createApp(options: ApiOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 256 * 1024,
    trustProxy: options.trustProxy ?? false,
  });
  const issueRepository = options.issueRepository ?? new InMemoryCatalogIssueRepository();
  const catalog = createCatalogService(options.catalogProvider ?? new QqMusicCatalogProvider(), {
    onIssue: (issue) => issueRepository.insert({ ...issue, createdAt: new Date().toISOString(), status: "pending" }),
  });
  const shares = createShareService(options.shareRepository);
  const writeLimit = {
    max: options.anonymousWriteLimit?.max ?? Number(process.env.API_ANONYMOUS_WRITE_LIMIT ?? 30),
    windowMs: options.anonymousWriteLimit?.windowMs ?? Number(process.env.API_ANONYMOUS_WRITE_WINDOW_MS ?? 60_000),
    maxIpBuckets: options.anonymousWriteLimit?.maxIpBuckets ?? Number(process.env.API_ANONYMOUS_WRITE_MAX_IP_BUCKETS ?? 10_000),
  };
  if (
    !Number.isInteger(writeLimit.max) || writeLimit.max < 1 ||
    !Number.isFinite(writeLimit.windowMs) || writeLimit.windowMs < 1 ||
    !Number.isInteger(writeLimit.maxIpBuckets) || writeLimit.maxIpBuckets < 1
  ) {
    throw new Error("Anonymous write rate-limit settings must be positive numbers.");
  }
  const overflowBucket = Symbol("anonymous-write-overflow");
  const writeBuckets = new Map<string | symbol, { count: number; resetAt: number }>();
  const cleanupTimer = setInterval(() => {
    void shares.cleanupExpired().catch((error: unknown) => app.log.error(error, "share cleanup failed"));
  }, 60 * 60 * 1000);
  cleanupTimer.unref();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));
  const bucketCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of writeBuckets) {
      if (bucket.resetAt <= now) writeBuckets.delete(key);
    }
  }, Math.min(writeLimit.windowMs, 60_000));
  bucketCleanupTimer.unref();
  app.addHook("onClose", async () => clearInterval(bucketCleanupTimer));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    const fastifyError = error as Error & { statusCode?: number; code?: string };
    if (fastifyError.statusCode !== undefined && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
      const malformedJson = fastifyError.code === "FST_ERR_CTP_INVALID_JSON_BODY";
      return reply.code(fastifyError.statusCode).send({
        error: {
          code: malformedJson ? "INVALID_JSON" : "INVALID_REQUEST",
          message: malformedJson ? "Request body contains invalid JSON." : "Request is invalid.",
        },
      });
    }
    app.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Request could not be completed." } });
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      const ready = await (options.readinessCheck?.() ?? true);
      if (!ready) return reply.code(503).send({ status: "not_ready" });
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST" || !["/api/v1/shares", "/api/v1/catalog-issues"].includes(request.routeOptions.url ?? "")) {
      return;
    }
    const now = Date.now();
    const clientKey = request.ip;
    const hasClientBucket = writeBuckets.has(clientKey);
    const bucketKey = hasClientBucket || writeBuckets.size < writeLimit.maxIpBuckets
      ? clientKey
      : overflowBucket;
    const existing = writeBuckets.get(bucketKey);
    const bucket = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + writeLimit.windowMs }
      : existing;
    if (bucket.count >= writeLimit.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      reply.header("retry-after", String(retryAfter));
      throw new ApiError(429, "RATE_LIMITED", "Too many anonymous write requests. Try again later.");
    }
    bucket.count += 1;
    writeBuckets.set(bucketKey, bucket);
  });

  app.get<{ Querystring: { query?: string } }>("/api/v1/artists", async (request) => ({
    artists: await catalog.searchArtists(request.query.query ?? ""),
  }));

  app.get<{ Params: { artistId: string }; Querystring: { versionKind?: string } }>(
    "/api/v1/artists/:artistId/catalog",
    async (request) => {
      const versionKind = request.query.versionKind;
      const allowedKinds = ["studio", "live", "instrumental", "remix", "cover", "other"] as const;
      if (
        versionKind !== undefined &&
        !allowedKinds.includes(versionKind as (typeof allowedKinds)[number])
      ) {
        throw new ApiError(400, "INVALID_VERSION_KIND", "Version kind is not supported.");
      }
      return catalog.getArtistCatalog(request.params.artistId, {
        ...(versionKind === undefined
          ? {}
          : { versionKind: versionKind as (typeof allowedKinds)[number] }),
      });
    },
  );

  app.post<{ Body: CatalogIssuePayload }>("/api/v1/catalog-issues", async (request, reply) => {
    await catalog.reportIssue(request.body);
    return reply.code(202).send({ accepted: true });
  });

  app.post<{ Body: ShareSnapshot }>("/api/v1/shares", async (request, reply) => {
    const created = await shares.create(request.body);
    return reply.code(201).header("cache-control", "no-store").send(created);
  });

  app.get<{ Params: { shareId: string } }>("/api/v1/shares/:shareId", async (request, reply) => {
    const result = await shares.read(request.params.shareId);
    if (!result) throw new ApiError(404, "SHARE_NOT_FOUND", "Share was not found.");
    return reply
      .header("cache-control", "no-store")
      .header("x-robots-tag", "noindex, nofollow, noarchive")
      .send(result);
  });

  app.delete<{ Params: { shareId: string }; Headers: { authorization?: string } }>(
    "/api/v1/shares/:shareId",
    async (request, reply) => {
      const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? "");
      if (!match?.[1]) throw new ApiError(401, "REVOKE_TOKEN_REQUIRED", "A revoke token is required.");
      await shares.revoke(request.params.shareId, match[1]);
      return reply.code(204).send();
    },
  );

  return app;
}
