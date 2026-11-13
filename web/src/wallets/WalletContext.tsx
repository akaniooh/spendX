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
import { sameAddress } from '../lib/history.ts';

export interface Session { token: string; address: string; family: 'evm' | 'svm' | 'near'; expiresAt: string }
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
  /** the EVM or Solana sign-in (used by the Merchant page); null if there is none */
  session: Session | null;
  /** one sign-in per connected wallet: this is what syncs each wallet's activity across devices */
  sessions: Session[];
  signIn(family: ConnectableFamily): Promise<void>;
  signOut(): void;
  /** true while an automatic sign-in that syncs activity is waiting on a wallet */
  syncing: boolean;
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

const SESSION_KEY = 'spendx.session'; // legacy single sign-in, still read once
const SESSIONS_KEY = 'spendx.sessions';
const NEAR_FLAG = 'spendx.near';
const EVM_KEY = 'spendx.evm'; // which EVM wallet was connected: {id, name}. Removed only by the Disconnect button.
const SVM_FLAG = 'spendx.svm';

const store = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function loadSessions(): Session[] {
  const live = (x: any): x is Session => !!x && typeof x.token === 'string' && typeof x.address === 'string' && Date.parse(x.expiresAt) > correctedNow();
  try {
    const list = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? 'null');
    if (Array.isArray(list)) return list.filter(live);
    const legacy = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return live(legacy) ? [legacy] : [];
  } catch {
    return [];
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [evmWallets, setEvmWallets] = useState<DiscoveredEvmWallet[]>([]);
  const [evm, setEvm] = useState<Ctx['evm']>(null);
  const [svm, setSvm] = useState<Ctx['svm']>(null);
  const [near, setNear] = useState<Ctx['near']>(null);
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [phantomAvailable, setPhantomAvailable] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [syncingCount, setSyncingCount] = useState(0);
  const connectorRef = useRef<any>(null);
  // Latest sign-ins for async callbacks (a connect finishes before React re-renders).
  const sessionsRef = useRef<Session[]>(sessions);
  sessionsRef.current = sessions;
  const syncingAddrs = useRef(new Set<string>());
  const restoredEvm = useRef(false);
  const restoredSvm = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, [sessions]);
  const session = useMemo(() => sessions.find((x) => x.family !== 'near') ?? null, [sessions]);
  const syncing = syncingCount > 0;

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
    return { adapter, address };
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

  const signInWith = useCallback(async (adapter: { signMessage(message: string): Promise<string> }, address: string, family: ConnectableFamily) => {
    const { challengeToken, message } = await api.challenge(address, family);
    const signature = await adapter.signMessage(message); // free: signs text only, sends no transaction
    const v = await api.verify({ address, family, challengeToken, signature });
    const s: Session = { token: v.token, address: v.address, family: v.family, expiresAt: v.expiresAt };
    setSessions((list) => [...list.filter((x) => !sameAddress(x.address, s.address)), s]);
  }, []);

  /**
   * Sync activity right after a wallet connects: one free signature per wallet, no transaction.
   * Skipped when that wallet already has a valid sign-in. If the user dismisses the prompt, the wallet stays
   * connected and the Activity page offers a sign-in button for it instead.
   */
  const autoSync = useCallback(async (adapter: { signMessage(message: string): Promise<string> }, address: string, family: ConnectableFamily) => {
    const have = sessionsRef.current.find((x) => sameAddress(x.address, address));
    if (have && Date.parse(have.expiresAt) > correctedNow()) return;
    if (syncingAddrs.current.has(address)) return;
    syncingAddrs.current.add(address);
    setSyncingCount((n) => n + 1);
    try { await signInWith(adapter, address, family); }
    catch { /* cancelled or failed: the Activity page offers a manual sign-in */ }
    finally { syncingAddrs.current.delete(address); setSyncingCount((n) => n - 1); }
  }, [signInWith]);

  const connectEvm = useCallback(async (id: string) => {
    const info = evmWallets.find((w) => w.id === id);
    if (!info) throw new Error('That wallet is no longer available');
    const adapter = new EvmWallet(info);
    const { address } = await adapter.connect();
    setEvm({ adapter, address, name: adapter.name });
    store.set(EVM_KEY, JSON.stringify({ id: info.id, name: info.name }));
    void autoSync(adapter, address, 'evm');
  }, [evmWallets, autoSync]);

  const connectSvm = useCallback(async () => {
    const p = getPhantom();
    if (!p) throw new Error('Phantom was not detected. Install it from phantom.com and reload.');
    const adapter = new SolanaWallet(p);
    const { address } = await adapter.connect();
    setSvm({ adapter, address });
    store.set(SVM_FLAG, '1');
    void autoSync(adapter, address, 'svm');
  }, [autoSync]);

  // Keep wallets connected across a page refresh. These restores are silent (no popups) and run once;
  // the saved choice is cleared only by the Disconnect button.
  useEffect(() => {
    if (restoredEvm.current || evmWallets.length === 0) return;
    const raw = store.get(EVM_KEY);
    if (!raw) { restoredEvm.current = true; return; }
    let saved: { id?: string; name?: string } = {};
    try { saved = JSON.parse(raw); } catch { /* ignore */ }
    const info = evmWallets.find((w) => w.id === saved.id) ?? evmWallets.find((w) => !!saved.name && w.name === saved.name);
    if (!info) return; // the wallet may still be announcing itself; this effect runs again when the list grows
    restoredEvm.current = true;
    const adapter = new EvmWallet(info);
    void adapter.restore().then((r) => { if (r) setEvm({ adapter, address: r.address, name: adapter.name }); });
  }, [evmWallets]);

  useEffect(() => {
    if (restoredSvm.current || !phantomAvailable) return;
    restoredSvm.current = true;
    const p = getPhantom();
    if (!p || !store.get(SVM_FLAG)) return;
    const adapter = new SolanaWallet(p);
    void adapter.restore().then((r) => { if (r) setSvm({ adapter, address: r.address }); });
  }, [phantomAvailable]);

  const connectNear = useCallback(async () => {
    const c = await getConnector();
    await c.connect(); // opens NEAR Connect's wallet picker; per its docs the connected wallet is then read with wallet()
    const wallet = await c.wallet();
    if (!wallet) throw new Error('No NEAR wallet was selected');
    await adoptNear(c, wallet);
  }, [getConnector, adoptNear]);

  const disconnect = useCallback((family: ConnectableFamily) => {
    // Disconnecting a wallet also ends its sign-in.
    const gone = family === 'evm' ? evm?.address : family === 'svm' ? svm?.address : near?.address;
    if (gone) setSessions((list) => list.filter((x) => !sameAddress(x.address, gone)));
    if (family === 'evm') { evm?.adapter.disconnect(); setEvm(null); store.del(EVM_KEY); }
    else if (family === 'svm') { svm?.adapter.disconnect(); setSvm(null); store.del(SVM_FLAG); }
    else { near?.adapter.disconnect(); setNear(null); try { localStorage.removeItem(NEAR_FLAG); } catch { /* ignore */ } }
  }, [evm, svm, near]);

  const signIn = useCallback(async (family: ConnectableFamily) => {
    const w = family === 'evm' ? evm : family === 'svm' ? svm : near;
    if (!w) throw new Error('Connect your wallet first');
    await signInWith(w.adapter, w.address, family);
  }, [evm, svm, near, signInWith]);

  // Merchant "Sign out" ends the EVM/Solana sign-in; each wallet's activity sign-in otherwise ends when it disconnects.
  const signOut = useCallback(() => {
    setSessions((list) => { const cur = list.find((x) => x.family !== 'near'); return cur ? list.filter((x) => x !== cur) : list; });
  }, []);

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
    connectedCount, session, sessions, signIn, signOut, syncing, walletModalOpen, openWalletModal, closeWalletModal,
  }), [evmWallets, evm, svm, near, phantomAvailable, connectEvm, connectSvm, connectNear, disconnect, adapterFor, addressFor,
    connectedCount, session, sessions, signIn, signOut, syncing, walletModalOpen, openWalletModal, closeWalletModal]);
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}
