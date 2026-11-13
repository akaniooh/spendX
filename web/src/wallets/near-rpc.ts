// Read-only NEAR access over plain JSON-RPC (the protocol's stable `query` method), so SpendX does not depend on
// a particular near-api-js version's helper signatures. NEAR Connect itself has no read API (per the NEAR docs).

export const NEAR_RPC_URL: string = (import.meta as any).env?.VITE_NEAR_RPC_URL || 'https://free.rpc.fastnear.com';

type Fetch = typeof fetch;

async function query(params: Record<string, unknown>, url: string, fetchImpl: Fetch): Promise<any> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'spendx', method: 'query', params: { finality: 'final', ...params } }),
  });
  if (!res.ok) throw new Error(`NEAR RPC request failed (HTTP ${res.status})`);
  const body = await res.json();
  if (body.error) throw new Error(`NEAR RPC error: ${body.error.data ?? body.error.message ?? 'unknown'}`);
  if (body.result?.error) throw new Error(`NEAR RPC error: ${body.result.error}`);
  return body.result;
}

export interface NearRpc {
  viewCall<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T>;
  /** account balance in yoctoNEAR; 0 if the account does not exist yet */
  accountBalance(accountId: string): Promise<bigint>;
  ftBalanceOf(contract: string, accountId: string): Promise<bigint>;
  /** false when the account has no storage registration on the token contract (storage_balance_of returned null) */
  isRegistered(contract: string, accountId: string): Promise<boolean>;
  /** storage_balance_bounds().min in yoctoNEAR */
  storageMin(contract: string): Promise<string>;
}

export function createNearRpc(url: string = NEAR_RPC_URL, fetchImpl: Fetch = fetch): NearRpc {
  const viewCall = async <T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> => {
    const r = await query(
      { request_type: 'call_function', account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) },
      url, fetchImpl,
    );
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result as number[]))) as T;
  };
  return {
    viewCall,
    async accountBalance(accountId) {
      try {
        const r = await query({ request_type: 'view_account', account_id: accountId }, url, fetchImpl);
        return BigInt(r.amount);
      } catch (e) {
        if (/does not exist|UNKNOWN_ACCOUNT/i.test((e as Error).message)) return 0n;
        throw e;
      }
    },
    async ftBalanceOf(contract, accountId) {
      return BigInt(await viewCall<string>(contract, 'ft_balance_of', { account_id: accountId }));
    },
    async isRegistered(contract, accountId) {
      return (await viewCall<unknown>(contract, 'storage_balance_of', { account_id: accountId })) !== null;
    },
    async storageMin(contract) {
      const b = await viewCall<{ min: string }>(contract, 'storage_balance_bounds', {});
      if (!b || typeof b.min !== 'string' || !/^\d+$/.test(b.min)) throw new Error('Token contract returned no storage requirement');
      return b.min;
    },
  };
}
