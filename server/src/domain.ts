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
}
