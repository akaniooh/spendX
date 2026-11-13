import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startReconciler } from '../src/reconciler.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('the loop never overlaps runs, keeps going after an error, and stops when told to', async () => {
  let running = 0, maxRunning = 0, runs = 0;
  const logs: string[] = [];
  const rec = startReconciler({
    intervalMs: 5, firstRunMs: 1,
    log: (m) => logs.push(m),
    run: async () => {
      runs++; running++; maxRunning = Math.max(maxRunning, running);
      await sleep(15); // slower than the interval: a naive setInterval would overlap here
      running--;
      if (runs === 2) throw new Error('boom');
    },
  });
  await sleep(150);
  rec.stop();
  const stoppedAt = runs;
  assert.ok(runs >= 3, `kept going after the error (ran ${runs} times)`);
  assert.equal(maxRunning, 1, 'runs never overlap');
  assert.deepEqual(logs, ['Reconcile run failed']);
  await sleep(60);
  assert.equal(runs, stoppedAt, 'no more runs after stop()');
});
