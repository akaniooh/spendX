import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRates, RatesCache, ratesRoute } from '../src/rates.ts';

// CoinGecko quotes everything in BTC: 1 BTC = 100,000 USD = 12,900,000 KES = 92,000 EUR
const DATA = { rates: {
  btc: { value: 1, type: 'crypto' }, usd: { value: 100_000, type: 'fiat' }, kes: { value: 12_900_000, type: 'fiat' },
  eur: { value: 92_000, type: 'fiat' }, eth: { value: 30, type: 'crypto' }, jpy: { value: 'x', type: 'fiat' },
} };

test('rates: USD to X is X divided by USD; crypto, broken and missing codes are left out', () => {
  const r = pickRates(DATA, ['USD', 'KES', 'EUR', 'ETH', 'JPY', 'NGN']);
  assert.deepEqual(r, { USD: 1, KES: 129, EUR: 0.92 });
  assert.deepEqual(pickRates({}), {});
  assert.deepEqual(pickRates({ rates: { usd: { value: 0, type: 'fiat' } } }), {});
});

test('cache: one request per ttl, never throws, keeps the last good rates and backs off', async () => {
  let calls = 0; let fail = false; let t = 1_000_000;
  const fetchFn = (async () => { calls++; return fail ? new Response('no', { status: 429 }) : new Response(JSON.stringify(DATA), { status: 200 }); }) as typeof fetch;
  const c = new RatesCache({ fetchFn, ttlMs: 1000, retryMs: 500, now: () => t, log: () => {} });
  assert.equal((await c.get()).KES, 129);
  await c.get(); assert.equal(calls, 1);
  t += 2000; fail = true;
  assert.equal((await c.get()).KES, 129); // stale rates still served while the refresh fails
  await new Promise((r) => setTimeout(r, 10));
  const n = calls; await c.get(); assert.equal(calls, n); // backing off
  assert.deepEqual(await new RatesCache({ fetchFn: (async () => new Response('x', { status: 500 })) as typeof fetch, now: () => 1, log: () => {} }).get(), {});
});

test('route: returns the rates', async () => {
  const route = ratesRoute({ get: async () => ({ USD: 1 }) });
  assert.deepEqual(await route.handler({ params: {}, body: null, headers: {} }), { status: 200, body: { rates: { USD: 1 } } });
});
