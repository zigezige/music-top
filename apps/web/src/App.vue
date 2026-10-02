<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useMusicRankStore } from './stores/musicRankStore.ts';
import ShareDialog from './components/ShareDialog.vue';
import ReplaceSessionDialog from './components/ReplaceSessionDialog.vue';

const store = useMusicRankStore();
const route = useRoute();
const {
  storageWarning,
  notice,
  shareDialogOpen,
  shareBusy,
  shareUrl,
  shareMessage,
  matchingPriorShare,
  catalog,
  resultTracks,
  catalogSources,
  replacementDialogOpen,
  pendingArtist,
} = store;

</script>

<template>
  <main class="app-shell" :class="{ 'catalog-layout': route.name === 'catalog' }">
    <header v-if="route.name === 'search'" class="topbar">
      <button class="wordmark" type="button" @click="store.restart" aria-label="听序首页">
        <span class="wordmark-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>听序</span>
      </button>
      <span class="topbar-note">YOUR MUSIC, YOUR ORDER</span>
    </header>

    <div v-if="storageWarning" class="inline-warning" role="status">本地保存暂不可用，离开此页面后可能无法恢复当前进度。</div>
    <div v-if="notice" class="inline-warning" role="status">{{ notice }}<button type="button" class="text-button" @click="notice = ''">知道了</button></div>

    <RouterView v-slot="{ Component }">
      <KeepAlive :include="['SearchView', 'CatalogView', 'RankingView', 'PausedView', 'ResultsView']">
        <component :is="Component" />
      </KeepAlive>
    </RouterView>

    <ShareDialog
      :open="shareDialogOpen"
      :busy="shareBusy"
      :url="shareUrl"
      :message="shareMessage"
      :matching-prior-share="Boolean(matchingPriorShare)"
      :artist-name="catalog?.artist.name ?? ''"
      :track-count="resultTracks.length"
      :catalog-sources="catalogSources"
      @close="shareDialogOpen = false"
      @create="store.createShare"
      @copy="store.copyShare"
      @revoke="store.revokeShare"
    />
    <ReplaceSessionDialog
      :open="replacementDialogOpen"
      :artist-name="catalog?.artist.name ?? ''"
      :pending-artist-name="pendingArtist?.name ?? ''"
      @confirm="store.confirmReplaceSession"
      @cancel="store.cancelReplaceSession"
    />

    <footer class="app-footer"><span>听序 · 个人偏好，不代表客观评价</span><span>本地进度仅此设备可见</span></footer>
  </main>
</template>
