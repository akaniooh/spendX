import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnrecognizedChainError, switchOrAddChain } from '../src/lib/switch-chain.ts';

const chain = { id: 143, name: 'Monad' };
function wallet(opts: { switchFirst?: unknown; addFails?: unknown } = {}) {
  const calls: string[] = [];
  let switched = 0;
  return {
    calls,
    wc: {
      async switchChain({ id }: { id: number }) { calls.push(`switch ${id}`); if (switched++ === 0 && opts.switchFirst) throw opts.switchFirst; },
      async addChain({ chain: c }: { chain: { id: number } }) { calls.push(`add ${c.id}`); if (opts.addFails) throw opts.addFails; },
    },
  };
}

test('a wallet that already has the chain is just switched; nothing is added', async () => {
  const w = wallet();
  await switchOrAddChain(w.wc, chain);
  assert.deepEqual(w.calls, ['switch 143']);
});

test('a wallet that does not know the chain is asked to add it, then switched', async () => {
  for (const err of [
    Object.assign(new Error('Unrecognized chain ID "0x8f". Try adding the chain using wallet_addEthereumChain first.'), { code: 4902 }),
    { code: -32603, message: 'Unrecognized chain ID' },
    { code: 4902 },
    { message: 'wrapped', cause: { code: 4902 } },
    { data: { originalError: { code: 4902 } }, message: 'x' },
  ]) {
    const w = wallet({ switchFirst: err });
    await switchOrAddChain(w.wc, chain);
    assert.deepEqual(w.calls, ['switch 143', 'add 143', 'switch 143'], JSON.stringify(err));
  }
});

test('a user who rejects the switch is never made to add a network, and the error is passed on', async () => {
  const rejected = Object.assign(new Error('User rejected the request.'), { code: 4001 });
  const w = wallet({ switchFirst: rejected });
  await assert.rejects(switchOrAddChain(w.wc, chain), (e) => e === rejected);
  assert.deepEqual(w.calls, ['switch 143']);
  // a 4001 whose text happens to mention adding a chain is still a rejection
  const tricky = Object.assign(new Error('User rejected. Try adding the chain later'), { code: 4001 });
  assert.equal(isUnrecognizedChainError(tricky), false);
});

test('other failures are not turned into an add-network prompt', async () => {
  const boom = new Error('RPC node unreachable');
  const w = wallet({ switchFirst: boom });
  await assert.rejects(switchOrAddChain(w.wc, chain), (e) => e === boom);
  assert.deepEqual(w.calls, ['switch 143']);
});

test('if the user refuses to add the network, that is reported and no payment can follow', async () => {
  const refused = Object.assign(new Error('User rejected the request.'), { code: 4001 });
  const w = wallet({ switchFirst: { code: 4902 }, addFails: refused });
  await assert.rejects(switchOrAddChain(w.wc, chain), (e) => e === refused);
  assert.deepEqual(w.calls, ['switch 143', 'add 143']);
});
