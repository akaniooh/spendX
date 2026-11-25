// Block explorer transaction links, by 1Click blockchain id.
//
// SECURITY: a link shown to a merchant must never come from the browser. Anyone who knows an attempt id can call the
// deposit endpoint, so a link they send could be `javascript:` code or a look-alike site. The server therefore builds
// the link itself from the chain and the transaction hash (txUrl), and every link that reaches a page passes
// through safeExplorerUrl, which only lets plain https links through.
import { EXTRA_EVM_CHAINS } from './evm-chains.ts';

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
  ...Object.fromEntries(Object.entries(EXTRA_EVM_CHAINS).map(([key, c]) => [key, `${c.explorer}/tx/`])),
};

export function txUrl(blockchain: string, hash: string): string | null {
  const base = EXPLORERS[blockchain];
  return base && /^[A-Za-z0-9]{8,100}$/.test(hash) ? base + hash : null;
}

/** The link itself if it is a plain https URL without a password in it; otherwise null. Never throws. */
export function safeExplorerUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}
