import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { errorMessage } from '../lib/errors.ts';
import { readBalances } from '../lib/balances.ts';
import type { BalanceRow } from '../lib/balances.ts';
import { evmChainFor } from '../lib/chains.ts';
import { chainLabel, formatUsd, tokenOptionLabel } from '../lib/labels.ts';
import { addSnapshot, dailyChange, failedCount, formatAmount, formatChange, portfolioTargets, priceHistoryChange, sinceLabel, sparkPaths, toHoldings, totalUsd } from '../lib/portfolio.ts';
import type { PortfolioTarget, Range, Snapshot } from '../lib/portfolio.ts';
import type { CatalogChain } from '../lib/types.ts';
import { ChainIcon, Icon, Skeleton, TokenIcon } from '../components/Icon.tsx';
import { useWallets } from '../wallets/WalletContext.tsx';

/** Networks scanned at once. Public RPC endpoints rate-limit, so this stays small. */
const CHAINS_AT_ONCE = 2;

type Scan = { targets: PortfolioTarget[]; rows: BalanceRow[] };

const HISTORY_KEY = 'spendx.portfolio.history.v1';
const loadHistory = (key: string): Snapshot[] => {
  try { const all = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}'); return Array.isArray(all[key]) ? all[key] : []; } catch { return []; }
};
const saveHistory = (key: string, list: Snapshot[]) => {
  try { const all = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}'); all[key] = list; localStorage.setItem(HISTORY_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
};

export function Portfolio() {
  const w = useWallets();
  const [chains, setChains] = useState<CatalogChain[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [scans, setScans] = useState<Record<string, Scan>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [chainFilter, setChainFilter] = useState('all');
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [series, setSeries] = useState<Record<string, number[]>>({});
  const [range, setRange] = useState<Range>('24h');
  const run = useRef(0);
  const recorded = useRef(0);

  const evmAddr = w.evm?.address ?? null;
  const svmAddr = w.svm?.address ?? null;
  const nearAddr = w.near?.address ?? null;
  const connected = !!(evmAddr || svmAddr || nearAddr);
  const walletKey = [evmAddr, svmAddr, nearAddr].join('|');

  useEffect(() => { api.catalog().then((c) => setChains(c.chains)).catch((e) => setLoadErr(errorMessage(e))); }, []);

  const scan = useCallback(() => {
    const id = ++run.current;
    setScans({});
    const targets = portfolioTargets(chains, w.adapterFor, (b) => evmChainFor(b)?.nativeCurrency);
    const byChain = new Map<string, PortfolioTarget[]>();
    for (const t of targets) byChain.set(t.blockchain, [...(byChain.get(t.blockchain) ?? []), t]);
    const queue = [...byChain.entries()];
    setProgress({ done: 0, total: queue.length });
    if (queue.length === 0) return;
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < queue.length; i = next++) {
        const [chain, list] = queue[i];
        const rows = await readBalances(list, w.adapterFor);
        if (run.current !== id) return; // a newer scan replaced this one
        setScans((s) => ({ ...s, [chain]: { targets: list, rows } }));
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(CHAINS_AT_ONCE, queue.length) }, worker));
  }, [chains, w.adapterFor]);

  // Scan again whenever the catalog arrives or a wallet connects, disconnects or changes account.
  useEffect(() => {
    if (!connected || chains.length === 0) { run.current++; setScans({}); setProgress({ done: 0, total: 0 }); return; }
    scan();
    return () => { run.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletKey, chains]);

  const all = useMemo(() => Object.values(scans), [scans]);
  const holdings = useMemo(() => toHoldings(all.flatMap((s) => s.targets), all.flatMap((s) => s.rows)), [all]);
  const failed = useMemo(() => failedCount(all.flatMap((s) => s.rows)), [all]);
  const heldChains = useMemo(() => [...new Set(holdings.map((h) => h.target.blockchain))].sort(), [holdings]);
  const shown = chainFilter === 'all' ? holdings : holdings.filter((h) => h.target.blockchain === chainFilter);
  const scanning = progress.total > 0 && progress.done < progress.total;
  const unpriced = holdings.some((h) => h.value === null);

  useEffect(() => { if (chainFilter !== 'all' && !heldChains.includes(chainFilter) && !scanning) setChainFilter('all'); }, [chainFilter, heldChains, scanning]);

  useEffect(() => { setHistory(connected ? loadHistory(walletKey) : []); }, [walletKey, connected]);

  // One saved point per finished scan, and only when every balance was read: a failed read must never look like a drop in value.
  const total = totalUsd(holdings);
  useEffect(() => {
    if (!connected || scanning || progress.total === 0 || failed > 0 || recorded.current === run.current) return;
    recorded.current = run.current;
    setHistory((h) => { const next = addSnapshot(h, Date.now(), total); saveHistory(walletKey, next); return next; });
  }, [connected, scanning, progress.total, failed, total, walletKey]);

  // Real price history (symbols only go to the server). Asked once per set of held tokens, after the scan finishes.
  const symKey = useMemo(() => [...new Set(holdings.filter((h) => h.value !== null).map((h) => h.target.symbol.toUpperCase()))].sort().slice(0, 60).join(','), [holdings]);
  useEffect(() => {
    if (!connected || scanning || !symKey) return;
    let off = false;
    api.priceHistory(symKey.split(',')).then((r) => { if (!off) setSeries(r.series); }).catch(() => { /* the chart falls back to this browser's own readings */ });
    return () => { off = true; };
  }, [connected, scanning, symKey]);

  const priceChange = useMemo(() => priceHistoryChange(holdings, series, range, Date.now()), [holdings, series, range]);
  const savedChange = useMemo(() => dailyChange(history, Date.now(), total), [history, total]);
  const change = priceChange ?? savedChange;
  const fmt = change ? formatChange(change) : null;
  const spark = change ? sparkPaths(change.points, 600, 120) : null;

  let body;
  if (!connected) {
    body = (
      <div className="empty-state">
        <Icon name="wallet" size={24} />
        <p>Connect a wallet to see everything it holds.</p>
        <button className="btn" onClick={w.openWalletModal}>Connect wallet</button>
      </div>
    );
  } else if (loadErr) {
    body = <p className="inline-error">{loadErr}</p>;
  } else if (chains.length === 0 || (scanning && holdings.length === 0)) {
    body = <Skeleton w="100%" h="160px" />;
  } else if (holdings.length === 0) {
    body = (
      <div className="empty-state">
        <Icon name="wallet" size={24} />
        <p>No tokens found in the connected wallets.</p>
      </div>
    );
  } else {
    body = (
      <>
        {heldChains.length > 1 && (
          <div className="filter-row" role="group" aria-label="Filter by network">
            <button type="button" className="filter-chip" aria-pressed={chainFilter === 'all'} onClick={() => setChainFilter('all')}>All networks</button>
            {heldChains.map((c) => (
              <button key={c} type="button" className="filter-chip" aria-pressed={chainFilter === c} onClick={() => setChainFilter(c)}>
                <ChainIcon chain={c} small />{chainLabel(c)}
              </button>
            ))}
          </div>
        )}
        <div className="activity-table">
          <div className="holding-head"><span>Token</span><span>Balance</span><span>Value</span></div>
          {shown.map((h) => (
            <div className="holding-row" key={`${h.target.assetId}|${h.target.address}`}>
              <div className="table-route">
                <TokenIcon symbol={h.target.symbol} chain={h.target.blockchain} small plain={h.target.duplicateSymbol} />
                <span>{tokenOptionLabel({ ...h.target, contractAddress: h.target.contractAddress ?? null })}</span>
                <small className="muted">{chainLabel(h.target.blockchain)}</small>
              </div>
              <strong>{formatAmount(h.amount)}</strong>
              <span>{h.value === null ? '–' : formatUsd(h.value)}</span>
            </div>
          ))}
        </div>
        {unpriced && <p className="muted small" style={{ marginTop: 'var(--s3)' }}>Tokens with no listed price show “–” and are left out of the total.</p>}
        {!!nearAddr && <p className="muted small" style={{ marginTop: 'var(--s3)' }}>NEAR shows tokens only; the native NEAR balance is not included.</p>}
      </>
    );
  }

  return (
    <>
      <section className="page-head"><h1>Portfolio</h1></section>
      {connected && (
        <div className={`balance-hero ${fmt?.sign ?? ''}`}>
          <div className="balance-top">
            <span className="muted small">Total balance</span>
            <div className="balance-actions">
              {priceChange && (
                <div className="range-toggle" role="group" aria-label="Chart period">
                  {(['24h', '7d'] as const).map((r) => (
                    <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{r === '24h' ? '24H' : '7D'}</button>
                  ))}
                </div>
              )}
              <button type="button" className="link small" onClick={scan} disabled={scanning}>{scanning ? `Scanning ${progress.done}/${progress.total}…` : 'Refresh'}</button>
            </div>
          </div>
          <div className="balance-main">
            <strong className="balance-amount">{scanning && holdings.length === 0 ? <Skeleton w="220px" h="52px" /> : formatUsd(total)}</strong>
            {fmt && <span className={`delta ${fmt.sign}`}>{fmt.pct}</span>}
          </div>
          <div className="balance-sub muted small">
            {fmt && change ? <><span className={`delta-abs ${fmt.sign}`}>{fmt.abs}</span><span>{sinceLabel(change.sinceMs)}</span><span aria-hidden="true">·</span></> : null}
            <span>{holdings.length} {holdings.length === 1 ? 'token' : 'tokens'}</span><span aria-hidden="true">·</span><span>{w.connectedCount} {w.connectedCount === 1 ? 'wallet' : 'wallets'}</span>
          </div>
          {spark ? (
            <svg className="spark" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Portfolio value over the period">
              <defs>
                <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity=".32" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={spark.area} fill="url(#spark-fill)" />
              <path d={spark.line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : (
            <svg className="spark flat" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 60 L600 60" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
        </div>
      )}
      {body}
    </>
  );
}
