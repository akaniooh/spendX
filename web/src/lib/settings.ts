// Preferences kept in this browser only. No React here so every rule can be tested.
import { CURRENCY_CODES } from '../../../shared/src/currencies.ts';

export type ThemePref = 'auto' | 'light' | 'dark';
export type PageSize = 10 | 25 | 50;

export interface Settings {
  theme: ThemePref;
  /** display currency for Portfolio balances; payments and swaps always show USD */
  currency: string;
  hideBalances: boolean;
  hideSmall: boolean;
  activityPageSize: PageSize;
}

/** Dark is the default so the app looks exactly as it did before light mode existed; "Auto" follows the device. */
export const DEFAULT_SETTINGS: Settings = { theme: 'dark', currency: 'USD', hideBalances: false, hideSmall: false, activityPageSize: 10 };
export const SETTINGS_KEY = 'spendx.settings.v1';
export const SMALL_BALANCE_USD = 1;
export const HIDDEN = '••••';
export const PAGE_SIZES: PageSize[] = [10, 25, 50];

/** Anything stored that is missing, from an older version or tampered with falls back to the default for that one field. */
export function parseSettings(raw: string | null): Settings {
  let o: Record<string, unknown> = {};
  try { const v = raw ? JSON.parse(raw) : {}; if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>; } catch { /* corrupt: use defaults */ }
  const d = DEFAULT_SETTINGS;
  return {
    theme: o.theme === 'auto' || o.theme === 'light' || o.theme === 'dark' ? o.theme : d.theme,
    currency: typeof o.currency === 'string' && CURRENCY_CODES.includes(o.currency) ? o.currency : d.currency,
    hideBalances: typeof o.hideBalances === 'boolean' ? o.hideBalances : d.hideBalances,
    hideSmall: typeof o.hideSmall === 'boolean' ? o.hideSmall : d.hideSmall,
    activityPageSize: PAGE_SIZES.includes(o.activityPageSize as PageSize) ? (o.activityPageSize as PageSize) : d.activityPageSize,
  };
}

export function resolveTheme(pref: ThemePref, deviceIsDark: boolean): 'light' | 'dark' {
  return pref === 'auto' ? (deviceIsDark ? 'dark' : 'light') : pref;
}

/** USD amount shown in the chosen currency. Falls back to USD when that currency has no rate yet, never to a wrong number. */
export function formatMoney(usd: number, currency: string, rates: Record<string, number>): string {
  if (!Number.isFinite(usd)) return '–';
  const rate = currency === 'USD' ? 1 : rates[currency];
  const code = rate && Number.isFinite(rate) && rate > 0 ? currency : 'USD';
  const value = usd * (code === 'USD' ? 1 : rate);
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(n);
  const smallest = Number(new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).formatToParts(0.5).find((p) => p.type === 'fraction')?.value.length ?? 2);
  const cent = smallest === 0 ? 1 : 10 ** -smallest;
  return value > 0 && value < cent ? `< ${fmt(cent)}` : fmt(value);
}
