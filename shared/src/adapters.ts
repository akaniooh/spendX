import type { WalletFamily } from './chains.ts';
import type { Token, TxDetails } from './types.ts';

/** What the payment flow asks a wallet to do. Chain-specific details stay inside each adapter. */
export interface DepositRequest {
  token: Token;
  /** exact amount to send, base units of `token` (the quote's amountIn) */
  amount: bigint;
  depositAddress: string;
  /** some chains require a memo with the deposit address (1Click quote: depositMemo) */
  depositMemo?: string;
}

/**
 * One implementation per wallet family (evm, svm, near, later sui/aptos/ton...).
 * The payment screen, quote logic, database and status tracking never import a chain library directly.
 */
export interface WalletAdapter {
  family: WalletFamily;
  /** true if this adapter can fund a payment from the given 1Click blockchain id */
  supportsChain(blockchain: string): boolean;
  connect(): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  getAddress(): string | null;
  /** base units of `token` held by the connected account on its chain */
  getBalance(token: Token): Promise<bigint>;
  /** Ask the user's wallet to sign and send the deposit. Must never auto-approve. Returns the tx hash. */
  sendDeposit(req: DepositRequest): Promise<{ txHash: string }>;
  explorerTxUrl(blockchain: string, txHash: string): string | null;
}

/**
 * verified      the destination chain shows the recipient received at least the promised amount
 * mismatch      a delivery transaction exists but does NOT match (wrong recipient, too little, or reverted)
 * pending       the transaction is not visible yet: ask again later
 * unverifiable  this kind of delivery cannot be checked from the chain (e.g. native coin sent through a contract)
 */
export type VerifyOutcome = 'verified' | 'mismatch' | 'pending' | 'unverifiable';

/** Independent check, on the destination chain itself, that the merchant really received the funds. */
export interface DestinationVerifier {
  family: WalletFamily;
  verify(args: {
    token: Token;
    recipient: string;
    /** the merchant must have received at least this many base units */
    minAmount: bigint;
    txs: TxDetails[];
  }): Promise<VerifyOutcome>;
}
