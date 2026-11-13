import type { WalletFamily } from '../../shared/src/chains.ts';
import { fromBaseUnits } from '../../shared/src/amounts.ts';
import { STATE_LABEL, isTerminal } from '../../shared/src/status.ts';
import type { Token } from '../../shared/src/types.ts';
import { SpendXError } from './domain.ts';
import type { Attempt, PaymentRequest, Repository } from './domain.ts';
import { OneClickError } from './oneclick.ts';
import { createChallenge, requireSession, verifyLogin } from './auth.ts';
import type { AuthDeps } from './auth.ts';
import { groupByChain } from './catalog.ts';
import type { PaymentService, SwapInput } from './service.ts';
import type { Assistant } from './assistant.ts';

export interface ApiRequest {
  /** client address, used only for rate limiting */
  ip?: string;
  params: Record<string, string>;
  body: unknown;
  headers: Record<string, string | undefined>;
}
export interface ApiResponse {
  status: number;
  body: unknown;
}
export interface Route {
  method: 'GET' | 'POST';
  path: string;
  handler: (req: ApiRequest) => Promise<ApiResponse>;
}

export interface ApiDeps {
  service: PaymentService;
  repo: Repository;
  auth: AuthDeps;
  catalog: { get(): Promise<Token[]> };
  /** present only when an AI provider key is configured */
  assistant?: Assistant;
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}

// ---------- views (what clients see; bigint never leaves as a number) ----------

export function requestView(r: PaymentRequest) {
  return {
    slug: r.slug,
    kind: r.kind,
    status: r.status,
    description: r.description ?? null,
    merchantAddress: r.merchantAddress,
    recipient: r.recipient,
    destination: {
      assetId: r.destAssetId,
      blockchain: r.destBlockchain,
      symbol: r.destSymbol,
      decimals: r.destDecimals,
      amount: r.amount.toString(),
      amountFormatted: fromBaseUnits(r.amount, r.destDecimals),
    },
    createdAt: r.createdAt,
  };
}

export function attemptView(a: Attempt) {
  return {
    id: a.id,
    state: a.state,
    stateLabel: STATE_LABEL[a.state],
    terminal: isTerminal(a.state),
    oneClickStatus: a.oneClickStatus ?? null,
    origin: { assetId: a.originAssetId, blockchain: a.originBlockchain, symbol: a.originSymbol, decimals: a.originDecimals },
    payerAddress: a.payerAddress,
    payerFamily: a.payerFamily,
    deposit: {
      address: a.depositAddress,
      memo: a.depositMemo ?? null,
      amount: a.amountIn.toString(),
      amountFormatted: fromBaseUnits(a.amountIn, a.originDecimals),
      deadline: a.quoteDeadline,
    },
    source: a.sourceTxHash ? { txHash: a.sourceTxHash, explorerUrl: a.sourceTxUrl ?? null } : null,
    destination: { txs: a.destTxs },
    // 'verified' = SpendX checked the destination chain itself. 'reported' = NEAR Intents' report plus tx links only.
    delivery: a.state === 'destination_confirmed' ? a.verification : null,
    near: { txHashes: a.nearTxHashes, intentHashes: a.intentHashes },
    refund: a.refund ?? null,
    updatedAt: a.updatedAt,
  };
}

// ---------- small input helpers ----------

function obj(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SpendXError('invalid_body', 'Request body must be a JSON object');
  return body as Record<string, unknown>;
}
function str(o: Record<string, unknown>, k: string, max = 300, optional = false): string {
  const v = o[k];
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    throw new SpendXError('invalid_body', `Missing field: ${k}`);
  }
  if (typeof v !== 'string' || v.length > max) throw new SpendXError('invalid_body', `Invalid field: ${k}`);
  return v;
}
function family(v: string): WalletFamily {
  if (v === 'evm' || v === 'svm' || v === 'near') return v;
  throw new SpendXError('invalid_body', 'Unsupported wallet family');
}

function swapInput(b: Record<string, unknown>): SwapInput {
  const slip = b.slippageBps;
  if (slip !== undefined && typeof slip !== 'number') throw new SpendXError('invalid_body', 'Invalid field: slippageBps');
  return {
    originAssetId: str(b, 'originAssetId'),
    destAssetId: str(b, 'destAssetId'),
    amountHuman: str(b, 'amount', 40),
    payerAddress: str(b, 'payerAddress', 128),
    recipient: str(b, 'recipient', 200),
    slippageBps: slip as number | undefined,
    acknowledgeUncheckedAddress: b.acknowledgeUncheckedAddress === true,
  };
}

// ---------- routes ----------

export function buildRoutes(d: ApiDeps): Route[] {
  const now = d.now ?? Date.now;
  const lastPoll = new Map<string, number>();
  // Quote-creating endpoints cost a call to NEAR Intents each, so they are rate limited per client.
  const hits = new Map<string, { n: number; reset: number }>();
  const throttle = (req: ApiRequest, limit = 30, windowMs = 60_000, scope = 'quote') => {
    const t = now();
    const key = `${scope}:${req.ip ?? 'unknown'}`;
    const h = hits.get(key);
    if (!h || h.reset <= t) {
      hits.set(key, { n: 1, reset: t + windowMs });
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      return;
    }
    if (++h.n > limit) throw new SpendXError('rate_limited', 'Too many requests. Please wait a minute and try again.', 429);
  };
  const log = d.log ?? ((m: string, e?: unknown) => console.error(m, e));

  const safe = (fn: (req: ApiRequest) => Promise<ApiResponse>) => async (req: ApiRequest): Promise<ApiResponse> => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof SpendXError) return { status: e.httpStatus, body: { error: { code: e.code, message: e.message, details: e.details } } };
      if (e instanceof OneClickError) {
        log('1Click error', e);
        return { status: 502, body: { error: { code: 'upstream_error', message: 'NEAR Intents is not responding as expected. Please try again shortly.' } } };
      }
      log('Unhandled error', e);
      return { status: 500, body: { error: { code: 'internal_error', message: 'Something went wrong on our side' } } };
    }
  };
  const ok = (body: unknown, status = 200): ApiResponse => ({ status, body });

  const routes: Route[] = [
    { method: 'GET', path: '/api/health', handler: safe(async () => ok({ ok: true })) },
    { method: 'GET', path: '/api/config', handler: safe(async () => ok({ assistant: !!d.assistant })) },

    // The assistant only proposes: it returns fields to pre-fill the Swap screen and can never act.
    {
      method: 'POST', path: '/api/assistant',
      handler: safe(async (req) => {
        if (!d.assistant) throw new SpendXError('assistant_disabled', 'The assistant is not enabled on this server', 503);
        throttle(req, 10, 60_000, 'assistant');
        return ok(await d.assistant.interpret(str(obj(req.body), 'text', 500)));
      }),
    },

    // Dynamic catalog straight from NEAR Intents. `duplicateSymbol` flags look-alike tokens on the same chain.
    {
      method: 'GET', path: '/api/catalog',
      handler: safe(async () => {
        const tokens = await d.catalog.get();
        const count = new Map<string, number>();
        for (const t of tokens) {
          const k = `${t.blockchain}:${t.symbol.toLowerCase()}`;
          count.set(k, (count.get(k) ?? 0) + 1);
        }
        const chains = groupByChain(tokens).map((g) => ({
          blockchain: g.blockchain,
          family: g.family,
          tokens: g.tokens.map((t) => ({
            assetId: t.assetId, symbol: t.symbol, decimals: t.decimals, price: t.price ?? null,
            contractAddress: t.contractAddress ?? null,
            duplicateSymbol: (count.get(`${t.blockchain}:${t.symbol.toLowerCase()}`) ?? 0) > 1,
          })),
        }));
        return ok({ chains });
      }),
    },

    // ----- merchant sign-in -----
    {
      method: 'POST', path: '/api/auth/challenge',
      handler: safe(async (req) => {
        const b = obj(req.body);
        return ok(createChallenge(d.auth, str(b, 'address', 128), family(str(b, 'family', 8))));
      }),
    },
    {
      method: 'POST', path: '/api/auth/verify',
      handler: safe(async (req) => {
        const b = obj(req.body);
        return ok(await verifyLogin(d.auth, {
          address: str(b, 'address', 128), family: family(str(b, 'family', 8)),
          challengeToken: str(b, 'challengeToken', 2000), signature: str(b, 'signature', 1000),
        }));
      }),
    },

    // ----- merchant (authenticated) -----
    {
      method: 'POST', path: '/api/merchant/requests',
      handler: safe(async (req) => {
        const s = requireSession(d.auth, req.headers.authorization);
        const b = obj(req.body);
        const created = await d.service.createRequest({
          merchantAddress: s.address, merchantFamily: s.family,
          destAssetId: str(b, 'destAssetId'), amountHuman: str(b, 'amount', 40), recipient: str(b, 'recipient', 200),
          description: str(b, 'description', 200, true) || undefined,
          acknowledgeUncheckedAddress: b.acknowledgeUncheckedAddress === true,
        });
        return ok(requestView(created), 201);
      }),
    },
    {
      method: 'GET', path: '/api/merchant/requests',
      handler: safe(async (req) => {
        const s = requireSession(d.auth, req.headers.authorization);
        const reqs = (await d.repo.listRequestsByMerchant(s.address)).filter((r) => r.kind === 'payment').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const rows = await Promise.all(reqs.map(async (r) => {
          const attempts = (await d.repo.listAttempts(r.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          const latest = attempts[0];
          return { request: requestView(r), latestAttempt: latest ? attemptView(latest) : null };
        }));
        const pending = rows.filter((x) => x.latestAttempt && !x.latestAttempt.terminal).length;
        return ok({
          stats: { total: rows.length, paid: rows.filter((x) => x.request.status === 'paid').length, pending },
          requests: rows,
        });
      }),
    },

    // The signed-in wallet's own activity (swaps and payments it made), so history follows the wallet across devices.
    {
      method: 'GET', path: '/api/activity',
      handler: safe(async (req) => {
        const s = requireSession(d.auth, req.headers.authorization);
        const attempts = await d.repo.listAttemptsByPayer(s.address, 50);
        const items = await Promise.all(attempts.map(async (a) => {
          const r = await d.repo.getRequestById(a.requestId);
          return { createdAt: a.createdAt, attempt: attemptView(a), request: r ? requestView(r) : null };
        }));
        return ok({ items });
      }),
    },

    // ----- customer (public; payment links are unguessable, attempt ids are bearer secrets) -----
    {
      method: 'GET', path: '/api/requests/:slug',
      handler: safe(async (req) => {
        const r = await d.repo.getRequestBySlug(req.params.slug);
        if (!r) throw new SpendXError('not_found', 'Payment request not found', 404);
        return ok(requestView(r));
      }),
    },
    {
      method: 'POST', path: '/api/requests/:slug/preview',
      handler: safe(async (req) => {
        throttle(req);
        const b = obj(req.body);
        return ok(await d.service.previewQuote(req.params.slug, { originAssetId: str(b, 'originAssetId'), payerAddress: str(b, 'payerAddress', 128) }));
      }),
    },
    {
      method: 'POST', path: '/api/requests/:slug/attempts',
      handler: safe(async (req) => {
        throttle(req);
        const b = obj(req.body);
        return ok(attemptView(await d.service.createAttempt(req.params.slug, { originAssetId: str(b, 'originAssetId'), payerAddress: str(b, 'payerAddress', 128) })), 201);
      }),
    },
    // ----- one-click swaps (public: the customer swaps their own funds to their own address) -----
    {
      method: 'POST', path: '/api/swaps/preview',
      handler: safe(async (req) => {
        throttle(req);
        return ok(await d.service.previewSwap(swapInput(obj(req.body))));
      }),
    },
    {
      method: 'POST', path: '/api/swaps',
      handler: safe(async (req) => {
        throttle(req);
        const { request, attempt } = await d.service.createSwap(swapInput(obj(req.body)));
        return ok({ request: requestView(request), attempt: attemptView(attempt) }, 201);
      }),
    },
    {
      method: 'GET', path: '/api/attempts/:id',
      handler: safe(async (req) => {
        const id = req.params.id;
        let a = await d.repo.getAttempt(id);
        if (!a) throw new SpendXError('not_found', 'Payment attempt not found', 404);
        if (d.service.shouldPoll(a) && now() - (lastPoll.get(id) ?? 0) >= 2500) {
          lastPoll.set(id, now());
          a = await d.service.refresh(id);
        }
        const r = await d.repo.getRequestById(a.requestId);
        return ok({ attempt: attemptView(a), request: r ? requestView(r) : null });
      }),
    },
    { method: 'POST', path: '/api/attempts/:id/signing', handler: safe(async (req) => ok(attemptView(await d.service.markSigning(req.params.id)))) },
    { method: 'POST', path: '/api/attempts/:id/cancel', handler: safe(async (req) => ok(attemptView(await d.service.cancelAttempt(req.params.id)))) },
    {
      method: 'POST', path: '/api/attempts/:id/deposit',
      handler: safe(async (req) => {
        const b = obj(req.body);
        return ok(attemptView(await d.service.recordDeposit(req.params.id, str(b, 'txHash', 200), str(b, 'explorerUrl', 500, true) || undefined)));
      }),
    },
  ];
  return routes;
}
