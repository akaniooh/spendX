// Solana wallet discovery: Wallet Standard registry, the provider adapter, and the Phantom/legacy merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { base58Decode } from '../../shared/src/addresses.ts';

const stub = new URL('./fixtures/solana-stub.mjs', import.meta.url).href;
const chainsStub = new URL('./fixtures/solana-stub-chains.mjs', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === '@solana/web3.js') return { url: ${JSON.stringify(stub)}, shortCircuit: true };
    if (spec.endsWith('/lib/chains.ts')) return { url: ${JSON.stringify(chainsStub)}, shortCircuit: true };
    return next(spec, ctx);
  }
`)}`);

const win: any = new EventTarget();
win.location = { origin: 'http://localhost' };
(globalThis as any).window = win;
const { base58Encode, standardProvider, watchStandardWallets, discoverSvmWallets } = await import('../src/wallets/svm-wallets.ts');

const ADDR = 'So11111111111111111111111111111111111111112';
function fakeWallet(name: string, over: { features?: Record<string, unknown>; chains?: string[]; authorised?: boolean } = {}) {
  const calls: any = { connect: [], sign: [], send: [] };
  const acct = { address: ADDR, chains: ['solana:mainnet'] };
  const wallet: any = {
    name, icon: 'data:image/svg+xml;base64,AAAA', chains: over.chains ?? ['solana:mainnet'],
    accounts: over.authorised ? [acct] : [],
    features: over.features ?? {
      'standard:connect': { connect: async (o: unknown) => { calls.connect.push(o); wallet.accounts = [acct]; return { accounts: [acct] }; } },
      'solana:signMessage': { signMessage: async (i: any) => { calls.sign.push(i); return [{ signature: new Uint8Array([1, 2, 3]) }]; } },
      'solana:signAndSendTransaction': { signAndSendTransaction: async (i: any) => { calls.send.push(i); return [{ signature: new Uint8Array([0, 0, 1]) }]; } },
    },
  };
  return { wallet, calls };
}
/** What a wallet extension does: announce itself through the Wallet Standard registration event. */
const announce = (w: unknown) => win.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: (api: any) => api.register(w) }));

test('base58Encode: leading zero bytes become 1s, and it round-trips with base58Decode', () => {
  assert.equal(base58Encode(new Uint8Array([0, 0, 1])), '112');
  assert.equal(base58Encode(new Uint8Array()), '');
  const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256);
  assert.deepEqual([...base58Decode(base58Encode(bytes))!], [...bytes]);
  assert.deepEqual([...base58Decode(ADDR)!], [...base58Decode(base58Encode(base58Decode(ADDR)!))!]);
});

test('a wallet that announces itself after the page loaded is picked up', () => {
  const seen: string[] = [];
  const stop = watchStandardWallets((w) => seen.push(w.name));
  announce(fakeWallet('OKX Wallet').wallet);
  announce(fakeWallet('Solflare').wallet);
  stop();
  assert.deepEqual(seen, ['OKX Wallet', 'Solflare']);
});

test('a wallet that was already waiting is picked up when the app announces it is ready', () => {
  const { wallet } = fakeWallet('Backpack');
  const onReady = (e: Event) => (e as CustomEvent).detail.register(wallet);
  win.addEventListener('wallet-standard:app-ready', onReady);
  const seen: string[] = [];
  const stop = watchStandardWallets((w) => seen.push(w.name));
  stop();
  win.removeEventListener('wallet-standard:app-ready', onReady);
  assert.deepEqual(seen, ['Backpack']);
});

test('standardProvider: connect, sign, send; the signature comes back as base58', async () => {
  const { wallet, calls } = fakeWallet('OKX Wallet');
  const p = standardProvider(wallet)!;
  const res = await p.connect();
  assert.equal((res as any).publicKey.toBase58(), ADDR);
  const sig = await p.signMessage(new Uint8Array([9]), 'utf8');
  assert.deepEqual([...(sig as any).signature], [1, 2, 3]);
  assert.equal(calls.sign[0].account.address, ADDR);
  const sent = await p.signAndSendTransaction({ serialize: (o: any) => { assert.equal(o.requireAllSignatures, false); return new Uint8Array([7]); } } as any);
  assert.deepEqual(sent, { signature: '112' });
  assert.equal(calls.send[0].chain, 'solana:mainnet');
  assert.deepEqual([...calls.send[0].transaction], [7]);
});

test('standardProvider: a silent restore never prompts when the site is already authorised, and fails quietly when it is not', async () => {
  const known = fakeWallet('Solflare', { authorised: true });
  const r = await standardProvider(known.wallet)!.connect({ onlyIfTrusted: true });
  assert.equal((r as any).publicKey.toBase58(), ADDR);
  assert.equal(known.calls.connect.length, 0);

  const fresh = fakeWallet('Solflare');
  fresh.wallet.features['standard:connect'].connect = async () => ({ accounts: [] });
  await assert.rejects(() => standardProvider(fresh.wallet)!.connect({ onlyIfTrusted: true }), /did not return an account/);
});

test('wallets that cannot sign messages, send transactions, or run on Solana mainnet are left out', () => {
  const full = fakeWallet('X').wallet.features;
  assert.equal(standardProvider(fakeWallet('Sui wallet', { chains: ['sui:mainnet'] }).wallet), null);
  assert.equal(standardProvider(fakeWallet('Devnet only', { chains: ['solana:devnet'] }).wallet), null);
  const { 'solana:signMessage': _a, ...noSign } = full;
  assert.equal(standardProvider(fakeWallet('No sign', { features: noSign }).wallet), null);
  const { 'solana:signAndSendTransaction': _b, ...noSend } = full;
  assert.equal(standardProvider(fakeWallet('No send', { features: noSend }).wallet), null);
});

test('discoverSvmWallets: lists each wallet once; Phantom keeps its injected provider, others use the Wallet Standard one', () => {
  const phantomProvider = { isPhantom: true, connect: async () => ({}), disconnect: async () => {}, signMessage: async () => new Uint8Array(), signAndSendTransaction: async () => 'x' };
  (win as any).phantom = { solana: phantomProvider };
  (win as any).solflare = { isSolflare: true, connect: async () => ({}), disconnect: async () => {}, signMessage: async () => new Uint8Array(), signAndSendTransaction: async () => 'x' };
  let latest: any[] = [];
  const stop = discoverSvmWallets((l) => { latest = l; });
  announce(fakeWallet('Phantom').wallet);
  announce(fakeWallet('Solflare').wallet);
  announce(fakeWallet('OKX Wallet').wallet);
  stop();
  const byName = Object.fromEntries(latest.map((w) => [w.name, w]));
  assert.deepEqual(Object.keys(byName).sort(), ['OKX Wallet', 'Phantom', 'Solflare']);
  assert.equal(byName['Phantom'].provider, phantomProvider);
  assert.equal(byName['Phantom'].id, 'legacy:phantom');
  assert.equal(byName['Solflare'].id, 'std:Solflare');
  assert.ok(byName['OKX Wallet'].icon);
  delete (win as any).phantom; delete (win as any).solflare;
});
