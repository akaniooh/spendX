import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { forWallets, loadHistory, sameAddress } from '../lib/history.ts';
import type { HistoryEntry } from '../lib/history.ts';
import type { ConnectableFamily } from '../wallets/WalletContext.tsx';
import { useWallets } from '../wallets/WalletContext.tsx';
import { useSettings } from '../settings/SettingsContext.tsx';
import { onLocalDataCleared } from '../lib/local-data.ts';
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

/** Page numbers to show: always first and last, the current page with one neighbour each side, and '…' for gaps. */
function pageItems(current: number, count: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const keep = new Set([1, count, current - 1, current, current + 1]);
  if (current <= 3) { keep.add(2); keep.add(3); keep.add(4); }
  if (current >= count - 2) { keep.add(count - 3); keep.add(count - 2); keep.add(count - 1); }
  const sorted = [...keep].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, i) => { if (i > 0 && n - sorted[i - 1] > 1) out.push('…'); out.push(n); });
  return out;
}

/** `href` and `fixed` are for merchant rows (payment links this wallet created), which have no payment attempt of their own to open or refresh. */
type Row = HistoryEntry & { known?: Known; href?: string; fixed?: boolean };

/** Server activity and merchant history (both follow the wallet across devices) merged with this browser's local history. */
function mergeRows(remote: Row[], local: HistoryEntry[]): Row[] {
  const seen = new Set<string>();
  return [...remote, ...local].filter((r) => !seen.has(r.attemptId) && !!seen.add(r.attemptId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** `swapsOnly` hides payment links and payments (the swap tab's short list); the Activity page shows everything. */
export function ActivityTable({ limit, swapsOnly = false }: { limit?: number; swapsOnly?: boolean }) {
  const { sessions, evm, svm, near, signIn, syncing, openWalletModal } = useWallets();
  const [remote, setRemote] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [signing, setSigning] = useState<ConnectableFamily | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const tableTop = useRef<HTMLDivElement>(null);
  const pageSize = useSettings().settings.activityPageSize;
  // Bumped when Settings clears the activity saved in this browser, so the list refreshes without a reload.
  const [clearedAt, setClearedAt] = useState(0);
  useEffect(() => onLocalDataCleared(() => setClearedAt((n) => n + 1)), []);

  const evmAddr = evm?.address ?? null;
  const svmAddr = svm?.address ?? null;
  const nearAddr = near?.address ?? null;
  const connected = !!(evmAddr || svmAddr || nearAddr);

  // Nothing is shown until a wallet is connected; then only what that wallet made.
  const local = useMemo(() => forWallets(loadHistory(), [evmAddr, svmAddr, nearAddr]), [evmAddr, svmAddr, nearAddr, clearedAt]);

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
          : r.status === 'cancelled' ? { label: 'Cancelled', kind: 'bad' }
          : r.status === 'expired' ? { label: 'Expired', kind: 'bad' }
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

  // With `limit` (the short list under the swap form) show just the newest rows. Without it (Activity page) paginate.
  const allRows = useMemo(() => {
    const merged = mergeRows(remote, local);
    return swapsOnly ? merged.filter((r) => !r.kind || r.kind === 'swap') : merged;
  }, [remote, local, swapsOnly]);
  const paged = limit === undefined;
  const pageCount = Math.max(1, Math.ceil(allRows.length / pageSize));
  const current = Math.min(page, pageCount);
  const rows = paged ? allRows.slice((current - 1) * pageSize, current * pageSize) : allRows.slice(0, limit);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  function goTo(n: number) {
    setPage(Math.min(Math.max(1, n), pageCount));
    // Keep the top of the list in view after changing page, so a click at the bottom does not leave you mid-list.
    tableTop.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

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
      <div className="activity-table" ref={tableTop}>
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
      {paged && pageCount > 1 && (
        <nav className="pager" aria-label="Activity pages">
          <span className="pager-info" aria-live="polite">
            Showing <strong>{(current - 1) * pageSize + 1}–{Math.min(current * pageSize, allRows.length)}</strong> of {allRows.length}
          </span>
          <div className="pager-controls">
            <button type="button" className="pager-btn edge" onClick={() => goTo(current - 1)} disabled={current === 1} aria-label="Previous page">
              <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" size={16} /></span>
            </button>
            <span className="pager-compact">Page {current} of {pageCount}</span>
            {pageItems(current, pageCount).map((n, i) => n === '…'
              ? <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">…</span>
              : (
                <button
                  key={n}
                  type="button"
                  className="pager-btn pager-num"
                  onClick={() => goTo(n)}
                  aria-label={`Page ${n}`}
                  aria-current={n === current ? 'page' : undefined}
                >
                  {n}
                </button>
              ))}
            <button type="button" className="pager-btn edge" onClick={() => goTo(current + 1)} disabled={current === pageCount} aria-label="Next page">
              <Icon name="chevron" size={16} />
            </button>
          </div>
        </nav>
      )}
    </>
  );
}
