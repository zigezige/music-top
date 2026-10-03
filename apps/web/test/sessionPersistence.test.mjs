import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { reactive } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createRankingSession } from '@music-rank/ranking';

// A `?suffix` import loads a fresh copy of the module, which is how a real page reload
// resets the in-memory persistence mode.
const { clearSession, saveSession } = await import('../src/services/sessionStore.ts');
const { createRouteGuard } = await import('../src/services/routePolicy.ts');

const mirrorPrefix = 'music-rank-h5:';
const mirror = new Map();
globalThis.localStorage = {
  getItem: (key) => (mirror.has(key) ? mirror.get(key) : null),
  setItem: (key, value) => { mirror.set(key, String(value)); },
  removeItem: (key) => { mirror.delete(key); },
};

const artist = { id: 'qqmusic:artist-1', name: '测试歌手', sourceName: '测试歌手', sourceArtistId: 'artist-1' };
const catalog = {
  artist,
  version: 'catalog-v1',
  fetchedAt: '2026-10-03T00:00:00.000Z',
  tracks: [
    { id: 'qqmusic:track-1', title: '第一首', creditedArtists: ['测试歌手'], versionKind: 'studio', sources: ['qqmusic'], outboundLinks: [] },
    { id: 'qqmusic:track-2', title: '第二首', creditedArtists: ['测试歌手'], versionKind: 'studio', sources: ['qqmusic'], outboundLinks: [] },
  ],
};
const trackIds = catalog.tracks.map((track) => track.id);
const routes = ['search', 'catalog', 'ranking', 'paused', 'results']
  .map((name) => ({ path: name === 'search' ? '/' : `/${name}`, name, component: {} }));

function sessionRecord() {
  return {
    id: 'active',
    sessionId: 'session-1',
    schemaVersion: 1,
    artistId: artist.id,
    catalog,
    includedTrackIds: trackIds,
    ranking: createRankingSession(trackIds, { seed: 7 }),
    paused: false,
    updatedAt: '2026-10-03T00:00:00.000Z',
  };
}

function countRows(table) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('music-rank-h5');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const count = database.transaction(table).objectStore(table).count();
      count.onsuccess = () => { database.close(); resolve(count.result); };
      count.onerror = () => { database.close(); reject(count.error); };
    };
  });
}

async function resetStorage() {
  await clearSession();
  mirror.clear();
}

test('persists a session written from reactive state into the primary store', async () => {
  await resetStorage();
  const live = await import('../src/services/sessionStore.ts?reactive-write');

  await live.saveSession({
    sessionId: 'session-1',
    artistId: artist.id,
    // The store hands over `catalog.value` / `ranking.value`, which are reactive proxies.
    catalog: reactive(catalog),
    includedTrackIds: [...trackIds],
    ranking: reactive(createRankingSession(trackIds, { seed: 7 })),
    paused: false,
  });

  assert.equal(await countRows('sessions'), 1, 'the reactive session reaches IndexedDB');
  assert.equal(mirror.has(`${mirrorPrefix}session`), false, 'the primary store is not bypassed');

  const reloaded = await import('../src/services/sessionStore.ts?reactive-read');
  const restored = await reloaded.loadSession();

  assert.equal(restored?.sessionId, 'session-1');
  assert.deepEqual(restored?.catalog, catalog);
  assert.deepEqual(restored?.ranking, createRankingSession(trackIds, { seed: 7 }));
});

test('restores a session that only ever reached the localStorage mirror', async () => {
  await resetStorage();
  mirror.set(`${mirrorPrefix}session`, JSON.stringify(sessionRecord()));

  const reloaded = await import('../src/services/sessionStore.ts?mirror-read');
  const restored = await reloaded.loadSession();

  assert.equal(restored?.sessionId, 'session-1');
  assert.deepEqual(restored?.catalog, catalog);
});

test('keeps ranking, paused, and results routes after a reload', async () => {
  for (const routeName of ['ranking', 'paused', 'results']) {
    await resetStorage();
    mirror.set(`${mirrorPrefix}session`, JSON.stringify(sessionRecord()));

    const { createMusicRankStore } = await import(`../src/stores/musicRankStore.ts?reload-${routeName}`);
    const router = createRouter({ history: createMemoryHistory(), routes });
    const store = createMusicRankStore(router);
    const guard = createRouteGuard(store.initialize, () => ({
      hasCatalog: Boolean(store.catalog.value),
      hasRanking: Boolean(store.ranking.value),
      hasCurrentGroup: Boolean(store.currentGroup.value),
    }));
    router.beforeEach((to) => guard(String(to.name ?? '')));

    await router.push(`/${routeName}`);

    assert.equal(router.currentRoute.value.fullPath, `/${routeName}`, `${routeName} survives a reload`);
    assert.deepEqual(store.catalog.value, catalog, `${routeName} restores its catalog`);
  }
  await resetStorage();
});

test('keeps the catalog route after a reload when only the draft survived', async () => {
  await resetStorage();
  mirror.set(`${mirrorPrefix}catalog`, JSON.stringify({
    id: 'active',
    catalog,
    updatedAt: '2026-10-03T00:00:00.000Z',
  }));

  const { createMusicRankStore } = await import('../src/stores/musicRankStore.ts?reload-catalog');
  const router = createRouter({ history: createMemoryHistory(), routes });
  const store = createMusicRankStore(router);
  const guard = createRouteGuard(store.initialize, () => ({
    hasCatalog: Boolean(store.catalog.value),
    hasRanking: Boolean(store.ranking.value),
    hasCurrentGroup: Boolean(store.currentGroup.value),
  }));
  router.beforeEach((to) => guard(String(to.name ?? '')));

  await router.push('/catalog');

  assert.equal(router.currentRoute.value.fullPath, '/catalog');
  assert.deepEqual(store.catalog.value, catalog);
  assert.deepEqual(store.selectedArtist.value, artist);
  await resetStorage();
});

test('clears both stores so a session cannot come back', async () => {
  await resetStorage();
  await saveSession(sessionRecord());
  mirror.set(`${mirrorPrefix}session`, JSON.stringify(sessionRecord()));

  await clearSession();

  assert.equal(mirror.has(`${mirrorPrefix}session`), false, 'the mirror copy is removed');
  const reloaded = await import('../src/services/sessionStore.ts?cleared-read');
  assert.equal(await reloaded.loadSession(), undefined, 'nothing resurfaces after a reload');
});
