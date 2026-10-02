<script setup lang="ts">
defineProps<{
  open: boolean;
  busy: boolean;
  url: string;
  message: string;
  matchingPriorShare: boolean;
  artistName: string;
  trackCount: number;
  catalogSources: string[];
}>();

const emit = defineEmits<{
  close: [];
  create: [];
  copy: [];
  revoke: [];
}>();
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <section class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <button type="button" class="icon-button modal-close" aria-label="关闭" @click="emit('close')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      <span class="page-eyebrow"><span class="eyebrow-line"></span>只读分享</span>
      <h2 id="share-title">分享这份个人榜单？</h2>
      <p>确认后会上传歌手名、歌曲、排名和榜单状态。任何持有链接的人都能查看，90 天后过期；不会上传逐轮选择。</p>
      <div class="share-preview"><strong>{{ artistName }} · {{ trackCount }} 首歌</strong><span>曲库来源：{{ catalogSources.join('、') || '未注明' }}</span><span>公开访问 · 只读 · 90 天有效</span></div>
      <div v-if="message" class="share-message" role="status">{{ message }}</div>
      <div v-if="url" class="share-url-row"><input readonly :value="url" aria-label="分享链接" /><button type="button" class="icon-button" aria-label="复制链接" title="复制链接" @click="emit('copy')"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button></div>
      <button v-if="!url" type="button" class="button button-dark button-wide" :disabled="busy" @click="emit('create')">{{ busy ? '正在生成…' : '确认并生成链接' }}</button>
      <button v-else-if="matchingPriorShare" type="button" class="revoke-button" @click="emit('revoke')">撤销这条分享链接</button>
    </section>
  </div>
</template>
