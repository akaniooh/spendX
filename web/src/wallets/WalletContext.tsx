import { correctedNow } from '../lib/clock.ts';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { WalletAdapter } from '../../../shared/src/adapters.ts';
import type { WalletFamily } from '../../../shared/src/chains.ts';
import { discoverEvmWallets, EvmWallet } from './evm.ts';
import type { DiscoveredEvmWallet } from './evm.ts';
import { nearAddressOf } from './near-account.ts';
import { NearWallet } from './near.ts';
import { getPhantom, SolanaWallet } from './svm.ts';
import { api } from '../lib/api.ts';

export interface Session { token: string; address: string; family: 'evm' | 'svm'; expiresAt: string }
export type ConnectableFamily = 'evm' | 'svm' | 'near';

interface Ctx {
  evmWallets: DiscoveredEvmWallet[];
  evm: { adapter: EvmWallet; address: string; name: string } | null;
  svm: { adapter: SolanaWallet; address: string } | null;
  near: { adapter: NearWallet; address: string } | null;
  phantomAvailable: boolean;
  connectEvm(id: string): Promise<void>;
  connectSvm(): Promise<void>;
  connectNear(): Promise<void>;
  disconnect(family: ConnectableFamily): void;
  adapterFor(family: WalletFamily): WalletAdapter | null;
  /** the connected address for a wallet family, if any */
  addressFor(family: WalletFamily): string | null;
  connectedCount: number;
  session: Session | null;
  signIn(family: 'evm' | 'svm'): Promise<void>;
  signOut(): void;
  walletModalOpen: boolean;
  openWalletModal(): void;
  closeWalletModal(): void;
}

const WalletCtx = createContext<Ctx | null>(null);
export const useWallets = (): Ctx => {
  const c = useContext(WalletCtx);
  if (!c) throw new Error('useWallets must be used inside WalletProvider');
  return c;
};

const SESSION_KEY = 'spendx.session';
const NEAR_FLAG = 'spendx.near';

function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
    return s && Date.parse(s.expiresAt) > correctedNow() ? s : null;
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [evmWallets, setEvmWallets] = useState<DiscoveredEvmWallet[]>([]);
  const [evm, setEvm] = useState<Ctx['evm']>(null);
  const [svm, setSvm] = useState<Ctx['svm']>(null);
  const [near, setNear] = useState<Ctx['near']>(null);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [phantomAvailable, setPhantomAvailable] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const connectorRef = useRef<any>(null);

  useEffect(() => discoverEvmWallets(setEvmWallets), []);
  // Phantom injects shortly after page load, so check again after a moment
  useEffect(() => {
    const check = () => setPhantomAvailable(!!getPhantom());
    check();
    const t = setTimeout(check, 800);
    return () => clearTimeout(t);
  }, []);

  // NEAR Connect is created lazily (it loads its wallet manifest over the network) and only when first needed.
  const getConnector = useCallback(async () => {
    if (!connectorRef.current) {
      const { NearConnector } = await import('@hot-labs/near-connect');
      const c: any = new NearConnector({ network: 'mainnet', features: { signAndSendTransaction: true } });
      c.on('wallet:signOut', () => { setNear(null); try { localStorage.removeItem(NEAR_FLAG); } catch { /* ignore */ } });
      connectorRef.current = c;
    }
    return connectorRef.current;
  }, []);

  const adoptNear = useCallback(async (connector: any, wallet: any) => {
    const address: string = await nearAddressOf(wallet);
    const adapter = new NearWallet(wallet, address, async () => {
      try { await connector.disconnect(wallet); } catch { /* already disconnected */ }
    });
    setNear({ adapter, address });
    try { localStorage.setItem(NEAR_FLAG, '1'); } catch { /* ignore */ }
  }, []);

  // Restore a previous NEAR connection, but only if this browser used NEAR before.
  useEffect(() => {
    let off = false;
    try { if (!localStorage.getItem(NEAR_FLAG)) return; } catch { return; }
    (async () => {
      try {
        const c = await getConnector();
        const w = await c.wallet();
        if (!off && w) await adoptNear(c, w);
      } catch { /* no saved wallet: the user can connect manually */ }
    })();
    return () => { off = true; };
  }, [getConnector, adoptNear]);

  const connectEvm = useCallback(async (id: string) => {
    const info = evmWallets.find((w) => w.id === id);
    if (!info) throw new Error('That wallet is no longer available');
    const adapter = new EvmWallet(info);
    const { address } = await adapter.connect();
    setEvm({ adapter, address, name: adapter.name });
  }, [evmWallets]);

  const connectSvm = useCallback(async () => {
    const p = getPhantom();
    if (!p) throw new Error('Phantom was not detected. Install it from phantom.com and reload.');
    const adapter = new SolanaWallet(p);
    const { address } = await adapter.connect();
    setSvm({ adapter, address });
  }, []);

  const connectNear = useCallback(async () => {
    const c = await getConnector();
    await c.connect(); // opens NEAR Connect's wallet picker; per its docs the connected wallet is then read with wallet()
    const wallet = await c.wallet();
    if (!wallet) throw new Error('No NEAR wallet was selected');
    await adoptNear(c, wallet);
  }, [getConnector, adoptNear]);

  const disconnect = useCallback((family: ConnectableFamily) => {
    // Disconnecting the wallet you signed in with also ends that sign-in.
    const gone = family === 'evm' ? evm?.address : family === 'svm' ? svm?.address : near?.address;
    if (session && gone && (gone === session.address || gone.toLowerCase() === session.address.toLowerCase())) {
      try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      setSession(null);
    }
    if (family === 'evm') { evm?.adapter.disconnect(); setEvm(null); }
    else if (family === 'svm') { svm?.adapter.disconnect(); setSvm(null); }
    else { near?.adapter.disconnect(); setNear(null); try { localStorage.removeItem(NEAR_FLAG); } catch { /* ignore */ } }
  }, [evm, svm, near, session]);

  const signIn = useCallback(async (family: 'evm' | 'svm') => {
    const w = family === 'evm' ? evm : svm;
    if (!w) throw new Error('Connect your wallet first');
    const { challengeToken, message } = await api.challenge(w.address, family);
    const signature = await w.adapter.signMessage(message); // free: signs text only, sends no transaction
    const v = await api.verify({ address: w.address, family, challengeToken, signature });
    const s: Session = { token: v.token, address: v.address, family: v.family, expiresAt: v.expiresAt };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  }, [evm, svm]);

  const signOut = useCallback(() => { try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } setSession(null); }, []);

  const adapterFor = useCallback((family: WalletFamily): WalletAdapter | null =>
    family === 'evm' ? evm?.adapter ?? null : family === 'svm' ? svm?.adapter ?? null : family === 'near' ? near?.adapter ?? null : null,
  [evm, svm, near]);

  const addressFor = useCallback((family: WalletFamily): string | null =>
    family === 'evm' ? evm?.address ?? null : family === 'svm' ? svm?.address ?? null : family === 'near' ? near?.address ?? null : null,
  [evm, svm, near]);

  const connectedCount = (evm ? 1 : 0) + (svm ? 1 : 0) + (near ? 1 : 0);
  const openWalletModal = useCallback(() => setWalletModalOpen(true), []);
  const closeWalletModal = useCallback(() => setWalletModalOpen(false), []);

  const value = useMemo<Ctx>(() => ({
    evmWallets, evm, svm, near, phantomAvailable, connectEvm, connectSvm, connectNear, disconnect, adapterFor, addressFor,
    connectedCount, session, signIn, signOut, walletModalOpen, openWalletModal, closeWalletModal,
  }), [evmWallets, evm, svm, near, phantomAvailable, connectEvm, connectSvm, connectNear, disconnect, adapterFor, addressFor,
    connectedCount, session, signIn, signOut, walletModalOpen, openWalletModal, closeWalletModal]);
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}
