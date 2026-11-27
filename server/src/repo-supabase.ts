import { isEvmAddress } from '../../shared/src/addresses.ts';
import { SpendXError } from './domain.ts';
import type { AlertJob, AlertKind, Attempt, MerchantContact, PaymentRequest, Repository } from './domain.ts';

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
    // EVM addresses are case-insensitive (checksummed vs lowercase), so a merchant sees the same history whichever way their wallet writes the address.
    const base = this.db.from('payment_requests').select('*');
    const res: QueryResult = await (isEvmAddress(address) ? base.ilike('merchant_address', address) : base.eq('merchant_address', address)).order('created_at', { ascending: false });
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
  async listAttemptsByPayer(address: string, limit: number) {
    let q = this.db.from('payment_attempts').select('*');
    // EVM addresses are case-insensitive (checksummed vs lowercase); Solana (base58) addresses are case-sensitive.
    // ilike treats % and _ as wildcards, so it is only used for a strictly valid 0x address.
    q = isEvmAddress(address) ? q.ilike('payer_address', address) : q.eq('payer_address', address);
    const res: QueryResult = await q.order('created_at', { ascending: false }).limit(limit);
    this.check(res, 'listing attempts by payer');
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

  // ----- merchant alerts -----
  async getMerchantContact(merchantKey: string) {
    const res: QueryResult = await this.db.from('merchant_contacts').select('*').eq('merchant_key', merchantKey).maybeSingle();
    this.check(res, 'loading a merchant contact');
    return res.data ? rowToContact(res.data) : null;
  }
  async saveMerchantContact(c: MerchantContact) {
    this.check(await this.db.from('merchant_contacts').upsert(contactToRow(c), { onConflict: 'merchant_key' }), 'saving a merchant contact');
  }
  async deleteMerchantContact(merchantKey: string) {
    this.check(await this.db.from('merchant_contacts').delete().eq('merchant_key', merchantKey), 'deleting a merchant contact');
  }
  async enqueueAlert(a: { attemptId: string; requestId: string; merchantKey: string; kind: AlertKind }) {
    // The unique (attempt_id, kind) index makes a second insert a no-op, so an alert can never go out twice.
    this.check(
      await this.db.from('alert_outbox').upsert({ attempt_id: a.attemptId, request_id: a.requestId, merchant_key: a.merchantKey, kind: a.kind }, { onConflict: 'attempt_id,kind', ignoreDuplicates: true }),
      'queueing an alert',
    );
  }
  async claimAlerts(nowIso: string, lockUntilIso: string, limit: number) {
    const due: QueryResult = await this.db.from('alert_outbox').select('*').eq('status', 'pending').lte('next_try_at', nowIso).order('created_at', { ascending: true }).limit(limit);
    this.check(due, 'listing due alerts');
    const claimed: AlertJob[] = [];
    for (const row of due.data as Row[]) {
      // Compare-and-set: only the run that moves next_try_at forward gets the job.
      const res: QueryResult = await this.db.from('alert_outbox').update({ next_try_at: lockUntilIso }).eq('id', row.id).eq('status', 'pending').lte('next_try_at', nowIso).select();
      this.check(res, 'claiming an alert');
      if ((res.data as Row[]).length > 0) claimed.push(rowToAlert((res.data as Row[])[0]));
    }
    return claimed;
  }
  async finishAlert(id: string, patch: { status: AlertJob['status']; tries: number; nextTryAt?: string; lastError?: string }) {
    const row: Row = { status: patch.status, tries: patch.tries, last_error: patch.lastError ?? null };
    if (patch.nextTryAt) row.next_try_at = patch.nextTryAt;
    if (patch.status === 'sent') row.sent_at = new Date().toISOString();
    this.check(await this.db.from('alert_outbox').update(row).eq('id', id), 'updating an alert');
  }
}

const contactToRow = (c: MerchantContact): Row => ({
  merchant_key: c.merchantKey, email: c.email, verified_at: c.verifiedAt ?? null,
  code_hash: c.codeHash ?? null, code_expires_at: c.codeExpiresAt ?? null, code_attempts: c.codeAttempts,
  last_code_at: c.lastCodeAt ?? null, code_sends: c.codeSends, code_window_start: c.codeWindowStart ?? null,
  updated_at: new Date().toISOString(),
});
const rowToContact = (x: Row): MerchantContact => ({
  merchantKey: x.merchant_key, email: x.email, verifiedAt: x.verified_at ?? undefined,
  codeHash: x.code_hash ?? undefined, codeExpiresAt: x.code_expires_at ?? undefined, codeAttempts: x.code_attempts ?? 0,
  lastCodeAt: x.last_code_at ?? undefined, codeSends: x.code_sends ?? 0, codeWindowStart: x.code_window_start ?? undefined,
});
const rowToAlert = (x: Row): AlertJob => ({
  id: x.id, attemptId: x.attempt_id, requestId: x.request_id, merchantKey: x.merchant_key, kind: x.kind,
  status: x.status, tries: x.tries, nextTryAt: x.next_try_at, lastError: x.last_error ?? undefined,
});
