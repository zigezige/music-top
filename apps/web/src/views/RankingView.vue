<script setup lang="ts">
import AlbumCover from '../components/AlbumCover.vue';
import { useMusicRankStore } from '../stores/musicRankStore.ts';

const store = useMusicRankStore();
const { catalog, groupTracks, rankingResult, comparisonProgress, currentGroup } = store;

function choose(trackId: string | null) {
  void store.submitChoice(trackId);
}
</script>

<template>
  <section v-if="catalog" class="page ranking-page">
    <div class="ranking-topline"><div><span class="page-eyebrow"><span class="eyebrow-line"></span>正在排名</span><h1>{{ catalog.artist.name }}</h1></div><button type="button" class="icon-button pause-button" aria-label="暂停排名" title="暂停排名" @click="store.pauseRanking"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg></button></div>
    <div class="progress-track"><span :style="{ width: `${comparisonProgress}%` }"></span></div>
    <div class="progress-copy"><span>曲库覆盖 {{ comparisonProgress }}%</span><span>{{ rankingResult?.completedRounds ?? 0 }} 轮已完成</span></div>
    <div class="question-heading"><div><span class="round-label">{{ currentGroup?.roundKind === 'revival' ? '复活挑战' : currentGroup?.roundKind === 'coverage' ? '初始覆盖' : '继续校准' }}</span><h2>这一组里，<em>最喜欢哪首？</em></h2></div><span class="pick-count">{{ groupTracks.length }}<small>首可选</small></span></div>
    <div class="track-list choice-list">
      <button v-for="(track, index) in groupTracks" :key="track.id" type="button" class="choice-track" @click="choose(track.id)">
        <span class="choice-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <AlbumCover :src="track.albumCoverUrl" :alt="`${track.albumTitle || track.title}专辑封面`" />
        <span class="track-copy"><strong>{{ track.title }}</strong><small>{{ track.albumTitle || track.creditedArtists.join(' / ') }}<span v-if="track.releaseDate"> · {{ track.releaseDate.slice(0, 4) }}</span></small></span>
        <span class="choose-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span>
      </button>
    </div>
    <div class="ranking-actions"><button type="button" class="skip-button" @click="choose(null)">这组我都不熟 <span>↗</span></button><button type="button" class="finish-link" @click="store.finishEarly">提前结束</button></div>
    <p class="privacy-note">跳过不会影响这些歌曲的排名。你可以随时暂停。</p>
  </section>
</template>
