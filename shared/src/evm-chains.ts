// EVM chains SpendX pays from, other than the nine that viem already defines (see web/src/lib/chains.ts).
// Every value was checked against the chain's own documentation and at least one more independent source on 2026-11-24.
//
// CAUTION: a wrong `id` here can send a payment on the WRONG network, where the funds may be lost. The tests pin
// each id; change one only after checking the chain's official docs.
export interface ExtraEvmChain {
  id: number;
  name: string;
  /** must match the symbol and decimals 1Click lists for the native coin, or the native coin stays blocked (fails safe) */
  native: { name: string; symbol: string; decimals: number };
  /** public RPC endpoints, preferred first. Rate limited: set RPC_URL_<CHAIN> on the server for production use. */
  rpc: string[];
  /** block explorer root, without a trailing slash; transactions live at <explorer>/tx/<hash> */
  explorer: string;
}

export const EXTRA_EVM_CHAINS: Record<string, ExtraEvmChain> = {
  bera: { id: 80094, name: 'Berachain', native: { name: 'Berachain', symbol: 'BERA', decimals: 18 }, rpc: ['https://rpc.berachain.com'], explorer: 'https://berascan.com' },
  xlayer: { id: 196, name: 'X Layer', native: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpc: ['https://rpc.xlayer.tech', 'https://xlayerrpc.okx.com'], explorer: 'https://www.oklink.com/xlayer' },
  monad: { id: 143, name: 'Monad', native: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpc: ['https://rpc.monad.xyz', 'https://rpc1.monad.xyz'], explorer: 'https://monadvision.com' },
  // ADI: the sources give the gas token (ADI) but not its decimals; 18 is the EVM norm. A mismatch with 1Click's catalog blocks the native coin rather than risking it.
  adi: { id: 36900, name: 'ADI Chain', native: { name: 'ADI', symbol: 'ADI', decimals: 18 }, rpc: ['https://rpc.adifoundation.ai'], explorer: 'https://explorer.adifoundation.ai' },
  plasma: { id: 9745, name: 'Plasma', native: { name: 'Plasma', symbol: 'XPL', decimals: 18 }, rpc: ['https://rpc.plasma.to'], explorer: 'https://plasmascan.to' },
  // Robinhood Chain: Arbitrum Orbit L2, mainnet since 2026-07-01, chain id 4663, gas token ETH.
  hood: { id: 4663, name: 'Robinhood Chain', native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpc: ['https://rpc.mainnet.chain.robinhood.com'], explorer: 'https://robinhoodchain.blockscout.com' },
  aurora: { id: 1313161554, name: 'Aurora', native: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpc: ['https://mainnet.aurora.dev'], explorer: 'https://explorer.aurora.dev' },
};

/** The nine chains whose full definition (id, RPC, explorer) comes from viem. */
export const VIEM_EVM_CHAINS = ['eth', 'base', 'arb', 'op', 'pol', 'bsc', 'avax', 'gnosis', 'scroll'] as const;
