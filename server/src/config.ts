export interface Config {
  port: number;
  oneClickBaseUrl: string;
  oneClickApiKey?: string;
  slippageBps: number;
  deadlineMinutes: number;
  sessionSecret: string;
  repository: 'supabase' | 'memory';
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  solanaRpcUrl: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  openaiApiKey?: string;
  openaiModel: string;
  /** the assistant to start, or undefined when no key is configured (the assistant is then switched off) */
  assistant?: {
    provider: 'anthropic' | 'openai'; apiKey: string; model: string; baseUrl?: string; reasoningEffort?: string; timeoutMs: number;
    /** a second provider used when the first cannot answer */
    fallback?: { provider: 'anthropic' | 'openai'; apiKey: string; model: string; baseUrl?: string; reasoningEffort?: string };
  };
  /** number of reverse-proxy hops in front of the server (hosting platforms set this up); 0 = none */
  trustProxy: number;
  /** public origin of the web app, shown in the wallet sign-in message (e.g. https://spendx.example) */
  publicOrigin: string;
  /** seconds between background checks of open payments; 0 = off */
  reconcileIntervalSeconds: number;
  /** enforce the full content-security-policy (default: report only, so nothing breaks while you check the browser console) */
  cspEnforce: boolean;
  /** things that work but are probably a mistake in production; printed at startup */
  warnings: string[];
}

export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';

export function loadConfig(env: Record<string, string | undefined>): Config {
  const num = (k: string, d: number, min: number, max: number) => {
    const v = env[k] === undefined || env[k] === '' ? d : Number(env[k]);
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${k} must be a number between ${min} and ${max}`);
    return v;
  };
  /** The key is only ever sent to an https endpoint (or localhost). */
  const checkBaseUrl = (name: string, value: string | undefined): string | undefined => {
    if (!value) return undefined;
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) throw new Error('scheme');
      return value.replace(/\/+$/, '');
    } catch {
      throw new Error(`${name} must be an https URL such as https://api.openai.com/v1 (http is only allowed for localhost)`);
    }
  };
  const secret = env.SESSION_SECRET ?? '';
  if (secret.length < 32) throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters (see .env.example)');

  const repository = (env.REPOSITORY ?? 'supabase') as Config['repository'];
  if (repository !== 'supabase' && repository !== 'memory') throw new Error('REPOSITORY must be "supabase" or "memory"');
  if (repository === 'memory' && env.NODE_ENV === 'production') throw new Error('REPOSITORY=memory is for local development only');
  if (repository === 'supabase' && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or set REPOSITORY=memory for local development)');
  }
  let publicOrigin = env.PUBLIC_ORIGIN || '';
  if (!publicOrigin && env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_ORIGIN is required in production: the https address people open SpendX at, e.g. https://spendx.example');
  }
  publicOrigin = publicOrigin || 'http://localhost:5173'; // the Vite dev server from the README; production must set PUBLIC_ORIGIN
  try {
    const u = new URL(publicOrigin);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) throw new Error('scheme');
    publicOrigin = u.origin;
  } catch {
    throw new Error('PUBLIC_ORIGIN must be an https URL such as https://spendx.example (http is only allowed for localhost)');
  }
  // Assistant provider: AI_PROVIDER picks one explicitly; otherwise whichever key is set (Anthropic if both).
  const anthropicApiKey = env.ANTHROPIC_API_KEY || undefined;
  const openaiApiKey = env.OPENAI_API_KEY || undefined;
  const anthropicModel = env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
  const openaiModel = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const wanted = env.AI_PROVIDER || undefined;
  if (wanted !== undefined && wanted !== 'anthropic' && wanted !== 'openai') throw new Error('AI_PROVIDER must be "anthropic" or "openai"');
  if (wanted === 'anthropic' && !anthropicApiKey) throw new Error('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
  if (wanted === 'openai' && !openaiApiKey) throw new Error('AI_PROVIDER=openai needs OPENAI_API_KEY');
  const provider = wanted ?? (anthropicApiKey ? 'anthropic' : openaiApiKey ? 'openai' : undefined);
  const timeoutMs = num('AI_TIMEOUT_MS', 20_000, 5_000, 120_000);
  let assistant: Config['assistant'];
  if (provider === 'anthropic') assistant = { provider, apiKey: anthropicApiKey!, model: anthropicModel, timeoutMs };
  if (provider === 'openai') {
    const baseUrl = checkBaseUrl('OPENAI_BASE_URL', env.OPENAI_BASE_URL);
    // The default model only takes tool calls on Chat Completions with reasoning effort "none". Any other model:
    // send reasoning_effort only if you set OPENAI_REASONING_EFFORT (an empty value turns it off).
    const reasoningEffort = env.OPENAI_REASONING_EFFORT !== undefined ? env.OPENAI_REASONING_EFFORT || undefined : openaiModel === DEFAULT_OPENAI_MODEL ? 'none' : undefined;
    assistant = { provider, apiKey: openaiApiKey!, model: openaiModel, baseUrl, reasoningEffort, timeoutMs };
  }
  // Optional second provider, used when the first cannot answer (down, overloaded, out of credit).
  const fbProvider = env.AI_FALLBACK_PROVIDER || undefined;
  if (fbProvider !== undefined) {
    if (fbProvider !== 'anthropic' && fbProvider !== 'openai') throw new Error('AI_FALLBACK_PROVIDER must be "anthropic" or "openai"');
    if (!assistant) throw new Error('AI_FALLBACK_PROVIDER needs a main assistant too: set ANTHROPIC_API_KEY or OPENAI_API_KEY first');
    if (!env.AI_FALLBACK_API_KEY) throw new Error('AI_FALLBACK_PROVIDER needs AI_FALLBACK_API_KEY');
    const model = env.AI_FALLBACK_MODEL || (fbProvider === 'openai' ? DEFAULT_OPENAI_MODEL : 'claude-haiku-5-5');
    const baseUrl = fbProvider === 'openai' ? checkBaseUrl('AI_FALLBACK_BASE_URL', env.AI_FALLBACK_BASE_URL) : undefined;
    const reasoningEffort = fbProvider !== 'openai' ? undefined
      : env.AI_FALLBACK_REASONING_EFFORT !== undefined ? env.AI_FALLBACK_REASONING_EFFORT || undefined
      : model === DEFAULT_OPENAI_MODEL ? 'none' : undefined;
    assistant.fallback = { provider: fbProvider, apiKey: env.AI_FALLBACK_API_KEY, model, baseUrl, reasoningEffort };
  }
  const reconcileIntervalSeconds = num('RECONCILE_INTERVAL_SECONDS', 20, 0, 3600);
  if (reconcileIntervalSeconds > 0 && reconcileIntervalSeconds < 5) throw new Error('RECONCILE_INTERVAL_SECONDS must be 0 (off) or at least 5');
  const trustProxy = num('TRUST_PROXY', 0, 0, 5);
  const warnings: string[] = [];
  if (env.NODE_ENV === 'production' && trustProxy === 0) {
    warnings.push('TRUST_PROXY is 0. Behind a hosting proxy every visitor then looks like the same address, so one visitor can use up everyone\'s rate limit. Set TRUST_PROXY=1 if a proxy sits in front of this server.');
  }
  return {
    port: num('PORT', 8787, 1, 65535),
    oneClickBaseUrl: env.ONECLICK_BASE_URL || 'https://1click.chaindefuser.com',
    oneClickApiKey: env.ONECLICK_API_KEY || undefined,
    slippageBps: num('SLIPPAGE_BPS', 100, 1, 1000),
    deadlineMinutes: num('QUOTE_DEADLINE_MINUTES', 10, 3, 60),
    sessionSecret: secret,
    repository,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    solanaRpcUrl: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    anthropicApiKey,
    anthropicModel,
    openaiApiKey,
    openaiModel,
    assistant,
    trustProxy,
    publicOrigin,
    reconcileIntervalSeconds,
    cspEnforce: env.CSP_ENFORCE === '1' || env.CSP_ENFORCE === 'true',
    warnings,
  };
}
