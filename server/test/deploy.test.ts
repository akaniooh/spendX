import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDatabase } from '../src/db-check.ts';
import type { DbLike } from '../src/db-check.ts';
import { loadConfig } from '../src/config.ts';

function fakeDb(missing: Record<string, string> = {}, throws = false): DbLike {
  return {
    from: (table) => ({
      select: (cols) => ({
        limit: async () => {
          if (throws) throw new Error('fetch failed');
          const m = missing[`${table}.${cols}`] ?? missing[table];
          return { error: m ? { message: m } : null };
        },
      }),
    }),
  };
}

test('database check passes on a complete schema', async () => {
  assert.deepEqual(await checkDatabase(fakeDb()), { ok: true, problems: [] });
});

test('database check names the exact problem and the fix: missing tables, outdated columns, unreachable database', async () => {
  const noTables = await checkDatabase(fakeDb({ payment_requests: 'relation "payment_requests" does not exist', payment_attempts: 'relation "payment_attempts" does not exist' }));
  assert.equal(noTables.ok, false);
  assert.match(noTables.problems.join('\n'), /payment_requests.*does not exist.*0001_init\.sql/s);
  assert.match(noTables.problems.join('\n'), /payment_attempts/);

  const old = await checkDatabase(fakeDb({ 'payment_requests.kind': 'column payment_requests.kind does not exist' }));
  assert.equal(old.ok, false);
  assert.equal(old.problems.length, 1);
  assert.match(old.problems[0], /older schema/);

  const down = await checkDatabase(fakeDb({}, true));
  assert.equal(down.ok, false);
  assert.match(down.problems[0], /could not reach the database \(fetch failed\)/);
});

test('hosting config: production refuses in-memory storage; proxy hops are bounded', () => {
  const base = { SESSION_SECRET: 'z'.repeat(32), SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  assert.equal(loadConfig(base).trustProxy, 0);
  assert.equal(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy, 1);
  assert.throws(() => loadConfig({ ...base, TRUST_PROXY: '99' }), /TRUST_PROXY/);
  assert.throws(() => loadConfig({ SESSION_SECRET: base.SESSION_SECRET, REPOSITORY: 'memory', NODE_ENV: 'production' }), /development only/);
  assert.equal(loadConfig({ ...base, ANTHROPIC_API_KEY: 'sk' }).anthropicApiKey, 'sk');
  assert.equal(loadConfig(base).anthropicApiKey, undefined);
});

test('hosting config: PUBLIC_ORIGIN is required in production and must be https (localhost excepted)', () => {
  const base = { SESSION_SECRET: 'z'.repeat(32), SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  assert.equal(loadConfig(base).publicOrigin, 'http://localhost:5173');
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), /PUBLIC_ORIGIN is required/);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://spendx.example/' }).publicOrigin, 'https://spendx.example');
  assert.throws(() => loadConfig({ ...base, PUBLIC_ORIGIN: 'http://spendx.example' }), /https/);
  assert.throws(() => loadConfig({ ...base, PUBLIC_ORIGIN: 'not a url' }), /PUBLIC_ORIGIN/);
});

test('assistant provider config: key presence and AI_PROVIDER pick the provider; bad combinations fail loudly', () => {
  const base = { SESSION_SECRET: 'z'.repeat(32), SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  assert.equal(loadConfig(base).assistant, undefined);
  assert.deepEqual(loadConfig({ ...base, ANTHROPIC_API_KEY: 'a' }).assistant, { provider: 'anthropic', apiKey: 'a', model: 'claude-haiku-5-5', timeoutMs: 20000 });
  const oai = loadConfig({ ...base, OPENAI_API_KEY: 'o' }).assistant!;
  assert.deepEqual([oai.provider, oai.apiKey, oai.model, oai.reasoningEffort, oai.baseUrl], ['openai', 'o', 'gpt-6-luna', 'none', undefined]);
  assert.equal(loadConfig({ ...base, ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }).assistant!.provider, 'anthropic'); // both: Anthropic by default
  assert.equal(loadConfig({ ...base, ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', AI_PROVIDER: 'openai' }).assistant!.provider, 'openai');
  assert.throws(() => loadConfig({ ...base, AI_PROVIDER: 'openai' }), /OPENAI_API_KEY/);
  assert.throws(() => loadConfig({ ...base, AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'o' }), /ANTHROPIC_API_KEY/);
  assert.throws(() => loadConfig({ ...base, AI_PROVIDER: 'gemini' }), /AI_PROVIDER/);
  assert.equal(loadConfig({ ...base, OPENAI_API_KEY: 'o', AI_TIMEOUT_MS: '60000' }).assistant!.timeoutMs, 60000);
  // reasoning effort: only the default model gets "none" automatically; an explicit value (or empty = off) always wins
  assert.equal(loadConfig({ ...base, OPENAI_API_KEY: 'o', OPENAI_MODEL: 'gpt-x' }).assistant!.reasoningEffort, undefined);
  assert.equal(loadConfig({ ...base, OPENAI_API_KEY: 'o', OPENAI_MODEL: 'gpt-x', OPENAI_REASONING_EFFORT: 'low' }).assistant!.reasoningEffort, 'low');
  assert.equal(loadConfig({ ...base, OPENAI_API_KEY: 'o', OPENAI_REASONING_EFFORT: '' }).assistant!.reasoningEffort, undefined);
  // the key is only ever sent to https (or localhost) endpoints
  assert.equal(loadConfig({ ...base, OPENAI_API_KEY: 'o', OPENAI_BASE_URL: 'http://localhost:11434/v1/' }).assistant!.baseUrl, 'http://localhost:11434/v1');
  assert.throws(() => loadConfig({ ...base, OPENAI_API_KEY: 'o', OPENAI_BASE_URL: 'http://evil.example/v1' }), /OPENAI_BASE_URL/);
});

test('config: reconciler interval and production warnings', () => {
  const base = { SESSION_SECRET: 'z'.repeat(32), SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  assert.equal(loadConfig(base).reconcileIntervalSeconds, 20);
  assert.equal(loadConfig({ ...base, RECONCILE_INTERVAL_SECONDS: '0' }).reconcileIntervalSeconds, 0);
  assert.throws(() => loadConfig({ ...base, RECONCILE_INTERVAL_SECONDS: '2' }), /RECONCILE_INTERVAL_SECONDS/);
  assert.equal(loadConfig(base).cspEnforce, false);
  assert.equal(loadConfig({ ...base, CSP_ENFORCE: '1' }).cspEnforce, true);
  const prod = { ...base, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://spendx.example' };
  assert.match(loadConfig(prod).warnings[0], /TRUST_PROXY/);
  assert.deepEqual(loadConfig({ ...prod, TRUST_PROXY: '1' }).warnings, []);
  assert.deepEqual(loadConfig(base).warnings, [], 'no warning in development');
});

test('assistant fallback config: optional, explicit, and validated', () => {
  const base = { SESSION_SECRET: 'z'.repeat(32), SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  // the real-world setup: Gemini as the main provider (through the OpenAI-compatible settings), OpenAI as the fallback
  const cfg = loadConfig({
    ...base, OPENAI_API_KEY: 'gem', OPENAI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', OPENAI_MODEL: 'gemini-3.1-flash-lite', OPENAI_REASONING_EFFORT: 'low',
    AI_FALLBACK_PROVIDER: 'openai', AI_FALLBACK_API_KEY: 'sk-real',
  }).assistant!;
  assert.deepEqual([cfg.provider, cfg.apiKey, cfg.model], ['openai', 'gem', 'gemini-3.1-flash-lite']);
  assert.deepEqual(cfg.fallback, { provider: 'openai', apiKey: 'sk-real', model: 'gpt-6-luna', baseUrl: undefined, reasoningEffort: 'none' });
  assert.equal(loadConfig({ ...base, ANTHROPIC_API_KEY: 'a' }).assistant!.fallback, undefined, 'no fallback unless asked for');

  const withFb = (o: Record<string, string>) => loadConfig({ ...base, ANTHROPIC_API_KEY: 'a', ...o }).assistant!.fallback!;
  assert.deepEqual(withFb({ AI_FALLBACK_PROVIDER: 'anthropic', AI_FALLBACK_API_KEY: 'c' }), { provider: 'anthropic', apiKey: 'c', model: 'claude-haiku-5-5', baseUrl: undefined, reasoningEffort: undefined });
  assert.equal(withFb({ AI_FALLBACK_PROVIDER: 'openai', AI_FALLBACK_API_KEY: 'o', AI_FALLBACK_MODEL: 'gpt-x' }).reasoningEffort, undefined, 'only the default model gets "none" automatically');
  assert.equal(withFb({ AI_FALLBACK_PROVIDER: 'openai', AI_FALLBACK_API_KEY: 'o', AI_FALLBACK_REASONING_EFFORT: 'low' }).reasoningEffort, 'low');
  assert.equal(withFb({ AI_FALLBACK_PROVIDER: 'openai', AI_FALLBACK_API_KEY: 'o', AI_FALLBACK_BASE_URL: 'https://openrouter.ai/api/v1/' }).baseUrl, 'https://openrouter.ai/api/v1');

  assert.throws(() => loadConfig({ ...base, ANTHROPIC_API_KEY: 'a', AI_FALLBACK_PROVIDER: 'openai' }), /AI_FALLBACK_API_KEY/);
  assert.throws(() => loadConfig({ ...base, ANTHROPIC_API_KEY: 'a', AI_FALLBACK_PROVIDER: 'gemini', AI_FALLBACK_API_KEY: 'k' }), /AI_FALLBACK_PROVIDER/);
  assert.throws(() => loadConfig({ ...base, AI_FALLBACK_PROVIDER: 'openai', AI_FALLBACK_API_KEY: 'k' }), /main assistant/);
  assert.throws(() => loadConfig({ ...base, ANTHROPIC_API_KEY: 'a', AI_FALLBACK_PROVIDER: 'openai', AI_FALLBACK_API_KEY: 'k', AI_FALLBACK_BASE_URL: 'http://evil.example/v1' }), /AI_FALLBACK_BASE_URL/);
});
