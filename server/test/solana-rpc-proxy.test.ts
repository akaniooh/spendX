import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRpcCall, solanaRpcProxyRoute } from '../src/solana-rpc-proxy.ts';

const KEYED = 'https://mainnet.helius-rpc.com/?api-key=SECRET-KEY-123';
const call = (method: string, params: unknown[] = [], id: number | string = 1) => ({ jsonrpc: '2.0', id, method, params });
const req = (body: unknown, ip = '1.2.3.4') => ({ ip, params: {}, body, headers: {} });

function route(fetchImpl: typeof fetch, extra = {}) {
  return solanaRpcProxyRoute({ rpcUrl: KEYED, fetchImpl, ...extra });
}

test('only the read calls the app makes are allowed; everything else is refused', () => {
  for (const m of ['getBalance', 'getAccountInfo', 'getLatestBlockhash', 'getMinimumBalanceForRentExemption']) {
    assert.equal(checkRpcCall(call(m, ['x'])).ok, true, m);
  }
  for (const m of ['sendTransaction', 'getProgramAccounts', 'requestAirdrop', 'getSignaturesForAddress']) {
    const r = checkRpcCall(call(m));
    assert.equal(r.ok, false, m);
    assert.equal((r as { status: number }).status, 403);
  }
  assert.equal(checkRpcCall([call('getBalance', ['x'])]).ok, false, 'batches refused');
  assert.equal(checkRpcCall(null).ok, false);
  assert.equal(checkRpcCall({ ...call('getBalance'), jsonrpc: '1.0' }).ok, false);
  assert.equal(checkRpcCall(call('getBalance', [1, 2, 3, 4, 5])).ok, false, 'too many params');
});

test('token account lookups must name an owner and a mint (no program-wide scans)', () => {
  assert.equal(checkRpcCall(call('getTokenAccountsByOwner', ['owner', { mint: 'M' }, { encoding: 'jsonParsed' }])).ok, true);
  assert.equal(checkRpcCall(call('getTokenAccountsByOwner', ['owner', { programId: 'P' }])).ok, false);
  assert.equal(checkRpcCall(call('getTokenAccountsByOwner', ['owner'])).ok, false);
});

test('allowed calls are forwarded to the keyed endpoint, rebuilt from checked fields only', async () => {
  const seen: { url: string; body: any }[] = [];
  const f = (async (url: string, init: { body: string }) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { value: 42 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await route(f).handler(req({ ...call('getBalance', ['abc'], 7), evil: 'extra', headers: 'x' }));
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { jsonrpc: '2.0', id: 7, result: { value: 42 } });
  assert.equal(seen[0].url, KEYED);
  assert.deepEqual(seen[0].body, { jsonrpc: '2.0', id: 7, method: 'getBalance', params: ['abc'] });
});

test('refused calls never reach the provider', async () => {
  let called = 0;
  const f = (async () => { called++; return new Response('{}'); }) as unknown as typeof fetch;
  const out = await route(f).handler(req(call('sendTransaction', ['tx'])));
  assert.equal(out.status, 403);
  assert.equal(called, 0);
});

test('provider failures give a generic error and never expose the key', async () => {
  const boom = (async () => { throw new Error(`fetch failed for ${KEYED}`); }) as unknown as typeof fetch;
  const bounced = (async () => new Response('forbidden ' + KEYED, { status: 403 })) as unknown as typeof fetch;
  for (const f of [boom, bounced]) {
    const out = await route(f).handler(req(call('getBalance', ['abc'])));
    assert.equal(out.status, 502);
    assert.doesNotMatch(JSON.stringify(out.body), /SECRET-KEY|helius/i);
  }
});

test('rate limit is per client and resets after the window', async () => {
  let t = 0;
  const f = (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 1 }))) as unknown as typeof fetch;
  const r = route(f, { limit: 2, windowMs: 1000, now: () => t });
  assert.equal((await r.handler(req(call('getBalance', ['a'])))).status, 200);
  assert.equal((await r.handler(req(call('getBalance', ['a'])))).status, 200);
  assert.equal((await r.handler(req(call('getBalance', ['a'])))).status, 429);
  assert.equal((await r.handler(req(call('getBalance', ['a']), '9.9.9.9'))).status, 200, 'another client is unaffected');
  t = 1001;
  assert.equal((await r.handler(req(call('getBalance', ['a'])))).status, 200, 'window reset');
});

test('provider failures are logged with the status only, never the key', async () => {
  const lines: string[] = [];
  const bounced = (async () => new Response('bad key ' + KEYED, { status: 401 })) as unknown as typeof fetch;
  const boom = (async () => { throw new Error(`fetch failed ${KEYED}`); }) as unknown as typeof fetch;
  await route(bounced, { log: (m: string) => lines.push(m) }).handler(req(call('getBalance', ['abc'])));
  await route(boom, { log: (m: string) => lines.push(m) }).handler(req(call('getBalance', ['abc'])));
  assert.match(lines[0], /HTTP 401/);
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines.join(' '), /SECRET-KEY|helius/i);
});

test('a refused method is logged by name so a missing allowlist entry is easy to spot', async () => {
  const lines: string[] = [];
  const f = (async () => new Response('{}')) as unknown as typeof fetch;
  await route(f, { log: (m: string) => lines.push(m) }).handler(req(call('getSomethingNew', ['x'])));
  assert.match(lines[0], /refused.*403.*getSomethingNew/);
});
