// Icons for chains and tokens are drawn locally (no remote images): a coloured disc with a short mark.
// Known networks and tokens get their familiar colour; anything new in the catalog gets a stable colour from its name.

const CHAIN_COLORS: Record<string, string> = {
  eth: '#627eea', base: '#0052ff', arb: '#28a0f0', op: '#ff0420', pol: '#8247e5', bsc: '#f0b90b', avax: '#e84142',
  gnosis: '#04795b', scroll: '#e8c595', sol: '#9945ff', near: '#00ec97', btc: '#f7931a', ton: '#0098ea', sui: '#4da2ff',
  aptos: '#2dd8a7', tron: '#eb0029', doge: '#c2a633', ltc: '#345d9d', xrp: '#23292f', zec: '#f4b728', stellar: '#7d00ff',
};
const TOKEN_COLORS: Record<string, string> = {
  USDC: '#2775ca', USDT: '#26a17b', SOL: '#9945ff', ETH: '#627eea', NEAR: '#00ec97', WNEAR: '#00ec97', BTC: '#f7931a',
  DAI: '#f5ac37', WETH: '#627eea',
};

export function hashColor(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return `hsl(${Math.abs(h) % 360} 52% 42%)`;
}

export const chainColor = (blockchain: string): string => CHAIN_COLORS[blockchain] ?? hashColor('chain:' + blockchain);
export const tokenColor = (symbol: string, blockchain: string): string => TOKEN_COLORS[symbol.toUpperCase()] ?? hashColor(`${blockchain}:${symbol}`);

/** Dark text on light discs (like NEAR green or BNB yellow), white on the rest. */
export function contrastText(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.62 ? '#07100d' : '#ffffff';
}

export const chainMark = (blockchain: string): string => blockchain.slice(0, blockchain.length > 4 ? 3 : 2).toUpperCase();
export const tokenMark = (symbol: string): string => (symbol.replace(/[^A-Za-z0-9$]/g, '')[0] ?? '?').toUpperCase();
