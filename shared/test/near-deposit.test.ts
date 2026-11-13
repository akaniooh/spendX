import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNearDeposit, nearTokenContract } from '../src/near-deposit.ts';
import type { Token } from '../src/types.ts';

const usdt: Token = { assetId: 'nep141:usdt.tether-token.near', decimals: 6, blockchain: 'near', symbol: 'USDT', contractAddress: 'usdt.tether-token.near' };
const noAddr: Token = { assetId: 'nep141:wrap.near', decimals: 24, blockchain: 'near', symbol: 'wNEAR' };
const DEP = 'a'.repeat(64);

test('registered receiver: single ft_transfer with exactly 1 yoctoNEAR', () => {
  const p = planNearDeposit({ token: usdt, amount: 1_500_000n, depositAddress: DEP, receiverRegistered: true });
  assert.equal(p.receiverId, 'usdt.tether-token.near');
  assert.equal(p.actions.length, 1);
  assert.deepEqual(p.actions[0].params, { methodName: 'ft_transfer', args: { receiver_id: DEP, amount: '1500000' }, gas: '30000000000000', deposit: '1' });
});

test('unregistered receiver: storage_deposit first, in the same transaction', () => {
  const p = planNearDeposit({ token: usdt, amount: 1n, depositAddress: DEP, receiverRegistered: false, storageMinYocto: '1250000000000000000000' });
  assert.deepEqual(p.actions.map((a) => a.params.methodName), ['storage_deposit', 'ft_transfer']);
  assert.equal(p.actions[0].params.deposit, '1250000000000000000000');
  assert.deepEqual(p.actions[0].params.args, { account_id: DEP, registration_only: true });
  assert.throws(() => planNearDeposit({ token: usdt, amount: 1n, depositAddress: DEP, receiverRegistered: false }));
  assert.throws(() => planNearDeposit({ token: usdt, amount: 1n, depositAddress: DEP, receiverRegistered: false, storageMinYocto: '0' }));
});

test('contract resolution and guards', () => {
  assert.equal(nearTokenContract(noAddr), 'wrap.near');
  assert.throws(() => nearTokenContract({ ...usdt, blockchain: 'base' }));
  assert.throws(() => planNearDeposit({ token: usdt, amount: 0n, depositAddress: DEP, receiverRegistered: true }));
});
