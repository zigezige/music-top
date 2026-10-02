import Dexie, { type EntityTable } from 'dexie';
import type { CatalogSnapshot } from '@music-rank/contracts';
import type { createRankingSession } from '@music-rank/ranking';

export type RankingSession = ReturnType<typeof createRankingSession>;

export interface SavedSession {
  id: 'active';
  sessionId: string;
  schemaVersion: number;
  artistId: string;
  catalog: CatalogSnapshot;
  includedTrackIds: string[];
  ranking: RankingSession;
  paused: boolean;
  updatedAt: string;
}

export interface CatalogDraft {
  id: 'active';
  catalog: CatalogSnapshot;
  updatedAt: string;
}

interface SavedShare {
  id: string;
  rankingIdentity: string;
  shareId: string;
  revokeToken: string;
  url: string;
  createdAt: string;
}

class MusicRankDatabase extends Dexie {
  sessions!: EntityTable<SavedSession, 'id'>;
  catalogDrafts!: EntityTable<CatalogDraft, 'id'>;
  shares!: EntityTable<SavedShare, 'id'>;

  constructor() {
    super('music-rank-h5');
    this.version(1).stores({ sessions: 'id, updatedAt', shares: 'id, createdAt' });
    this.version(2).stores({ sessions: 'id, updatedAt', catalogDrafts: 'id, updatedAt', shares: 'id, createdAt' });
  }
}

const database = new MusicRankDatabase();

export async function saveSession(session: Omit<SavedSession, 'id' | 'schemaVersion' | 'updatedAt'>): Promise<void> {
  await database.sessions.put({
    ...session,
    id: 'active',
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadSession(): Promise<SavedSession | undefined> {
  return database.sessions.get('active');
}

export async function clearSession(): Promise<void> {
  await database.sessions.delete('active');
}

export async function saveCatalogDraft(catalog: CatalogSnapshot): Promise<void> {
  await database.catalogDrafts.put({ id: 'active', catalog, updatedAt: new Date().toISOString() });
}

export async function loadCatalogDraft(): Promise<CatalogDraft | undefined> {
  return database.catalogDrafts.get('active');
}

export async function clearCatalogDraft(): Promise<void> {
  await database.catalogDrafts.delete('active');
}

export async function saveShare(share: SavedShare): Promise<void> {
  await database.shares.put(share);
}

export async function loadShare(rankingIdentity: string): Promise<SavedShare | undefined> {
  return database.shares.get(rankingIdentity);
}

export async function clearShare(rankingIdentity: string): Promise<void> {
  await database.shares.delete(rankingIdentity);
}
