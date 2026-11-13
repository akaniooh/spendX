import { validateAddress } from './addresses.ts';
import { familyOf } from './chains.ts';
import type { Token } from './types.ts';

/**
 * What kind of transfer funds a payment from this source token. Sending the WRONG asset to a deposit
 * address can lose funds, so anything we cannot positively identify is 'unsupported' and blocked in the UI.
 */
export type DepositKind =
  | { kind: 'evm-native' }
  | { kind: 'evm-erc20'; contract: `0x${string}` }
  | { kind: 'svm-native' }
  | { kind: 'svm-spl'; mint: string }
  | { kind: 'near-nep141'; contract: string }
  | { kind: 'unsupported'; reason: string };

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;

/** `evmNative` is the chain's native currency from viem's chain definition (the web app supplies it). */
export function classifyDeposit(token: Token, evmNative?: { symbol: string; decimals: number }): DepositKind {
  const fam = familyOf(token.blockchain);
  if (fam === 'evm') {
    if (token.contractAddress) {
      return EVM_ADDR.test(token.contractAddress)
        ? { kind: 'evm-erc20', contract: token.contractAddress as `0x${string}` }
        : { kind: 'unsupported', reason: 'Unrecognised token contract format' };
    }
    if (evmNative && evmNative.symbol.toLowerCase() === token.symbol.toLowerCase() && evmNative.decimals === token.decimals) {
      return { kind: 'evm-native' };
    }
    return { kind: 'unsupported', reason: `Not the native currency of ${token.blockchain}, and no token contract is listed` };
  }
  if (fam === 'svm') {
    if (!token.contractAddress) {
      return token.symbol === 'SOL' && token.decimals === 9
        ? { kind: 'svm-native' }
        : { kind: 'unsupported', reason: 'Unrecognised native Solana asset' };
    }
    // A Solana token: the listed contract address is its mint. Anything that is not a well-formed address is blocked.
    return validateAddress(token.blockchain, token.contractAddress).status === 'valid'
      ? { kind: 'svm-spl', mint: token.contractAddress }
      : { kind: 'unsupported', reason: 'Unrecognised Solana token address' };
  }
  if (fam === 'near') {
    // Only NEP-141 fungible tokens are sent (ft_transfer). Anything else is blocked rather than guessed.
    const contract = token.contractAddress ?? (token.assetId.startsWith('nep141:') ? token.assetId.slice('nep141:'.length) : '');
    if (token.assetId.startsWith('nep141:') && contract && validateAddress('near', contract).status === 'valid') {
      return { kind: 'near-nep141', contract };
    }
    return { kind: 'unsupported', reason: 'Only NEP-141 tokens can be paid from a NEAR wallet' };
  }
  return { kind: 'unsupported', reason: `No wallet support for ${token.blockchain} yet` };
}
