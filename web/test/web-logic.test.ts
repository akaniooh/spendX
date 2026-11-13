import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute, slugFromInput } from '../src/lib/route.ts';
import { chainLabel, shortAddr, tokenOptionLabel, formatUsd, formatDuration } from '../src/lib/labels.ts';
import { isUserRejection, errorMessage } from '../src/lib/errors.ts';
import { addHistory, parseHistory } from '../src/lib/history.ts';
import { txUrl } from '../src/lib/explorer.ts';
import { classifyDeposit } from '../../shared/src/deposit-kind.ts';
import type { Token } from '../../shared/src/types.ts';

test('hash routing', () => {
  assert.deepEqual(matchRoute(''), { name: 'home' });
  assert.deepEqual(matchRoute('/'), { name: 'home' });
  assert.deepEqual(matchRoute('/merchant'), { name: 'merchant' });
  assert.deepEqual(matchRoute('/swap'), { name: 'swap' });
  assert.deepEqual(matchRoute('/pay/AbCdEfGh12345678'), { name: 'pay', slug: 'AbCdEfGh12345678' });
  assert.deepEqual(matchRoute('/attempt/123e4567-e89b-12d3-a456-426614174000'), { name: 'attempt', id: '123e4567-e89b-12d3-a456-426614174000' });
  assert.equal(matchRoute('/pay/x').name, 'notfound');
  assert.equal(matchRoute('/pay/<script>').name, 'notfound');
  assert.equal(matchRoute('/nope').name, 'notfound');
});

test('payment links and bare slugs are both accepted; junk is not', () => {
  assert.equal(slugFromInput('https://spendx.example/#/pay/AbCdEfGh12345678'), 'AbCdEfGh12345678');
  assert.equal(slugFromInput('  AbCdEfGh12345678  '), 'AbCdEfGh12345678');
  assert.equal(slugFromInput('hello world'), null);
  assert.equal(slugFromInput(''), null);
});

test('labels', () => {
  assert.equal(chainLabel('base'), 'Base');
  assert.equal(chainLabel('newchain'), 'NEWCHAIN');
  assert.equal(shortAddr('0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4'), '0x85F1…f6a4');
  assert.equal(shortAddr('short'), 'short');
  assert.equal(tokenOptionLabel({ symbol: 'USDT', contractAddress: 'usdt.tether-token.near', assetId: 'a', duplicateSymbol: true }).startsWith('USDT ('), true);
  assert.equal(tokenOptionLabel({ symbol: 'USDC', contractAddress: null, assetId: 'a', duplicateSymbol: false }), 'USDC');
  assert.equal(formatUsd(0.0127), '$0.01');
  assert.equal(formatUsd(0.004), '< $0.01');
  assert.equal(formatDuration(22), '~22s');
  assert.equal(formatDuration(150), '~3 min');
});

test('wallet rejection detection and messages', () => {
  assert.equal(isUserRejection({ code: 4001 }), true);
  assert.equal(isUserRejection({ name: 'UserRejectedRequestError' }), true);
  assert.equal(isUserRejection({ message: 'User rejected the request.' }), true);
  assert.equal(isUserRejection({ message: 'x', cause: { code: 4001 } }), true);
  assert.equal(isUserRejection(new Error('insufficient funds')), false);
  assert.equal(isUserRejection(null), false);
  assert.match(errorMessage({ code: 4001 }), /Nothing was sent/);
  assert.equal(errorMessage(new Error('boom')), 'boom');
});

test('history keeps newest first, dedupes, ignores corrupt storage', () => {
  const e = (id: string) => ({ attemptId: id, slug: 's', createdAt: 'c', label: 'l' });
  let l = addHistory([], e('a'));
  l = addHistory(l, e('b'));
  l = addHistory(l, e('a'));
  assert.deepEqual(l.map((x) => x.attemptId), ['a', 'b']);
  assert.deepEqual(parseHistory('not json'), []);
  assert.deepEqual(parseHistory('{"a":1}'), []);
  assert.equal(parseHistory(JSON.stringify([e('z'), { bad: true }])).length, 1);
});

const tok = (o: Partial<Token>): Token => ({ assetId: 'x', decimals: 6, blockchain: 'base', symbol: 'USDC', ...o });
const ETH = { symbol: 'ETH', decimals: 18 };

test('deposit classification only allows assets we can positively identify', () => {
  assert.deepEqual(classifyDeposit(tok({ contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }), ETH),
    { kind: 'evm-erc20', contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' });
  assert.equal(classifyDeposit(tok({ symbol: 'ETH', decimals: 18 }), ETH).kind, 'evm-native');
  // no contract and not the chain's native currency: must NOT be sent as native
  assert.equal(classifyDeposit(tok({ symbol: 'USDC' }), ETH).kind, 'unsupported');
  assert.equal(classifyDeposit(tok({ symbol: 'ETH', decimals: 8 }), ETH).kind, 'unsupported');
  assert.equal(classifyDeposit(tok({ symbol: 'ETH', decimals: 18 })).kind, 'unsupported');
  assert.equal(classifyDeposit(tok({ contractAddress: 'not-an-address' }), ETH).kind, 'unsupported');
  assert.equal(classifyDeposit(tok({ blockchain: 'sol', symbol: 'SOL', decimals: 9 })).kind, 'svm-native');
  assert.equal(classifyDeposit(tok({ blockchain: 'sol', symbol: 'USDC', decimals: 6, contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' })).kind, 'unsupported');
  assert.deepEqual(classifyDeposit(tok({ blockchain: 'near', assetId: 'nep141:usdt.tether-token.near', contractAddress: 'usdt.tether-token.near' })),
    { kind: 'near-nep141', contract: 'usdt.tether-token.near' });
  assert.deepEqual(classifyDeposit(tok({ blockchain: 'near', assetId: 'nep141:wrap.near' })), { kind: 'near-nep141', contract: 'wrap.near' });
  assert.equal(classifyDeposit(tok({ blockchain: 'near', assetId: 'nep245:v2_1.omni.hot.tg:1_x' })).kind, 'unsupported');
  assert.equal(classifyDeposit(tok({ blockchain: 'near', assetId: 'nep141:Bad Account!' })).kind, 'unsupported');
  assert.equal(classifyDeposit(tok({ blockchain: 'btc', symbol: 'BTC', decimals: 8 })).kind, 'unsupported');
});

test('explorer links: known chains only, and only for plausible hashes', () => {
  assert.equal(txUrl('base', '0xabc123def4567890'), 'https://basescan.org/tx/0xabc123def4567890');
  assert.equal(txUrl('sol', '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW')?.startsWith('https://solscan.io/tx/'), true);
  assert.equal(txUrl('near', '9d8Zb7VqkXcFhWjvJd3nq2sEoLmYk4a1PBtRrNUcHvXe'), 'https://nearblocks.io/txns/9d8Zb7VqkXcFhWjvJd3nq2sEoLmYk4a1PBtRrNUcHvXe');
  assert.equal(txUrl('unknownchain', '0xabc123def4567890'), null);
  assert.equal(txUrl('base', 'x/../evil?'), null);
});

import { chainColor, chainMark, contrastText, hashColor, tokenColor, tokenMark } from '../src/lib/colors.ts';
test('chain and token icons: familiar colours for known assets, stable colours for new ones', () => {
  assert.equal(chainColor('base'), '#0052ff');
  assert.equal(tokenColor('usdc', 'base'), '#2775ca');
  assert.equal(chainColor('brand-new-chain'), chainColor('brand-new-chain'));
  assert.notEqual(chainColor('brand-new-chain'), chainColor('another-new-chain'));
  assert.match(hashColor('x'), /^hsl\(\d+ 52% 42%\)$/);
  assert.equal(contrastText('#00ec97'), '#07100d'); // NEAR green is light: needs dark text
  assert.equal(contrastText('#0052ff'), '#ffffff');
  assert.equal(contrastText('hsl(10 52% 42%)'), '#ffffff');
  assert.equal(chainMark('sol'), 'SO');
  assert.equal(chainMark('hypercore'), 'HYP');
  assert.equal(tokenMark('$WIF'), '$');
  assert.equal(tokenMark('usdc'), 'U');
});

import { estimateAddress, formatRate, indicativeRate } from '../src/lib/estimate.ts';
import { validateAddress } from '../../shared/src/addresses.ts';
test('estimates work without a wallet: valid placeholder addresses for the families we can validate, none otherwise', () => {
  assert.equal(validateAddress('base', estimateAddress('evm')!).status, 'valid');
  assert.equal(validateAddress('sol', estimateAddress('svm')!).status, 'valid');
  assert.equal(validateAddress('near', estimateAddress('near')!).status, 'valid');
  assert.equal(estimateAddress('other'), null);
});
test('indicative rate and rate formatting', () => {
  assert.equal(indicativeRate(150, 1), 150);
  assert.equal(indicativeRate(1, 2000), 0.0005);
  assert.equal(indicativeRate(null, 1), null);
  assert.equal(indicativeRate(0, 1), null);
  assert.equal(formatRate(148.123456789), '148.123');
  assert.equal(formatRate(2423.7421), '2,423.74');
  assert.equal(formatRate(0.000123456), '0.0001235');
  assert.equal(formatRate(NaN), '–');
  assert.equal(formatRate(1), '1');
});

import { payLinkSlug } from '../src/lib/route.ts';
test('a payment link inside free text is recognised; a plain word never is', () => {
  assert.equal(payLinkSlug('please pay this https://spendx.example/#/pay/AbCdEfGh12345678 thanks'), 'AbCdEfGh12345678');
  assert.equal(payLinkSlug('swapping'), null);
  assert.equal(payLinkSlug('AbCdEfGh12345678'), null);
  assert.equal(payLinkSlug('#/pay/short'), null);
});

import { catalogStats, pickSampleRoute } from '../src/lib/landing.ts';
import type { CatalogChain } from '../src/lib/types.ts';
const tk = (assetId: string, symbol: string) => ({ assetId, symbol, decimals: 6, price: null, contractAddress: null, duplicateSymbol: false });
const ch = (blockchain: string, family: CatalogChain['family'], tokens: ReturnType<typeof tk>[]): CatalogChain => ({ blockchain, family, tokens });
test('landing statistics and the sample route come from the real catalog, and are skipped when unavailable or ambiguous', () => {
  const chains = [ch('sol', 'svm', [tk('sol-sol', 'SOL'), tk('sol-usdc', 'USDC')]), ch('base', 'evm', [tk('base-usdc', 'USDC')]), ch('btc', 'other', [])];
  assert.deepEqual(catalogStats(chains), { networks: 3, tokens: 3 });
  assert.deepEqual(catalogStats([]), { networks: 0, tokens: 0 });
  const r = pickSampleRoute(chains)!;
  assert.equal(r.from.assetId, 'sol-sol');
  assert.equal(r.to.assetId, 'base-usdc');
  assert.equal(r.fromChain, 'sol');
  assert.equal(pickSampleRoute([ch('sol', 'svm', [tk('a', 'SOL')])]), null);
  // two USDC on Base: ambiguous, so that pair is not used
  const ambiguous = [ch('sol', 'svm', [tk('a', 'SOL')]), ch('base', 'evm', [tk('b1', 'USDC'), tk('b2', 'USDC')])];
  assert.equal(pickSampleRoute(ambiguous), null);
  assert.equal(pickSampleRoute([]), null);
});
