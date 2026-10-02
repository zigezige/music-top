import test from 'node:test';
import assert from 'node:assert/strict';
import { extendCalibrationBudget, getRankingIdentity, hasSpentCalibrationBudget, shouldConfirmSessionReplacement } from '../src/services/sessionPolicy.ts';

test('ranking identity changes with artist, catalog, or comparison snapshot', () => {
  const session = { trackIds: ['a', 'b'], choices: [{ id: 'c1', candidateTrackIds: ['a', 'b'], selectedTrackId: 'a', kind: 'choice', roundKind: 'coverage' }] };
  const key = getRankingIdentity('artist-1', 'catalog-1', session, 'session-1');

  assert.equal(getRankingIdentity('artist-1', 'catalog-1', session, 'session-1'), key);
  assert.notEqual(getRankingIdentity('artist-1', 'catalog-1', session, 'session-2'), key);
  assert.notEqual(getRankingIdentity('artist-2', 'catalog-1', session, 'session-1'), key);
  assert.notEqual(getRankingIdentity('artist-1', 'catalog-2', session, 'session-1'), key);
  assert.notEqual(getRankingIdentity('artist-1', 'catalog-1', { ...session, choices: [] }, 'session-1'), key);
});

test('replacement confirmation is required only for another artist while a ranking is unfinished', () => {
  assert.equal(shouldConfirmSessionReplacement({ artistId: 'artist-1', completion: 'in_progress' }, 'artist-2'), true);
  assert.equal(shouldConfirmSessionReplacement({ artistId: 'artist-1', completion: 'ended_early' }, 'artist-2'), true);
  assert.equal(shouldConfirmSessionReplacement({ artistId: 'artist-1', completion: 'in_progress' }, 'artist-1'), false);
  assert.equal(shouldConfirmSessionReplacement({ artistId: 'artist-1', completion: 'completed' }, 'artist-2'), false);
  assert.equal(shouldConfirmSessionReplacement(null, 'artist-2'), false);
});

test('skipped rounds do not spend calibration budget and an explicit extension adds rounds', () => {
  const session = {
    trackIds: ['a', 'b'],
    options: { calibrationBudget: 1 },
    choices: [
      { candidateTrackIds: ['a', 'b'], selectedTrackId: null, kind: 'skip', roundKind: 'calibration' },
      { candidateTrackIds: ['a', 'b'], selectedTrackId: 'a', kind: 'choice', roundKind: 'calibration' },
    ],
  };

  assert.equal(hasSpentCalibrationBudget(session), true);
  assert.equal(extendCalibrationBudget(session, 20).options.calibrationBudget, 21);
  assert.equal(hasSpentCalibrationBudget({ ...session, choices: [session.choices[0]] }), false);
});
