import { defineChain } from 'viem';
import { arbitrum, avalanche, base, bsc, gnosis, mainnet, optimism, polygon, scroll } from 'viem/chains';
import type { Chain } from 'viem';
import { EXTRA_EVM_CHAINS } from '../../../shared/src/evm-chains.ts';

// 1Click blockchain id -> viem chain definition. Only chains listed here can fund a payment from an EVM wallet.
// Other EVM chains in the catalog still work as DESTINATIONS (receiving only needs an address).
// The other six come from shared/src/evm-chains.ts (verified against each chain's docs), so the wallet can add the
// network when it does not know it.
const EXTRA: Record<string, Chain> = Object.fromEntries(Object.entries(EXTRA_EVM_CHAINS).map(([key, c]) => [key, defineChain({
  id: c.id,
  name: c.name,
  nativeCurrency: c.native,
  rpcUrls: { default: { http: c.rpc } },
  blockExplorers: { default: { name: `${c.name} explorer`, url: c.explorer } },
})]));
const EVM_CHAINS: Record<string, Chain> = { eth: mainnet, base, arb: arbitrum, op: optimism, pol: polygon, bsc, avax: avalanche, gnosis, scroll, ...EXTRA };

export const evmChainFor = (blockchain: string): Chain | undefined => EVM_CHAINS[blockchain];

export { txUrl } from './explorer.ts';
