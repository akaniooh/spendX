import type { ReactNode } from 'react';
import { chainColor, chainMark, contrastText, tokenColor, tokenMark } from '../lib/colors.ts';

export type IconName = 'arrow' | 'arrowDown' | 'check' | 'chevron' | 'clock' | 'close' | 'copy' | 'external' | 'history' | 'info' | 'link' | 'menu' | 'plus' | 'route' | 'search' | 'shield' | 'swap' | 'wallet' | 'alert' | 'sparkle';

const PATHS: Record<IconName, ReactNode> = {
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
  alert: (<><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></>),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

export function ChainIcon({ chain, small = false }: { chain: string; small?: boolean }) {
  const bg = chainColor(chain);
  return <span className={`chain-icon ${small ? 'small' : ''}`} style={{ background: bg, color: contrastText(bg) }} aria-hidden="true">{chainMark(chain)}</span>;
}

export function TokenIcon({ symbol, chain, small = false }: { symbol: string; chain: string; small?: boolean }) {
  const bg = tokenColor(symbol, chain);
  return <span className={`token-icon ${small ? 'small' : ''}`} style={{ background: bg, color: contrastText(bg) }} aria-hidden="true">{tokenMark(symbol)}</span>;
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
