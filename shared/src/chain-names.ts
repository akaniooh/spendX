/** Display names by 1Click blockchain id. Anything not listed falls back to the upper-cased id. */
export const CHAIN_NAMES: Record<string, string> = {
  eth: 'Ethereum', base: 'Base', arb: 'Arbitrum', op: 'Optimism', pol: 'Polygon', bsc: 'BNB Chain',
  avax: 'Avalanche', gnosis: 'Gnosis', scroll: 'Scroll', sol: 'Solana', near: 'NEAR', btc: 'Bitcoin',
  ton: 'TON', sui: 'Sui', aptos: 'Aptos', tron: 'TRON', doge: 'Dogecoin', ltc: 'Litecoin', xrp: 'XRP',
  zec: 'Zcash', stellar: 'Stellar', starknet: 'Starknet', cardano: 'Cardano', bera: 'Berachain',
  monad: 'Monad', plasma: 'Plasma', xlayer: 'X Layer',
};
export const chainName = (blockchain: string): string => CHAIN_NAMES[blockchain] ?? blockchain.toUpperCase();
