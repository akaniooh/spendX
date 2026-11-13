import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { forWallets, loadHistory, sameAddress } from '../lib/history.ts';
import type { HistoryEntry } from '../lib/history.ts';
import type { ConnectableFamily } from '../wallets/WalletContext.tsx';
import { useWallets } from '../wallets/WalletContext.tsx';
import { ChainIcon, Icon, Skeleton } from './Icon.tsx';

type Known = { label: string; kind: string };

function StatusChip({ id, known, fixed }: { id: string; known?: Known; fixed?: boolean }) {
  const [s, setS] = useState<Known | null>(known && known.kind !== 'pending' ? known : null);
  useEffect(() => {
    // Finished rows loaded from the server need no extra request; anything still pending is refreshed.
    if (known && (fixed || known.kind !== 'pending')) { setS(known); return; }
    let off = false;
    api.attempt(id)
      .then((d) => { if (!off) setS({ label: d.attempt.stateLabel, kind: d.attempt.state === 'destination_confirmed' ? 'ok' : d.attempt.terminal ? 'bad' : 'pending' }); })
      .catch(() => { if (!off) setS(known ?? { label: 'Unavailable', kind: 'bad' }); });
    return () => { off = true; };
  }, [id, known, fixed]);
  if (!s) return <Skeleton w="96px" h="24px" />;
  return <span className={`status ${s.kind}`}>{s.kind === 'ok' && <Icon name="check" size={14} />}{s.label}</span>;
}

/** `href` and `fixed` are for merchant rows (payment links this wallet created), which have no payment attempt of their own to open or refresh. */
type Row = HistoryEntry & { known?: Known; href?: string; fixed?: boolean };

/** Server activity and merchant history (both follow the wallet across devices) merged with this browser's local history. */
function mergeRows(remote: Row[], local: HistoryEntry[]): Row[] {
  const seen = new Set<string>();
  return [...remote, ...local].filter((r) => !seen.has(r.attemptId) && !!seen.add(r.attemptId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function ActivityTable({ limit }: { limit?: number }) {
  const { sessions, evm, svm, near, signIn, syncing, openWalletModal } = useWallets();
  const [remote, setRemote] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [signing, setSigning] = useState<ConnectableFamily | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const evmAddr = evm?.address ?? null;
  const svmAddr = svm?.address ?? null;
  const nearAddr = near?.address ?? null;
  const connected = !!(evmAddr || svmAddr || nearAddr);

  // Nothing is shown until a wallet is connected; then only what that wallet made.
  const local = useMemo(() => forWallets(loadHistory(), [evmAddr, svmAddr, nearAddr]), [evmAddr, svmAddr, nearAddr]);

  // A saved sign-in only counts while the wallet it belongs to is connected. Each connected wallet syncs on its own sign-in.
  const activeSessions = useMemo(
    () => sessions.filter((x) => [evmAddr, svmAddr, nearAddr].some((a) => a && sameAddress(a, x.address))),
    [sessions, evmAddr, svmAddr, nearAddr],
  );
  const sessionKey = activeSessions.map((x) => x.token).join('|');

  useEffect(() => {
    if (activeSessions.length === 0) { setRemote([]); return; }
    let off = false;
    setLoading(true);
    Promise.allSettled([
      ...activeSessions.map((x) => api.activity(x.token)),
      ...activeSessions.map((x) => api.merchantRequests(x.token)),
    ]).then((all) => {
      if (off) return;
      const results = all.slice(0, activeSessions.length) as PromiseSettledResult<Awaited<ReturnType<typeof api.activity>>>[];
      const merchantResults = all.slice(activeSessions.length) as PromiseSettledResult<Awaited<ReturnType<typeof api.merchantRequests>>>[];
      const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.items : []));
      const failed = all.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      const merchantRows = merchantResults.flatMap((r) => (r.status === 'fulfilled' ? r.value.requests : [])).map(({ request: r, latestAttempt: a }): Row => ({
        attemptId: `request-${r.slug}`,
        slug: r.slug,
        createdAt: r.createdAt,
        kind: 'request',
        label: `Payment request ${r.destination.amountFormatted} ${r.destination.symbol}`,
        toChain: r.destination.blockchain,
        toSymbol: r.destination.symbol,
        amountIn: r.destination.amountFormatted,
        href: `#/pay/${r.slug}`,
        fixed: true,
        known: r.status === 'paid' || a?.state === 'destination_confirmed'
          ? { label: 'Paid', kind: 'ok' }
          : a ? { label: a.stateLabel, kind: a.terminal ? 'bad' : 'pending' } : { label: 'No payment yet', kind: 'pending' },
      }));
      setRemote([...merchantRows, ...items.filter((i) => i.request).map((i): Row => {
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
      })]);
      setErr(failed ? (failed.reason instanceof Error ? failed.reason.message : 'Could not load your activity') : null);
      setLoading(false);
    });
    return () => { off = true; };
  }, [sessionKey]);

  const rows = useMemo(() => mergeRows(remote, local).slice(0, limit ?? 50), [remote, local, limit]);

  async function doSignIn(family: ConnectableFamily) {
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
    .filter(([, addr]) => addr && !activeSessions.some((x) => sameAddress(addr, x.address)));
  const banner = signable.length > 0 && !syncing ? (
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

  if ((loading || syncing) && rows.length === 0) return <Skeleton w="100%" h="96px" />;

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
          <a className="table-row" key={e.attemptId} href={e.href ?? `#/attempt/${e.attemptId}`}>
            <div className="table-route">
              {e.kind === 'request' && e.toChain ? <ChainIcon chain={e.toChain} small /> : e.fromChain && e.toChain ? (
                <><ChainIcon chain={e.fromChain} small /><Icon name="arrow" size={14} /><ChainIcon chain={e.toChain} small /></>
              ) : null}
              <span>{e.kind === 'request' ? `Payment request · ${e.toSymbol ?? ''}` : e.fromSymbol && e.toSymbol ? `${e.fromSymbol} → ${e.toSymbol}` : e.label}</span>
            </div>
            <strong>{e.amountIn && (e.kind === 'request' ? e.toSymbol : e.fromSymbol) ? `${e.amountIn} ${e.kind === 'request' ? e.toSymbol : e.fromSymbol}` : '–'}</strong>
            <span>{new Date(e.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <StatusChip id={e.attemptId} known={e.known} fixed={e.fixed} />
            <span className="row-chevron"><Icon name="chevron" size={16} /></span>
          </a>
        ))}
      </div>
    </>
  );
}
