/** Human decimal string -> integer base units. Throws on bad input or too many decimals. */
export function toBaseUnits(human: string, decimals: number): bigint {
  const s = human.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount "${human}"`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    throw new Error(`Amount "${human}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole + frac.padEnd(decimals, '0'));
}

/** Integer base units -> human decimal string without trailing zeros. */
export function fromBaseUnits(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const s = abs.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}
