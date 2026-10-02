import { computed, ref, type Ref } from 'vue';
import type { CatalogSnapshot, CatalogTrack, RankingResult } from '@music-rank/contracts';
import {
  completeRanking,
  createRankingSession,
  endRankingEarly,
  getNextGroup,
  getRankingResult,
  recordChoice,
} from '@music-rank/ranking';
import type { ComparisonGroup } from '@music-rank/ranking';
import { clearSession, loadSession, saveSession, type RankingSession } from '../services/sessionStore.ts';
import { extendCalibrationBudget, getRankingIdentity, hasSpentCalibrationBudget } from '../services/sessionPolicy.ts';

type Artist = CatalogSnapshot['artist'];
type AppPage = 'catalog' | 'ranking' | 'paused' | 'results';

interface RankingFlowOptions {
  catalog: Ref<CatalogSnapshot | null>;
  selectedArtist: Ref<Artist | null>;
  rankingSessionId: Ref<string | null>;
  activeSessionInfo: Ref<{ artistId: string; completion: string } | null>;
  savedSessionExists: Ref<boolean>;
  storageWarning: Ref<boolean>;
  notice: Ref<string>;
  navigateTo: (page: AppPage) => void;
}

export function useRankingFlow(options: RankingFlowOptions) {
  const ranking = ref<RankingSession | null>(null);
  const currentGroup = ref<ComparisonGroup | null>(null);
  const rankingResult = ref<RankingResult | null>(null);

  const groupTracks = computed(() => {
    const ids = currentGroup.value?.candidateTrackIds ?? [];
    return ids.map((id) => options.catalog.value?.tracks.find((track) => track.id === id)).filter((track): track is CatalogTrack => Boolean(track));
  });
  const resultTracks = computed(() => {
    const tracks = options.catalog.value?.tracks ?? [];
    const ranked = rankingResult.value?.tracks ?? [];
    if (!ranked.length) return tracks.map((track, index) => ({ track, rank: index + 1, provisional: true, exposureCount: 0 }));
    return [...ranked]
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({
        track: tracks.find((track) => track.id === entry.trackId),
        rank: index + 1,
        provisional: tracks.length === 1 ? false : entry.provisional || entry.exposureCount < 1,
        exposureCount: entry.exposureCount,
      }))
      .filter((entry): entry is { track: CatalogTrack; rank: number; provisional: boolean; exposureCount: number } => Boolean(entry.track));
  });
  const comparisonProgress = computed(() => {
    const tracks = options.catalog.value?.tracks ?? [];
    const ranked = rankingResult.value?.tracks ?? [];
    return tracks.length ? Math.round((ranked.filter((track) => track.exposureCount > 0).length / tracks.length) * 100) : 0;
  });
  const resultIsComplete = computed(() => rankingResult.value?.status === 'complete' || options.catalog.value?.tracks.length === 1);
  const calibrationBudgetSpent = computed(() => Boolean(ranking.value && hasSpentCalibrationBudget(ranking.value)));
  const currentRankingIdentity = computed(() => {
    if (!ranking.value || !options.rankingSessionId.value || !options.selectedArtist.value || !options.catalog.value) return null;
    return getRankingIdentity(options.selectedArtist.value.id, options.catalog.value.version, ranking.value, options.rankingSessionId.value);
  });

  function createSessionId(): string {
    return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function persist(paused: boolean) {
    const catalog = options.catalog.value;
    const artist = options.selectedArtist.value;
    if (!ranking.value || !catalog || !artist) return;
    try {
      await saveSession({
        sessionId: options.rankingSessionId.value ?? createSessionId(),
        artistId: artist.id,
        catalog,
        includedTrackIds: catalog.tracks.map((track) => track.id),
        ranking: ranking.value,
        paused,
      });
      options.activeSessionInfo.value = { artistId: artist.id, completion: ranking.value.completion };
      options.savedSessionExists.value = ranking.value.completion !== 'completed';
      options.storageWarning.value = false;
    } catch {
      options.storageWarning.value = true;
    }
  }

  async function beginRanking() {
    const catalog = options.catalog.value;
    if (!catalog || !options.selectedArtist.value) return;
    if (catalog.tracks.length < 1) {
      options.notice.value = '曲库暂无可排名的歌曲。';
      return;
    }
    options.rankingSessionId.value = createSessionId();
    ranking.value = createRankingSession(catalog.tracks.map((track) => track.id), { groupSize: 6, seed: Date.now() });
    currentGroup.value = getNextGroup(ranking.value);
    if (!currentGroup.value) ranking.value = completeRanking(ranking.value);
    rankingResult.value = getRankingResult(ranking.value);
    options.navigateTo(currentGroup.value ? 'ranking' : 'results');
    await persist(false);
  }

  async function submitChoice(trackId: string | null) {
    if (!ranking.value || !currentGroup.value) return;
    ranking.value = recordChoice(ranking.value, currentGroup.value.candidateTrackIds, trackId);
    rankingResult.value = getRankingResult(ranking.value);
    currentGroup.value = getNextGroup(ranking.value);
    if (!currentGroup.value) {
      ranking.value = completeRanking(ranking.value);
      rankingResult.value = getRankingResult(ranking.value);
    }
    await persist(false);
    if (!currentGroup.value) options.navigateTo('results');
  }

  async function pauseRanking() {
    await persist(true);
    options.navigateTo('paused');
  }

  async function resumeRanking() {
    if (ranking.value) {
      currentGroup.value = getNextGroup(ranking.value);
      rankingResult.value = getRankingResult(ranking.value);
      options.navigateTo(currentGroup.value ? 'ranking' : 'results');
      await persist(false);
      return;
    }
    try {
      const saved = await loadSession();
      if (!saved) return;
      options.selectedArtist.value = saved.catalog.artist;
      options.catalog.value = saved.catalog;
      options.rankingSessionId.value = saved.sessionId || createSessionId();
      ranking.value = saved.ranking;
      rankingResult.value = getRankingResult(saved.ranking);
      currentGroup.value = getNextGroup(saved.ranking);
      options.navigateTo(currentGroup.value ? 'ranking' : 'results');
      await persist(saved.paused);
    } catch {
      options.notice.value = '无法读取本地进度；当前浏览器可能已清理站点数据。';
    }
  }

  async function finishEarly() {
    if (!ranking.value) return;
    ranking.value = endRankingEarly(ranking.value);
    rankingResult.value = getRankingResult(ranking.value);
    currentGroup.value = null;
    options.navigateTo('results');
    await persist(true);
  }

  async function continueCalibration() {
    if (!ranking.value) return;
    if (ranking.value.completion !== 'in_progress') ranking.value = { ...ranking.value, completion: 'in_progress' };
    if (ranking.value.trackIds.length > 1) ranking.value = extendCalibrationBudget(ranking.value);
    currentGroup.value = getNextGroup(ranking.value);
    if (!currentGroup.value) {
      ranking.value = completeRanking(ranking.value);
      rankingResult.value = getRankingResult(ranking.value);
      options.navigateTo('results');
      await persist(false);
      return;
    }
    rankingResult.value = getRankingResult(ranking.value);
    options.navigateTo('ranking');
    await persist(false);
  }

  function restartCurrentRanking() {
    if (!options.catalog.value || !options.selectedArtist.value) return;
    if (!window.confirm('重新开始会替换这位歌手当前保存的排名进度。要重新开始吗？')) return;
    void beginRanking();
  }

  function viewCurrentResults() {
    rankingResult.value = ranking.value ? getRankingResult(ranking.value) : null;
    options.navigateTo('results');
  }

  function reset() {
    ranking.value = null;
    currentGroup.value = null;
    rankingResult.value = null;
  }

  async function clearSavedSession() {
    await clearSession().catch(() => undefined);
    options.activeSessionInfo.value = null;
    options.rankingSessionId.value = null;
    options.savedSessionExists.value = false;
  }

  return {
    ranking,
    currentGroup,
    rankingResult,
    groupTracks,
    resultTracks,
    comparisonProgress,
    resultIsComplete,
    calibrationBudgetSpent,
    currentRankingIdentity,
    persist,
    beginRanking,
    submitChoice,
    pauseRanking,
    resumeRanking,
    finishEarly,
    continueCalibration,
    restartCurrentRanking,
    viewCurrentResults,
    reset,
    clearSavedSession,
  };
}
