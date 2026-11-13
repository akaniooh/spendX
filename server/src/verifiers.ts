import type { DestinationVerifier, VerifyOutcome } from '../../shared/src/adapters.ts';

// Independent delivery checks, straight from the destination chain's own JSON-RPC (no dependency on NEAR Intents' word).
// Conservative by design: anything not positively confirmed is never reported as verified.

type Fetch = typeof fetch;

async function rpc(url: string, method: string, params: unknown[], fetchImpl: Fetch): Promise<any> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed (HTTP ${res.status})`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC ${method} error: ${body.error.message ?? 'unknown'}`);
  return body.result;
}

// ---------------------------------------------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------------------------------------------

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // keccak("Transfer(address,address,uint256)")
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const padTopic = (addr: string) => '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();

export function createEvmVerifier(opts: { rpcUrlFor: (blockchain: string) => string | undefined; fetchImpl?: Fetch }): DestinationVerifier {
  const f = opts.fetchImpl ?? fetch;
  return {
    family: 'evm',
    async verify({ token, recipient, minAmount, txs }): Promise<VerifyOutcome> {
      const url = opts.rpcUrlFor(token.blockchain);
      const hashes = txs.map((t) => t.hash).filter((h) => EVM_HASH.test(h));
      if (!url || hashes.length === 0 || !EVM_ADDR.test(recipient)) return 'unverifiable';
      const erc20 = !!token.contractAddress && EVM_ADDR.test(token.contractAddress);
      let pending = false;

      for (const hash of hashes) {
        const receipt = await rpc(url, 'eth_getTransactionReceipt', [hash], f);
        if (!receipt) { pending = true; continue; }
        if (receipt.status !== '0x1') continue; // reverted: nothing was delivered by this transaction

        if (erc20) {
          let received = 0n;
          for (const log of receipt.logs ?? []) {
            if (String(log.address).toLowerCase() !== token.contractAddress!.toLowerCase()) continue;
            const t = log.topics ?? [];
            if (t[0] === TRANSFER_TOPIC && String(t[2]).toLowerCase() === padTopic(recipient)) received += BigInt(log.data);
          }
          if (received >= minAmount) return 'verified';
        } else {
          const tx = await rpc(url, 'eth_getTransactionByHash', [hash], f);
          if (tx && String(tx.to).toLowerCase() === recipient.toLowerCase() && BigInt(tx.value) >= minAmount) return 'verified';
        }
      }
      if (pending) return 'pending';
      // A native coin may reach the recipient through a contract (an internal transfer), which receipts do not show.
      return erc20 ? 'mismatch' : 'unverifiable';
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------------------------------------------

const SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

export function createSolanaVerifier(opts: { rpcUrl: string; fetchImpl?: Fetch }): DestinationVerifier {
  const f = opts.fetchImpl ?? fetch;
  return {
    family: 'svm',
    async verify({ token, recipient, minAmount, txs }): Promise<VerifyOutcome> {
      const sigs = txs.map((t) => t.hash).filter((h) => SOL_SIG.test(h));
      if (sigs.length === 0) return 'unverifiable';
      let pending = false;

      for (const sig of sigs) {
        const tx = await rpc(opts.rpcUrl, 'getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }], f);
        if (!tx) { pending = true; continue; }
        if (tx.meta?.err) continue; // failed on chain: nothing was delivered

        if (!token.contractAddress) {
          // native SOL: the recipient's lamport balance must have risen by at least the promised amount
          const keys: any[] = tx.transaction?.message?.accountKeys ?? [];
          const idx = keys.findIndex((k) => (typeof k === 'string' ? k : k?.pubkey) === recipient);
          if (idx >= 0) {
            const delta = BigInt(tx.meta.postBalances[idx]) - BigInt(tx.meta.preBalances[idx]);
            if (delta >= minAmount) return 'verified';
          }
        } else {
          // SPL token: the recipient owner's balance of this mint must have risen by at least the promised amount
          const sum = (list: any[] | undefined) =>
            (list ?? []).filter((b) => b.owner === recipient && b.mint === token.contractAddress).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
          if (sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances) >= minAmount) return 'verified';
        }
      }
      return pending ? 'pending' : 'mismatch';
    },
  };
}
