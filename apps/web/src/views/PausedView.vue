<script setup lang="ts">
import { useMusicRankStore } from '../stores/musicRankStore.ts';

const store = useMusicRankStore();
const { catalog, rankingResult, comparisonProgress } = store;
</script>

<template>
  <section v-if="catalog" class="page pause-page">
    <div class="page-eyebrow"><span class="eyebrow-line"></span>进度已保存</div>
    <h1>先听到这里。</h1>
    <p class="lede">{{ catalog.artist.name }}的排名进度保存在这台设备上。回来时可以接着完成。</p>
    <div class="pause-progress"><div><span>已比较轮次</span><strong>{{ rankingResult?.completedRounds ?? 0 }}</strong></div><div><span>曲库覆盖</span><strong>{{ comparisonProgress }}%</strong></div></div>
    <button type="button" class="button button-dark button-wide" @click="store.resumeRanking">继续排名 <span aria-hidden="true">→</span></button>
    <button type="button" class="text-button centered" @click="store.viewCurrentResults">查看当前结果</button>
  </section>
</template>
