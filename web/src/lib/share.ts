/** Where each social app can take a payment link. X and WhatsApp accept a ready-made post; Instagram and TikTok have no
 * "share this link" address, so for those the app copies the link and opens the site to paste it into. */
export function shareText(amountFormatted: string, symbol: string, note?: string | null): string {
  const base = `Pay ${amountFormatted} ${symbol} with SpendX`;
  return note && note.trim() ? `${base} (${note.trim()})` : base;
}

export function shareTargets(url: string, text: string) {
  return {
    x: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    instagram: 'https://www.instagram.com/',
    tiktok: 'https://www.tiktok.com/',
  };
}
