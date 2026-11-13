import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { buildRoutes } from './api.ts';
import { createAssistant } from './assistant.ts';
import { accessLogLine, jsonErrorHandler } from './http.ts';
import { startReconciler } from './reconciler.ts';
import { securityHeaders } from './security.ts';
import { solanaRpcProxyRoute } from './solana-rpc-proxy.ts';
import { createNearSignatureVerifier, verifyEvmSignature, verifySolanaSignature } from './auth.ts';
import { CatalogCache } from './catalog.ts';
import { loadConfig } from './config.ts';
import { MemoryRepository } from './repo-memory.ts';
import { SupabaseRepository } from './repo-supabase.ts';
import { OneClickClient } from './oneclick.ts';
import { PaymentService } from './service.ts';
import { rpcUrlFor } from './rpc-urls.ts';
import { createEvmVerifier, createSolanaVerifier } from './verifiers.ts';
import type { Repository } from './domain.ts';
import type { QuoteResponse } from '../../shared/src/types.ts';

const cfg = loadConfig(process.env);
for (const w of cfg.warnings) console.warn(`WARNING: ${w}`);

let repo: Repository;
if (cfg.repository === 'memory') {
  console.warn('WARNING: REPOSITORY=memory. Data is lost on restart. Local development only.');
  repo = new MemoryRepository();
} else {
  repo = new SupabaseRepository(createClient(cfg.supabaseUrl!, cfg.supabaseServiceKey!, { auth: { persistSession: false } }));
}

const client = new OneClickClient({ baseUrl: cfg.oneClickBaseUrl, apiKey: cfg.oneClickApiKey });
const catalog = new CatalogCache(client);
const service = new PaymentService({
  repo, client, catalog,
  // Docs: verifyQuoteSignature(quoteResponse) -> boolean, SDK >= 0.1.24. We pass the untouched API response.
  verifyQuoteSignature: (q: QuoteResponse) => verifyQuoteSignature(q as never),
  // Independent delivery checks against the destination chain itself (EVM and Solana). Other families stay "reported".
  verifiers: { evm: createEvmVerifier({ rpcUrlFor }), svm: createSolanaVerifier({ rpcUrl: cfg.solanaRpcUrl }) },
  slippageBps: cfg.slippageBps,
  deadlineMinutes: cfg.deadlineMinutes,
});
// Optional: only enabled when ANTHROPIC_API_KEY or OPENAI_API_KEY is set (AI_PROVIDER picks one if both are). Without it SpendX works exactly the same, minus the assistant.
const assistant = cfg.assistant ? createAssistant({ ...cfg.assistant, catalog }) : undefined;
if (cfg.assistant) console.log(`Assistant on: ${cfg.assistant.provider}, model "${cfg.assistant.model}"${cfg.assistant.baseUrl ? `, ${cfg.assistant.baseUrl}` : ''}`);
if (cfg.assistant?.fallback) console.log(`Assistant fallback: ${cfg.assistant.fallback.provider}, model "${cfg.assistant.fallback.model}"`);
const routes = buildRoutes({
  service, repo, catalog, assistant,
  auth: { secret: cfg.sessionSecret, origin: cfg.publicOrigin, verifiers: { svm: verifySolanaSignature, evm: verifyEvmSignature, near: createNearSignatureVerifier({ rpcUrl: rpcUrlFor('near') ?? 'https://free.rpc.fastnear.com' }) } },
});

// The browser reads Solana through this route so the provider key in SOLANA_RPC_URL never leaves the server.
routes.push(solanaRpcProxyRoute({ rpcUrl: cfg.solanaRpcUrl, log: (m) => console.warn(m) }));

const app = express();
app.disable('x-powered-by');
// Behind a hosting platform's proxy, req.ip would otherwise be the proxy for everyone and rate limits would be shared.
if (cfg.trustProxy > 0) app.set('trust proxy', cfg.trustProxy);
const headers = securityHeaders({ production: process.env.NODE_ENV === 'production', enforceCsp: cfg.cspEnforce });
app.use((req, res, next) => {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (req.path.startsWith('/api/') && req.path !== '/api/catalog') res.setHeader('Cache-Control', 'no-store'); // payment status must always be fresh (the big token list may be cached)
  next();
});
app.use(express.json({ limit: '32kb' })); // after the headers, so even a bad-JSON error response carries them
// One log line per API request, using the route pattern so secret ids never reach the logs.
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const line = accessLogLine({ method: req.method, path: req.path, route: req.route?.path, status: res.statusCode, ms: Date.now() - t0 });
    if (line) console.log(line);
  });
  next();
});
for (const r of routes) {
  const register = r.method === 'GET' ? app.get.bind(app) : app.post.bind(app);
  register(r.path, async (req, res, next) => {
    try {
      const out = await r.handler({ ip: req.ip, params: req.params as Record<string, string>, body: req.body, headers: req.headers as Record<string, string | undefined> });
      res.status(out.status).json(out.body);
    } catch (e) {
      next(e); // handlers already turn their own errors into responses; this is the last safety net
    }
  });
}
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) app.use(express.static(webDist)); // production: `npm run build` first
app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found' } }));
app.use(jsonErrorHandler((m, e) => console.error(m, e))); // must come last

const server = app.listen(cfg.port, () => console.log(`SpendX API listening on http://localhost:${cfg.port} (storage: ${cfg.repository})`));

// Background checks: payments move forward even when nobody has the page open.
const reconciler = cfg.reconcileIntervalSeconds > 0
  ? startReconciler({
      intervalMs: cfg.reconcileIntervalSeconds * 1000,
      log: (m, e) => console.error(m, e),
      run: async () => {
        const r = await service.reconcile();
        if (r.failed > 0) console.warn(`Reconcile: ${r.failed} of ${r.checked} checks failed`);
      },
    })
  : undefined;
console.log(reconciler ? `Reconciler on: every ${cfg.reconcileIntervalSeconds}s` : 'Reconciler off (RECONCILE_INTERVAL_SECONDS=0)');

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  reconciler?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref(); // do not hang forever on open connections
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('Unhandled rejection', e));
process.on('uncaughtException', (e) => { console.error('Uncaught exception', e); process.exit(1); });
