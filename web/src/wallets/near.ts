import type { DepositRequest, WalletAdapter } from '../../../shared/src/adapters.ts';
import { validateAddress } from '../../../shared/src/addresses.ts';
import { classifyDeposit } from '../../../shared/src/deposit-kind.ts';
import { planNearDeposit } from '../../../shared/src/near-deposit.ts';
import { NEAR_SIGN_RECIPIENT } from '../../../shared/src/near-sign.ts';
import type { Token } from '../../../shared/src/types.ts';
import { txUrl } from '../lib/explorer.ts';
import { createNearRpc } from './near-rpc.ts';
import type { NearRpc } from './near-rpc.ts';

/** The slice of a NEAR Connect wallet we use (documented: getAddress, signAndSendTransaction). */
export interface NearWalletHandle {
  signAndSendTransaction(args: { receiverId: string; actions: unknown[] }): Promise<any>;
  /** NEP-413 message signing (not every wallet offers it) */
  signMessage?(args: { message: string; recipient: string; nonce: Uint8Array }): Promise<any>;
}

const toBase64 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };

// Network fees are small (a few thousandths of a NEAR); keep a safe margin so a payment never fails for lack of gas.
const FEE_BUFFER_YOCTO = 10n ** 22n; // 0.01 NEAR

/** Pays from a NEAR account with NEP-141 tokens (ft_transfer with 1 yoctoNEAR). The user approves in their wallet. */
export class NearWallet implements WalletAdapter {
  family = 'near' as const;
  name: string;
  private handle: NearWalletHandle;
  private address: string;
  private onDisconnect: () => Promise<void>;
  private rpc: NearRpc;

  constructor(handle: NearWalletHandle, address: string, onDisconnect: () => Promise<void>, rpc: NearRpc = createNearRpc(), name = 'NEAR wallet') {
    this.handle = handle;
    this.address = address;
    this.onDisconnect = onDisconnect;
    this.rpc = rpc;
    this.name = name;
  }

  supportsChain(blockchain: string) { return blockchain === 'near'; }
  async connect() { return { address: this.address }; } // NEAR Connect has already connected the wallet
  async disconnect() { await this.onDisconnect(); }
  getAddress() { return this.address; }

  /**
   * Signs the sign-in challenge with NEP-413 (free, no transaction). The nonce is sha256(message), which the server recomputes.
   * Returns JSON {publicKey, signature}: the server checks the signature AND that this key belongs to the account.
   */
  async signMessage(message: string): Promise<string> {
    if (typeof this.handle.signMessage !== 'function') throw new Error('This NEAR wallet cannot sign messages, so its activity cannot sync across devices.');
    const nonce = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)));
    const r = await this.handle.signMessage({ message, recipient: NEAR_SIGN_RECIPIENT, nonce });
    if (!r?.publicKey || !r?.signature) throw new Error('The NEAR wallet did not return a signature');
    if (r.accountId && r.accountId !== this.address) throw new Error('The NEAR wallet signed with a different account');
    const signature = typeof r.signature === 'string' ? r.signature : toBase64(Uint8Array.from(r.signature));
    return JSON.stringify({ publicKey: String(r.publicKey), signature });
  }

  async getBalance(token: Token): Promise<bigint> {
    const kind = classifyDeposit(token);
    if (kind.kind !== 'near-nep141') throw new Error(kind.kind === 'unsupported' ? kind.reason : 'Unsupported token');
    return this.rpc.ftBalanceOf(kind.contract, this.address);
  }

  async sendDeposit(req: DepositRequest): Promise<{ txHash: string }> {
    if (req.depositMemo) throw new Error('This deposit requires a memo, which NEAR token transfers here do not support');
    const kind = classifyDeposit(req.token);
    if (kind.kind !== 'near-nep141') throw new Error(kind.kind === 'unsupported' ? kind.reason : 'Unsupported token');
    if (validateAddress('near', req.depositAddress).status !== 'valid') throw new Error('Deposit address is not a valid NEAR account');

    // The receiver must be registered with the token contract (NEP-145), otherwise ft_transfer fails.
    const registered = await this.rpc.isRegistered(kind.contract, req.depositAddress);
    const storageMin = registered ? undefined : await this.rpc.storageMin(kind.contract);
    const nearBalance = await this.rpc.accountBalance(this.address);
    const needed = BigInt(storageMin ?? '0') + FEE_BUFFER_YOCTO;
    if (nearBalance < needed) {
      throw new Error('Not enough NEAR in your account to cover network fees' + (storageMin ? ' and the one-time storage registration for this payment' : '') + '.');
    }

    const plan = planNearDeposit({ token: req.token, amount: req.amount, depositAddress: req.depositAddress, receiverRegistered: registered, storageMinYocto: storageMin });
    const result = await this.handle.signAndSendTransaction({ receiverId: plan.receiverId, actions: plan.actions });
    // Docs: result.transaction.hash. If a wallet omits it the transfer was still sent; tracking continues by deposit address.
    return { txHash: String(result?.transaction?.hash ?? result?.transaction_outcome?.id ?? '') };
  }

  explorerTxUrl(blockchain: string, txHash: string) { return txUrl(blockchain, txHash); }
}
