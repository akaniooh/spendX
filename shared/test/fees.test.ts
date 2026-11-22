import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bpsChange, buildAppFees, checkEchoedAppFees, expectedExtraScenarios, feeToSubmit, feeUsdEstimate,
  isValidFeeRecipient, isValidReferral, matchScenario, ourShareBps, worstCaseTotalBps,
} from '../src/fees.ts';

// The worked examples below are copied from docs.near-intents.org -> Fee Configuration.
test('with an API key the submitted fee is split 50/50 and 1Click\'s half has a 20 bps minimum', () => {
  assert.equal(ourShareBps(5, true), 3);          // "fee 5 -> 3 bps to you"
  assert.equal(worstCaseTotalBps(5, true), 23);   // "charged 23"
  assert.equal(ourShareBps(21, true), 11);
  assert.equal(worstCaseTotalBps(21, true), 31);  // "charged 31"
  assert.equal(ourShareBps(40, true), 20);
  assert.equal(worstCaseTotalBps(40, true), 40);  // "20 to you, 20 to 1Click"
  assert.equal(worstCaseTotalBps(0, true), 20);   // no appFees at all: 1Click's own 20 bps
});

test('without an API key the live API was measured splitting the fee too (echo = half, rounded up) on top of its 25 bps base', () => {
  // measured 2026-11-22 against the live API, dry quotes: submitted -> echoed share
  for (const [submitted, echoed] of [[25, 13], [50, 25], [11, 6]]) assert.equal(ourShareBps(submitted, false), echoed, `${submitted}`);
  assert.equal(worstCaseTotalBps(50, false), 75);
  assert.equal(worstCaseTotalBps(5, false), 30);
  assert.equal(worstCaseTotalBps(0, false), 25);
});

test('to KEEP k bps you must submit 2k, with or without an API key', () => {
  assert.equal(feeToSubmit(25, true), 50);
  assert.equal(feeToSubmit(25, false), 50); // measured: the split applies without a key too
  assert.equal(feeToSubmit(0, true), 0);
  assert.equal(feeToSubmit(-3, false), 0);
  assert.equal(feeToSubmit(2.5, false), 0); // fee must be an integer
  for (const k of [1, 10, 20, 25, 30, 100]) for (const key of [true, false]) assert.equal(ourShareBps(feeToSubmit(k, key), key), k, `keep ${k} key=${key}`);
});

test('measured: the same asset on the same chain is not split, so the whole submitted fee is ours', () => {
  // ETH on Base to ETH on Base: 50 submitted, 50 echoed and 50 bps arrived (2026-11-22)
  assert.equal(feeToSubmit(25, true, true), 25);
  assert.equal(feeToSubmit(25, false, true), 25);
  assert.equal(ourShareBps(50, true, true), 50);
  assert.equal(worstCaseTotalBps(25, true, true), 45);
  assert.deepEqual(buildAppFees('spendx.near', 25, true, true), [{ recipient: 'spendx.near', fee: 25 }]);
  assert.deepEqual(expectedExtraScenarios(25, true, true).map((s) => s.extraBps), [25]);
  // default (different assets) is unchanged
  assert.equal(feeToSubmit(25, true), 50);
});

test('the 500 bps combined limit is what bounds the fee you can keep', () => {
  assert.equal(worstCaseTotalBps(feeToSubmit(250, true), true), 500);
  assert.equal(worstCaseTotalBps(feeToSubmit(251, true), true) > 500, true);
  assert.equal(worstCaseTotalBps(feeToSubmit(237, false), false), 499);
  assert.equal(worstCaseTotalBps(feeToSubmit(238, false), false) > 500, true);
});

test('recipient and referral formats', () => {
  for (const ok of ['spendx.near', 'a1', 'my-team_1.near', 'a'.repeat(64), '0x1111111111111111111111111111111111111111']) assert.equal(isValidFeeRecipient(ok), true, ok);
  for (const bad of ['', 'x', 'Has Space.near', 'UPPER.near', '.near', 'near.', '0x123', 'a'.repeat(65), 'two..dots', 'sp endx']) assert.equal(isValidFeeRecipient(bad), false, bad);
  assert.equal(isValidReferral('spendx'), true);
  assert.equal(isValidReferral('spend-x_1.app'), true);
  for (const bad of ['SpendX', '-a', 'a--b', 'a'.repeat(58), '']) assert.equal(isValidReferral(bad), false, bad);
});

test('buildAppFees gives nothing unless there is both a recipient and a positive fee', () => {
  assert.equal(buildAppFees(undefined, 25, true), undefined);
  assert.equal(buildAppFees('spendx.near', 0, true), undefined);
  assert.deepEqual(buildAppFees('spendx.near', 25, true), [{ recipient: 'spendx.near', fee: 50 }]);
  assert.deepEqual(buildAppFees('spendx.near', 25, false), [{ recipient: 'spendx.near', fee: 50 }]);
});

test('a quote must echo our fee back unchanged; a dropped or altered fee is a problem', () => {
  const want = [{ recipient: 'spendx.near', fee: 50 }];
  assert.equal(checkEchoedAppFees(want, [{ recipient: 'spendx.near', fee: 50 }]), null);
  assert.match(checkEchoedAppFees(want, undefined) ?? '', /SpendX fee/);
  assert.match(checkEchoedAppFees(want, []) ?? '', /SpendX fee/);
  assert.match(checkEchoedAppFees(want, [{ recipient: 'spendx.near', fee: 51 }]) ?? '', /SpendX fee/); // higher than we computed
  assert.match(checkEchoedAppFees(want, [{ recipient: 'spendx.near', fee: 0 }]) ?? '', /SpendX fee/);
  // seen against the live API: 25 submitted came back as 13 (our share after 1Click's split). That must be accepted.
  assert.equal(checkEchoedAppFees([{ recipient: 'test-recipient.near', fee: 25 }], [{ recipient: 'test-recipient.near', fee: 13 }]), null);
  assert.equal(checkEchoedAppFees(want, [{ recipient: 'spendx.near', fee: 49 }]), null);
  assert.match(checkEchoedAppFees(want, [{ recipient: 'evil.near', fee: 50 }]) ?? '', /SpendX fee/);
  // 1Click may add its own entry to the echo; that must not break payments
  assert.equal(checkEchoedAppFees(want, [{ recipient: 'spendx.near', fee: 50 }, { recipient: 'oneclick.near', fee: 20 }]), null);
  // no fee expected: nothing to check
  assert.equal(checkEchoedAppFees(undefined, undefined), null);
  assert.equal(checkEchoedAppFees([], [{ recipient: 'x.near', fee: 1 }]), null);
  // EVM-style recipients compare case-insensitively
  assert.equal(checkEchoedAppFees([{ recipient: '0xAbCdEf0000000000000000000000000000000001', fee: 10 }], [{ recipient: '0xabcdef0000000000000000000000000000000001', fee: 10 }]), null);
});

test('USD estimate of a fee', () => {
  assert.equal(feeUsdEstimate('80.40', 25), 0.201);
  assert.equal(feeUsdEstimate(1500, 30), 4.5);
  assert.equal(feeUsdEstimate('abc', 25), 0);
  assert.equal(feeUsdEstimate('80', 0), 0);
  assert.equal(feeUsdEstimate('-5', 25), 0);
});

test('verification helpers: measuring a fee from two quotes and comparing it with the rules', () => {
  assert.equal(bpsChange(1_000_000n, 1_002_500n), 25);
  assert.equal(bpsChange(1_000_000n, 997_000n), -30);
  assert.equal(Number.isNaN(bpsChange(0n, 5n)), true);

  const keyed = expectedExtraScenarios(25, true);
  assert.deepEqual(keyed.map((s) => s.extraBps), [30, 49]); // standard pair (20 bps baseline) / stablecoin route (1 bp baseline)
  assert.deepEqual(expectedExtraScenarios(30, false).map((s) => s.extraBps), [60]);
  assert.deepEqual(expectedExtraScenarios(0, true), [{ label: 'no fee', extraBps: 0 }]);

  assert.equal(matchScenario(30.4, keyed, 1)?.label, 'standard pair');
  assert.equal(matchScenario(48.2, keyed, 1.5)?.label, 'stablecoin / same-asset route');
  assert.equal(matchScenario(40, keyed, 3), null);
  assert.equal(matchScenario(NaN, keyed, 100), null);
});
