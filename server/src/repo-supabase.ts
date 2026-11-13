import { SpendXError } from './domain.ts';
import type { Attempt, PaymentRequest, Repository } from './domain.ts';

// Minimal structural type for the parts of @supabase/supabase-js we use, so this file does not import it
// (the server entry point creates the client and passes it in).
type Row = Record<string, any>;
interface QueryResult { data: any; error: { code?: string; message: string } | null }
export interface SupabaseLike {
  from(table: string): any;
}

export const requestToRow = (r: Omit<PaymentRequest, 'id' | 'createdAt'>): Row => ({
  slug: r.slug,
  kind: r.kind,
  merchant_address: r.merchantAddress,
  merchant_family: r.merchantFamily,
  dest_asset_id: r.destAssetId,
  dest_blockchain: r.destBlockchain,
  dest_symbol: r.destSymbol,
  dest_decimals: r.destDecimals,
  amount_base_units: r.amount.toString(), // text column: never a JSON number
  recipient: r.recipient,
  description: r.description ?? null,
  status: r.status,
});

export const rowToRequest = (x: Row): PaymentRequest => ({
  id: x.id,
  slug: x.slug,
  kind: x.kind ?? 'payment',
  merchantAddress: x.merchant_address,
  merchantFamily: x.merchant_family,
  destAssetId: x.dest_asset_id,
  destBlockchain: x.dest_blockchain,
  destSymbol: x.dest_symbol,
  destDecimals: x.dest_decimals,
  amount: BigInt(x.amount_base_units),
  recipient: x.recipient,
  description: x.description ?? undefined,
  status: x.status,
  createdAt: x.created_at,
});

const ATTEMPT_COLUMNS: Record<string, string> = {
  requestId: 'request_id', originAssetId: 'origin_asset_id', originBlockchain: 'origin_blockchain',
  originSymbol: 'origin_symbol', originDecimals: 'origin_decimals', payerAddress: 'payer_address',
  payerFamily: 'payer_family', depositAddress: 'deposit_address', depositMemo: 'deposit_memo', quote: 'quote',
  quoteDeadline: 'quote_deadline', amountIn: 'amount_in', walletSigned: 'wallet_signed',
  sourceTxHash: 'source_tx_hash', sourceTxUrl: 'source_tx_url', oneClickStatus: 'oneclick_status',
  state: 'state', verification: 'verification', destTxs: 'dest_txs', nearTxHashes: 'near_tx_hashes',
  intentHashes: 'intent_hashes', refund: 'refund',
};

/** Partial<Attempt> -> DB columns. Only keys that are present are written. */
export function attemptToRow(a: Partial<Attempt>): Row {
  const row: Row = {};
  for (const [k, v] of Object.entries(a)) {
    const col = ATTEMPT_COLUMNS[k];
    if (!col || v === undefined) continue;
    row[col] = k === 'amountIn' ? (v as bigint).toString() : v;
  }
  if (a.quote) row.quote_signature = a.quote.signature ?? null;
  return row;
}

export const rowToAttempt = (x: Row): Attempt => ({
  id: x.id,
  requestId: x.request_id,
  originAssetId: x.origin_asset_id,
  originBlockchain: x.origin_blockchain,
  originSymbol: x.origin_symbol,
  originDecimals: x.origin_decimals,
  payerAddress: x.payer_address,
  payerFamily: x.payer_family,
  depositAddress: x.deposit_address,
  depositMemo: x.deposit_memo ?? undefined,
  quote: x.quote,
  quoteDeadline: x.quote_deadline,
  amountIn: BigInt(x.amount_in),
  walletSigned: x.wallet_signed,
  sourceTxHash: x.source_tx_hash ?? undefined,
  sourceTxUrl: x.source_tx_url ?? undefined,
  oneClickStatus: x.oneclick_status ?? undefined,
  state: x.state,
  verification: x.verification,
  destTxs: x.dest_txs ?? [],
  nearTxHashes: x.near_tx_hashes ?? [],
  intentHashes: x.intent_hashes ?? [],
  refund: x.refund ?? undefined,
  createdAt: x.created_at,
  updatedAt: x.updated_at,
});

const RETRYABLE = "(failed,refunded,expired,cancelled)";
// States the reconciler never revisits; "expired" is handled separately because it only counts for a while.
const NOT_RECONCILED = "(destination_confirmed,failed,refunded,cancelled,needs_review,expired)";

export class SupabaseRepository implements Repository {
  private db: SupabaseLike;
  constructor(db: SupabaseLike) {
    this.db = db;
  }

  private check(res: QueryResult, what: string) {
    if (res.error) throw new Error(`Database error while ${what}: ${res.error.message}`);
  }

  async createRequest(r: Omit<PaymentRequest, 'id' | 'createdAt'>) {
    const res: QueryResult = await this.db.from('payment_requests').insert(requestToRow(r)).select().single();
    this.check(res, 'creating a payment request');
    return rowToRequest(res.data);
  }
  async getRequestBySlug(slug: string) {
    const res: QueryResult = await this.db.from('payment_requests').select('*').eq('slug', slug).maybeSingle();
    this.check(res, 'loading a payment request');
    return res.data ? rowToRequest(res.data) : null;
  }
  async getRequestById(id: string) {
    const res: QueryResult = await this.db.from('payment_requests').select('*').eq('id', id).maybeSingle();
    this.check(res, 'loading a payment request');
    return res.data ? rowToRequest(res.data) : null;
  }
  async setRequestStatus(id: string, status: PaymentRequest['status']) {
    this.check(await this.db.from('payment_requests').update({ status }).eq('id', id), 'updating a payment request');
  }
  async listRequestsByMerchant(address: string) {
    const res: QueryResult = await this.db.from('payment_requests').select('*').eq('merchant_address', address).order('created_at', { ascending: false });
    this.check(res, 'listing payment requests');
    return (res.data as Row[]).map(rowToRequest);
  }
  async createAttempt(a: Omit<Attempt, 'id' | 'createdAt' | 'updatedAt'>) {
    const res: QueryResult = await this.db.from('payment_attempts').insert(attemptToRow(a)).select().single();
    if (res.error?.code === '23505') {
      // the partial unique index one_live_attempt_per_request (or the unique deposit address)
      throw new SpendXError('attempt_in_progress', 'This payment already has a live attempt', 409);
    }
    this.check(res, 'creating a payment attempt');
    return rowToAttempt(res.data);
  }
  async getAttempt(id: string) {
    const res: QueryResult = await this.db.from('payment_attempts').select('*').eq('id', id).maybeSingle();
    this.check(res, 'loading a payment attempt');
    return res.data ? rowToAttempt(res.data) : null;
  }
  async getLiveAttempt(requestId: string) {
    const res: QueryResult = await this.db.from('payment_attempts').select('*').eq('request_id', requestId).not('state', 'in', RETRYABLE).maybeSingle();
    this.check(res, 'loading the live attempt');
    return res.data ? rowToAttempt(res.data) : null;
  }
  async updateAttempt(id: string, patch: Partial<Attempt>) {
    const res: QueryResult = await this.db.from('payment_attempts').update({ ...attemptToRow(patch), updated_at: new Date().toISOString() }).eq('id', id).select().single();
    this.check(res, 'updating a payment attempt');
    return rowToAttempt(res.data);
  }
  async listAttempts(requestId: string) {
    const res: QueryResult = await this.db.from('payment_attempts').select('*').eq('request_id', requestId).order('created_at', { ascending: false });
    this.check(res, 'listing payment attempts');
    return (res.data as Row[]).map(rowToAttempt);
  }
  async listReconcilable(cutoffIso: string, limit: number) {
    const open: QueryResult = await this.db.from('payment_attempts').select('*').not('state', 'in', NOT_RECONCILED).order('updated_at', { ascending: true }).limit(limit);
    this.check(open, 'listing open attempts');
    const late: QueryResult = await this.db.from('payment_attempts').select('*').eq('state', 'expired').gte('quote_deadline', cutoffIso).order('updated_at', { ascending: true }).limit(limit);
    this.check(late, 'listing recently expired attempts');
    return [...(open.data as Row[]), ...(late.data as Row[])]
      .map(rowToAttempt)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, limit);
  }
}
