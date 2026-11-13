import { chainName } from '../../../shared/src/chain-names.ts';

export const chainLabel = chainName;

export function shortAddr(a: string, head = 6, tail = 4): string {
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

/** Look-alike tokens (same symbol, same chain) are labelled with where they come from, so they cannot be confused. */
export function tokenOptionLabel(t: { symbol: string; contractAddress: string | null; assetId: string; duplicateSymbol: boolean }): string {
  return t.duplicateSymbol ? `${t.symbol} (${shortAddr(t.contractAddress ?? t.assetId, 8, 6)})` : t.symbol;
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return n < 0.01 && n > 0 ? '< $0.01' : `$${n.toFixed(2)}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s`;
  return `~${Math.round(seconds / 60)} min`;
}
