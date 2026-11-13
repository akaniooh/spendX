import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as edVerify } from 'node:crypto';
import { base58Decode } from '../../shared/src/addresses.ts';
import { NEAR_SIGN_RECIPIENT } from '../../shared/src/near-sign.ts';
import type { WalletFamily } from '../../shared/src/chains.ts';
import { SpendXError } from './domain.ts';

// Wallet-signature sign-in for merchants. Stateless: the challenge and the session are HMAC-signed tokens,
// so nothing is stored server-side. Signing the message costs nothing and sends no transaction.

export type SignatureVerifier = (a: { address: string; message: string; signature: string }) => Promise<boolean> | boolean;

export interface AuthDeps {
  secret: string; // >= 32 chars
  verifiers: Partial<Record<WalletFamily, SignatureVerifier>>;
  /** The public https origin of the web app (PUBLIC_ORIGIN). It is written into the message the wallet shows. */
  origin?: string;
  now?: () => number;
}

export interface Session {
  address: string;
  family: WalletFamily;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
export const DEFAULT_ORIGIN = 'http://localhost:5173';

// A challenge can be used once. Kept in memory (per process): a restart forgets used nonces, but they also expire
// after 5 minutes, so the replay window across a restart is tiny. Use a shared store if you run several instances.
const usedNonces = new WeakMap<AuthDeps, Map<string, number>>();
function consumeNonce(d: AuthDeps, nonce: string, exp: number, now: number): boolean {
  let m = usedNonces.get(d);
  if (!m) usedNonces.set(d, (m = new Map()));
  for (const [n, e] of m) if (e < now) m.delete(n);
  if (m.has(nonce)) return false;
  m.set(nonce, exp);
  return true;
}
const SESSION_TTL_MS = 12 * 60 * 60_000;

function mac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
function pack(secret: string, claims: object): string {
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${p}.${mac(secret, p)}`;
}
function unpack<T>(secret: string, token: string): T | null {
  const [p, sig, extra] = token.split('.');
  if (!p || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(secret, p));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

interface ChallengeClaims { t: 'c'; a: string; f: WalletFamily; n: string; iat: number; exp: number }
interface SessionClaims { t: 's'; a: string; f: WalletFamily; exp: number }

const ACCOUNT_LABEL: Record<string, string> = { evm: 'Ethereum', svm: 'Solana', near: 'NEAR' };

/**
 * Sign-In with Ethereum (EIP-4361) layout, also used for Solana. Wallets that understand it (MetaMask, Phantom)
 * compare the domain on the first line with the site you are actually on and warn on a mismatch, which is what
 * stops a look-alike site from collecting a SpendX sign-in.
 */
export function challengeMessage(c: { address: string; family: WalletFamily; nonce: string; iat: number; exp: number; origin?: string }): string {
  const origin = (c.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
  const domain = new URL(origin).host;
  return [
    `${domain} wants you to sign in with your ${ACCOUNT_LABEL[c.family] ?? c.family} account:`,
    c.address,
    '',
    'Sign in to SpendX. This does not send a transaction or cost any fees.',
    '',
    `URI: ${origin}`,
    'Version: 1',
    ...(c.family === 'evm' ? ['Chain ID: 1'] : []),
    `Nonce: ${c.nonce}`,
    `Issued At: ${new Date(c.iat).toISOString()}`,
    `Expiration Time: ${new Date(c.exp).toISOString()}`,
  ].join('\n');
}

export function createChallenge(d: AuthDeps, address: string, family: WalletFamily) {
  if (!d.verifiers[family]) {
    throw new SpendXError('unsupported_wallet', `Signing in with a ${family} wallet is not supported yet. Use an EVM, Solana or NEAR wallet to sign in.`, 400);
  }
  const now = (d.now ?? Date.now)();
  const claims: ChallengeClaims = { t: 'c', a: address, f: family, n: randomBytes(16).toString('hex'), iat: now, exp: now + CHALLENGE_TTL_MS };
  return {
    challengeToken: pack(d.secret, claims),
    message: challengeMessage({ address, family, nonce: claims.n, iat: claims.iat, exp: claims.exp, origin: d.origin }),
  };
}

export async function verifyLogin(d: AuthDeps, i: { address: string; family: WalletFamily; challengeToken: string; signature: string }) {
  const now = (d.now ?? Date.now)();
  const c = unpack<ChallengeClaims>(d.secret, i.challengeToken);
  if (!c || c.t !== 'c' || c.a !== i.address || c.f !== i.family || c.exp < now) {
    throw new SpendXError('unauthorized', 'The sign-in request is invalid or has expired. Try again.', 401);
  }
  const verifier = d.verifiers[i.family];
  if (!verifier) throw new SpendXError('unsupported_wallet', 'Unsupported wallet type', 400);
  // Single use: taken before the (async) signature check so two parallel submissions cannot both succeed.
  if (!consumeNonce(d, c.n, c.exp, now)) {
    throw new SpendXError('unauthorized', 'This sign-in request was already used. Try again.', 401);
  }
  let ok = false;
  try {
    ok = await verifier({ address: i.address, message: challengeMessage({ address: c.a, family: c.f, nonce: c.n, iat: c.iat, exp: c.exp, origin: d.origin }), signature: i.signature });
  } catch {
    ok = false;
  }
  if (!ok) throw new SpendXError('unauthorized', 'The wallet signature could not be verified', 401);
  const claims: SessionClaims = { t: 's', a: c.a, f: c.f, exp: now + SESSION_TTL_MS };
  return { token: pack(d.secret, claims), expiresAt: new Date(claims.exp).toISOString(), address: c.a, family: c.f };
}

export function requireSession(d: AuthDeps, authorization: string | undefined): Session {
  const m = /^Bearer (.+)$/.exec(authorization ?? '');
  const s = m ? unpack<SessionClaims>(d.secret, m[1]) : null;
  if (!s || s.t !== 's' || s.exp < (d.now ?? Date.now)()) {
    throw new SpendXError('unauthorized', 'Sign in with your wallet to continue', 401);
  }
  return { address: s.a, family: s.f };
}

/** Phantom and other Solana wallets sign with ed25519; the signature arrives base64-encoded. Uses only node:crypto. */
export const verifySolanaSignature: SignatureVerifier = ({ address, message, signature }) => {
  const key = base58Decode(address);
  if (!key || key.length !== 32) return false;
  const sig = Buffer.from(signature, 'base64');
  if (sig.length !== 64) return false;
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key)]);
  const pub = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  return edVerify(null, Buffer.from(message, 'utf8'), pub, sig);
};

/** MetaMask personal_sign (EIP-191). Uses viem's verifyMessage. */
export const verifyEvmSignature: SignatureVerifier = async ({ address, message, signature }) => {
  const { verifyMessage } = await import('viem');
  return verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
};

// ---------------------------------------------------------------------------------------------------------------
// NEAR (NEP-413 signMessage)
// ---------------------------------------------------------------------------------------------------------------

const NEP413_TAG = 2147484061; // 2^31 + 413
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const borshString = (str: string): Buffer => {
  const b = Buffer.from(str, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};

/** The bytes a NEAR wallet signs for NEP-413: sha256(tag || borsh(message, nonce, recipient, callbackUrl = None)). The nonce is sha256(message). */
export function nep413Digest(message: string, recipient: string = NEAR_SIGN_RECIPIENT): Buffer {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const nonce = createHash('sha256').update(message, 'utf8').digest();
  const payload = Buffer.concat([borshString(message), nonce, borshString(recipient), Buffer.from([0])]);
  return createHash('sha256').update(Buffer.concat([tag, payload])).digest();
}

function nearPublicKey(s: unknown): Uint8Array | null {
  if (typeof s !== 'string') return null;
  const k = base58Decode(s.startsWith('ed25519:') ? s.slice(8) : s);
  return k && k.length === 32 ? k : null;
}

function nearSignature(s: unknown): Buffer | null {
  if (typeof s !== 'string') return null;
  if (s.startsWith('ed25519:')) {
    const b = base58Decode(s.slice(8));
    return b && b.length === 64 ? Buffer.from(b) : null;
  }
  const b = Buffer.from(s, 'base64'); // wallets return NEP-413 signatures base64-encoded
  return b.length === 64 ? b : null;
}

/**
 * NEAR sign-in. The client sends `signature` as JSON: {"publicKey": "ed25519:...", "signature": "..."}.
 * Two things are proven: the key signed the challenge (NEP-413), and that key is a full-access key of the claimed account,
 * which is read from NEAR itself (view_access_key), so nobody can sign in as an account they do not control.
 */
export function createNearSignatureVerifier(opts: { rpcUrl: string; fetchImpl?: typeof fetch }): SignatureVerifier {
  const f = opts.fetchImpl ?? fetch;
  return async ({ address, message, signature }) => {
    let parsed: { publicKey?: unknown; signature?: unknown };
    try { parsed = JSON.parse(signature); } catch { return false; }
    const key = nearPublicKey(parsed.publicKey);
    const sig = nearSignature(parsed.signature);
    if (!key || !sig) return false;
    const pub = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key)]), format: 'der', type: 'spki' });
    if (!edVerify(null, nep413Digest(message), pub, sig)) return false;

    // An implicit account (64 hex characters) IS its public key.
    if (/^[0-9a-f]{64}$/.test(address) && Buffer.from(key).toString('hex') === address) return true;

    const res = await f(opts.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'spendx', method: 'query',
        params: { request_type: 'view_access_key', finality: 'final', account_id: address, public_key: `ed25519:${typeof parsed.publicKey === 'string' ? parsed.publicKey.replace(/^ed25519:/, '') : ''}` },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return !body.error && !body.result?.error && body.result?.permission === 'FullAccess';
  };
}
