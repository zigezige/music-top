import test from 'node:test';
import assert from 'node:assert/strict';
import { ref } from 'vue';
import { createRankingSession, getNextGroup, getRankingResult } from '@music-rank/ranking';
import { useRankingFlow } from '../src/composables/useRankingFlow.ts';

const artist = { id: 'qqmusic:artist-1', name: '测试歌手', sourceName: '测试歌手', sourceArtistId: 'artist-1' };
const catalog = {
  artist,
  version: 'catalog-v1',
  fetchedAt: '2026-10-03T00:00:00.000Z',
  tracks: [
    { id: 'qqmusic:track-1', title: '第一首', creditedArtists: ['测试歌手'], versionKind: 'studio', sources: ['qqmusic'], outboundLinks: [] },
    { id: 'qqmusic:track-2', title: '第二首', creditedArtists: ['测试歌手'], versionKind: 'studio', sources: ['qqmusic'], outboundLinks: [] },
  ],
};

test('restores the saved catalog, ranking, next group, and result snapshot', () => {
  const ranking = createRankingSession(catalog.tracks.map((track) => track.id), { seed: 7 });
  const options = {
    catalog: ref(null),
    selectedArtist: ref(null),
    rankingSessionId: ref(null),
    activeSessionInfo: ref(null),
    savedSessionExists: ref(false),
    storageWarning: ref(false),
    notice: ref(''),
    navigateTo: () => {},
  };
  const flow = useRankingFlow(options);

  assert.equal(typeof flow.restoreSession, 'function');
  flow.restoreSession({
    id: 'active',
    sessionId: 'session-v1',
    schemaVersion: 1,
    artistId: artist.id,
    catalog,
    includedTrackIds: catalog.tracks.map((track) => track.id),
    ranking,
    paused: false,
    updatedAt: '2026-10-03T00:00:00.000Z',
  });

  assert.deepEqual(options.catalog.value, catalog);
  assert.deepEqual(options.selectedArtist.value, artist);
  assert.equal(options.rankingSessionId.value, 'session-v1');
  assert.deepEqual(flow.currentGroup.value, getNextGroup(ranking));
  assert.deepEqual(flow.rankingResult.value, getRankingResult(ranking));
});
