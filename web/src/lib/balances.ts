// Reads the balances behind an assistant "balance" answer, from the person's OWN connected wallets, in their browser.
// The server and the AI model never see an address or a balance: the model only said which token was asked about.
// No React here, so every rule is testable.
import type { WalletAdapter } from '../../../shared/src/adapters.ts';
import { fromBaseUnits } from '../../../shared/src/amounts.ts';
import { chainName } from '../../../shared/src/chain-names.ts';
import { familyOf, type WalletFamily } from '../../../shared/src/chains.ts';
import type { Token } from '../../../shared/src/types.ts';

export interface BalanceTarget {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  contractAddress?: string | null;
}

export type BalanceRow =
  | { status: 'ok'; amount: string }
  | { status: 'no-wallet' | 'unsupported' | 'error'; message: string };

const FAMILY_NAME: Record<string, string> = { evm: 'Ethereum-compatible', svm: 'Solana', near: 'NEAR' };

function oneLine(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const text = raw.replace(/\s+/g, ' ').trim();
  if (/403|forbidden|rate.?limit|429/i.test(text)) return 'The network endpoint refused the request. Try again in a moment, or set your own RPC address (see the README).';
  return text.length > 140 ? `${text.slice(0, 137)}...` : text || 'Could not read this balance';
}

async function readOne(t: BalanceTarget, adapterFor: (f: WalletFamily) => WalletAdapter | null, timeoutMs: number): Promise<BalanceRow> {
  const family = familyOf(t.blockchain);
  if (family === 'other') return { status: 'unsupported', message: `SpendX cannot read balances on ${chainName(t.blockchain)} yet.` };
  const adapter = adapterFor(family);
  if (!adapter) return { status: 'no-wallet', message: `Connect a ${FAMILY_NAME[family] ?? family} wallet to see this.` };
  if (!adapter.supportsChain(t.blockchain)) return { status: 'unsupported', message: `Your connected wallet cannot read ${chainName(t.blockchain)}.` };
  const token: Token = { assetId: t.assetId, blockchain: t.blockchain, symbol: t.symbol, decimals: t.decimals, contractAddress: t.contractAddress };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out reading this balance')), timeoutMs); });
    const base = await Promise.race([adapter.getBalance(token), timeout]);
    return { status: 'ok', amount: fromBaseUnits(base, t.decimals) };
  } catch (e) {
    return { status: 'error', message: oneLine(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One row per target, in the same order. A few at a time, each with its own time limit; one failure never hides the rest. */
export async function readBalances(
  targets: BalanceTarget[],
  adapterFor: (family: WalletFamily) => WalletAdapter | null,
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Promise<BalanceRow[]> {
  const rows: BalanceRow[] = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < targets.length; i = next++) rows[i] = await readOne(targets[i], adapterFor, opts.timeoutMs ?? 12_000);
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, targets.length) }, worker));
  return rows;
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** "USDC on Base". Look-alikes on the same network get their contract address, so two USDTs are never confused. */
export function balanceLabel(t: BalanceTarget, all: BalanceTarget[]): string {
  const base = `${t.symbol} on ${chainName(t.blockchain)}`;
  const twins = all.filter((o) => o.blockchain === t.blockchain && o.symbol.toLowerCase() === t.symbol.toLowerCase()).length > 1;
  return twins && t.contractAddress ? `${base} (${short(t.contractAddress)})` : base;
}
