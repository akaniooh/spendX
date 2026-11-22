// Everything SpendX remembers in this browser, in one place: which keys exist, how the portfolio history is stored, and how it is cleared.
// Settings > App data clears these, so the keys must never be written out anywhere else.
// (Wallet sessions live in wallets/WalletContext.tsx and are deliberately not clearable from here.)
import type { Snapshot } from './portfolio.ts';

export const PORTFOLIO_HISTORY_KEY = 'spendx.portfolio.history.v1';
export const ACTIVITY_HISTORY_KEY = 'spendx.history';
export const LOCAL_DATA_CLEARED_EVENT = 'spendx:local-data-cleared';

/** Saved Portfolio totals are kept per wallet set, all under one key. */
export function loadPortfolioHistory(walletKey: string): Snapshot[] {
  try {
    const all = JSON.parse(localStorage.getItem(PORTFOLIO_HISTORY_KEY) ?? '{}');
    return Array.isArray(all?.[walletKey]) ? all[walletKey] : [];
  } catch { return []; }
}

export function savePortfolioHistory(walletKey: string, list: Snapshot[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(PORTFOLIO_HISTORY_KEY) ?? '{}');
    all[walletKey] = list;
    localStorage.setItem(PORTFOLIO_HISTORY_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the chart simply has less history */ }
}

/** Removes one stored item and tells open pages, so they refresh without a reload. */
export function clearLocalData(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  window.dispatchEvent(new Event(LOCAL_DATA_CLEARED_EVENT));
}

/** Runs `fn` whenever Settings clears local data. Returns the function that stops listening. */
export function onLocalDataCleared(fn: () => void): () => void {
  window.addEventListener(LOCAL_DATA_CLEARED_EVENT, fn);
  return () => window.removeEventListener(LOCAL_DATA_CLEARED_EVENT, fn);
}
