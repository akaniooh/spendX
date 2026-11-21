import { countdownLabel, secondsLeft } from '../lib/clock.ts';
import { useNow } from '../lib/hooks.ts';

/** Ticks every second against the server's clock. Turns amber in the last minute and says "Expired" at zero. */
export function Countdown({ until, prefix = 'Expires in' }: { until: string; prefix?: string }) {
  const left = secondsLeft(until, useNow());
  if (left <= 0) return <span className="countdown">Expired</span>;
  return <span className={`countdown ${left < 60 ? 'warn' : ''}`}>{prefix} <b>{countdownLabel(left)}</b></span>;
}
