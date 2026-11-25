import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeExplorerUrl, txUrl } from '../src/explorers.ts';

test('explorer links are built from the chain and hash, never taken from the browser', () => {
  assert.equal(txUrl('eth', '0x' + 'ab'.repeat(32)), 'https://etherscan.io/tx/0x' + 'ab'.repeat(32));
  assert.equal(txUrl('hood', '0x' + 'cd'.repeat(32)), 'https://robinhoodchain.blockscout.com/tx/0x' + 'cd'.repeat(32));
  assert.equal(txUrl('unknownchain', '0x' + 'ab'.repeat(32)), null);
  assert.equal(txUrl('eth', 'not a hash!'), null);
  assert.equal(txUrl('eth', '../../evil'), null);
});

test('only plain https links are allowed through', () => {
  assert.equal(safeExplorerUrl('https://basescan.org/tx/0xabc12345'), 'https://basescan.org/tx/0xabc12345');
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'http://basescan.org/tx/0xabc', '//evil.example/x', 'https://user:pass@basescan.org/tx/1', 'https://localhost/x',
    'ftp://x.example/a', '', 'x'.repeat(600), null, undefined, 42, {},
  ]) assert.equal(safeExplorerUrl(bad), null, String(bad).slice(0, 40));
});
