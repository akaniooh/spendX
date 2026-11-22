import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, formatMoney, parseSettings, resolveTheme } from '../src/lib/settings.ts';
import { formatChange } from '../src/lib/portfolio.ts';

test('settings: defaults when nothing is stored; each bad field falls back on its own', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('not json'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('[1,2]'), DEFAULT_SETTINGS);
  const s = parseSettings(JSON.stringify({ theme: 'light', currency: 'KES', hideBalances: true, hideSmall: 'yes', activityPageSize: 25, extra: 1 }));
  assert.deepEqual(s, { theme: 'light', currency: 'KES', hideBalances: true, hideSmall: false, activityPageSize: 25 });
  assert.equal(parseSettings(JSON.stringify({ currency: 'XYZ', theme: 'neon', activityPageSize: 7 })).currency, 'USD');
  assert.equal(DEFAULT_SETTINGS.theme, 'dark'); // the look people already know stays the default
});

test('theme: auto follows the device, a choice wins', () => {
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('money: converts with the rate, falls back to USD without one, never shows a tiny amount as zero', () => {
  const rates = { USD: 1, KES: 129, JPY: 150 };
  const plain = (v: string) => v.replace(/\u00a0/g, ' '); // Intl puts a non-breaking space after a currency code
  assert.equal(formatMoney(1234.5, 'USD', rates), '$1,234.50');
  assert.equal(plain(formatMoney(10, 'KES', rates)), 'KES 1,290.00');
  assert.equal(formatMoney(10, 'JPY', rates), '¥1,500');
  assert.equal(formatMoney(10, 'KES', { USD: 1 }), '$10.00'); // no rate yet: USD, not a wrong number
  assert.equal(formatMoney(0.001, 'USD', rates), '< $0.01');
  assert.equal(formatMoney(0, 'USD', rates), '$0.00');
  assert.equal(formatMoney(NaN, 'USD', rates), '–');
});

test('daily change text uses the chosen currency', () => {
  const c = { abs: -2, pct: -4, sinceMs: 1, points: [] };
  assert.equal(formatChange(c).abs, '-$2.00');
  assert.equal(formatChange(c, (n) => `KES ${n * 129}`).abs, '-KES 258');
});
