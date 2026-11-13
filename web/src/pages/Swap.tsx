import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import type { AssistantResult, AttemptView, CatalogChain, CatalogToken, RequestView, SwapPreview } from '../lib/types.ts';
import { chainLabel, formatDuration, formatUsd, shortAddr } from '../lib/labels.ts';
import { errorMessage } from '../lib/errors.ts';
import { evmChainFor } from '../lib/chains.ts';
import { estimateAddress, formatRate, indicativeRate } from '../lib/estimate.ts';
import { executeDeposit } from '../lib/execute.ts';
import { saveHistory } from '../lib/history.ts';
import { secondsLeft, useNow } from '../lib/hooks.ts';
import { classifyDeposit } from '../../../shared/src/deposit-kind.ts';
import { fromBaseUnits, toBaseUnits } from '../../../shared/src/amounts.ts';
import { validateAddress } from '../../../shared/src/addresses.ts';
import type { Token } from '../../../shared/src/types.ts';
import { useWallets } from '../wallets/WalletContext.tsx';
import { AssetBox } from '../components/AssetBox.tsx';
import { AssistantBar } from '../components/AssistantBar.tsx';
import { ActivityTable } from '../components/ActivityTable.tsx';
import { Icon, Skeleton } from '../components/Icon.tsx';
import { ReviewModal } from '../components/ReviewModal.tsx';

const asToken = (t: CatalogToken, blockchain: string): Token => ({
  assetId: t.assetId, symbol: t.symbol, decimals: t.decimals, blockchain, contractAddress: t.contractAddress,
});
const SLIPPAGE = [{ bps: 50, label: '0.5%' }, { bps: 100, label: '1%' }, { bps: 300, label: '3%' }, { bps: 500, label: '5%' }];

export function Swap() {
  const w = useWallets();
  const now = useNow();
  const [chains, setChains] = useState<CatalogChain[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [fromChain, setFromChain] = useState('');
  const [from, setFrom] = useState<CatalogToken | null>(null);
  const [toChain, setToChain] = useState('');
  const [to, setTo] = useState<CatalogToken | null>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientEdited, setRecipientEdited] = useState(false);
  const [recipientFromAssistant, setRecipientFromAssistant] = useState(false);
  const [ack, setAck] = useState(false);
  const [slippage, setSlippage] = useState(100);
  const [showSettings, setShowSettings] = useState(false);
  const [preview, setPreview] = useState<SwapPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [final, setFinal] = useState<{ request: RequestView; attempt: AttemptView } | null>(null);
  const [busy, setBusy] = useState<'quote' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => { api.catalog().then((c) => setChains(c.chains)).catch((e) => setLoadErr(errorMessage(e))); }, []);

  const fromChainObj = chains.find((c) => c.blockchain === fromChain) ?? null;
  const toChainObj = chains.find((c) => c.blockchain === toChain) ?? null;
  const adapter = fromChainObj ? w.adapterFor(fromChainObj.family) : null;
  const payer = adapter?.getAddress() ?? null;

  const tokenReason = (t: CatalogToken, c: CatalogChain): string | null => {
    const k = classifyDeposit(asToken(t, c.blockchain), evmChainFor(c.blockchain)?.nativeCurrency);
    return k.kind === 'unsupported' ? k.reason : null;
  };
  const chainReason = (c: CatalogChain): string | null => (c.tokens.some((t) => tokenReason(t, c) === null) ? null : 'not supported yet');

  /** Fill the card from an assistant proposal. Nothing is sent: the user still reviews and approves everything. */
  function applyAssistant(r: AssistantResult): string[] {
    const notes: string[] = [];
    const sw = r.swap;
    if (!sw) return notes;
    const pick = (chainId?: string, assetId?: string) => {
      const c = chains.find((x) => x.blockchain === chainId);
      return { c, t: c?.tokens.find((x) => x.assetId === assetId) };
    };
    if (sw.fromChain) {
      const { c, t } = pick(sw.fromChain, sw.fromAssetId);
      if (c && t) {
        const why = tokenReason(t, c);
        if (why) notes.push(`You cannot send from ${t.symbol} on ${chainLabel(c.blockchain)} yet: ${why}.`);
        else { setFromChain(c.blockchain); setFrom(t); }
      } else if (c) { setFromChain(c.blockchain); setFrom(null); }
    }
    if (sw.toChain) {
      const { c, t } = pick(sw.toChain, sw.toAssetId);
      if (c) { setToChain(c.blockchain); setTo(t ?? null); setAck(false); }
    }
    if (sw.amount) setAmount(sw.amount);
    if (sw.recipient) { setRecipient(sw.recipient); setRecipientEdited(true); setRecipientFromAssistant(true); }
    if (sw.slippageBps) setSlippage(SLIPPAGE.reduce((best, s) => (Math.abs(s.bps - sw.slippageBps!) < Math.abs(best.bps - sw.slippageBps!) ? s : best)).bps);
    return notes;
  }

  // Default the delivery address to the user's own wallet on that chain, until they type their own.
  const ownAddress = toChainObj ? w.addressFor(toChainObj.family) ?? '' : '';
  useEffect(() => { if (!recipientEdited) setRecipient(ownAddress); }, [ownAddress, recipientEdited, toChain]);

  const recipientCheck = toChain && recipient ? validateAddress(toChain, recipient) : null;
  const amountBase = useMemo(() => { try { return from && amount ? toBaseUnits(amount, from.decimals) : null; } catch { return null; } }, [from, amount]);
  const amountOk = amountBase !== null && amountBase > 0n;
  const recipientOk = !!recipientCheck && recipientCheck.status !== 'invalid' && (recipientCheck.status === 'valid' || ack);
  const sameToken = !!from && !!to && from.assetId === to.assetId;
  const insufficient = balance !== null && amountBase !== null && amountBase > balance;

  // An ESTIMATE needs no wallet: a dry quote only needs well-formed addresses, so placeholders stand in until the user's own are known.
  const estPayer = payer ?? (fromChainObj ? estimateAddress(fromChainObj.family) : null);
  const estRecipient = recipient && recipientCheck && recipientCheck.status !== 'invalid' ? recipient : toChainObj ? estimateAddress(toChainObj.family) : null;
  const canEstimate = !!from && !!to && amountOk && !sameToken && !!estPayer && !!estRecipient;

  useEffect(() => { setPreview(null); setPreviewErr(null); setFinal(null); setError(null); }, [from?.assetId, to?.assetId, amount, recipient, slippage, payer]);

  useEffect(() => {
    if (!canEstimate || !from || !to || !estPayer || !estRecipient) { setPreviewing(false); return; }
    let off = false;
    setPreviewing(true);
    const t = setTimeout(() => {
      api.swapPreview({ originAssetId: from.assetId, destAssetId: to.assetId, amount, payerAddress: estPayer, recipient: estRecipient, slippageBps: slippage, acknowledgeUncheckedAddress: true })
        .then((p) => { if (!off) { setPreview(p); setPreviewErr(null); } })
        .catch((e) => { if (!off) { setPreview(null); setPreviewErr(errorMessage(e)); } })
        .finally(() => { if (!off) setPreviewing(false); });
    }, 500);
    return () => { off = true; clearTimeout(t); };
  }, [canEstimate, from?.assetId, to?.assetId, amount, estPayer, estRecipient, slippage]);

  useEffect(() => {
    if (!adapter || !from || !payer) { setBalance(null); return; }
    let off = false;
    adapter.getBalance(asToken(from, fromChain)).then((b) => { if (!off) setBalance(b); }).catch(() => { if (!off) setBalance(null); });
    return () => { off = true; };
  }, [adapter, from?.assetId, payer, fromChain]);

  const tokenFull = useMemo(() => (from ? asToken(from, fromChain) : null), [from, fromChain]);
  const kind = tokenFull ? classifyDeposit(tokenFull, evmChainFor(fromChain)?.nativeCurrency).kind : null;
  const canMax = balance !== null && balance > 0n && (kind === 'evm-erc20' || kind === 'near-nep141' || kind === 'svm-spl'); // native coins keep a fee reserve, so no MAX
  const costPct = preview && Number(preview.amountInUsd) > 0 ? (preview.estimatedCostUsd / Number(preview.amountInUsd)) * 100 : 0;
  const quotedRate = preview && Number(preview.amountInFormatted) > 0 ? Number(preview.estimatedOutFormatted) / Number(preview.amountInFormatted) : null;
  const indicative = indicativeRate(from?.price, to?.price);
  const sendUsd = from?.price && amount && Number(amount) > 0 ? Number(amount) * from.price : null;
  const loading = canEstimate && previewing && !preview;

  function flip() {
    if (!from || !to || !toChainObj) return;
    const why = tokenReason(to, toChainObj);
    if (why) { setError(`You can't send from ${to.symbol} yet: ${why}`); return; }
    setFromChain(toChain); setFrom(to); setToChain(fromChain); setTo(from); setRecipientEdited(false); setAmount(''); setAck(false);
  }

  async function review() {
    if (!from || !to || !payer) return;
    setBusy('quote'); setError(null);
    try {
      const r = await api.createSwap({ originAssetId: from.assetId, destAssetId: to.assetId, amount, payerAddress: payer, recipient, slippageBps: slippage, acknowledgeUncheckedAddress: ack });
      setFinal(r);
      saveHistory({ attemptId: r.attempt.id, slug: r.request.slug, label: `Swap ${amount} ${from.symbol} to ${to.symbol}`, kind: 'swap', fromChain, fromSymbol: from.symbol, toChain, toSymbol: to.symbol, amountIn: amount, payer });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  async function approve() {
    if (!final || !adapter || !tokenFull) return;
    setBusy('send'); setError(null);
    try {
      await executeDeposit({ attempt: final.attempt, adapter, token: tokenFull, api });
      window.location.hash = `#/attempt/${final.attempt.id}`;
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  async function cancel() {
    if (!final) return;
    try { await api.cancel(final.attempt.id); } catch { /* it may already be closed; either way we leave the review */ }
    setFinal(null);
  }

  let cta: { label: string; disabled: boolean; onClick?: () => void };
  if (!from || !to) cta = { label: 'Select tokens', disabled: true };
  else if (sameToken) cta = { label: 'Choose two different tokens', disabled: true };
  else if (!amountOk) cta = { label: 'Enter an amount', disabled: true };
  else if (!adapter) cta = { label: 'Connect wallet', disabled: false, onClick: w.openWalletModal };
  else if (insufficient) cta = { label: 'Insufficient balance', disabled: true };
  else if (!recipientOk) cta = { label: recipientCheck?.status === 'unchecked' ? 'Confirm the delivery address' : 'Enter a delivery address', disabled: true };
  else if (previewErr) cta = { label: 'No route available', disabled: true };
  else if (!preview) cta = { label: 'Getting quote…', disabled: true };
  else cta = { label: busy === 'quote' ? 'Locking in your quote…' : 'Review swap', disabled: busy !== null, onClick: review };

  const left = final ? secondsLeft(final.attempt.deposit.deadline, now) : 0;
  const catalogLoading = chains.length === 0 && !loadErr;

  return (
    <>
      <section className="page-head"><h1>Swap and move across chains</h1></section>

      <section className="column">
        <AssistantBar onResult={applyAssistant} />
        <div className="swap-card">
          <div className="card-bar">
            <h2>Swap</h2>
            <button className="icon-button" aria-label="Slippage settings" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}><Icon name="route" /></button>
          </div>
          {showSettings && (
            <div className="settings">
              <span>Slippage tolerance</span>
              <div className="segmented" role="group" aria-label="Slippage tolerance">
                {SLIPPAGE.map((s) => <button key={s.bps} className={slippage === s.bps ? 'active' : ''} aria-pressed={slippage === s.bps} onClick={() => setSlippage(s.bps)}>{s.label}</button>)}
              </div>
            </div>
          )}

          {loadErr ? <p className="inline-error" style={{ margin: 'var(--s4)' }}>{loadErr}</p> : catalogLoading ? (
            <div className="swap-boxes">
              <div className="asset-box"><Skeleton w="40%" h="14px" block /><div style={{ height: 'var(--s4)' }} /><Skeleton w="60%" h="38px" block /><div style={{ height: 'var(--s4)' }} /><Skeleton w="30%" h="14px" block /></div>
              <div className="asset-box"><Skeleton w="40%" h="14px" block /><div style={{ height: 'var(--s4)' }} /><Skeleton w="60%" h="38px" block /><div style={{ height: 'var(--s4)' }} /><Skeleton w="30%" h="14px" block /></div>
            </div>
          ) : (
            <div className="swap-boxes">
              <AssetBox
                label="You send"
                hint={<>
                  {from && payer && balance !== null && <span>Balance {fromBaseUnits(balance, from.decimals)}</span>}
                  {canMax && <button className="max-button" onClick={() => from && balance !== null && setAmount(fromBaseUnits(balance, from.decimals))}>Max</button>}
                </>}
                amount={<input aria-label="Amount to send" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />}
                sub={sendUsd !== null ? formatUsd(sendUsd) : undefined}
                chains={chains} chain={fromChain} token={from}
                onChange={(c, t) => { setFromChain(c); setFrom(t); }}
                chainDisabled={chainReason} tokenDisabled={tokenReason}
              />
              <AssetBox
                label="You receive"
                amount={loading ? <Skeleton w="140px" h="36px" /> : <strong className={preview ? 'accent' : ''}>{preview ? preview.estimatedOutFormatted : '0'}</strong>}
                sub={preview ? formatUsd(Number(preview.amountOutUsd)) : loading ? <Skeleton w="48px" /> : undefined}
                chains={chains} chain={toChain} token={to}
                onChange={(c, t) => { setToChain(c); setTo(t); setAck(false); }}
              />
              <button className="flip" aria-label="Swap the two sides" onClick={flip}><Icon name="swap" /></button>
            </div>
          )}

          <label className="deliver">
            <span>Deliver to{toChain ? ` ${chainLabel(toChain)} address` : ''}</span>
            <input placeholder={toChain ? 'Your address' : 'Select a network first'} value={recipient} spellCheck={false}
              onChange={(e) => { setRecipient(e.target.value.trim()); setRecipientEdited(true); setRecipientFromAssistant(false); setAck(false); }} />
            {recipientCheck?.status === 'invalid' && <small className="warn">{recipientCheck.reason}</small>}
            {recipientCheck?.status === 'unchecked' && (
              <small className="warn">SpendX cannot validate {chainLabel(toChain)} addresses. A wrong address means lost funds.
                <span className="check"><input id="ack" type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><label htmlFor="ack">I have double-checked this address</label></span>
              </small>
            )}
            {recipientFromAssistant && recipient && <small className="warn">This address came from your message. Check every character before continuing.</small>}
            {!recipientFromAssistant && recipientEdited && ownAddress && recipient && recipient !== ownAddress && <small className="warn">This is not your connected wallet's address.</small>}
          </label>

          {from && to && (
            <dl className="details">
              <div><dt>Rate</dt><dd>{
                loading ? <Skeleton w="150px" /> :
                quotedRate !== null ? `1 ${from.symbol} = ${formatRate(quotedRate)} ${to.symbol}` :
                indicative !== null ? <>{`1 ${from.symbol} ≈ ${formatRate(indicative)} ${to.symbol}`}<small>indicative</small></> : '–'
              }</dd></div>
              <div><dt>Minimum received</dt><dd className={preview ? 'good' : ''}>{loading ? <Skeleton w="110px" /> : preview ? `${preview.minOutFormatted} ${to.symbol}` : '–'}</dd></div>
              <div><dt>Estimated cost</dt><dd>{loading ? <Skeleton w="90px" /> : preview ? `${formatUsd(preview.estimatedCostUsd)} (${costPct.toFixed(2)}%)` : '–'}</dd></div>
              <div><dt>Estimated time</dt><dd>{loading ? <Skeleton w="50px" /> : preview ? formatDuration(preview.timeEstimateSeconds) : '–'}</dd></div>
            </dl>
          )}
          {costPct >= 3 && <p className="asset-note warn" style={{ margin: 'var(--s3) var(--s3) 0' }}>About {costPct.toFixed(1)}% of your amount goes to spread and fees. This is common for thinly traded tokens.</p>}
          {previewErr && <p className="inline-error" style={{ margin: 'var(--s3) var(--s3) 0' }}>{previewErr}</p>}
          {error && !final && <p className="inline-error" style={{ margin: 'var(--s3) var(--s3) 0' }}>{error}</p>}

          <button className="cta" disabled={cta.disabled} onClick={cta.onClick}>{cta.label}{!cta.disabled && <Icon name={cta.onClick === w.openWalletModal ? 'wallet' : 'arrow'} />}</button>
        </div>
      </section>

      <section className="recent">
        <div className="section-head"><h2>Recent activity</h2><a className="link-button" href="#/activity">View all <Icon name="chevron" size={16} /></a></div>
        <ActivityTable limit={5} />
      </section>

      {final && from && to && (
        <ReviewModal
          label="You send"
          title={`${final.attempt.deposit.amountFormatted} ${final.attempt.origin.symbol}`}
          fromChain={final.attempt.origin.blockchain}
          toChain={final.request.destination.blockchain}
          secondsLeft={left}
          busy={busy === 'send'}
          error={error}
          approveLabel="Approve in wallet"
          onApprove={approve}
          onCancel={cancel}
          lines={[
            ['You receive at least', `${final.request.destination.amountFormatted} ${final.request.destination.symbol}`],
            ['Delivered to', <span className="mono">{shortAddr(final.request.recipient, 8, 6)}</span>],
            ['Deposit address', <span className="mono">{shortAddr(final.attempt.deposit.address, 8, 6)}</span>],
            ['Refund address', <span className="mono">{shortAddr(final.attempt.payerAddress, 8, 6)}</span>],
            ['Quote valid for', left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired'],
          ]}
        />
      )}
    </>
  );
}
