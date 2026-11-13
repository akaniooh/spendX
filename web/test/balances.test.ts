import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBalances, balanceLabel, type BalanceTarget } from '../src/lib/balances.ts';
import type { WalletAdapter } from '../../shared/src/adapters.ts';
import type { WalletFamily } from '../../shared/src/chains.ts';
import type { Token } from '../../shared/src/types.ts';

const T = (assetId: string, blockchain: string, symbol: string, decimals: number, contractAddress: string | null = null): BalanceTarget => ({ assetId, blockchain, symbol, decimals, contractAddress });
const USDC_BASE = T('base-usdc', 'base', 'USDC', 6, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const SOL = T('sol', 'sol', 'SOL', 9);

function adapter(family: WalletFamily, balances: Record<string, bigint | Error | 'hang'>, supports: (c: string) => boolean = () => true) {
  const asked: Token[] = [];
  const a = {
    family, supportsChain: supports,
    getBalance: async (t: Token) => {
      asked.push(t);
      const v = balances[t.assetId];
      if (v === 'hang') return new Promise<bigint>(() => {});
      if (v instanceof Error) throw v;
      if (v === undefined) throw new Error('unexpected token');
      return v;
    },
  } as unknown as WalletAdapter;
  return { a, asked };
}

test('balances: each token is read from the wallet of its own family and formatted exactly', async () => {
  const evm = adapter('evm', { 'base-usdc': 12_345_678n });
  const svm = adapter('svm', { sol: 1_500_000_000n });
  const rows = await readBalances([USDC_BASE, SOL], (f) => (f === 'evm' ? evm.a : f === 'svm' ? svm.a : null));
  assert.deepEqual(rows, [{ status: 'ok', amount: '12.345678' }, { status: 'ok', amount: '1.5' }]);
  assert.deepEqual(evm.asked.map((t) => [t.assetId, t.blockchain, t.decimals, t.contractAddress]), [['base-usdc', 'base', 6, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913']]);
  assert.equal(svm.asked.length, 1);
  assert.deepEqual((await readBalances([SOL], () => svm.a))[0], { status: 'ok', amount: '1.5' });
});

test('balances: a missing wallet or unreadable chain gets a plain explanation, and never a made-up number', async () => {
  const rows = await readBalances(
    [USDC_BASE, SOL, T('btc', 'btc', 'BTC', 8), T('x', 'eth', 'ETH', 18)],
    (f) => (f === 'evm' ? adapter('evm', { x: 5n }, (c) => c === 'eth').a : null),
  );
  assert.deepEqual(rows[0], { status: 'unsupported', message: 'Your connected wallet cannot read Base.' }); // EVM wallet that does not cover Base
  assert.equal(rows[1].status, 'no-wallet');
  assert.match((rows[1] as { message: string }).message, /Connect a Solana wallet/);
  assert.equal(rows[2].status, 'unsupported');
  assert.match((rows[2] as { message: string }).message, /cannot read balances on/i);
  assert.equal(rows[3].status, 'ok');
});

test('balances: one failing or hanging read does not hide the others, and errors are short and friendly', async () => {
  const evm = adapter('evm', { 'base-usdc': new Error('boom\n  with   spaces'), 'eth-usdc': 'hang', 'eth-eth': 2_000_000_000_000_000_000n, 'bsc-usdc': new Error('failed to get balance: Error: 403: {"error":{"code":403,"message":"Access forbidden"}}') });
  const targets = [USDC_BASE, T('eth-usdc', 'eth', 'USDC', 6, '0xa0b8'), T('eth-eth', 'eth', 'ETH', 18), T('bsc-usdc', 'bsc', 'USDC', 18, '0x8ac7')];
  const rows = await readBalances(targets, () => evm.a, { timeoutMs: 30 });
  assert.deepEqual(rows[0], { status: 'error', message: 'boom with spaces' });
  assert.deepEqual(rows[1], { status: 'error', message: 'Timed out reading this balance' });
  assert.deepEqual(rows[2], { status: 'ok', amount: '2' });
  assert.equal(rows[3].status, 'error');
  assert.match((rows[3] as { message: string }).message, /refused the request.*RPC/);
  const long = await readBalances([USDC_BASE], () => adapter('evm', { 'base-usdc': new Error('x'.repeat(400)) }).a);
  assert.ok((long[0] as { message: string }).message.length <= 140);
});

test('balances: only a few reads run at a time, results keep their order, an empty list is fine', async () => {
  let running = 0, peak = 0;
  const slow = { family: 'evm', supportsChain: () => true, getBalance: async (t: Token) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 10)); running--; return BigInt(t.assetId.replace('t', '')); } } as unknown as WalletAdapter;
  const targets = Array.from({ length: 8 }, (_, i) => T(`t${i + 1}`, 'eth', 'X', 0));
  const rows = await readBalances(targets, () => slow, { concurrency: 3 });
  assert.deepEqual(rows.map((r) => (r as { amount: string }).amount), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.ok(peak <= 3, `at most 3 at once (saw ${peak})`);
  assert.deepEqual(await readBalances([], () => slow), []);
});

test('balances: labels name the network, and look-alikes on one network show their contract address', () => {
  assert.equal(balanceLabel(USDC_BASE, [USDC_BASE]), 'USDC on Base');
  const a = T('near-a', 'near', 'USDT', 6, 'usdt.tether-token.near');
  const b = T('near-b', 'near', 'USDT', 6, 'fake-usdt.near');
  assert.equal(balanceLabel(a, [a, b]), 'USDT on NEAR (usdt.t…near)');
  assert.equal(balanceLabel(b, [a, b]), 'USDT on NEAR (fake-u…near)');
  const c = T('eth-usdt', 'eth', 'USDT', 6, '0xdAC17F958D2ee523a2206206994597C13D831ec7');
  assert.equal(balanceLabel(c, [a, b, c]), 'USDT on Ethereum', 'different networks need no suffix');
});
