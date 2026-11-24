import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXTRA_EVM_CHAINS, VIEM_EVM_CHAINS } from '../src/evm-chains.ts';
import { EVM_CHAINS, familyOf } from '../src/chains.ts';
import { chainName } from '../src/chain-names.ts';
import { classifyDeposit } from '../src/deposit-kind.ts';
import { txUrl } from '../../web/src/lib/explorer.ts';

test('chain ids are pinned: a wrong id can send a payment on the wrong network', () => {
  // verified against each chain's own docs and a second source, 2026-11-24
  assert.deepEqual(
    Object.fromEntries(Object.entries(EXTRA_EVM_CHAINS).map(([k, c]) => [k, c.id])),
    { bera: 80094, xlayer: 196, monad: 143, adi: 36900, plasma: 9745, hood: 4663, aurora: 1313161554 },
  );
});

test('no EVM chain that 1Click lists is left without a wallet definition', () => {
  const covered = new Set<string>([...VIEM_EVM_CHAINS, ...Object.keys(EXTRA_EVM_CHAINS)]);
  for (const c of EVM_CHAINS) assert.equal(covered.has(c), true, `${c} has no chain definition`);
  for (const c of covered) assert.equal(familyOf(c), 'evm', `${c} is not classed as EVM`);
});

test('chain data is well formed: unique ids, https endpoints, 18-decimal native coin, a display name', () => {
  const ids = new Set<number>();
  for (const [key, c] of Object.entries(EXTRA_EVM_CHAINS)) {
    assert.equal(ids.has(c.id), false, `duplicate chain id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.rpc.length > 0, `${key} has no RPC`);
    for (const url of [...c.rpc, c.explorer]) assert.match(url, /^https:\/\/[a-z0-9.-]+(\/[a-z0-9-]*)?$/i, `${key}: ${url}`);
    assert.equal(c.explorer.endsWith('/'), false, `${key}: explorer must not end with a slash`);
    assert.equal(c.native.decimals, 18);
    assert.ok(c.native.symbol.length >= 2);
    assert.notEqual(chainName(key), key.toUpperCase(), `${key} has no display name`);
  }
});

test('explorer links point at the right transaction on each new chain', () => {
  const h = '0x' + 'ab'.repeat(32);
  assert.equal(txUrl('monad', h), `https://monadvision.com/tx/${h}`);
  assert.equal(txUrl('bera', h), `https://berascan.com/tx/${h}`);
  assert.equal(txUrl('xlayer', h), `https://www.oklink.com/xlayer/tx/${h}`);
  assert.equal(txUrl('plasma', h), `https://plasmascan.to/tx/${h}`);
  assert.equal(txUrl('aurora', h), `https://explorer.aurora.dev/tx/${h}`);
  assert.equal(txUrl('adi', h), `https://explorer.adifoundation.ai/tx/${h}`);
  assert.equal(txUrl('hood', h), `https://robinhoodchain.blockscout.com/tx/${h}`);
  assert.equal(txUrl('base', h), `https://basescan.org/tx/${h}`); // existing chains unchanged
  assert.equal(txUrl('monad', 'not a hash'), null);
});

test('the native coin of each new chain is recognised, and only when symbol and decimals both match', () => {
  for (const [key, c] of Object.entries(EXTRA_EVM_CHAINS)) {
    const native = { assetId: `nep141:${key}.omft.near`, blockchain: key, symbol: c.native.symbol, decimals: c.native.decimals };
    assert.equal(classifyDeposit(native, c.native).kind, 'evm-native', key);
    assert.equal(classifyDeposit({ ...native, symbol: 'XYZ' }, c.native).kind, 'unsupported', `${key}: other symbol`);
    assert.equal(classifyDeposit({ ...native, decimals: 6 }, c.native).kind, 'unsupported', `${key}: other decimals`);
    // an ERC-20 is identified by its contract, whatever the chain
    assert.equal(classifyDeposit({ ...native, symbol: 'USDC', decimals: 6, contractAddress: '0x' + '1'.repeat(40) }, c.native).kind, 'evm-erc20', `${key}: token`);
  }
});
