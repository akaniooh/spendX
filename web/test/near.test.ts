import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNearRpc } from '../src/wallets/near-rpc.ts';
import { NearWallet } from '../src/wallets/near.ts';
import type { NearRpc } from '../src/wallets/near-rpc.ts';
import type { Token } from '../../shared/src/types.ts';

const USDT: Token = { assetId: 'nep141:usdt.tether-token.near', decimals: 6, blockchain: 'near', symbol: 'USDT', contractAddress: 'usdt.tether-token.near' };
const DEPOSIT = 'a'.repeat(64);
const ME = 'alice.near';

/** Fake NEAR RPC server: replies to `query` calls like the real protocol does. */
function fakeFetch(state: { balances?: Record<string, string>; registered?: boolean; min?: string; accountMissing?: boolean; rpcError?: string }): { f: typeof fetch; calls: any[] } {
  const calls: any[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body.params);
    const p = body.params;
    const bytes = (v: unknown) => ({ result: { result: [...new TextEncoder().encode(JSON.stringify(v))] } });
    let out: any;
    if (state.rpcError) out = { error: { data: state.rpcError } };
    else if (p.request_type === 'view_account') out = state.accountMissing ? { error: { data: 'account does not exist while viewing' } } : { result: { amount: state.balances?.near ?? '0' } };
    else if (p.method_name === 'ft_balance_of') out = bytes(state.balances?.ft ?? '0');
    else if (p.method_name === 'storage_balance_of') out = bytes(state.registered ? { total: '1', available: '0' } : null);
    else if (p.method_name === 'storage_balance_bounds') out = bytes({ min: state.min ?? '1250000000000000000000', max: null });
    else out = { error: { data: 'unknown method' } };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'spendx', ...out }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('NEAR RPC helpers speak the documented query protocol', async () => {
  const { f, calls } = fakeFetch({ balances: { ft: '5000000', near: '3000000000000000000000000' }, registered: true });
  const rpc = createNearRpc('http://rpc.test', f);
  assert.equal(await rpc.ftBalanceOf('usdt.tether-token.near', ME), 5_000_000n);
  assert.equal(await rpc.accountBalance(ME), 3_000_000_000_000_000_000_000_000n);
  assert.equal(await rpc.isRegistered('usdt.tether-token.near', DEPOSIT), true);
  const first = calls[0];
  assert.equal(first.request_type, 'call_function');
  assert.equal(first.finality, 'final');
  assert.equal(first.method_name, 'ft_balance_of');
  assert.deepEqual(JSON.parse(atob(first.args_base64)), { account_id: ME });
  assert.equal(await createNearRpc('http://rpc.test', fakeFetch({ registered: false }).f).isRegistered('x.near', DEPOSIT), false);
  assert.equal(await createNearRpc('http://rpc.test', fakeFetch({ accountMissing: true }).f).accountBalance(ME), 0n);
  assert.equal(await rpc.storageMin('x.near'), '1250000000000000000000');
  await assert.rejects(createNearRpc('http://rpc.test', fakeFetch({ rpcError: 'boom' }).f).ftBalanceOf('x.near', ME), /boom/);
});

function walletWith(state: Parameters<typeof fakeFetch>[0], sendResult: unknown = { transaction: { hash: 'NEARTX000001' } }) {
  const sent: any[] = [];
  const rpc: NearRpc = createNearRpc('http://rpc.test', fakeFetch(state).f);
  const w = new NearWallet({ signAndSendTransaction: async (a) => { sent.push(a); return sendResult; } }, ME, async () => {}, rpc);
  return { w, sent };
}
const req = (over: Record<string, unknown> = {}) => ({ token: USDT, amount: 1_012_733n, depositAddress: DEPOSIT, ...over });
const RICH = '5000000000000000000000000'; // 5 NEAR

test('registered receiver: one ft_transfer of exactly the quoted amount with 1 yoctoNEAR', async () => {
  const { w, sent } = walletWith({ registered: true, balances: { near: RICH } });
  const r = await w.sendDeposit(req());
  assert.equal(r.txHash, 'NEARTX000001');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].receiverId, 'usdt.tether-token.near');
  assert.equal(sent[0].actions.length, 1);
  assert.deepEqual(sent[0].actions[0].params.args, { receiver_id: DEPOSIT, amount: '1012733' });
  assert.equal(sent[0].actions[0].params.deposit, '1');
});

test('unregistered receiver: storage registration comes first in the same transaction', async () => {
  const { w, sent } = walletWith({ registered: false, min: '1250000000000000000000', balances: { near: RICH } });
  await w.sendDeposit(req());
  assert.deepEqual(sent[0].actions.map((a: any) => a.params.methodName), ['storage_deposit', 'ft_transfer']);
  assert.equal(sent[0].actions[0].params.deposit, '1250000000000000000000');
});

test('refuses before the wallet prompt: too little NEAR for fees, memo, non-NEAR token, bad deposit address', async () => {
  const poor = walletWith({ registered: true, balances: { near: '1000' } });
  await assert.rejects(poor.w.sendDeposit(req()), /Not enough NEAR/);
  assert.equal(poor.sent.length, 0);
  // registration needs extra NEAR on top of fees
  const tight = walletWith({ registered: false, min: '1250000000000000000000', balances: { near: '10100000000000000000000' } });
  await assert.rejects(tight.w.sendDeposit(req()), /storage registration/);
  const ok = walletWith({ registered: true, balances: { near: RICH } });
  await assert.rejects(ok.w.sendDeposit(req({ depositMemo: 'm' })), /memo/);
  await assert.rejects(ok.w.sendDeposit(req({ token: { ...USDT, blockchain: 'base', contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' } })), /./);
  await assert.rejects(ok.w.sendDeposit(req({ depositAddress: 'Not A Near Account!' })), /valid NEAR account/);
  assert.equal(ok.sent.length, 0);
});

test('a wallet that omits the hash still counts as sent; balance reads the token contract', async () => {
  const { w } = walletWith({ registered: true, balances: { near: RICH, ft: '777' } }, {});
  assert.equal((await w.sendDeposit(req())).txHash, '');
  assert.equal(await w.getBalance(USDT), 777n);
  assert.equal(w.getAddress(), ME);
  assert.equal(w.family, 'near');
  assert.equal(w.supportsChain('near'), true);
  assert.equal(w.supportsChain('sol'), false);
});

import { nearAddressOf } from '../src/wallets/near-account.ts';
test('NEAR account is read from getAccounts (documented), falling back to getAddress; unusable wallets fail clearly', async () => {
  let seen: unknown;
  assert.equal(await nearAddressOf({ getAccounts: async (o: unknown) => { seen = o; return [{ accountId: 'alice.near', publicKey: 'ed25519:x' }]; } }), 'alice.near');
  assert.deepEqual(seen, { network: 'mainnet' });
  assert.equal(await nearAddressOf({ getAddress: async () => 'bob.near' }), 'bob.near');
  assert.equal(await nearAddressOf({ getAccounts: async () => [], getAddress: async () => 'carol.near' }), 'carol.near');
  await assert.rejects(nearAddressOf({}), /did not return an account/);
  await assert.rejects(nearAddressOf({ getAccounts: async () => [{}] }), /did not return an account/);
  await assert.rejects(nearAddressOf(undefined), /did not return an account/);
});
