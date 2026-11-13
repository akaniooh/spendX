import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutes } from '../src/api.ts';
import type { ApiResponse } from '../src/api.ts';
import { PaymentService } from '../src/service.ts';
import { MemoryRepository } from '../src/repo-memory.ts';
import { OneClickError } from '../src/oneclick.ts';
import type { QuoteRequestBody, QuoteResponse, StatusResponse, Token } from '../../shared/src/types.ts';

const USDC: Token = { assetId: 'nep141:usdc-base', decimals: 6, blockchain: 'base', symbol: 'USDC', contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' };
const SOL: Token = { assetId: 'nep141:sol.omft.near', decimals: 9, blockchain: 'sol', symbol: 'SOL' };
const USDT1: Token = { assetId: 'nep141:usdt.tether-token.near', decimals: 6, blockchain: 'near', symbol: 'USDT' };
const USDT2: Token = { assetId: 'nep141:miden-0x5cb7.omft.near', decimals: 6, blockchain: 'near', symbol: 'USDT' };
const TOKENS = [USDC, SOL, USDT1, USDT2];
const MERCHANT = '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4';
const PAYER = 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z';
const T0 = Date.parse('2026-11-04T12:00:00Z');

function harness() {
  let clock = T0;
  let st: StatusResponse | 'notfound' = 'notfound';
  const repo = new MemoryRepository();
  const client = {
    async quote(b: QuoteRequestBody): Promise<QuoteResponse> {
      return {
        signature: 'sig', quoteRequest: { ...b },
        quote: { depositAddress: b.dry ? undefined : 'DEPOSIT1', amountIn: '10707496', amountInFormatted: '0.0107', amountInUsd: '1.016', minAmountIn: '10600421', amountOut: b.amount, amountOutFormatted: '1', amountOutUsd: '0.9996', minAmountOut: b.amount, deadline: b.deadline, timeEstimate: 22 },
      };
    },
    async status(): Promise<StatusResponse> { if (st === 'notfound') throw new OneClickError(404, 'nf', {}); return st; },
    async submitDeposit() {},
  };
  const auth = { secret: 'y'.repeat(32), verifiers: { evm: async ({ signature }: { signature: string }) => signature === 'valid' }, now: () => clock };
  const service = new PaymentService({
    repo, client, catalog: { findToken: async (id) => TOKENS.find((t) => t.assetId === id) },
    verifyQuoteSignature: () => true, slippageBps: 100, deadlineMinutes: 10, now: () => clock,
  });
  const routes = buildRoutes({ service, repo, auth, catalog: { get: async () => TOKENS }, now: () => clock, log: () => {} });
  async function call(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse> {
    for (const r of routes) {
      if (r.method !== method) continue;
      const names: string[] = [];
      const re = new RegExp('^' + r.path.replace(/:([a-z]+)/g, (_m, n) => { names.push(n); return '([^/]+)'; }) + '$');
      const m = re.exec(url);
      if (m) return r.handler({ params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])), body, headers });
    }
    throw new Error('no route ' + method + ' ' + url);
  }
  async function login() {
    const c = (await call('POST', '/api/auth/challenge', { address: MERCHANT, family: 'evm' })).body as { challengeToken: string };
    const v = (await call('POST', '/api/auth/verify', { address: MERCHANT, family: 'evm', challengeToken: c.challengeToken, signature: 'valid' })).body as { token: string };
    return { authorization: `Bearer ${v.token}` };
  }
  return { call, login, setStatus: (s: StatusResponse | 'notfound') => { st = s; }, advance: (ms: number) => { clock += ms; } };
}

test('catalog is dynamic and flags look-alike symbols', async () => {
  const h = harness();
  const r = (await h.call('GET', '/api/catalog')).body as { chains: { blockchain: string; family: string; tokens: { assetId: string; duplicateSymbol: boolean }[] }[] };
  assert.deepEqual(r.chains.map((c) => [c.blockchain, c.family]), [['base', 'evm'], ['near', 'near'], ['sol', 'svm']]);
  const near = r.chains.find((c) => c.blockchain === 'near')!;
  assert.ok(near.tokens.every((t) => t.duplicateSymbol));
  assert.equal(r.chains.find((c) => c.blockchain === 'base')!.tokens[0].duplicateSymbol, false);
});

test('merchant endpoints require a valid session', async () => {
  const h = harness();
  const body = { destAssetId: USDC.assetId, amount: '1', recipient: MERCHANT };
  assert.equal((await h.call('POST', '/api/merchant/requests', body)).status, 401);
  assert.equal((await h.call('GET', '/api/merchant/requests')).status, 401);
  assert.equal((await h.call('POST', '/api/merchant/requests', body, { authorization: 'Bearer fake.token' })).status, 401);
  const bad = await h.call('POST', '/api/auth/verify', { address: MERCHANT, family: 'evm', challengeToken: 'x.y', signature: 'valid' });
  assert.equal(bad.status, 401);
  assert.equal((await h.call('POST', '/api/auth/challenge', { address: 'alice.near', family: 'near' })).status, 400);
});

test('full payment journey through the API', async () => {
  const h = harness();
  const auth = await h.login();

  const created = await h.call('POST', '/api/merchant/requests', { destAssetId: USDC.assetId, amount: '1', recipient: MERCHANT, description: 'Order 42' }, auth);
  assert.equal(created.status, 201);
  const req = created.body as { slug: string; destination: { amountFormatted: string; amount: string }; merchantAddress: string };
  assert.equal(req.destination.amountFormatted, '1');
  assert.equal(req.destination.amount, '1000000');
  assert.equal(req.merchantAddress, MERCHANT);

  const pub = await h.call('GET', `/api/requests/${req.slug}`);
  assert.equal((pub.body as { status: string }).status, 'open');
  assert.equal((await h.call('GET', '/api/requests/doesnotexist')).status, 404);

  const prev = await h.call('POST', `/api/requests/${req.slug}/preview`, { originAssetId: SOL.assetId, payerAddress: PAYER });
  assert.equal(prev.status, 200);
  assert.equal((prev.body as { amountInFormatted: string }).amountInFormatted, '0.0107');

  const att = await h.call('POST', `/api/requests/${req.slug}/attempts`, { originAssetId: SOL.assetId, payerAddress: PAYER });
  assert.equal(att.status, 201);
  const a = att.body as { id: string; state: string; deposit: { address: string; amountFormatted: string } };
  assert.equal(a.state, 'awaiting_payment');
  assert.equal(a.deposit.address, 'DEPOSIT1');
  assert.equal(a.deposit.amountFormatted, '0.010707496');
  assert.ok(!JSON.stringify(att.body).includes('"quote"'), 'raw quote must not leak to clients');

  assert.equal(((await h.call('POST', `/api/attempts/${a.id}/signing`)).body as { state: string }).state, 'payment_initiated');
  const dep = await h.call('POST', `/api/attempts/${a.id}/deposit`, { txHash: 'aDpHeJ9rfEAAU39xrkfwjWE9NvxzYaygaDpHeJ9rfEAAU39xrkfwjWE9NvxzYaygaDpHeJ9rfEAAU39xrkfwjWE9', explorerUrl: 'https://solscan.io/tx/aDpHeJ9rfEAAU39xrkfwjWE9NvxzYaygaDpHeJ9rfEAAU39xrkfwjWE9NvxzYaygaDpHeJ9rfEAAU39xrkfwjWE9' });
  assert.equal((dep.body as { state: string }).state, 'source_submitted');

  h.setStatus({ status: 'PROCESSING', updatedAt: 'x', swapDetails: { intentHashes: ['i1'], nearTxHashes: ['n1'], originChainTxHashes: [], destinationChainTxHashes: [] } });
  h.advance(3000);
  const proc = (await h.call('GET', `/api/attempts/${a.id}`)).body as { attempt: { state: string; delivery: unknown } };
  assert.equal(proc.attempt.state, 'processing');
  assert.equal(proc.attempt.delivery, null);

  h.setStatus({ status: 'SUCCESS', updatedAt: 'x', swapDetails: { intentHashes: ['i1'], nearTxHashes: ['n1'], originChainTxHashes: [], destinationChainTxHashes: [{ hash: '0xdest0000001', explorerUrl: 'https://basescan.org/tx/0xdest0000001' }] } });
  h.advance(3000);
  const done = (await h.call('GET', `/api/attempts/${a.id}`)).body as { attempt: { state: string; delivery: string; destination: { txs: unknown[] }; near: { intentHashes: string[] } }; request: { status: string } };
  assert.equal(done.attempt.state, 'destination_confirmed');
  assert.equal(done.attempt.delivery, 'reported', 'no verifier is configured in this test, so delivery is labelled reported, never verified');
  assert.equal(done.attempt.destination.txs.length, 1);
  assert.deepEqual(done.attempt.near.intentHashes, ['i1']);
  assert.equal(done.request.status, 'paid');

  // a paid request cannot be paid again
  const again = await h.call('POST', `/api/requests/${req.slug}/attempts`, { originAssetId: SOL.assetId, payerAddress: PAYER });
  assert.equal(again.status, 409);

  // dashboard
  const dash = (await h.call('GET', '/api/merchant/requests', undefined, auth)).body as { stats: { total: number; paid: number; pending: number }; requests: { latestAttempt: { state: string } }[] };
  assert.deepEqual(dash.stats, { total: 1, paid: 1, pending: 0 });
  assert.equal(dash.requests[0].latestAttempt.state, 'destination_confirmed');
});

test('a merchant only sees their own requests', async () => {
  const h = harness();
  const auth = await h.login();
  await h.call('POST', '/api/merchant/requests', { destAssetId: USDC.assetId, amount: '1', recipient: MERCHANT }, auth);
  // a second merchant (different address, same fake verifier) signs in
  const other = '0x1111111111111111111111111111111111111111';
  const c = (await h.call('POST', '/api/auth/challenge', { address: other, family: 'evm' })).body as { challengeToken: string };
  const v = (await h.call('POST', '/api/auth/verify', { address: other, family: 'evm', challengeToken: c.challengeToken, signature: 'valid' })).body as { token: string };
  const dash = (await h.call('GET', '/api/merchant/requests', undefined, { authorization: `Bearer ${v.token}` })).body as { stats: { total: number } };
  assert.equal(dash.stats.total, 0);
});

test('input validation and error mapping', async () => {
  const h = harness();
  const auth = await h.login();
  const mk = (b: unknown) => h.call('POST', '/api/merchant/requests', b, auth);
  assert.equal((await mk({ destAssetId: USDC.assetId, amount: '1' })).status, 400); // missing recipient
  assert.equal((await mk({ destAssetId: USDC.assetId, amount: '-5', recipient: MERCHANT })).status, 400);
  assert.equal((await mk({ destAssetId: USDC.assetId, amount: '1', recipient: 'nope' })).status, 400);
  assert.equal((await mk('not an object')).status, 400);
  assert.equal((await mk({ destAssetId: 123, amount: '1', recipient: MERCHANT })).status, 400);
  const err = (await mk({ destAssetId: USDC.assetId, amount: '1', recipient: 'nope' })).body as { error: { code: string } };
  assert.equal(err.error.code, 'invalid_recipient');
  assert.equal((await h.call('GET', '/api/attempts/missing')).status, 404);
});
