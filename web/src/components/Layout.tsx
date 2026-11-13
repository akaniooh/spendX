import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useWallets } from '../wallets/WalletContext.tsx';
import { shortAddr } from '../lib/labels.ts';
import type { Route } from '../lib/route.ts';
import { scrollToSection } from '../lib/landing.ts';
import { Brand, Icon } from './Icon.tsx';
import { WalletModal } from './WalletModal.tsx';

const NAV: { label: string; href: string; names: Route['name'][] }[] = [
  { label: 'Swap', href: '#/swap', names: ['swap'] },
  { label: 'Payments', href: '#/payments', names: ['payments', 'pay'] },
  { label: 'Activity', href: '#/activity', names: ['activity', 'attempt'] },
  { label: 'Merchant', href: '#/merchant', names: ['merchant'] },
];

/** Only speaks up when something is wrong: an always-on "online" badge would be noise. */
function useServerDown(): boolean {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let off = false;
    const ping = () => fetch('/api/health').then((r) => !off && setDown(!r.ok)).catch(() => !off && setDown(true));
    ping();
    const t = setInterval(ping, 30_000);
    return () => { off = true; clearInterval(t); };
  }, []);
  return down;
}

export function Layout({ route, children }: { route: Route; children: ReactNode }) {
  const w = useWallets();
  const down = useServerDown();
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [route.name]);
  const first = w.evm?.address ?? w.svm?.address ?? w.near?.address ?? null;

  return (
    <div className={route.name === 'home' ? 'app landing' : 'app'}>
      {route.name === 'home' ? (
        <header className="topbar lp-top">
          <Brand />
          <nav className="nav" aria-label="Sections">
            <button onClick={() => scrollToSection('how')}>How it works</button>
            <button onClick={() => scrollToSection('payments')}>Features</button>
            <button onClick={() => scrollToSection('networks')}>Networks</button>
            <button onClick={() => scrollToSection('built-on')}>Built on NEAR Intents</button>
          </nav>
          <div className="topbar-end"><a className="lp-launch" href="#/swap">Launch app</a></div>
        </header>
      ) : (
      <header className="topbar">
        <Brand />
        <nav className={menu ? 'nav open' : 'nav'} aria-label="Main">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={n.names.includes(route.name) ? 'active' : ''} aria-current={n.names.includes(route.name) ? 'page' : undefined}>{n.label}</a>
          ))}
        </nav>
        <div className="topbar-end">
          {down && <span className="server-warning" role="status">Server unreachable</span>}
          <button className={`wallet-button ${w.connectedCount ? 'connected' : ''}`} onClick={w.openWalletModal}>
            <Icon name="wallet" size={18} />
            {w.connectedCount === 0 ? 'Connect wallet' : first ? shortAddr(first, 4, 4) : 'Wallets'}
            {w.connectedCount > 1 && ` +${w.connectedCount - 1}`}
          </button>
          <button className="menu-button" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name={menu ? 'close' : 'menu'} /></button>
        </div>
      </header>
      )}
      <main>{children}</main>
      <footer>
        <Brand footer />
        <span>© 2026 SpendX</span>
        <div className="links">
          <a href="https://docs.near-intents.org/" target="_blank" rel="noreferrer noopener">NEAR Intents docs</a>
          <a href="https://explorer.near-intents.org/" target="_blank" rel="noreferrer noopener">Intents explorer</a>
        </div>
      </footer>
      <WalletModal />
    </div>
  );
}
