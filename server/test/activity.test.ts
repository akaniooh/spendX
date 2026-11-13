import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutes } from '../src/api.ts';
import type { ApiResponse } from '../src/api.ts';
import { PaymentService } from '../src/service.ts';
import { MemoryRepository } from '../src/repo-memory.ts';
import type { QuoteRequestBody, QuoteResponse, StatusResponse, Token } from '../../shared/src/types.ts';

const USDC: Token = { assetId: 'nep141:usdc-base', decimals: 6, blockchain: 'base', symbol: 'USDC', contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' };
const SOL: Token = { assetId: 'nep141:sol.omft.near', decimals: 9, blockchain: 'sol', symbol: 'SOL' };
const WALLET = '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4';
const OTHER = '0x1111111111111111111111111111111111111111';
const SOL_ADDR = 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z';
const T0 = Date.parse('2026-11-04T12:00:00Z');

function harness() {
  const clock = T0;
  const repo = new MemoryRepository();
  const client = {
    async quote(b: QuoteRequestBody): Promise<QuoteResponse> {
      return {
        signature: 'sig', quoteRequest: { ...b },
        quote: {
          depositAddress: b.dry ? undefined : 'SWAPDEPOSIT1', amountIn: b.amount, amountInFormatted: '10', amountInUsd: '10',
          minAmountIn: b.amount, amountOut: '1000000000', amountOutFormatted: '1', amountOutUsd: '10',
          minAmountOut: '990000000', deadline: b.deadline, timeEstimate: 25,
        },
      };
    },
    async status(): Promise<StatusResponse> { throw new Error('unused'); },
    async submitDeposit() {},
  };
  const auth = { secret: 'y'.repeat(32), verifiers: { evm: async ({ signature }: { signature: string }) => signature === 'valid' }, now: () => clock };
  const service = new PaymentService({
    repo, client, catalog: { findToken: async (id) => [USDC, SOL].find((t) => t.assetId === id) },
    verifyQuoteSignature: () => true, slippageBps: 100, deadlineMinutes: 10, now: () => clock,
  });
  const routes = buildRoutes({ service, repo, auth, catalog: { get: async () => [USDC, SOL] }, now: () => clock, log: () => {} });
  async function call(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse> {
    for (const r of routes) {
      if (r.method !== method || r.path !== url) continue;
      return r.handler({ params: {}, body, headers });
    }
    throw new Error('no route ' + method + ' ' + url);
  }
  async function login(address: string) {
    const c = (await call('POST', '/api/auth/challenge', { address, family: 'evm' })).body as { challengeToken: string };
    const v = (await call('POST', '/api/auth/verify', { address, family: 'evm', challengeToken: c.challengeToken, signature: 'valid' })).body as { token: string };
    return { authorization: `Bearer ${v.token}` };
  }
  return { call, login };
}

test('activity requires a session', async () => {
  const h = harness();
  assert.equal((await h.call('GET', '/api/activity')).status, 401);
});

test('a wallet sees its own swaps from any device, and nobody else sees them', async () => {
  const h = harness();
  const swap = await h.call('POST', '/api/swaps', { originAssetId: USDC.assetId, destAssetId: SOL.assetId, amount: '10', payerAddress: WALLET, recipient: SOL_ADDR });
  assert.equal(swap.status, 201);

  // "second device": a fresh sign-in with the same wallet, no local history at all
  const mine = await h.call('GET', '/api/activity', undefined, await h.login(WALLET));
  const items = (mine.body as { items: { createdAt: string; attempt: { origin: { symbol: string } }; request: { kind: string } }[] }).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].request.kind, 'swap');
  assert.equal(items[0].attempt.origin.symbol, 'USDC');
  assert.ok(items[0].createdAt);

  // same EVM address in lowercase still matches
  const lower = await h.call('GET', '/api/activity', undefined, await h.login(WALLET.toLowerCase()));
  assert.equal((lower.body as { items: unknown[] }).items.length, 1);

  const other = await h.call('GET', '/api/activity', undefined, await h.login(OTHER));
  assert.equal((other.body as { items: unknown[] }).items.length, 0);
});
