import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeTransferChecked, pickSourceAccount, solRequiredLamports, tokenProgramKind,
  CREATE_ATA_IDEMPOTENT_DATA, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, type TokenAccountInfo,
} from '../src/spl.ts';
import { base58Decode } from '../src/addresses.ts';

test('program ids are the real 32-byte addresses (guards against a typo in a constant that moves money)', () => {
  for (const id of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL']) assert.equal(base58Decode(id)?.length, 32);
});

test('TransferChecked is opcode 12, a little-endian u64 amount, then the decimals', () => {
  assert.deepEqual([...encodeTransferChecked(1n, 6)], [12, 1, 0, 0, 0, 0, 0, 0, 0, 6]);
  assert.deepEqual([...encodeTransferChecked(0x0102030405060708n, 9)], [12, 8, 7, 6, 5, 4, 3, 2, 1, 9]);
  assert.deepEqual([...encodeTransferChecked((1n << 64n) - 1n, 0)], [12, 255, 255, 255, 255, 255, 255, 255, 255, 0]);
  assert.throws(() => encodeTransferChecked(0n, 6));
  assert.throws(() => encodeTransferChecked(-1n, 6));
  assert.throws(() => encodeTransferChecked(1n << 64n, 6));
  assert.throws(() => encodeTransferChecked(1n, 256));
  assert.throws(() => encodeTransferChecked(1n, -1));
  assert.deepEqual([...CREATE_ATA_IDEMPOTENT_DATA], [1]); // CreateIdempotent, never the plain Create (which fails if it exists)
});

test('only the classic token program is accepted', () => {
  assert.equal(tokenProgramKind(TOKEN_PROGRAM_ID), 'token');
  assert.equal(tokenProgramKind(TOKEN_2022_PROGRAM_ID), 'token-2022');
  assert.equal(tokenProgramKind('11111111111111111111111111111111'), 'other');
  assert.equal(tokenProgramKind(null), 'other');
  assert.equal(tokenProgramKind(undefined), 'other');
});

const acct = (address: string, amount: bigint, o: Partial<TokenAccountInfo> = {}): TokenAccountInfo => ({ address, amount, decimals: 6, frozen: false, ...o });

test('source account: the standard account wins when it has enough, else the fullest one', () => {
  assert.equal(pickSourceAccount([acct('A', 500n), acct('B', 900n)], 400n, 6, 'PENGU', 'A').address, 'A');
  assert.equal(pickSourceAccount([acct('A', 100n), acct('B', 900n), acct('C', 700n)], 400n, 6, 'PENGU', 'A').address, 'B'); // A too small
  assert.equal(pickSourceAccount([acct('A', 500n)], 500n, 6, 'PENGU').address, 'A'); // exactly enough
});

test('source account: clear refusals instead of a failed or wrong transfer', () => {
  assert.throws(() => pickSourceAccount([], 1n, 6, 'PENGU'), /no PENGU/);
  assert.throws(() => pickSourceAccount([acct('A', 10n)], 11n, 6, 'PENGU'), /Insufficient PENGU/);
  assert.throws(() => pickSourceAccount([acct('A', 6n), acct('B', 6n)], 10n, 6, 'PENGU'), /split across several/);
  assert.throws(() => pickSourceAccount([acct('A', 100n, { frozen: true })], 1n, 6, 'PENGU'), /frozen/);
  assert.equal(pickSourceAccount([acct('A', 100n, { frozen: true }), acct('B', 100n)], 50n, 6, 'PENGU').address, 'B'); // skips the frozen one
  assert.throws(() => pickSourceAccount([acct('A', 100n, { decimals: 9 })], 1n, 6, 'PENGU'), /decimals/); // listing and chain disagree
});

test('SOL kept back: fee always, plus rent only when the recipient token account has to be created', () => {
  assert.equal(solRequiredLamports({ feeBuffer: 10_000n, destAccountMissing: false, rentLamports: 2_039_280n }), 10_000n);
  assert.equal(solRequiredLamports({ feeBuffer: 10_000n, destAccountMissing: true, rentLamports: 2_039_280n }), 2_049_280n);
});
