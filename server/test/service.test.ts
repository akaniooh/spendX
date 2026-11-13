import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentService } from '../src/service.ts';
import { MemoryRepository } from '../src/repo-memory.ts';
import { OneClickError } from '../src/oneclick.ts';
import { SpendXError } from '../src/domain.ts';
import type { QuoteRequestBody, QuoteResponse, StatusResponse, Token } from '../../shared/src/types.ts';
import type { DestinationVerifier } from '../../shared/src/adapters.ts';

const USDC: Token = { assetId: 'nep141:usdc-base', decimals: 6, blockchain: 'base', symbol: 'USDC' };
const BONK: Token = { assetId: 'nep141:bonk-sol', decimals: 5, blockchain: 'sol', symbol: 'BONK' };
const BTC: Token = { assetId: 'nep141:btc', decimals: 8, blockchain: 'btc', symbol: 'BTC' };
const MERCHANT = '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4';
const PAYER = 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z';
const T0 = Date.parse('2026-11-04T12:00:00Z');

function setup(over: { quoteMutator?: (q: QuoteResponse) => void; sigOk?: boolean; status?: () => StatusResponse | 'notfound'; verifier?: DestinationVerifier; noRoute?: boolean } = {}) {
  let clock = T0;
  const repo = new MemoryRepository();
  const calls = { quote: [] as QuoteRequestBody[], submit: [] as unknown[] };
  let addr = 0;
  const client = {
    async quote(b: QuoteRequestBody): Promise<QuoteResponse> {
      calls.quote.push(b);
      if (over.noRoute) throw new OneClickError(400, 'no route', {});
      const q: QuoteResponse = {
        signature: 'sig',
        quoteRequest: { ...b },
        quote: {
          depositAddress: b.dry ? undefined : `DEPOSIT${++addr}`, amountIn: '5000000', amountInFormatted: '50', amountInUsd: '80.40',
          minAmountIn: '4950000', amountOut: b.amount, amountOutFormatted: '80', amountOutUsd: '80', minAmountOut: b.amount,
          deadline: b.deadline, timeEstimate: 90, refundFee: '10',
        },
      };
      over.quoteMutator?.(q);
      return q;
    },
    async status(): Promise<StatusResponse> {
      const s = over.status?.() ?? 'notfound';
      if (s === 'notfound') throw new OneClickError(404, 'not found', {});
      return s;
    },
    async submitDeposit(a: unknown) { calls.submit.push(a); },
  };
  const svc = new PaymentService({
    repo, client,
    catalog: { findToken: async (id) => [USDC, BONK, BTC].find((t) => t.assetId === id) },
    verifyQuoteSignature: () => over.sigOk ?? true,
    verifiers: over.verifier ? { evm: over.verifier } : {},
    slippageBps: 100, deadlineMinutes: 10, now: () => clock,
  });
  return { svc, repo, calls, advance: (ms: number) => { clock += ms; } };
}

async function newRequest(svc: PaymentService, amount = '80') {
  return svc.createRequest({ merchantAddress: MERCHANT, merchantFamily: 'evm', destAssetId: USDC.assetId, amountHuman: amount, recipient: MERCHANT, description: 'Order 42' });
}
const status = (s: string, extra: Partial<StatusResponse['swapDetails']> = {}): StatusResponse => ({
  status: s as StatusResponse['status'], updatedAt: 'x',
  swapDetails: { intentHashes: ['i1'], nearTxHashes: ['n1'], originChainTxHashes: [{ hash: '4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp', explorerUrl: 'u' }], destinationChainTxHashes: [], ...extra },
});
const DEST = [{ hash: '0xdesttx0001', explorerUrl: 'https://basescan.org/tx/0xdesttx0001' }];

test('merchant request validation', async () => {
  const { svc } = setup();
  const r = await newRequest(svc);
  assert.equal(r.amount, 80_000_000n);
  assert.equal(r.slug.length >= 16, true);
  const bad = (p: Partial<Parameters<PaymentService['createRequest']>[0]>) =>
    svc.createRequest({ merchantAddress: MERCHANT, merchantFamily: 'evm', destAssetId: USDC.assetId, amountHuman: '1', recipient: MERCHANT, ...p });
  await assert.rejects(bad({ amountHuman: '0' }), { code: 'invalid_amount' });
  await assert.rejects(bad({ amountHuman: '1.0000001' }), { code: 'invalid_amount' });
  await assert.rejects(bad({ recipient: '0x123' }), { code: 'invalid_recipient' });
  await assert.rejects(bad({ destAssetId: 'nope' }), { code: 'unknown_asset' });
  await assert.rejects(bad({ description: 'x'.repeat(141) }), { code: 'invalid_description' });
  // chain with no local validator needs an explicit acknowledgement
  await assert.rejects(bad({ destAssetId: BTC.assetId, recipient: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080' }), { code: 'unchecked_recipient' });
  const ok = await bad({ destAssetId: BTC.assetId, amountHuman: '0.001', recipient: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', acknowledgeUncheckedAddress: true });
  assert.equal(ok.destBlockchain, 'btc');
});

test('dry preview creates no deposit address; unroutable pair gives a clear error', async () => {
  const { svc, calls } = setup();
  const r = await newRequest(svc);
  const p = await svc.previewQuote(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  assert.equal(calls.quote[0].dry, true);
  assert.equal(p.amountOutFormatted, '80');
  assert.ok(Math.abs(p.estimatedCostUsd - 0.4) < 1e-9);
  const n = setup({ noRoute: true });
  const r2 = await newRequest(n.svc);
  await assert.rejects(n.svc.previewQuote(r2.slug, { originAssetId: BONK.assetId, payerAddress: PAYER }), { code: 'route_unavailable' });
});

test('payer address must match the source chain', async () => {
  const { svc } = setup();
  const r = await newRequest(svc);
  await assert.rejects(svc.previewQuote(r.slug, { originAssetId: BONK.assetId, payerAddress: MERCHANT }), { code: 'invalid_payer' });
});

test('attempt creation validates the live quote and the signature, and stores nothing on rejection', async () => {
  for (const [name, o] of [
    ['bad signature', { sigOk: false }],
    ['swapped recipient', { quoteMutator: (q: QuoteResponse) => { q.quoteRequest.recipient = '0x0000000000000000000000000000000000000001'; } }],
    ['short delivery', { quoteMutator: (q: QuoteResponse) => { q.quote.amountOut = '1'; } }],
  ] as const) {
    const { svc, repo } = setup(o);
    const r = await newRequest(svc);
    await assert.rejects(svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER }), SpendXError, name);
    assert.equal(repo.attempts.size, 0, name);
  }
  const { svc, repo } = setup();
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  assert.equal(a.state, 'awaiting_payment');
  assert.equal(a.depositAddress, 'DEPOSIT1');
  assert.equal(a.amountIn, 5_000_000n);
  assert.equal(repo.attempts.size, 1);
});

test('duplicate protection: resume for the same payer, block others, allow retry after failure', async () => {
  const { svc, repo, calls } = setup();
  const r = await newRequest(svc);
  const a1 = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  const again = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  assert.equal(again.id, a1.id);
  assert.equal(calls.quote.length, 1, 'resume must not request another deposit address');
  await assert.rejects(svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: 'not-a-solana-address' }), { code: 'invalid_payer' });
  const other = 'So11111111111111111111111111111111111111112';
  await assert.rejects(svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: other }), { code: 'attempt_in_progress' });
  await repo.updateAttempt(a1.id, { state: 'failed' });
  const a2 = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: other });
  assert.notEqual(a2.id, a1.id);
});

test('happy path with an independent verifier: success only after destination verification', async () => {
  let outcome: 'pending' | 'verified' = 'pending';
  let st = status('PENDING_DEPOSIT');
  const verifier: DestinationVerifier = { family: 'evm', verify: async () => outcome };
  const { svc, repo, calls } = setup({ verifier, status: () => st });
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });

  assert.equal((await svc.markSigning(a.id)).state, 'payment_initiated');
  const sub = await svc.recordDeposit(a.id, '4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp', 'https://solscan.io/tx/4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp');
  assert.equal(sub.state, 'source_submitted');
  assert.deepEqual(calls.submit, [{ depositAddress: 'DEPOSIT1', txHash: '4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp' }]);
  assert.equal((await svc.recordDeposit(a.id, '4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp')).id, a.id, 'idempotent');
  await assert.rejects(svc.recordDeposit(a.id, 'dmcTHMDjEttWxa2kFRBJvrthbkpcnVe3dmcTHMDjEttWxa2kFRBJvrthbkpcnVe3dmcTHMDjEttWxa2kFRBJvrth'), { code: 'duplicate_deposit' });

  st = status('PROCESSING');
  assert.equal((await svc.refresh(a.id)).state, 'processing');

  st = status('SUCCESS', { destinationChainTxHashes: DEST });
  const waiting = await svc.refresh(a.id);
  assert.equal(waiting.state, 'processing', 'SUCCESS from 1Click alone must not be shown as paid');
  assert.equal((await repo.getRequestById(r.id))!.status, 'open');

  outcome = 'verified';
  const done = await svc.refresh(a.id);
  assert.equal(done.state, 'destination_confirmed');
  assert.equal(done.verification, 'verified');
  assert.deepEqual(done.destTxs, DEST);
  assert.deepEqual(done.nearTxHashes, ['n1']);
  assert.equal((await repo.getRequestById(r.id))!.status, 'paid');
  await assert.rejects(svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER }), { code: 'already_paid' });
});

test('chain without a verifier is reported (labelled as such), and never without a destination tx', async () => {
  let st = status('SUCCESS');
  const { svc } = setup({ status: () => st });
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  await svc.recordDeposit(a.id, '4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp');
  assert.equal((await svc.refresh(a.id)).state, 'processing', 'no destination tx yet');
  st = status('SUCCESS', { destinationChainTxHashes: DEST });
  const done = await svc.refresh(a.id);
  assert.equal(done.state, 'destination_confirmed');
  assert.equal(done.verification, 'reported');
});

test('verifier mismatch needs review and does not mark the request paid', async () => {
  const verifier: DestinationVerifier = { family: 'evm', verify: async () => 'mismatch' as const };
  const { svc, repo } = setup({ verifier, status: () => status('SUCCESS', { destinationChainTxHashes: DEST }) });
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  await svc.recordDeposit(a.id, '4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp');
  const res = await svc.refresh(a.id);
  assert.equal(res.state, 'needs_review');
  assert.equal((await repo.getRequestById(r.id))!.status, 'open');
});

test('refund is recorded and frees the request for a retry', async () => {
  const { svc } = setup({ status: () => status('REFUNDED', { refundedAmount: '5000000', refundedAmountFormatted: '50', refundReason: 'SWAP_FAILED' }) });
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  await svc.recordDeposit(a.id, '4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp');
  const res = await svc.refresh(a.id);
  assert.equal(res.state, 'refunded');
  assert.deepEqual(res.refund, { amount: '5000000', amountFormatted: '50', reason: 'SWAP_FAILED' });
  const retry = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  assert.notEqual(retry.id, a.id);
});

test('expiry: no deposit by the deadline expires the attempt; a deposit that was sent is never declared expired', async () => {
  const s1 = setup();
  const r1 = await newRequest(s1.svc);
  const a1 = await s1.svc.createAttempt(r1.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  s1.advance(11 * 60_000);
  assert.equal((await s1.svc.refresh(a1.id)).state, 'expired');
  assert.equal((await s1.svc.markSigning(a1.id)).state, 'expired');
  const a1b = await s1.svc.createAttempt(r1.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  assert.notEqual(a1b.id, a1.id);

  const s2 = setup({ status: () => status('KNOWN_DEPOSIT_TX') });
  const r2 = await newRequest(s2.svc);
  const a2 = await s2.svc.createAttempt(r2.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  await s2.svc.recordDeposit(a2.id, '4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp');
  s2.advance(11 * 60_000);
  assert.equal((await s2.svc.refresh(a2.id)).state, 'source_submitted');
});

test('cancel works only before any deposit exists', async () => {
  const { svc } = setup();
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  assert.equal((await svc.cancelAttempt(a.id)).state, 'cancelled');
  const b = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  await svc.recordDeposit(b.id, '4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXpLWSZap1G4L4g8133zYFa8WcHiEo5iZXp');
  await assert.rejects(svc.cancelAttempt(b.id), { code: 'cannot_cancel' });
});

const FAKE_SIG = 'Z'.repeat(88); // well-formed, but 1Click never saw a deposit for it

test('a made-up deposit hash cannot hold a payment link forever', async () => {
  const { svc, advance } = setup({ status: () => status('PENDING_DEPOSIT') });
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  await svc.recordDeposit(a.id, FAKE_SIG);
  const other = 'GDfnEsia2WLAW5t8yx2X5j2mkfA74i5kwGdDuZHt7XmG';
  advance(11 * 60_000); // past the deadline, inside the grace window: a real deposit may still be detected
  assert.equal((await svc.refresh(a.id)).state, 'source_submitted');
  await assert.rejects(svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: other }), { code: 'attempt_in_progress' });
  advance(31 * 60_000); // grace over and 1Click never saw it
  const next = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: other });
  assert.notEqual(next.id, a.id);
});

test('a deposit hash must look like a transaction on the source chain', async () => {
  const { svc } = setup();
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER }); // Solana source
  await assert.rejects(svc.recordDeposit(a.id, `0x${'ab'.repeat(32)}`), { code: 'invalid_tx' }); // an EVM-shaped hash
  await assert.rejects(svc.recordDeposit(a.id, 'not-a-real-signature'), { code: 'invalid_tx' });
  assert.equal((await svc.recordDeposit(a.id, FAKE_SIG)).state, 'source_submitted');
});

test('a late deposit on an expired attempt is picked up, and the request is not opened to a second payer', async () => {
  let cur: StatusResponse | 'notfound' = 'notfound';
  const { svc, advance } = setup({ status: () => cur });
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  advance(11 * 60_000);
  assert.equal((await svc.refresh(a.id)).state, 'expired'); // nothing deposited by the deadline
  cur = status('PROCESSING'); // ...but 1Click then detects a late deposit
  const other = 'GDfnEsia2WLAW5t8yx2X5j2mkfA74i5kwGdDuZHt7XmG';
  await assert.rejects(
    svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: other }),
    (e: unknown) => e instanceof SpendXError && e.code === 'attempt_in_progress',
  );
  assert.equal((await svc.refresh(a.id)).state, 'processing'); // the original attempt is live again
});

test('an expired attempt with no deposit stays expired and frees the request', async () => {
  const { svc, advance } = setup({ status: () => status('PENDING_DEPOSIT', { originChainTxHashes: [] }) });
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  advance(11 * 60_000);
  const retry = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  assert.notEqual(retry.id, a.id);
});

test('reconcile: payments advance with nobody watching, and finished attempts are left alone', async () => {
  let cur: StatusResponse | 'notfound' = 'notfound';
  let polls = 0;
  const { svc, advance, repo } = setup({ status: () => { polls++; return cur; } });
  const r1 = await newRequest(svc);
  const a1 = await svc.createAttempt(r1.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  await svc.recordDeposit(a1.id, FAKE_SIG);
  assert.equal((await repo.getAttempt(a1.id))!.state, 'source_submitted');

  cur = status('PROCESSING'); // 1Click moves on; no browser is polling
  assert.deepEqual(await svc.reconcile(), { checked: 1, failed: 0 });
  assert.equal((await repo.getAttempt(a1.id))!.state, 'processing');

  cur = status('REFUNDED'); // a final state: after this the reconciler no longer asks about it
  await svc.reconcile();
  assert.equal((await repo.getAttempt(a1.id))!.state, 'refunded');
  polls = 0;
  assert.deepEqual(await svc.reconcile(), { checked: 0, failed: 0 });
  assert.equal(polls, 0);
});

test('reconcile: a late deposit on a recently expired attempt is found; old expired ones are not polled', async () => {
  let cur: StatusResponse | 'notfound' = 'notfound';
  let polls = 0;
  const { svc, advance, repo } = setup({ status: () => { polls++; return cur; } });
  const r = await newRequest(svc);
  const a = await svc.createAttempt(r.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  advance(11 * 60_000);
  await svc.reconcile(); // past the deadline with no deposit: expires
  assert.equal((await repo.getAttempt(a.id))!.state, 'expired');

  cur = status('PROCESSING'); // 1Click later reports a deposit
  await svc.reconcile();
  assert.equal((await repo.getAttempt(a.id))!.state, 'processing', 'revived inside the grace window');
  cur = status('REFUNDED'); // finish it, so only the second attempt below is in play
  await svc.reconcile();
  assert.equal((await repo.getAttempt(a.id))!.state, 'refunded');

  // a second attempt that expires and then stays quiet beyond the grace window is no longer asked about
  const r2 = await newRequest(svc);
  cur = 'notfound';
  const b = await svc.createAttempt(r2.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  advance(11 * 60_000);
  await svc.reconcile();
  assert.equal((await repo.getAttempt(b.id))!.state, 'expired');
  advance(31 * 60_000);
  polls = 0;
  await svc.reconcile();
  assert.equal(polls, 0, 'expired attempts past the grace window are skipped');
});

test('reconcile: one failing attempt does not stop the others, and failures are counted', async () => {
  let n = 0;
  const { svc, repo } = setup({ status: () => { if (++n === 1) throw new Error('boom'); return status('PROCESSING'); } });
  const r1 = await newRequest(svc);
  const r2 = await newRequest(svc);
  const a1 = await svc.createAttempt(r1.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  const a2 = await svc.createAttempt(r2.slug, { originAssetId: BONK.assetId, payerAddress: PAYER });
  const out = await svc.reconcile({ concurrency: 1 });
  assert.deepEqual(out, { checked: 2, failed: 1 });
  const states = [(await repo.getAttempt(a1.id))!.state, (await repo.getAttempt(a2.id))!.state];
  assert.ok(states.includes('processing'));
});
