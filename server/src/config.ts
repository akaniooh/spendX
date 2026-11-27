import { ONECLICK_MAX_TOTAL_BPS, feeToSubmit, isValidFeeRecipient, isValidReferral, ourShareBps, worstCaseTotalBps } from '../../shared/src/fees.ts';
import type { FeeConfig } from '../../shared/src/fees.ts';

export interface Config {
  port: number;
  oneClickBaseUrl: string;
  oneClickApiKey?: string;
  /** SpendX's revenue settings (all off unless FEE_RECIPIENT and a fee are set) */
  fees: FeeConfig;
  /** optional CoinGecko key and base url for chain/token logos (a free demo key works; without one the public rate limit applies) */
  coingeckoApiKey?: string;
  coingeckoBaseUrl?: string;
  slippageBps: number;
  deadlineMinutes: number;
  /** minutes a merchant payment link stays usable */
  linkExpiryMinutes: number;
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
  /** email alerts for merchants; undefined (alerts off) unless EMAIL_API_KEY and EMAIL_FROM are set */
  email?: { provider: 'brevo' | 'resend'; apiKey: string; fromEmail: string; fromName: string };
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

  // Email alerts are optional. Without both values SpendX works the same, minus the alerts.
  let email: Config['email'];
  if (env.EMAIL_API_KEY || env.EMAIL_FROM) {
    if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) throw new Error('Email alerts need both EMAIL_API_KEY and EMAIL_FROM (the address alerts are sent from)');
    const provider = (env.EMAIL_PROVIDER || 'brevo').toLowerCase();
    if (provider !== 'brevo' && provider !== 'resend') throw new Error('EMAIL_PROVIDER must be brevo or resend');
    if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(env.EMAIL_FROM)) throw new Error('EMAIL_FROM must be a plain email address such as alerts@yourdomain.com');
    // the sender name goes into an email header, so strip anything that could break out of it
    const fromName = (env.EMAIL_FROM_NAME || 'SpendX').replace(/[<>"\r\n]/g, '').trim().slice(0, 60) || 'SpendX';
    email = { provider, apiKey: env.EMAIL_API_KEY, fromEmail: env.EMAIL_FROM, fromName };
  }
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
  // ---- revenue: SpendX's own fee on top of NEAR Intents' (1Click `appFees`) ----
  const oneClickApiKey = env.ONECLICK_API_KEY || undefined;
  const hasApiKey = !!oneClickApiKey;
  const feeRecipient = env.FEE_RECIPIENT?.trim() || undefined;
  const bps = (k: string) => {
    const v = num(k, 0, 0, ONECLICK_MAX_TOTAL_BPS);
    if (!Number.isInteger(v)) throw new Error(`${k} must be a whole number of basis points (100 = 1%)`);
    return v;
  };
  const swapBps = bps('SWAP_FEE_BPS');
  const paymentBps = bps('PAYMENT_FEE_BPS');
  if (feeRecipient && !isValidFeeRecipient(feeRecipient)) {
    throw new Error('FEE_RECIPIENT must be a NEAR Intents account (for example spendx.near, a 64-character implicit account, or a 0x address)');
  }
  if ((swapBps > 0 || paymentBps > 0) && !feeRecipient) throw new Error('SWAP_FEE_BPS / PAYMENT_FEE_BPS are set but FEE_RECIPIENT is not: there is nowhere to send the fee');
  const referralRaw = (env.FEE_REFERRAL || '').trim();
  if (referralRaw && !isValidReferral(referralRaw)) throw new Error('FEE_REFERRAL must be lowercase letters and digits, optionally joined by single - _ or . (max 57 characters)');
  const referral = referralRaw || (feeRecipient ? 'spendx' : undefined);
  for (const [name, keep] of [['SWAP_FEE_BPS', swapBps], ['PAYMENT_FEE_BPS', paymentBps]] as const) {
    if (keep <= 0) continue;
    const total = worstCaseTotalBps(feeToSubmit(keep, hasApiKey), hasApiKey);
    if (total > ONECLICK_MAX_TOTAL_BPS) {
      throw new Error(`${name}=${keep} would make the customer's combined fee ${total} bps with 1Click's share, above the ${ONECLICK_MAX_TOTAL_BPS} bps limit. ${hasApiKey ? 'With an API key 1Click takes half of the fee you submit, so the most you can keep is 250.' : 'Without an API key 1Click also takes half and adds 25 bps, so the most you can keep is 237.'}`);
    }
  }

  const warnings: string[] = [];
  if (env.NODE_ENV === 'production' && trustProxy === 0) {
    warnings.push('TRUST_PROXY is 0. Behind a hosting proxy every visitor then looks like the same address, so one visitor can use up everyone\'s rate limit. Set TRUST_PROXY=1 if a proxy sits in front of this server.');
  }
  if (feeRecipient && (swapBps > 0 || paymentBps > 0)) {
    warnings.push(`fees are paid to ${feeRecipient}. Check this is your account: a FEE_RECIPIENT already set in your terminal (for example by an earlier "set FEE_RECIPIENT=...") overrides the .env file.`);
  }
  for (const [name, keep] of [['swap', swapBps], ['payment', paymentBps]] as const) {
    if (keep <= 0) continue;
    const submitted = feeToSubmit(keep, hasApiKey);
    const total = worstCaseTotalBps(submitted, hasApiKey);
    warnings.push(`${name} fee: SpendX keeps ${ourShareBps(submitted, hasApiKey)} bps; customers pay up to ${total} bps in total with 1Click's share (${hasApiKey ? 'API key set: 1Click takes half of the submitted fee, minimum 20 bps' : 'no API key: 1Click was measured taking half of the submitted fee and adds its own 25 bps base'}). Run npm run fee:check to confirm against the live API.`);
  }
  if (feeRecipient && swapBps === 0 && paymentBps === 0) warnings.push('FEE_RECIPIENT is set but SWAP_FEE_BPS and PAYMENT_FEE_BPS are both 0, so no fee is taken.');

  return {
    port: num('PORT', 8787, 1, 65535),
    oneClickBaseUrl: env.ONECLICK_BASE_URL || 'https://1click.chaindefuser.com',
    oneClickApiKey,
    fees: { recipient: feeRecipient, swapBps, paymentBps, referral, hasApiKey },
    coingeckoApiKey: env.COINGECKO_API_KEY || undefined,
    coingeckoBaseUrl: checkBaseUrl('COINGECKO_BASE_URL', env.COINGECKO_BASE_URL),
    slippageBps: num('SLIPPAGE_BPS', 100, 1, 1000),
    deadlineMinutes: num('QUOTE_DEADLINE_MINUTES', 10, 3, 60),
    linkExpiryMinutes: num('LINK_EXPIRY_MINUTES', 30, 1, 10080),
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
    email,
    trustProxy,
    publicOrigin,
    reconcileIntervalSeconds,
    cspEnforce: env.CSP_ENFORCE === '1' || env.CSP_ENFORCE === 'true',
    warnings,
  };
}
