// Read an account's balance inside NEAR Intents (the intents.near contract). READ ONLY: it signs and sends nothing.
//
// Why this exists: SpendX's fee is paid into the FEE_RECIPIENT account's balance INSIDE the NEAR Intents contract,
// in the token the customer sent. It is not a normal token in a wallet, so wallets and explorers usually do not show it.
//
// Usage:
//   npm run fee:balance -- --account yourname.near --token nep141:sol.omft.near [--token ...] [--decimals 9]
//   npm run fee:balance -- --account yourname.near --all      (lists EVERY token the account holds, to find fees that landed somewhere unexpected)
//   (--account defaults to FEE_RECIPIENT; --token defaults to native SOL; get asset ids with: npm run discover -- --find SOL)
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));

const account = flag('--account') ?? process.env.FEE_RECIPIENT;
const all = argv.includes('--all');
const tokens = many('--token');
if (tokens.length === 0 && !all) tokens.push('nep141:sol.omft.near');
const decimals = flag('--decimals') === undefined ? undefined : Number(flag('--decimals'));
const rpcs = flag('--rpc') ? [flag('--rpc') as string] : ['https://rpc.fastnear.com', 'https://rpc.mainnet.near.org'];

function human(raw: string, d: number): string {
  const s = raw.padStart(d + 1, '0');
  return `${s.slice(0, s.length - d)}.${s.slice(s.length - d)}`.replace(/\.?0+$/, '') || '0';
}

async function view(rpc: string, method: string, callArgs: unknown): Promise<unknown> {
  const args = Buffer.from(JSON.stringify(callArgs)).toString('base64');
  const res = await fetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: 'intents.near', method_name: method, args_base64: args } }),
  });
  const j = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { message?: string; data?: unknown } };
  if (j.error) throw new Error(`${j.error.message ?? 'RPC error'} ${typeof j.error.data === 'string' ? j.error.data : ''}`.trim());
  if (j.result?.error) throw new Error(j.result.error);
  if (!j.result?.result) throw new Error('unexpected RPC reply');
  return JSON.parse(Buffer.from(j.result.result).toString('utf8')) as unknown;
}

async function balances(rpc: string): Promise<string[]> {
  if (all) {
    // NEP-245: every token this account holds, then the balance of each
    const owned = await view(rpc, 'mt_tokens_for_owner', { account_id: account, from_index: '0', limit: 100 });
    if (!Array.isArray(owned)) throw new Error('unexpected token list reply');
    tokens.splice(0, tokens.length, ...owned.map((t) => String((t as { token_id?: string }).token_id ?? t)));
    if (tokens.length === 0) return [];
    if (owned.length >= 100) console.error('  (showing the first 100 tokens only)');
  }
  const out = await view(rpc, 'mt_batch_balance_of', { account_id: account, token_ids: tokens });
  if (!Array.isArray(out) || out.length !== tokens.length) throw new Error('unexpected balance reply');
  return out.map(String);
}

async function main() {
  if (!account) throw new Error('Pass --account yourname.near (or set FEE_RECIPIENT).');
  let last: unknown;
  for (const rpc of rpcs) {
    try {
      const out = await balances(rpc);
      console.log(`NEAR Intents balance of ${account} (read from ${new URL(rpc).host})\n`);
      if (all && tokens.length === 0) console.log('  This account holds no tokens inside NEAR Intents.');
      tokens.forEach((t, i) => console.log(`  ${t}\n    raw units: ${out[i]}${decimals === undefined ? '' : `   =  ${human(out[i], decimals)}`}`));
      console.log('\nA balance of 0 means nothing has been credited to this account for that token (yet).');
      return;
    } catch (e) { last = e; console.error(`  ${new URL(rpc).host}: ${(e as Error).message}`); }
  }
  throw last;
}
main().catch((e) => { console.error(`fee:balance failed: ${(e as Error).message}`); process.exit(1); });
