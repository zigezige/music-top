<script setup lang="ts">
import { fallbackAlbumCover, getAlbumCoverSource } from '../media.mjs';

defineProps<{
  src: string | undefined;
  alt: string;
}>();
</script>

<template>
  <img
    class="album-cover"
    :src="getAlbumCoverSource(src)"
    :alt="alt"
    loading="lazy"
    @error="fallbackAlbumCover($event.currentTarget as HTMLImageElement)"
  />
</template>
