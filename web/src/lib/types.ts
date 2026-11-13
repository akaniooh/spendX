import type { requestView, attemptView } from '../../../server/src/api.ts';
import type { SwapPreview } from '../../../server/src/service.ts';
import type { AssistantResult } from '../../../server/src/assistant.ts';

export type { SwapPreview, AssistantResult };

// The API's response shapes, derived from the server so they cannot drift apart.
export type RequestView = ReturnType<typeof requestView>;
export type AttemptView = ReturnType<typeof attemptView>;

export interface CatalogToken {
  assetId: string;
  symbol: string;
  decimals: number;
  price: number | null;
  contractAddress: string | null;
  duplicateSymbol: boolean;
}
export interface CatalogChain {
  blockchain: string;
  family: 'evm' | 'svm' | 'near' | 'other';
  tokens: CatalogToken[];
}
export interface QuotePreview {
  amountInFormatted: string;
  amountOutFormatted: string;
  amountInUsd: string;
  amountOutUsd: string;
  estimatedCostUsd: number;
  timeEstimateSeconds: number;
  refundFee?: string;
  withdrawFee?: string;
  minAmountIn: string;
}
