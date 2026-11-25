// Where the browser reads EVM balances and token details from.
//
// viem's built-in address for each network is one shared public endpoint (Polygon's is polygon.drpc.org). When that
// endpoint is down, rate-limited, or blocked on the person's network, every Portfolio row on that network fails, and
// viem retries each one several times, which floods the console. So reads try the built-in endpoint first and
// then a second public endpoint, and give up on each quickly instead of retrying.
import { fallback, http, type Transport } from 'viem';

const SECOND_ENDPOINT: Record<string, string> = {
  eth: 'https://ethereum-rpc.publicnode.com',
  base: 'https://base-rpc.publicnode.com',
  arb: 'https://arbitrum-one-rpc.publicnode.com',
  op: 'https://optimism-rpc.publicnode.com',
  pol: 'https://polygon-bor-rpc.publicnode.com',
  bsc: 'https://bsc-rpc.publicnode.com',
  avax: 'https://avalanche-c-chain-rpc.publicnode.com',
  gnosis: 'https://gnosis-rpc.publicnode.com',
  scroll: 'https://scroll-rpc.publicnode.com',
};

/** For READS only. Sending money still goes through the person's own wallet. */
export function readTransport(blockchain: string): Transport {
  const second = SECOND_ENDPOINT[blockchain];
  return second
    ? fallback([http(undefined, { retryCount: 1, timeout: 8_000 }), http(second, { retryCount: 1, timeout: 8_000 })])
    : http(undefined, { retryCount: 1, timeout: 8_000 });
}
