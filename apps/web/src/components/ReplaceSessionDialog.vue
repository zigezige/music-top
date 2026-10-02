<script setup lang="ts">
defineProps<{
  open: boolean;
  artistName: string;
  pendingArtistName: string;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('cancel')">
    <section class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="replace-title">
      <button type="button" class="icon-button modal-close" aria-label="取消" @click="emit('cancel')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      <span class="page-eyebrow"><span class="eyebrow-line"></span>替换未完成进度</span>
      <h2 id="replace-title">要放弃上次的排名吗？</h2>
      <p>{{ artistName || '当前歌手' }}的未完成进度保存在本机。确认后会放弃旧进度并继续搜索{{ pendingArtistName }}。</p>
      <div class="results-actions"><button type="button" class="button button-dark button-wide" @click="emit('confirm')">放弃进度并继续</button><button type="button" class="button button-light button-wide" @click="emit('cancel')">保留进度</button></div>
    </section>
  </div>
</template>
