import type { Route } from './api.ts';
import { CURRENCY_CODES } from '../../shared/src/currencies.ts';

// USD to local-currency rates for the "Local currency" setting, from CoinGecko's exchange-rate list (one small request,
// cached for an hour). Display only: payments and swaps stay in USD.

interface ExchangeRates { rates?: Record<string, { value?: unknown; type?: unknown }> }

/** Pure. CoinGecko quotes every currency in BTC, so USD to X is X's value divided by USD's. Unknown or non-fiat codes are left out. */
export function pickRates(data: ExchangeRates, codes: string[] = CURRENCY_CODES): Record<string, number> {
  const table = data.rates ?? {};
  const usd = Number(table.usd?.value);
  if (!Number.isFinite(usd) || usd <= 0) return {};
  const out: Record<string, number> = { USD: 1 };
  for (const code of codes) {
    if (code === 'USD') continue;
    const r = table[code.toLowerCase()];
    const v = Number(r?.value);
    if (r?.type === 'fiat' && Number.isFinite(v) && v > 0) out[code] = Number((v / usd).toPrecision(8));
  }
  return out;
}

export interface RatesCacheOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  ttlMs?: number;
  retryMs?: number;
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}

export class RatesCache {
  private o: Required<Omit<RatesCacheOptions, 'apiKey'>> & { apiKey?: string };
  private rates: Record<string, number> = {};
  private fetchedAt = 0;
  private nextTryAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(o: RatesCacheOptions = {}) {
    this.o = {
      fetchFn: o.fetchFn ?? fetch,
      baseUrl: (o.baseUrl ?? 'https://api.coingecko.com/api/v3').replace(/\/+$/, ''),
      apiKey: o.apiKey,
      ttlMs: o.ttlMs ?? 60 * 60_000,
      retryMs: o.retryMs ?? 5 * 60_000,
      now: o.now ?? Date.now,
      log: o.log ?? ((m, e) => console.warn(m, e)),
    };
  }

  private async refresh(): Promise<void> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.o.apiKey) headers[this.o.baseUrl.includes('pro-api') ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = this.o.apiKey;
    const res = await this.o.fetchFn(`${this.o.baseUrl}/exchange_rates`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`CoinGecko /exchange_rates answered ${res.status}`);
    const picked = pickRates((await res.json()) as ExchangeRates);
    if (Object.keys(picked).length === 0) throw new Error('CoinGecko /exchange_rates had no usable rates');
    this.rates = picked;
    this.fetchedAt = this.o.now();
  }

  /** Never throws: after a failed refresh the last good rates (or none) are served and the app shows USD. */
  async get(): Promise<Record<string, number>> {
    const t = this.o.now();
    const fresh = this.fetchedAt > 0 && t - this.fetchedAt < this.o.ttlMs;
    if (!fresh && t >= this.nextTryAt) {
      if (!this.inflight) {
        this.inflight = this.refresh()
          .catch((e) => { this.nextTryAt = this.o.now() + this.o.retryMs; this.o.log('Exchange-rate refresh failed; using the previous rates', e); })
          .finally(() => { this.inflight = null; });
      }
      if (this.fetchedAt === 0) await this.inflight;
    }
    return this.rates;
  }
}

export function ratesRoute(cache: Pick<RatesCache, 'get'>): Route {
  return { method: 'GET', path: '/api/rates', handler: async () => ({ status: 200, body: { rates: await cache.get() } }) };
}
