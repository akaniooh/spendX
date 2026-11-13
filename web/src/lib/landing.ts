import type { CatalogChain, CatalogToken } from './types.ts';

/** Real numbers for the landing page, straight from the live NEAR Intents catalog. */
export function catalogStats(chains: CatalogChain[]): { networks: number; tokens: number } {
  return { networks: chains.length, tokens: chains.reduce((n, c) => n + c.tokens.length, 0) };
}

export interface SampleRoute {
  fromChain: string;
  from: CatalogToken;
  toChain: string;
  to: CatalogToken;
}

// A sample pair for the hero's live quote. It is only a choice of what to DISPLAY: the numbers are a real quote,
// and if none of these pairs exists in the catalog the card simply does not appear.
const PREFERRED: [string, string, string, string][] = [
  ['sol', 'SOL', 'base', 'USDC'],
  ['eth', 'ETH', 'base', 'USDC'],
  ['base', 'USDC', 'sol', 'SOL'],
];

export function pickSampleRoute(chains: CatalogChain[]): SampleRoute | null {
  const find = (chain: string, symbol: string) => {
    const t = chains.find((c) => c.blockchain === chain)?.tokens.filter((x) => x.symbol.toUpperCase() === symbol);
    return t && t.length === 1 ? t[0] : undefined; // a symbol that is ambiguous on a chain is never used as a sample
  };
  for (const [fc, fs, tc, ts] of PREFERRED) {
    const from = find(fc, fs);
    const to = find(tc, ts);
    if (from && to) return { fromChain: fc, from, toChain: tc, to };
  }
  return null;
}

/** Scroll to a section of the landing page. (Anchor links would collide with the hash router.) */
export function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
