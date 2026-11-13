// Wallet families SpendX can build adapters for. The chain list itself is NOT hardcoded:
// it comes from the live 1Click token catalog. This only classifies a 1Click `blockchain`
// id by signing/address family. EVM and Solana lists follow docs.near-intents.org/resources/chain-support.
export type WalletFamily = 'evm' | 'svm' | 'near' | 'other';

const EVM_CHAINS = new Set([
  'eth', 'base', 'arb', 'op', 'pol', 'bsc', 'avax', 'gnosis', 'scroll',
  'bera', 'xlayer', 'monad', 'adi', 'plasma', 'aurora',
]);

export function familyOf(blockchain: string): WalletFamily {
  if (EVM_CHAINS.has(blockchain)) return 'evm';
  if (blockchain === 'sol') return 'svm';
  if (blockchain === 'near') return 'near';
  return 'other';
}
