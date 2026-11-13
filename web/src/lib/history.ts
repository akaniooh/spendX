export interface HistoryEntry {
  attemptId: string;
  slug: string;
  createdAt: string;
  label: string; // e.g. "Swap 10 SOL to USDC"
  kind?: 'swap' | 'payment' | 'request'; // 'request' = a payment link this wallet created as a merchant
  fromChain?: string;
  fromSymbol?: string;
  toChain?: string;
  toSymbol?: string;
  amountIn?: string; // human amount of the source token
  payer?: string; // wallet address that made it; local entries only show for connected wallets
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

/** EVM addresses compare case-insensitively (checksummed vs lowercase); Solana and NEAR are exact. */
export function sameAddress(a: string, b: string): boolean {
  return a.startsWith('0x') && b.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Only entries made by one of these wallets. Entries saved before wallets were recorded have no payer and are left out. */
export function forWallets(list: HistoryEntry[], addresses: (string | null | undefined)[]): HistoryEntry[] {
  const mine = addresses.filter((a): a is string => !!a);
  return list.filter((e) => !!e.payer && mine.some((a) => sameAddress(a, e.payer!)));
}

/** Browser-local history of payments started here. A convenience only: failures are ignored. */
export function loadHistory(): HistoryEntry[] {
  try { return parseHistory(localStorage.getItem(KEY)); } catch { return []; }
}
export function saveHistory(entry: Omit<HistoryEntry, 'createdAt'>): void {
  try { localStorage.setItem(KEY, JSON.stringify(addHistory(loadHistory(), { ...entry, createdAt: new Date().toISOString() }))); } catch { /* ignore */ }
}
