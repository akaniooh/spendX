import { familyOf } from '../../shared/src/chains.ts';
import type { WalletFamily } from '../../shared/src/chains.ts';
import type { Token } from '../../shared/src/types.ts';
import type { OneClickClient } from './oneclick.ts';

export interface ChainGroup {
  blockchain: string;
  family: WalletFamily;
  tokens: Token[];
}

/** Group the live token list by blockchain. Nothing here knows about specific chains or tokens. */
export function groupByChain(tokens: Token[]): ChainGroup[] {
  const map = new Map<string, Token[]>();
  for (const t of tokens) {
    const list = map.get(t.blockchain) ?? [];
    list.push(t);
    map.set(t.blockchain, list);
  }
  return [...map.entries()]
    .map(([blockchain, list]) => ({
      blockchain,
      family: familyOf(blockchain),
      tokens: [...list].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.assetId.localeCompare(b.assetId)),
    }))
    .sort((a, b) => a.blockchain.localeCompare(b.blockchain));
}

/** Short-TTL cache so the UI selectors do not hit 1Click on every keystroke. */
export class CatalogCache {
  private client: Pick<OneClickClient, 'getTokens'>;
  private ttlMs: number;
  private tokens: Token[] | null = null;
  private fetchedAt = 0;
  private inflight: Promise<Token[]> | null = null;

  constructor(client: Pick<OneClickClient, 'getTokens'>, ttlMs = 5 * 60_000) {
    this.client = client;
    this.ttlMs = ttlMs;
  }

  async get(now = Date.now()): Promise<Token[]> {
    if (this.tokens && now - this.fetchedAt < this.ttlMs) return this.tokens;
    if (!this.inflight) {
      this.inflight = this.client
        .getTokens()
        .then((t) => {
          this.tokens = t;
          this.fetchedAt = Date.now();
          return t;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  async findToken(assetId: string): Promise<Token | undefined> {
    return (await this.get()).find((t) => t.assetId === assetId);
  }
}
