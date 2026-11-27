// When to nudge a signed-in merchant to set up email alerts. No React here so the rules can be tested.
import type { AlertStatus } from './api.ts';

export const ALERTS_PROMPT_KEY = 'spendx.alertsPrompt.v1';

const norm = (address: string) => address.trim().toLowerCase();

function readAll(): Record<string, true> {
  try {
    const v = JSON.parse(localStorage.getItem(ALERTS_PROMPT_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** True when this merchant already pressed "Not now", so the pop-up does not come back every visit. */
export function alertsPromptDismissed(address: string): boolean {
  return readAll()[norm(address)] === true;
}

export function dismissAlertsPrompt(address: string): void {
  try { localStorage.setItem(ALERTS_PROMPT_KEY, JSON.stringify({ ...readAll(), [norm(address)]: true })); } catch { /* storage unavailable: it shows again next visit */ }
}

/**
 * Show the pop-up when the merchant has not confirmed an address yet and has not dismissed it. `status` is null
 * until it has loaded. It shows even while the server cannot send email yet: trying to set it up then says so.
 */
export function shouldPromptForAlerts(status: AlertStatus | null, dismissed: boolean): boolean {
  return !!status && !status.verified && !dismissed;
}
