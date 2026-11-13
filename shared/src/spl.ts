// Pure helpers for paying with a Solana token (SPL). No web3.js here so every rule can be tested without a chain.
// The wallet adapter (web/src/wallets/svm.ts) does the RPC calls and builds the transaction from these pieces.

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/** Size in bytes of a standard token account: what the rent for a new one is based on. */
export const TOKEN_ACCOUNT_SIZE = 165;

/** Token instruction 12 = TransferChecked. The program also checks the mint's decimals, so a wrong amount scale fails instead of moving funds. */
const TRANSFER_CHECKED = 12;
/** Associated Token Account program instruction 1 = CreateIdempotent: creates the account, or does nothing if it already exists. */
export const CREATE_ATA_IDEMPOTENT_DATA: Uint8Array = Uint8Array.of(1);

const U64_MAX = (1n << 64n) - 1n;

export function encodeTransferChecked(amount: bigint, decimals: number): Uint8Array {
  if (amount <= 0n || amount > U64_MAX) throw new Error('Amount is out of range for a token transfer');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Token decimals are out of range');
  const out = new Uint8Array(10);
  out[0] = TRANSFER_CHECKED;
  new DataView(out.buffer).setBigUint64(1, amount, true); // little-endian u64
  out[9] = decimals;
  return out;
}

/** Which token program owns a mint. Only the classic program is supported: Token-2022 mints can carry fees or hooks that change what arrives. */
export function tokenProgramKind(ownerProgram: string | null | undefined): 'token' | 'token-2022' | 'other' {
  if (ownerProgram === TOKEN_PROGRAM_ID) return 'token';
  if (ownerProgram === TOKEN_2022_PROGRAM_ID) return 'token-2022';
  return 'other';
}

export interface TokenAccountInfo {
  address: string;
  amount: bigint;
  decimals: number;
  frozen: boolean;
}

/**
 * Choose which of the wallet's token accounts to send from. A transfer comes from ONE account, so one account must
 * hold the whole amount. Prefers the wallet's standard (associated) account, then the one with the most tokens.
 */
export function pickSourceAccount(accounts: TokenAccountInfo[], needed: bigint, tokenDecimals: number, symbol: string, preferred?: string): TokenAccountInfo {
  const wrongScale = accounts.find((a) => a.decimals !== tokenDecimals);
  if (wrongScale) throw new Error(`The token's decimals on Solana (${wrongScale.decimals}) do not match the listing (${tokenDecimals}), so SpendX will not send it`);
  const usable = accounts.filter((a) => !a.frozen);
  if (accounts.length === 0) throw new Error(`Your wallet has no ${symbol} on Solana`);
  if (usable.length === 0) throw new Error(`Your ${symbol} token account is frozen, so it cannot be sent`);
  const enough = usable.filter((a) => a.amount >= needed);
  if (enough.length === 0) {
    const total = usable.reduce((s, a) => s + a.amount, 0n);
    throw new Error(total >= needed
      ? `Your ${symbol} is split across several token accounts, and none holds enough. Consolidate it into one account in your wallet first`
      : `Insufficient ${symbol} balance`);
  }
  const pref = preferred ? enough.find((a) => a.address === preferred) : undefined;
  if (pref) return pref;
  return enough.reduce((best, a) => (a.amount > best.amount ? a : best));
}

/**
 * SOL the sender must keep for the transaction: the network fee, plus rent for the recipient's token account when it
 * does not exist yet (the sender pays it, about 0.002 SOL, and it stays with the deposit address).
 */
export function solRequiredLamports(opts: { feeBuffer: bigint; destAccountMissing: boolean; rentLamports: bigint }): bigint {
  return opts.feeBuffer + (opts.destAccountMissing ? opts.rentLamports : 0n);
}
