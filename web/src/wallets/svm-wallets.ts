import type { Transaction } from '@solana/web3.js';
import type { SolanaProvider } from './svm.ts';
import { getPhantom } from './svm.ts';

// Finds every Solana wallet in the browser so Connect wallet is not limited to Phantom.
//
// 1. Wallet Standard (https://github.com/wallet-standard/wallet-standard): the open protocol that Phantom, Solflare, OKX,
//    Backpack, Coinbase, Trust and most others use to announce themselves, much like EIP-6963 does for EVM wallets.
//    Implemented here directly (the registry is two DOM events), so there is no extra dependency.
// 2. A few legacy injected providers (Phantom, Solflare, OKX), for wallets or versions that do not announce themselves.
//
// Every wallet is turned into the same small SolanaProvider shape that SolanaWallet (svm.ts) already drives.

export interface DiscoveredSvmWallet {
  id: string;
  name: string;
  icon?: string;
  provider: SolanaProvider;
}

const CHAIN = 'solana:mainnet';

// ---------- base58 (signatures come back from Wallet Standard as bytes; Solana shows them as base58) ----------
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

// ---------- Wallet Standard ----------
interface StdAccount { address: string; chains?: readonly string[] }
interface StdWallet {
  name: string;
  icon?: string;
  chains: readonly string[];
  accounts: readonly StdAccount[];
  features: Record<string, any>;
}

/** The app side of the Wallet Standard registry: wallets announce themselves to it, and we hear about each one. */
export function watchStandardWallets(onWallet: (w: StdWallet) => void): () => void {
  const seen = new Set<StdWallet>();
  const register = (...wallets: StdWallet[]) => {
    for (const w of wallets) if (!seen.has(w)) { seen.add(w); onWallet(w); }
    return () => {}; // wallets are not unregistered during a page's life in practice
  };
  const api = Object.freeze({ register, get: () => [...seen], on: () => () => {} });
  // Wallets that load after us dispatch this event with a callback in `detail`.
  const onRegister = (e: Event) => { try { (e as CustomEvent).detail(api); } catch { /* a broken wallet must not break the list */ } };
  window.addEventListener('wallet-standard:register-wallet', onRegister);
  // Wallets that loaded before us listen for this one.
  try { window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api })); } catch { /* ignore */ }
  return () => window.removeEventListener('wallet-standard:register-wallet', onRegister);
}

/** Adapts a Wallet Standard Solana wallet to SolanaProvider, or null when it cannot do what SpendX needs. */
export function standardProvider(w: StdWallet): SolanaProvider | null {
  const connectF = w.features['standard:connect'];
  const signF = w.features['solana:signMessage'];
  const sendF = w.features['solana:signAndSendTransaction'];
  if (!connectF || !signF || !sendF) return null; // sign-in and payments both need these
  if (!w.chains.includes(CHAIN)) return null;

  let account: StdAccount | null = null;
  const pick = (list: readonly StdAccount[]) => list.find((a) => a.chains?.includes(CHAIN)) ?? list[0] ?? null;
  const need = (): StdAccount => { if (!account) throw new Error('Wallet not connected'); return account; };

  return {
    async connect(opts) {
      const silent = !!opts?.onlyIfTrusted;
      // Already authorised for this site: no prompt needed.
      account = pick(w.accounts);
      if (!account || !silent) {
        const res = await connectF.connect(silent ? { silent: true } : undefined);
        account = pick(res?.accounts?.length ? res.accounts : w.accounts);
      }
      if (!account) throw new Error('The wallet did not return an account');
      const address = account.address;
      return { publicKey: { toBase58: () => address } };
    },
    async disconnect() {
      account = null;
      try { await w.features['standard:disconnect']?.disconnect(); } catch { /* ignore */ }
    },
    async signMessage(message) {
      const [out] = await signF.signMessage({ account: need(), message });
      return { signature: out.signature as Uint8Array };
    },
    async signAndSendTransaction(tx: Transaction) {
      const transaction = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const [out] = await sendF.signAndSendTransaction({ account: need(), transaction, chain: CHAIN });
      return { signature: base58Encode(out.signature as Uint8Array) };
    },
  };
}

// ---------- legacy injected providers ----------
/** For wallets whose connect({ onlyIfTrusted }) is not known to stay silent: reuse an existing connection, never prompt on a refresh. */
function passive(p: any): SolanaProvider {
  return {
    publicKey: p.publicKey,
    connect: async (opts) => {
      if (opts?.onlyIfTrusted) {
        if (p.isConnected && p.publicKey) return { publicKey: p.publicKey };
        throw new Error('Not connected');
      }
      return p.connect();
    },
    disconnect: () => p.disconnect(),
    signMessage: (m, d) => p.signMessage(m, d),
    signAndSendTransaction: (tx) => p.signAndSendTransaction(tx),
  } as SolanaProvider;
}

function legacyWallets(): DiscoveredSvmWallet[] {
  if (typeof window === 'undefined') return [];
  const w = window as any;
  const out: DiscoveredSvmWallet[] = [];
  const phantom = getPhantom();
  if (phantom) out.push({ id: 'legacy:phantom', name: 'Phantom', provider: phantom });
  if (w.solflare?.isSolflare) out.push({ id: 'legacy:solflare', name: 'Solflare', provider: passive(w.solflare) });
  if (w.okxwallet?.solana) out.push({ id: 'legacy:okx', name: 'OKX Wallet', provider: passive(w.okxwallet.solana) });
  return out;
}

const norm = (name: string) => name.toLowerCase().replace(/\s*wallet$/, '').trim();

/**
 * Calls onChange with every Solana wallet found so far, now and as more announce themselves.
 * The same wallet often shows up both ways: Phantom's injected provider (the one proven with real funds in SpendX) wins for
 * Phantom; for every other wallet the Wallet Standard entry wins, and the legacy provider only fills in when it is missing.
 */
export function discoverSvmWallets(onChange: (wallets: DiscoveredSvmWallet[]) => void): () => void {
  const standard = new Map<string, DiscoveredSvmWallet>();
  const emit = () => {
    const merged = new Map<string, DiscoveredSvmWallet>();
    for (const s of standard.values()) merged.set(norm(s.name), s);
    for (const l of legacyWallets()) {
      if (!merged.has(norm(l.name)) || norm(l.name) === 'phantom') merged.set(norm(l.name), l);
    }
    onChange([...merged.values()]);
  };
  const stop = watchStandardWallets((w) => {
    const provider = standardProvider(w);
    if (!provider) return;
    standard.set(`std:${w.name}`, { id: `std:${w.name}`, name: w.name, icon: w.icon, provider });
    emit();
  });
  emit();
  // Extensions inject a moment after page load.
  const t = setTimeout(emit, 800);
  const t2 = setTimeout(emit, 2500);
  return () => { stop(); clearTimeout(t); clearTimeout(t2); };
}
