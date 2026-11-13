import type { Route } from './api.ts';

// Lets the browser read Solana through THIS server, so the RPC provider's key (SOLANA_RPC_URL, e.g. a Helius URL)
// stays on the server and never reaches the public JavaScript. It is deliberately narrow: only the read calls the
// web app makes, one request at a time, rate limited per client. It is not a general-purpose open relay.

const ALLOWED_METHODS = new Set([
  'getAccountInfo',
  'getBalance',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getTokenAccountsByOwner', // web3.js getParsedTokenAccountsByOwner uses this with jsonParsed encoding
]);

interface RpcCall { id: string | number | null; method: string; params: unknown[] }
type Checked = { ok: true; call: RpcCall } | { ok: false; status: number; code: number; message: string };

const bad = (status: number, code: number, message: string): Checked => ({ ok: false, status, code, message });

/** Accepts one plain JSON-RPC call to an allowed method. Anything else (batches, other methods, odd shapes) is refused. */
export function checkRpcCall(body: unknown): Checked {
  if (Array.isArray(body)) return bad(400, -32600, 'Batch requests are not supported');
  if (!body || typeof body !== 'object') return bad(400, -32600, 'Request must be a JSON-RPC object');
  const b = body as Record<string, unknown>;
  if (b.jsonrpc !== '2.0') return bad(400, -32600, 'jsonrpc must be "2.0"');
  if (typeof b.method !== 'string' || !ALLOWED_METHODS.has(b.method)) return bad(403, -32601, 'Method not allowed');
  const id = b.id ?? null;
  if (id !== null && typeof id !== 'string' && typeof id !== 'number') return bad(400, -32600, 'Invalid id');
  const params = b.params ?? [];
  if (!Array.isArray(params) || params.length > 4) return bad(400, -32602, 'Invalid params');
  if (b.method === 'getTokenAccountsByOwner') {
    // Only "this owner's accounts for this mint": a programId filter would let a visitor trigger much heavier scans.
    const filter = params[1] as { mint?: unknown } | undefined;
    if (typeof params[0] !== 'string' || !filter || typeof filter !== 'object' || typeof filter.mint !== 'string') {
      return bad(400, -32602, 'getTokenAccountsByOwner needs an owner and a mint filter');
    }
  }
  return { ok: true, call: { id, method: b.method, params } };
}

export interface SolanaRpcProxyOptions {
  /** The real endpoint, key included. Never sent to the browser or written to logs. */
  rpcUrl: string;
  fetchImpl?: typeof fetch;
  /** requests per client per window (default 240 per minute: a balance check is a handful of calls) */
  limit?: number;
  windowMs?: number;
  timeoutMs?: number;
  now?: () => number;
  /** Called with a short, key-free note when the provider fails (status code only, never the URL or provider text). */
  log?: (message: string) => void;
}

export function solanaRpcProxyRoute(o: SolanaRpcProxyOptions): Route {
  const doFetch = o.fetchImpl ?? fetch;
  const limit = o.limit ?? 240;
  const windowMs = o.windowMs ?? 60_000;
  const now = o.now ?? Date.now;
  const hits = new Map<string, { n: number; resetAt: number }>();
  const err = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  return {
    method: 'POST',
    path: '/api/solana-rpc',
    handler: async (req) => {
      const t = now();
      const who = req.ip ?? 'unknown';
      let h = hits.get(who);
      if (!h || h.resetAt <= t) { h = { n: 0, resetAt: t + windowMs }; hits.set(who, h); }
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k); // keep the table from growing forever
      if (++h.n > limit) return { status: 429, body: err(null, -32005, 'Too many requests. Please wait a minute and try again.') };

      const checked = checkRpcCall(req.body);
      if (!checked.ok) {
        const m = (req.body as { method?: unknown } | null)?.method;
        o.log?.(`Solana RPC proxy refused a request (${checked.status}): ${checked.message}${typeof m === 'string' ? ` [method: ${m.slice(0, 60).replace(/[^A-Za-z0-9_]/g, '?')}]` : ''}`);
      }
      if (!checked.ok) return { status: checked.status, body: err((req.body as { id?: unknown } | null)?.id, checked.code, checked.message) };
      const { id, method, params } = checked.call;
      try {
        const res = await doFetch(o.rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Rebuilt from the checked fields, so nothing extra from the browser is forwarded.
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
        });
        if (!res.ok) {
          o.log?.(`Solana RPC provider answered HTTP ${res.status} to ${method}. Check SOLANA_RPC_URL (key valid, plan active, no domain/IP restriction blocking this server).`);
          return { status: 502, body: err(id, -32003, 'The Solana endpoint refused the request') };
        }
        const json = await res.json();
        return { status: 200, body: json };
      } catch (e) {
        o.log?.(`Solana RPC provider unreachable for ${method} (${e instanceof Error ? e.name : 'error'}). Check SOLANA_RPC_URL and this machine's internet access.`);
        // No error details on purpose: a provider's error text can include the request URL, and with it the key.
        return { status: 502, body: err(id, -32003, 'Could not reach the Solana endpoint') };
      }
    },
  };
}
