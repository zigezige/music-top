<script setup lang="ts">
import AlbumCover from '../components/AlbumCover.vue';
import { useMusicRankStore } from '../stores/musicRankStore.ts';

const store = useMusicRankStore();
const { catalog } = store;
</script>

<template>
  <section v-if="catalog" class="page catalog-page">
    <button class="back-link" type="button" @click="store.goBack('search')">← <span>返回搜索</span></button>
    <div class="page-eyebrow"><span class="eyebrow-line"></span>曲库确认</div>
    <div class="catalog-heading"><div><h1>{{ catalog.artist.name }}</h1><p>{{ catalog.tracks.length }} 首收录歌曲 · {{ catalog.version }}</p></div><div class="catalog-count">{{ catalog.tracks.length }}<small>TRACKS</small></div></div>
    <div class="scope-note"><span class="scope-symbol">◎</span><p>来源：QQ 音乐歌手歌曲资料 · 录音室版本</p></div>
    <div class="track-list catalog-list">
      <article v-for="(track, index) in catalog.tracks" :key="track.id" class="catalog-track">
        <span class="track-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <AlbumCover :src="track.albumCoverUrl" :alt="`${track.albumTitle || track.title}专辑封面`" />
        <div class="track-copy"><strong>{{ track.title }}</strong><small>{{ track.albumTitle || '未收录专辑' }}<span v-if="track.releaseDate"> · {{ track.releaseDate.slice(0, 4) }}</span></small></div>
      </article>
      <p v-if="!catalog.tracks.length" class="empty-filter">暂无录音室歌曲资料。</p>
    </div>
    <div class="catalog-actions"><button type="button" class="button button-dark button-wide" :disabled="catalog.tracks.length === 0" @click="store.beginRanking">{{ catalog.tracks.length === 1 ? '生成单曲榜单' : '开始排名' }} <span aria-hidden="true">→</span></button><small>排名包含全部 {{ catalog.tracks.length }} 首歌曲</small></div>
  </section>
</template>
