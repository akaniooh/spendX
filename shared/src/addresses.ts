import { familyOf } from './chains.ts';
import type { WalletFamily } from './chains.ts';

export type AddressCheck =
  | { status: 'valid'; family: WalletFamily }
  | { status: 'invalid'; family: WalletFamily; reason: string }
  // No local validator for this chain family. The caller must warn the user and rely on the 1Click quote.
  | { status: 'unchecked'; family: WalletFamily };

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(s: string): Uint8Array | null {
  if (!s) return null;
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c === '1') bytes.unshift(0);
    else break;
  }
  return Uint8Array.from(bytes);
}

const NEAR_NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function validateAddress(blockchain: string, address: string): AddressCheck {
  const family = familyOf(blockchain);
  const a = address.trim();
  if (a !== address) return { status: 'invalid', family, reason: 'Address has leading or trailing spaces' };

  switch (family) {
    case 'evm':
      return /^0x[0-9a-fA-F]{40}$/.test(a)
        ? { status: 'valid', family }
        : { status: 'invalid', family, reason: 'Expected a 0x address with 40 hex characters' };
    case 'svm': {
      const bytes = base58Decode(a);
      return bytes && bytes.length === 32
        ? { status: 'valid', family }
        : { status: 'invalid', family, reason: 'Expected a base58 Solana address (32 bytes)' };
    }
    case 'near': {
      if (/^[0-9a-f]{64}$/.test(a)) return { status: 'valid', family };
      return a.length >= 2 && a.length <= 64 && NEAR_NAMED.test(a)
        ? { status: 'valid', family }
        : { status: 'invalid', family, reason: 'Expected a NEAR account like name.near or a 64-char implicit account' };
    }
    default:
      return { status: 'unchecked', family };
  }
}

/** Case-insensitive for EVM (hex case is only a checksum), exact for everything else. */
export function sameAddress(blockchain: string, a: string, b: string): boolean {
  return familyOf(blockchain) === 'evm' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
