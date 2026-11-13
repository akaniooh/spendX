import { arbitrum, avalanche, base, bsc, gnosis, mainnet, optimism, polygon, scroll } from 'viem/chains';
import type { Chain } from 'viem';

// 1Click blockchain id -> viem chain definition. Only chains listed here can fund a payment from an EVM wallet.
// Other EVM chains in the catalog still work as DESTINATIONS (receiving only needs an address).
const EVM_CHAINS: Record<string, Chain> = { eth: mainnet, base, arb: arbitrum, op: optimism, pol: polygon, bsc, avax: avalanche, gnosis, scroll };

export const evmChainFor = (blockchain: string): Chain | undefined => EVM_CHAINS[blockchain];

export { txUrl } from './explorer.ts';
