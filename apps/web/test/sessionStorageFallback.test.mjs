import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

const { withStorageFallback } = await import('../src/services/sessionStore.ts');

test('falls back to local storage when the primary store is unavailable', async () => {
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };

  globalThis.localStorage = storage;
  try {
    const result = await withStorageFallback(
      async () => { throw new Error('IndexedDB unavailable'); },
      (fallbackStorage) => {
        fallbackStorage.setItem('catalog', JSON.stringify({ restored: true }));
        return JSON.parse(fallbackStorage.getItem('catalog'));
      },
    );

    assert.deepEqual(result, { restored: true });
  } finally {
    globalThis.localStorage = originalStorage;
  }
});
