import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedCount, formatAmount, portfolioTargets, toHoldings, totalUsd } from '../src/lib/portfolio.ts';
import type { WalletAdapter } from '../../shared/src/adapters.ts';
import type { WalletFamily } from '../../shared/src/chains.ts';
import type { CatalogChain, CatalogToken } from '../src/lib/types.ts';
import type { BalanceRow } from '../src/lib/balances.ts';

const tok = (assetId: string, symbol: string, decimals: number, contractAddress: string | null, price: number | null = 1): CatalogToken =>
  ({ assetId, symbol, decimals, price, contractAddress, duplicateSymbol: false });
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const chains: CatalogChain[] = [
  { blockchain: 'base', family: 'evm', tokens: [tok('base-eth', 'ETH', 18, null, 3000), tok('base-usdc', 'USDC', 6, USDC), tok('base-bad', 'BAD', 6, 'not-an-address')] },
  { blockchain: 'sol', family: 'svm', tokens: [tok('sol-sol', 'SOL', 9, null, 150)] },
  { blockchain: 'btc', family: 'other', tokens: [tok('btc', 'BTC', 8, null, 60000)] },
];
const adapter = (family: WalletFamily, address: string, supports: (c: string) => boolean): WalletAdapter =>
  ({ family, supportsChain: supports, getAddress: () => address }) as unknown as WalletAdapter;
const evm = adapter('evm', '0xabc', (c) => c === 'base');
const adapterFor = (f: WalletFamily) => (f === 'evm' ? evm : null);

test('portfolio targets: only connected, readable, identifiable tokens', () => {
  const t = portfolioTargets(chains, adapterFor, (b) => (b === 'base' ? { symbol: 'ETH', decimals: 18 } : undefined));
  assert.deepEqual(t.map((x) => x.assetId), ['base-eth', 'base-usdc']); // no Solana wallet, no BTC, malformed contract dropped
  assert.equal(t[0].address, '0xabc');
});

test('portfolio holdings: zero balances and failed reads are hidden, largest value first, unpriced last', () => {
  const t = portfolioTargets(chains, (f) => (f === 'evm' ? evm : f === 'svm' ? adapter('svm', 'S0L', () => true) : null), (b) => (b === 'base' ? { symbol: 'ETH', decimals: 18 } : undefined));
  const rows: BalanceRow[] = [
    { status: 'ok', amount: '0.01' },   // ETH  $30
    { status: 'ok', amount: '100' },    // USDC $100
    { status: 'ok', amount: '0' },      // SOL zero
  ];
  const h = toHoldings(t, rows);
  assert.deepEqual(h.map((x) => x.target.symbol), ['USDC', 'ETH']);
  assert.equal(totalUsd(h), 130);
  assert.equal(failedCount([{ status: 'error', message: 'x' }, { status: 'ok', amount: '1' }, { status: 'no-wallet', message: 'y' }]), 1);
});

test('portfolio amounts: grouped, trimmed, and a dust balance never shows as zero', () => {
  assert.equal(formatAmount('1234567.891234567'), '1,234,567.891234');
  assert.equal(formatAmount('12'), '12');
  assert.equal(formatAmount('0.5000'), '0.5');
  assert.equal(formatAmount('0.0000000001'), '< 0.000001');
});

import { addSnapshot, dailyChange, formatChange, sinceLabel, sparkPaths } from '../src/lib/portfolio.ts';

const H = 3_600_000;

test('daily change: compares with the earliest point of the last 24h, and waits until there is something to compare', () => {
  const now = 100 * H;
  assert.equal(dailyChange([], now, 10), null);
  assert.equal(dailyChange([{ t: now - 60_000, v: 10 }], now, 10), null); // too fresh to mean anything
  const c = dailyChange([{ t: now - 30 * H, v: 50 }, { t: now - 20 * H, v: 10 }, { t: now - 5 * H, v: 12 }], now, 9.6)!;
  assert.ok(Math.abs(c.pct + 4) < 1e-9); // against the 20h-old point, not the 30h-old one
  assert.ok(Math.abs(c.abs + 0.4) < 1e-9);
  assert.equal(c.points.length, 3);
  assert.equal(formatChange(c).pct, '-4.00%');
  assert.equal(formatChange(c).sign, 'down');
  // nothing in the last 24h: fall back to the latest older point, labelled by its age
  const old = dailyChange([{ t: now - 72 * H, v: 8 }], now, 10)!;
  assert.equal(old.pct, 25);
  assert.equal(sinceLabel(old.sinceMs), '3d ago');
  assert.equal(dailyChange([{ t: now - 3 * H, v: 0 }], now, 10), null); // no divide by zero
});

test('daily change: snapshots are throttled, trimmed to a week and ignore junk', () => {
  const now = 200 * H;
  let h = addSnapshot([], now - 10 * 60_000, 5);
  h = addSnapshot(h, now, 6); // within 15 minutes: replaces
  assert.deepEqual(h, [{ t: now, v: 6 }]);
  h = addSnapshot([{ t: now - 9 * 24 * H, v: 1 }, { t: now - 2 * H, v: NaN }, { t: now - H, v: 4 }], now, 7);
  assert.deepEqual(h.map((s) => s.v), [4, 7]);
  assert.equal(sinceLabel(24 * H), '24h');
  assert.equal(sinceLabel(20 * 60_000), '20m ago');
});

test('sparkline: scaled into its box; flat and single-point histories still draw', () => {
  const p = sparkPaths([{ t: 0, v: 1 }, { t: 10, v: 3 }, { t: 20, v: 2 }], 600, 120)!;
  assert.ok(p.line.startsWith('M0.0 114.0'));   // lowest value at the bottom (minus padding)
  assert.ok(p.line.includes('L300.0 6.0'));     // highest at the top
  assert.ok(p.area.endsWith('L600 120 L0 120 Z'));
  assert.ok(sparkPaths([{ t: 5, v: 2 }], 600, 120)!.line.includes('60.0'));
  assert.equal(sparkPaths([], 600, 120), null);
});

import { priceHistoryChange } from '../src/lib/portfolio.ts';
import type { Holding } from '../src/lib/portfolio.ts';

const held = (symbol: string, value: number | null): Holding => ({
  target: { assetId: symbol, blockchain: 'base', symbol, decimals: 6, contractAddress: null, price: 1, duplicateSymbol: false, address: '0x1' },
  amount: '1', value,
});
const ramp = (from: number, to: number, n = 168) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

test('price history chart: holdings valued at past prices, scaled to today, 24h and 7d windows', () => {
  const now = 1_000 * 3_600_000;
  const holdings = [held('ETH', 100), held('USDC', 100)];
  const series = { ETH: ramp(80, 100), USDC: ramp(1, 1) }; // ETH rose 25% over 7 days, USDC flat
  const week = priceHistoryChange(holdings, series, '7d', now)!;
  assert.equal(week.points.length, 168);
  assert.ok(Math.abs(week.points[0].v - 180) < 1e-9);   // 100*(80/100) + 100
  assert.ok(Math.abs(week.points[167].v - 200) < 1e-9); // today's total
  assert.ok(Math.abs(week.pct - (20 / 180) * 100) < 1e-9);
  assert.equal(sinceLabel(week.sinceMs), '7d');
  const day = priceHistoryChange(holdings, series, '24h', now)!;
  assert.equal(day.points.length, 25);
  assert.equal(sinceLabel(day.sinceMs), '24h');
  assert.ok(day.pct > 0 && day.pct < week.pct);
});

test('price history chart: needs history for most of the value, and ignores unpriced or empty holdings', () => {
  const now = 5_000_000;
  const series = { ETH: ramp(80, 100) };
  assert.equal(priceHistoryChange([held('ETH', 100), held('MYSTERY', 100)], series, '24h', now), null); // only half covered
  assert.equal(priceHistoryChange([held('ETH', null)], series, '24h', now), null);
  assert.equal(priceHistoryChange([], series, '24h', now), null);
  const mostly = priceHistoryChange([held('ETH', 100), held('MYSTERY', 10)], series, '24h', now)!; // unknown token held flat
  assert.equal(mostly.points[0].v > 100 && mostly.points[24].v === 110, true);
});
