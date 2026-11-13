import { sameAddress } from './addresses.ts';
import type { QuoteResponse } from './types.ts';

/** What the merchant asked for plus what the customer chose. Everything here is OUR data, not the API's. */
export interface PaymentIntent {
  destAssetId: string;
  destBlockchain: string;
  recipient: string;
  /** 'EXACT_OUTPUT' (payments, default): the recipient must receive exactly `amountOut`. */
  swapType?: 'EXACT_OUTPUT' | 'EXACT_INPUT';
  /** requested amount the merchant must receive, base units (EXACT_OUTPUT) */
  amountOut?: bigint;
  /** 'EXACT_INPUT' (swaps): the customer sends exactly `amountIn` of the origin asset, base units */
  amountIn?: bigint;
  originAssetId: string;
  originBlockchain: string;
  /** customer's refund address on the origin chain */
  refundTo: string;
}

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

const MIN_DEADLINE_MARGIN_MS = 60_000;

/**
 * Check that a LIVE (non-dry) quote actually does what the customer and merchant agreed to,
 * before we show a deposit address. Signature verification is separate (SDK verifyQuoteSignature).
 */
export function validateLiveQuote(intent: PaymentIntent, res: QuoteResponse, nowMs: number): ValidationResult {
  const reasons: string[] = [];
  const r = res.quoteRequest;
  const q = res.quote;
  const bad = (m: string) => reasons.push(m);

  const mode = intent.swapType ?? 'EXACT_OUTPUT';
  if (r.dry) bad('Quote is a dry run and has no deposit address');
  if (r.swapType !== mode) bad(`Unexpected swap type ${r.swapType}`);
  if (r.depositType !== 'ORIGIN_CHAIN') bad(`Unexpected deposit type ${r.depositType}`);
  if (r.recipientType !== 'DESTINATION_CHAIN') bad(`Unexpected recipient type ${r.recipientType}`);
  if (r.refundType !== 'ORIGIN_CHAIN') bad(`Unexpected refund type ${r.refundType}`);
  if (r.destinationAsset !== intent.destAssetId) bad('Destination asset differs from the request');
  if (r.originAsset !== intent.originAssetId) bad('Source asset differs from the one selected');
  if (!sameAddress(intent.destBlockchain, r.recipient, intent.recipient)) bad('Recipient differs from the request');
  if (!sameAddress(intent.originBlockchain, r.refundTo, intent.refundTo)) bad('Refund address differs from the payer address');

  try {
    const amountIn = BigInt(q.amountIn);
    if (amountIn <= 0n) bad('Quote requires a zero source amount');
    if (BigInt(q.minAmountIn) > amountIn) bad('Quote minimum input exceeds proposed input');
    if (mode === 'EXACT_OUTPUT') {
      if (intent.amountOut === undefined) bad('Missing expected output amount');
      else {
        if (r.amount !== intent.amountOut.toString()) bad('Requested amount differs from the payment request');
        if (BigInt(q.amountOut) < intent.amountOut) bad('Quote delivers less than the requested amount');
      }
    } else {
      if (intent.amountIn === undefined) bad('Missing expected input amount');
      else {
        if (r.amount !== intent.amountIn.toString()) bad('Requested amount differs from the swap you entered');
        if (amountIn !== intent.amountIn) bad('Quote asks for a different source amount than you entered');
      }
      if (BigInt(q.minAmountOut) <= 0n) bad('Quote guarantees no output');
    }
  } catch {
    bad('Quote amounts are not valid integers');
  }

  if (!q.depositAddress) bad('Quote has no deposit address');
  if (!q.deadline) bad('Quote has no deadline');
  else {
    const dl = Date.parse(q.deadline);
    if (Number.isNaN(dl)) bad('Quote deadline is not a valid date');
    else if (dl - nowMs < MIN_DEADLINE_MARGIN_MS) bad('Quote expires too soon to deposit safely');
  }
  if (!res.signature) bad('Quote is unsigned');

  return { ok: reasons.length === 0, reasons };
}
