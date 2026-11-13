export type Route =
  | { name: 'home' }
  | { name: 'payments' }
  | { name: 'swap' }
  | { name: 'pay'; slug: string }
  | { name: 'activity' }
  | { name: 'attempt'; id: string }
  | { name: 'merchant' }
  | { name: 'notfound' };

/** Hash routes: "#/pay/abc123". Takes the hash without the leading "#". */
export function matchRoute(hash: string): Route {
  const path = (hash || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);
  if (seg.length === 0) return { name: 'home' };
  if (seg.length === 1 && seg[0] === 'payments') return { name: 'payments' };
  if (seg.length === 1 && seg[0] === 'swap') return { name: 'swap' };
  if (seg.length === 1 && seg[0] === 'activity') return { name: 'activity' };
  if (seg.length === 1 && seg[0] === 'merchant') return { name: 'merchant' };
  if (seg.length === 2 && seg[0] === 'pay' && /^[A-Za-z0-9_-]{8,64}$/.test(seg[1])) return { name: 'pay', slug: seg[1] };
  if (seg.length === 2 && seg[0] === 'attempt' && /^[0-9a-fA-F-]{16,64}$/.test(seg[1])) return { name: 'attempt', id: seg[1] };
  return { name: 'notfound' };
}

/** Accepts a pasted payment link ("https://host/#/pay/slug") or a bare slug. */
export function slugFromInput(input: string): string | null {
  const t = input.trim();
  const m = /#\/pay\/([A-Za-z0-9_-]{8,64})/.exec(t) ?? /^([A-Za-z0-9_-]{8,64})$/.exec(t);
  return m ? m[1] : null;
}

/** A SpendX payment link inside free text (link form only; a bare word is never treated as a payment). */
export function payLinkSlug(text: string): string | null {
  const m = /#\/pay\/([A-Za-z0-9_-]{8,64})/.exec(text);
  return m ? m[1] : null;
}
