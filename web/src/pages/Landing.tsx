import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { formatDuration, formatUsd } from '../lib/labels.ts';
import { chainLabel } from '../lib/labels.ts';
import { estimateAddress, formatRate } from '../lib/estimate.ts';
import { catalogStats, pickSampleRoute } from '../lib/landing.ts';
import type { CatalogChain, SwapPreview } from '../lib/types.ts';
import { ChainIcon, Icon, Skeleton, TokenIcon } from '../components/Icon.tsx';
import '../landing.css';

/** A REAL quote for a sample pair, refreshed every 30 seconds. Nothing here is mocked: if no quote is available the card is hidden. */
function LiveQuote({ chains }: { chains: CatalogChain[] | null }) {
  const [quote, setQuote] = useState<SwapPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState<Date | null>(null);
  const route = chains ? pickSampleRoute(chains) : null;
  const fromFamily = route ? chains!.find((c) => c.blockchain === route.fromChain)?.family : undefined;
  const toFamily = route ? chains!.find((c) => c.blockchain === route.toChain)?.family : undefined;
  const payer = fromFamily ? estimateAddress(fromFamily) : null;
  const recipient = toFamily ? estimateAddress(toFamily) : null;

  useEffect(() => {
    if (!route || !payer || !recipient) return;
    let off = false;
    const load = () => api.swapPreview({ originAssetId: route.from.assetId, destAssetId: route.to.assetId, amount: '1', payerAddress: payer, recipient, acknowledgeUncheckedAddress: true })
      .then((q) => { if (!off) { setQuote(q); setFailed(false); setAt(new Date()); } })
      .catch(() => { if (!off) setFailed(true); });
    load();
    const t = setInterval(load, 30_000);
    return () => { off = true; clearInterval(t); };
  }, [route?.from.assetId, route?.to.assetId, payer, recipient]);

  if (chains && (!route || (failed && !quote))) return null; // no sample pair, or no quote: show nothing rather than something fake
  const rate = quote && Number(quote.amountInFormatted) > 0 ? Number(quote.estimatedOutFormatted) / Number(quote.amountInFormatted) : null;

  return (
    <div className="lp-quote" aria-label="Live quote">
      <div className="lp-quote-head"><span>Live quote</span><span className="lp-quote-time">{at ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <Skeleton w="48px" />}</span></div>
      <div className="lp-quote-box">
        <span className="lp-label">You send</span>
        <div className="lp-quote-amount">
          <strong>1</strong>
          {route ? <span className="lp-token"><TokenIcon symbol={route.from.symbol} chain={route.fromChain} />{route.from.symbol}<small>on {chainLabel(route.fromChain)}</small></span> : <Skeleton w="110px" h="28px" />}
        </div>
      </div>
      <div className="lp-quote-box">
        <span className="lp-label">You receive about</span>
        <div className="lp-quote-amount">
          {quote ? <strong className="lp-accent">{quote.estimatedOutFormatted}</strong> : <Skeleton w="120px" h="34px" />}
          {route ? <span className="lp-token"><TokenIcon symbol={route.to.symbol} chain={route.toChain} />{route.to.symbol}<small>on {chainLabel(route.toChain)}</small></span> : <Skeleton w="110px" h="28px" />}
        </div>
      </div>
      <dl className="lp-quote-details">
        <div><dt>Rate</dt><dd>{rate !== null && route ? `1 ${route.from.symbol} = ${formatRate(rate)} ${route.to.symbol}` : <Skeleton w="140px" />}</dd></div>
        <div><dt>Estimated cost</dt><dd>{quote ? formatUsd(quote.estimatedCostUsd) : <Skeleton w="60px" />}</dd></div>
        <div><dt>Estimated time</dt><dd>{quote ? formatDuration(quote.timeEstimateSeconds) : <Skeleton w="50px" />}</dd></div>
      </dl>
    </div>
  );
}

const STEPS = [
  { title: 'Choose what you hold and what you want', body: 'Pick any token on any supported network. A live quote shows the amount, the cost and the time before you commit.' },
  { title: 'Approve one transfer', body: 'Your wallet shows a single transaction. SpendX never holds your funds or your keys.' },
  { title: 'Watch it arrive', body: 'SpendX follows the transfer to the other side. On Ethereum-style chains and Solana it checks the destination chain itself before calling it paid. If a swap cannot complete, it is refunded to you.' },
];

export function Landing() {
  const [chains, setChains] = useState<CatalogChain[] | null>(null);
  const [assistant, setAssistant] = useState(false);
  useEffect(() => {
    api.catalog().then((c) => setChains(c.chains)).catch(() => setChains([]));
    api.config().then((c) => setAssistant(c.assistant)).catch(() => setAssistant(false));
  }, []);
  const stats = chains && chains.length ? catalogStats(chains) : null;

  return (
    <>
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <h1>Pay on any chain with whatever you hold.</h1>
          <p>Swap across networks or pay a merchant in a single transfer. SpendX converts, bridges and delivers, then confirms the money arrived.</p>
          <div className="lp-actions">
            <a className="lp-primary" href="#/swap">Launch app<Icon name="arrow" /></a>
            <a className="lp-secondary" href="#/merchant">Create a payment link</a>
          </div>
        </div>
        <LiveQuote chains={chains} />
      </section>

      <section className="lp-stats" aria-label="Coverage">
        <div><strong>{stats ? stats.networks : <Skeleton w="48px" h="40px" />}</strong><span>networks</span></div>
        <div><strong>{stats ? stats.tokens : <Skeleton w="64px" h="40px" />}</strong><span>tokens</span></div>
        <div><strong>1</strong><span>transfer from your wallet</span></div>
      </section>

      <section className="lp-section" id="how">
        <h2>How it works</h2>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}><span className="lp-step-n">{i + 1}</span><h3>{s.title}</h3><p>{s.body}</p></li>
          ))}
        </ol>
      </section>

      <section className="lp-section" id="payments">
        <h2>Two ways to use it</h2>
        <div className="lp-features">
          <article>
            <h3>Swap across chains</h3>
            <p>Send 10 SOL and receive USDC on Base, or any other pair in the catalog, delivered to your own address.</p>
            <a className="lp-link" href="#/swap">Open Swap<Icon name="chevron" size={16} /></a>
          </article>
          <article>
            <h3>Payment links</h3>
            <p>Ask for an exact amount on the network you prefer. Your customer pays with whatever they hold, and you follow the status.</p>
            <a className="lp-link" href="#/merchant">Create a link<Icon name="chevron" size={16} /></a>
          </article>
          {assistant && (
            <article>
              <h3>Describe it in a sentence</h3>
              <p>Type "10 SOL to USDC on Base" and SpendX fills in the form. You review it and approve in your own wallet.</p>
              <a className="lp-link" href="#/swap">Try it<Icon name="chevron" size={16} /></a>
            </article>
          )}
        </div>
      </section>

      <section className="lp-section" id="networks">
        <h2>Networks</h2>
        {stats && <p className="lp-lead">{stats.networks} networks and {stats.tokens} tokens, read live from the NEAR Intents catalog. New ones appear automatically.</p>}
        <ul className="lp-chains">
          {chains === null
            ? Array.from({ length: 12 }, (_, i) => <li key={i}><Skeleton w="110px" h="36px" /></li>)
            : chains.map((c) => <li key={c.blockchain}><ChainIcon chain={c.blockchain} small />{chainLabel(c.blockchain)}</li>)}
        </ul>
      </section>

      <section className="lp-built" id="built-on">
        <h2>Built on NEAR Intents</h2>
        <p>Quotes, routing and settlement run on NEAR Intents. SpendX adds the payment layer: exact-amount requests, checks before you pay, and delivery tracking.</p>
        <div className="lp-actions">
          <a className="lp-secondary" href="https://docs.near-intents.org/" target="_blank" rel="noreferrer noopener">NEAR Intents docs<Icon name="external" size={16} /></a>
          <a className="lp-secondary" href="https://explorer.near-intents.org/" target="_blank" rel="noreferrer noopener">Intents explorer<Icon name="external" size={16} /></a>
        </div>
      </section>

      <section className="lp-final">
        <h2>Move something across chains</h2>
        <a className="lp-primary" href="#/swap">Launch app<Icon name="arrow" /></a>
      </section>
    </>
  );
}
