import { useSyncExternalStore } from 'react';
import { api } from './api.ts';
export { iconSources } from './icon-sources.ts';

// Logos come from the server (CoinGecko, cached there). Anything missing falls back to the PNGs in public/icons,
// then to a coloured letter disc. Loading never blocks or breaks the page: on any error the maps stay empty.

export interface IconMaps {
  chains: Record<string, string>;
  tokens: Record<string, string>;
}

const EMPTY: IconMaps = { chains: {}, tokens: {} };
let maps: IconMaps = EMPTY;
let started = false;
const listeners = new Set<() => void>();

function start(): void {
  if (started) return;
  started = true;
  api.icons()
    .then((m) => {
      maps = { chains: m.chains ?? {}, tokens: m.tokens ?? {} };
      listeners.forEach((l) => l());
    })
    .catch(() => { /* keep the built-in icons */ });
}

/** The server's logo maps (empty until loaded). The first caller starts the one request. */
export function useIconMaps(): IconMaps {
  return useSyncExternalStore(
    (l) => { listeners.add(l); start(); return () => { listeners.delete(l); }; },
    () => maps,
    () => EMPTY,
  );
}
