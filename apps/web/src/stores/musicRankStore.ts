import { inject, ref, toRaw, type InjectionKey } from 'vue';
import type { HistoryState, Router } from 'vue-router';
import type { ArtistCandidate, CatalogSnapshot } from '@music-rank/contracts';
import { getArtistCatalog, searchArtists } from '../services/catalog.ts';
import { clearCatalogDraft, loadCatalogDraft, loadSession, saveCatalogDraft } from '../services/sessionStore.ts';
import { shouldConfirmSessionReplacement } from '../services/sessionPolicy.ts';
import { useRankingFlow } from '../composables/useRankingFlow.ts';
import { useShareFlow } from '../composables/useShareFlow.ts';

type AppPage = 'search' | 'catalog' | 'ranking' | 'paused' | 'results';
const pagePath: Record<AppPage, string> = {
  search: '/',
  catalog: '/catalog',
  ranking: '/ranking',
  paused: '/paused',
  results: '/results',
};

export function createMusicRankStore(router: Router) {
  const query = ref('');
  const loading = ref(false);
  const artists = ref<ArtistCandidate[]>([]);
  const selectedArtist = ref<ArtistCandidate | null>(null);
  const catalog = ref<CatalogSnapshot | null>(null);
  const searchMessage = ref('');
  const rankingSessionId = ref<string | null>(null);
  const notice = ref('');
  const storageWarning = ref(false);
  const savedSessionExists = ref(false);
  const activeSessionInfo = ref<{ artistId: string; completion: string } | null>(null);
  const pendingArtist = ref<ArtistCandidate | null>(null);
  const replacementDialogOpen = ref(false);
  const catalogOptions = {};
  let baseInitialization: Promise<void> | null = null;
  const initializedRoutes = new Set<string>();

  async function navigateTo(page: AppPage, replace = false): Promise<void> {
    const path = pagePath[page];
    const state = page === 'catalog' && catalog.value
      ? { catalog: toRaw(catalog.value) as unknown as HistoryState }
      : undefined;
    const location = state ? { path, state } : path;
    await (replace ? router.replace(location) : router.push(location));
  }

  function readHistoryCatalog(): CatalogSnapshot | null {
    const candidate = router.options.history.state.catalog;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    if (!('artist' in candidate) || !('tracks' in candidate) || !Array.isArray(candidate.tracks)) return null;
    return candidate as unknown as CatalogSnapshot;
  }

  function goBack(fallbackPage: AppPage) {
    if (router.options.history.state.back) router.back();
    else navigateTo(fallbackPage, true);
  }

  const rankingFlow = useRankingFlow({
    catalog,
    selectedArtist,
    rankingSessionId,
    activeSessionInfo,
    savedSessionExists,
    storageWarning,
    notice,
    navigateTo,
  });
  const shareFlow = useShareFlow({
    catalog,
    selectedArtist,
    resultTracks: rankingFlow.resultTracks,
    resultIsComplete: rankingFlow.resultIsComplete,
    rankingIdentity: rankingFlow.currentRankingIdentity,
  });

  async function performSearch() {
    searchMessage.value = '';
    artists.value = [];
    if (!query.value.trim()) {
      searchMessage.value = '输入歌手名称后开始搜索。';
      return;
    }
    loading.value = true;
    const result = await searchArtists(query.value, catalogOptions);
    loading.value = false;
    artists.value = result.items;
    searchMessage.value = result.message ?? (result.items.length ? '' : '没有找到匹配的歌手。');
  }

  async function loadArtist(artist: ArtistCandidate) {
    loading.value = true;
    selectedArtist.value = artist;
    const result = await getArtistCatalog(artist, catalogOptions);
    loading.value = false;
    catalog.value = result.items[0] ?? null;
    if (!catalog.value) {
      searchMessage.value = result.message ?? '暂时无法加载曲库。';
      return;
    }
    try {
      await saveCatalogDraft(catalog.value);
      storageWarning.value = false;
    } catch {
      storageWarning.value = true;
    }
    await navigateTo('catalog');
  }

  async function chooseArtist(artist: ArtistCandidate) {
    if (shouldConfirmSessionReplacement(activeSessionInfo.value, artist.id)) {
      pendingArtist.value = artist;
      replacementDialogOpen.value = true;
      return;
    }
    await loadArtist(artist);
  }

  async function confirmReplaceSession() {
    const artist = pendingArtist.value;
    if (!artist) return;
    replacementDialogOpen.value = false;
    pendingArtist.value = null;
    await rankingFlow.clearSavedSession();
    await loadArtist(artist);
  }

  function cancelReplaceSession() {
    replacementDialogOpen.value = false;
    pendingArtist.value = null;
  }

  async function restart() {
    rankingFlow.reset();
    rankingSessionId.value = null;
    catalog.value = null;
    selectedArtist.value = null;
    await clearCatalogDraft().catch(() => { storageWarning.value = true; });
    savedSessionExists.value = activeSessionInfo.value?.completion !== 'completed' && activeSessionInfo.value !== null;
    await navigateTo('search', true);
  }

  async function restoreBaseState(): Promise<void> {
    try {
      const saved = await loadSession();
      savedSessionExists.value = Boolean(saved && saved.ranking.completion !== 'completed');
      activeSessionInfo.value = saved ? { artistId: saved.artistId, completion: saved.ranking.completion } : null;
      if (saved) rankingFlow.restoreSession(saved);
    } catch {
      storageWarning.value = true;
    }
  }

  async function initialize(routeName?: string): Promise<void> {
    if (!baseInitialization) baseInitialization = restoreBaseState();
    await baseInitialization;

    if (routeName !== 'catalog' || initializedRoutes.has(routeName)) return;
    const historyCatalog = readHistoryCatalog();
    if (historyCatalog) {
      selectedArtist.value = historyCatalog.artist;
      catalog.value = historyCatalog;
      initializedRoutes.add(routeName);
      return;
    }
    try {
      const saved = await loadSession();
      const draft = await loadCatalogDraft();
      if (draft && (!saved || draft.updatedAt > saved.updatedAt)) {
        selectedArtist.value = draft.catalog.artist;
        catalog.value = draft.catalog;
      }
      initializedRoutes.add(routeName);
    } catch {
      storageWarning.value = true;
    }
  }

  return {
    query,
    loading,
    artists,
    selectedArtist,
    catalog,
    searchMessage,
    notice,
    storageWarning,
    savedSessionExists,
    pendingArtist,
    replacementDialogOpen,
    performSearch,
    chooseArtist,
    confirmReplaceSession,
    cancelReplaceSession,
    restart,
    goBack,
    initialize,
    ...rankingFlow,
    ...shareFlow,
  };
}

export type MusicRankStore = ReturnType<typeof createMusicRankStore>;
export const musicRankStoreKey: InjectionKey<MusicRankStore> = Symbol('music-rank-store');

export function useMusicRankStore(): MusicRankStore {
  const store = inject(musicRankStoreKey);
  if (!store) throw new Error('Music rank store was not provided.');
  return store;
}
