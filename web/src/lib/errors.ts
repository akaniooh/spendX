/** True when the user dismissed or rejected a wallet prompt (EIP-1193 code 4001, viem and Phantom wording). */
export function isUserRejection(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: any = e;
  for (let i = 0; i < 4 && cur && typeof cur === 'object' && !seen.has(cur); i++) {
    seen.add(cur);
    if (cur.code === 4001 || cur.code === 'ACTION_REJECTED') return true;
    if (typeof cur.name === 'string' && /UserRejected/i.test(cur.name)) return true;
    if (typeof cur.message === 'string' && /user (rejected|denied|cancel)|rejected the request|request rejected|declined/i.test(cur.message)) return true;
    cur = cur.cause;
  }
  return false;
}

export function errorMessage(e: unknown): string {
  if (isUserRejection(e)) return 'You cancelled the request in your wallet. Nothing was sent.';
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const m = (e as { message: string }).message;
    return m.length > 300 ? m.slice(0, 300) + '…' : m;
  }
  return 'Something went wrong';
}
