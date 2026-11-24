// Read-only check of the EVM chains in shared/src/evm-chains.ts against the LIVE networks. It sends `eth_chainId` and
// `eth_blockNumber` to each public RPC and compares the answer with the id in our table. Nothing is signed or sent.
//
// Why: if our chain id for a network were wrong, a wallet could be switched to a different network than the one the
// deposit address is watched on. This proves each id against the chain itself before any real payment.
//
// Usage: npm run chains:check            (optionally: npm run chains:check -- monad bera)
import { EXTRA_EVM_CHAINS } from '../shared/src/evm-chains.ts';

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const keys = Object.keys(EXTRA_EVM_CHAINS).filter((k) => only.length === 0 || only.includes(k));
if (keys.length === 0) { console.error(`No such chain. Known: ${Object.keys(EXTRA_EVM_CHAINS).join(', ')}`); process.exit(1); }

async function rpc(url: string, method: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
  });
  const j = (await res.json()) as { result?: string; error?: { message?: string } };
  if (j.error || typeof j.result !== 'string') throw new Error(j.error?.message ?? `unexpected reply (HTTP ${res.status})`);
  return j.result;
}

let bad = 0;
for (const key of keys) {
  const c = EXTRA_EVM_CHAINS[key];
  console.log(`${key}  (${c.name}, expected chain id ${c.id})`);
  for (const url of c.rpc) {
    try {
      const t0 = Date.now();
      const id = parseInt(await rpc(url, 'eth_chainId'), 16);
      const block = parseInt(await rpc(url, 'eth_blockNumber'), 16);
      const ms = Date.now() - t0;
      if (id === c.id) console.log(`  OK        ${url}  chain id ${id}, block ${block}, ${ms} ms`);
      else { bad++; console.log(`  MISMATCH  ${url}  answers chain id ${id}, our table says ${c.id}. DO NOT PAY ON THIS CHAIN until this is resolved.`); }
    } catch (e) {
      console.log(`  UNREACHABLE  ${url}  ${(e as Error).message}`);
    }
  }
}
console.log(bad ? `\n${bad} MISMATCH(ES): fix shared/src/evm-chains.ts before using these chains.` : '\nNo chain id mismatches. (UNREACHABLE only means the public RPC did not answer from here.)');
process.exit(bad ? 2 : 0);
