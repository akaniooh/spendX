// Block explorer transaction links, by 1Click blockchain id. Purely cosmetic: the status page prefers the
// explorer URL that NEAR Intents itself returns for each transaction, and falls back to these.
const EXPLORERS: Record<string, string> = {
  eth: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  arb: 'https://arbiscan.io/tx/',
  op: 'https://optimistic.etherscan.io/tx/',
  pol: 'https://polygonscan.com/tx/',
  bsc: 'https://bscscan.com/tx/',
  avax: 'https://snowtrace.io/tx/',
  gnosis: 'https://gnosisscan.io/tx/',
  scroll: 'https://scrollscan.com/tx/',
  sol: 'https://solscan.io/tx/',
  near: 'https://nearblocks.io/txns/',
};

export function txUrl(blockchain: string, hash: string): string | null {
  const base = EXPLORERS[blockchain];
  return base && /^[A-Za-z0-9]{8,100}$/.test(hash) ? base + hash : null;
}
