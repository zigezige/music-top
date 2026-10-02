<script setup lang="ts">
import AlbumCover from '../components/AlbumCover.vue';
import { useMusicRankStore } from '../stores/musicRankStore.ts';

const store = useMusicRankStore();
const { catalog, resultTracks, resultIsComplete, comparisonProgress, calibrationBudgetSpent } = store;
</script>

<template>
  <section v-if="catalog" class="page results-page">
    <div class="page-eyebrow"><span class="eyebrow-line"></span>{{ resultIsComplete ? '排名完成' : '当前排名' }}</div>
    <div class="results-heading"><div><h1>{{ catalog.artist.name }}<br />我的歌曲榜</h1><p>{{ catalog.tracks.length === 1 ? '曲库只有一首歌，无需比较。' : resultIsComplete ? '已完成当前曲库的比较。' : `曲库覆盖 ${comparisonProgress}%，排序仍可能变化。` }}</p></div><div class="results-disc" aria-hidden="true"><span>♪</span></div></div>
    <div v-if="!resultIsComplete" class="provisional-note"><span>暂定结果</span><p>{{ calibrationBudgetSpent ? '已达到当前校准轮数上限；继续操作会增加 20 轮预算。结果仍可能变化。' : '未充分比较的歌曲仍会显示在榜单中。继续校准可以增加边界歌曲的比较证据。' }}</p></div>
    <ol class="track-list result-list">
      <li v-for="entry in resultTracks" :key="entry.track.id" class="result-track">
        <span class="result-rank">{{ String(entry.rank).padStart(2, '0') }}</span>
        <AlbumCover :src="entry.track.albumCoverUrl" :alt="`${entry.track.albumTitle || entry.track.title}专辑封面`" />
        <span class="track-copy"><strong>{{ entry.track.title }}</strong><small>{{ entry.track.albumTitle || '未收录专辑' }}<span v-if="entry.track.releaseDate"> · {{ entry.track.releaseDate.slice(0, 4) }}</span></small></span>
        <span class="result-evidence" :class="{ low: entry.provisional }">{{ entry.provisional ? '暂定' : `${entry.exposureCount} 次比较` }}</span>
      </li>
    </ol>
    <div class="results-actions"><button type="button" class="button button-dark button-wide" @click="store.openShareDialog">分享我的榜单 <span aria-hidden="true">↗</span></button><button v-if="!resultIsComplete" type="button" class="button button-light button-wide" @click="store.continueCalibration">{{ calibrationBudgetSpent ? '增加 20 轮并继续校准' : '继续校准' }}</button><button v-if="!resultIsComplete" type="button" class="text-button centered" @click="store.restartCurrentRanking">重新开始排名</button><button type="button" class="text-button centered" @click="store.restart">为另一位歌手排名</button></div>
  </section>
</template>
