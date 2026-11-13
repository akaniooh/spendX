// Drives the real SolanaWallet adapter against a stand-in for @solana/web3.js and a fake Phantom.
// This checks OUR wiring (account order, instruction bytes, refusals), not web3.js itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '../../shared/src/spl.ts';

const stub = new URL('./fixtures/solana-stub.mjs', import.meta.url).href;
const chainsStub = new URL('./fixtures/solana-stub-chains.mjs', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === '@solana/web3.js') return { url: ${JSON.stringify(stub)}, shortCircuit: true };
    if (spec.endsWith('/lib/chains.ts')) return { url: ${JSON.stringify(chainsStub)}, shortCircuit: true };
    return next(spec, ctx);
  }
`)}`);

const { SolanaWallet } = await import('../src/wallets/svm.ts');
const { PublicKey } = await import(stub);

const FROM = 'So11111111111111111111111111111111111111112'; // any valid 32-byte address will do
const DEPOSIT = 'GDfnEsia2WLAW5t8yx2X5j2mkfA74i5kwGdDuZHt7XmG';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SYSTEM = '11111111111111111111111111111111';
const PENGU = { assetId: 'nep141:sol-pengu.omft.near', blockchain: 'sol', symbol: 'PENGU', decimals: 6, contractAddress: MINT };
const ataOf = (owner: string) => `ata(${owner}|${MINT}|${TOKEN_PROGRAM_ID}|${ASSOCIATED_TOKEN_PROGRAM_ID})`;
const tokenAcct = (address: string, amount: string, o: { decimals?: number; state?: string } = {}) => ({
  pubkey: new PublicKey(address),
  account: { data: { parsed: { info: { state: o.state ?? 'initialized', tokenAmount: { amount, decimals: o.decimals ?? 6 } } } } },
});

function setup(o: { mintOwner?: string | null; dest?: 'missing' | 'ok' | 'foreign'; lamports?: number; accounts?: ReturnType<typeof tokenAcct>[] } = {}) {
  const sent: any[] = [];
  const g = globalThis as any;
  g.__sol = {
    lamports: o.lamports ?? 50_000_000,
    tokenAccounts: o.accounts ?? [tokenAcct(ataOf(FROM), '5000000000')],
    accounts: {
      ...(o.mintOwner === null ? {} : { [MINT]: { owner: new PublicKey(o.mintOwner ?? TOKEN_PROGRAM_ID) } }),
      ...(o.dest === 'ok' ? { [ataOf(DEPOSIT)]: { owner: new PublicKey(TOKEN_PROGRAM_ID) } } : {}),
      ...(o.dest === 'foreign' ? { [ataOf(DEPOSIT)]: { owner: new PublicKey(SYSTEM) } } : {}),
    },
  };
  const provider = {
    isPhantom: true,
    connect: async () => ({ publicKey: { toBase58: () => FROM } }),
    disconnect: async () => {},
    signMessage: async () => new Uint8Array(),
    signAndSendTransaction: async (tx: unknown) => { sent.push(tx); return { signature: 'SIG123' }; },
  };
  return { sent, w: new SolanaWallet(provider as never) };
}
const req = (amount: bigint, extra: object = {}) => ({ token: PENGU, amount, depositAddress: DEPOSIT, ...extra });
const connected = async (o?: Parameters<typeof setup>[0]) => { const s = setup(o); await s.w.connect(); return s; };

test('SPL payment, recipient token account missing: creates it, then one TransferChecked, in the right account order', async () => {
  const { w, sent } = await connected({ dest: 'missing' });
  const r = await w.sendDeposit(req(1_500_000n));
  assert.equal(r.txHash, 'SIG123');
  assert.equal(sent.length, 1);
  const tx = sent[0];
  assert.equal(tx.feePayer.toBase58(), FROM);
  assert.equal(tx.recentBlockhash, 'BLOCKHASH');
  assert.equal(tx.instructions.length, 2);

  const [create, transfer] = tx.instructions;
  assert.equal(create.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID);
  assert.deepEqual([...create.data], [1]); // CreateIdempotent
  assert.deepEqual(create.keys.map((k: any) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [FROM, true, true],               // payer
    [ataOf(DEPOSIT), false, true],    // the account being created
    [DEPOSIT, false, false],          // its owner: the 1Click deposit address
    [MINT, false, false],
    [SYSTEM, false, false],
    [TOKEN_PROGRAM_ID, false, false],
  ]);

  assert.equal(transfer.programId.toBase58(), TOKEN_PROGRAM_ID);
  assert.deepEqual([...transfer.data], [12, 0x60, 0xe3, 0x16, 0, 0, 0, 0, 0, 6]); // opcode 12, 1_500_000 LE, decimals 6
  assert.deepEqual(transfer.keys.map((k: any) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [ataOf(FROM), false, true],       // source: the sender's own token account
    [MINT, false, false],
    [ataOf(DEPOSIT), false, true],    // destination: the deposit address's token account, never the wallet address itself
    [FROM, true, false],              // owner/authority signs
  ]);
  assert.equal((globalThis as any).__sol.rentSize, 165);
});

test('SPL payment, recipient token account already exists: only the transfer, no rent needed', async () => {
  const { w, sent } = await connected({ dest: 'ok', lamports: 20_000 }); // enough for the fee, nowhere near rent
  await w.sendDeposit(req(1_000_000n));
  assert.equal(sent[0].instructions.length, 1);
  assert.equal(sent[0].instructions[0].programId.toBase58(), TOKEN_PROGRAM_ID);
  assert.equal((globalThis as any).__sol.rentSize, undefined, 'rent is not even requested');
});

test('SPL payment refuses, and never reaches the wallet, when something is off', async () => {
  const cases: [string, Parameters<typeof setup>[0], bigint, RegExp][] = [
    ['not enough SOL to open the recipient account', { dest: 'missing', lamports: 1_000_000 }, 1n, /Not enough SOL.*0\.002/],
    ['not enough SOL even for the fee', { dest: 'ok', lamports: 100 }, 1n, /Not enough SOL to pay the network fee/],
    ['Token-2022 mint', { mintOwner: TOKEN_2022_PROGRAM_ID }, 1n, /Token-2022/],
    ['mint not found', { mintOwner: null }, 1n, /not found/],
    ['mint owned by some other program', { mintOwner: SYSTEM }, 1n, /not a standard Solana token/],
    ['recipient account is not a token account', { dest: 'foreign' }, 1n, /unexpected account/],
    ['not enough tokens', {}, 9_000_000_000n, /Insufficient PENGU/],
    ['no token account at all', { accounts: [] }, 1n, /no PENGU/],
    ['frozen account', { accounts: [tokenAcct(ataOf(FROM), '5000000000', { state: 'frozen' })] }, 1n, /frozen/],
    ['decimals disagree with the listing', { accounts: [tokenAcct(ataOf(FROM), '5000000000', { decimals: 9 })] }, 1n, /decimals/],
  ];
  for (const [name, o, amount, re] of cases) {
    const { w, sent } = await connected(o);
    await assert.rejects(w.sendDeposit(req(amount)), re, name);
    assert.equal(sent.length, 0, `${name}: nothing may be sent to the wallet`);
  }
  const { w, sent } = await connected({});
  await assert.rejects(w.sendDeposit(req(1n, { depositMemo: 'abc' })), /memo/);
  assert.equal(sent.length, 0);
});

test('SPL balance: totals the usable accounts and skips frozen ones; native SOL balance is unchanged', async () => {
  const { w } = await connected({ accounts: [tokenAcct('A1', '300'), tokenAcct('A2', '200'), tokenAcct('A3', '999', { state: 'frozen' })] });
  assert.equal(await w.getBalance(PENGU), 500n);
  assert.deepEqual((globalThis as any).__sol.lastTokenQuery, { owner: FROM, mint: MINT });
  assert.equal(await w.getBalance({ assetId: 'sol', blockchain: 'sol', symbol: 'SOL', decimals: 9 }), 50_000_000n);
  const t22 = await connected({ mintOwner: TOKEN_2022_PROGRAM_ID });
  await assert.rejects(t22.w.getBalance(PENGU), /Token-2022/);
});

test('native SOL payments still work exactly as before', async () => {
  const { w, sent } = await connected({});
  await w.sendDeposit({ token: { assetId: 'sol', blockchain: 'sol', symbol: 'SOL', decimals: 9 }, amount: 1_000_000n, depositAddress: DEPOSIT });
  assert.equal(sent[0].instructions.length, 1);
  assert.equal(sent[0].instructions[0].kind, 'system-transfer');
  assert.equal(sent[0].instructions[0].lamports, 1_000_000n);
  await assert.rejects(w.sendDeposit({ token: { assetId: 'sol', blockchain: 'sol', symbol: 'SOL', decimals: 9 }, amount: 99_000_000n, depositAddress: DEPOSIT }), /Insufficient SOL/);
});
