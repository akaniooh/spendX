import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { forWallets, loadHistory, sameAddress } from '../lib/history.ts';
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
  const { session, evm, svm, near, signIn, openWalletModal } = useWallets();
  const [remote, setRemote] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [signing, setSigning] = useState<'evm' | 'svm' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const evmAddr = evm?.address ?? null;
  const svmAddr = svm?.address ?? null;
  const nearAddr = near?.address ?? null;
  const connected = !!(evmAddr || svmAddr || nearAddr);

  // Nothing is shown until a wallet is connected; then only what that wallet made.
  const local = useMemo(() => forWallets(loadHistory(), [evmAddr, svmAddr, nearAddr]), [evmAddr, svmAddr, nearAddr]);

  // A saved sign-in only counts while the wallet it belongs to is connected.
  const activeSession = session && [evmAddr, svmAddr].some((a) => a && sameAddress(a, session.address)) ? session : null;

  useEffect(() => {
    if (!activeSession) { setRemote([]); return; }
    let off = false;
    setLoading(true);
    api.activity(activeSession.token)
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
  }, [activeSession?.token]);

  const rows = useMemo(() => mergeRows(remote, local).slice(0, limit ?? 50), [remote, local, limit]);

  async function doSignIn(family: 'evm' | 'svm') {
    setSigning(family);
    setErr(null);
    try { await signIn(family); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Sign-in was cancelled'); }
    finally { setSigning(null); }
  }

  if (!connected) {
    return (
      <div className="empty-state">
        <Icon name="history" size={24} />
        <p>Connect your wallet to see your activity.</p>
        <button className="btn" onClick={openWalletModal}>Connect wallet</button>
      </div>
    );
  }

  // One sign-in button per connected wallet that supports it, so the right wallet can be chosen.
  const signable = ([['evm', evmAddr, 'Ethereum'], ['svm', svmAddr, 'Solana']] as const)
    .filter(([, addr]) => addr && !(activeSession && sameAddress(addr, activeSession.address)));
  const banner = signable.length > 0 ? (
    <div className="empty-state">
      <p>Sign in with the wallet you paid from to load your activity from other devices. It is free and sends no transaction.</p>
      {signable.map(([fam, , label]) => (
        <button key={fam} className="btn" onClick={() => doSignIn(fam)} disabled={signing !== null}>
          {signing === fam ? 'Waiting for wallet…' : `Sign in with ${label} wallet`}
        </button>
      ))}
    </div>
  ) : null;
  const nearNote = nearAddr && !evmAddr && !svmAddr
    ? <p className="muted">NEAR wallets cannot sign in yet, so only activity from this browser shows. Connect an Ethereum or Solana wallet to sync.</p>
    : null;
  const errorNote = err ? <p className="inline-error">{err}</p> : null;

  if (loading && rows.length === 0) return <Skeleton w="100%" h="96px" />;

  if (rows.length === 0) {
    return (
      <>
        <div className="empty-state"><Icon name="history" size={24} /><p>No activity yet for the connected wallet.</p></div>
        {banner}
        {nearNote}
        {errorNote}
      </>
    );
  }
  return (
    <>
      {banner}
      {nearNote}
      {errorNote}
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
    </>
  );
}
