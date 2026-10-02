import test from 'node:test';
import assert from 'node:assert/strict';

const routePolicy = await import('../src/services/routePolicy.ts').catch(() => null);
const { createRouteGuard } = routePolicy ?? {};

test('waits for persisted state restoration before evaluating the direct route', async () => {
  assert.equal(typeof createRouteGuard, 'function');
  let restored = false;
  const guard = createRouteGuard(async () => {
    await Promise.resolve();
    restored = true;
  }, () => ({ hasCatalog: restored, hasRanking: false }));

  assert.equal(await guard('catalog'), true);
});

test('restored catalog and ranking state keep their current routes', () => {
  assert.ok(routePolicy, 'route policy should be available');
  assert.equal(routePolicy.getRouteRedirect('catalog', { hasCatalog: true }), null);
  assert.equal(routePolicy.getRouteRedirect('ranking', {
    hasCatalog: true,
    hasRanking: true,
    hasCurrentGroup: true,
  }), null);
  assert.equal(routePolicy.getRouteRedirect('results', { hasCatalog: true, hasRanking: true }), null);
});

test('routes without the required restored state redirect to the nearest valid page', () => {
  assert.ok(routePolicy, 'route policy should be available');
  assert.equal(routePolicy.getRouteRedirect('catalog', { hasCatalog: false }), '/');
  assert.equal(routePolicy.getRouteRedirect('ranking', {
    hasCatalog: true,
    hasRanking: false,
    hasCurrentGroup: false,
  }), '/');
  assert.equal(routePolicy.getRouteRedirect('ranking', {
    hasCatalog: true,
    hasRanking: true,
    hasCurrentGroup: false,
  }), '/results');
  assert.equal(routePolicy.getRouteRedirect('paused', { hasCatalog: true, hasRanking: false }), '/');
  assert.equal(routePolicy.getRouteRedirect('share', { hasCatalog: false, hasRanking: false }), null);
});
