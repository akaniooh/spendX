import type { WalletFamily } from '../../shared/src/chains.ts';
import type { PaymentState, Verification } from '../../shared/src/status.ts';
import type { QuoteResponse, TxDetails } from '../../shared/src/types.ts';

export interface PaymentRequest {
  id: string;
  slug: string;
  /** 'payment': merchant request (exact output). 'swap': a customer's own one-click swap (exact input). */
  kind: 'payment' | 'swap';
  merchantAddress: string;
  merchantFamily: WalletFamily;
  destAssetId: string;
  destBlockchain: string;
  destSymbol: string;
  destDecimals: number;
  amount: bigint; // base units of the destination asset
  recipient: string;
  description?: string;
  status: 'open' | 'paid' | 'cancelled';
  createdAt: string;
}

export interface Attempt {
  id: string;
  requestId: string;
  originAssetId: string;
  originBlockchain: string;
  originSymbol: string;
  originDecimals: number;
  payerAddress: string;
  payerFamily: WalletFamily;
  depositAddress: string;
  depositMemo?: string;
  quote: QuoteResponse;
  quoteDeadline: string;
  amountIn: bigint;
  walletSigned: boolean;
  sourceTxHash?: string;
  sourceTxUrl?: string;
  oneClickStatus?: string;
  state: PaymentState;
  verification: Verification;
  destTxs: TxDetails[];
  nearTxHashes: string[];
  intentHashes: string[];
  refund?: { amount?: string; amountFormatted?: string; reason?: string };
  createdAt: string;
  updatedAt: string;
}

/** A merchant's alert email. It only receives alerts once `verifiedAt` is set (the merchant typed back a code we emailed). */
export interface MerchantContact {
  /** walletKey() of the merchant's address */
  merchantKey: string;
  email: string;
  verifiedAt?: string;
  /** HMAC of the emailed code; the code itself is never stored */
  codeHash?: string;
  codeExpiresAt?: string;
  codeAttempts: number;
  lastCodeAt?: string;
  /** codes sent in the current hour, to stop someone using us to spam an address */
  codeSends: number;
  codeWindowStart?: string;
}

export type AlertKind = 'paid' | 'failed' | 'refunded';

/** One email to send. Saved to the database first, so a restart or a sleeping server never loses an alert. */
export interface AlertJob {
  id: string;
  attemptId: string;
  requestId: string;
  merchantKey: string;
  kind: AlertKind;
  status: 'pending' | 'sent' | 'skipped' | 'dead';
  tries: number;
  nextTryAt: string;
  lastError?: string;
}

export class SpendXError extends Error {
  code: string;
  httpStatus: number;
  details?: unknown;
  constructor(code: string, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.name = 'SpendXError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export interface Repository {
  createRequest(r: Omit<PaymentRequest, 'id' | 'createdAt'>): Promise<PaymentRequest>;
  getRequestBySlug(slug: string): Promise<PaymentRequest | null>;
  getRequestById(id: string): Promise<PaymentRequest | null>;
  setRequestStatus(id: string, status: PaymentRequest['status']): Promise<void>;
  listRequestsByMerchant(address: string): Promise<PaymentRequest[]>;
  /** Throws SpendXError('attempt_in_progress') when the request already has a live attempt. */
  createAttempt(a: Omit<Attempt, 'id' | 'createdAt' | 'updatedAt'>): Promise<Attempt>;
  getAttempt(id: string): Promise<Attempt | null>;
  getLiveAttempt(requestId: string): Promise<Attempt | null>;
  updateAttempt(id: string, patch: Partial<Attempt>): Promise<Attempt>;
  listAttempts(requestId: string): Promise<Attempt[]>;
  /** Attempts made by this paying wallet (swaps and payments), newest first. Backs the cross-device Activity list. */
  listAttemptsByPayer(address: string, limit: number): Promise<Attempt[]>;
  /**
   * Attempts the background reconciler should ask NEAR Intents about: everything not yet in a final state, plus attempts
   * that expired after `cutoffIso` (a late deposit can still arrive). Oldest-updated first, at most `limit`.
   */
  listReconcilable(cutoffIso: string, limit: number): Promise<Attempt[]>;

  // ----- merchant alerts -----
  getMerchantContact(merchantKey: string): Promise<MerchantContact | null>;
  saveMerchantContact(c: MerchantContact): Promise<void>;
  deleteMerchantContact(merchantKey: string): Promise<void>;
  /** Adds a job unless one already exists for this attempt and kind (that is what makes every alert go out once). */
  enqueueAlert(a: { attemptId: string; requestId: string; merchantKey: string; kind: AlertKind }): Promise<void>;
  /** Takes up to `limit` due jobs and hides them until `lockUntilIso`, so two runs never send the same one. */
  claimAlerts(nowIso: string, lockUntilIso: string, limit: number): Promise<AlertJob[]>;
  finishAlert(id: string, patch: { status: AlertJob['status']; tries: number; nextTryAt?: string; lastError?: string }): Promise<void>;
}
