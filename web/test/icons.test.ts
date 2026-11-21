import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconSources } from '../src/lib/icon-sources.ts';

test('remote logo is tried first, our own PNG is the backup', () => {
  assert.deepEqual(iconSources('https://img.test/a.png', '/icons/a.png'), ['https://img.test/a.png', '/icons/a.png']);
  assert.deepEqual(iconSources(undefined, '/icons/a.png'), ['/icons/a.png']);
  assert.deepEqual(iconSources(undefined, undefined), []);
});

test('only https or same-site urls are used', () => {
  assert.deepEqual(iconSources('http://evil.test/a.png', '/icons/a.png'), ['/icons/a.png']);
  assert.deepEqual(iconSources('javascript:alert(1)', undefined), []);
});
