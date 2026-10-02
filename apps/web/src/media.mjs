export const albumPlaceholder = '/album-placeholder.svg';

export function getAlbumCoverSource(source) {
  return typeof source === 'string' && source.trim() ? source : albumPlaceholder;
}

export function fallbackAlbumCover(image) {
  if (!image.src.endsWith(albumPlaceholder)) image.src = albumPlaceholder;
}
