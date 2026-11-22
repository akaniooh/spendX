import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentService } from '../src/service.ts';
import { MemoryRepository } from '../src/repo-memory.ts';
import { OneClickError, buildExactInputQuote, buildExactOutputQuote } from '../src/oneclick.ts';
import { loadConfig } from '../src/config.ts';
import type { FeeConfig } from '../../shared/src/fees.ts';
import type { QuoteRequestBody, QuoteResponse, StatusResponse, Token } from '../../shared/src/types.ts';

const EVM_PAYER = '0x1111111111111111111111111111111111111111';
const SOL: Token = { assetId: 'nep141:sol.omft.near', decimals: 9, blockchain: 'sol', symbol: 'SOL' };
const USDC: Token = { assetId: 'nep141:usdc-base', decimals: 6, blockchain: 'base', symbol: 'USDC', contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' };
const PAYER = 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z';
const MERCHANT = '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4';
const T0 = Date.parse('2026-11-04T12:00:00Z');

const FEES: FeeConfig = { recipient: 'spendx.near', swapBps: 30, paymentBps: 50, referral: 'spendx', hasApiKey: true };

function setup(o: { fees?: FeeConfig; mutate?: (q: QuoteResponse) => void } = {}) {
  const repo = new MemoryRepository();
  const quotes: QuoteRequestBody[] = [];
  const client = {
    async quote(b: QuoteRequestBody): Promise<QuoteResponse> {
      quotes.push(b);
      const q: QuoteResponse = {
        signature: 'sig',
        quoteRequest: {
          ...b,
          // behaves like the live API (measured): the echoed fee is our share, which is half of what was submitted,
          // except when payer and merchant use the identical asset
          ...(b.appFees ? { appFees: b.appFees.map((f) => ({ recipient: f.recipient, fee: b.originAsset === b.destinationAsset ? f.fee : Math.ceil(f.fee / 2) })) } : {}),
        },
        quote: b.swapType === 'EXACT_INPUT'
          ? {
            depositAddress: b.dry ? undefined : 'DEPOSIT1', amountIn: b.amount, amountInFormatted: '10', amountInUsd: '1000',
            minAmountIn: b.amount, amountOut: '1480000000', amountOutFormatted: '1480', amountOutUsd: '990', minAmountOut: '1465200000',
            deadline: b.deadline, timeEstimate: 60,
          }
          : {
            depositAddress: b.dry ? undefined : 'DEPOSIT1', amountIn: '5000000', amountInFormatted: '50', amountInUsd: '1000',
            minAmountIn: '4950000', amountOut: b.amount, amountOutFormatted: '80', amountOutUsd: '990', minAmountOut: b.amount,
            deadline: b.deadline, timeEstimate: 60,
          },
      };
      o.mutate?.(q);
      return q;
    },
    async status(): Promise<StatusResponse> { throw new OneClickError(404, 'nf', {}); },
    async submitDeposit() {},
  };
  const svc = new PaymentService({
    repo, client, catalog: { findToken: async (id) => [SOL, USDC].find((t) => t.assetId === id) },
    verifyQuoteSignature: () => true, slippageBps: 100, deadlineMinutes: 10, now: () => T0, fees: o.fees,
  });
  return { svc, quotes, repo };
}
const newPayment = (svc: PaymentService) =>
  svc.createRequest({ merchantAddress: MERCHANT, merchantFamily: 'evm', destAssetId: USDC.assetId, amountHuman: '80', recipient: MERCHANT });
const swapInput = () => ({ originAssetId: SOL.assetId, destAssetId: USDC.assetId, amountHuman: '10', payerAddress: PAYER, recipient: MERCHANT });

test('no fee configured: quotes carry no appFees or referral and previews show no SpendX fee', async () => {
  const { svc, quotes } = setup();
  const req = await newPayment(svc);
  const pv = await svc.previewQuote(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER });
  await svc.createAttempt(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER });
  const sw = await svc.previewSwap(swapInput());
  assert.equal(quotes.length, 3);
  for (const q of quotes) { assert.equal('appFees' in q, false); assert.equal('referral' in q, false); }
  assert.equal(pv.spendxFee, undefined);
  assert.equal(sw.spendxFee, undefined);
});

test('a recipient with both fees at 0 behaves like no fee', async () => {
  const { svc, quotes } = setup({ fees: { ...FEES, swapBps: 0, paymentBps: 0 } });
  const req = await newPayment(svc);
  await svc.previewQuote(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER });
  assert.equal('appFees' in quotes[0], false);
});

test('payments: the same fee goes on the dry preview and the live quote, and SpendX\'s own share is reported', async () => {
  const { svc, quotes } = setup({ fees: FEES });
  const req = await newPayment(svc);
  const pv = await svc.previewQuote(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER });
  const attempt = await svc.createAttempt(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER });
  // key present: keeping 50 bps means submitting 100 (1Click takes the other half)
  assert.deepEqual(quotes[0].appFees, [{ recipient: 'spendx.near', fee: 100 }]);
  assert.deepEqual(quotes[1].appFees, quotes[0].appFees);
  assert.equal(quotes[0].referral, 'spendx');
  assert.equal(quotes[0].dry, true);
  assert.equal(quotes[1].dry, false);
  assert.deepEqual(pv.spendxFee, { bps: 50, usd: 5 }); // 0.5% of $1000
  // the stored signed quote carries the share 1Click reports (half of the 100 submitted), so revenue can be audited later
  assert.deepEqual(attempt.quote.quoteRequest.appFees, [{ recipient: 'spendx.near', fee: 50 }]);
});

test('a payment in the SAME asset the merchant receives is not split by 1Click, so only the kept fee is submitted', async () => {
  const { svc, quotes } = setup({ fees: FEES }); // keep 50 for payments, API key set
  const req = await newPayment(svc); // merchant receives USDC on Base
  const pv = await svc.previewQuote(req.slug, { originAssetId: USDC.assetId, payerAddress: EVM_PAYER }); // payer also pays USDC on Base
  await svc.createAttempt(req.slug, { originAssetId: USDC.assetId, payerAddress: EVM_PAYER });
  assert.deepEqual(quotes[0].appFees, [{ recipient: 'spendx.near', fee: 50 }]); // not doubled
  assert.deepEqual(quotes[1].appFees, quotes[0].appFees);
  assert.equal(pv.spendxFee?.bps, 50); // and all of it is ours
  // a different payer token on the same request is still doubled
  await svc.previewQuote(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER });
  assert.deepEqual(quotes[2].appFees, [{ recipient: 'spendx.near', fee: 100 }]);
});

test('the preview shows the share 1Click reports for our recipient, not just the share the model expects', async () => {
  const { svc } = setup({ fees: FEES, mutate: (q) => { if (q.quoteRequest.appFees) q.quoteRequest.appFees = [{ recipient: 'spendx.near', fee: 40 }]; } });
  const sw = await svc.previewSwap(swapInput()); // model expects 30
  assert.equal(sw.spendxFee?.bps, 40);
});

test('swaps use the swap fee, not the payment fee', async () => {
  const { svc, quotes } = setup({ fees: FEES });
  const pv = await svc.previewSwap(swapInput());
  await svc.createSwap(swapInput());
  assert.deepEqual(quotes[0].appFees, [{ recipient: 'spendx.near', fee: 60 }]); // keep 30 -> submit 60
  assert.deepEqual(quotes[1].appFees, quotes[0].appFees);
  assert.equal(quotes[0].swapType, 'EXACT_INPUT');
  assert.deepEqual(pv.spendxFee, { bps: 30, usd: 3 }); // 0.3% of $1000
});

test('without an API key the fee is still doubled, because the live API splits it too', async () => {
  const { svc, quotes } = setup({ fees: { ...FEES, hasApiKey: false } });
  const pv = await svc.previewSwap(swapInput());
  assert.deepEqual(quotes[0].appFees, [{ recipient: 'spendx.near', fee: 60 }]);
  assert.equal(pv.spendxFee?.bps, 30);
});

test('a live quote that lost, changed or redirected the fee is rejected and no attempt is stored', async () => {
  const drop = setup({ fees: FEES, mutate: (q) => { if (!q.quoteRequest.dry) delete q.quoteRequest.appFees; } });
  const req = await newPayment(drop.svc);
  await assert.rejects(drop.svc.createAttempt(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER }), { code: 'quote_rejected' });
  assert.equal((await drop.repo.listAttempts(req.id)).length, 0); // rejected before anything was stored

  const changed = setup({ fees: FEES, mutate: (q) => { q.quoteRequest.appFees = [{ recipient: 'spendx.near', fee: 101 }]; } });
  const req2 = await newPayment(changed.svc);
  await assert.rejects(changed.svc.createAttempt(req2.slug, { originAssetId: SOL.assetId, payerAddress: PAYER }), { code: 'quote_rejected' });

  const redirected = setup({ fees: FEES, mutate: (q) => { q.quoteRequest.appFees = [{ recipient: 'attacker.near', fee: 100 }]; } });
  await assert.rejects(redirected.svc.createSwap(swapInput()), { code: 'quote_rejected' });
});

test('a live quote where 1Click reports a lower share (seen live: 25 submitted, 13 echoed) is still accepted', async () => {
  const { svc } = setup({ fees: { ...FEES, hasApiKey: false, paymentBps: 25 }, mutate: (q) => { q.quoteRequest.appFees = [{ recipient: 'spendx.near', fee: 13 }]; } });
  const req = await newPayment(svc);
  const a = await svc.createAttempt(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER });
  assert.equal(a.state, 'awaiting_payment');
});

test('a live quote with an extra entry added by 1Click is still accepted', async () => {
  const { svc } = setup({ fees: FEES, mutate: (q) => { q.quoteRequest.appFees = [...(q.quoteRequest.appFees ?? []), { recipient: '1click.near', fee: 20 }]; } });
  const req = await newPayment(svc);
  const a = await svc.createAttempt(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER });
  assert.equal(a.state, 'awaiting_payment');
});

test('quote builders add appFees and referral only when given', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const base = { dry: true, originAssetId: 'o', destAssetId: 'd', recipient: 'r', refundTo: 'f', slippageBps: 100, deadlineMinutes: 10, now };
  const withFee = buildExactOutputQuote({ ...base, amountOut: 1n, appFees: [{ recipient: 'a.near', fee: 50 }], referral: 'spendx' });
  assert.deepEqual(withFee.appFees, [{ recipient: 'a.near', fee: 50 }]);
  assert.equal(withFee.referral, 'spendx');
  const exactIn = buildExactInputQuote({ ...base, amountIn: 1n, appFees: [{ recipient: 'a.near', fee: 50 }] });
  assert.deepEqual(exactIn.appFees, [{ recipient: 'a.near', fee: 50 }]);
  for (const b of [buildExactOutputQuote({ ...base, amountOut: 1n }), buildExactOutputQuote({ ...base, amountOut: 1n, appFees: [] }), buildExactInputQuote({ ...base, amountIn: 1n })]) {
    assert.equal('appFees' in b, false);
    assert.equal('referral' in b, false);
  }
});

const ENV = { SESSION_SECRET: 'z'.repeat(32), REPOSITORY: 'memory' };

test('config: fees are off by default and change nothing', () => {
  const c = loadConfig(ENV);
  assert.deepEqual(c.fees, { recipient: undefined, swapBps: 0, paymentBps: 0, referral: undefined, hasApiKey: false });
  assert.deepEqual(c.warnings.filter((w) => /fee/i.test(w)), []);
});

test('config: reads the fee settings, defaults the referral, and explains the split in a startup warning', () => {
  const c = loadConfig({ ...ENV, FEE_RECIPIENT: 'spendx.near', SWAP_FEE_BPS: '30', PAYMENT_FEE_BPS: '50', ONECLICK_API_KEY: 'k' });
  assert.deepEqual(c.fees, { recipient: 'spendx.near', swapBps: 30, paymentBps: 50, referral: 'spendx', hasApiKey: true });
  assert.equal(c.warnings.some((w) => /fees are paid to spendx\.near/.test(w)), true);
  assert.equal(c.warnings.some((w) => /swap fee: SpendX keeps 30 bps; customers pay up to 60 bps/.test(w)), true);
  assert.equal(c.warnings.some((w) => /payment fee: SpendX keeps 50 bps; customers pay up to 100 bps/.test(w)), true);
  const keyless = loadConfig({ ...ENV, FEE_RECIPIENT: 'spendx.near', SWAP_FEE_BPS: '30' });
  assert.equal(keyless.fees.hasApiKey, false);
  assert.equal(keyless.warnings.some((w) => /customers pay up to 85 bps.*no API key/.test(w)), true);
});

test('config: unsafe or incomplete fee settings fail at startup', () => {
  assert.throws(() => loadConfig({ ...ENV, SWAP_FEE_BPS: '30' }), /FEE_RECIPIENT/);
  assert.throws(() => loadConfig({ ...ENV, FEE_RECIPIENT: '0x123', SWAP_FEE_BPS: '30' }), /FEE_RECIPIENT/);
  assert.throws(() => loadConfig({ ...ENV, FEE_RECIPIENT: 'Bad Name', SWAP_FEE_BPS: '30' }), /FEE_RECIPIENT/);
  assert.throws(() => loadConfig({ ...ENV, FEE_RECIPIENT: 'spendx.near', SWAP_FEE_BPS: '2.5' }), /whole number/);
  assert.throws(() => loadConfig({ ...ENV, FEE_RECIPIENT: 'spendx.near', SWAP_FEE_BPS: '-1' }), /SWAP_FEE_BPS/);
  assert.throws(() => loadConfig({ ...ENV, FEE_RECIPIENT: 'spendx.near', SWAP_FEE_BPS: '30', FEE_REFERRAL: 'SpendX!' }), /FEE_REFERRAL/);
  // the 500 bps combined cap: with an API key 1Click takes half, so the most you can keep is 250
  assert.doesNotThrow(() => loadConfig({ ...ENV, FEE_RECIPIENT: 'spendx.near', SWAP_FEE_BPS: '250', ONECLICK_API_KEY: 'k' }));
  assert.throws(() => loadConfig({ ...ENV, FEE_RECIPIENT: 'spendx.near', SWAP_FEE_BPS: '251', ONECLICK_API_KEY: 'k' }), /500 bps/);
  assert.doesNotThrow(() => loadConfig({ ...ENV, FEE_RECIPIENT: 'spendx.near', PAYMENT_FEE_BPS: '237' }));
  assert.throws(() => loadConfig({ ...ENV, FEE_RECIPIENT: 'spendx.near', PAYMENT_FEE_BPS: '238' }), /500 bps/);
});
