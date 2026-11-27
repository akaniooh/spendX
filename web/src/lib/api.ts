import { clockOffsetFromDateHeader, setClockOffset } from './clock.ts';
import type { AssistantResult, AttemptView, CatalogChain, QuotePreview, RequestView, SwapPreview } from './types.ts';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 'Cannot reach the SpendX server. Is it running?', 0);
  }
  const offset = clockOffsetFromDateHeader(res.headers.get('date'), Date.now());
  if (offset !== undefined) setClockOffset(offset);
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, res.status, e?.details);
  }
  return data as T;
}

export interface SwapBody {
  originAssetId: string;
  destAssetId: string;
  amount: string;
  payerAddress: string;
  recipient: string;
  slippageBps?: number;
  acknowledgeUncheckedAddress?: boolean;
}

export interface AlertStatus { enabled: boolean; email?: string; verified?: boolean }

export const api = {
  config: () => call<{ assistant: boolean; alerts?: boolean }>('GET', '/api/config'),
  /** Merchant email alerts: the address is confirmed with a code before anything is sent. */
  alertsStatus: (token: string) => call<AlertStatus>('GET', '/api/merchant/alerts', undefined, token),
  alertsEmail: (token: string, email: string) => call<AlertStatus>('POST', '/api/merchant/alerts/email', { email }, token),
  alertsVerify: (token: string, code: string) => call<AlertStatus>('POST', '/api/merchant/alerts/verify', { code }, token),
  alertsRemove: (token: string) => call<AlertStatus>('POST', '/api/merchant/alerts/remove', {}, token),
  assistant: (text: string) => call<AssistantResult>('POST', '/api/assistant', { text }),
  catalog: () => call<{ chains: CatalogChain[] }>('GET', '/api/catalog'),
  /** Hourly prices for the last 7 days by token symbol (symbols only: no address or balance is sent). */
  priceHistory: (symbols: string[]) => call<{ series: Record<string, number[]> }>('POST', '/api/price-history', { symbols }),
  /** USD to local-currency rates for display (cached on the server). */
  rates: () => call<{ rates: Record<string, number> }>('GET', '/api/rates'),
  icons: () => call<{ chains: Record<string, string>; tokens: Record<string, string> }>('GET', '/api/icons'),
  challenge: (address: string, family: string) => call<{ challengeToken: string; message: string }>('POST', '/api/auth/challenge', { address, family }),
  verify: (b: { address: string; family: string; challengeToken: string; signature: string }) =>
    call<{ token: string; expiresAt: string; address: string; family: 'evm' | 'svm' }>('POST', '/api/auth/verify', b),
  createRequest: (token: string, b: { destAssetId: string; amount: string; recipient: string; description?: string; acknowledgeUncheckedAddress?: boolean }) =>
    call<RequestView>('POST', '/api/merchant/requests', b, token),
  merchantRequests: (token: string) =>
    call<{ stats: { total: number; paid: number; pending: number }; requests: { request: RequestView; latestAttempt: AttemptView | null }[] }>('GET', '/api/merchant/requests', undefined, token),
  activity: (token: string) =>
    call<{ items: { createdAt: string; attempt: AttemptView; request: RequestView | null }[] }>('GET', '/api/activity', undefined, token),
  request: (slug: string) => call<RequestView>('GET', `/api/requests/${encodeURIComponent(slug)}`),
  preview: (slug: string, b: { originAssetId: string; payerAddress: string }) => call<QuotePreview>('POST', `/api/requests/${encodeURIComponent(slug)}/preview`, b),
  createAttempt: (slug: string, b: { originAssetId: string; payerAddress: string }) => call<AttemptView>('POST', `/api/requests/${encodeURIComponent(slug)}/attempts`, b),
  swapPreview: (b: SwapBody) => call<SwapPreview>('POST', '/api/swaps/preview', b),
  createSwap: (b: SwapBody) => call<{ request: RequestView; attempt: AttemptView }>('POST', '/api/swaps', b),
  attempt: (id: string) => call<{ attempt: AttemptView; request: RequestView | null }>('GET', `/api/attempts/${encodeURIComponent(id)}`),
  signing: (id: string) => call<AttemptView>('POST', `/api/attempts/${encodeURIComponent(id)}/signing`),
  deposit: (id: string, b: { txHash: string; explorerUrl?: string }) => call<AttemptView>('POST', `/api/attempts/${encodeURIComponent(id)}/deposit`, b),
  cancel: (id: string) => call<AttemptView>('POST', `/api/attempts/${encodeURIComponent(id)}/cancel`),
};
