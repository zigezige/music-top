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

/**
 * Vue hands out reactive proxies for `catalog`/`ranking`, and IndexedDB cannot
 * structured-clone a proxy: the write fails with DataCloneError and silently degrades to
 * the localStorage mirror. Snapshot plain data before it reaches the primary store.
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Writes through the primary store and mirrors into localStorage when it fails. */
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

/**
 * Reads the primary store, then the localStorage mirror. A primary read that resolves
 * without a record must not hide a mirror-only record: otherwise anything written while
 * the primary store was failing disappears on the next page load, which silently empties
 * the restored route state.
 */
export async function readWithStorageFallback<T>(
  primary: () => Promise<T | undefined>,
  fallback: (storage: LocalStorageLike) => T | undefined,
): Promise<T | undefined> {
  const storage = getLocalStorage();
  const readMirror = (): { ok: boolean; value: T | undefined } => {
    if (!storage) return { ok: false, value: undefined };
    try {
      return { ok: true, value: fallback(storage) };
    } catch {
      return { ok: false, value: undefined };
    }
  };

  if (persistenceMode === 'localStorage') {
    const mirror = readMirror();
    if (mirror.ok) return mirror.value;
    persistenceMode = 'indexeddb';
  }

  try {
    const value = await primary();
    if (value !== undefined) {
      persistenceMode = 'indexeddb';
      return value;
    }
    const mirror = readMirror();
    if (mirror.value !== undefined) {
      persistenceMode = 'localStorage';
      return mirror.value;
    }
    persistenceMode = 'indexeddb';
    return undefined;
  } catch (primaryError) {
    const mirror = readMirror();
    if (!mirror.ok) throw primaryError;
    persistenceMode = 'localStorage';
    return mirror.value;
  }
}

/**
 * Deletes from both stores. A delete that only reached one store would let the record
 * come back on the next page load, when the other store is read again.
 */
async function clearWithStorageFallback(
  primary: () => Promise<void>,
  fallback: (storage: LocalStorageLike) => void,
): Promise<void> {
  await withStorageFallback(primary, (storage) => { fallback(storage); });
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    fallback(storage);
  } catch {
    // Best-effort cleanup of the mirror; the primary delete already succeeded.
  }
}

export async function saveSession(session: Omit<SavedSession, 'id' | 'schemaVersion' | 'updatedAt'>): Promise<void> {
  const saved = toPlain({
    ...session,
    id: 'active' as const,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  });
  await withStorageFallback(
    async () => { await database.sessions.put(saved); },
    (storage) => writeLocal(storage, 'session', saved),
  );
}

export async function loadSession(): Promise<SavedSession | undefined> {
  return readWithStorageFallback(
    () => database.sessions.get('active'),
    (storage) => readLocal<SavedSession>(storage, 'session'),
  );
}

export async function clearSession(): Promise<void> {
  await clearWithStorageFallback(
    async () => { await database.sessions.delete('active'); },
    (storage) => removeLocal(storage, 'session'),
  );
}

export async function saveCatalogDraft(catalog: CatalogSnapshot): Promise<void> {
  const draft = toPlain({ id: 'active' as const, catalog, updatedAt: new Date().toISOString() });
  await withStorageFallback(
    async () => { await database.catalogDrafts.put(draft); },
    (storage) => writeLocal(storage, 'catalog', draft),
  );
}

export async function loadCatalogDraft(): Promise<CatalogDraft | undefined> {
  return readWithStorageFallback(
    () => database.catalogDrafts.get('active'),
    (storage) => readLocal<CatalogDraft>(storage, 'catalog'),
  );
}

export async function clearCatalogDraft(): Promise<void> {
  await clearWithStorageFallback(
    async () => { await database.catalogDrafts.delete('active'); },
    (storage) => removeLocal(storage, 'catalog'),
  );
}

export async function saveShare(share: SavedShare): Promise<void> {
  const saved = toPlain(share);
  await withStorageFallback(
    async () => { await database.shares.put(saved); },
    (storage) => writeLocal(storage, `share:${saved.rankingIdentity}`, saved),
  );
}

export async function loadShare(rankingIdentity: string): Promise<SavedShare | undefined> {
  return readWithStorageFallback(
    () => database.shares.get(rankingIdentity),
    (storage) => readLocal<SavedShare>(storage, `share:${rankingIdentity}`),
  );
}

export async function clearShare(rankingIdentity: string): Promise<void> {
  await clearWithStorageFallback(
    async () => { await database.shares.delete(rankingIdentity); },
    (storage) => removeLocal(storage, `share:${rankingIdentity}`),
  );
}
