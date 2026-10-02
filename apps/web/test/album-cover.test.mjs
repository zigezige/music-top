import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackAlbumCover, getAlbumCoverSource } from '../src/media.mjs';

test('missing cover metadata uses the local album placeholder', () => {
  assert.equal(getAlbumCoverSource(undefined), '/album-placeholder.svg');
  assert.equal(getAlbumCoverSource('  '), '/album-placeholder.svg');
});

test('a failed remote cover falls back once to the local album placeholder', () => {
  const image = { src: 'https://coverartarchive.org/release/1/front-250' };

  fallbackAlbumCover(image);
  assert.equal(image.src, '/album-placeholder.svg');

  fallbackAlbumCover(image);
  assert.equal(image.src, '/album-placeholder.svg');
});
