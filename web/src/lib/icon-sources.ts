/** Image sources to try, in order: the server's (CoinGecko) logo first, then our own PNG. Only https or same-site paths. */
export function iconSources(remote?: string, local?: string): string[] {
  return [remote, local].filter((u): u is string => !!u && (u.startsWith('https://') || u.startsWith('/')));
}
