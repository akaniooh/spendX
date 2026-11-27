import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertsPromptDismissed, dismissAlertsPrompt, shouldPromptForAlerts } from '../src/lib/alerts-prompt.ts';

test('alerts prompt: shows until an email is confirmed or the prompt is dismissed', () => {
  assert.equal(shouldPromptForAlerts(null, false), false); // still loading
  assert.equal(shouldPromptForAlerts({ enabled: false }, false), true); // no email provider key yet: still shown, setup says it is unavailable
  assert.equal(shouldPromptForAlerts({ enabled: true }, false), true);
  assert.equal(shouldPromptForAlerts({ enabled: true, email: 'a@b.co', verified: false }, false), true); // started, not confirmed
  assert.equal(shouldPromptForAlerts({ enabled: true, email: 'a@b.co', verified: true }, false), false);
  assert.equal(shouldPromptForAlerts({ enabled: true }, true), false);
});

test('alerts prompt: dismissal is remembered per merchant address, ignoring case', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(alertsPromptDismissed('0xAbC'), false);
  dismissAlertsPrompt('0xAbC');
  assert.equal(alertsPromptDismissed('0xabc'), true);
  assert.equal(alertsPromptDismissed('0xdef'), false);
  delete (globalThis as any).localStorage;
});
