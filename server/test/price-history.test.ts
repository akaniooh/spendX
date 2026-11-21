import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSeries, PriceHistoryCache, priceHistoryRoute } from '../src/price-history.ts';

const hours = (n: number, start = 1) => Array.from({ length: n }, (_, i) => start + i / 100);
const MARKETS = [
  { symbol: 'eth', sparkline_in_7d: { price: hours(168, 3000) } },
  { symbol: 'usdc', sparkline_in_7d: { price: hours(168, 1) } },
  { symbol: 'usdc', sparkline_in_7d: { price: hours(168, 99) } },   // look-alike with a lower market cap: ignored
  { symbol: 'bad', sparkline_in_7d: { price: [1, 2, NaN, ...hours(30)] } }, // broken series: dropped
  { symbol: 'tiny', sparkline_in_7d: { price: [1, 2, 3] } },        // too short to chart
  { symbol: 'other', sparkline_in_7d: { price: hours(168) } },      // not asked for
];

test('series: first coin per symbol wins; broken, short and unrequested series are dropped', () => {
  const s = pickSeries(MARKETS, ['ETH', 'usdc', 'BAD', 'TINY', 'NONE']);
  assert.deepEqual(Object.keys(s).sort(), ['ETH', 'USDC']);
  assert.equal(s.USDC[0], 1);
  assert.equal(s.ETH.length, 168);
});

function fakeFetch(calls: string[], fail = () => false) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${String(url)}|${JSON.stringify(init?.headers)}`);
    return fail() ? new Response('nope', { status: 429 }) : new Response(JSON.stringify(MARKETS), { status: 200 });
  }) as typeof fetch;
}

test('cache: one request per ttl, key header sent, unknown symbols remembered, failures never throw', async () => {
  const calls: string[] = [];
  let t = 1_000_000; let failing = false;
  const c = new PriceHistoryCache({ fetchFn: fakeFetch(calls, () => failing), apiKey: 'K', ttlMs: 1000, minGapMs: 100, now: () => t, log: () => {} });
  const a = await c.get(['eth', 'NONE']);
  assert.deepEqual(Object.keys(a), ['ETH']);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('x-cg-demo-api-key') && calls[0].includes('symbols=eth%2Cnone') && calls[0].includes('sparkline=true'));
  await c.get(['ETH', 'none']);
  assert.equal(calls.length, 1); // fresh, and the unknown symbol is not asked about again
  t += 5000; failing = true;
  const stale = await c.get(['ETH']);
  assert.deepEqual(Object.keys(stale), ['ETH']); // refresh failed: the cached series is still served
  assert.equal(calls.length, 2);
  await c.get(['ETH']);
  assert.equal(calls.length, 2); // backing off after the failure
});

test('cache: requests to CoinGecko are spaced out however many different symbols arrive', async () => {
  const calls: string[] = [];
  const c = new PriceHistoryCache({ fetchFn: fakeFetch(calls), minGapMs: 10_000, now: () => 1000, log: () => {} });
  await c.get(['AAA']); await c.get(['BBB']); await c.get(['CCC']);
  assert.equal(calls.length, 1);
});

test('route: validates symbols and returns the series', async () => {
  const route = priceHistoryRoute(new PriceHistoryCache({ fetchFn: fakeFetch([]), log: () => {} }));
  const call = (body: unknown) => route.handler({ params: {}, body, headers: {} });
  assert.equal((await call({})).status, 400);
  assert.equal((await call({ symbols: [] })).status, 400);
  assert.equal((await call({ symbols: ['ok', 'no spaces'] })).status, 400);
  assert.equal((await call({ symbols: Array.from({ length: 61 }, (_, i) => `S${i}`) })).status, 400);
  const ok = await call({ symbols: ['ETH'] });
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys((ok.body as { series: object }).series), ['ETH']);
});
