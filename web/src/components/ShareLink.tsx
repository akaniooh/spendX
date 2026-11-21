import { useState } from 'react';
import type { ReactNode } from 'react';
import { shareTargets } from '../lib/share.ts';

const GLYPHS: Record<'x' | 'whatsapp' | 'instagram' | 'tiktok' | 'more', ReactNode> = {
  x: <path fill="currentColor" stroke="none" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />,
  whatsapp: (<><path d="M3 21l1.65-4.9A8.5 8.5 0 1 1 8 19.4L3 21z" /><path d="M9.2 8.6c.3 1.8 2.1 3.6 4.2 4.4l1-1.1 1.9.9c-.2 1-1 1.6-2 1.5-2.7-.4-5.4-3.3-5.6-5.8 0-1 .6-1.8 1.4-1.9z" /></>),
  instagram: (<><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" fill="currentColor" /></>),
  tiktok: (<><path d="M14 3v11.2a3.8 3.8 0 1 1-3.8-3.8" /><path d="M14 3c.4 2.6 2.1 4.2 5 4.4" /></>),
  more: (<><circle cx="6" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18" cy="12" r="1.4" fill="currentColor" /></>),
};

function Glyph({ name }: { name: keyof typeof GLYPHS }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{GLYPHS[name]}</svg>;
}

/** Share buttons for a finished payment link: X, WhatsApp, Instagram, TikTok, and the phone's own share sheet where there is one. */
export function ShareLink({ url, text }: { url: string; text: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = shareTargets(url, text);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // Instagram and TikTok cannot be handed a link, so copy it and open the site to paste into a bio, story, post or message.
  const copyAndOpen = async (site: string, name: string) => {
    window.open(site, '_blank', 'noopener,noreferrer');
    try { await navigator.clipboard.writeText(url); setMsg(`Link copied. Paste it in your ${name} bio, story or message.`); }
    catch { setMsg(`Copy the link above, then paste it in ${name}.`); }
  };
  const nativeShare = async () => {
    try { await navigator.share({ title: 'SpendX payment link', text, url }); } catch { /* the person closed the share sheet */ }
  };

  return (
    <div className="m-share">
      <span className="eyebrow">Share link</span>
      <div className="m-share-row">
        <a className="share-btn" href={t.x} target="_blank" rel="noopener noreferrer"><Glyph name="x" />X</a>
        <a className="share-btn" href={t.whatsapp} target="_blank" rel="noopener noreferrer"><Glyph name="whatsapp" />WhatsApp</a>
        <button type="button" className="share-btn" onClick={() => copyAndOpen(t.instagram, 'Instagram')}><Glyph name="instagram" />Instagram</button>
        <button type="button" className="share-btn" onClick={() => copyAndOpen(t.tiktok, 'TikTok')}><Glyph name="tiktok" />TikTok</button>
        {canShare && <button type="button" className="share-btn" onClick={nativeShare}><Glyph name="more" />More</button>}
      </div>
      {msg && <small className="muted m-share-note" role="status">{msg}</small>}
    </div>
  );
}
