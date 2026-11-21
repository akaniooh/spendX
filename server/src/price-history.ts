import type { Route } from './api.ts';

// Hourly prices for the last 7 days, from CoinGecko, so the Portfolio page can draw a real chart on the first visit.
// The browser sends only token SYMBOLS (never an address or a balance). The server asks CoinGecko, caches each symbol,
// and spaces its own requests out, so a stream of odd symbols cannot burn the CoinGecko rate limit.

interface Market { symbol?: string; sparkline_in_7d?: { price?: unknown } }

const SYMBOL = /^[A-Za-z0-9._-]{1,20}$/;
export const MAX_SYMBOLS = 60;

/** Pure: the market list is ordered by market cap, so the first coin for a symbol is the well-known one, not a look-alike. */
export function pickSeries(markets: Market[], wanted: string[]): Record<string, number[]> {
  const want = new Set(wanted.map((s) => s.toUpperCase()));
  const out: Record<string, number[]> = {};
  for (const m of markets) {
    const sym = String(m.symbol ?? '').toUpperCase();
    if (!want.has(sym) || sym in out) continue;
    const raw = m.sparkline_in_7d?.price;
    if (!Array.isArray(raw) || raw.length < 24) continue;
    if (!raw.every((p) => typeof p === 'number' && Number.isFinite(p) && p > 0)) continue; // a broken series is worse than none
    out[sym] = (raw as number[]).map((p) => Number(p.toPrecision(8)));
  }
  return out;
}

export interface PriceHistoryOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  ttlMs?: number;
  /** least time between two requests to CoinGecko, whatever the browser asks */
  minGapMs?: number;
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}

export class PriceHistoryCache {
  private o: Required<Omit<PriceHistoryOptions, 'apiKey'>> & { apiKey?: string };
  private bySymbol = new Map<string, { at: number; series: number[] | null }>();
  private nextTryAt = 0;

  constructor(o: PriceHistoryOptions = {}) {
    this.o = {
      fetchFn: o.fetchFn ?? fetch,
      baseUrl: (o.baseUrl ?? 'https://api.coingecko.com/api/v3').replace(/\/+$/, ''),
      apiKey: o.apiKey,
      ttlMs: o.ttlMs ?? 15 * 60_000,
      minGapMs: o.minGapMs ?? 10_000,
      now: o.now ?? Date.now,
      log: o.log ?? ((m, e) => console.warn(m, e)),
    };
  }

  /** Never throws. Symbols CoinGecko does not know are simply missing from the answer. */
  async get(symbols: string[]): Promise<Record<string, number[]>> {
    const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))].sort();
    const t = this.o.now();
    const stale = wanted.filter((s) => { const e = this.bySymbol.get(s); return !e || t - e.at >= this.o.ttlMs; });
    if (stale.length > 0 && t >= this.nextTryAt) {
      this.nextTryAt = t + this.o.minGapMs;
      try {
        const headers: Record<string, string> = { accept: 'application/json' };
        if (this.o.apiKey) headers[this.o.baseUrl.includes('pro-api') ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = this.o.apiKey;
        const url = `${this.o.baseUrl}/coins/markets?vs_currency=usd&symbols=${encodeURIComponent(stale.join(',').toLowerCase())}&order=market_cap_desc&per_page=250&page=1&sparkline=true`;
        const res = await this.o.fetchFn(url, { headers, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`CoinGecko answered ${res.status}`);
        const found = pickSeries((await res.json()) as Market[], stale);
        for (const s of stale) this.bySymbol.set(s, { at: t, series: found[s] ?? null });
        if (this.bySymbol.size > 500) for (const k of [...this.bySymbol.keys()].slice(0, this.bySymbol.size - 500)) this.bySymbol.delete(k);
      } catch (e) {
        this.nextTryAt = t + Math.max(this.o.minGapMs, 2 * 60_000);
        this.o.log('Price history from CoinGecko failed; serving what is cached', e);
      }
    }
    const out: Record<string, number[]> = {};
    for (const s of wanted) { const e = this.bySymbol.get(s); if (e?.series) out[s] = e.series; }
    return out;
  }
}

export function priceHistoryRoute(cache: Pick<PriceHistoryCache, 'get'>): Route {
  return {
    method: 'POST',
    path: '/api/price-history',
    handler: async (req) => {
      const symbols = (req.body as { symbols?: unknown } | null)?.symbols;
      if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > MAX_SYMBOLS || !symbols.every((s) => typeof s === 'string' && SYMBOL.test(s))) {
        return { status: 400, body: { error: { code: 'invalid_body', message: `Send between 1 and ${MAX_SYMBOLS} token symbols` } } };
      }
      return { status: 200, body: { series: await cache.get(symbols as string[]) } };
    },
  };
}
