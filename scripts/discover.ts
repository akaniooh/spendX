// Phase 0 discovery: list the live NEAR Intents catalog and try DRY quotes for chosen pairs.
// SAFETY: every quote below is sent with dry: true. No deposit address is created and no funds can move.
//
// Usage (see README):
//   npm run discover                                   # catalog summary
//   npm run discover -- --find USDC                    # list matching assets with their real assetIds
//   npm run discover -- --chain sol                    # list every asset on one chain
//   npm run discover -- --pair "sol:SOL>base:USDC" --amount 1 \
//        --addr "svm=<solana address>,evm=<0x address>"
import { OneClickClient, OneClickError, buildExactInputQuote, buildExactOutputQuote } from '../server/src/oneclick.ts';
import { groupByChain } from '../server/src/catalog.ts';
import { validateAddress } from '../shared/src/addresses.ts';
import { fromBaseUnits, toBaseUnits } from '../shared/src/amounts.ts';
import { parsePairSpec, resolveToken } from '../shared/src/pairs.ts';
import type { Token } from '../shared/src/types.ts';

function flagValues(name: string): string[] {
  const out: string[] = [];
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) if (a[i] === name && a[i + 1] !== undefined) out.push(a[++i]);
  return out;
}

const client = new OneClickClient({
  baseUrl: process.env.ONECLICK_BASE_URL,
  apiKey: process.env.ONECLICK_API_KEY,
});
const slippageBps = Number(process.env.SLIPPAGE_BPS ?? 100);
const deadlineMinutes = Number(process.env.QUOTE_DEADLINE_MINUTES ?? 10);

let ALL: Token[] = [];

function fmtToken(t: Token): string {
  const dup = ALL.filter((x) => x.blockchain === t.blockchain && x.symbol.toLowerCase() === t.symbol.toLowerCase()).length > 1;
  const contract = t.contractAddress ? `\n${' '.repeat(24)}contract: ${t.contractAddress}` : '';
  return `${t.blockchain.padEnd(9)} ${t.symbol.padEnd(10)} dec=${String(t.decimals).padEnd(2)} ${t.assetId}${dup ? '  [!] DUPLICATE SYMBOL on this chain' : ''}${contract}`;
}

async function main() {
  const tokens = await client.getTokens();
  ALL = tokens;
  console.log(`Live catalog: ${tokens.length} assets on ${new Set(tokens.map((t) => t.blockchain)).size} chains\n`);

  const finds = flagValues('--find');
  const pairs = flagValues('--pair');
  const chains = flagValues('--chain');

  if (finds.length === 0 && pairs.length === 0 && chains.length === 0) {
    for (const g of groupByChain(tokens)) console.log(`${g.blockchain.padEnd(10)} ${String(g.tokens.length).padStart(4)} assets  wallet family: ${g.family}`);
    console.log('\nTip: --find SYMBOL to see real assetIds, --pair "chain:SYM>chain:SYM" to try a dry quote.');
    return;
  }

  for (const f of finds) {
    const hits = tokens.filter((t) => t.symbol.toLowerCase() === f.toLowerCase());
    console.log(`Assets with symbol ${f}: ${hits.length}`);
    for (const t of hits) console.log('  ' + fmtToken(t));
    console.log();
  }

  for (const c of chains) {
    const hits = tokens.filter((t) => t.blockchain.toLowerCase() === c.toLowerCase());
    console.log(`Assets on chain ${c}: ${hits.length}`);
    for (const t of hits) console.log('  ' + fmtToken(t));
    console.log();
  }

  if (pairs.length === 0) return;

  const addrArg = flagValues('--addr')[0] ?? '';
  const addrByFamily = Object.fromEntries(addrArg.split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string]));
  const amountHuman = flagValues('--amount')[0] ?? '1';
  // --input: the amount is what you SEND (swap: "10 SOL to ..."). Default: the amount the recipient must RECEIVE (payment).
  const exactInput = process.argv.includes('--input');

  for (const spec of pairs) {
    console.log(`--- ${spec}  (${exactInput ? `send exactly ${amountHuman} of the source token` : `recipient receives exactly ${amountHuman} of the destination token`})`);
    const p = parsePairSpec(spec);
    if (!p) { console.log('  invalid pair spec\n'); continue; }
    const from = resolveToken(tokens, p.from);
    const to = resolveToken(tokens, p.to);
    if (!from.ok) { console.log(`  source: ${from.error}`); from.candidates?.forEach((t) => console.log('    ' + fmtToken(t))); console.log(); continue; }
    if (!to.ok) { console.log(`  destination: ${to.error}`); to.candidates?.forEach((t) => console.log('    ' + fmtToken(t))); console.log(); continue; }

    const recipient = addrByFamily[validateAddress(to.token.blockchain, 'x').family];
    const refundTo = addrByFamily[validateAddress(from.token.blockchain, 'x').family];
    if (!recipient || !refundTo) { console.log('  need --addr with an address for both chain families (e.g. svm=...,evm=...)\n'); continue; }
    const rc = validateAddress(to.token.blockchain, recipient);
    const fc = validateAddress(from.token.blockchain, refundTo);
    if (rc.status === 'invalid') { console.log(`  recipient invalid: ${rc.reason}\n`); continue; }
    if (fc.status === 'invalid') { console.log(`  refund address invalid: ${fc.reason}\n`); continue; }

    try {
      const common = {
        dry: true as const, // hard-coded on purpose
        originAssetId: from.token.assetId,
        destAssetId: to.token.assetId,
        recipient, refundTo, slippageBps, deadlineMinutes,
      };
      const body = exactInput
        ? buildExactInputQuote({ ...common, amountIn: toBaseUnits(amountHuman, from.token.decimals) })
        : buildExactOutputQuote({ ...common, amountOut: toBaseUnits(amountHuman, to.token.decimals) });
      const r = await client.quote(body);
      const q = r.quote;
      const costUsd = Number(q.amountInUsd) - Number(q.amountOutUsd);
      console.log(`  ROUTE AVAILABLE`);
      console.log(`  you send    ${q.amountInFormatted} ${from.token.symbol} (~$${q.amountInUsd}), minimum ${q.minAmountIn} base units`);
      console.log(`  ${exactInput ? 'you get     ' : 'merchant gets'} ${q.amountOutFormatted} ${to.token.symbol} (~$${q.amountOutUsd})`);
      if (exactInput) {
        let min = q.minAmountOut;
        try { min = fromBaseUnits(BigInt(q.minAmountOut), to.token.decimals); } catch { /* keep raw */ }
        console.log(`  guaranteed minimum ${min} ${to.token.symbol} (slippage ${slippageBps / 100}%)`);
      }
      console.log(`  est. cost   ~$${costUsd.toFixed(4)} (spread + fees, from the quote's USD values)`);
      console.log(`  est. time   ${q.timeEstimate}s after deposit confirms; refundFee=${q.refundFee ?? 'n/a'} withdrawFee=${q.withdrawFee ?? 'n/a'}`);
      console.log(`  signature   ${r.signature ? 'present' : 'MISSING'}\n`);
    } catch (e) {
      if (e instanceof OneClickError) console.log(`  NO QUOTE: HTTP ${e.status}: ${e.message}\n`);
      else console.log(`  ERROR: ${(e as Error).message}\n`);
    }
  }
}

main().catch((e) => {
  if (e instanceof OneClickError) console.error(`1Click error ${e.status}: ${e.message}`);
  else {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    console.error(`Request failed: ${(e as Error).message}${cause ? ` (${cause.code ?? cause.message})` : ''}`);
    console.error('Check your network connection and ONECLICK_BASE_URL.');
  }
  process.exit(1);
});
