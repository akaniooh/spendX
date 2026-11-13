import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createChallenge, verifyLogin, requireSession, verifySolanaSignature } from '../src/auth.ts';
import type { AuthDeps } from '../src/auth.ts';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function solanaWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { address: b58encode(raw), signMessage: (m: string) => sign(null, Buffer.from(m), privateKey).toString('base64') };
}

let clock = 1_700_000_000_000;
const deps: AuthDeps = {
  secret: 'x'.repeat(32),
  verifiers: { svm: verifySolanaSignature, evm: async ({ signature }) => signature === 'good-evm-sig' },
  now: () => clock,
};

test('Solana signature verification with real ed25519 keys', () => {
  const w = solanaWallet();
  const sig = w.signMessage('hello');
  assert.equal(verifySolanaSignature({ address: w.address, message: 'hello', signature: sig }) as boolean, true);
  assert.equal(verifySolanaSignature({ address: w.address, message: 'hello!', signature: sig }) as boolean, false);
  assert.equal(verifySolanaSignature({ address: solanaWallet().address, message: 'hello', signature: sig }) as boolean, false);
  assert.equal(verifySolanaSignature({ address: w.address, message: 'hello', signature: 'AAAA' }) as boolean, false);
});

test('full sign-in flow yields a session; session carries address and family', async () => {
  const w = solanaWallet();
  const { challengeToken, message } = createChallenge(deps, w.address, 'svm');
  assert.match(message, new RegExp(w.address));
  const s = await verifyLogin(deps, { address: w.address, family: 'svm', challengeToken, signature: w.signMessage(message) });
  assert.deepEqual(requireSession(deps, `Bearer ${s.token}`), { address: w.address, family: 'svm' });
});

test('sign-in rejects wrong signer, expired challenge, swapped address, and tampered tokens', async () => {
  const w = solanaWallet();
  const other = solanaWallet();
  const { challengeToken, message } = createChallenge(deps, w.address, 'svm');
  await assert.rejects(verifyLogin(deps, { address: w.address, family: 'svm', challengeToken, signature: other.signMessage(message) }), { code: 'unauthorized' });
  await assert.rejects(verifyLogin(deps, { address: other.address, family: 'svm', challengeToken, signature: other.signMessage(message) }), { code: 'unauthorized' });
  await assert.rejects(verifyLogin(deps, { address: w.address, family: 'svm', challengeToken: challengeToken.slice(0, -2) + 'xx', signature: w.signMessage(message) }), { code: 'unauthorized' });
  clock += 6 * 60_000;
  await assert.rejects(verifyLogin(deps, { address: w.address, family: 'svm', challengeToken, signature: w.signMessage(message) }), { code: 'unauthorized' });
});

test('sessions expire; garbage and missing headers are rejected; unsupported families refuse early', async () => {
  const { challengeToken } = createChallenge(deps, '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4', 'evm');
  const s = await verifyLogin(deps, { address: '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4', family: 'evm', challengeToken, signature: 'good-evm-sig' });
  assert.equal(requireSession(deps, `Bearer ${s.token}`).family, 'evm');
  clock += 13 * 60 * 60_000;
  assert.throws(() => requireSession(deps, `Bearer ${s.token}`), { code: 'unauthorized' });
  assert.throws(() => requireSession(deps, undefined), { code: 'unauthorized' });
  assert.throws(() => requireSession(deps, 'Bearer nonsense'), { code: 'unauthorized' });
  assert.throws(() => createChallenge(deps, 'alice.near', 'near'), { code: 'unsupported_wallet' });
});

test('the sign-in message is a domain-bound, EIP-4361-style message (so wallets can warn on look-alike sites)', () => {
  const d: AuthDeps = { ...deps, origin: 'https://spendx.example' };
  const evm = createChallenge(d, '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4', 'evm').message;
  assert.match(evm, /^spendx\.example wants you to sign in with your Ethereum account:\n0x85F1/);
  assert.match(evm, /\nURI: https:\/\/spendx\.example\n/);
  assert.match(evm, /\nChain ID: 1\n/);
  assert.match(evm, /\nNonce: [0-9a-f]{32}\n/);
  const sol = createChallenge(d, solanaWallet().address, 'svm').message;
  assert.match(sol, /^spendx\.example wants you to sign in with your Solana account:/);
  assert.doesNotMatch(sol, /Chain ID/);
});

test('a sign-in challenge works once: replaying the same signed challenge is rejected', async () => {
  const w = solanaWallet();
  const d: AuthDeps = { ...deps, origin: 'https://spendx.example' };
  const { challengeToken, message } = createChallenge(d, w.address, 'svm');
  const signature = w.signMessage(message);
  await verifyLogin(d, { address: w.address, family: 'svm', challengeToken, signature });
  await assert.rejects(verifyLogin(d, { address: w.address, family: 'svm', challengeToken, signature }), { code: 'unauthorized' });
  // parallel submissions: only one wins
  const c2 = createChallenge(d, w.address, 'svm');
  const s2 = w.signMessage(c2.message);
  const results = await Promise.allSettled([1, 2].map(() => verifyLogin(d, { address: w.address, family: 'svm', challengeToken: c2.challengeToken, signature: s2 })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('a signature made for another origin does not verify here', async () => {
  const w = solanaWallet();
  const evil: AuthDeps = { ...deps, origin: 'https://evil.example' };
  const real: AuthDeps = { ...deps, origin: 'https://spendx.example' };
  const forged = createChallenge(evil, w.address, 'svm'); // the user was tricked into signing a message naming evil.example
  const sig = w.signMessage(forged.message);
  await assert.rejects(verifyLogin(real, { address: w.address, family: 'svm', challengeToken: forged.challengeToken, signature: sig }), { code: 'unauthorized' });
});
