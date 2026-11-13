import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentService } from '../src/service.ts';
import { MemoryRepository } from '../src/repo-memory.ts';
import { OneClickError } from '../src/oneclick.ts';
import { SpendXError } from '../src/domain.ts';
import { buildRoutes } from '../src/api.ts';
import type { ApiResponse } from '../src/api.ts';
import { validateLiveQuote } from '../../shared/src/quote-validation.ts';
import type { QuoteRequestBody, QuoteResponse, StatusResponse, Token } from '../../shared/src/types.ts';
import type { DestinationVerifier } from '../../shared/src/adapters.ts';

const SOL: Token = { assetId: 'nep141:sol.omft.near', decimals: 9, blockchain: 'sol', symbol: 'SOL' };
const USDC: Token = { assetId: 'nep141:usdc-base', decimals: 6, blockchain: 'base', symbol: 'USDC', contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' };
const BTC: Token = { assetId: 'nep141:btc', decimals: 8, blockchain: 'btc', symbol: 'BTC' };
const PAYER = 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z';
const ME_EVM = '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4';
const T0 = Date.parse('2026-11-06T12:00:00Z');

function setup(o: { mutate?: (q: QuoteResponse) => void; sigOk?: boolean; noRoute?: boolean; status?: () => StatusResponse | 'nf'; verifier?: DestinationVerifier } = {}) {
  let clock = T0;
  const repo = new MemoryRepository();
  const quotes: QuoteRequestBody[] = [];
  const client = {
    async quote(b: QuoteRequestBody): Promise<QuoteResponse> {
      quotes.push(b);
      if (o.noRoute) throw new OneClickError(400, 'no route', {});
      const q: QuoteResponse = {
        signature: 'sig', quoteRequest: { ...b },
        quote: {
          depositAddress: b.dry ? undefined : 'SWAPDEPOSIT1', amountIn: b.amount, amountInFormatted: '10', amountInUsd: '1500',
          minAmountIn: b.amount, amountOut: '1480000000', amountOutFormatted: '1480', amountOutUsd: '1480',
          minAmountOut: '1465200000', deadline: b.deadline, timeEstimate: 25, refundFee: '5',
        },
      };
      o.mutate?.(q);
      return q;
    },
    async status(): Promise<StatusResponse> { const s = o.status?.() ?? 'nf'; if (s === 'nf') throw new OneClickError(404, 'nf', {}); return s; },
    async submitDeposit() {},
  };
  const svc = new PaymentService({
    repo, client, catalog: { findToken: async (id) => [SOL, USDC, BTC].find((t) => t.assetId === id) },
    verifyQuoteSignature: () => o.sigOk ?? true, verifiers: o.verifier ? { evm: o.verifier } : {},
    slippageBps: 100, deadlineMinutes: 10, now: () => clock,
  });
  return { svc, repo, quotes, advance: (ms: number) => { clock += ms; } };
}
const input = (over: Record<string, unknown> = {}) => ({ originAssetId: SOL.assetId, destAssetId: USDC.assetId, amountHuman: '10', payerAddress: PAYER, recipient: ME_EVM, ...over });

test('preview sends an exact-input dry quote and reports estimate, guaranteed minimum and cost', async () => {
  const { svc, quotes } = setup();
  const p = await svc.previewSwap(input());
  assert.equal(quotes[0].swapType, 'EXACT_INPUT');
  assert.equal(quotes[0].dry, true);
  assert.equal(quotes[0].amount, '10000000000'); // 10 SOL in lamports
  assert.equal(quotes[0].slippageTolerance, 100);
  assert.equal(p.estimatedOutFormatted, '1480');
  assert.equal(p.minOutFormatted, '1465.2');
  assert.equal(p.estimatedCostUsd, 20);
});

test('input validation: same token, bad amount, wrong-chain addresses, slippage bounds, unchecked chains', async () => {
  const { svc } = setup();
  await assert.rejects(svc.previewSwap(input({ destAssetId: SOL.assetId })), { code: 'invalid_swap' });
  await assert.rejects(svc.previewSwap(input({ amountHuman: '0' })), { code: 'invalid_amount' });
  await assert.rejects(svc.previewSwap(input({ amountHuman: '0.0000000001' })), { code: 'invalid_amount' });
  await assert.rejects(svc.previewSwap(input({ payerAddress: ME_EVM })), { code: 'invalid_payer' });
  await assert.rejects(svc.previewSwap(input({ recipient: PAYER })), { code: 'invalid_recipient' });
  await assert.rejects(svc.previewSwap(input({ slippageBps: 9 })), { code: 'invalid_slippage' });
  await assert.rejects(svc.previewSwap(input({ slippageBps: 501 })), { code: 'invalid_slippage' });
  await assert.rejects(svc.previewSwap(input({ originAssetId: 'nope' })), { code: 'unknown_asset' });
  await assert.rejects(svc.previewSwap(input({ destAssetId: BTC.assetId, recipient: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080' })), { code: 'unchecked_recipient' });
  await svc.previewSwap(input({ destAssetId: BTC.assetId, recipient: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', acknowledgeUncheckedAddress: true }));
});

test('no route gives a clear error and stores nothing', async () => {
  const { svc, repo } = setup({ noRoute: true });
  await assert.rejects(svc.previewSwap(input()), { code: 'route_unavailable' });
  await assert.rejects(svc.createSwap(input()), { code: 'route_unavailable' });
  assert.equal(repo.requests.size, 0);
});

test('createSwap validates the live quote against what the user typed; any deviation stores nothing', async () => {
  const cases: Array<[string, Parameters<typeof setup>[0]]> = [
    ['bad signature', { sigOk: false }],
    ['recipient swapped', { mutate: (q) => { q.quoteRequest.recipient = '0x0000000000000000000000000000000000000001'; } }],
    ['quote wants a different source amount', { mutate: (q) => { q.quote.amountIn = '20000000000'; } }],
    ['request amount differs', { mutate: (q) => { q.quoteRequest.amount = '1'; } }],
    ['no guaranteed output', { mutate: (q) => { q.quote.minAmountOut = '0'; } }],
    ['destination asset swapped', { mutate: (q) => { q.quoteRequest.destinationAsset = 'nep141:other'; } }],
    ['refund address swapped', { mutate: (q) => { q.quoteRequest.refundTo = 'someone-else'; } }],
    ['wrong swap type', { mutate: (q) => { q.quoteRequest.swapType = 'EXACT_OUTPUT'; } }],
  ];
  for (const [name, o] of cases) {
    const { svc, repo } = setup(o);
    await assert.rejects(svc.createSwap(input()), (e: unknown) => e instanceof SpendXError, name);
    assert.equal(repo.requests.size, 0, name);
    assert.equal(repo.attempts.size, 0, name);
  }
});

test('createSwap stores a swap-kind request at the guaranteed minimum, plus an attempt with the exact input', async () => {
  const { svc, repo } = setup();
  const { request, attempt } = await svc.createSwap(input());
  assert.equal(request.kind, 'swap');
  assert.equal(request.amount, 1_465_200_000n); // the floor, not the estimate
  assert.equal(request.merchantAddress, PAYER);
  assert.equal(request.recipient, ME_EVM);
  assert.equal(attempt.amountIn, 10_000_000_000n);
  assert.equal(attempt.depositAddress, 'SWAPDEPOSIT1');
  assert.equal(attempt.state, 'awaiting_payment');
  assert.equal(repo.requests.size, 1);
});

test('the swap goes through the shared deposit, tracking and verification pipeline; verification uses the minimum', async () => {
  let seen: bigint | undefined;
  let st: StatusResponse | 'nf' = 'nf';
  const verifier: DestinationVerifier = { family: 'evm', verify: async (a) => { seen = a.minAmount; return 'verified'; } };
  const { svc, repo } = setup({ verifier, status: () => st });
  const { request, attempt } = await svc.createSwap(input());
  await svc.markSigning(attempt.id);
  await svc.recordDeposit(attempt.id, 'vWwSGVd1Xgdc2Ub7AN9DwhE8U91wSNHmvWwSGVd1Xgdc2Ub7AN9DwhE8U91wSNHmvWwSGVd1Xgdc2Ub7AN9DwhE8');
  st = { status: 'SUCCESS', updatedAt: 'x', swapDetails: { intentHashes: ['i'], nearTxHashes: ['n'], originChainTxHashes: [], destinationChainTxHashes: [{ hash: '0xdest00000001', explorerUrl: 'u' }] } };
  const done = await svc.refresh(attempt.id);
  assert.equal(done.state, 'destination_confirmed');
  assert.equal(done.verification, 'verified');
  assert.equal(seen, 1_465_200_000n);
  assert.equal((await repo.getRequestById(request.id))!.status, 'paid');
});

test('a refunded swap leaves nothing blocking; a new swap creates a fresh request and deposit address', async () => {
  let st: StatusResponse | 'nf' = 'nf';
  const { svc } = setup({ status: () => st });
  const a = await svc.createSwap(input());
  await svc.recordDeposit(a.attempt.id, 'vWwSGVd1Xgdc2Ub7AN9DwhE8U91wSNHmvWwSGVd1Xgdc2Ub7AN9DwhE8U91wSNHmvWwSGVd1Xgdc2Ub7AN9DwhE8');
  st = { status: 'REFUNDED', updatedAt: 'x', swapDetails: { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [], refundedAmount: '10000000000', refundReason: 'SLIPPAGE' } };
  assert.equal((await svc.refresh(a.attempt.id)).state, 'refunded');
  const b = await svc.createSwap(input());
  assert.notEqual(b.request.id, a.request.id);
});

test('exact-input validation unit checks (payments keep using exact-output)', () => {
  const intent = { swapType: 'EXACT_INPUT' as const, amountIn: 10_000_000_000n, destAssetId: USDC.assetId, destBlockchain: 'base', recipient: ME_EVM, originAssetId: SOL.assetId, originBlockchain: 'sol', refundTo: PAYER };
  const good: QuoteResponse = {
    signature: 's',
    quoteRequest: { dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: SOL.assetId, depositType: 'ORIGIN_CHAIN', destinationAsset: USDC.assetId, amount: '10000000000', refundTo: PAYER, refundType: 'ORIGIN_CHAIN', recipient: ME_EVM, recipientType: 'DESTINATION_CHAIN', deadline: '2026-11-06T12:10:00Z' },
    quote: { depositAddress: 'D', amountIn: '10000000000', amountInFormatted: '10', amountInUsd: '1', minAmountIn: '10000000000', amountOut: '5', amountOutFormatted: '5', amountOutUsd: '1', minAmountOut: '4', deadline: '2026-11-06T12:10:00Z', timeEstimate: 1 },
  };
  assert.equal(validateLiveQuote(intent, good, T0).ok, true);
  assert.equal(validateLiveQuote({ ...intent, amountIn: 5n }, good, T0).ok, false);
  assert.equal(validateLiveQuote({ ...intent, amountIn: undefined }, good, T0).ok, false);
});

test('API: swap preview and creation, merchant dashboard excludes swaps, and rate limiting', async () => {
  const { svc, repo } = setup();
  const routes = buildRoutes({ service: svc, repo, auth: { secret: 'k'.repeat(32), verifiers: {} }, catalog: { get: async () => [SOL, USDC] }, log: () => {} });
  const call = async (path: string, body: unknown, ip?: string): Promise<ApiResponse> =>
    routes.find((r) => r.method === 'POST' && r.path === path)!.handler({ params: {}, body, headers: {}, ip });
  const body = { originAssetId: SOL.assetId, destAssetId: USDC.assetId, amount: '10', payerAddress: PAYER, recipient: ME_EVM };

  const prev = await call('/api/swaps/preview', body);
  assert.equal(prev.status, 200);
  assert.equal((prev.body as { minOutFormatted: string }).minOutFormatted, '1465.2');

  const made = await call('/api/swaps', body);
  assert.equal(made.status, 201);
  const m = made.body as { request: { kind: string; destination: { amountFormatted: string } }; attempt: { id: string; deposit: { amountFormatted: string } } };
  assert.equal(m.request.kind, 'swap');
  assert.equal(m.request.destination.amountFormatted, '1465.2');
  assert.equal(m.attempt.deposit.amountFormatted, '10');
  assert.ok(!JSON.stringify(made.body).includes('"quote"'));

  assert.equal((await call('/api/swaps', { ...body, amount: 'abc' })).status, 400);
  assert.equal((await call('/api/swaps', { ...body, slippageBps: 'x' })).status, 400);
  assert.equal((await call('/api/swaps/preview', 'nope')).status, 400);

  // rate limit: 30 quote-creating calls per minute per client, other clients unaffected
  let last = 0;
  for (let n = 0; n < 35; n++) last = (await call('/api/swaps/preview', body, '9.9.9.9')).status;
  assert.equal(last, 429);
  assert.equal((await call('/api/swaps/preview', body, '8.8.8.8')).status, 200);
});
