import type { WalletAdapter } from '../../../shared/src/adapters.ts';
import { fromBaseUnits } from '../../../shared/src/amounts.ts';
import type { Token } from '../../../shared/src/types.ts';
import { correctedNow } from './clock.ts';
import type { AttemptView } from './types.ts';

export interface DepositApi {
  signing(id: string): Promise<unknown>;
  deposit(id: string, b: { txHash: string; explorerUrl?: string }): Promise<unknown>;
}

/**
 * The one place funds are sent, for both payments and swaps. Everything that must be true before the wallet
 * prompt is checked here. The wallet prompt itself is the user's approval; nothing is ever auto-approved.
 */
export async function executeDeposit(a: { attempt: AttemptView; adapter: WalletAdapter; token: Token; api: DepositApi; now?: number }): Promise<{ txHash: string }> {
  const { attempt, adapter, token, api } = a;
  if (attempt.origin.assetId !== token.assetId) throw new Error('The selected token no longer matches this quote. Start again.');
  if (Date.parse(attempt.deposit.deadline) <= (a.now ?? correctedNow())) throw new Error('This quote has expired. Get a new quote.');
  const amount = BigInt(attempt.deposit.amount);
  const balance = await adapter.getBalance(token);
  if (balance < amount) throw new Error(`Insufficient balance: you have ${fromBaseUnits(balance, token.decimals)} ${token.symbol}.`);
  await api.signing(attempt.id);
  const { txHash } = await adapter.sendDeposit({ token, amount, depositAddress: attempt.deposit.address, depositMemo: attempt.deposit.memo ?? undefined });
  // Funds are on their way. Recording the hash only speeds things up: NEAR Intents also detects the deposit itself,
  // so a wallet that returns no hash (txHash is empty) is not an error once the transfer has been sent.
  if (txHash) {
    try {
      await api.deposit(attempt.id, { txHash, explorerUrl: adapter.explorerTxUrl(token.blockchain, txHash) ?? undefined });
    } catch {
      /* tracked via status polling */
    }
  }
  return { txHash };
}
