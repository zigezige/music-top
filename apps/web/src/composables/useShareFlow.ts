import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { ArtistCandidate, CatalogSnapshot, CatalogTrack, ShareSnapshot } from '@music-rank/contracts';
import { clearShare, loadShare, saveShare } from '../services/sessionStore.ts';
import { getSharedSnapshot } from '../services/shares.ts';

type RankedTrack = { track: CatalogTrack; rank: number; provisional: boolean; exposureCount: number };
type SavedShare = { rankingIdentity: string; shareId: string; revokeToken: string; url: string };

interface ShareFlowOptions {
  catalog: Ref<CatalogSnapshot | null>;
  selectedArtist: Ref<ArtistCandidate | null>;
  resultTracks: ComputedRef<RankedTrack[]>;
  resultIsComplete: ComputedRef<boolean>;
  rankingIdentity: ComputedRef<string | null>;
}

export function useShareFlow(options: ShareFlowOptions) {
  const shareDialogOpen = ref(false);
  const shareBusy = ref(false);
  const shareUrl = ref('');
  const shareMessage = ref('');
  const priorShare = ref<SavedShare | null>(null);
  const sharedSnapshot = ref<ShareSnapshot | null>(null);
  const sharedError = ref('');
  const sharedLoading = ref(false);

  const catalogSources = computed(() => [...new Set((options.catalog.value?.tracks ?? []).flatMap((track) => track.sources))]);
  const matchingPriorShare = computed(() => priorShare.value?.rankingIdentity === options.rankingIdentity.value ? priorShare.value : null);

  function makeShareSnapshot(): ShareSnapshot {
    return {
      artistName: options.selectedArtist.value?.name ?? options.catalog.value?.artist.name ?? '',
      catalogSources: [...new Set((options.catalog.value?.tracks ?? []).flatMap((track) => track.sources).map((source) => source.trim()).filter(Boolean))].slice(0, 10),
      tracks: options.resultTracks.value.map(({ track, rank }) => ({
        title: track.title,
        creditedArtists: track.creditedArtists,
        ...(track.albumTitle ? { albumTitle: track.albumTitle } : {}),
        ...(track.albumCoverUrl ? { albumCoverUrl: track.albumCoverUrl } : {}),
        versionKind: track.versionKind,
        rank,
        outboundLinks: track.outboundLinks,
      })),
      status: options.resultIsComplete.value ? 'complete' : 'provisional',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async function openShareDialog() {
    shareDialogOpen.value = true;
    shareMessage.value = '';
    shareUrl.value = '';
    priorShare.value = null;
    const identity = options.rankingIdentity.value;
    if (!identity) return;
    try {
      const saved = await loadShare(identity);
      if (saved) {
        priorShare.value = { rankingIdentity: saved.rankingIdentity, shareId: saved.shareId, revokeToken: saved.revokeToken, url: saved.url };
        shareUrl.value = saved.url;
      }
    } catch {
      shareMessage.value = '无法读取此榜单先前生成的分享链接。';
    }
  }

  async function createShare() {
    const rankingIdentity = options.rankingIdentity.value;
    if (!options.catalog.value || !options.resultTracks.value.length || !rankingIdentity) return;
    shareBusy.value = true;
    shareMessage.value = '';
    try {
      const response = await fetch('/api/v1/shares', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeShareSnapshot()),
      });
      if (!response.ok) throw new Error('Share API unavailable');
      const payload = await response.json() as { shareId: string; url?: string; revokeToken: string };
      const url = payload.url ?? new URL(`/share/${payload.shareId}`, window.location.origin).toString();
      await saveShare({ id: rankingIdentity, rankingIdentity, shareId: payload.shareId, revokeToken: payload.revokeToken, url, createdAt: new Date().toISOString() });
      priorShare.value = { rankingIdentity, shareId: payload.shareId, revokeToken: payload.revokeToken, url };
      shareUrl.value = url;
      shareMessage.value = '榜单已生成。持有链接的人都可以查看，链接将在 90 天后过期。';
    } catch {
      shareMessage.value = '暂时无法生成分享链接。你的榜单和进度仍保存在本地，请稍后重试。';
    } finally {
      shareBusy.value = false;
    }
  }

  async function copyShare() {
    if (!shareUrl.value) return;
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      shareMessage.value = '链接已复制。';
    } catch {
      shareMessage.value = '复制失败，请长按链接复制。';
    }
  }

  async function revokeShare() {
    if (!priorShare.value) return;
    try {
      const response = await fetch(`/api/v1/shares/${encodeURIComponent(priorShare.value.shareId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${priorShare.value.revokeToken}` },
      });
      if (!response.ok) throw new Error('Revoke failed');
      await clearShare(priorShare.value.rankingIdentity);
      priorShare.value = null;
      shareUrl.value = '';
      shareMessage.value = '分享链接已撤销。';
    } catch {
      shareMessage.value = '暂时无法撤销链接，请保持此浏览器中的撤销凭据并重试。';
    }
  }

  async function loadSharedPage(shareId: string) {
    sharedLoading.value = true;
    const result = await getSharedSnapshot(shareId);
    sharedLoading.value = false;
    if (result.status === 'ok') sharedSnapshot.value = result.snapshot;
    else sharedError.value = result.message;
  }

  return {
    shareDialogOpen,
    shareBusy,
    shareUrl,
    shareMessage,
    matchingPriorShare,
    catalogSources,
    sharedSnapshot,
    sharedError,
    sharedLoading,
    openShareDialog,
    createShare,
    copyShare,
    revokeShare,
    loadSharedPage,
  };
}
