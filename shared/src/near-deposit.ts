import type { Token } from './types.ts';

// NEAR deposit plan, from docs.near.org:
//  - NEP-141 transfers use ft_transfer(receiver_id, amount) with EXACTLY 1 yoctoNEAR attached.
//  - The receiver must be registered with the token contract (NEP-145). storage_balance_of returns
//    null when it is not; then storage_deposit must be called attaching at least storage_balance_bounds.min
//    (docs example: 0.00125 NEAR for meta-pool.near).
//  - NEAR Connect: wallet.signAndSendTransaction({ receiverId, actions: [{ type: 'FunctionCall', params }] }).
//  - Gas "30000000000000" (30 TGas) is the value used in the docs' examples. Confirm in the first real test.

export interface NearFunctionCallAction {
  type: 'FunctionCall';
  params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
}

export interface NearTxPlan {
  receiverId: string; // the token contract
  actions: NearFunctionCallAction[];
}

const GAS_30_TGAS = '30000000000000';
const ONE_YOCTO = '1';

export function nearTokenContract(token: Token): string {
  if (token.blockchain !== 'near') throw new Error(`${token.assetId} is not a NEAR-chain asset`);
  if (token.contractAddress) return token.contractAddress;
  if (token.assetId.startsWith('nep141:')) return token.assetId.slice('nep141:'.length);
  throw new Error(`Cannot determine the NEAR token contract for ${token.assetId}`);
}

export function planNearDeposit(args: {
  token: Token;
  amount: bigint;
  depositAddress: string;
  /** result of storage_balance_of(depositAddress) on the token contract: null => not registered */
  receiverRegistered: boolean;
  /** storage_balance_bounds().min in yoctoNEAR, required when the receiver is not registered */
  storageMinYocto?: string;
}): NearTxPlan {
  if (args.amount <= 0n) throw new Error('Amount must be positive');
  const actions: NearFunctionCallAction[] = [];
  if (!args.receiverRegistered) {
    if (!args.storageMinYocto || !/^\d+$/.test(args.storageMinYocto) || args.storageMinYocto === '0') {
      throw new Error('Receiver is not registered with the token contract and no storage minimum was provided');
    }
    actions.push({
      type: 'FunctionCall',
      params: {
        methodName: 'storage_deposit',
        args: { account_id: args.depositAddress, registration_only: true },
        gas: GAS_30_TGAS,
        deposit: args.storageMinYocto,
      },
    });
  }
  actions.push({
    type: 'FunctionCall',
    params: {
      methodName: 'ft_transfer',
      args: { receiver_id: args.depositAddress, amount: args.amount.toString() },
      gas: GAS_30_TGAS,
      deposit: ONE_YOCTO,
    },
  });
  return { receiverId: nearTokenContract(args.token), actions };
}
