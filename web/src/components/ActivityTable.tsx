import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { loadHistory } from '../lib/history.ts';
import type { HistoryEntry } from '../lib/history.ts';
import { useWallets } from '../wallets/WalletContext.tsx';
import { ChainIcon, Icon, Skeleton } from './Icon.tsx';

type Known = { label: string; kind: string };

function StatusChip({ id, known }: { id: string; known?: Known }) {
  const [s, setS] = useState<Known | null>(known && known.kind !== 'pending' ? known : null);
  useEffect(() => {
    // Finished rows loaded from the server need no extra request; anything still pending is refreshed.
    if (known && known.kind !== 'pending') { setS(known); return; }
    let off = false;
    api.attempt(id)
      .then((d) => { if (!off) setS({ label: d.attempt.stateLabel, kind: d.attempt.state === 'destination_confirmed' ? 'ok' : d.attempt.terminal ? 'bad' : 'pending' }); })
      .catch(() => { if (!off) setS(known ?? { label: 'Unavailable', kind: 'bad' }); });
    return () => { off = true; };
  }, [id, known]);
  if (!s) return <Skeleton w="96px" h="24px" />;
  return <span className={`status ${s.kind}`}>{s.kind === 'ok' && <Icon name="check" size={14} />}{s.label}</span>;
}

type Row = HistoryEntry & { known?: Known };

/** Server activity (follows the wallet across devices) merged with this browser's local history. */
function mergeRows(remote: Row[], local: HistoryEntry[]): Row[] {
  const seen = new Set(remote.map((r) => r.attemptId));
  return [...remote, ...local.filter((l) => !seen.has(l.attemptId))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function ActivityTable({ limit }: { limit?: number }) {
  const { session, evm, svm, signIn } = useWallets();
  const [remote, setRemote] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const local = useMemo(() => loadHistory(), []);

  // Load this wallet's activity from the server once signed in.
  useEffect(() => {
    if (!session) { setRemote([]); return; }
    let off = false;
    setLoading(true);
    api.activity(session.token)
      .then(({ items }) => {
        if (off) return;
        setRemote(items.filter((i) => i.request).map((i): Row => {
          const a = i.attempt;
          const r = i.request!;
          return {
            attemptId: a.id,
            slug: r.slug,
            createdAt: i.createdAt,
            kind: r.kind,
            label: r.kind === 'swap'
              ? `Swap ${a.deposit.amountFormatted} ${a.origin.symbol} to ${r.destination.symbol}`
              : `Pay ${r.destination.amountFormatted} ${r.destination.symbol}`,
            fromChain: a.origin.blockchain,
            fromSymbol: a.origin.symbol,
            toChain: r.destination.blockchain,
            toSymbol: r.destination.symbol,
            amountIn: a.deposit.amountFormatted,
            known: { label: a.stateLabel, kind: a.state === 'destination_confirmed' ? 'ok' : a.terminal ? 'bad' : 'pending' },
          };
        }));
        setErr(null);
      })
      .catch((e) => { if (!off) setErr(e instanceof Error ? e.message : 'Could not load your activity'); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [session]);

  const rows = useMemo(() => mergeRows(remote, local).slice(0, limit ?? 50), [remote, local, limit]);

  const signable: 'evm' | 'svm' | null = evm ? 'evm' : svm ? 'svm' : null;
  async function doSignIn() {
    if (!signable) return;
    setSigning(true);
    setErr(null);
    try { await signIn(signable); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Sign-in was cancelled'); }
    finally { setSigning(false); }
  }

  const banner = !session && signable ? (
    <div className="empty-state">
      <p>Sign in with your wallet to see activity from your other devices. It is free and sends no transaction.</p>
      <button className="btn" onClick={doSignIn} disabled={signing}>{signing ? 'Waiting for wallet…' : 'Sign in to sync'}</button>
    </div>
  ) : null;
  const errorNote = err ? <p className="inline-error">{err}</p> : null;

  if (loading && rows.length === 0) return <Skeleton w="100%" h="96px" />;

  if (rows.length === 0) {
    return (
      <>
        <div className="empty-state"><Icon name="history" size={24} /><p>No activity yet.</p></div>
        {banner}
        {errorNote}
      </>
    );
  }
  return (
    <>
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
            <StatusChip id={e.attemptId} known={e.known} />
            <span className="row-chevron"><Icon name="chevron" size={16} /></span>
          </a>
        ))}
      </div>
      {banner}
      {errorNote}
    </>
  );
}
