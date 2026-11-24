// Switching an EVM wallet to a chain it has never seen fails (EIP-3326, code 4902). Chains such as Monad or Plasma are
// not built into most wallets, so we ask the wallet to ADD the network first, then switch. No viem import, so this is
// testable on its own; the wallet client is passed in.
export interface ChainSwitcher<C extends { id: number }> {
  switchChain(args: { id: number }): Promise<unknown>;
  addChain(args: { chain: C }): Promise<unknown>;
}

const UNKNOWN_CHAIN_TEXT = /unrecognized chain|unknown chain|chain.*not (been )?added|try adding the chain|wallet_addEthereumChain|not configured/i;

/** True when the wallet said it does not know the chain. A user rejecting the prompt (4001) is NOT this. */
export function isUnrecognizedChainError(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 4 && cur && typeof cur === 'object'; depth++) {
    const o = cur as { code?: unknown; message?: unknown; data?: { originalError?: { code?: unknown } }; cause?: unknown };
    if (o.code === 4902 || o.data?.originalError?.code === 4902) return true;
    if (o.code !== 4001 && typeof o.message === 'string' && UNKNOWN_CHAIN_TEXT.test(o.message)) return true;
    cur = o.cause;
  }
  return false;
}

export async function switchOrAddChain<C extends { id: number }>(wc: ChainSwitcher<C>, chain: C): Promise<void> {
  try {
    await wc.switchChain({ id: chain.id });
    return;
  } catch (e) {
    if (!isUnrecognizedChainError(e)) throw e; // user said no, or something else is wrong: never add a network silently
  }
  await wc.addChain({ chain }); // the wallet asks the user to approve adding the network
  await wc.switchChain({ id: chain.id }); // some wallets switch on add, some do not; switching again is harmless
}
