import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneClickClient, OneClickError, buildExactInputQuote, buildExactOutputQuote } from '../src/oneclick.ts';
import { CatalogCache, groupByChain } from '../src/catalog.ts';
import type { Token } from '../../shared/src/types.ts';

function stubFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const r = handler(String(url), init ?? {});
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
}

test('client sends documented endpoints, API key header, and JSON body', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const client = new OneClickClient({
    apiKey: 'k',
    fetchImpl: stubFetch((url, init) => {
      seen.push({ url, init });
      return { body: url.includes('/v0/tokens') ? [] : {} };
    }),
  });
  await client.getTokens();
  await client.status('addr1', 'memo1');
  await client.submitDeposit({ depositAddress: 'addr1', txHash: '0xabc' });
  assert.equal(seen[0].url, 'https://1click.chaindefuser.com/v0/tokens');
  assert.equal(seen[1].url, 'https://1click.chaindefuser.com/v0/status?depositAddress=addr1&depositMemo=memo1');
  assert.equal(seen[2].url, 'https://1click.chaindefuser.com/v0/deposit/submit');
  assert.equal(seen[2].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(seen[2].init.body)), { depositAddress: 'addr1', txHash: '0xabc' });
  assert.equal((seen[0].init.headers as Record<string, string>)['X-API-Key'], 'k');
});

test('no API key header when none configured; API errors surface the message', async () => {
  let headers: Record<string, string> = {};
  const client = new OneClickClient({
    fetchImpl: stubFetch((_u, init) => {
      headers = init.headers as Record<string, string>;
      return { status: 400, body: { message: 'no route' } };
    }),
  });
  await assert.rejects(client.getTokens(), (e: unknown) => e instanceof OneClickError && e.status === 400 && e.message === 'no route');
  assert.equal('X-API-Key' in headers, false);
});

test('quote builder always produces pay-exact-output, origin-chain deposit, destination-chain delivery', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const b = buildExactOutputQuote({
    dry: true, originAssetId: 'o', destAssetId: 'd', amountOut: 80_000_000n,
    recipient: 'r', refundTo: 'f', slippageBps: 100, deadlineMinutes: 10, now,
  });
  assert.equal(b.swapType, 'EXACT_OUTPUT');
  assert.equal(b.depositType, 'ORIGIN_CHAIN');
  assert.equal(b.recipientType, 'DESTINATION_CHAIN');
  assert.equal(b.refundType, 'ORIGIN_CHAIN');
  assert.equal(b.amount, '80000000');
  assert.equal(b.deadline, '2026-11-04T12:10:00.000Z');
  assert.equal('depositMode' in b, false);
});

test('catalog groups dynamically and caches', async () => {
  const tokens: Token[] = [
    { assetId: 'a2', decimals: 6, blockchain: 'base', symbol: 'USDC' },
    { assetId: 'a1', decimals: 5, blockchain: 'sol', symbol: 'BONK' },
    { assetId: 'a3', decimals: 8, blockchain: 'newchain', symbol: 'ZZZ' },
  ];
  let calls = 0;
  const cache = new CatalogCache({ getTokens: async () => { calls++; return tokens; } }, 1000);
  const [a, b] = await Promise.all([cache.get(0), cache.get(0)]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  await cache.get(500);
  assert.equal(calls, 1);
  const groups = groupByChain(tokens);
  assert.deepEqual(groups.map((g) => [g.blockchain, g.family]), [['base', 'evm'], ['newchain', 'other'], ['sol', 'svm']]);
  assert.equal((await cache.findToken('a1'))?.symbol, 'BONK');
});

test('exact-input quote sends the SOURCE amount; everything else stays origin-chain deposit to destination-chain delivery', () => {
  const b = buildExactInputQuote({
    dry: true, originAssetId: 'o', destAssetId: 'd', amountIn: 10_000_000_000n,
    recipient: 'r', refundTo: 'f', slippageBps: 300, deadlineMinutes: 10, now: new Date('2026-11-06T12:00:00Z'),
  });
  assert.equal(b.swapType, 'EXACT_INPUT');
  assert.equal(b.amount, '10000000000');
  assert.equal(b.slippageTolerance, 300);
  assert.equal(b.depositType, 'ORIGIN_CHAIN');
  assert.equal(b.recipientType, 'DESTINATION_CHAIN');
  assert.equal(b.refundType, 'ORIGIN_CHAIN');
  assert.equal(b.dry, true);
});
