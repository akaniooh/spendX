import type { QuoteRequestBody, QuoteResponse, StatusResponse, Token } from '../../shared/src/types.ts';

// Endpoints used (all from docs.near-intents.org, 1Click API):
//   GET  /v0/tokens
//   POST /v0/quote
//   POST /v0/deposit/submit
//   GET  /v0/status?depositAddress=...&depositMemo=...
// The API key goes in the X-API-Key header (docs: "Authenticating", API Keys page). Backend only.

export class OneClickError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'OneClickError';
    this.status = status;
    this.body = body;
  }
}

export interface OneClickOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class OneClickClient {
  private baseUrl: string;
  private apiKey?: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(opts: OneClickOptions = {}) {
    this.baseUrl = (opts.baseUrl || 'https://1click.chaindefuser.com').replace(/\/+$/, '');
    this.apiKey = opts.apiKey || undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const res = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === 'object' && 'message' in parsed && typeof (parsed as { message: unknown }).message === 'string'
          ? (parsed as { message: string }).message
          : `1Click request failed with HTTP ${res.status}`;
      throw new OneClickError(res.status, msg, parsed);
    }
    return parsed as T;
  }

  getTokens(): Promise<Token[]> {
    return this.request<Token[]>('GET', '/v0/tokens');
  }

  quote(body: QuoteRequestBody): Promise<QuoteResponse> {
    return this.request<QuoteResponse>('POST', '/v0/quote', body);
  }

  async submitDeposit(args: { depositAddress: string; txHash: string }): Promise<void> {
    await this.request('POST', '/v0/deposit/submit', args);
  }

  status(depositAddress: string, depositMemo?: string): Promise<StatusResponse> {
    const qs = new URLSearchParams({ depositAddress });
    if (depositMemo) qs.set('depositMemo', depositMemo);
    return this.request<StatusResponse>('GET', `/v0/status?${qs.toString()}`);
  }
}

interface QuoteCommon {
  dry: boolean;
  originAssetId: string;
  destAssetId: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  deadlineMinutes: number;
  now?: Date;
  /** set for chains that require a memo with the deposit address */
  depositMode?: 'SIMPLE' | 'MEMO';
}

export interface BuildQuoteArgs extends QuoteCommon {
  /** exact amount the merchant must receive, base units of the destination asset */
  amountOut: bigint;
}

export interface BuildExactInputArgs extends QuoteCommon {
  /** exact amount the customer sends, base units of the ORIGIN asset */
  amountIn: bigint;
}

function build(a: QuoteCommon, swapType: 'EXACT_OUTPUT' | 'EXACT_INPUT', amount: bigint): QuoteRequestBody {
  const now = a.now ?? new Date();
  const body: QuoteRequestBody = {
    dry: a.dry,
    swapType,
    slippageTolerance: a.slippageBps,
    originAsset: a.originAssetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: a.destAssetId,
    amount: amount.toString(),
    refundTo: a.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: a.recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(now.getTime() + a.deadlineMinutes * 60_000).toISOString(),
  };
  if (a.depositMode) body.depositMode = a.depositMode;
  return body;
}

/** Payments: pay-exact-output, deposit on origin chain, deliver on destination chain. */
export function buildExactOutputQuote(a: BuildQuoteArgs): QuoteRequestBody {
  return build(a, 'EXACT_OUTPUT', a.amountOut);
}

/** Swaps: send an exact amount, receive whatever it buys (never less than the quote's minAmountOut). */
export function buildExactInputQuote(a: BuildExactInputArgs): QuoteRequestBody {
  return build(a, 'EXACT_INPUT', a.amountIn);
}
