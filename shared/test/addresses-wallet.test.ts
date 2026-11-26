import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEvmAddress, sameWalletAddress } from '../src/addresses.ts';

const A = '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4';

test('only a strict 0x address counts as EVM (so database patterns with % or _ never do)', () => {
  assert.ok(isEvmAddress(A));
  assert.ok(isEvmAddress(A.toLowerCase()));
  for (const bad of ['0x%', '0x' + '_'.repeat(40), '0x' + 'a'.repeat(39), '0x' + 'g'.repeat(40), '', 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z']) assert.equal(isEvmAddress(bad), false, bad);
});

test('EVM addresses match ignoring case; other addresses match exactly', () => {
  assert.ok(sameWalletAddress(A, A.toLowerCase()));
  assert.ok(!sameWalletAddress(A, '0x' + 'b'.repeat(40)));
  assert.ok(sameWalletAddress('BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z', 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z'));
  assert.ok(!sameWalletAddress('BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z', 'bypsjxa3yuzesqz1dkubw1qsfcspecsm8nCQhY5xbU1Z'));
});
