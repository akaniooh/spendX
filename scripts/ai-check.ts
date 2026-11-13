// Usage: npm run ai:check
// Tests your configured AI provider in steps, so you can see exactly where it stops working:
//   1. can we reach the provider and list models?   2. does a plain one-word reply work (and how fast)?
//   3. does the real assistant call (with the swap tool) work?
import { loadConfig } from '../server/src/config.ts';
import { createAssistant } from '../server/src/assistant.ts';

let cfg;
try {
  cfg = loadConfig({ REPOSITORY: 'memory', SESSION_SECRET: 'x'.repeat(32), ...process.env });
} catch (e) {
  console.error(`Config problem: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
if (!cfg.assistant) {
  console.error('No assistant configured: set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env (and restart if the server is running).');
  process.exit(1);
}
const a = cfg.assistant;
console.log(`Provider: ${a.provider}   Model: ${a.model}${a.baseUrl ? `   Base URL: ${a.baseUrl}` : ''}${a.reasoningEffort ? `   reasoning_effort: ${a.reasoningEffort}` : ''}   timeout: ${a.timeoutMs / 1000}s`);
console.log(`Key: ${a.apiKey.slice(0, 7)}...${a.apiKey.slice(-4)} (${a.apiKey.length} characters)`);
if (a.fallback) {
  const fb = a.fallback;
  console.log(`Fallback: ${fb.provider}   Model: ${fb.model}${fb.baseUrl ? `   Base URL: ${fb.baseUrl}` : ''}${fb.reasoningEffort ? `   reasoning_effort: ${fb.reasoningEffort}` : ''}   Key: ${fb.apiKey.slice(0, 7)}...${fb.apiKey.slice(-4)}`);
} else {
  console.log('Fallback: none (set AI_FALLBACK_PROVIDER and AI_FALLBACK_API_KEY to add one)');
}
console.log('');

const secs = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const clip = (t: string) => t.replace(/\s+/g, ' ').slice(0, 300);
const base = (a.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
const isGemini = a.provider === 'openai' && new URL(base).host === 'generativelanguage.googleapis.com';

// Step 1: reach the provider and list models
{
  const t0 = Date.now();
  try {
    let url: string;
    let headers: Record<string, string>;
    if (a.provider === 'anthropic') { url = 'https://api.anthropic.com/v1/models?limit=50'; headers = { 'x-api-key': a.apiKey, 'anthropic-version': '2023-06-01' }; }
    else if (isGemini) { url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200'; headers = { 'x-goog-api-key': a.apiKey }; }
    else { url = `${base}/models`; headers = { authorization: `Bearer ${a.apiKey}` }; }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    if (!res.ok) {
      console.log(`1. Reach provider: FAILED in ${secs(t0)}: HTTP ${res.status}: ${clip(text)}`);
    } else {
      const j = JSON.parse(text);
      const rows: any[] = j.models ?? j.data ?? [];
      const ids = rows
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => String(m.name ?? m.id).replace(/^models\//, ''))
        .filter((id) => !/embed|image|tts|audio|live|imagen|veo|aqa|robotics/i.test(id));
      console.log(`1. Reach provider: OK in ${secs(t0)}. Your key can use ${ids.length} text models. ${ids.includes(a.model) ? `"${a.model}" is on the list.` : `NOTE: "${a.model}" is NOT on the list.`}`);
      console.log(`   Models: ${ids.slice(0, 40).join(', ')}${ids.length > 40 ? ', ...' : ''}`);
    }
  } catch (e) {
    console.log(`1. Reach provider: FAILED after ${secs(t0)}: ${e instanceof Error ? `${e.name}: ${e.message}` : e}  (network, VPN or firewall?)`);
  }
}

// Step 2: plain reply, no tools
if (a.provider === 'openai') {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${a.apiKey}` },
      body: JSON.stringify({ model: a.model, max_completion_tokens: 600, ...(a.reasoningEffort ? { reasoning_effort: a.reasoningEffort } : {}), messages: [{ role: 'user', content: 'Reply with the single word OK.' }] }),
      signal: AbortSignal.timeout(a.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) console.log(`2. Plain reply:    FAILED in ${secs(t0)}: HTTP ${res.status}: ${clip(text)}`);
    else console.log(`2. Plain reply:    OK in ${secs(t0)}: "${clip(String(JSON.parse(text)?.choices?.[0]?.message?.content ?? ''))}"`);
  } catch (e) {
    console.log(`2. Plain reply:    FAILED after ${secs(t0)}: ${e instanceof Error ? `${e.name}: ${e.message}` : e}  (the model is not answering: overloaded, or too slow at this thinking level)`);
  }
}

// Step 3: the real assistant call, on the main provider alone (so a working fallback cannot hide a broken main one)
const tokens = [
  { assetId: 'sol', blockchain: 'sol', symbol: 'SOL', decimals: 9 },
  { assetId: 'base-usdc', blockchain: 'base', symbol: 'USDC', decimals: 6 },
];
async function realCall(label: string, settings: Parameters<typeof createAssistant>[0]): Promise<boolean> {
  const t0 = Date.now();
  try {
    const r = await createAssistant({ ...settings, retryDelayMs: 500, log: (l) => console.log(`   ${l}`), catalog: { get: async () => tokens } }).interpret('10 SOL to USDC on base');
    console.log(`${label} OK in ${secs(t0)}. Result: ${JSON.stringify(r.swap ?? r)}`);
    return true;
  } catch {
    console.log(`${label} FAILED after ${secs(t0)}.`);
    return false;
  }
}

const { fallback, ...mainOnly } = a;
const mainOk = await realCall('3. Main assistant call:    ', mainOnly);
let fallbackOk = true;
if (fallback) {
  // Step 4: the fallback on its own, with the same shared timeout
  fallbackOk = await realCall('4. Fallback assistant call:', { ...fallback, timeoutMs: a.timeoutMs });
  console.log(mainOk && fallbackOk
    ? '\nBoth work. If the main provider ever fails, SpendX switches to the fallback automatically.'
    : mainOk ? '\nThe main provider works but the fallback does not: fix the fallback settings, or it cannot protect you.'
    : fallbackOk ? '\nThe main provider failed but the fallback works: SpendX would use the fallback right now.' : '\nNeither works.');
}
process.exit(mainOk || fallbackOk ? 0 : 1);
