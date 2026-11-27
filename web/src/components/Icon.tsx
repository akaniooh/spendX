import { useState } from 'react';
import type { ReactNode } from 'react';
import { iconSources, useIconMaps } from '../lib/icons.ts';
import { chainColor, chainMark, contrastText, tokenColor, tokenMark } from '../lib/colors.ts';

export type IconName = 'arrow' | 'arrowDown' | 'check' | 'chevron' | 'clock' | 'close' | 'copy' | 'external' | 'history' | 'info' | 'link' | 'menu' | 'plus' | 'route' | 'search' | 'shield' | 'swap' | 'wallet' | 'alert' | 'sparkle' | 'settings' | 'sun' | 'moon' | 'themeHalf' | 'coins' | 'bars' | 'database' | 'back' | 'bell' | 'zap' | 'briefcase' | 'store' | 'heart' | 'pen' | 'send' | 'tabs' | 'xCircle' | 'undo' | 'arrowUpRight';

const PATHS: Record<IconName, ReactNode> = {
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  arrowDown: <path d="m7 10 5 5 5-5" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  copy: (<><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  history: (<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  route: (<><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h1" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></>),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-5" />,
  swap: (<><path d="M7 7h11l-3-3M17 17H6l3 3" /><path d="m18 7-3 3M6 17l3-3" /></>),
  wallet: (<><path d="M4 6a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v15H5a2 2 0 0 1-2-2V6Z" /><path d="M3 7h15M15 12h6v5h-6a2.5 2.5 0 0 1 0-5Z" /></>),
  sparkle: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 11 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />,
  settings: (<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>),
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  themeHalf: (<><circle cx="12" cy="12" r="9" /><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" /></>),
  coins: (<><circle cx="9" cy="9" r="6" /><path d="M14.5 14.8A6 6 0 1 0 9.2 20 6 6 0 0 0 20 14.8a6 6 0 0 0-5.5-5.7" /></>),
  bars: <path d="M6 20v-9M12 20V4M18 20v-6" />,
  database: (<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>),
  back: <path d="m15 18-6-6 6-6" />,
  zap: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  briefcase: (<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></>),
  store: (<><path d="M4 9 5.5 4h13L20 9" /><path d="M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 6 0 2.5 2.5 0 0 0 5 0" /><path d="M5 12v8h14v-8M10 20v-5h4v5" /></>),
  heart: <path d="M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.3 12 20 12 20Z" />,
  pen: (<><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z" /><path d="m14 7 3 3" /></>),
  send: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />,
  tabs: (<><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M8 6v4" /></>),
  xCircle: (<><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>),
  undo: (<><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
  arrowUpRight: <path d="M7 17 17 7M8 7h9v9" />,
  alert: (<><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></>),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

// Official artwork supplied for these networks and tokens lives in web/public/icons (square PNGs, already round).
// Anything not listed falls back to a coloured disc with a letter. To add one, drop `<name>.png` in that folder and list it here.
const CHAIN_IMAGES: Record<string, string> = { eth: 'eth', base: 'base', sol: 'sol', near: 'near', btc: 'btc', op: 'op', pol: 'pol', arb: 'arb', avax: 'avax', bsc: 'bnb', gnosis: 'gnosis', scroll: 'scroll', aptos: 'aptos', bera: 'bera', monad: 'monad', plasma: 'plasma', xlayer: 'xlayer', dash: 'dash', qtc: 'qtc', prl: 'prl', movement: 'movement', move: 'movement', hypercore: 'hypercore', hyperliquid: 'hypercore', hyperevm: 'hypercore', hype: 'hypercore', hood: 'hood', robinhood: 'hood', fogo: 'fogo', abs: 'abs', abstract: 'abs', ton: 'ton', sui: 'sui', tron: 'tron', doge: 'doge', ltc: 'ltc', xrp: 'xrp', zec: 'zec', stellar: 'stellar', starknet: 'starknet', cardano: 'cardano', bch: 'bch', aleo: 'aleo', miden: 'miden', adi: 'adi' };
const TOKEN_IMAGES: Record<string, string> = { ETH: 'eth', WETH: 'eth', SOL: 'sol', NEAR: 'near', WNEAR: 'near', USDC: 'usdc', USDT: 'usdt', BTC: 'btc', WBTC: 'btc', OP: 'op', POL: 'pol', MATIC: 'pol', ARB: 'arb', AVAX: 'avax', WAVAX: 'avax', BNB: 'bnb', WBNB: 'bnb', GNO: 'gnosis', APT: 'aptos', BERA: 'bera', WBERA: 'bera', MON: 'monad', WMON: 'monad', XPL: 'plasma', WXPL: 'plasma', OKB: 'xlayer', DASH: 'dash', HYPE: 'hypercore', WHYPE: 'hypercore', MOVE: 'movement', QTC: 'qtc', PRL: 'prl', FOGO: 'fogo', TON: 'ton', SUI: 'sui', TRX: 'tron', DOGE: 'doge', LTC: 'ltc', XRP: 'xrp', ZEC: 'zec', XLM: 'stellar', STRK: 'starknet', ADA: 'cardano', BCH: 'bch', ALEO: 'aleo', MIDEN: 'miden', ADI: 'adi' };
const iconUrl = (name: string) => `/icons/${name}.png`;

/** Tries each image in turn (CoinGecko logo, then our own PNG); when none loads it shows the coloured letter disc. */
function Logo({ kind, sources, small, bg, mark }: { kind: 'chain' | 'token'; sources: string[]; small: boolean; bg: string; mark: string }) {
  const [i, setI] = useState(0);
  const has = i < sources.length;
  const cls = `${kind}-icon${has ? ' has-img' : ''}${small ? ' small' : ''}`;
  return has
    ? <span className={cls} aria-hidden="true"><img src={sources[i]} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setI(i + 1)} /></span>
    : <span className={cls} style={{ background: bg, color: contrastText(bg) }} aria-hidden="true">{mark}</span>;
}

export function ChainIcon({ chain, small = false }: { chain: string; small?: boolean }) {
  const maps = useIconMaps();
  const local = CHAIN_IMAGES[chain];
  const sources = iconSources(maps.chains[chain], local ? iconUrl(local) : undefined);
  return <Logo key={sources.join('|')} kind="chain" sources={sources} small={small} bg={chainColor(chain)} mark={chainMark(chain)} />;
}

/** `plain` skips the logo: used for look-alike tokens (same symbol as another token on the network) so they never borrow the real token's logo. */
export function TokenIcon({ symbol, chain, small = false, plain = false }: { symbol: string; chain: string; small?: boolean; plain?: boolean }) {
  const maps = useIconMaps();
  const local = TOKEN_IMAGES[symbol.toUpperCase()];
  const sources = plain ? [] : iconSources(maps.tokens[symbol.toUpperCase()], local ? iconUrl(local) : undefined);
  return <Logo key={sources.join('|')} kind="token" sources={sources} small={small} bg={tokenColor(symbol, chain)} mark={tokenMark(symbol)} />;
}

/** SpendX mark: two overlapping rounded squares, rotated. */
export function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <a className={`brand ${footer ? 'footer-brand' : ''}`} href="#/" aria-label="SpendX home">
      <span className="brand-mark" aria-hidden="true"><i /><b /></span>
      <span>SPEND<span>X</span></span>
    </a>
  );
}

/** Placeholder block shown while real content loads. Width and height are CSS lengths. */
export function Skeleton({ w, h, block = false }: { w?: string; h?: string; block?: boolean }) {
  return <span className={`skeleton ${block ? 'block' : ''}`} style={{ ['--w' as string]: w, ['--h' as string]: h }} aria-hidden="true" />;
}
