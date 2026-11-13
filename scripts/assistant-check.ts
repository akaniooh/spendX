// Usage: node --env-file=.env scripts/assistant-check.ts   (or: npm run assistant:check)
// Tells you exactly why the assistant works or not: key, model name, credit. Sends one tiny request. Never prints the key.
export {}; // marks this file as a module (it uses top-level await)

const key = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set in .env. The assistant stays hidden without it.');
  process.exit(1);
}
const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
const safe = (t: string) => t.split(key).join('***');

console.log(`Key: present (${key.length} characters, starts with "${key.slice(0, 7)}...")`);
console.log(`Model: ${model}\n`);

// 1. which models can this key use?
try {
  const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers });
  if (r.ok) {
    const j: any = await r.json();
    const ids: string[] = (j.data ?? []).map((m: any) => m.id);
    console.log(`Models this key can use (${ids.length}):`);
    for (const id of ids) console.log(`  ${id}${id === model ? '   <- your ANTHROPIC_MODEL' : ''}`);
    if (!ids.includes(model)) console.log(`\n"${model}" is NOT in that list. Set ANTHROPIC_MODEL in .env to one of the names above.`);
  } else {
    console.log(`Could not list models (HTTP ${r.status}): ${safe((await r.text()).slice(0, 300))}`);
  }
} catch (e) {
  console.error(`Could not reach api.anthropic.com: ${safe(String((e as Error).message))}`);
  process.exit(1);
}

// 2. a real, tiny request with the configured model
const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST', headers,
  body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }),
});
const body = safe(await r.text());
console.log(`\nTest request with "${model}": HTTP ${r.status}`);
if (r.ok) console.log('OK. The assistant should work. Restart npm start if you changed .env.');
else {
  console.log(body.slice(0, 500));
  console.log(r.status === 401 || r.status === 403 ? '\nThe key was rejected. Create a new key in the Anthropic console and update .env.'
    : r.status === 404 ? '\nThe model name was not found. Pick one from the list above.'
    : /credit|billing/i.test(body) ? '\nThe account has no credit. Add credit in the Anthropic console.' : '');
  process.exit(1);
}
