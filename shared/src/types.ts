// Shapes below follow the 1Click OpenAPI spec (docs.near-intents.org, v0.1.10 at time of writing).

export interface Token {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  priceUpdatedAt?: string;
  contractAddress?: string | null;
}

export type OneClickStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

/** One entry of 1Click's `appFees`: `fee` is an integer number of basis points taken from the input token. */
export interface AppFee {
  recipient: string;
  fee: number;
}

export interface QuoteRequestBody {
  dry: boolean;
  swapType: 'EXACT_INPUT' | 'EXACT_OUTPUT' | 'FLEX_INPUT' | 'ANY_INPUT';
  slippageTolerance: number;
  originAsset: string;
  depositType: 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  recipient: string;
  recipientType: 'DESTINATION_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  deadline: string;
  depositMode?: 'SIMPLE' | 'MEMO';
  /** distribution-channel fee (what SpendX earns); see shared/src/fees.ts */
  appFees?: AppFee[];
  /** lowercase partner identifier so NEAR Intents can attribute volume */
  referral?: string;
}

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
}

export interface QuoteResponse {
  correlationId?: string;
  timestamp?: string;
  signature?: string;
  quoteRequest: QuoteRequestBody;
  quote: Quote;
}

export interface TxDetails {
  hash: string;
  explorerUrl: string;
}

export interface SwapDetails {
  intentHashes: string[];
  nearTxHashes: string[];
  originChainTxHashes: TxDetails[];
  destinationChainTxHashes: TxDetails[];
  amountIn?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  refundedAmount?: string;
  refundedAmountFormatted?: string;
  refundReason?: string;
  depositedAmount?: string;
}

export interface StatusResponse {
  correlationId?: string;
  status: OneClickStatus;
  updatedAt: string;
  quoteResponse?: QuoteResponse;
  swapDetails: SwapDetails;
}
