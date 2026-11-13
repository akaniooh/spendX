import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import type { AttemptView, CatalogChain, CatalogToken, QuotePreview, RequestView } from '../lib/types.ts';
import { chainLabel, formatDuration, formatUsd, shortAddr } from '../lib/labels.ts';
import { errorMessage } from '../lib/errors.ts';
import { evmChainFor } from '../lib/chains.ts';
import { estimateAddress } from '../lib/estimate.ts';
import { executeDeposit } from '../lib/execute.ts';
import { saveHistory } from '../lib/history.ts';
import { secondsLeft, useNow } from '../lib/hooks.ts';
import { classifyDeposit } from '../../../shared/src/deposit-kind.ts';
import { fromBaseUnits, toBaseUnits } from '../../../shared/src/amounts.ts';
import type { Token } from '../../../shared/src/types.ts';
import { useWallets } from '../wallets/WalletContext.tsx';
import { AssetBox } from '../components/AssetBox.tsx';
import { ChainIcon, Icon, Skeleton, TokenIcon } from '../components/Icon.tsx';
import { ReviewModal } from '../components/ReviewModal.tsx';

const asToken = (t: CatalogToken, blockchain: string): Token => ({
  assetId: t.assetId, symbol: t.symbol, decimals: t.decimals, blockchain, contractAddress: t.contractAddress,
});

export function Pay({ slug }: { slug: string }) {
  const w = useWallets();
  const now = useNow();
  const [req, setReq] = useState<RequestView | null>(null);
  const [chains, setChains] = useState<CatalogChain[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [chain, setChain] = useState('');
  const [token, setToken] = useState<CatalogToken | null>(null);
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [busy, setBusy] = useState<'quote' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    let off = false;
    Promise.all([api.request(slug), api.catalog()])
      .then(([r, c]) => { if (!off) { setReq(r); setChains(c.chains); } })
      .catch((e) => { if (!off) setLoadErr(errorMessage(e)); });
    return () => { off = true; };
  }, [slug]);

  const chainObj = chains.find((c) => c.blockchain === chain) ?? null;
  const adapter = chainObj ? w.adapterFor(chainObj.family) : null;
  const payer = adapter?.getAddress() ?? null;
  const estPayer = payer ?? (chainObj ? estimateAddress(chainObj.family) : null); // estimates need no wallet

  const tokenReason = (t: CatalogToken, c: CatalogChain): string | null => {
    const k = classifyDeposit(asToken(t, c.blockchain), evmChainFor(c.blockchain)?.nativeCurrency);
    return k.kind === 'unsupported' ? k.reason : null;
  };
  const chainReason = (c: CatalogChain): string | null => (c.tokens.some((t) => tokenReason(t, c) === null) ? null : 'not supported yet');

  useEffect(() => { setPreview(null); setPreviewErr(null); setAttempt(null); setError(null); setBalance(null); }, [token?.assetId, payer]);

  useEffect(() => {
    if (!req || !token || !estPayer || req.status !== 'open') { setPreviewing(false); return; }
    let off = false;
    setPreviewing(true);
    const t = setTimeout(() => {
      api.preview(slug, { originAssetId: token.assetId, payerAddress: estPayer })
        .then((p) => { if (!off) { setPreview(p); setPreviewErr(null); } })
        .catch((e) => { if (!off) { setPreview(null); setPreviewErr(errorMessage(e)); } })
        .finally(() => { if (!off) setPreviewing(false); });
    }, 400);
    return () => { off = true; clearTimeout(t); };
  }, [slug, req?.status, token?.assetId, estPayer]);

  useEffect(() => {
    if (!adapter || !token || !payer) return;
    let off = false;
    adapter.getBalance(asToken(token, chain)).then((b) => { if (!off) setBalance(b); }).catch(() => { if (!off) setBalance(null); });
    return () => { off = true; };
  }, [adapter, token?.assetId, payer, chain]);

  const tokenFull = useMemo(() => (token ? asToken(token, chain) : null), [token, chain]);

  async function getFinalQuote() {
    if (!token || !payer || !req) return;
    setBusy('quote'); setError(null);
    try {
      const a = await api.createAttempt(slug, { originAssetId: token.assetId, payerAddress: payer });
      setAttempt(a);
      saveHistory({ attemptId: a.id, slug, label: `Pay ${req.destination.amountFormatted} ${req.destination.symbol}`, kind: 'payment', fromChain: chain, fromSymbol: token.symbol, toChain: req.destination.blockchain, toSymbol: req.destination.symbol, amountIn: a.deposit.amountFormatted });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  async function approve() {
    if (!attempt || !adapter || !tokenFull) return;
    setBusy('send'); setError(null);
    try {
      await executeDeposit({ attempt, adapter, token: tokenFull, api });
      window.location.hash = `#/attempt/${attempt.id}`;
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  async function cancel() {
    if (!attempt) return;
    try { await api.cancel(attempt.id); } catch { /* may already be closed */ }
    setAttempt(null);
  }

  if (loadErr) return <section className="page-head"><h1>Payment unavailable</h1><p className="inline-error">{loadErr}</p></section>;
  if (!req) {
    return (
      <>
        <section className="page-head"><h1><Skeleton w="260px" h="40px" /></h1></section>
        <section className="column"><div className="swap-card"><div className="asset-box"><Skeleton w="50%" h="14px" block /><div style={{ height: 'var(--s4)' }} /><Skeleton w="65%" h="38px" block /><div style={{ height: 'var(--s4)' }} /><Skeleton w="35%" h="14px" block /></div></div></section>
      </>
    );
  }
  const label = `${req.destination.amountFormatted} ${req.destination.symbol}`;
  if (req.status === 'paid') return <section className="page-head"><h1>Already paid</h1><p>{label} on {chainLabel(req.destination.blockchain)} has been paid.</p></section>;
  if (req.status === 'cancelled') return <section className="page-head"><h1>Payment cancelled</h1></section>;

  // exact decimal arithmetic (never floats): a balance check must not round
  let needed: bigint | null = null;
  try { needed = preview && token ? toBaseUnits(preview.amountInFormatted, token.decimals) : null; } catch { needed = null; }
  const insufficient = balance !== null && needed !== null && balance < needed;
  const loading = !!token && !!estPayer && previewing && !preview;

  let cta: { label: string; disabled: boolean; onClick?: () => void };
  if (!token) cta = { label: 'Select a token to pay with', disabled: true };
  else if (!adapter) cta = { label: 'Connect wallet', disabled: false, onClick: w.openWalletModal };
  else if (previewErr) cta = { label: 'No route available', disabled: true };
  else if (!preview) cta = { label: 'Getting quote…', disabled: true };
  else if (insufficient) cta = { label: 'Insufficient balance', disabled: true };
  else cta = { label: busy === 'quote' ? 'Locking in your quote…' : 'Continue', disabled: busy !== null, onClick: getFinalQuote };

  const left = attempt ? secondsLeft(attempt.deposit.deadline, now) : 0;

  return (
    <>
      <section className="page-head"><h1>Pay {label} <span>on {chainLabel(req.destination.blockchain)}</span></h1></section>

      <section className="column">
        <div className="swap-card">
          {req.description && <div className="card-bar"><h2>{req.description}</h2></div>}
          <div className="swap-boxes">
            <div className="asset-box">
              <div className="asset-top"><span>Recipient gets</span></div>
              <div className="asset-main">
                <div className="amount-wrap"><strong>{req.destination.amountFormatted}</strong></div>
                <span className="token-select static"><TokenIcon symbol={req.destination.symbol} chain={req.destination.blockchain} /><strong>{req.destination.symbol}</strong></span>
              </div>
              <div className="asset-bottom">
                <span className="chain-select-wrap static"><ChainIcon chain={req.destination.blockchain} small />{chainLabel(req.destination.blockchain)}</span>
                <span className="asset-sub mono" title={req.recipient}>{shortAddr(req.recipient, 8, 6)}</span>
              </div>
            </div>
            <AssetBox
              label="You pay with"
              hint={token && payer && balance !== null ? `Balance ${fromBaseUnits(balance, token.decimals)}` : undefined}
              amount={loading ? <Skeleton w="140px" h="36px" /> : <strong>{preview ? preview.amountInFormatted : '0'}</strong>}
              sub={preview ? formatUsd(Number(preview.amountInUsd)) : loading ? <Skeleton w="48px" /> : undefined}
              chains={chains} chain={chain} token={token}
              onChange={(c, t) => { setChain(c); setToken(t); }}
              chainDisabled={chainReason} tokenDisabled={tokenReason}
            />
            <i className="flip" aria-hidden="true"><Icon name="arrowDown" /></i>
          </div>

          {token && (
            <dl className="details">
              <div><dt>Estimated fees</dt><dd>{loading ? <Skeleton w="70px" /> : preview ? formatUsd(preview.estimatedCostUsd) : '–'}</dd></div>
              <div><dt>Expected delivery</dt><dd>{loading ? <Skeleton w="50px" /> : preview ? formatDuration(preview.timeEstimateSeconds) : '–'}</dd></div>
            </dl>
          )}
          {previewErr && <p className="inline-error" style={{ margin: 'var(--s3) var(--s3) 0' }}>{previewErr}</p>}
          {error && !attempt && <p className="inline-error" style={{ margin: 'var(--s3) var(--s3) 0' }}>{error}</p>}
          {insufficient && <p className="inline-error" style={{ margin: 'var(--s3) var(--s3) 0' }}>Your balance is lower than the amount required.</p>}

          <button className="cta" disabled={cta.disabled} onClick={cta.onClick}>{cta.label}{!cta.disabled && <Icon name={cta.onClick === w.openWalletModal ? 'wallet' : 'arrow'} />}</button>
        </div>
      </section>

      {attempt && token && (
        <ReviewModal
          label="You pay"
          title={`${attempt.deposit.amountFormatted} ${attempt.origin.symbol}`}
          fromChain={attempt.origin.blockchain}
          toChain={req.destination.blockchain}
          secondsLeft={left}
          busy={busy === 'send'}
          error={error}
          approveLabel="Approve in wallet"
          onApprove={approve}
          onCancel={cancel}
          lines={[
            ['Recipient gets', label],
            ['Recipient', <span className="mono">{shortAddr(req.recipient, 8, 6)}</span>],
            ['Deposit address', <span className="mono">{shortAddr(attempt.deposit.address, 8, 6)}</span>],
            ['Refund address', <span className="mono">{shortAddr(attempt.payerAddress, 8, 6)}</span>],
            ['Quote valid for', left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired'],
          ]}
        />
      )}
    </>
  );
}
