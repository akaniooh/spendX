import { useEffect, useState } from 'react';
import { Layout } from './components/Layout.tsx';
import { AttemptTracker } from './components/AttemptTracker.tsx';
import { matchRoute } from './lib/route.ts';
import type { Route } from './lib/route.ts';
import { Pay } from './pages/Pay.tsx';
import { Merchant } from './pages/Merchant.tsx';
import { Landing } from './pages/Landing.tsx';
import { Swap } from './pages/Swap.tsx';
import { Activity } from './pages/Activity.tsx';
import { Payments } from './pages/Payments.tsx';
import { WalletProvider } from './wallets/WalletContext.tsx';

function useHashRoute(): Route {
  const [h, setH] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const f = () => setH(window.location.hash.slice(1));
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return matchRoute(h);
}

export default function App() {
  const route = useHashRoute();
  let page;
  switch (route.name) {
    case 'home': page = <Landing />; break;
    case 'payments': page = <Payments />; break;
    case 'pay': page = <Pay key={route.slug} slug={route.slug} />; break;
    case 'attempt': page = <AttemptTracker key={route.id} id={route.id} />; break;
    case 'swap': page = <Swap />; break;
    case 'activity': page = <Activity />; break;
    case 'merchant': page = <Merchant />; break;
    default: page = <section className="page-head"><h1>Page not found</h1><p><a className="link" href="#/">Go to SpendX home</a></p></section>;
  }
  return <WalletProvider><Layout route={route}>{page}</Layout></WalletProvider>;
}
