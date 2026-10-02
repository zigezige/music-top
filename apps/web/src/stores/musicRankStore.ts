import { inject, ref, type InjectionKey } from 'vue';
import type { Router } from 'vue-router';
import type { ArtistCandidate, CatalogSnapshot } from '@music-rank/contracts';
import { getArtistCatalog, searchArtists } from '../services/catalog.ts';
import { loadSession } from '../services/sessionStore.ts';
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

  function navigateTo(page: AppPage, replace = false) {
    const path = pagePath[page];
    void (replace ? router.replace(path) : router.push(path));
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
    navigateTo('catalog');
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
    savedSessionExists.value = activeSessionInfo.value?.completion !== 'completed' && activeSessionInfo.value !== null;
    navigateTo('search', true);
  }

  async function initialize() {
    if (router.currentRoute.value.name === 'share') return;
    try {
      const saved = await loadSession();
      savedSessionExists.value = Boolean(saved && saved.ranking.completion !== 'completed');
      activeSessionInfo.value = saved ? { artistId: saved.artistId, completion: saved.ranking.completion } : null;
      rankingSessionId.value = saved?.sessionId ?? null;
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
