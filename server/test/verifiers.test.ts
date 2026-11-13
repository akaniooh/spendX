import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEvmVerifier, createSolanaVerifier } from '../src/verifiers.ts';
import { PaymentService } from '../src/service.ts';
import { MemoryRepository } from '../src/repo-memory.ts';
import { OneClickError } from '../src/oneclick.ts';
import type { Token, QuoteRequestBody, QuoteResponse, StatusResponse } from '../../shared/src/types.ts';
import type { DestinationVerifier } from '../../shared/src/adapters.ts';

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const RECIPIENT = '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4';
const OTHER = '0x1111111111111111111111111111111111111111';
const HASH = '0x' + 'ab'.repeat(32);
const pad = (a: string) => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();
const hex = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const usdc: Token = { assetId: 'nep141:usdc', decimals: 6, blockchain: 'base', symbol: 'USDC', contractAddress: USDC_BASE };
const eth: Token = { assetId: 'nep141:eth', decimals: 18, blockchain: 'base', symbol: 'ETH' };

function chain(handlers: Record<string, (params: any[]) => unknown>): typeof fetch {
  return (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    const h = handlers[b.method];
    if (!h) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'no handler' } }));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: h(b.params) }));
  }) as unknown as typeof fetch;
}
const transferLog = (to: string, amount: bigint, address = USDC_BASE) => ({ address, topics: [TRANSFER, pad(OTHER), pad(to)], data: hex(amount) });
const evm = (receipt: unknown, tx?: unknown) => createEvmVerifier({ rpcUrlFor: () => 'http://rpc', fetchImpl: chain({ eth_getTransactionReceipt: () => receipt, eth_getTransactionByHash: () => tx }) });
const args = (token: Token, min: bigint, hash = HASH, recipient = RECIPIENT) => ({ token, recipient, minAmount: min, txs: [{ hash, explorerUrl: 'u' }] });

test('EVM ERC-20: verified only when the recipient really received at least the promised amount of the right token', async () => {
  assert.equal(await evm({ status: '0x1', logs: [transferLog(RECIPIENT, 1_000_000n)] }).verify(args(usdc, 1_000_000n)), 'verified');
  assert.equal(await evm({ status: '0x1', logs: [transferLog(RECIPIENT, 2_000_000n)] }).verify(args(usdc, 1_000_000n)), 'verified');
  // split across two transfers still adds up
  assert.equal(await evm({ status: '0x1', logs: [transferLog(RECIPIENT, 600_000n), transferLog(RECIPIENT, 400_000n)] }).verify(args(usdc, 1_000_000n)), 'verified');
  // case differences in the recipient do not matter
  assert.equal(await evm({ status: '0x1', logs: [transferLog(RECIPIENT.toLowerCase(), 1_000_000n)] }).verify(args(usdc, 1_000_000n, HASH, RECIPIENT.toUpperCase().replace('0X', '0x'))), 'verified');
});

test('EVM ERC-20: wrong recipient, too little, wrong token or a reverted transaction are mismatches, never verified', async () => {
  assert.equal(await evm({ status: '0x1', logs: [transferLog(OTHER, 1_000_000n)] }).verify(args(usdc, 1_000_000n)), 'mismatch');
  assert.equal(await evm({ status: '0x1', logs: [transferLog(RECIPIENT, 999_999n)] }).verify(args(usdc, 1_000_000n)), 'mismatch');
  assert.equal(await evm({ status: '0x1', logs: [transferLog(RECIPIENT, 5_000_000n, '0x2222222222222222222222222222222222222222')] }).verify(args(usdc, 1_000_000n)), 'mismatch');
  assert.equal(await evm({ status: '0x0', logs: [transferLog(RECIPIENT, 1_000_000n)] }).verify(args(usdc, 1_000_000n)), 'mismatch');
  assert.equal(await evm({ status: '0x1', logs: [] }).verify(args(usdc, 1_000_000n)), 'mismatch');
});

test('EVM: not-yet-visible transactions are pending; unusable inputs are unverifiable', async () => {
  assert.equal(await evm(null).verify(args(usdc, 1n)), 'pending');
  assert.equal(await evm({ status: '0x1', logs: [] }).verify(args(usdc, 1n, 'not-a-hash')), 'unverifiable');
  assert.equal(await createEvmVerifier({ rpcUrlFor: () => undefined }).verify(args(usdc, 1n)), 'unverifiable');
  assert.equal(await evm({ status: '0x1', logs: [] }).verify(args(usdc, 1n, HASH, 'not-an-address')), 'unverifiable');
});

test('EVM native coin: direct transfer verifies; delivery through a contract is honestly unverifiable, not a mismatch', async () => {
  assert.equal(await evm({ status: '0x1', logs: [] }, { to: RECIPIENT, value: '0x' + (10n ** 18n).toString(16) }).verify(args(eth, 10n ** 18n)), 'verified');
  assert.equal(await evm({ status: '0x1', logs: [] }, { to: OTHER, value: '0x0' }).verify(args(eth, 10n ** 18n)), 'unverifiable');
  assert.equal(await evm({ status: '0x1', logs: [] }, { to: RECIPIENT, value: '0x1' }).verify(args(eth, 10n ** 18n)), 'unverifiable');
});

const SIG = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
const SOL_ME = 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const solUsdc: Token = { assetId: 'nep141:sol-usdc', decimals: 6, blockchain: 'sol', symbol: 'USDC', contractAddress: MINT };
const solNative: Token = { assetId: 'nep141:sol.omft.near', decimals: 9, blockchain: 'sol', symbol: 'SOL' };
const sol = (tx: unknown) => createSolanaVerifier({ rpcUrl: 'http://sol', fetchImpl: chain({ getTransaction: () => tx }) });
const solArgs = (token: Token, min: bigint) => ({ token, recipient: SOL_ME, minAmount: min, txs: [{ hash: SIG, explorerUrl: 'u' }] });
const nativeTx = (pre: number, post: number, err: unknown = null) => ({ meta: { err, preBalances: [5, pre], postBalances: [5, post] }, transaction: { message: { accountKeys: [{ pubkey: 'SomeoneElse' }, { pubkey: SOL_ME }] } } });
const splTx = (pre: string, post: string, owner = SOL_ME, mint = MINT) => ({
  meta: { err: null, preTokenBalances: [{ owner, mint, uiTokenAmount: { amount: pre } }], postTokenBalances: [{ owner, mint, uiTokenAmount: { amount: post } }] },
  transaction: { message: { accountKeys: [] } },
});

test('Solana native SOL: the recipient balance must rise by at least the promised amount', async () => {
  assert.equal(await sol(nativeTx(1_000, 10_001_000)).verify(solArgs(solNative, 10_000_000n)), 'verified');
  assert.equal(await sol(nativeTx(1_000, 9_000_000)).verify(solArgs(solNative, 10_000_000n)), 'mismatch');
  assert.equal(await sol(nativeTx(1_000, 10_001_000, { InstructionError: [0, 'x'] })).verify(solArgs(solNative, 10_000_000n)), 'mismatch');
  assert.equal(await sol(null).verify(solArgs(solNative, 1n)), 'pending');
});

test('Solana SPL token: the right owner and mint must gain at least the promised amount', async () => {
  assert.equal(await sol(splTx('0', '1000000')).verify(solArgs(solUsdc, 1_000_000n)), 'verified');
  assert.equal(await sol(splTx('500', '1000500')).verify(solArgs(solUsdc, 1_000_000n)), 'verified');
  assert.equal(await sol(splTx('0', '999999')).verify(solArgs(solUsdc, 1_000_000n)), 'mismatch');
  assert.equal(await sol(splTx('0', '5000000', 'SomeoneElse')).verify(solArgs(solUsdc, 1_000_000n)), 'mismatch');
  assert.equal(await sol(splTx('0', '5000000', SOL_ME, 'OtherMint')).verify(solArgs(solUsdc, 1_000_000n)), 'mismatch');
  assert.equal(await sol(splTx('0', '5')).verify({ ...solArgs(solUsdc, 1n), txs: [{ hash: 'bad', explorerUrl: 'u' }] }), 'unverifiable');
});

// ---------- how the service reacts to each outcome ----------
function svcWith(verifier: DestinationVerifier, clock: { t: number }) {
  const repo = new MemoryRepository();
  repo.now = () => clock.t;
  const dest: Token = { assetId: 'nep141:usdc-base', decimals: 6, blockchain: 'base', symbol: 'USDC', contractAddress: USDC_BASE };
  const src: Token = { assetId: 'nep141:sol.omft.near', decimals: 9, blockchain: 'sol', symbol: 'SOL' };
  const status: StatusResponse = { status: 'SUCCESS', updatedAt: 'x', swapDetails: { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [{ hash: HASH, explorerUrl: 'u' }] } };
  const client = {
    async quote(b: QuoteRequestBody): Promise<QuoteResponse> {
      return { signature: 's', quoteRequest: { ...b }, quote: { depositAddress: 'D', amountIn: b.amount, amountInFormatted: '1', amountInUsd: '1', minAmountIn: b.amount, amountOut: '1400000', amountOutFormatted: '1.4', amountOutUsd: '1.4', minAmountOut: '1300000', deadline: b.deadline, timeEstimate: 20 } };
    },
    async status() { return status; }, async submitDeposit() {},
  };
  const svc = new PaymentService({ repo, client, catalog: { findToken: async (id) => [dest, src].find((t) => t.assetId === id) }, verifyQuoteSignature: () => true, verifiers: { evm: verifier }, slippageBps: 100, deadlineMinutes: 10, now: () => clock.t });
  return svc;
}
const swapInput = { originAssetId: 'nep141:sol.omft.near', destAssetId: 'nep141:usdc-base', amountHuman: '0.01', payerAddress: SOL_ME, recipient: RECIPIENT };

test('service: unverifiable becomes "reported"; a broken destination RPC never produces a paid state, and falls back honestly after 10 minutes', async () => {
  const clock = { t: Date.parse('2026-11-08T12:00:00Z') };
  const s1 = svcWith({ family: 'evm', verify: async () => 'unverifiable' }, clock);
  const att1 = (await s1.createSwap(swapInput)).attempt;
  await s1.recordDeposit(att1.id, 'aDpHeJ9rfEAAU39xrkfwjWE9NvxzYaygaDpHeJ9rfEAAU39xrkfwjWE9NvxzYaygaDpHeJ9rfEAAU39xrkfwjWE9');
  const r1 = await s1.refresh(att1.id);
  assert.equal(r1.verification, 'reported');
  assert.equal(r1.state, 'destination_confirmed');

  const s2 = svcWith({ family: 'evm', verify: async () => { throw new Error('rpc down'); } }, clock);
  const att2 = (await s2.createSwap(swapInput)).attempt;
  await s2.recordDeposit(att2.id, 'T77H4aRPaDwy4JvBzVGoZciX8Q1StztNT77H4aRPaDwy4JvBzVGoZciX8Q1StztNT77H4aRPaDwy4JvBzVGoZciX');
  const r2 = await s2.refresh(att2.id);
  assert.equal(r2.verification, 'pending');
  assert.equal(r2.state, 'processing', 'a failed check must never read as delivered');
  clock.t += 11 * 60_000;
  const r3 = await s2.refresh(att2.id);
  assert.equal(r3.verification, 'reported');
  assert.equal(r3.state, 'destination_confirmed');
});
