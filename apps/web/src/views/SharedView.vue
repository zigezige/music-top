<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ShareSnapshot } from '@music-rank/contracts';
import AlbumCover from '../components/AlbumCover.vue';
import { useMusicRankStore } from '../stores/musicRankStore.ts';

const route = useRoute();
const store = useMusicRankStore();
const { sharedSnapshot, sharedLoading, sharedError } = store;

function versionLabel(kind: ShareSnapshot['tracks'][number]['versionKind']): string {
  return ({ studio: '录音室版', live: '现场版', instrumental: '伴奏版', remix: 'Remix', cover: '翻唱', other: '其他版本' })[kind];
}

async function loadShare() {
  const shareId = route.params.shareId;
  if (typeof shareId !== 'string') return;
  await store.loadSharedPage(shareId);
  document.title = sharedSnapshot.value ? `${sharedSnapshot.value.artistName} · 听序` : '分享链接 · 听序';
  let noindex = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!noindex) {
    noindex = document.createElement('meta');
    noindex.name = 'robots';
    document.head.append(noindex);
  }
  noindex.content = 'noindex, nofollow, noarchive';
}

onMounted(() => void loadShare());
watch(() => route.params.shareId, () => void loadShare());
</script>

<template>
  <section class="page results-page shared-page">
    <div class="page-eyebrow"><span class="eyebrow-line"></span>只读分享榜单</div>
    <template v-if="sharedSnapshot">
      <div class="results-heading"><div><h1>{{ sharedSnapshot.artistName }}<br />歌曲榜</h1><p>{{ sharedSnapshot.status === 'complete' ? '已完成比较' : '当前暂定排序' }} · {{ new Date(sharedSnapshot.createdAt).toLocaleDateString('zh-CN') }}</p></div><div class="results-disc" aria-hidden="true"><span>♪</span></div></div>
      <div v-if="sharedSnapshot.catalogSources?.length" class="shared-sources"><span>曲库来源</span><strong>{{ sharedSnapshot.catalogSources.join('、') }}</strong></div>
      <ol class="track-list result-list">
        <li v-for="track in [...sharedSnapshot.tracks].sort((a, b) => a.rank - b.rank)" :key="`${track.rank}-${track.title}`" class="result-track">
          <span class="result-rank">{{ String(track.rank).padStart(2, '0') }}</span>
          <AlbumCover :src="track.albumCoverUrl" :alt="`${track.albumTitle || track.title}专辑封面`" />
          <span class="track-copy"><strong>{{ track.title }}</strong><small>{{ track.albumTitle || '未收录专辑' }} · {{ versionLabel(track.versionKind) }}</small></span>
        </li>
      </ol>
    </template>
    <div v-else class="share-unavailable"><span class="expired-mark">×</span><h1>{{ sharedLoading ? '正在打开榜单…' : '榜单暂时不可用。' }}</h1><p>{{ sharedError }}</p></div>
    <div class="share-readonly-note">这是一份个人偏好榜单，由创建者主动分享。排名仅代表创建者的选择。</div>
  </section>
</template>
