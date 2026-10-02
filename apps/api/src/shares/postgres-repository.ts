import type { ShareSnapshot } from "@music-rank/contracts";
import type { ShareRecord, ShareRepository } from "./repository.js";

export interface PgQueryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export function createPostgresShareRepository(db: PgQueryable): ShareRepository {
  return {
    async insert(record) {
      await db.query(
        `INSERT INTO shares (id, snapshot, revoke_token_hash, created_at, expires_at, revoked_at)
         VALUES ($1, $2::jsonb, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz)`,
        [
          record.id,
          JSON.stringify(record.snapshot),
          record.revokeTokenHash,
          record.snapshot.createdAt,
          record.snapshot.expiresAt,
          record.revokedAt,
        ],
      );
    },

    async get(id) {
      const result = await db.query(
        `SELECT id, snapshot, revoke_token_hash, revoked_at
         FROM shares
         WHERE id = $1 AND expires_at > now()`,
        [id],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: String(row.id),
        snapshot: (typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot) as ShareSnapshot,
        revokeTokenHash: String(row.revoke_token_hash).trim(),
        revokedAt: row.revoked_at === null ? null : new Date(String(row.revoked_at)).toISOString(),
      } satisfies ShareRecord;
    },

    async revoke(id, revokedAt) {
      await db.query(
        `UPDATE shares SET revoked_at = $2::timestamptz
         WHERE id = $1 AND revoked_at IS NULL`,
        [id, revokedAt],
      );
    },

    async deleteExpired(now) {
      const result = await db.query("DELETE FROM shares WHERE expires_at <= $1::timestamptz RETURNING id", [now]);
      return result.rows.length;
    },
  };
}
