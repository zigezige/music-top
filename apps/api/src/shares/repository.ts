import type { ShareSnapshot } from "@music-rank/contracts";

export interface ShareRecord {
  id: string;
  snapshot: ShareSnapshot;
  revokeTokenHash: string;
  revokedAt: string | null;
}

export interface ShareRepository {
  insert(record: ShareRecord): Promise<void>;
  get(id: string): Promise<ShareRecord | null>;
  revoke(id: string, revokedAt: string): Promise<void>;
  deleteExpired(now: string): Promise<number>;
}

export class InMemoryShareRepository implements ShareRepository {
  private readonly records = new Map<string, ShareRecord>();

  async insert(record: ShareRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }

  async get(id: string): Promise<ShareRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async revoke(id: string, revokedAt: string): Promise<void> {
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, revokedAt });
  }

  async deleteExpired(now: string): Promise<number> {
    let deleted = 0;
    for (const [id, record] of this.records) {
      if (new Date(record.snapshot.expiresAt).getTime() <= new Date(now).getTime()) {
        this.records.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}
