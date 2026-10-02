import { createApp } from "./app.js";
import { Pool } from "pg";
import { migrateShareSchema } from "./db/migrate.js";
import { createPostgresCatalogIssueRepository } from "./catalog/issue-repository.js";
import { createPostgresShareRepository } from "./shares/postgres-repository.js";
import { QqMusicCatalogProvider } from "./catalog/qqmusic-provider.js";
import { startEmbeddedQqMusicApi } from "./catalog/qqmusic-runtime.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL;
const configuredProxyTrust = process.env.API_TRUST_PROXY?.trim();
const externalQqMusicApiUrl = process.env.QQ_MUSIC_API_URL?.trim() || undefined;

function parseProxyTrust(value: string | undefined) {
  if (!value) return false;
  if (/^\d+$/.test(value)) {
    const trustedHops = Number(value);
    if (trustedHops < 1) return false;
    return (_address: string, hop: number) => hop < trustedHops;
  }
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

if (process.env.NODE_ENV === "production" && !databaseUrl) {
  throw new Error("DATABASE_URL is required in production; in-memory shares cannot be used in production.");
}

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
if (pool) await migrateShareSchema(pool);

const embeddedQqMusicApi = externalQqMusicApiUrl
  ? undefined
  : await startEmbeddedQqMusicApi(Number(process.env.QQ_MUSIC_API_PORT ?? 3200));
const qqMusicApiUrl = externalQqMusicApiUrl ?? embeddedQqMusicApi!.baseUrl;

const app = createApp({
  catalogProvider: new QqMusicCatalogProvider(fetch, qqMusicApiUrl),
  ...(pool ? { issueRepository: createPostgresCatalogIssueRepository(pool) } : {}),
  ...(pool ? { shareRepository: createPostgresShareRepository(pool) } : {}),
  ...(pool ? { readinessCheck: async () => {
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  } } : {}),
  trustProxy: parseProxyTrust(configuredProxyTrust),
});
if (pool) app.addHook("onClose", async () => pool.end());
if (embeddedQqMusicApi) app.addHook("onClose", async () => embeddedQqMusicApi.close());

if (!pool) app.log.warn("DATABASE_URL is unset; share records use in-memory storage and are lost when the API stops.");
app.log.info({ baseUrl: qqMusicApiUrl }, embeddedQqMusicApi
  ? "using bundled QQ Music API service"
  : "using configured QQ Music API service");

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
