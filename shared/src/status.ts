import type { OneClickStatus } from './types.ts';

/** Delivery verification result, per destination chain family (see DestinationVerifier). */
export type Verification =
  | 'pending'   // 1Click says SUCCESS but we have not confirmed on the destination chain yet
  | 'verified'  // SpendX independently confirmed the transfer on the destination chain
  | 'reported'  // no verifier for this chain: delivery is 1Click's report plus a tx hash/explorer link
  | 'mismatch'; // verifier looked and the transfer did not match (wrong recipient/amount/asset)

export type PaymentState =
  | 'awaiting_payment'      // quote accepted, nothing signed yet
  | 'payment_initiated'     // customer is authorizing in their wallet / tx being broadcast
  | 'source_submitted'      // deposit transaction exists (known to us or detected by 1Click)
  | 'processing'            // 1Click is executing the cross-chain transfer
  | 'destination_confirmed' // delivered; see Verification for how strongly
  | 'incomplete_deposit'    // deposit below required amount; refund pending
  | 'refunded'
  | 'failed'
  | 'expired'               // deadline passed with no deposit
  | 'cancelled'             // customer abandoned the attempt before depositing
  | 'needs_review';         // 1Click said SUCCESS but the destination check disagreed

export interface StateInput {
  oneClick?: OneClickStatus;
  /** true once the customer's wallet has produced a signature / broadcast request */
  walletSigned: boolean;
  /** source-chain tx hash we know about (from the wallet or from 1Click status) */
  sourceTxHash?: string | null;
  verification: Verification;
  /** quote deadline, epoch ms */
  deadlineMs?: number;
  nowMs: number;
  /**
   * How long past the deadline an unconfirmed client-reported deposit hash may keep an attempt open.
   * The hash is supplied by the browser, so on its own it must not hold a request forever; 1Click's own
   * status (KNOWN_DEPOSIT_TX / PROCESSING / ...) is what confirms a deposit. Undefined = no limit.
   */
  claimGraceMs?: number;
}

export function derivePaymentState(i: StateInput): PaymentState {
  switch (i.oneClick) {
    case 'SUCCESS':
      if (i.verification === 'mismatch') return 'needs_review';
      // Never claim success until delivery is confirmed (verified) or, for unverifiable chains, reported.
      return i.verification === 'pending' ? 'processing' : 'destination_confirmed';
    case 'REFUNDED':
      return 'refunded';
    case 'FAILED':
      return 'failed';
    case 'INCOMPLETE_DEPOSIT':
      return 'incomplete_deposit';
    case 'PROCESSING':
      return 'processing';
    case 'KNOWN_DEPOSIT_TX':
      return 'source_submitted';
    case 'PENDING_DEPOSIT':
    case undefined:
    default: {
      const pastDeadline = i.deadlineMs !== undefined && i.nowMs > i.deadlineMs;
      if (i.sourceTxHash) {
        // 1Click has not seen a deposit for this hash. Give a real deposit time to be detected, then let go.
        if (pastDeadline && i.claimGraceMs !== undefined && i.nowMs > i.deadlineMs! + i.claimGraceMs) return 'expired';
        return 'source_submitted';
      }
      if (pastDeadline) return 'expired';
      return i.walletSigned ? 'payment_initiated' : 'awaiting_payment';
    }
  }
}

export const TERMINAL_STATES: ReadonlySet<PaymentState> = new Set([
  'destination_confirmed', 'refunded', 'failed', 'expired', 'cancelled', 'needs_review',
]);

export function isTerminal(s: PaymentState): boolean {
  return TERMINAL_STATES.has(s);
}

/** States that free the request for a new attempt (mirrors the partial unique index in the SQL migration). */
export const RETRYABLE_STATES: ReadonlySet<PaymentState> = new Set(['failed', 'refunded', 'expired', 'cancelled']);

export const STATE_LABEL: Record<PaymentState, string> = {
  awaiting_payment: 'Awaiting payment',
  payment_initiated: 'Payment initiated',
  source_submitted: 'Source transaction submitted',
  processing: 'Processing cross-chain transfer',
  destination_confirmed: 'Destination payment confirmed',
  incomplete_deposit: 'Deposit incomplete, refund pending',
  refunded: 'Refunded',
  failed: 'Failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  needs_review: 'Needs review',
};
