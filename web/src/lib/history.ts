export interface HistoryEntry {
  attemptId: string;
  slug: string;
  createdAt: string;
  label: string; // e.g. "Swap 10 SOL to USDC"
  kind?: 'swap' | 'payment';
  fromChain?: string;
  fromSymbol?: string;
  toChain?: string;
  toSymbol?: string;
  amountIn?: string; // human amount of the source token
}

const MAX = 50;
const KEY = 'spendx.history';

export function addHistory(list: HistoryEntry[], e: HistoryEntry): HistoryEntry[] {
  return [e, ...list.filter((x) => x.attemptId !== e.attemptId)].slice(0, MAX);
}

export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.attemptId === 'string' && typeof x.slug === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Browser-local history of payments started here. A convenience only: failures are ignored. */
export function loadHistory(): HistoryEntry[] {
  try { return parseHistory(localStorage.getItem(KEY)); } catch { return []; }
}
export function saveHistory(entry: Omit<HistoryEntry, 'createdAt'>): void {
  try { localStorage.setItem(KEY, JSON.stringify(addHistory(loadHistory(), { ...entry, createdAt: new Date().toISOString() }))); } catch { /* ignore */ }
}
