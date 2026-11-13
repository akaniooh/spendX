import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBaseUnits, fromBaseUnits } from '../src/amounts.ts';
import { validateAddress, sameAddress } from '../src/addresses.ts';
import { familyOf } from '../src/chains.ts';
import { derivePaymentState, isTerminal } from '../src/status.ts';
import { validateLiveQuote } from '../src/quote-validation.ts';
import type { PaymentIntent } from '../src/quote-validation.ts';
import { resolveToken, parsePairSpec } from '../src/pairs.ts';
import type { QuoteResponse, Token } from '../src/types.ts';

test('amounts round-trip and reject excess precision', () => {
  assert.equal(toBaseUnits('80', 6), 80_000_000n);
  assert.equal(toBaseUnits('0.000001', 6), 1n);
  assert.equal(toBaseUnits('1.5', 18), 1_500_000_000_000_000_000n);
  assert.throws(() => toBaseUnits('0.0000001', 6));
  assert.throws(() => toBaseUnits('-1', 6));
  assert.throws(() => toBaseUnits('1e3', 6));
  assert.equal(fromBaseUnits(80_000_000n, 6), '80');
  assert.equal(fromBaseUnits(1n, 6), '0.000001');
  assert.equal(fromBaseUnits(1_234_500n, 6), '1.2345');
  assert.equal(fromBaseUnits(0n, 6), '0');
});

test('chain families', () => {
  assert.equal(familyOf('base'), 'evm');
  assert.equal(familyOf('arb'), 'evm');
  assert.equal(familyOf('sol'), 'svm');
  assert.equal(familyOf('near'), 'near');
  assert.equal(familyOf('btc'), 'other');
});

test('address validation per family; unknown families are unchecked, not assumed valid', () => {
  // example addresses are from docs.near-intents.org/resources/chain-support
  assert.equal(validateAddress('base', '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4').status, 'valid');
  assert.equal(validateAddress('base', '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a').status, 'invalid');
  assert.equal(validateAddress('base', ' 0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4').status, 'invalid');
  assert.equal(validateAddress('sol', 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z').status, 'valid');
  assert.equal(validateAddress('sol', 'not-a-solana-address').status, 'invalid');
  assert.equal(validateAddress('sol', '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4').status, 'invalid');
  assert.equal(validateAddress('near', 'alice.near').status, 'valid');
  assert.equal(validateAddress('near', 'Alice.near').status, 'invalid');
  assert.equal(validateAddress('btc', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080').status, 'unchecked');
  assert.ok(sameAddress('base', '0xABCDEF0000000000000000000000000000000001', '0xabcdef0000000000000000000000000000000001'));
  assert.ok(!sameAddress('sol', 'AbC', 'abc'));
});

test('state machine never reports success before verification', () => {
  const base = { walletSigned: true, verification: 'pending' as const, nowMs: 1000 };
  assert.equal(derivePaymentState({ ...base, oneClick: 'SUCCESS' }), 'processing');
  assert.equal(derivePaymentState({ ...base, oneClick: 'SUCCESS', verification: 'verified' }), 'destination_confirmed');
  assert.equal(derivePaymentState({ ...base, oneClick: 'SUCCESS', verification: 'reported' }), 'destination_confirmed');
  assert.equal(derivePaymentState({ ...base, oneClick: 'SUCCESS', verification: 'mismatch' }), 'needs_review');
  assert.equal(derivePaymentState({ ...base, oneClick: 'PROCESSING' }), 'processing');
  assert.equal(derivePaymentState({ ...base, oneClick: 'KNOWN_DEPOSIT_TX' }), 'source_submitted');
  assert.equal(derivePaymentState({ ...base, oneClick: 'REFUNDED' }), 'refunded');
  assert.equal(derivePaymentState({ ...base, oneClick: 'FAILED' }), 'failed');
  assert.equal(derivePaymentState({ ...base, oneClick: 'INCOMPLETE_DEPOSIT' }), 'incomplete_deposit');
});

test('pre-deposit states: awaiting, initiated, submitted, expired', () => {
  const b = { verification: 'pending' as const, nowMs: 1000, deadlineMs: 5000 };
  assert.equal(derivePaymentState({ ...b, oneClick: 'PENDING_DEPOSIT', walletSigned: false }), 'awaiting_payment');
  assert.equal(derivePaymentState({ ...b, oneClick: 'PENDING_DEPOSIT', walletSigned: true }), 'payment_initiated');
  assert.equal(derivePaymentState({ ...b, oneClick: 'PENDING_DEPOSIT', walletSigned: true, sourceTxHash: '0xabc' }), 'source_submitted');
  assert.equal(derivePaymentState({ ...b, nowMs: 9000, oneClick: 'PENDING_DEPOSIT', walletSigned: false }), 'expired');
  // a deposit tx beats expiry: funds were sent, so we keep tracking instead of declaring it expired
  assert.equal(derivePaymentState({ ...b, nowMs: 9000, oneClick: 'PENDING_DEPOSIT', walletSigned: true, sourceTxHash: '0xabc' }), 'source_submitted');
  assert.ok(isTerminal('refunded') && !isTerminal('processing'));
});

const dest: Token = { assetId: 'nep141:dest-usdc', decimals: 6, blockchain: 'base', symbol: 'USDC' };
const src: Token = { assetId: 'nep141:src-bonk', decimals: 5, blockchain: 'sol', symbol: 'BONK' };
const NOW = Date.parse('2026-11-04T12:00:00Z');
const intent: PaymentIntent = {
  destAssetId: dest.assetId,
  destBlockchain: 'base',
  recipient: '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4',
  amountOut: 80_000_000n,
  originAssetId: src.assetId,
  originBlockchain: 'sol',
  refundTo: 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z',
};
function goodQuote(): QuoteResponse {
  return {
    signature: 'sig',
    quoteRequest: {
      dry: false, swapType: 'EXACT_OUTPUT', slippageTolerance: 100,
      originAsset: src.assetId, depositType: 'ORIGIN_CHAIN',
      destinationAsset: dest.assetId, amount: '80000000',
      refundTo: intent.refundTo, refundType: 'ORIGIN_CHAIN',
      recipient: intent.recipient.toLowerCase(), recipientType: 'DESTINATION_CHAIN',
      deadline: '2026-11-04T12:10:00Z',
    },
    quote: {
      depositAddress: 'DepositAddr', amountIn: '1000', amountInFormatted: '0.01', amountInUsd: '80.5',
      minAmountIn: '990', amountOut: '80000000', amountOutFormatted: '80', amountOutUsd: '80',
      minAmountOut: '80000000', deadline: '2026-11-04T12:10:00Z', timeEstimate: 120,
    },
  };
}

test('a faithful live quote passes validation', () => {
  const r = validateLiveQuote(intent, goodQuote(), NOW);
  assert.deepEqual(r, { ok: true, reasons: [] });
});

test('tampered or deviating quotes are rejected', () => {
  const cases: Array<[string, (q: QuoteResponse) => void]> = [
    ['recipient swapped', (q) => { q.quoteRequest.recipient = '0x0000000000000000000000000000000000000001'; }],
    ['destination asset swapped', (q) => { q.quoteRequest.destinationAsset = 'nep141:other'; }],
    ['source asset swapped', (q) => { q.quoteRequest.originAsset = 'nep141:other'; }],
    ['refund address swapped', (q) => { q.quoteRequest.refundTo = 'someone-else'; }],
    ['amount differs', (q) => { q.quoteRequest.amount = '1'; }],
    ['delivers less', (q) => { q.quote.amountOut = '79999999'; }],
    ['no deposit address', (q) => { delete q.quote.depositAddress; }],
    ['dry quote', (q) => { q.quoteRequest.dry = true; }],
    ['expires too soon', (q) => { q.quote.deadline = '2026-11-04T12:00:30Z'; }],
    ['unsigned', (q) => { delete q.signature; }],
    ['wrong swap type', (q) => { q.quoteRequest.swapType = 'EXACT_INPUT'; }],
    ['garbage amounts', (q) => { q.quote.amountIn = 'abc'; }],
  ];
  for (const [name, mutate] of cases) {
    const q = goodQuote();
    mutate(q);
    const r = validateLiveQuote(intent, q, NOW);
    assert.equal(r.ok, false, `expected rejection: ${name}`);
    assert.ok(r.reasons.length > 0);
  }
});

test('token resolution by chain:SYMBOL or assetId; ambiguity is reported, not guessed', () => {
  const tokens: Token[] = [dest, src, { ...dest, assetId: 'nep141:dest-usdc-2' }, { assetId: 'nep141:wrap.near', decimals: 24, blockchain: 'near', symbol: 'wNEAR' }];
  assert.equal(resolveToken(tokens, 'sol:bonk').ok, true);
  assert.equal(resolveToken(tokens, 'nep141:wrap.near').ok, true);
  // asset ids seen in the live catalog: nep245 and 1cs_v1 schemes must resolve by id too
  const multi: Token = { assetId: 'nep245:v2_1.omni.hot.tg:137_abc', decimals: 6, blockchain: 'pol', symbol: 'USDC' };
  const cs: Token = { assetId: '1cs_v1:hypercore:hip1:0x6d1e', decimals: 8, blockchain: 'hypercore', symbol: 'USDC' };
  assert.equal(resolveToken([...tokens, multi, cs], multi.assetId).ok, true);
  assert.equal(resolveToken([...tokens, multi, cs], cs.assetId).ok, true);
  assert.equal(resolveToken(tokens, 'nep245:missing').ok, false);
  const amb = resolveToken(tokens, 'base:USDC');
  assert.equal(amb.ok, false);
  assert.equal(amb.ok === false && amb.candidates?.length, 2);
  assert.equal(resolveToken(tokens, 'eth:XYZ').ok, false);
  assert.equal(resolveToken(tokens, 'garbage').ok, false);
  assert.deepEqual(parsePairSpec('sol:BONK>base:USDC'), { from: 'sol:BONK', to: 'base:USDC' });
  assert.equal(parsePairSpec('nope'), null);
});
