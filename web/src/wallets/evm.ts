import { createPublicClient, createWalletClient, custom, erc20Abi, http } from 'viem';
import type { WalletAdapter, DepositRequest } from '../../../shared/src/adapters.ts';
import { classifyDeposit } from '../../../shared/src/deposit-kind.ts';
import type { Token } from '../../../shared/src/types.ts';
import { evmChainFor, txUrl } from '../lib/chains.ts';

// EVM wallets via EIP-6963 discovery (MetaMask, Coinbase Wallet, Rabby, ...) and plain viem.
// Deliberately no wagmi: its hooks changed incompatibly between v2 and v3, and we need very little of it.

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}
export interface DiscoveredEvmWallet {
  id: string; // EIP-6963 uuid
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

export function discoverEvmWallets(onChange: (wallets: DiscoveredEvmWallet[]) => void): () => void {
  const found = new Map<string, DiscoveredEvmWallet>();
  const handler = (ev: Event) => {
    const d = (ev as CustomEvent).detail;
    if (!d?.info?.uuid || !d.provider) return;
    found.set(d.info.uuid, { id: d.info.uuid, name: d.info.name ?? 'EVM wallet', icon: d.info.icon, provider: d.provider });
    onChange([...found.values()]);
  };
  window.addEventListener('eip6963:announceProvider', handler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  return () => window.removeEventListener('eip6963:announceProvider', handler);
}

export class EvmWallet implements WalletAdapter {
  family = 'evm' as const;
  private info: DiscoveredEvmWallet;
  private address: `0x${string}` | null = null;

  constructor(info: DiscoveredEvmWallet) {
    this.info = info;
  }
  get name() { return this.info.name; }

  private wc() {
    return createWalletClient({ transport: custom(this.info.provider as any) });
  }

  supportsChain(blockchain: string) { return !!evmChainFor(blockchain); }

  async connect() {
    const [addr] = await this.wc().requestAddresses();
    if (!addr) throw new Error('The wallet did not return an account');
    this.address = addr;
    return { address: addr as string };
  }
  /** Re-attach to an account this site was already approved for (eth_accounts: never opens a wallet popup). */
  async restore(): Promise<{ address: string } | null> {
    try {
      const [addr] = await this.wc().getAddresses();
      if (!addr) return null;
      this.address = addr;
      return { address: addr as string };
    } catch { return null; }
  }
  async disconnect() { this.address = null; } // EIP-1193 has no disconnect; we just forget the account
  getAddress() { return this.address; }

  async signMessage(message: string): Promise<string> {
    if (!this.address) throw new Error('Wallet not connected');
    return this.wc().signMessage({ account: this.address, message });
  }

  async getBalance(token: Token): Promise<bigint> {
    const chain = evmChainFor(token.blockchain);
    if (!chain || !this.address) throw new Error('Cannot read balance for this chain');
    const pc = createPublicClient({ chain, transport: http() });
    const kind = classifyDeposit(token, chain.nativeCurrency);
    if (kind.kind === 'evm-native') return pc.getBalance({ address: this.address });
    if (kind.kind === 'evm-erc20') return pc.readContract({ address: kind.contract, abi: erc20Abi, functionName: 'balanceOf', args: [this.address] });
    throw new Error(kind.kind === 'unsupported' ? kind.reason : 'Unsupported token');
  }

  async sendDeposit(req: DepositRequest): Promise<{ txHash: string }> {
    if (!this.address) throw new Error('Wallet not connected');
    if (req.depositMemo) throw new Error('This deposit requires a memo, which EVM transfers cannot carry');
    const chain = evmChainFor(req.token.blockchain);
    if (!chain) throw new Error(`${req.token.blockchain} is not configured for EVM payments yet`);
    const kind = classifyDeposit(req.token, chain.nativeCurrency);
    if (kind.kind !== 'evm-native' && kind.kind !== 'evm-erc20') {
      throw new Error(kind.kind === 'unsupported' ? kind.reason : 'Unsupported token');
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(req.depositAddress)) throw new Error('Deposit address is not a valid EVM address');
    const to = req.depositAddress as `0x${string}`;

    const wc = this.wc();
    await wc.switchChain({ id: chain.id }); // the wallet asks the user to approve the network switch

    if (kind.kind === 'evm-native') {
      const hash = await wc.sendTransaction({ account: this.address, chain, to, value: req.amount });
      return { txHash: hash };
    }
    // ERC-20: confirm the contract's on-chain decimals match the catalog before moving any funds
    const pc = createPublicClient({ chain, transport: http() });
    const decimals = await pc.readContract({ address: kind.contract, abi: erc20Abi, functionName: 'decimals' });
    if (Number(decimals) !== req.token.decimals) throw new Error('Token decimals on-chain do not match the catalog; refusing to send');
    const hash = await wc.writeContract({ account: this.address, chain, address: kind.contract, abi: erc20Abi, functionName: 'transfer', args: [to, req.amount] });
    return { txHash: hash };
  }

  explorerTxUrl(blockchain: string, txHash: string) { return txUrl(blockchain, txHash); }
}
