import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeDeposit } from '../src/lib/execute.ts';
import type { WalletAdapter } from '../../shared/src/adapters.ts';
import type { Token } from '../../shared/src/types.ts';
import type { AttemptView } from '../src/lib/types.ts';

const TOKEN: Token = { assetId: 'nep141:sol.omft.near', decimals: 9, blockchain: 'sol', symbol: 'SOL' };
const NOW = Date.parse('2026-11-06T12:00:00Z');
const attempt = (over: Record<string, unknown> = {}): AttemptView => ({
  id: 'att-1', origin: { assetId: TOKEN.assetId, blockchain: 'sol', symbol: 'SOL', decimals: 9 },
  deposit: { address: 'DEPOSIT', memo: null, amount: '10000000000', amountFormatted: '10', deadline: '2026-11-06T12:10:00Z' }, ...over,
} as unknown as AttemptView);

function harness(o: { balance?: bigint; sendFails?: boolean; recordFails?: boolean; noHash?: boolean } = {}) {
  const log: string[] = [];
  const adapter = {
    family: 'svm', supportsChain: () => true, connect: async () => ({ address: 'a' }), disconnect: async () => {}, getAddress: () => 'a',
    getBalance: async () => { log.push('balance'); return o.balance ?? 20_000_000_000n; },
    sendDeposit: async (r: { amount: bigint; depositAddress: string }) => {
      log.push(`send:${r.amount}:${r.depositAddress}`);
      if (o.sendFails) throw new Error('wallet rejected');
      return { txHash: o.noHash ? '' : 'TXHASH0001' };
    },
    explorerTxUrl: (_b: string, h: string) => `https://explorer/${h}`,
  } as unknown as WalletAdapter;
  const api = {
    signing: async () => { log.push('signing'); },
    deposit: async (_id: string, b: { txHash: string; explorerUrl?: string }) => { log.push(`record:${b.txHash}:${b.explorerUrl}`); if (o.recordFails) throw new Error('network'); },
  };
  return { log, adapter, api };
}

test('happy path: checks, marks signing, sends exactly the quoted amount to the deposit address, records the hash', async () => {
  const h = harness();
  const r = await executeDeposit({ attempt: attempt(), adapter: h.adapter, token: TOKEN, api: h.api, now: NOW });
  assert.equal(r.txHash, 'TXHASH0001');
  assert.deepEqual(h.log, ['balance', 'signing', 'send:10000000000:DEPOSIT', 'record:TXHASH0001:https://explorer/TXHASH0001']);
});

test('refuses before touching the wallet: expired quote, insufficient balance, mismatched token', async () => {
  for (const [name, a, o, msg] of [
    ['expired', attempt(), {}, /expired/],
    ['balance', attempt(), { balance: 5n }, /Insufficient balance/],
    ['mismatch', attempt({ origin: { assetId: 'nep141:other', blockchain: 'sol', symbol: 'X', decimals: 9 } }), {}, /no longer matches/],
  ] as const) {
    const h = harness(o);
    await assert.rejects(executeDeposit({ attempt: a, adapter: h.adapter, token: TOKEN, api: h.api, now: name === 'expired' ? NOW + 11 * 60_000 : NOW }), msg, name);
    assert.ok(!h.log.some((l) => l.startsWith('send')), `${name}: nothing may be sent`);
    assert.ok(!h.log.includes('signing'), `${name}: must not mark signing`);
  }
});

test('a wallet rejection records nothing; a failed record call does not hide the fact that funds were sent', async () => {
  const h1 = harness({ sendFails: true });
  await assert.rejects(executeDeposit({ attempt: attempt(), adapter: h1.adapter, token: TOKEN, api: h1.api, now: NOW }), /wallet rejected/);
  assert.ok(!h1.log.some((l) => l.startsWith('record')));
  const h2 = harness({ recordFails: true });
  const r = await executeDeposit({ attempt: attempt(), adapter: h2.adapter, token: TOKEN, api: h2.api, now: NOW });
  assert.equal(r.txHash, 'TXHASH0001');
});

test('a wallet that sends but returns no hash is not treated as a failure, and nothing is recorded', async () => {
  const h = harness({ noHash: true });
  const r = await executeDeposit({ attempt: attempt(), adapter: h.adapter, token: TOKEN, api: h.api, now: NOW });
  assert.equal(r.txHash, '');
  assert.ok(h.log.some((l) => l.startsWith('send')));
  assert.ok(!h.log.some((l) => l.startsWith('record')));
});

test('the expiry check uses the server clock, so a wrong PC clock cannot hide an expired quote (or block a fresh one)', async () => {
  const { setClockOffset } = await import('../src/lib/clock.ts');
  const deadline = Date.parse(attempt().deposit.deadline);
  try {
    // by the server's clock the quote expired 5 minutes ago, although the PC's own clock may say anything
    setClockOffset(deadline + 5 * 60_000 - Date.now());
    const late = harness();
    await assert.rejects(executeDeposit({ attempt: attempt(), adapter: late.adapter, token: TOKEN, api: late.api }), /expired/);
    assert.deepEqual(late.log, [], 'the wallet is never touched');
    // by the server's clock there is still a minute left: signing goes ahead
    setClockOffset(deadline - 60_000 - Date.now());
    const fresh = harness();
    const r = await executeDeposit({ attempt: attempt(), adapter: fresh.adapter, token: TOKEN, api: fresh.api });
    assert.equal(r.txHash, 'TXHASH0001');
  } finally {
    setClockOffset(0);
  }
});
