// What the Portfolio page shows: every token the connected wallets can read, with the balance each holds.
// No React and no chain libraries here, so every rule is testable. Balances are read in the browser from the person's own wallets.
import type { WalletAdapter } from '../../../shared/src/adapters.ts';
import type { WalletFamily } from '../../../shared/src/chains.ts';
import { classifyDeposit } from '../../../shared/src/deposit-kind.ts';
import type { BalanceRow, BalanceTarget } from './balances.ts';
import type { CatalogChain } from './types.ts';

export interface PortfolioTarget extends BalanceTarget {
  price: number | null;
  duplicateSymbol: boolean;
  /** the connected wallet address this balance is read for */
  address: string | null;
}

export interface Holding {
  target: PortfolioTarget;
  amount: string;
  /** USD value from the catalog price, or null when the token has no price */
  value: number | null;
}

/** Tokens worth asking a wallet about: the wallet family is connected, can read the chain, and the token is one we can identify. */
export function portfolioTargets(
  chains: CatalogChain[],
  adapterFor: (family: WalletFamily) => WalletAdapter | null,
  nativeOf: (blockchain: string) => { symbol: string; decimals: number } | undefined = () => undefined,
): PortfolioTarget[] {
  const out: PortfolioTarget[] = [];
  for (const c of chains) {
    const adapter = adapterFor(c.family);
    if (!adapter || !adapter.supportsChain(c.blockchain)) continue;
    const address = adapter.getAddress();
    for (const t of c.tokens) {
      const kind = classifyDeposit({ assetId: t.assetId, blockchain: c.blockchain, symbol: t.symbol, decimals: t.decimals, contractAddress: t.contractAddress }, nativeOf(c.blockchain));
      if (kind.kind === 'unsupported') continue;
      out.push({
        assetId: t.assetId, blockchain: c.blockchain, symbol: t.symbol, decimals: t.decimals, contractAddress: t.contractAddress,
        price: t.price, duplicateSymbol: t.duplicateSymbol, address,
      });
    }
  }
  return out;
}

const isZero = (amount: string) => /^0(\.0*)?$/.test(amount);

/** Only tokens actually held, largest USD value first (unpriced tokens after, by network and symbol). */
export function toHoldings(targets: PortfolioTarget[], rows: BalanceRow[]): Holding[] {
  const out: Holding[] = [];
  targets.forEach((t, i) => {
    const r = rows[i];
    if (!r || r.status !== 'ok' || isZero(r.amount)) return;
    const n = Number(r.amount);
    out.push({ target: t, amount: r.amount, value: t.price != null && Number.isFinite(n) ? n * t.price : null });
  });
  return out.sort((a, b) => {
    if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
    if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1;
    return a.target.blockchain.localeCompare(b.target.blockchain) || a.target.symbol.localeCompare(b.target.symbol);
  });
}

export function totalUsd(holdings: Holding[]): number {
  return holdings.reduce((sum, h) => sum + (h.value ?? 0), 0);
}

/** How many reads failed, so the page can say the list may be incomplete instead of silently hiding them. */
export function failedCount(rows: BalanceRow[]): number {
  return rows.filter((r) => r && r.status === 'error').length;
}

/** "1,234.5678": thousands separators, at most `maxDecimals` decimals; a tiny non-zero balance reads "< 0.000001", never "0". */
export function formatAmount(amount: string, maxDecimals = 6): string {
  const [whole, frac = ''] = amount.split('.');
  const w = BigInt(whole || '0').toLocaleString('en-US');
  const f = frac.slice(0, maxDecimals).replace(/0+$/, '');
  if (!f && frac && w === '0') return `< 0.${'0'.repeat(maxDecimals - 1)}1`;
  return f ? `${w}.${f}` : w;
}

// ---- Daily change -------------------------------------------------------------------------------------------
// The catalog has prices but no price history, so the change is measured from this browser's own saved totals:
// each completed scan with no failed reads stores one point. It therefore includes deposits and withdrawals, not only price moves.

export interface Snapshot { t: number; v: number }
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Adds a point. Points closer than `minGapMs` replace the latest one; anything older than a week is dropped. */
export function addSnapshot(history: Snapshot[], now: number, value: number, minGapMs = 15 * MINUTE, keepMs = 7 * DAY): Snapshot[] {
  const kept = history.filter((s) => Number.isFinite(s.t) && Number.isFinite(s.v) && now - s.t <= keepMs && s.t <= now);
  const last = kept[kept.length - 1];
  return last && now - last.t < minGapMs ? [...kept.slice(0, -1), { t: now, v: value }] : [...kept, { t: now, v: value }];
}

export interface DailyChange { abs: number; pct: number; sinceMs: number; points: Snapshot[] }

/** Change since the earliest point of the last 24 hours (or the latest older point when there is none). Null until there is something to compare. */
export function dailyChange(history: Snapshot[], now: number, current: number): DailyChange | null {
  const recent = history.filter((s) => now - s.t <= DAY);
  const base = recent[0] ?? history[history.length - 1];
  if (!base || base.v <= 0 || now - base.t < 5 * MINUTE) return null;
  const abs = current - base.v;
  const points = [...history.filter((s) => s.t >= base.t && s.t < now), { t: now, v: current }];
  return { abs, pct: (abs / base.v) * 100, sinceMs: now - base.t, points };
}

/** "24h" for a full day, otherwise how long ago the comparison point is. */
export function sinceLabel(ms: number): string {
  const h = ms / (60 * MINUTE);
  if (h >= 22 && h <= 26) return '24h';
  if (h >= 160 && h <= 176) return '7d';
  if (h < 1) return `${Math.max(1, Math.round(ms / MINUTE))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatChange(c: DailyChange, money: (usd: number) => string = (n) => `$${n.toFixed(2)}`): { pct: string; abs: string; sign: 'up' | 'down' | 'flat' } {
  const sign = Math.abs(c.pct) < 0.005 ? 'flat' : c.pct > 0 ? 'up' : 'down';
  const s = c.pct > 0 ? '+' : c.pct < 0 ? '-' : '';
  return { sign, pct: `${s}${Math.abs(c.pct).toFixed(2)}%`, abs: `${c.abs < 0 ? '-' : c.abs > 0 ? '+' : ''}${money(Math.abs(c.abs))}` };
}

/** SVG path data for a line and the area under it, scaled to a w x h box. A single point draws a flat line. */
export function sparkPaths(points: Snapshot[], w: number, h: number, pad = 6): { line: string; area: string } | null {
  if (points.length === 0) return null;
  const pts = points.length === 1 ? [points[0], { ...points[0], t: points[0].t + 1 }] : points;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * w);
  const y = (v: number) => (hi === lo ? h / 2 : h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}

// ---- Chart from real price history ----------------------------------------------------------------------------
// Today's holdings valued at each past hour's price. This shows how the portfolio's price moved, so deposits and withdrawals do not count as gains or losses.

export type Range = '24h' | '7d';
const HOUR = 60 * MINUTE;

/** Each hourly series is scaled so its last point equals the catalog price used for the total: a wrong-coin symbol clash can bend the shape but never the amount. */
export function priceHistoryChange(holdings: Holding[], series: Record<string, number[]>, range: Range, now: number): DailyChange | null {
  const priced = holdings.filter((h) => h.value !== null && h.value > 0);
  const total = priced.reduce((s, h) => s + (h.value as number), 0);
  if (total <= 0) return null;
  const seriesOf = (h: Holding) => {
    const s = series[h.target.symbol.toUpperCase()];
    return s && s.length >= 25 && s[s.length - 1] > 0 ? s : null;
  };
  const usable = priced.filter((h) => seriesOf(h));
  // Not enough of the portfolio has history: say nothing rather than chart a guess.
  if (usable.reduce((s, h) => s + (h.value as number), 0) / total < 0.6) return null;
  const len = Math.min(range === '24h' ? 25 : 168, ...usable.map((h) => (seriesOf(h) as number[]).length));
  const points: Snapshot[] = [];
  for (let i = 0; i < len; i++) {
    let v = 0;
    for (const h of priced) {
      const s = seriesOf(h);
      v += s ? (h.value as number) * (s[s.length - len + i] / s[s.length - 1]) : (h.value as number);
    }
    points.push({ t: now - (len - 1 - i) * HOUR, v });
  }
  const base = points[0].v;
  if (base <= 0) return null;
  const abs = points[points.length - 1].v - base;
  return { abs, pct: (abs / base) * 100, sinceMs: (len - 1) * HOUR, points };
}
