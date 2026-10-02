<script setup lang="ts">
import type { ArtistCandidate } from '@music-rank/contracts';
import { useMusicRankStore } from '../stores/musicRankStore.ts';

const store = useMusicRankStore();
const { query, loading, artists, searchMessage, savedSessionExists } = store;

function chooseArtist(artist: ArtistCandidate) {
  void store.chooseArtist(artist);
}
</script>

<template>
  <section class="page search-page">
    <div class="page-eyebrow"><span class="eyebrow-line"></span>个人歌曲排名</div>
    <h1>把喜欢的歌<br />排出自己的顺序。</h1>
    <p class="lede">选一位歌手，从多首歌曲中挑出这一轮最喜欢的。你的选择只属于你。</p>

    <form class="search-form" @submit.prevent="store.performSearch">
      <label for="artist-search">搜索歌手</label>
      <div class="search-control">
        <input id="artist-search" v-model="query" autocomplete="off" placeholder="例如：林俊杰" :disabled="loading" />
        <button type="submit" class="icon-button search-submit" :disabled="loading || !query.trim()" aria-label="搜索歌手" title="搜索歌手">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>
        </button>
      </div>
    </form>
    <div v-if="loading" class="loading-row"><span class="spinner"></span>正在查找曲库…</div>
    <div v-if="searchMessage" class="status-message">{{ searchMessage }}</div>
    <div v-if="artists.length" class="artist-results" aria-label="歌手搜索结果">
      <button v-for="artist in artists" :key="artist.id" type="button" class="artist-row" @click="chooseArtist(artist)">
        <span class="artist-avatar">{{ artist.name.slice(0, 1) }}</span>
        <span class="artist-main"><strong>{{ artist.name }}</strong><small>{{ artist.disambiguation || artist.sourceName }}</small></span>
        <span class="artist-source">{{ artist.sourceName }}</span>
        <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>

    <div v-if="savedSessionExists" class="resume-strip">
      <div><span class="resume-kicker">未完成的排名</span><strong>继续上次的进度</strong></div>
      <button type="button" class="button button-dark" @click="store.resumeRanking">继续 <span aria-hidden="true">→</span></button>
    </div>
    <div class="search-footnote"><span class="footnote-icon">◎</span><span>曲库来自 QQ 音乐。排名过程保存在此设备。</span></div>
  </section>
</template>
