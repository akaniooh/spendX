import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { chainLabel } from '../lib/labels.ts';
import { loadHistory } from '../lib/history.ts';
import type { HistoryEntry } from '../lib/history.ts';
import { ChainIcon, Icon, Skeleton } from './Icon.tsx';

function StatusChip({ id }: { id: string }) {
  const [s, setS] = useState<{ label: string; kind: string } | null>(null);
  useEffect(() => {
    let off = false;
    api.attempt(id)
      .then((d) => { if (!off) setS({ label: d.attempt.stateLabel, kind: d.attempt.state === 'destination_confirmed' ? 'ok' : d.attempt.terminal ? 'bad' : 'pending' }); })
      .catch(() => { if (!off) setS({ label: 'Unavailable', kind: 'bad' }); });
    return () => { off = true; };
  }, [id]);
  if (!s) return <Skeleton w="96px" h="24px" />;
  return <span className={`status ${s.kind}`}>{s.kind === 'ok' && <Icon name="check" size={14} />}{s.label}</span>;
}

export function ActivityTable({ limit }: { limit?: number }) {
  const rows: HistoryEntry[] = useMemo(() => loadHistory().slice(0, limit ?? 50), [limit]);
  if (rows.length === 0) {
    return <div className="empty-state"><Icon name="history" size={24} /><p>No activity yet.</p></div>;
  }
  return (
    <div className="activity-table">
      <div className="table-head"><span>Route</span><span>Amount</span><span>Date</span><span>Status</span><span /></div>
      {rows.map((e) => (
        <a className="table-row" key={e.attemptId} href={`#/attempt/${e.attemptId}`}>
          <div className="table-route">
            {e.fromChain && e.toChain ? (
              <><ChainIcon chain={e.fromChain} small /><Icon name="arrow" size={14} /><ChainIcon chain={e.toChain} small /></>
            ) : null}
            <span>{e.fromSymbol && e.toSymbol ? `${e.fromSymbol} → ${e.toSymbol}` : e.label}</span>
          </div>
          <strong>{e.amountIn && e.fromSymbol ? `${e.amountIn} ${e.fromSymbol}` : '–'}</strong>
          <span>{new Date(e.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <StatusChip id={e.attemptId} />
          <span className="row-chevron"><Icon name="chevron" size={16} /></span>
        </a>
      ))}
    </div>
  );
}
