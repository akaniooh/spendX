// Runs a job on a fixed pause between runs: never two at once, survives errors, stops cleanly.
export interface Reconciler { stop(): void }

export function startReconciler(o: {
  run: () => Promise<unknown>;
  intervalMs: number;
  /** delay before the first run (default: the interval, at most 5s) */
  firstRunMs?: number;
  log: (message: string, error?: unknown) => void;
}): Reconciler {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(tick, ms);
    timer.unref?.(); // never keeps the process alive on its own
  };
  async function tick() {
    if (stopped) return;
    try { await o.run(); } catch (e) { o.log('Reconcile run failed', e); }
    schedule(o.intervalMs);
  }
  schedule(o.firstRunMs ?? Math.min(o.intervalMs, 5000));
  return { stop() { stopped = true; if (timer) clearTimeout(timer); } };
}
