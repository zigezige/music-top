import test from 'node:test';
import assert from 'node:assert/strict';
import { getSharedSnapshot } from '../src/services/shares.ts';

test('getSharedSnapshot unwraps a read-only share response', async () => {
  const snapshot = { artistName: '林俊杰', tracks: [], status: 'provisional', createdAt: '2026-10-02T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z' };
  const result = await getSharedSnapshot('share-token', async (url) => ({
    ok: true,
    json: async () => ({ snapshot }),
    requestedUrl: url,
  }));

  assert.equal(result.status, 'ok');
  assert.equal(result.snapshot.artistName, '林俊杰');
});

test('getSharedSnapshot reports expired or unavailable share links', async () => {
  const result = await getSharedSnapshot('missing', async () => ({ ok: false, json: async () => ({}) }));

  assert.equal(result.status, 'unavailable');
  assert.match(result.message, /链接已失效或暂时不可用/);
});
