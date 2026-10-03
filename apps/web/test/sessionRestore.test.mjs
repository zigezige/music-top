import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createRankingSession, getNextGroup } from '@music-rank/ranking';

const { clearCatalogDraft, clearSession, saveCatalogDraft, saveSession } = await import('../src/services/sessionStore.ts');
const { createMusicRankStore } = await import('../src/stores/musicRankStore.ts');
const { appRoutes } = await import('../src/router.ts');
const { createRouteGuard } = await import('../src/services/routePolicy.ts');

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

function createStore() {
  const router = createRouter({ history: createMemoryHistory(), routes: appRoutes });
  return createMusicRankStore(router);
}

test('initializes a direct catalog route from its persisted catalog draft', async () => {
  await clearSession();
  await clearCatalogDraft();
  await saveCatalogDraft(catalog);

  const store = createStore();
  await store.initialize('catalog');

  assert.deepEqual(store.catalog.value, catalog);
  assert.deepEqual(store.selectedArtist.value, artist);
  await clearCatalogDraft();
});

test('loads a catalog draft when catalog is entered after initial app restoration', async () => {
  await clearSession();
  await clearCatalogDraft();

  const store = createStore();
  await store.initialize('search');
  await saveCatalogDraft(catalog);
  await store.initialize('catalog');

  assert.deepEqual(store.catalog.value, catalog);
  assert.deepEqual(store.selectedArtist.value, artist);
  await clearCatalogDraft();
});

test('restores catalog from the current history entry when browser storage is unavailable', async () => {
  await clearSession();
  await clearCatalogDraft();
  const history = createMemoryHistory();
  const router = createRouter({ history, routes: [] });
  history.push('/catalog', { catalog });

  const store = createMusicRankStore(router);
  await store.initialize('catalog');

  assert.deepEqual(store.catalog.value, catalog);
  assert.deepEqual(store.selectedArtist.value, artist);
});

test('keeps catalog navigation after selecting an artist', async () => {
  await clearSession();
  await clearCatalogDraft();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'search', component: {} },
      { path: '/catalog', name: 'catalog', component: {} },
    ],
  });
  const store = createMusicRankStore(router);
  const guard = createRouteGuard(store.initialize, () => ({
    hasCatalog: Boolean(store.catalog.value),
    hasRanking: Boolean(store.ranking.value),
    hasCurrentGroup: Boolean(store.currentGroup.value),
  }));
  router.beforeEach((to) => guard(String(to.name ?? '')));
  await router.push('/');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, async json() { return { snapshot: catalog }; } });
  try {
    await store.chooseArtist(artist);
    assert.deepEqual(store.catalog.value, catalog);
    assert.equal(router.currentRoute.value.name, 'catalog');
  } finally {
    globalThis.fetch = originalFetch;
    await clearCatalogDraft();
  }
});

test('keeps catalog history state structured-cloneable after selecting an artist', async () => {
  await clearSession();
  await clearCatalogDraft();
  const navigations = [];
  const router = {
    options: { history: { state: {} } },
    push: async (location) => { navigations.push(structuredClone(location)); },
    replace: async (location) => { navigations.push(structuredClone(location)); },
  };
  const store = createMusicRankStore(router);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, async json() { return { snapshot: catalog }; } });
  try {
    await store.chooseArtist(artist);
    assert.equal(navigations[0].path, '/catalog');
    assert.deepEqual(navigations[0].state.catalog, catalog);
  } finally {
    globalThis.fetch = originalFetch;
    await clearCatalogDraft();
  }
});

test('initializes ranking, paused, and results routes from the persisted session', async () => {
  await clearSession();
  await clearCatalogDraft();
  const ranking = createRankingSession(catalog.tracks.map((track) => track.id), { seed: 11 });
  await saveSession({
    sessionId: 'session-v1',
    artistId: artist.id,
    catalog,
    includedTrackIds: catalog.tracks.map((track) => track.id),
    ranking,
    paused: false,
  });

  for (const routeName of ['ranking', 'paused', 'results']) {
    const store = createStore();
    await store.initialize(routeName);

    assert.deepEqual(store.catalog.value, catalog, `${routeName} restores its catalog`);
    assert.deepEqual(store.ranking.value, ranking, `${routeName} restores its ranking`);
    assert.deepEqual(store.currentGroup.value, getNextGroup(ranking), `${routeName} restores its current group`);
  }
  await clearSession();
});
