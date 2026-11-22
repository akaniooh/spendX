// Verify SpendX's fee against the LIVE 1Click API, using DRY quotes only.
// SAFETY: every quote is sent with dry: true. No deposit address is created and no funds can move.
//
// What it answers (these are the points the code relies on and cannot prove offline):
//   1. Does 1Click accept our appFees shape, and does the quote echo it back unchanged?
//   2. How much does the fee really add, for payments (EXACT_OUTPUT) and swaps (EXACT_INPUT)?
//   3. Does that match the model in shared/src/fees.ts (the fee is split 50/50 with 1Click, with or without an API key)?
//
// Usage:
//   FEE_RECIPIENT=yourname.near npm run fee:check -- --pair "base:USDC>arb:USDC" --amount 100 \
//        --addr "evm=0x<any evm address>" [--keep 25] [--input] [--no-key-too]
//
//   --keep N       bps SpendX wants to KEEP (default: PAYMENT_FEE_BPS, or SWAP_FEE_BPS with --input, or 25)
//   --input        measure a swap (exact input) instead of a payment (exact output)
//   --no-key-too   also repeat the measurement without your API key, to compare the two
import { OneClickClient, OneClickError, buildExactInputQuote, buildExactOutputQuote } from '../server/src/oneclick.ts';
import { validateAddress } from '../shared/src/addresses.ts';
import { toBaseUnits } from '../shared/src/amounts.ts';
import { bpsChange, buildAppFees, checkEchoedAppFees, expectedExtraScenarios, matchScenario, ourShareBps, worstCaseTotalBps, feeToSubmit } from '../shared/src/fees.ts';
import { parsePairSpec, resolveToken } from '../shared/src/pairs.ts';
import type { QuoteResponse } from '../shared/src/types.ts';

function flag(name: string): string | undefined {
  const a = process.argv.slice(2);
  const i = a.indexOf(name);
  return i >= 0 ? a[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

const exactInput = has('--input');
const recipientFee = process.env.FEE_RECIPIENT?.trim();
const keep = Number(flag('--keep') ?? (exactInput ? process.env.SWAP_FEE_BPS : process.env.PAYMENT_FEE_BPS) ?? 25) || 25;
const slippageBps = Number(process.env.SLIPPAGE_BPS ?? 100);
const deadlineMinutes = Number(process.env.QUOTE_DEADLINE_MINUTES ?? 10);

async function main() {
  if (!recipientFee) throw new Error('Set FEE_RECIPIENT (your NEAR Intents account, e.g. yourname.near) so there is a fee recipient to test with.');
  const spec = flag('--pair');
  const addrArg = flag('--addr') ?? '';
  if (!spec) throw new Error('Pass --pair "chain:SYM>chain:SYM" (see npm run discover -- --find USDC for real symbols).');
  const amountHuman = flag('--amount') ?? '100';
  const addrByFamily = Object.fromEntries(addrArg.split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string]));

  const keyed = new OneClickClient({ baseUrl: process.env.ONECLICK_BASE_URL, apiKey: process.env.ONECLICK_API_KEY });
  const keyless = new OneClickClient({ baseUrl: process.env.ONECLICK_BASE_URL });
  const tokens = await keyed.getTokens();
  const p = parsePairSpec(spec);
  if (!p) throw new Error('invalid --pair');
  const from = resolveToken(tokens, p.from);
  const to = resolveToken(tokens, p.to);
  if (!from.ok) throw new Error(`source: ${from.error}`);
  if (!to.ok) throw new Error(`destination: ${to.error}`);
  const recipient = addrByFamily[validateAddress(to.token.blockchain, 'x').family];
  const refundTo = addrByFamily[validateAddress(from.token.blockchain, 'x').family];
  if (!recipient || !refundTo) throw new Error('--addr needs an address for both chain families, e.g. evm=0x...,svm=...');

  const sameAsset = from.token.assetId === to.token.assetId;
  const common = { dry: true as const, originAssetId: from.token.assetId, destAssetId: to.token.assetId, recipient, refundTo, slippageBps, deadlineMinutes };
  const amount = exactInput ? toBaseUnits(amountHuman, from.token.decimals) : toBaseUnits(amountHuman, to.token.decimals);
  const build = (fees: ReturnType<typeof buildAppFees>) => exactInput
    ? buildExactInputQuote({ ...common, amountIn: amount, appFees: fees })
    : buildExactOutputQuote({ ...common, amountOut: amount, appFees: fees });
  // the figure that moves when a fee is added: what the payer must send (payments) or what the swapper receives (swaps)
  const figure = (r: QuoteResponse) => BigInt(exactInput ? r.quote.amountOut : r.quote.amountIn);

  console.log(`${spec}  ${exactInput ? `swap: send exactly ${amountHuman} ${from.token.symbol}` : `payment: recipient gets exactly ${amountHuman} ${to.token.symbol}`}`);
  console.log(`SpendX wants to keep ${keep} bps; fee recipient ${recipientFee}\n`);

  const runs: { name: string; client: OneClickClient; hasKey: boolean }[] = [];
  if (process.env.ONECLICK_API_KEY) runs.push({ name: 'WITH your API key', client: keyed, hasKey: true });
  if (!process.env.ONECLICK_API_KEY || has('--no-key-too')) runs.push({ name: 'WITHOUT an API key', client: keyless, hasKey: false });

  const results: { hasKey: boolean; base: bigint; withFee: bigint }[] = [];
  for (const run of runs) {
    console.log(`=== ${run.name} ===`);
    const submit = feeToSubmit(keep, run.hasKey, sameAsset);
    const fees = buildAppFees(recipientFee, keep, run.hasKey, sameAsset);
    try {
      // baseline twice (before and after) so market movement between calls shows up as noise
      const base1 = await run.client.quote(build(undefined));
      const withFee = await run.client.quote(build(fees));
      const base2 = await run.client.quote(build(undefined));
      const echoProblem = checkEchoedAppFees(fees, withFee.quoteRequest.appFees);
      console.log(`  submitted appFees   ${JSON.stringify(fees)}`);
      const echoedOurs = (withFee.quoteRequest.appFees ?? []).find((e) => e.recipient === recipientFee)?.fee;
      const expectedShare = ourShareBps(submit, run.hasKey, sameAsset);
      const echoNote = echoProblem ? `[PROBLEM: ${echoProblem}]`
        : echoedOurs === expectedShare ? `[ok: ${echoedOurs} bps is the share the code expects for ${submit} submitted]`
        : `[SURPRISE: expected ${expectedShare} bps for the ${submit} submitted, got ${echoedOurs}]`;
      console.log(`  echoed by 1Click    ${JSON.stringify(withFee.quoteRequest.appFees ?? null)}  ${echoNote}`);
      console.log(`  signature           ${withFee.signature ? 'present' : 'MISSING'}`);
      const baseMid = (figure(base1) + figure(base2)) / 2n;
      results.push({ hasKey: run.hasKey, base: baseMid, withFee: figure(withFee) });
      const noise = Math.abs(bpsChange(figure(base1), figure(base2)));
      // payments: payer sends MORE when a fee is added. swaps: swapper receives LESS.
      const raw = bpsChange(baseMid, figure(withFee));
      const measured = exactInput ? -raw : raw;
      // All-in cost from 1Click's own USD values. Only meaningful on pairs worth the same in USD (stablecoin to stablecoin).
      // Payments quote a deposit that includes a slippage allowance, so the minimum deposit is used to leave that out.
      const costBps = (r: QuoteResponse) => {
        const inUsd = Number(r.quote.amountInUsd) * (exactInput ? 1 : Number(r.quote.minAmountIn) / Number(r.quote.amountIn));
        const outUsd = Number(r.quote.amountOutUsd);
        return inUsd > 0 && Number.isFinite(outUsd) ? ((inUsd - outUsd) / inUsd) * 10000 : NaN;
      };
      console.log(`  all-in cost (USD)   ${costBps(base1).toFixed(1)} bps without your fee, ${costBps(withFee).toFixed(1)} bps with it  (trust only on same-value pairs, e.g. USDC to USDC)`);
      console.log(`  market noise        ${noise.toFixed(1)} bps between the two no-fee quotes`);
      console.log(`  measured extra cost ${measured.toFixed(1)} bps from adding the fee`);
      const scen = expectedExtraScenarios(keep, run.hasKey, sameAsset);
      for (const s of scen) console.log(`  model expects       ${s.extraBps} bps (${s.label})`);
      const hit = matchScenario(measured, scen, noise + 3);
      console.log(hit
        ? `  RESULT              matches what the code expects (${hit.label}).`
        : `  RESULT              DOES NOT MATCH. Do not rely on shared/src/fees.ts for this route until you know why.`);
      if (!echoProblem && echoedOurs !== undefined && echoedOurs !== expectedShare) {
        console.log(`  SpendX's share      DIFFERENT from the model: the customer pays about ${measured.toFixed(0)} bps extra and 1Click lists ${echoedOurs} bps for your recipient, not ${expectedShare}.`);
        console.log('                      Do not charge customers until this is explained (see README, Revenue).');
      } else if (!echoProblem) {
        console.log('                      This is the share 1Click REPORTS. Confirm it arrives with one small real payment before relying on it.');
      }
      console.log(`  config would allow  up to ${worstCaseTotalBps(submit, run.hasKey, sameAsset)} bps total (SpendX + 1Click) for this setting\n`);
    } catch (e) {
      if (e instanceof OneClickError) console.log(`  NO QUOTE: HTTP ${e.status}: ${e.message}\n`);
      else throw e;
    }
  }

  // What the customer really pays with and without the key. The per-run figures above compare each run with its OWN
  // no-fee quote, so they cannot show whether the key lowers 1Click's base fee; this does.
  const withKey = results.find((r) => r.hasKey);
  const noKey = results.find((r) => !r.hasKey);
  if (withKey && noKey) {
    // payments: the payer sends less with the key = cheaper. swaps: the swapper receives more = cheaper.
    const cheaper = (a: bigint, b: bigint) => (exactInput ? 1 : -1) * bpsChange(b, a);
    const noFee = cheaper(withKey.base, noKey.base);
    const withOurFee = cheaper(withKey.withFee, noKey.withFee);
    const word = (n: number) => (Math.abs(n) < 1 ? 'no different' : n > 0 ? `${n.toFixed(1)} bps CHEAPER for the customer with the key` : `${(-n).toFixed(1)} bps MORE EXPENSIVE for the customer with the key`);
    console.log('=== KEY vs NO KEY: what the customer pays ===');
    console.log(`  with no SpendX fee   ${word(noFee)}`);
    console.log(`  with your fee        ${word(withOurFee)}`);
    console.log('  (two live quotes taken moments apart; differences under ~1 bp are market noise)');
  }
}

main().catch((e) => {
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  console.error(`fee:check failed: ${(e as Error).message}${cause ? ` (${cause.code ?? cause.message})` : ''}`);
  process.exit(1);
});
