import { useEffect, useState } from 'react';
import { correctedNow } from './clock.ts';
export { mmss, secondsLeft } from './clock.ts'; // pure helpers live in clock.ts so tests can use them without React

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(correctedNow());
  useEffect(() => {
    const t = setInterval(() => setNow(correctedNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
