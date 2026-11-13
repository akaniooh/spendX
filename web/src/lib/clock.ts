// The browser's clock is not trustworthy: a PC set a few days (or minutes) wrong makes every countdown, and the
// "has this quote expired?" check, wrong. Each API response carries the server's time in its Date header, so we work
// out how far off the local clock is and correct for it. No React here, so the signing logic can use it too.

let offsetMs = 0;

/** Server time minus local time, from an HTTP Date header. undefined when the header is missing or unreadable. */
export function clockOffsetFromDateHeader(dateHeader: string | null | undefined, localNowMs: number): number | undefined {
  if (!dateHeader) return undefined;
  const server = Date.parse(dateHeader);
  return Number.isFinite(server) ? server - localNowMs : undefined;
}

export function setClockOffset(ms: number): void {
  offsetMs = ms;
}

export function getClockOffset(): number {
  return offsetMs;
}

/** "Now" according to the server, as far as we can tell. */
export function correctedNow(): number {
  return Date.now() + offsetMs;
}

export function secondsLeft(deadlineIso: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(deadlineIso) - now) / 1000));
}

export const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
