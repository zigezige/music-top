import test from 'node:test';
import assert from 'node:assert/strict';
import { getArtistCatalog, searchArtists } from '../src/services/catalog.ts';

test('searchArtists reports QQ catalog unavailability when the API request fails', async () => {
  const result = await searchArtists('林俊杰', {
    fetchImpl: async () => { throw new Error('offline'); },
  });

  assert.equal(result.source, 'unavailable');
  assert.deepEqual(result.items, []);
  assert.match(result.message, /暂时无法连接曲库/);
});

test('getArtistCatalog reports QQ catalog unavailability when the API request fails', async () => {
  const result = await getArtistCatalog({
    id: 'qqmusic:artist-1',
    name: '林俊杰',
    sourceName: '林俊杰',
    sourceArtistId: 'artist-1',
  }, {
    fetchImpl: async () => { throw new Error('offline'); },
  });

  assert.equal(result.source, 'unavailable');
  assert.deepEqual(result.items, []);
  assert.match(result.message, /暂时无法加载该歌手的曲库/);
});

test('searchArtists uses the API response when available', async () => {
  const result = await searchArtists('林俊杰', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ items: [{ id: 'artist-1', name: '林俊杰', sourceName: '授权曲库', sourceArtistId: 's1' }] }),
    }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.items[0].sourceName, '授权曲库');
});

test('searchArtists reads the artists envelope returned by the API', async () => {
  const result = await searchArtists('林俊杰', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ artists: [{ id: 'artist-1', name: '林俊杰', sourceName: '授权曲库', sourceArtistId: 's1' }] }),
    }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.items.length, 1);
});

test('searchArtists keeps QQ Music API candidates as API results', async () => {
  const result = await searchArtists('林俊杰', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ artists: [{ id: 'qqmusic:artist-1', name: '林俊杰', sourceName: '林俊杰', sourceArtistId: 'qq-artist-1', disambiguation: 'QQ 音乐' }] }),
    }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.items[0].id, 'qqmusic:artist-1');
});
