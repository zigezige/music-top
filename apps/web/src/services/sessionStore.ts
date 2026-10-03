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

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type PersistenceMode = 'indexeddb' | 'localStorage';

const localStoragePrefix = 'music-rank-h5:';
let persistenceMode: PersistenceMode = 'indexeddb';

function getLocalStorage(): LocalStorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function localStorageKey(name: string): string {
  return `${localStoragePrefix}${name}`;
}

function readLocal<T>(storage: LocalStorageLike, key: string): T | undefined {
  const value = storage.getItem(localStorageKey(key));
  if (!value) return undefined;
  return JSON.parse(value) as T;
}

function writeLocal<T>(storage: LocalStorageLike, key: string, value: T): void {
  storage.setItem(localStorageKey(key), JSON.stringify(value));
}

function removeLocal(storage: LocalStorageLike, key: string): void {
  storage.removeItem(localStorageKey(key));
}

export async function withStorageFallback<T>(
  primary: () => Promise<T>,
  fallback: (storage: LocalStorageLike) => T | Promise<T>,
): Promise<T> {
  const storage = getLocalStorage();
  if (persistenceMode === 'localStorage' && storage) {
    try {
      return await fallback(storage);
    } catch {
      persistenceMode = 'indexeddb';
    }
  }

  try {
    const value = await primary();
    persistenceMode = 'indexeddb';
    return value;
  } catch (primaryError) {
    if (!storage) throw primaryError;
    try {
      const value = await fallback(storage);
      persistenceMode = 'localStorage';
      return value;
    } catch {
      throw primaryError;
    }
  }
}

export async function saveSession(session: Omit<SavedSession, 'id' | 'schemaVersion' | 'updatedAt'>): Promise<void> {
  const saved = {
    ...session,
    id: 'active' as const,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  await withStorageFallback(
    async () => { await database.sessions.put(saved); },
    (storage) => writeLocal(storage, 'session', saved),
  );
}

export async function loadSession(): Promise<SavedSession | undefined> {
  return withStorageFallback(
    () => database.sessions.get('active'),
    (storage) => readLocal<SavedSession>(storage, 'session'),
  );
}

export async function clearSession(): Promise<void> {
  await withStorageFallback(
    async () => { await database.sessions.delete('active'); },
    (storage) => removeLocal(storage, 'session'),
  );
}

export async function saveCatalogDraft(catalog: CatalogSnapshot): Promise<void> {
  const draft = { id: 'active' as const, catalog, updatedAt: new Date().toISOString() };
  await withStorageFallback(
    async () => { await database.catalogDrafts.put(draft); },
    (storage) => writeLocal(storage, 'catalog', draft),
  );
}

export async function loadCatalogDraft(): Promise<CatalogDraft | undefined> {
  return withStorageFallback(
    () => database.catalogDrafts.get('active'),
    (storage) => readLocal<CatalogDraft>(storage, 'catalog'),
  );
}

export async function clearCatalogDraft(): Promise<void> {
  await withStorageFallback(
    async () => { await database.catalogDrafts.delete('active'); },
    (storage) => removeLocal(storage, 'catalog'),
  );
}

export async function saveShare(share: SavedShare): Promise<void> {
  await withStorageFallback(
    async () => { await database.shares.put(share); },
    (storage) => writeLocal(storage, `share:${share.rankingIdentity}`, share),
  );
}

export async function loadShare(rankingIdentity: string): Promise<SavedShare | undefined> {
  return withStorageFallback(
    () => database.shares.get(rankingIdentity),
    (storage) => readLocal<SavedShare>(storage, `share:${rankingIdentity}`),
  );
}

export async function clearShare(rankingIdentity: string): Promise<void> {
  await withStorageFallback(
    async () => { await database.shares.delete(rankingIdentity); },
    (storage) => removeLocal(storage, `share:${rankingIdentity}`),
  );
}
