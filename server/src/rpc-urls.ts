import { arbitrum, avalanche, base, bsc, gnosis, mainnet, optimism, polygon, scroll } from 'viem/chains';

// 1Click blockchain id -> viem's own definition of the chain, which carries a default public RPC URL.
const CHAINS: Record<string, { rpcUrls: { default: { http: readonly string[] } } }> = {
  eth: mainnet, base, arb: arbitrum, op: optimism, pol: polygon, bsc, avax: avalanche, gnosis, scroll,
};

/** An env override (RPC_URL_BASE, RPC_URL_ARB, ...) wins; otherwise viem's default public RPC. Unknown chains: undefined. */
export function rpcUrlFor(blockchain: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return env[`RPC_URL_${blockchain.toUpperCase()}`] || CHAINS[blockchain]?.rpcUrls.default.http[0];
}
