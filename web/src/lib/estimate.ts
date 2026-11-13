import type { WalletFamily } from '../../../shared/src/chains.ts';

/**
 * A quote for an ESTIMATE does not need the user's real addresses (a dry quote creates nothing and moves no funds),
 * so the swap and payment screens can show the live rate before any wallet is connected. These are the public example
 * addresses from the NEAR Intents docs, used only for dry quotes. Real swaps always use the user's own addresses.
 */
const ESTIMATE_ADDRESS: Partial<Record<WalletFamily, string>> = {
  evm: '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4',
  svm: 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z',
  near: 'alice.near',
};

export const estimateAddress = (family: WalletFamily): string | null => ESTIMATE_ADDRESS[family] ?? null;

/** Rate from catalog USD prices, shown (as indicative) before a real quote arrives. */
export function indicativeRate(fromPrice: number | null | undefined, toPrice: number | null | undefined): number | null {
  if (!fromPrice || !toPrice || fromPrice <= 0 || toPrice <= 0) return null;
  const r = fromPrice / toPrice;
  return Number.isFinite(r) ? r : null;
}

/** 4 to 6 significant digits, thousands separators for large values, no trailing zeros. */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '–';
  if (rate >= 1000) return rate.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (rate >= 1) return String(Number(rate.toPrecision(6)));
  return String(Number(rate.toPrecision(4)));
}
