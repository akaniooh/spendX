import type { Token } from './types.ts';

export type TokenLookup =
  | { ok: true; token: Token }
  | { ok: false; error: string; candidates?: Token[] };

// Asset id schemes seen in the live catalog: nep141 (NEAR-native and omft-bridged), nep245 (omni multi-token), 1cs_v1.
const ASSET_ID_PREFIXES = ['nep141:', 'nep245:', '1cs_v1:'];

/** Spec is either a full 1Click assetId ("nep141:...", "1cs_v1:...") or "chain:SYMBOL" such as "sol:BONK". */
export function resolveToken(tokens: Token[], spec: string): TokenLookup {
  if (ASSET_ID_PREFIXES.some((p) => spec.startsWith(p))) {
    const t = tokens.find((x) => x.assetId === spec);
    return t ? { ok: true, token: t } : { ok: false, error: `No token with assetId ${spec}` };
  }
  const i = spec.indexOf(':');
  if (i < 1) return { ok: false, error: `Token spec "${spec}" must look like chain:SYMBOL or a full assetId` };
  const chain = spec.slice(0, i).toLowerCase();
  const symbol = spec.slice(i + 1).toLowerCase();
  const matches = tokens.filter((t) => t.blockchain.toLowerCase() === chain && t.symbol.toLowerCase() === symbol);
  if (matches.length === 1) return { ok: true, token: matches[0] };
  if (matches.length === 0) return { ok: false, error: `No ${spec} in the live catalog` };
  return { ok: false, error: `${spec} is ambiguous; pass a full assetId`, candidates: matches };
}

export function parsePairSpec(spec: string): { from: string; to: string } | null {
  const i = spec.indexOf('>');
  if (i < 1 || i === spec.length - 1) return null;
  return { from: spec.slice(0, i), to: spec.slice(i + 1) };
}
