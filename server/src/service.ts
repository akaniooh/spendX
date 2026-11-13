import { randomBytes } from 'node:crypto';
import { validateAddress } from '../../shared/src/addresses.ts';
import { fromBaseUnits, toBaseUnits } from '../../shared/src/amounts.ts';
import { familyOf } from '../../shared/src/chains.ts';
import type { WalletFamily } from '../../shared/src/chains.ts';
import { validateLiveQuote } from '../../shared/src/quote-validation.ts';
import { derivePaymentState, isTerminal } from '../../shared/src/status.ts';
import type { DestinationVerifier } from '../../shared/src/adapters.ts';
import type { Quote, QuoteRequestBody, QuoteResponse, Token } from '../../shared/src/types.ts';
import { SpendXError } from './domain.ts';
import type { Attempt, PaymentRequest, Repository } from './domain.ts';
import { OneClickError, buildExactInputQuote, buildExactOutputQuote } from './oneclick.ts';
import type { OneClickClient } from './oneclick.ts';

export interface ServiceDeps {
  repo: Repository;
  client: Pick<OneClickClient, 'quote' | 'status' | 'submitDeposit'>;
  catalog: { findToken(assetId: string): Promise<Token | undefined> };
  /** Real implementation: verifyQuoteSignature from @defuse-protocol/one-click-sdk-typescript (>= 0.1.24). */
  verifyQuoteSignature: (q: QuoteResponse) => boolean;
  verifiers?: Partial<Record<string, DestinationVerifier>>;
  slippageBps: number;
  deadlineMinutes: number;
  now?: () => number;
}

export interface QuotePreview {
  amountInFormatted: string;
  amountOutFormatted: string;
  amountInUsd: string;
  amountOutUsd: string;
  /** spread + fees, estimated from the quote's USD values; labelled as an estimate in the UI */
  estimatedCostUsd: number;
  timeEstimateSeconds: number;
  refundFee?: string;
  withdrawFee?: string;
  minAmountIn: string;
}

const UNVERIFIED_FALLBACK_MS = 10 * 60_000;
/** After the quote deadline, keep asking 1Click about an attempt for this long: a late deposit can still be delivered or refunded. */
const LATE_DEPOSIT_GRACE_MS = 30 * 60_000;
/** An expired attempt only comes back to life for states that prove 1Click actually saw a deposit. */
const REVIVAL_STATES: ReadonlySet<string> = new Set(['source_submitted', 'processing', 'incomplete_deposit', 'destination_confirmed', 'needs_review', 'refunded']);
const TX_HASH_SHAPE: Record<string, RegExp> = {
  evm: /^0x[0-9a-fA-F]{64}$/,
  svm: /^[1-9A-HJ-NP-Za-km-z]{64,90}$/,
  near: /^[1-9A-HJ-NP-Za-km-z]{43,44}$/,
};

export interface SwapInput {
  originAssetId: string;
  destAssetId: string;
  /** human amount of the ORIGIN token to send, e.g. "10" */
  amountHuman: string;
  payerAddress: string;
  recipient: string;
  slippageBps?: number;
  acknowledgeUncheckedAddress?: boolean;
}

export interface SwapPreview {
  amountInFormatted: string;
  amountInUsd: string;
  estimatedOutFormatted: string;
  /** the guaranteed floor: if the market moves beyond it, the swap is refunded instead */
  minOutFormatted: string;
  amountOutUsd: string;
  estimatedCostUsd: number;
  timeEstimateSeconds: number;
  slippageBps: number;
  refundFee?: string;
  withdrawFee?: string;
}

export class PaymentService {
  private d: ServiceDeps;
  constructor(deps: ServiceDeps) {
    this.d = deps;
  }
  private now() {
    return (this.d.now ?? Date.now)();
  }

  async createRequest(i: {
    merchantAddress: string;
    merchantFamily: WalletFamily;
    destAssetId: string;
    amountHuman: string;
    recipient: string;
    description?: string;
    /** required when the destination chain has no local address validator */
    acknowledgeUncheckedAddress?: boolean;
  }): Promise<PaymentRequest> {
    const token = await this.d.catalog.findToken(i.destAssetId);
    if (!token) throw new SpendXError('unknown_asset', 'That destination asset is not in the NEAR Intents catalog');
    let amount: bigint;
    try {
      amount = toBaseUnits(i.amountHuman, token.decimals);
    } catch (e) {
      throw new SpendXError('invalid_amount', (e as Error).message);
    }
    if (amount <= 0n) throw new SpendXError('invalid_amount', 'Amount must be greater than zero');
    const chk = validateAddress(token.blockchain, i.recipient);
    if (chk.status === 'invalid') throw new SpendXError('invalid_recipient', chk.reason);
    if (chk.status === 'unchecked' && !i.acknowledgeUncheckedAddress) {
      throw new SpendXError('unchecked_recipient', `SpendX cannot validate ${token.blockchain} addresses yet. Confirm the address is correct to continue.`);
    }
    const description = i.description?.trim();
    if (description && description.length > 140) throw new SpendXError('invalid_description', 'Description is limited to 140 characters');
    return this.d.repo.createRequest({
      kind: 'payment',
      slug: randomBytes(12).toString('base64url'),
      merchantAddress: i.merchantAddress,
      merchantFamily: i.merchantFamily,
      destAssetId: token.assetId,
      destBlockchain: token.blockchain,
      destSymbol: token.symbol,
      destDecimals: token.decimals,
      amount,
      recipient: i.recipient,
      description: description || undefined,
      status: 'open',
    });
  }

  private async openRequest(slug: string): Promise<PaymentRequest> {
    const req = await this.d.repo.getRequestBySlug(slug);
    if (!req) throw new SpendXError('not_found', 'Payment request not found', 404);
    if (req.status === 'paid') throw new SpendXError('already_paid', 'This payment has already been completed', 409);
    if (req.status === 'cancelled') throw new SpendXError('cancelled', 'This payment request was cancelled', 410);
    return req;
  }

  private async resolveSource(originAssetId: string, payerAddress: string) {
    const token = await this.d.catalog.findToken(originAssetId);
    if (!token) throw new SpendXError('unknown_asset', 'That source asset is not in the NEAR Intents catalog');
    const chk = validateAddress(token.blockchain, payerAddress);
    if (chk.status === 'invalid') throw new SpendXError('invalid_payer', `Your ${token.blockchain} address is not valid: ${chk.reason}`);
    return token;
  }

  /** Dry quote: shows the customer what the route costs. Creates no deposit address. */
  async previewQuote(slug: string, i: { originAssetId: string; payerAddress: string }): Promise<QuotePreview> {
    const req = await this.openRequest(slug);
    await this.resolveSource(i.originAssetId, i.payerAddress);
    const body = buildExactOutputQuote({
      dry: true,
      originAssetId: i.originAssetId,
      destAssetId: req.destAssetId,
      amountOut: req.amount,
      recipient: req.recipient,
      refundTo: i.payerAddress,
      slippageBps: this.d.slippageBps,
      deadlineMinutes: this.d.deadlineMinutes,
      now: new Date(this.now()),
    });
    let res: QuoteResponse;
    try {
      res = await this.d.client.quote(body);
    } catch (e) {
      if (e instanceof OneClickError && e.status >= 400 && e.status < 500) {
        throw new SpendXError('route_unavailable', `No route is available for this pair right now: ${e.message}`, 422);
      }
      throw e;
    }
    return summarize(res.quote);
  }

  /** Live quote: validates it against the request, then stores the attempt with its deposit address. */
  async createAttempt(slug: string, i: { originAssetId: string; payerAddress: string }): Promise<Attempt> {
    const req = await this.openRequest(slug);
    const src = await this.resolveSource(i.originAssetId, i.payerAddress);

    let live = await this.d.repo.getLiveAttempt(req.id);
    if (live && Date.parse(live.quoteDeadline) <= this.now()) {
      // Past its deadline: ask 1Click what really happened before deciding the request is free again.
      try {
        await this.refresh(live.id);
        live = await this.d.repo.getLiveAttempt(req.id);
      } catch {
        // 1Click unreachable: fall through to the local rules below.
      }
    }
    if (live) {
      const stillOpen = (live.state === 'awaiting_payment' || live.state === 'payment_initiated') && !live.sourceTxHash;
      if (stillOpen && Date.parse(live.quoteDeadline) <= this.now()) {
        await this.d.repo.updateAttempt(live.id, { state: 'expired' });
      } else if (live.state === 'awaiting_payment' && live.payerAddress === i.payerAddress && live.originAssetId === i.originAssetId) {
        return live; // same customer, same choice: resume instead of creating a second deposit address
      } else {
        throw new SpendXError('attempt_in_progress', 'A payment for this request is already in progress', 409, { attemptId: live.id });
      }
    }
    // A deposit can land after the deadline. If 1Click saw one on a recently expired attempt, that attempt is
    // the real one: bring it back instead of opening a second payment (and risking the merchant being paid twice).
    for (const old of await this.d.repo.listAttempts(req.id)) {
      if (!this.canRevive(old)) continue;
      const back = await this.refresh(old.id).catch(() => old);
      if (back.state !== 'expired') {
        throw new SpendXError('attempt_in_progress', 'A payment for this request is already in progress', 409, { attemptId: back.id });
      }
    }

    const body = buildExactOutputQuote({
      dry: false,
      originAssetId: src.assetId,
      destAssetId: req.destAssetId,
      amountOut: req.amount,
      recipient: req.recipient,
      refundTo: i.payerAddress,
      slippageBps: this.d.slippageBps,
      deadlineMinutes: this.d.deadlineMinutes,
      now: new Date(this.now()),
    });
    let res: QuoteResponse;
    try {
      res = await this.d.client.quote(body);
    } catch (e) {
      if (e instanceof OneClickError && e.status >= 400 && e.status < 500) {
        throw new SpendXError('route_unavailable', `No route is available for this pair right now: ${e.message}`, 422);
      }
      throw e;
    }

    if (!this.d.verifyQuoteSignature(res)) {
      throw new SpendXError('bad_quote_signature', 'The quote failed signature verification and was rejected', 502);
    }
    const v = validateLiveQuote(
      {
        destAssetId: req.destAssetId,
        destBlockchain: req.destBlockchain,
        recipient: req.recipient,
        amountOut: req.amount,
        originAssetId: src.assetId,
        originBlockchain: src.blockchain,
        refundTo: i.payerAddress,
      },
      res,
      this.now(),
    );
    if (!v.ok) throw new SpendXError('quote_rejected', 'The quote did not match the payment request and was rejected', 502, v.reasons);

    return this.persistAttempt(req, src, i.payerAddress, res);
  }

  /** One place that turns a validated live quote into a stored attempt (payments and swaps both use it). */
  private persistAttempt(req: PaymentRequest, src: Token, payerAddress: string, res: QuoteResponse): Promise<Attempt> {
    return this.d.repo.createAttempt({
      requestId: req.id,
      originAssetId: src.assetId,
      originBlockchain: src.blockchain,
      originSymbol: src.symbol,
      originDecimals: src.decimals,
      payerAddress,
      payerFamily: familyOf(src.blockchain),
      depositAddress: res.quote.depositAddress!,
      depositMemo: res.quote.depositMemo,
      quote: res,
      quoteDeadline: res.quote.deadline!,
      amountIn: BigInt(res.quote.amountIn),
      walletSigned: false,
      state: 'awaiting_payment',
      verification: 'pending',
      destTxs: [],
      nearTxHashes: [],
      intentHashes: [],
    });
  }

  private async quoteOrThrow(body: QuoteRequestBody): Promise<QuoteResponse> {
    try {
      return await this.d.client.quote(body);
    } catch (e) {
      if (e instanceof OneClickError && e.status >= 400 && e.status < 500) {
        throw new SpendXError('route_unavailable', `No route is available for this pair right now: ${e.message}`, 422);
      }
      throw e;
    }
  }

  // ---------- one-click swaps (exact input: "send 10 SOL, receive whatever it buys, never below the minimum") ----------

  private async resolveSwap(i: SwapInput) {
    const [src, dst] = await Promise.all([this.d.catalog.findToken(i.originAssetId), this.d.catalog.findToken(i.destAssetId)]);
    if (!src || !dst) throw new SpendXError('unknown_asset', 'That asset is not in the NEAR Intents catalog');
    if (src.assetId === dst.assetId) throw new SpendXError('invalid_swap', 'Choose two different tokens');
    let amountIn: bigint;
    try {
      amountIn = toBaseUnits(i.amountHuman, src.decimals);
    } catch (e) {
      throw new SpendXError('invalid_amount', (e as Error).message);
    }
    if (amountIn <= 0n) throw new SpendXError('invalid_amount', 'Amount must be greater than zero');
    const payerChk = validateAddress(src.blockchain, i.payerAddress);
    if (payerChk.status === 'invalid') throw new SpendXError('invalid_payer', `Your ${src.blockchain} address is not valid: ${payerChk.reason}`);
    const recChk = validateAddress(dst.blockchain, i.recipient);
    if (recChk.status === 'invalid') throw new SpendXError('invalid_recipient', recChk.reason);
    if (recChk.status === 'unchecked' && !i.acknowledgeUncheckedAddress) {
      throw new SpendXError('unchecked_recipient', `SpendX cannot validate ${dst.blockchain} addresses yet. Confirm the address is correct to continue.`);
    }
    const slippage = i.slippageBps ?? this.d.slippageBps;
    if (!Number.isInteger(slippage) || slippage < 10 || slippage > 500) {
      throw new SpendXError('invalid_slippage', 'Slippage must be between 0.1% and 5%');
    }
    return { src, dst, amountIn, slippage };
  }

  /** Dry quote for a swap: shows what you would get. Creates nothing and no deposit address. */
  async previewSwap(i: SwapInput): Promise<SwapPreview> {
    const { src, dst, amountIn, slippage } = await this.resolveSwap(i);
    const res = await this.quoteOrThrow(buildExactInputQuote({
      dry: true, originAssetId: src.assetId, destAssetId: dst.assetId, amountIn,
      recipient: i.recipient, refundTo: i.payerAddress, slippageBps: slippage,
      deadlineMinutes: this.d.deadlineMinutes, now: new Date(this.now()),
    }));
    return summarizeSwap(res.quote, dst.decimals, slippage);
  }

  /**
   * Live quote for a swap. Validated against exactly what the user entered, then stored as a swap-kind request
   * whose `amount` is the quote's GUARANTEED MINIMUM output, so delivery checks use the same floor.
   */
  async createSwap(i: SwapInput): Promise<{ request: PaymentRequest; attempt: Attempt }> {
    const { src, dst, amountIn, slippage } = await this.resolveSwap(i);
    const res = await this.quoteOrThrow(buildExactInputQuote({
      dry: false, originAssetId: src.assetId, destAssetId: dst.assetId, amountIn,
      recipient: i.recipient, refundTo: i.payerAddress, slippageBps: slippage,
      deadlineMinutes: this.d.deadlineMinutes, now: new Date(this.now()),
    }));
    if (!this.d.verifyQuoteSignature(res)) {
      throw new SpendXError('bad_quote_signature', 'The quote failed signature verification and was rejected', 502);
    }
    const v = validateLiveQuote(
      { swapType: 'EXACT_INPUT', amountIn, destAssetId: dst.assetId, destBlockchain: dst.blockchain, recipient: i.recipient,
        originAssetId: src.assetId, originBlockchain: src.blockchain, refundTo: i.payerAddress },
      res, this.now(),
    );
    if (!v.ok) throw new SpendXError('quote_rejected', 'The quote did not match your swap and was rejected', 502, v.reasons);

    const request = await this.d.repo.createRequest({
      kind: 'swap',
      slug: randomBytes(12).toString('base64url'),
      merchantAddress: i.payerAddress,
      merchantFamily: familyOf(src.blockchain),
      destAssetId: dst.assetId,
      destBlockchain: dst.blockchain,
      destSymbol: dst.symbol,
      destDecimals: dst.decimals,
      amount: BigInt(res.quote.minAmountOut),
      recipient: i.recipient,
      description: `Swap ${i.amountHuman} ${src.symbol} to ${dst.symbol}`,
      status: 'open',
    });
    try {
      return { request, attempt: await this.persistAttempt(request, src, i.payerAddress, res) };
    } catch (e) {
      await this.d.repo.setRequestStatus(request.id, 'cancelled');
      throw e;
    }
  }

  /** The customer's wallet is now showing the signing prompt. */
  async markSigning(attemptId: string): Promise<Attempt> {
    const a = await this.mustAttempt(attemptId);
    if (a.state !== 'awaiting_payment') return a;
    if (Date.parse(a.quoteDeadline) <= this.now()) {
      return this.d.repo.updateAttempt(a.id, { state: 'expired' });
    }
    return this.d.repo.updateAttempt(a.id, { walletSigned: true, state: 'payment_initiated' });
  }

  /** The customer abandoned the attempt before sending anything. */
  async cancelAttempt(attemptId: string): Promise<Attempt> {
    const a = await this.mustAttempt(attemptId);
    if (a.sourceTxHash || !['awaiting_payment', 'payment_initiated'].includes(a.state)) {
      throw new SpendXError('cannot_cancel', 'A deposit may already have been sent; this attempt cannot be cancelled', 409);
    }
    return this.d.repo.updateAttempt(a.id, { state: 'cancelled' });
  }

  /** Record the source-chain transaction the wallet produced and tell 1Click so it can start sooner. */
  async recordDeposit(attemptId: string, txHash: string, explorerUrl?: string): Promise<Attempt> {
    if (!/^[^\s]{8,200}$/.test(txHash)) throw new SpendXError('invalid_tx', 'Transaction hash looks invalid');
    const a = await this.mustAttempt(attemptId);
    const shape = TX_HASH_SHAPE[familyOf(a.originBlockchain)];
    if (shape && !shape.test(txHash)) throw new SpendXError('invalid_tx', 'Transaction hash does not look like a transaction on the source chain');
    if (a.sourceTxHash) {
      if (a.sourceTxHash === txHash) return a; // idempotent
      throw new SpendXError('duplicate_deposit', 'A different deposit transaction is already recorded for this attempt', 409);
    }
    if (isTerminal(a.state)) throw new SpendXError('attempt_closed', 'This attempt is already closed', 409);
    const updated = await this.d.repo.updateAttempt(a.id, {
      walletSigned: true,
      sourceTxHash: txHash,
      sourceTxUrl: explorerUrl,
      state: 'source_submitted',
    });
    try {
      await this.d.client.submitDeposit({ depositAddress: a.depositAddress, txHash });
    } catch {
      // Optional speed-up per the docs; 1Click also detects deposits by itself. Tracking continues via /status.
    }
    return updated;
  }

  /** Poll 1Click, verify delivery on the destination chain where possible, and advance the state. */
  async refresh(attemptId: string): Promise<Attempt> {
    const a = await this.mustAttempt(attemptId);
    if (isTerminal(a.state) && !this.canRevive(a)) return a;
    const req = (await this.d.repo.getRequestById(a.requestId))!;

    let status;
    try {
      status = await this.d.client.status(a.depositAddress, a.depositMemo);
    } catch (e) {
      if (!(e instanceof OneClickError && e.status === 404)) throw e;
    }

    const sd = status?.swapDetails;
    const destTxs = sd?.destinationChainTxHashes?.length ? sd.destinationChainTxHashes : a.destTxs;
    const sourceTxHash = a.sourceTxHash ?? sd?.originChainTxHashes?.[0]?.hash;
    let verification = a.verification;

    if (status?.status === 'SUCCESS' && verification === 'pending' && destTxs.length > 0) {
      const token = await this.d.catalog.findToken(req.destAssetId);
      const verifier = this.d.verifiers?.[familyOf(req.destBlockchain)];
      if (!token) verification = 'pending';
      else if (!verifier) verification = 'reported'; // cannot verify this chain: delivery is 1Click's report plus tx links
      else {
        try {
          const outcome = await verifier.verify({ token, recipient: req.recipient, minAmount: req.amount, txs: destTxs });
          verification = outcome === 'unverifiable' ? 'reported' : outcome;
        } catch {
          // The destination RPC failed. Never claim delivery on a failed check: stay pending and retry on the next poll,
          // but after a while stop waiting and fall back to the honest "reported" label.
          verification = this.now() - Date.parse(a.createdAt) > UNVERIFIED_FALLBACK_MS ? 'reported' : 'pending';
        }
      }
    }

    const state = derivePaymentState({
      oneClick: status?.status,
      walletSigned: a.walletSigned,
      sourceTxHash,
      verification,
      deadlineMs: Date.parse(a.quoteDeadline),
      nowMs: this.now(),
      claimGraceMs: LATE_DEPOSIT_GRACE_MS,
    });
    if (a.state === 'expired' && !REVIVAL_STATES.has(state)) return a; // nothing new: stay expired

    const wasExpired = a.state === 'expired';
    const patch: Partial<Attempt> = {
      oneClickStatus: status?.status ?? a.oneClickStatus,
      state,
      verification,
      sourceTxHash,
      sourceTxUrl: a.sourceTxUrl ?? sd?.originChainTxHashes?.[0]?.explorerUrl,
      destTxs,
      nearTxHashes: sd?.nearTxHashes ?? a.nearTxHashes,
      intentHashes: sd?.intentHashes ?? a.intentHashes,
      refund: status?.status === 'REFUNDED' || sd?.refundedAmount
        ? { amount: sd?.refundedAmount, amountFormatted: sd?.refundedAmountFormatted, reason: sd?.refundReason }
        : a.refund,
    };
    let updated: Attempt;
    try {
      updated = await this.d.repo.updateAttempt(a.id, patch);
    } catch (e) {
      // Reviving an expired attempt can collide with a newer live one (unique index): keep the old row then.
      if (wasExpired) return a;
      throw e;
    }
    if (state === 'destination_confirmed') await this.d.repo.setRequestStatus(req.id, 'paid');
    return updated;
  }

  /** An expired attempt is still worth polling for a while: a late deposit may yet be delivered or refunded. */
  private canRevive(a: Attempt): boolean {
    return a.state === 'expired' && this.now() < Date.parse(a.quoteDeadline) + LATE_DEPOSIT_GRACE_MS;
  }

  /**
   * Background pass: ask NEAR Intents about every attempt that could still change, so payments finish (and requests
   * flip to "paid") even when nobody has the page open. Safe to run repeatedly and alongside the status endpoint.
   */
  async reconcile(opts: { limit?: number; concurrency?: number } = {}): Promise<{ checked: number; failed: number }> {
    const cutoff = new Date(this.now() - LATE_DEPOSIT_GRACE_MS).toISOString();
    const todo = (await this.d.repo.listReconcilable(cutoff, opts.limit ?? 50)).filter((a) => this.shouldPoll(a));
    let failed = 0;
    let next = 0;
    const worker = async () => {
      for (let a = todo[next++]; a; a = todo[next++]) {
        try { await this.refresh(a.id); } catch { failed++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, todo.length) }, worker));
    return { checked: todo.length, failed };
  }

  /** Whether the status endpoint should ask 1Click about this attempt. */
  shouldPoll(a: Attempt): boolean {
    return !isTerminal(a.state) || this.canRevive(a);
  }

  private async mustAttempt(id: string): Promise<Attempt> {
    const a = await this.d.repo.getAttempt(id);
    if (!a) throw new SpendXError('not_found', 'Payment attempt not found', 404);
    return a;
  }
}

function summarize(q: Quote): QuotePreview {
  return {
    amountInFormatted: q.amountInFormatted,
    amountOutFormatted: q.amountOutFormatted,
    amountInUsd: q.amountInUsd,
    amountOutUsd: q.amountOutUsd,
    estimatedCostUsd: Math.max(0, Number(q.amountInUsd) - Number(q.amountOutUsd)),
    timeEstimateSeconds: q.timeEstimate,
    refundFee: q.refundFee,
    withdrawFee: q.withdrawFee,
    minAmountIn: q.minAmountIn,
  };
}

function summarizeSwap(q: Quote, destDecimals: number, slippageBps: number): SwapPreview {
  let min = q.minAmountOut;
  try { min = fromBaseUnits(BigInt(q.minAmountOut), destDecimals); } catch { /* keep raw */ }
  return {
    amountInFormatted: q.amountInFormatted,
    amountInUsd: q.amountInUsd,
    estimatedOutFormatted: q.amountOutFormatted,
    minOutFormatted: min,
    amountOutUsd: q.amountOutUsd,
    estimatedCostUsd: Math.max(0, Number(q.amountInUsd) - Number(q.amountOutUsd)),
    timeEstimateSeconds: q.timeEstimate,
    slippageBps,
    refundFee: q.refundFee,
    withdrawFee: q.withdrawFee,
  };
}
