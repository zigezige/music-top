import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import type { PgQueryable } from "../shares/postgres-repository.js";

export async function migrateShareSchema(db: PgQueryable): Promise<void> {
  const sql = await readFile(new URL("../../migrations/001_shares.sql", import.meta.url), "utf8");
  await db.query(sql);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to run migrations.");
  const pool = new Pool({ connectionString });
  try {
    await migrateShareSchema(pool);
    console.info("Share schema migration completed.");
  } finally {
    await pool.end();
  }
}
