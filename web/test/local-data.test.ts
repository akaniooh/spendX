import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_HISTORY_KEY, PORTFOLIO_HISTORY_KEY, clearLocalData, loadPortfolioHistory, onLocalDataCleared, savePortfolioHistory } from '../src/lib/local-data.ts';

// A tiny stand-in for the browser's storage and window, so the rules can be tested without a browser.
function fakeBrowser() {
  const store = new Map<string, string>();
  const target = new EventTarget();
  Object.assign(globalThis, {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    window: { addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) },
  });
  return store;
}

test('portfolio history: kept per wallet set, empty when nothing or garbage is stored', () => {
  const store = fakeBrowser();
  assert.deepEqual(loadPortfolioHistory('a|b'), []);
  savePortfolioHistory('a|b', [{ t: 1, v: 2 }]);
  savePortfolioHistory('c', [{ t: 3, v: 4 }]);
  assert.deepEqual(loadPortfolioHistory('a|b'), [{ t: 1, v: 2 }]);
  assert.deepEqual(loadPortfolioHistory('c'), [{ t: 3, v: 4 }]);
  store.set(PORTFOLIO_HISTORY_KEY, 'not json');
  assert.deepEqual(loadPortfolioHistory('a|b'), []);
});

test('clearing local data removes only that key and tells listeners; listeners can stop', () => {
  const store = fakeBrowser();
  store.set(ACTIVITY_HISTORY_KEY, '[]'); store.set(PORTFOLIO_HISTORY_KEY, '{}'); store.set('other', 'keep');
  let heard = 0;
  const stop = onLocalDataCleared(() => { heard++; });
  clearLocalData(ACTIVITY_HISTORY_KEY);
  assert.equal(store.has(ACTIVITY_HISTORY_KEY), false);
  assert.equal(store.has(PORTFOLIO_HISTORY_KEY), true);
  assert.equal(store.get('other'), 'keep');
  assert.equal(heard, 1);
  stop();
  clearLocalData(PORTFOLIO_HISTORY_KEY);
  assert.equal(heard, 1);
});
