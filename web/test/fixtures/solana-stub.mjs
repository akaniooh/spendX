// A tiny stand-in for @solana/web3.js, just enough to drive the Solana wallet adapter in a test.
// Behaviour is controlled through globalThis.__sol (see the test).
const enc = new TextEncoder();
const dec = new TextDecoder();

export class PublicKey {
  constructor(v) { this.v = typeof v === 'string' ? v : dec.decode(v); }
  toBase58() { return this.v; }
  toBytes() { return enc.encode(this.v); }
  equals(o) { return o.v === this.v; }
  // Fake, deterministic PDA: seeds are [owner, tokenProgram, mint]. Readable so the test can assert on it.
  static findProgramAddressSync(seeds, programId) {
    const [owner, tokenProgram, mint] = seeds.map((s) => dec.decode(s));
    return [new PublicKey(`ata(${owner}|${mint}|${tokenProgram}|${programId.toBase58()})`), 255];
  }
}
export const SystemProgram = {
  programId: new PublicKey('11111111111111111111111111111111'),
  transfer: (o) => ({ kind: 'system-transfer', ...o }),
};
export class TransactionInstruction {
  constructor(o) { Object.assign(this, o); }
}
export class Transaction {
  constructor() { this.instructions = []; }
  add(ix) { this.instructions.push(ix); return this; }
}
export class Connection {
  async getAccountInfo(pk) { return globalThis.__sol.accounts[pk.toBase58()] ?? null; }
  async getParsedTokenAccountsByOwner(owner, filter) {
    globalThis.__sol.lastTokenQuery = { owner: owner.toBase58(), mint: filter.mint.toBase58() };
    return { value: globalThis.__sol.tokenAccounts };
  }
  async getBalance() { return globalThis.__sol.lamports; }
  async getMinimumBalanceForRentExemption(size) { globalThis.__sol.rentSize = size; return 2_039_280; }
  async getLatestBlockhash() { return { blockhash: 'BLOCKHASH' }; }
}
