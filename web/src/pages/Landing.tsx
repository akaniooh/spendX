import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../lib/api.ts';
import { chainLabel } from '../lib/labels.ts';
import { catalogStats, scrollToSection } from '../lib/landing.ts';
import type { CatalogChain } from '../lib/types.ts';
import { ChainIcon, Icon, Skeleton, TokenIcon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import '../landing.css';

const idx = (i: number) => ({ '--i': i }) as CSSProperties;

/* ---------- small pieces ---------- */

/** The SpendX logo mark (two overlapping rounded squares), drawn in the dark ink colour for use on the accent background. */
function LogoMark({ scale = 0.85 }: { scale?: number }) {
  return <span className="brand-mark lp-mark" style={{ '--k': scale } as CSSProperties} aria-hidden="true"><i /><b /></span>;
}

function Badge({ children }: { children: string }) {
  return <span className="lp-badge"><i />{children}</span>;
}

function SectionHead({ badge, title, lead, long }: { badge: string; title: string; lead?: string; long?: boolean }) {
  return (
    <div className={long ? 'lp-head lp-head-long lp-reveal' : 'lp-head lp-reveal'}>
      <Badge>{badge}</Badge>
      <h2>{title}</h2>
      {lead && <p>{lead}</p>}
    </div>
  );
}

/** Headline that writes itself in, one word at a time. */
function Words({ text, start = 0 }: { text: string; start?: number }) {
  return <>{text.split(' ').map((w, i) => <span key={i}><span className="lp-word" style={{ '--w': start + i } as CSSProperties}>{w}</span>{' '}</span>)}</>;
}

/** Counts up to its number the first time it scrolls into view. */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(to); return; }
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / 1100);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref}>{n}</span>;
}

function Token({ symbol, chain, chainName }: { symbol: string; chain: string; chainName: string }) {
  return <span className="lp-token"><TokenIcon symbol={symbol} chain={chain} />{symbol}<small>on {chainName}</small></span>;
}

/* ---------- hero demo card ---------- */

interface Leg { amount: string; symbol: string; chain: string; chainName: string }
const DEMO: { tab: string; send: Leg; get: Leg }[] = [
  { tab: 'ETH → TRX', send: { amount: '1,250.00', symbol: 'USDC', chain: 'eth', chainName: 'Ethereum' }, get: { amount: '1,248.62', symbol: 'USDT', chain: 'tron', chainName: 'TRON' } },
  { tab: 'BNB → SOL', send: { amount: '500.00', symbol: 'USDT', chain: 'bsc', chainName: 'BNB Chain' }, get: { amount: '499.48', symbol: 'USDC', chain: 'sol', chainName: 'Solana' } },
  { tab: 'BASE → ARB', send: { amount: '2,400.00', symbol: 'USDC', chain: 'base', chainName: 'Base' }, get: { amount: '2,399.71', symbol: 'USDC', chain: 'arb', chainName: 'Arbitrum' } },
  { tab: 'POL → NEAR', send: { amount: '980.00', symbol: 'USDC', chain: 'pol', chainName: 'Polygon' }, get: { amount: '979.12', symbol: 'USDC', chain: 'near', chainName: 'NEAR' } },
];

/** An illustration, labelled DEMO: the figures are examples, the real quote is shown in the app. */
function DemoSwap() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setI((n) => (n + 1) % DEMO.length), 4500);
    return () => clearInterval(t);
  }, [auto]);
  const d = DEMO[i]!;
  return (
    <div className="lp-quote lp-swap" aria-label="Example swap">
      <div className="lp-quote-head">
        <span className="lp-swap-title"><span className="lp-swap-ico"><Icon name="zap" size={16} /></span>One-click swap</span>
        <span className="lp-demo-tag">DEMO</span>
      </div>
      <div className="lp-tabs" role="tablist">
        {DEMO.map((r, n) => (
          <button key={r.tab} role="tab" aria-selected={n === i} className={n === i ? 'on' : ''} onClick={() => { setI(n); setAuto(false); }}>{r.tab}</button>
        ))}
      </div>
      <div key={i} className="lp-swap-body">
        <div className="lp-quote-box">
          <span className="lp-label">You send</span>
          <div className="lp-quote-amount"><strong>{d.send.amount}</strong><Token {...d.send} /></div>
        </div>
        <span className="lp-swap-arrow"><Icon name="arrowDown" size={16} /></span>
        <div className="lp-quote-box lp-get">
          <span className="lp-label">They receive</span>
          <div className="lp-quote-amount"><strong>{d.get.amount}</strong><Token {...d.get} /></div>
        </div>
        <dl className="lp-quote-details">
          <div><dt>Route</dt><dd>{d.send.chainName} → {d.get.chainName}</dd></div>
          <div><dt>Filled by</dt><dd>NEAR Intents solvers</dd></div>
          <div><dt>You confirm</dt><dd>1 transaction</dd></div>
        </dl>
      </div>
      <a className="lp-primary lp-swap-cta" href="#/swap"><Icon name="zap" size={18} />Swap in one click</a>
      <ol className="lp-swap-steps">
        <li><span>1</span>Intent signed</li>
        <li><span>2</span>Best quote locked</li>
        <li><span>3</span>Delivered on {d.get.chainName}</li>
      </ol>
      <p className="lp-swap-note">Example route for illustration. Live quotes are shown in the app.</p>
    </div>
  );
}

/* ---------- content ---------- */

const USUAL = ['Find a bridge that supports both chains', 'Buy gas on a network you have never used', 'Wait for the bridge, then swap again on arrival', 'Approve and sign across three or four apps', 'Ask the person you are paying which chain they use'];
const WITH = ['Pick a token and a destination chain', 'See one quote before you confirm', 'Approve a single transaction', 'Receive on the chain you choose', 'Share a payment link and let them pay with anything'];

const STEPS: { icon: IconName; title: string; body: (s: { networks: string; tokens: string }) => string }[] = [
  { icon: 'wallet', title: 'Choose what you send', body: (s) => `Pick any of ${s.tokens} tokens from the wallet you already use, on any of ${s.networks} networks.` },
  { icon: 'route', title: 'Choose what arrives', body: () => 'Select the destination chain and token, or paste the address you are paying. The full quote shows before you commit.' },
  { icon: 'sparkle', title: 'Confirm once', body: () => 'Approve a single transaction. Solvers compete to fill it, and the tokens land on the destination chain.' },
];

const ROUTES_MINI: [string, string, string, string][] = [['Ethereum', 'eth', 'Solana', 'sol'], ['Bitcoin', 'btc', 'NEAR', 'near'], ['TRON', 'tron', 'Base', 'base']];

const RECEIVE: { symbol: string; chain: string; chainName: string }[] = [
  { symbol: 'USDC', chain: 'base', chainName: 'Base' },
  { symbol: 'USDT', chain: 'tron', chainName: 'TRON' },
  { symbol: 'USDC', chain: 'sol', chainName: 'Solana' },
  { symbol: 'USDC', chain: 'near', chainName: 'NEAR' },
];
const PAY: { symbol: string; chain: string; chainName: string }[] = [
  { symbol: 'ETH', chain: 'arb', chainName: 'Arbitrum' },
  { symbol: 'SOL', chain: 'sol', chainName: 'Solana' },
  { symbol: 'BTC', chain: 'btc', chainName: 'Bitcoin' },
  { symbol: 'BNB', chain: 'bsc', chainName: 'BNB Chain' },
  { symbol: 'DOGE', chain: 'doge', chainName: 'Dogecoin' },
  { symbol: 'TON', chain: 'ton', chainName: 'TON' },
];

const AUDIENCE: { icon: IconName; title: string; body: string }[] = [
  { icon: 'briefcase', title: 'Freelancers and creators', body: 'Invoice clients anywhere in the world and get paid in the stablecoin you actually use.' },
  { icon: 'store', title: 'Shops and merchants', body: 'Accept whatever your customers hold and settle in one token, on one chain.' },
  { icon: 'heart', title: 'Friends and family', body: 'Split a bill or send support without first asking which chain anyone is on.' },
];

const INTENT_STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'pen', title: 'You sign an intent', body: 'Your swap or payment becomes one signed request: what you send, what should arrive and where.' },
  { icon: 'bars', title: 'Solvers compete', body: 'Market makers bid to fill it on price, speed and execution quality. The best offer that meets your terms wins.' },
  { icon: 'shield', title: 'It settles atomically', body: 'Execution is enforced by smart contracts on NEAR. A swap either completes in full or your funds are refunded.' },
  { icon: 'send', title: 'Tokens land where you chose', body: 'The requested tokens arrive at the destination address on the destination chain. You never touch a bridge.' },
];

const ORBIT: [string, string][] = [['btc', 'Bitcoin'], ['eth', 'Ethereum'], ['sol', 'Solana'], ['base', 'Base'], ['tron', 'TRON'], ['bsc', 'BNB Chain'], ['ton', 'TON'], ['arb', 'Arbitrum']];

const FAQ = [
  { q: 'What is SpendX?', a: 'SpendX is a cross-chain app that lets you swap, send and receive crypto across {networks} networks and {tokens} tokens in a single click. It is built on NEAR Intents, so you choose the outcome and the network handles the route.' },
  { q: 'What is NEAR Intents?', a: 'NEAR Intents is the network that quotes, routes and settles every swap. You sign what you want to happen, solvers compete to fill it, and the result is delivered to the address and chain you chose.' },
  { q: 'How do payment links work?', a: 'Ask for an exact amount on the network you prefer and share the link. Your customer opens it, connects a wallet and pays with whatever they hold. You follow the status, and you are paid in the token and on the chain you chose.' },
  { q: 'Which networks and tokens are supported?', a: 'Everything in the Networks list on this page, read live from the NEAR Intents catalog. When you pay, tokens that are not supported are greyed out with the reason.' },
  { q: 'Do I need gas on the destination chain?', a: 'You need a little of the coin of the network you pay from, to cover your wallet\'s normal transfer fee. A live quote shows the estimated cost, the guaranteed minimum you receive and the estimated time before you commit.' },
  { q: 'What happens if a swap cannot be completed?', a: 'It is refunded to the address you paid from, and SpendX shows the refund on the payment.' },
  { q: 'Does SpendX ever hold my funds or keys?', a: 'No. Your wallet shows a single transaction and you approve it yourself. SpendX never asks for your private keys or seed phrase.' },
  { q: 'Is this real money?', a: 'Yes. SpendX works on live networks, so every transfer moves real tokens. Check the quote before you approve, and start with a small amount if it is your first time.' },
  { q: 'Do I need an account?', a: 'No sign-up. To create payment links you sign in by signing a plain text message with your wallet, which is not a transaction and costs nothing. The person paying just opens the link and connects a wallet.' },
];

// Which networks and tokens to show first. Anything else in the live catalog follows, and the rest are counted in "+N more".
const CHAIN_ORDER = ['btc', 'eth', 'sol', 'near', 'base', 'arb', 'bsc', 'tron', 'ton', 'pol', 'op', 'avax', 'xrp', 'doge', 'sui', 'aptos', 'cardano', 'stellar', 'zec', 'ltc', 'starknet', 'gnosis', 'bera'];
const POPULAR: [string, string][] = [['USDC', 'base'], ['USDT', 'tron'], ['BTC', 'btc'], ['ETH', 'eth'], ['SOL', 'sol'], ['NEAR', 'near'], ['BNB', 'bsc'], ['XRP', 'xrp'], ['TRX', 'tron'], ['TON', 'ton'], ['DOGE', 'doge'], ['ZEC', 'zec'], ['SUI', 'sui'], ['ADA', 'cardano'], ['AVAX', 'avax'], ['POL', 'pol'], ['APT', 'aptos'], ['LTC', 'ltc']];
const TILE_COUNT = 23;

function orderChains(chains: CatalogChain[]): CatalogChain[] {
  const rank = (c: CatalogChain) => { const r = CHAIN_ORDER.indexOf(c.blockchain); return r === -1 ? CHAIN_ORDER.length : r; };
  return [...chains].sort((a, b) => rank(a) - rank(b));
}

/* ---------- payment-link demo ---------- */

function PaymentDemo() {
  const [r, setR] = useState(0);
  const [p, setP] = useState(0);
  const recv = RECEIVE[r]!;
  const pay = PAY[p]!;
  return (
    <div className="lp-pl-card lp-reveal" style={idx(1)}>
      <div className="lp-pl-head">
        <span className="lp-pl-avatar">AS</span>
        <div><strong>Amara Studio</strong><small>Brand design, final invoice</small></div>
        <span className="lp-pl-tag"><Icon name="link" size={14} />Payment link</span>
      </div>
      <div className="lp-pl-amount">
        <span className="lp-label">Amount requested</span>
        <div><strong>250.00</strong><em>USDC</em></div>
        <span className="lp-pl-lands"><ChainIcon chain="base" small />Lands on Base</span>
      </div>
      <span className="lp-label lp-pl-cap">You want to receive</span>
      <div className="lp-pl-grid">
        {RECEIVE.map((o, n) => (
          <button key={o.symbol + o.chain} className={n === r ? 'on' : ''} onClick={() => setR(n)}>
            <TokenIcon symbol={o.symbol} chain={o.chain} /><span>{o.symbol}<small>on {o.chainName}</small></span>
          </button>
        ))}
      </div>
      <span className="lp-label lp-pl-cap">They pay with</span>
      <div className="lp-pl-chips">
        {PAY.map((o, n) => (
          <button key={o.symbol + o.chain} className={n === p ? 'on' : ''} onClick={() => setP(n)}>
            <TokenIcon symbol={o.symbol} chain={o.chain} small />{o.symbol}<small>on {o.chainName}</small>
          </button>
        ))}
      </div>
      <p key={`${r}-${p}`} className="lp-pl-result"><span><Icon name="check" size={14} /></span><span>They pay with <b>{pay.symbol} on {pay.chainName}</b>. You receive <b>250.00 {recv.symbol} on {recv.chainName}</b>.</span></p>
    </div>
  );
}

/* ---------- page ---------- */

export function Landing() {
  const [chains, setChains] = useState<CatalogChain[] | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [open, setOpen] = useState(0);
  useEffect(() => {
    api.catalog().then((c) => setChains(c.chains)).catch(() => setChains([]));
    api.config().then((c) => setAssistant(c.assistant)).catch(() => setAssistant(false));
  }, []);
  const stats = chains && chains.length ? catalogStats(chains) : null;
  const ordered = chains ? orderChains(chains) : null;
  const tiles = ordered ? ordered.slice(0, TILE_COUNT) : null;
  const moreNetworks = stats ? Math.max(0, stats.networks - TILE_COUNT) : 0;
  const popular = chains ? POPULAR.filter(([sym]) => chains.some((c) => c.tokens.some((t) => t.symbol.toUpperCase() === sym))) : [];
  const moreTokens = stats ? Math.max(0, stats.tokens - popular.length) : 0;
  const n = stats ? String(stats.networks) : 'all';
  const t = stats ? String(stats.tokens) : 'all';

  // Scroll reveal: elements marked .lp-reveal fade up once as they enter the screen. Without JavaScript, or with
  // "reduce motion" on, nothing is hidden (the hiding rule only applies under .lp-js, see landing.css).
  useEffect(() => {
    const root = document.documentElement;
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    root.classList.add('lp-js');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    document.querySelectorAll('.lp-reveal:not(.in)').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [assistant, chains]); // network tiles and the assistant card mount after their data loads, so look for new .lp-reveal elements then
  useEffect(() => () => document.documentElement.classList.remove('lp-js'), []);

  return (
    <>
      <section className="lp-hero">
        <div className="lp-hero-glow" aria-hidden="true" />
        <div className="lp-hero-copy">
          <h1><Words text="Cross any chain" /><br /><span className="lp-accent"><Words text="in one click." start={3} /></span></h1>
          <div className="lp-actions">
            <a className="lp-primary" href="#/swap">Launch app</a>
            <button className="lp-secondary" onClick={() => scrollToSection('how')}>See how it works</button>
          </div>
        </div>
        <div className="lp-hero-visual">
          <DemoSwap />
          <div className="lp-float-chip" aria-hidden="true"><span><Icon name="link" size={16} /></span><div><small>Payment link paid</small><strong>250 USDC on Base</strong></div></div>
        </div>
      </section>

      <section className="lp-stats lp-reveal" aria-label="Coverage">
        <div><strong>{stats ? <CountUp to={stats.networks} /> : <Skeleton w="48px" h="40px" />}</strong><span>Networks</span></div>
        <div><strong>{stats ? <CountUp to={stats.tokens} /> : <Skeleton w="64px" h="40px" />}</strong><span>Tokens</span></div>
        <div><strong><CountUp to={1} /></strong><span>Click to cross</span></div>
      </section>

      <div className="lp-ticker lp-reveal" aria-label="Supported networks">
        <p>One app across {n} networks and {t} tokens</p>
        {tiles && (
          <div className="lp-ticker-viewport">
            <ul className="lp-ticker-track">
              {[...tiles, ...tiles].map((c, k) => <li key={c.blockchain + k} aria-hidden={k >= tiles.length}><ChainIcon chain={c.blockchain} small />{chainLabel(c.blockchain)}</li>)}
            </ul>
          </div>
        )}
      </div>

      <section className="lp-section" id="difference">
        <SectionHead badge="The difference" title="Cross-chain used to take five tabs. Now it takes one click." />
        <div className="lp-compare">
          <article className="lp-card lp-reveal">
            <h3><span className="lp-card-ico"><Icon name="tabs" size={18} /></span>The usual way</h3>
            <ul>{USUAL.map((x) => <li key={x}><Icon name="xCircle" size={18} />{x}</li>)}</ul>
          </article>
          <article className="lp-card lp-card-hot lp-reveal" style={idx(1)}>
            <h3><span className="lp-card-ico logo"><LogoMark scale={0.8} /></span>With SpendX</h3>
            <ul>{WITH.map((x) => <li key={x}><Icon name="check" size={18} />{x}</li>)}</ul>
          </article>
        </div>
      </section>

      <section className="lp-section" id="how">
        <SectionHead long badge="How it works" title="SpendX hides the hard parts of moving value between blockchains. You decide the outcome, NEAR Intents finds the path to it." />
        <ol className="lp-steps">
          {STEPS.map((s, k) => (
            <li key={s.title} className="lp-card lp-reveal" style={idx(k)}>
              <div className="lp-step-top"><span className="lp-card-ico"><Icon name={s.icon} size={20} /></span><span className="lp-step-n">0{k + 1}</span></div>
              <h3>{s.title}</h3>
              <p>{s.body({ networks: n, tokens: t })}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section" id="why">
        <SectionHead badge="Why SpendX" title="Everything cross-chain should have been from the start." />
        <div className="lp-bento">
          <article className="lp-card lp-b-main lp-reveal">
            <div>
              <span className="lp-card-ico"><Icon name="zap" size={20} /></span>
              <h3>One click, every chain</h3>
              <p>Swap and send across {n} networks without hunting for a bridge, switching apps or signing five times. Pick a destination and confirm once.</p>
            </div>
            <ul className="lp-mini-routes" aria-hidden="true">
              {ROUTES_MINI.map(([a, ac, b, bc], k) => (
                <li key={a} style={idx(k)}><span><ChainIcon chain={ac} small />{a}</span><em>1 click</em><span>{b}<ChainIcon chain={bc} small /></span></li>
              ))}
            </ul>
          </article>
          <article className="lp-card lp-b-tokens lp-reveal" style={idx(1)}>
            <span className="lp-card-ico"><Icon name="coins" size={20} /></span>
            <h3>{t} tokens, one app</h3>
            <p>Stablecoins, blue chips and the native coins of every supported network, ready to swap, send or receive.</p>
            <div className="lp-stack" aria-hidden="true">
              {POPULAR.slice(0, 6).map(([s, c]) => <TokenIcon key={s} symbol={s} chain={c} />)}
              {stats && <span className="lp-stack-more">+{Math.max(0, stats.tokens - 6)}</span>}
            </div>
          </article>
          <article className="lp-card lp-reveal"><span className="lp-card-ico"><Icon name="bars" size={20} /></span><h3>Sharp quotes, automatically</h3><p>Solvers compete on price, speed and execution for every swap, so you never compare bridges by hand.</p></article>
          <article className="lp-card lp-reveal" style={idx(1)}><span className="lp-card-ico"><Icon name="undo" size={20} /></span><h3>Complete or refunded</h3><p>Swaps execute atomically through NEAR Intents. If one cannot be filled, your funds are returned automatically.</p></article>
          <article className="lp-card lp-reveal" style={idx(2)}><span className="lp-card-ico"><Icon name="shield" size={20} /></span><h3>Your wallet, your keys</h3><p>Non-custodial from start to finish. Connect the wallet you already use and approve every transaction yourself.</p></article>
          {assistant && (
            <article className="lp-card lp-b-wide lp-reveal">
              <span className="lp-card-ico"><Icon name="sparkle" size={20} /></span>
              <div><h3>Describe it in a sentence</h3><p>Type "10 SOL to USDC on Base" and SpendX fills in the form. You review it and approve in your own wallet.</p></div>
              <a className="lp-link" href="#/swap">Try it<Icon name="chevron" size={16} /></a>
            </article>
          )}
        </div>
      </section>

      <section className="lp-section lp-pl" id="payments">
        <div className="lp-pl-copy lp-reveal">
          <Badge>Payment links</Badge>
          <h2>Get paid on your chain, whatever they hold.</h2>
          <ul>
            <li><span><Icon name="link" size={18} /></span><div><strong>Create your link</strong><small>Choose the token and the network you want to be paid in.</small></div></li>
            <li><span><Icon name="send" size={18} /></span><div><strong>Share it anywhere</strong><small>Drop it in a chat, an invoice, an email or your bio.</small></div></li>
            <li><span><Icon name="check" size={18} /></span><div><strong>Get paid your way</strong><small>They pay with any token on any of {n} networks. You receive it in the token and chain you chose.</small></div></li>
          </ul>
          <a className="lp-primary" href="#/merchant">Create a payment link</a>
        </div>
        <PaymentDemo />
      </section>

      <section className="lp-section lp-audience">
        <p className="lp-eyebrow lp-reveal">Made for anyone who gets paid in crypto</p>
        <div className="lp-audience-grid">
          {AUDIENCE.map((a, k) => (
            <article key={a.title} className="lp-card lp-reveal" style={idx(k)}><span className="lp-card-ico"><Icon name={a.icon} size={20} /></span><h3>{a.title}</h3><p>{a.body}</p></article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-intents" id="built-on">
        <div className="lp-orbit lp-reveal" aria-hidden="true">
          <div className="lp-ring r1" /><div className="lp-ring r2" /><div className="lp-ring r3" />
          <div className="lp-orbit-spin">
            {ORBIT.map(([c, label], k) => (
              <div key={c} className="lp-spoke" style={{ '--a': `${k * 45}deg` } as CSSProperties}>
                <div className="lp-orbit-node"><div><ChainIcon chain={c} /><small>{label}</small></div></div>
              </div>
            ))}
          </div>
          <div className="lp-orbit-core"><span>NEAR</span><small>NEAR Intents</small></div>
        </div>
        <div className="lp-intents-copy lp-reveal" style={idx(1)}>
          <Badge>Powered by NEAR Intents</Badge>
          <h2>You choose the outcome. Solvers find the route.</h2>
          <p>NEAR Intents flips cross-chain transfers around. Instead of plotting a path through bridges and exchanges, you sign the result you want and a network of solvers competes to deliver it.</p>
          <ol>
            {INTENT_STEPS.map((s, k) => (
              <li key={s.title}><span className="lp-card-ico"><Icon name={s.icon} size={16} /></span><em>0{k + 1}</em><h3>{s.title}</h3><p>{s.body}</p></li>
            ))}
          </ol>
          <a className="lp-link" href="https://docs.near-intents.org/" target="_blank" rel="noreferrer noopener">Learn more about NEAR Intents<Icon name="arrowUpRight" size={16} /></a>
        </div>
      </section>

      <section className="lp-section" id="networks">
        <SectionHead badge="Coverage" title={stats ? `${stats.networks} networks. ${stats.tokens} tokens. One app.` : 'Every network. Every token. One app.'} lead="From Bitcoin and Ethereum to Solana, TRON and TON, SpendX connects the chains people actually use through one simple flow." />
        <ul className="lp-tiles">
          {tiles === null
            ? Array.from({ length: 12 }, (_, k) => <li key={k}><Skeleton w="110px" h="24px" /></li>)
            : tiles.map((c, k) => <li key={c.blockchain} className="lp-reveal" style={idx(k % 6)}><ChainIcon chain={c.blockchain} small />{chainLabel(c.blockchain)}</li>)}
          {tiles && moreNetworks > 0 && <li className="lp-tile-more lp-reveal"><Icon name="plus" size={16} />{moreNetworks} more networks</li>}
        </ul>
        <div className="lp-popular lp-reveal">
          <div><h3>Popular tokens</h3><p>Stablecoins, blue chips and the native coins of every supported network, ready to swap, send or receive.</p></div>
          <ul>
            {popular.map(([s, c]) => <li key={s}><TokenIcon symbol={s} chain={c} small />{s}</li>)}
            {stats && moreTokens > 0 && <li className="lp-tile-more">+{moreTokens} more</li>}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-faq" id="faq">
        <div className="lp-faq-left lp-reveal">
          <Badge>FAQ</Badge>
          <h2>Questions, answered.</h2>
          <div className="lp-faq-cta">
            <h3>Ready to cross your first chain?</h3>
            <p>Connect your wallet and send anything, anywhere, in a single click.</p>
            <a className="lp-primary" href="#/swap">Launch app</a>
          </div>
        </div>
        <div className="lp-faq-list lp-reveal" style={idx(1)}>
          {FAQ.map((f, k) => (
            <div key={f.q} className={k === open ? 'lp-faq-item open' : 'lp-faq-item'}>
              <button aria-expanded={k === open} aria-controls={`faq-${k}`} onClick={() => setOpen(k === open ? -1 : k)}>
                <span>{f.q}</span><i aria-hidden="true" />
              </button>
              <div className="lp-faq-body" id={`faq-${k}`} role="region"><p>{f.a.replace('{networks}', n).replace('{tokens}', t)}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-final lp-reveal">
        <div className="lp-final-glow" aria-hidden="true" />
        <span className="lp-final-mark"><LogoMark scale={1.1} /></span>
        <h2>Your money should not care which chain it is on.</h2>
        <p>Swap, send and get paid across {n} networks and {t} tokens with a single click.</p>
        <div className="lp-actions">
          <a className="lp-primary" href="#/swap">Launch app</a>
          <a className="lp-secondary" href="#/merchant">Explore payment links</a>
        </div>
      </section>
    </>
  );
}
