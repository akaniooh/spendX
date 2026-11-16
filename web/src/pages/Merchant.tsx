import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { AttemptView, CatalogChain, CatalogToken, RequestView } from '../lib/types.ts';
import { chainLabel, shortAddr, tokenOptionLabel } from '../lib/labels.ts';
import { errorMessage } from '../lib/errors.ts';
import { validateAddress } from '../../../shared/src/addresses.ts';
import { useWallets } from '../wallets/WalletContext.tsx';
import { ChainIcon, Icon, Skeleton, TokenIcon } from '../components/Icon.tsx';
import { IconSelect } from '../components/IconSelect.tsx';

const linkFor = (slug: string) => `${window.location.origin}/#/pay/${slug}`;

type MerchantData = Awaited<ReturnType<typeof api.merchantRequests>>;

/** The merchant's requests and stats, refreshed every 10 seconds and whenever `refreshKey` changes. */
function useMerchantData(token: string, refreshKey: number, onExpired: () => void) {
  const [data, setData] = useState<MerchantData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.merchantRequests(token)); setErr(null); }
    catch (e: any) { if (e?.status === 401) onExpired(); else setErr(errorMessage(e)); }
  }, [token, onExpired]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load, refreshKey]);
  return { data, err };
}

function SignIn() {
  const w = useWallets();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (family: 'evm' | 'svm') => {
    setErr(null); setBusy(true);
    try { await w.signIn(family); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="m-card m-signin">
      <div className="m-card-head">
        <span className="icon-tile"><Icon name="wallet" size={22} /></span>
        <div><span className="eyebrow">Merchant</span><h2>Sign in to create links</h2></div>
      </div>
      <div className="row">
        <button className="btn primary" disabled={!w.evm || busy} onClick={() => go('evm')}>{w.evm ? `Sign in with ${w.evm.name}` : 'Connect an EVM wallet first'}</button>
        <button className="btn primary" disabled={!w.svm || busy} onClick={() => go('svm')}>{w.svm ? 'Sign in with Phantom' : 'Connect Phantom first'}</button>
      </div>
      {err && <p className="inline-error">{err}</p>}
    </div>
  );
}

function CreateRequest({ token, chains, stats, onCreated }: { token: string; chains: CatalogChain[]; stats: MerchantData['stats'] | null; onCreated: () => void }) {
  const w = useWallets();
  const [chain, setChain] = useState('');
  const [tok, setTok] = useState<CatalogToken | null>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<RequestView | null>(null);
  const [copied, setCopied] = useState(false);

  const current = chains.find((c) => c.blockchain === chain);
  const check = chain && recipient ? validateAddress(chain, recipient) : null;
  const connectedHere = chain ? (validateAddress(chain, w.evm?.address ?? '').status === 'valid' ? w.evm?.address : validateAddress(chain, w.svm?.address ?? '').status === 'valid' ? w.svm?.address : undefined) : undefined;
  const ready = !!tok && /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && !!check && check.status !== 'invalid' && (check.status === 'valid' || ack);

  // Editing the form after a link was made returns the preview to a draft, so a stale link is never shown for new values.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setCreated(null); setCopied(false); };

  async function submit() {
    if (!tok) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.createRequest(token, { destAssetId: tok.assetId, amount, recipient, description: description.trim() || undefined, acknowledgeUncheckedAddress: ack });
      setCreated(r); setCopied(false); onCreated();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  const url = created ? linkFor(created.slug) : null;
  const copy = async () => { if (!url) return; try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } };

  return (
    <div className="m-grid">
      <div className="m-card">
        <div className="m-card-head">
          <span className="icon-tile"><Icon name="link" size={22} /></span>
          <div><span className="eyebrow">New request</span><h2>Create payment link</h2></div>
        </div>

        <span className="eyebrow m-label">Amount</span>
        <div className="m-box m-amount">
          <input inputMode="decimal" aria-label={`Amount${tok ? ` in ${tok.symbol}` : ''}`} placeholder="0.00" value={amount} onChange={(e) => edit(setAmount)(e.target.value.trim())} />
          <IconSelect className="token-select" alignRight ariaLabel="Token" value={tok?.assetId ?? ''} disabled={!current}
            placeholder={current ? 'Select token' : 'Pick a network'} placeholderIcon={<span className="token-icon empty">?</span>}
            options={(current?.tokens ?? []).map((t) => ({
              value: t.assetId, label: tokenOptionLabel(t),
              icon: <TokenIcon symbol={t.symbol} chain={chain} small plain={t.duplicateSymbol} />,
              selectedIcon: <TokenIcon symbol={t.symbol} chain={chain} plain={t.duplicateSymbol} />,
            }))}
            onChange={(id) => { edit(setTok)(current?.tokens.find((t) => t.assetId === id) ?? null); setAck(false); }} />
        </div>
        {tok && amount && /^\d+\.\d+$/.test(amount) && amount.split('.')[1].length > tok.decimals && <small className="warn m-note">{tok.symbol} supports at most {tok.decimals} decimal places.</small>}
        {tok?.duplicateSymbol && <small className="warn m-note">Another token on this network shares the symbol {tok.symbol}. Check the contract before continuing.</small>}

        <span className="eyebrow m-label">Settle to</span>
        <IconSelect className="m-box m-select" ariaLabel="Settle to network" value={chain}
          placeholder="Select a network" placeholderIcon={<span className="chain-icon small empty">?</span>}
          options={chains.map((c) => ({ value: c.blockchain, label: chainLabel(c.blockchain), icon: <ChainIcon chain={c.blockchain} small /> }))}
          onChange={(v) => { setChain(v); edit(setTok)(null); setAck(false); }} />

        <span className="eyebrow m-label">Recipient address{chain ? ` on ${chainLabel(chain)}` : ''}</span>
        <div className="m-box m-input">
          <input aria-label="Recipient address" placeholder="Where the funds should arrive" value={recipient} onChange={(e) => { edit(setRecipient)(e.target.value.trim()); setAck(false); }} spellCheck={false} />
        </div>
        {connectedHere && !recipient && <button type="button" className="link m-note" onClick={() => edit(setRecipient)(connectedHere)}>Use my connected address ({shortAddr(connectedHere)})</button>}
        {check?.status === 'invalid' && <small className="warn m-note">{check.reason}</small>}
        {check?.status === 'unchecked' && (
          <small className="warn m-note">SpendX cannot validate {chainLabel(chain)} addresses yet. A wrong address means lost funds.
            <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have double-checked this address</label>
          </small>
        )}

        <span className="eyebrow m-label">Note (optional)</span>
        <div className="m-box m-input">
          <input aria-label="Note" maxLength={140} placeholder="Invoice #1042" value={description} onChange={(e) => edit(setDescription)(e.target.value)} />
        </div>

        <div className="m-box m-payers">
          <span className="eyebrow">Payer can use</span>
          <div className="chips">
            <span className="chip"><ChainIcon chain="eth" small />EVM</span>
            <span className="chip"><ChainIcon chain="sol" small />Solana</span>
            <span className="chip"><ChainIcon chain="near" small />NEAR</span>
          </div>
        </div>

        <button className="cta" disabled={!ready || busy} onClick={submit}><Icon name="link" size={18} />{busy ? 'Creating…' : 'Create payment link'}</button>
        {err && <p className="inline-error">{err}</p>}
      </div>

      <div className="m-side">
        <div className="m-card m-preview">
          <div className="row between">
            <span className="eyebrow">Payment link</span>
            <span className={`badge ${created ? 'ok' : ''}`}>{created ? (created.status === 'paid' ? 'Paid' : 'Active') : 'Draft'}</span>
          </div>
          <div className="m-preview-body">
            <span className="icon-tile big"><Icon name="link" size={26} /></span>
            <span className="eyebrow">Request</span>
            <div className="m-preview-amount">{amount || '0.00'}<span>{tok?.symbol ?? ''}</span></div>
          </div>
          <div className="m-preview-row">
            <span className="muted">Settles on</span>
            {chain ? <strong><ChainIcon chain={chain} small />{chainLabel(chain)}</strong> : <span className="muted">Not chosen yet</span>}
          </div>
          {created?.expiresAt && created.status === 'open' && <div className="m-preview-row"><span className="muted">Expires</span><strong>{new Date(created.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong></div>}
          <div className="m-linkfield">
            <span className={url ? 'mono' : 'muted'}>{url ?? 'Your link appears here'}</span>
            <button type="button" className="icon-button" aria-label={copied ? 'Copied' : 'Copy link'} disabled={!url} onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={18} /></button>
          </div>
          {created && (
            <div className="row m-preview-actions">
              <a className="btn" href={`#/pay/${created.slug}`}>Open payment page</a>
              <button className="btn" onClick={() => { setAmount(''); setDescription(''); setCreated(null); setCopied(false); }}>Create another</button>
            </div>
          )}
        </div>

        <div className="m-card m-statbar">
          {stats ? (
            <>
              <div><strong>{stats.total}</strong><span>Total links</span></div>
              <div><strong>{stats.paid}</strong><span>Successful</span></div>
              <div><strong>{stats.pending}</strong><span>Pending</span></div>
            </>
          ) : [0, 1, 2].map((i) => <div key={i}><Skeleton w="36px" h="26px" /><Skeleton w="64px" h="12px" /></div>)}
        </div>
      </div>
    </div>
  );
}

function History({ data, err }: { data: MerchantData | null; err: string | null }) {
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const chip = (a: AttemptView | null, status: string) =>
    status === 'cancelled' ? <span className="badge bad">Cancelled</span>
    : status === 'expired' ? <span className="badge bad">Expired</span>
    : a ? <span className={`badge ${a.state === 'destination_confirmed' ? 'ok' : a.terminal ? 'bad' : ''}`}>{a.stateLabel}</span>
    : <span className="badge">{status === 'paid' ? 'Paid' : 'No payment yet'}</span>;

  const copy = async (slug: string) => {
    try { await navigator.clipboard.writeText(linkFor(slug)); setCopiedSlug(slug); setTimeout(() => setCopiedSlug((c) => (c === slug ? null : c)), 2000); }
    catch { setActionErr('Could not copy. Select the link and copy it manually.'); }
  };

  return (
    <div className="m-card m-history">
      <div className="m-card-head"><div><span className="eyebrow">History</span><h2>Your payment links</h2></div></div>
      {!data ? (
        err ? <p className="inline-error">{err}</p> : <><Skeleton w="100%" h="48px" block /><div style={{ height: 'var(--s3)' }} /><Skeleton w="100%" h="48px" block /></>
      ) : data.requests.length === 0 ? <p className="text-3">No payment requests yet.</p> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Created</th><th>Amount</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              {data.requests.map(({ request: r, latestAttempt: a }) => {
                const active = r.status === 'open';
                return (
                  <tr key={r.slug}>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td><span className="m-asset"><TokenIcon symbol={r.destination.symbol} chain={r.destination.blockchain} small />{r.destination.amountFormatted} {r.destination.symbol} <span className="muted">on</span> <ChainIcon chain={r.destination.blockchain} small /><span className="muted">{chainLabel(r.destination.blockchain)}</span></span>{r.description ? <div className="muted">{r.description}</div> : null}</td>
                    <td>{chip(a, r.status)}</td>
                    <td>
                      {active ? (
                        <>
                          <button type="button" className="link" onClick={() => copy(r.slug)}>{copiedSlug === r.slug ? 'Copied' : 'Copy link'}</button>
                          {' · '}<a href={`#/pay/${r.slug}`}>Open</a>
                        </>
                      ) : <span className="muted">{r.status === 'paid' ? 'Link closed (paid)' : r.status === 'expired' ? 'Link expired' : 'Link closed'}</span>}
                      {a ? <>{active ? ' · ' : ' '}<a href={`#/attempt/${a.id}`}>Payment</a></> : null}
                      {active && r.expiresAt ? <div className="muted">Expires {new Date(r.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {actionErr && <p className="inline-error">{actionErr}</p>}
      {data && err && <p className="inline-error">{err}</p>}
    </div>
  );
}

function SignedIn({ token, address, family, onSignOut }: { token: string; address: string; family: string; onSignOut: () => void }) {
  const [chains, setChains] = useState<CatalogChain[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api.catalog().then((c) => setChains(c.chains)).catch((e) => setLoadErr(errorMessage(e))); }, []);
  const { data, err } = useMerchantData(token, tick, onSignOut);
  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <div className="row between">
        <p className="text-3 small">Signed in as <span className="mono">{shortAddr(address, 8, 6)}</span> ({family === 'evm' ? 'EVM' : 'Solana'})</p>
        <button className="link" onClick={onSignOut}>Sign out</button>
      </div>
      {loadErr ? <p className="inline-error">{loadErr}</p> : <CreateRequest token={token} chains={chains} stats={data?.stats ?? null} onCreated={() => setTick((n) => n + 1)} />}
      <History data={data} err={err} />
    </div>
  );
}

export function Merchant() {
  const w = useWallets();
  return (
    <>
      <section className="page-head"><h1>Payment links</h1></section>
      {w.session
        ? <SignedIn token={w.session.token} address={w.session.address} family={w.session.family} onSignOut={w.signOut} />
        : <section className="column"><SignIn /></section>}
    </>
  );
}
