import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIconMaps, pickForCatalog, IconCache, iconsRoute } from '../src/icons.ts';

const MARKETS = [
  { id: 'bitcoin', symbol: 'btc', image: 'https://img.test/btc.png' },
  { id: 'usd-coin', symbol: 'usdc', image: 'https://img.test/usdc.png' },
  { id: 'fake-usdc', symbol: 'usdc', image: 'https://img.test/fake-usdc.png' }, // look-alike with a lower market cap
  { id: 'dogecoin', symbol: 'doge', image: 'http://img.test/insecure.png' }, // not https: ignored
  { id: 'solana', symbol: 'sol', image: 'https://img.test/sol-coin.png' },
];
const PLATFORMS = [
  { id: 'solana', image: { large: 'https://img.test/solana-chain.png' } },
  { id: 'base', image: { large: null, small: 'https://img.test/base-small.png' } },
];

test('token icons: first coin per symbol wins, non-https urls are dropped', () => {
  const m = buildIconMaps(MARKETS, PLATFORMS);
  assert.equal(m.tokens.USDC, 'https://img.test/usdc.png');
  assert.equal(m.tokens.BTC, 'https://img.test/btc.png');
  assert.equal(m.tokens.DOGE, undefined);
});

test('chain icons: platform image first, then the native coin, else nothing', () => {
  const m = buildIconMaps(MARKETS, PLATFORMS);
  assert.equal(m.chains.sol, 'https://img.test/solana-chain.png');
  assert.equal(m.chains.base, 'https://img.test/base-small.png');
  assert.equal(m.chains.btc, 'https://img.test/btc.png');
  assert.equal(m.chains.doge, undefined);
  assert.equal(m.chains.miden, undefined);
});

test('pickForCatalog only keeps chains and symbols that are in the catalog', () => {
  const m = buildIconMaps(MARKETS, PLATFORMS);
  const out = pickForCatalog(m, [{ blockchain: 'sol', symbol: 'sol' }, { blockchain: 'base', symbol: 'USDC' }]);
  assert.deepEqual(Object.keys(out.chains).sort(), ['base', 'sol']);
  assert.deepEqual(Object.keys(out.tokens).sort(), ['SOL', 'USDC']);
});

function fakeFetch(calls: string[], fail = () => false) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${u}|${JSON.stringify(init?.headers)}`);
    if (fail()) return new Response('nope', { status: 429 });
    const body = u.includes('/asset_platforms') ? PLATFORMS : u.includes('page=1') ? MARKETS : [];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

test('cache: one refresh per ttl, key header is sent, failures keep the old icons and never throw', async () => {
  const calls: string[] = [];
  let t = 1_000_000; let failing = false;
  const c = new IconCache({ fetchFn: fakeFetch(calls, () => failing), apiKey: 'K', pages: 2, ttlMs: 1000, retryMs: 500, now: () => t, log: () => {} });
  const first = await c.get();
  assert.equal(first.tokens.BTC, 'https://img.test/btc.png');
  assert.equal(calls.length, 3); // 2 market pages + platforms
  assert.ok(calls[0].includes('x-cg-demo-api-key'));
  await c.get();
  assert.equal(calls.length, 3); // still fresh
  t += 2000; failing = true;
  const stale = await c.get(); // expired: serves old icons while the refresh fails in the background
  assert.equal(stale.tokens.BTC, 'https://img.test/btc.png');
  await new Promise((r) => setTimeout(r, 10));
  const before = calls.length;
  await c.get();
  assert.equal(calls.length, before); // waits retryMs before trying again
});

test('cache: a first load that fails returns empty maps instead of an error', async () => {
  const c = new IconCache({ fetchFn: fakeFetch([], () => true), now: () => 5, log: () => {} });
  assert.deepEqual(await c.get(), { chains: {}, tokens: {} });
});

test('route: serves catalog-filtered maps', async () => {
  const c = new IconCache({ fetchFn: fakeFetch([]), pages: 1, log: () => {} });
  const r = iconsRoute(c, { get: async () => [{ assetId: 'a', decimals: 9, blockchain: 'sol', symbol: 'SOL' }] });
  const out = await r.handler({ params: {}, body: undefined, headers: {} });
  assert.equal(out.status, 200);
  assert.deepEqual(Object.keys((out.body as { tokens: object }).tokens), ['SOL']);
});
