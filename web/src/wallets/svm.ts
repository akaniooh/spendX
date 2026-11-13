import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { WalletAdapter, DepositRequest } from '../../../shared/src/adapters.ts';
import { classifyDeposit } from '../../../shared/src/deposit-kind.ts';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, CREATE_ATA_IDEMPOTENT_DATA, TOKEN_ACCOUNT_SIZE, TOKEN_PROGRAM_ID,
  encodeTransferChecked, pickSourceAccount, solRequiredLamports, tokenProgramKind, type TokenAccountInfo,
} from '../../../shared/src/spl.ts';
import type { Token } from '../../../shared/src/types.ts';
import { txUrl } from '../lib/chains.ts';

// Phantom via its injected provider (window.phantom.solana). Other Solana wallets can be added as more adapters.

interface PhantomProvider {
  isPhantom?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: 'utf8' | 'hex'): Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
}
declare global {
  interface Window { phantom?: { solana?: PhantomProvider } }
}

export function getPhantom(): PhantomProvider | null {
  const p = typeof window !== 'undefined' ? window.phantom?.solana : undefined;
  return p?.isPhantom ? p : null;
}

// Default: this app's own server (/api/solana-rpc), which holds the real RPC key. VITE_SOLANA_RPC_URL overrides it with a
// key-free URL (the build rejects keyed ones). Without a window (tests) it falls back to the public endpoint.
const RPC_URL: string = (import.meta as any).env?.VITE_SOLANA_RPC_URL
  || (typeof window !== 'undefined' ? `${window.location.origin}/api/solana-rpc` : 'https://api.mainnet-beta.solana.com');
const FEE_BUFFER_LAMPORTS = 10_000n; // generous cover for the base transaction fee

const TOKEN_PK = new PublicKey(TOKEN_PROGRAM_ID);
const ATA_PK = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
// web3.js types instruction data as Buffer but only needs bytes; the browser has no global Buffer to build one with.
const asData = (b: Uint8Array) => b as unknown as Buffer;
/** The standard (associated) token account of `owner` for `mint`. */
const ataOf = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PK.toBytes(), mint.toBytes()], ATA_PK)[0];

/** Only mints owned by the classic token program are sent: Token-2022 mints can carry transfer fees or hooks. */
async function assertClassicMint(conn: Connection, mint: PublicKey, symbol: string): Promise<void> {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error(`${symbol} was not found on Solana`);
  const k = tokenProgramKind(info.owner.toBase58());
  if (k === 'token-2022') throw new Error(`${symbol} is a Token-2022 token, which SpendX cannot send yet`);
  if (k !== 'token') throw new Error(`${symbol} is not a standard Solana token`);
}

async function tokenAccountsOf(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<TokenAccountInfo[]> {
  const res = await conn.getParsedTokenAccountsByOwner(owner, { mint });
  return res.value.flatMap(({ pubkey, account }) => {
    const info = (account.data as { parsed?: { info?: any } })?.parsed?.info;
    const ta = info?.tokenAmount;
    if (!ta || typeof ta.amount !== 'string') return [];
    return [{ address: pubkey.toBase58(), amount: BigInt(ta.amount), decimals: Number(ta.decimals), frozen: info.state === 'frozen' }];
  });
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export class SolanaWallet implements WalletAdapter {
  family = 'svm' as const;
  private provider: PhantomProvider;
  private address: string | null = null;

  constructor(provider: PhantomProvider) {
    this.provider = provider;
  }
  get name() { return 'Phantom'; }

  supportsChain(blockchain: string) { return blockchain === 'sol'; }

  async connect() {
    const { publicKey } = await this.provider.connect();
    this.address = publicKey.toBase58();
    return { address: this.address };
  }
  async disconnect() {
    try { await this.provider.disconnect(); } catch { /* ignore */ }
    this.address = null;
  }
  getAddress() { return this.address; }

  /** Returns the ed25519 signature, base64-encoded (what the SpendX server verifies). */
  async signMessage(message: string): Promise<string> {
    const res = await this.provider.signMessage(new TextEncoder().encode(message), 'utf8');
    const sig = res instanceof Uint8Array ? res : res.signature;
    return toBase64(sig);
  }

  async getBalance(token: Token): Promise<bigint> {
    if (!this.address) throw new Error('Wallet not connected');
    const kind = classifyDeposit(token);
    const conn = new Connection(RPC_URL, 'confirmed');
    const owner = new PublicKey(this.address);
    if (kind.kind === 'svm-native') return BigInt(await conn.getBalance(owner));
    if (kind.kind === 'svm-spl') {
      const mint = new PublicKey(kind.mint);
      await assertClassicMint(conn, mint, token.symbol);
      return (await tokenAccountsOf(conn, owner, mint)).filter((a) => !a.frozen).reduce((sum, a) => sum + a.amount, 0n);
    }
    throw new Error(kind.kind === 'unsupported' ? kind.reason : 'Unsupported token');
  }

  async sendDeposit(req: DepositRequest): Promise<{ txHash: string }> {
    if (!this.address) throw new Error('Wallet not connected');
    if (req.depositMemo) throw new Error('This deposit requires a memo, which is not supported for Solana transfers here');
    const kind = classifyDeposit(req.token);
    if (kind.kind === 'svm-spl') return this.sendToken(req, kind.mint);
    if (kind.kind !== 'svm-native') throw new Error(kind.kind === 'unsupported' ? kind.reason : 'Unsupported token');

    const conn = new Connection(RPC_URL, 'confirmed');
    const from = new PublicKey(this.address);
    const to = new PublicKey(req.depositAddress); // throws on an invalid address
    const balance = BigInt(await conn.getBalance(from));
    if (balance < req.amount + FEE_BUFFER_LAMPORTS) throw new Error('Insufficient SOL balance to cover the payment and network fee');

    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: req.amount }));
    tx.feePayer = from;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    const { signature } = await this.provider.signAndSendTransaction(tx);
    return { txHash: signature };
  }

  /** Pay with a Solana token: create the deposit address's token account if it is missing, then one TransferChecked. */
  private async sendToken(req: DepositRequest, mintAddress: string): Promise<{ txHash: string }> {
    const conn = new Connection(RPC_URL, 'confirmed');
    const from = new PublicKey(this.address!);
    const to = new PublicKey(req.depositAddress); // throws on an invalid address
    const mint = new PublicKey(mintAddress);
    const { symbol, decimals } = req.token;

    await assertClassicMint(conn, mint, symbol);
    const source = pickSourceAccount(await tokenAccountsOf(conn, from, mint), req.amount, decimals, symbol, ataOf(from, mint).toBase58());

    const destAta = ataOf(to, mint);
    const destInfo = await conn.getAccountInfo(destAta);
    if (destInfo && !destInfo.owner.equals(TOKEN_PK)) throw new Error('The deposit address has an unexpected account for this token, so SpendX will not send to it');
    const destMissing = !destInfo;
    const rent = destMissing ? BigInt(await conn.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE)) : 0n;
    const sol = BigInt(await conn.getBalance(from));
    if (sol < solRequiredLamports({ feeBuffer: FEE_BUFFER_LAMPORTS, destAccountMissing: destMissing, rentLamports: rent })) {
      throw new Error(destMissing
        ? 'Not enough SOL: about 0.002 SOL is needed to open the recipient\'s token account, plus the network fee'
        : 'Not enough SOL to pay the network fee');
    }

    const tx = new Transaction();
    if (destMissing) {
      // CreateIdempotent: safe even if someone creates the account first.
      tx.add(new TransactionInstruction({
        programId: ATA_PK,
        keys: [
          { pubkey: from, isSigner: true, isWritable: true },
          { pubkey: destAta, isSigner: false, isWritable: true },
          { pubkey: to, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PK, isSigner: false, isWritable: false },
        ],
        data: asData(CREATE_ATA_IDEMPOTENT_DATA),
      }));
    }
    tx.add(new TransactionInstruction({
      programId: TOKEN_PK,
      keys: [
        { pubkey: new PublicKey(source.address), isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: destAta, isSigner: false, isWritable: true },
        { pubkey: from, isSigner: true, isWritable: false },
      ],
      data: asData(encodeTransferChecked(req.amount, decimals)),
    }));
    tx.feePayer = from;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    const { signature } = await this.provider.signAndSendTransaction(tx);
    return { txHash: signature };
  }

  explorerTxUrl(blockchain: string, txHash: string) { return txUrl(blockchain, txHash); }
}
