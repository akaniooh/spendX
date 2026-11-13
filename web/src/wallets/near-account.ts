/**
 * Reads the signed-in account id from a NEAR Connect wallet. The library documents `wallet.getAccounts({ network })`
 * (returns accounts with an `accountId`); some wallet integrations also expose `getAddress()`. Both are tried.
 */
export async function nearAddressOf(wallet: any, network = 'mainnet'): Promise<string> {
  if (typeof wallet?.getAccounts === 'function') {
    const accounts = await wallet.getAccounts({ network });
    const id = Array.isArray(accounts) ? accounts[0]?.accountId : undefined;
    if (typeof id === 'string' && id) return id;
  }
  if (typeof wallet?.getAddress === 'function') {
    const address = await wallet.getAddress();
    if (typeof address === 'string' && address) return address;
  }
  throw new Error('The NEAR wallet did not return an account. Try connecting again.');
}
