import type { CatalogIssuePayload } from "@music-rank/contracts";
import type { PgQueryable } from "../shares/postgres-repository.js";

export interface CatalogIssueRecord extends CatalogIssuePayload {
  createdAt: string;
  status: "pending";
}

export interface CatalogIssueRepository {
  insert(issue: CatalogIssueRecord): Promise<void>;
}

export class InMemoryCatalogIssueRepository implements CatalogIssueRepository {
  readonly records: CatalogIssueRecord[] = [];

  async insert(issue: CatalogIssueRecord): Promise<void> {
    this.records.push(structuredClone(issue));
  }
}

export function createPostgresCatalogIssueRepository(db: PgQueryable): CatalogIssueRepository {
  return {
    async insert(issue) {
      await db.query(
        `INSERT INTO catalog_issues (artist_id, track_id, kind, details, created_at, status)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6)`,
        [issue.artistId, issue.trackId ?? null, issue.kind, issue.details ?? null, issue.createdAt, issue.status],
      );
    },
  };
}
