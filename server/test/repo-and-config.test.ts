import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptToRow, rowToAttempt, requestToRow, rowToRequest } from '../src/repo-supabase.ts';
import { loadConfig } from '../src/config.ts';
import type { Attempt } from '../src/domain.ts';

test('large amounts survive the database mapping exactly (no float rounding)', () => {
  const big = 123456789012345678901234567890n; // far beyond 2^53
  const req = rowToRequest({ ...requestToRow({ kind: 'payment', slug: 's', merchantAddress: 'm', merchantFamily: 'evm', destAssetId: 'a', destBlockchain: 'near', destSymbol: 'wNEAR', destDecimals: 24, amount: big, recipient: 'r', status: 'open' }), id: 'i', created_at: 'c' });
  assert.equal(req.amount, big);
  assert.equal(typeof requestToRow({ kind: 'payment', slug: 's', merchantAddress: 'm', merchantFamily: 'evm', destAssetId: 'a', destBlockchain: 'near', destSymbol: 'x', destDecimals: 24, amount: big, recipient: 'r', status: 'open' }).amount_base_units, 'string');
});

test('attempt row mapping round-trips and patches only touch given columns', () => {
  const a: Omit<Attempt, 'id' | 'createdAt' | 'updatedAt'> = {
    requestId: 'r', originAssetId: 'o', originBlockchain: 'sol', originSymbol: 'SOL', originDecimals: 9, payerAddress: 'p', payerFamily: 'svm',
    depositAddress: 'd', quote: { signature: 'sig', quoteRequest: {} as never, quote: {} as never }, quoteDeadline: '2026-11-04T12:10:00Z',
    amountIn: 10_707_496n, walletSigned: false, state: 'awaiting_payment', verification: 'pending', destTxs: [], nearTxHashes: [], intentHashes: [],
  };
  const row = attemptToRow(a);
  assert.equal(row.amount_in, '10707496');
  assert.equal(row.quote_signature, 'sig');
  const back = rowToAttempt({ ...row, id: 'i', created_at: 'c', updated_at: 'u', deposit_memo: null, source_tx_hash: null });
  assert.equal(back.amountIn, 10_707_496n);
  assert.equal(back.depositMemo, undefined);
  assert.equal(back.sourceTxHash, undefined);
  assert.deepEqual(attemptToRow({ state: 'processing' }), { state: 'processing' });
  assert.deepEqual(attemptToRow({ sourceTxHash: 'h', oneClickStatus: 'PROCESSING' }), { source_tx_hash: 'h', oneclick_status: 'PROCESSING' });
});

test('config fails fast on unsafe or incomplete settings', () => {
  const good = { SESSION_SECRET: 'z'.repeat(32), SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  assert.equal(loadConfig(good).port, 8787);
  assert.throws(() => loadConfig({ ...good, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ SESSION_SECRET: good.SESSION_SECRET }), /SUPABASE_URL/);
  assert.throws(() => loadConfig({ ...good, REPOSITORY: 'memory', NODE_ENV: 'production' }), /development only/);
  assert.equal(loadConfig({ SESSION_SECRET: good.SESSION_SECRET, REPOSITORY: 'memory' }).repository, 'memory');
  assert.throws(() => loadConfig({ ...good, SLIPPAGE_BPS: '99999' }), /SLIPPAGE_BPS/);
  assert.throws(() => loadConfig({ ...good, REPOSITORY: 'mongo' }), /REPOSITORY/);
});

test('database: the reconciler query asks for open attempts and recently expired ones, merged oldest-first and capped', async () => {
  const { SupabaseRepository } = await import('../src/repo-supabase.ts');
  const baseRow = (id: string, state: string, updated: string) => ({
    id, request_id: 'r', origin_asset_id: 'o', origin_blockchain: 'sol', origin_symbol: 'SOL', origin_decimals: 9, payer_address: 'p', payer_family: 'svm',
    deposit_address: id, quote: {}, quote_deadline: '2026-11-04T12:10:00Z', amount_in: '1', wallet_signed: false, state, verification: 'pending',
    dest_txs: [], near_tx_hashes: [], intent_hashes: [], created_at: 'c', updated_at: updated,
  });
  const seen: string[][] = [];
  const results = [
    [baseRow('b', 'processing', '2026-11-04T12:03:00Z'), baseRow('d', 'awaiting_payment', '2026-11-04T12:05:00Z')],
    [baseRow('a', 'expired', '2026-11-04T12:01:00Z')],
  ];
  const db = {
    from(table: string) {
      const calls: string[] = [`from:${table}`];
      const b: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') { seen.push(calls); const data = results.shift(); return (res: (v: unknown) => void) => res({ data, error: null }); }
          return (...args: unknown[]) => { calls.push(`${prop}:${args.map(String).join(',')}`); return b; };
        },
      });
      return b;
    },
  };
  const out = await new SupabaseRepository(db as never).listReconcilable('2026-11-04T11:30:00.000Z', 2);
  assert.deepEqual(out.map((a) => a.id), ['a', 'b'], 'oldest-updated first, capped at the limit');
  assert.ok(seen[0].includes('not:state,in,(destination_confirmed,failed,refunded,cancelled,needs_review,expired)'));
  assert.ok(seen[1].includes('eq:state,expired') && seen[1].includes('gte:quote_deadline,2026-11-04T11:30:00.000Z'));
  assert.ok(seen.every((c) => c.some((x) => x.startsWith('limit:2'))));
});
