import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ChainIcon, Icon } from './Icon.tsx';
import { chainLabel } from '../lib/labels.ts';

export interface ReviewProps {
  label: string; // "You send" / "You pay"
  title: string; // "10 SOL"
  fromChain: string;
  toChain: string;
  lines: [string, ReactNode][];
  secondsLeft: number;
  approveLabel: string;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onCancel: () => void; // cancels the attempt (nothing was sent)
}

export function ReviewModal(p: ReviewProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !p.busy) p.onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.busy, p.onCancel]);
  const expired = p.secondsLeft === 0;

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={p.label}>
      <button className="backdrop" aria-label="Close" onClick={() => !p.busy && p.onCancel()} />
      <div className="modal">
        <button className="modal-close" aria-label="Close" disabled={p.busy} onClick={p.onCancel}><Icon name="close" size={18} /></button>
        <div className="review-head">
          <span className="eyebrow">{p.label}</span>
          <h2>{p.title}</h2>
          <div className="review-route"><ChainIcon chain={p.fromChain} small /> {chainLabel(p.fromChain)} <Icon name="arrow" size={16} /> <ChainIcon chain={p.toChain} small /> {chainLabel(p.toChain)}</div>
        </div>
        <div className="review-lines">{p.lines.map(([k, v]) => <div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>
        <div className="review-foot">
          {expired
            ? <button className="cta" onClick={p.onCancel}>Quote expired. Start again</button>
            : <button className="cta" disabled={p.busy} onClick={p.onApprove}>{p.busy ? 'Waiting for your wallet…' : p.approveLabel}</button>}
          {p.error && <p className="inline-error" style={{ textAlign: 'center' }}>{p.error}</p>}
        </div>
        <p className="modal-note" style={{ marginTop: 'var(--s3)' }}>Your wallet shows one transaction to approve. SpendX never holds your funds or keys.</p>
      </div>
    </div>
  );
}
