import type { AppFee } from './types.ts';

// How SpendX earns money: the 1Click `appFees` quote parameter (docs.near-intents.org -> Fee Configuration).
//
// The rules below are NEAR Intents' published ones, copied here so config validation and the cost shown to
// customers use one source of truth. They are re-checked with `npm run fee:check` (dry quotes only).
//
//   - `fee` is an integer in basis points, taken from the INPUT token. For EXACT_OUTPUT (payments) it raises the
//     deposit the payer must make, so the merchant still receives exactly the requested amount.
//   - WITH an API key: the submitted fee is split 50/50 with 1Click, and 1Click's half has a 20 bps minimum
//     (1 bp for USDC/USDT/DAI pairs and same-asset cross-chain routes). So to KEEP k bps you submit 2k.
//   - WITHOUT an API key the docs say you keep the whole fee and 1Click adds 25 bps on top. MEASURED against the live
//     API (dry quotes, 2026-11-22) it does not behave that way: the customer pays the full fee extra, but 1Click lists
//     only HALF (rounded up) as the recipient's: 25 -> 13, 50 -> 25, 11 -> 6, on payments and swaps. So the split is
//     assumed to apply without a key too (ONECLICK_SPLITS_WITHOUT_KEY below). That the echoed half is what actually
//     arrives still has to be confirmed with one small real payment.
//   - MEASURED (dry quote + a real payment, 2026-11-22): when the payer's token and the merchant's token are the SAME ASSET
//     (ETH on Base to ETH on Base), 1Click does not split the fee. 50 submitted came back as 50 and 50 bps arrived. So
//     there the whole submitted fee is yours and you must submit `keep`, not 2x keep. This is based on one route.
//   - The combined total (yours + 1Click's) may not exceed 500 bps.

export const ONECLICK_MIN_SHARE_BPS = 20;
export const ONECLICK_NO_KEY_ADDON_BPS = 25;
export const ONECLICK_MAX_TOTAL_BPS = 500;
/**
 * Observed, not documented: without an API key 1Click also splits the submitted fee in half. If a real payment shows
 * your recipient receives the FULL fee, set this to false and the code goes back to submitting exactly what you keep.
 */
export const ONECLICK_SPLITS_WITHOUT_KEY = true;
const splits = (hasApiKey: boolean) => hasApiKey || ONECLICK_SPLITS_WITHOUT_KEY;

export interface FeeConfig {
  /** Intents account that receives the fee. When unset, no fee is taken. */
  recipient?: string;
  /** what SpendX wants to KEEP on a swap / on a merchant payment, in bps (before 1Click's own share) */
  swapBps: number;
  paymentBps: number;
  referral?: string;
  /** whether requests to 1Click are authenticated; this changes how the fee is split */
  hasApiKey: boolean;
}

/** The `fee` value to send so that SpendX keeps `keepBps`. `sameAsset`: payer and merchant use the identical asset id. */
export function feeToSubmit(keepBps: number, hasApiKey: boolean, sameAsset = false): number {
  if (!Number.isInteger(keepBps) || keepBps <= 0) return 0;
  return splits(hasApiKey) && !sameAsset ? keepBps * 2 : keepBps;
}

/** What SpendX actually earns from a submitted fee. */
export function ourShareBps(submittedFee: number, hasApiKey: boolean, sameAsset = false): number {
  if (submittedFee <= 0) return 0;
  return splits(hasApiKey) && !sameAsset ? Math.ceil(submittedFee / 2) : submittedFee;
}

/**
 * Highest combined fee (SpendX + 1Click) a customer can be charged for a submitted fee. It is an upper bound:
 * stablecoin pairs can be cheaper because 1Click's minimum there is 1 bp, not 20.
 */
export function worstCaseTotalBps(submittedFee: number, hasApiKey: boolean, sameAsset = false): number {
  if (sameAsset) return submittedFee + (hasApiKey ? ONECLICK_MIN_SHARE_BPS : ONECLICK_NO_KEY_ADDON_BPS);
  if (submittedFee <= 0) return hasApiKey ? ONECLICK_MIN_SHARE_BPS : ONECLICK_NO_KEY_ADDON_BPS;
  if (!hasApiKey) return submittedFee + ONECLICK_NO_KEY_ADDON_BPS;
  const ours = Math.ceil(submittedFee / 2);
  return ours + Math.max(submittedFee - ours, ONECLICK_MIN_SHARE_BPS);
}

/** Intents account ids: a NEAR named/implicit account or an EVM-style address. */
export function isValidFeeRecipient(v: string): boolean {
  if (v.length < 2 || v.length > 64) return false;
  // Anything starting 0x must be a complete EVM address: "0x123" is far more likely a truncated paste than a NEAR account,
  // and revenue sent to a mistyped recipient is lost.
  if (v.startsWith('0x')) return /^0x[0-9a-fA-F]{40}$/.test(v);
  return /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(v);
}

/** 1Click's `referral` identifier rule: lowercase letters and digits, joined by single - _ or ., up to 57 chars. */
export function isValidReferral(v: string): boolean {
  return v.length <= 57 && /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(v);
}

/** The `appFees` array for a request, or undefined when SpendX takes no fee. */
export function buildAppFees(recipient: string | undefined, keepBps: number, hasApiKey: boolean, sameAsset = false): AppFee[] | undefined {
  const fee = feeToSubmit(keepBps, hasApiKey, sameAsset);
  if (!recipient || fee <= 0) return undefined;
  return [{ recipient, fee }];
}

/**
 * A live quote is signed over the request it echoes. If we asked for a fee, an entry for OUR recipient must be there,
 * otherwise the fee was dropped or redirected and we must not show a deposit address.
 *
 * The echoed amount may be LOWER than what we submitted: against the live API, a submitted 25 bps came back as 13
 * (about half), so 1Click appears to report our share after its split. A lower value therefore is not an error,
 * but a zero or HIGHER value is (the customer would be charged more than we computed).
 * Extra entries are tolerated on purpose: 1Click may add its own share to the echo.
 */
export function checkEchoedAppFees(expected: AppFee[] | undefined, echoed: AppFee[] | undefined): string | null {
  if (!expected || expected.length === 0) return null;
  const norm = (a: string) => (a.startsWith('0x') ? a.toLowerCase() : a);
  for (const want of expected) {
    const hit = (echoed ?? []).some((e) => norm(e.recipient) === norm(want.recipient) && e.fee > 0 && e.fee <= want.fee);
    if (!hit) return 'Quote does not carry the SpendX fee that was requested';
  }
  return null;
}

/** Rough USD value of `bps` of a quote's input amount (an estimate, labelled as such in the UI). */
export function feeUsdEstimate(amountInUsd: string | number, bps: number): number {
  const usd = Number(amountInUsd);
  if (!Number.isFinite(usd) || usd <= 0 || bps <= 0) return 0;
  return Math.round(usd * bps * 100) / 1_000_000;
}

// ---------- verification helpers (used by `npm run fee:check`, which sends DRY quotes only) ----------

/** How much a quote moved, in basis points, from `base` to `other` (positive = `other` is larger). */
export function bpsChange(base: bigint, other: bigint): number {
  if (base <= 0n) return NaN;
  const diff = other - base;
  return Number((diff * 100_000n) / base) / 10; // one decimal of a basis point
}

export interface ExtraBpsScenario {
  label: string;
  /** expected extra cost of adding our fee, versus the same route with no appFees at all */
  extraBps: number;
}

/**
 * What the published rules predict when a quote with our fee is compared to one without any appFees.
 * Two scenarios because 1Click's minimum share is 20 bps normally but 1 bp for stablecoin pairs.
 */
export function expectedExtraScenarios(keepBps: number, hasApiKey: boolean, sameAsset = false): ExtraBpsScenario[] {
  const submitted = feeToSubmit(keepBps, hasApiKey, sameAsset);
  if (submitted <= 0) return [{ label: 'no fee', extraBps: 0 }];
  if (sameAsset) return [{ label: 'same asset on the same chain: no split', extraBps: submitted }];
  if (!hasApiKey) {
    const extra = submitted; // the customer pays the whole submitted fee extra; 1Click's own base fee is in both quotes
    return [{ label: 'any pair (no API key)', extraBps: extra }];
  }
  const ours = Math.ceil(submitted / 2);
  const total = (minShare: number) => ours + Math.max(submitted - ours, minShare);
  return [
    { label: 'standard pair', extraBps: total(ONECLICK_MIN_SHARE_BPS) - ONECLICK_MIN_SHARE_BPS },
    { label: 'stablecoin / same-asset route', extraBps: total(1) - 1 },
  ];
}

/** The scenario the measurement agrees with, within `toleranceBps`, or null. */
export function matchScenario(measuredExtraBps: number, scenarios: ExtraBpsScenario[], toleranceBps: number): ExtraBpsScenario | null {
  if (!Number.isFinite(measuredExtraBps)) return null;
  return scenarios.find((s) => Math.abs(measuredExtraBps - s.extraBps) <= toleranceBps) ?? null;
}
