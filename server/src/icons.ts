import type { Route } from './api.ts';
import type { Token } from '../../shared/src/types.ts';

// Logos for chains and tokens come from CoinGecko, fetched by the server and cached, so the browser never talks to
// CoinGecko directly and the API key (optional) stays private. The web app falls back to its own PNGs in
// web/public/icons, then to a coloured letter disc, for anything CoinGecko does not return.

export interface IconMaps {
  /** 1Click blockchain id -> https image url */
  chains: Record<string, string>;
  /** upper-case token symbol -> https image url */
  tokens: Record<string, string>;
}

interface Market { id: string; symbol: string; image?: string | null }
interface Platform { id: string; image?: { large?: string | null; small?: string | null; thumb?: string | null } | null }

/**
 * How each 1Click blockchain id maps to CoinGecko: an asset platform (the network's own logo) and/or the native coin.
 * The ids are best effort. A wrong or missing one simply means that chain falls back to the PNG in web/public/icons.
 */
export const CHAIN_SOURCES: Record<string, { platform?: string; coin?: string }> = {
  eth: { platform: 'ethereum', coin: 'ethereum' }, base: { platform: 'base' }, arb: { platform: 'arbitrum-one' },
  op: { platform: 'optimistic-ethereum' }, pol: { platform: 'polygon-pos' }, bsc: { platform: 'binance-smart-chain', coin: 'binancecoin' },
  avax: { platform: 'avalanche', coin: 'avalanche-2' }, gnosis: { platform: 'xdai' }, scroll: { platform: 'scroll' },
  sol: { platform: 'solana', coin: 'solana' }, near: { platform: 'near-protocol', coin: 'near' }, btc: { coin: 'bitcoin' },
  ton: { platform: 'the-open-network', coin: 'the-open-network' }, sui: { platform: 'sui', coin: 'sui' },
  aptos: { platform: 'aptos', coin: 'aptos' }, tron: { platform: 'tron', coin: 'tron' }, doge: { coin: 'dogecoin' },
  ltc: { coin: 'litecoin' }, xrp: { coin: 'ripple' }, zec: { coin: 'zcash' }, stellar: { coin: 'stellar' },
  starknet: { platform: 'starknet', coin: 'starknet' }, cardano: { platform: 'cardano', coin: 'cardano' },
  bch: { coin: 'bitcoin-cash' }, dash: { coin: 'dash' }, bera: { platform: 'berachain', coin: 'berachain-bera' },
  monad: { platform: 'monad', coin: 'monad' }, plasma: { platform: 'plasma', coin: 'plasma' },
  xlayer: { platform: 'x-layer', coin: 'okb' }, aurora: { platform: 'aurora', coin: 'aurora-near' },
  hypercore: { platform: 'hyperliquid', coin: 'hyperliquid' }, hyperliquid: { platform: 'hyperliquid', coin: 'hyperliquid' },
  movement: { platform: 'movement', coin: 'movement' }, fogo: { coin: 'fogo' }, abs: { platform: 'abstract' },
};

const https = (u: string | null | undefined): string | undefined => (typeof u === 'string' && u.startsWith('https://') ? u : undefined);

/** Pure: turn CoinGecko's market list (ordered by market cap) and platform list into icon maps. */
export function buildIconMaps(markets: Market[], platforms: Platform[]): IconMaps {
  const tokens: Record<string, string> = {};
  const coinImage = new Map<string, string>();
  for (const m of markets) {
    const url = https(m.image);
    if (!url) continue;
    coinImage.set(m.id, url);
    const sym = String(m.symbol ?? '').toUpperCase();
    // the list is ordered by market cap, so the first coin for a symbol is the well-known one, not a look-alike
    if (sym && !(sym in tokens)) tokens[sym] = url;
  }
  const platformImage = new Map<string, string>();
  for (const p of platforms) {
    const url = https(p.image?.large) ?? https(p.image?.small) ?? https(p.image?.thumb);
    if (url) platformImage.set(p.id, url);
  }
  const chains: Record<string, string> = {};
  for (const [chain, src] of Object.entries(CHAIN_SOURCES)) {
    const url = (src.platform ? platformImage.get(src.platform) : undefined) ?? (src.coin ? coinImage.get(src.coin) : undefined);
    if (url) chains[chain] = url;
  }
  return { chains, tokens };
}

/** Pure: only send the browser what it can use, the chains and symbols that are actually in the live catalog. */
export function pickForCatalog(maps: IconMaps, catalog: Pick<Token, 'blockchain' | 'symbol'>[]): IconMaps {
  const chains: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  for (const t of catalog) {
    const c = maps.chains[t.blockchain];
    if (c) chains[t.blockchain] = c;
    const s = t.symbol.toUpperCase();
    const u = maps.tokens[s];
    if (u) tokens[s] = u;
  }
  return { chains, tokens };
}

export interface IconCacheOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  /** market-list pages to read, 250 coins each */
  pages?: number;
  ttlMs?: number;
  /** wait this long after a failed refresh before trying again */
  retryMs?: number;
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}

export class IconCache {
  private o: Required<Omit<IconCacheOptions, 'apiKey'>> & { apiKey?: string };
  private maps: IconMaps = { chains: {}, tokens: {} };
  private fetchedAt = 0;
  private nextTryAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(o: IconCacheOptions = {}) {
    this.o = {
      fetchFn: o.fetchFn ?? fetch,
      baseUrl: (o.baseUrl ?? 'https://api.coingecko.com/api/v3').replace(/\/+$/, ''),
      apiKey: o.apiKey,
      pages: o.pages ?? 4,
      ttlMs: o.ttlMs ?? 12 * 3_600_000,
      retryMs: o.retryMs ?? 5 * 60_000,
      now: o.now ?? Date.now,
      log: o.log ?? ((m, e) => console.warn(m, e)),
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.o.apiKey) headers[this.o.baseUrl.includes('pro-api') ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = this.o.apiKey;
    const res = await this.o.fetchFn(`${this.o.baseUrl}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`CoinGecko ${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  private async refresh(): Promise<void> {
    const markets: Market[] = [];
    for (let page = 1; page <= this.o.pages; page++) {
      markets.push(...(await this.getJson<Market[]>(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`)));
    }
    const platforms = await this.getJson<Platform[]>('/asset_platforms');
    this.maps = buildIconMaps(markets, platforms);
    this.fetchedAt = this.o.now();
  }

  /** Never throws: a failed refresh keeps the last good icons (or none) and the UI falls back to its own PNGs. */
  async get(): Promise<IconMaps> {
    const t = this.o.now();
    const fresh = this.fetchedAt > 0 && t - this.fetchedAt < this.o.ttlMs;
    if (!fresh && t >= this.nextTryAt) {
      if (!this.inflight) {
        this.inflight = this.refresh()
          .catch((e) => {
            this.nextTryAt = this.o.now() + this.o.retryMs;
            this.o.log('Icon refresh from CoinGecko failed; using the previous icons', e);
          })
          .finally(() => { this.inflight = null; });
      }
      // first load waits for the answer; later refreshes happen in the background while the old icons are served
      if (this.fetchedAt === 0) await this.inflight;
    }
    return this.maps;
  }
}

export function iconsRoute(cache: Pick<IconCache, 'get'>, catalog: { get(): Promise<Token[]> }): Route {
  return {
    method: 'GET',
    path: '/api/icons',
    handler: async () => {
      const maps = await cache.get();
      let tokens: Token[] = [];
      try { tokens = await catalog.get(); } catch { /* no catalog yet: send nothing rather than everything */ }
      return { status: 200, body: pickForCatalog(maps, tokens) };
    },
  };
}
