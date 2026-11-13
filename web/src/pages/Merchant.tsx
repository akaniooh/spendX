import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { AttemptView, CatalogChain, CatalogToken, RequestView } from '../lib/types.ts';
import { chainLabel, shortAddr } from '../lib/labels.ts';
import { errorMessage } from '../lib/errors.ts';
import { validateAddress } from '../../../shared/src/addresses.ts';
import { useWallets } from '../wallets/WalletContext.tsx';
import { TokenSelect } from '../components/TokenSelect.tsx';
import { Skeleton } from '../components/Icon.tsx';

const linkFor = (slug: string) => `${window.location.origin}/#/pay/${slug}`;

function SignIn() {
  const w = useWallets();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (family: 'evm' | 'svm') => {
    setErr(null); setBusy(true);
    try { await w.signIn(family); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h2>Sign in</h2>
      <div className="row">
        <button className="btn primary" disabled={!w.evm || busy} onClick={() => go('evm')}>{w.evm ? `Sign in with ${w.evm.name}` : 'Connect an EVM wallet first'}</button>
        <button className="btn primary" disabled={!w.svm || busy} onClick={() => go('svm')}>{w.svm ? 'Sign in with Phantom' : 'Connect Phantom first'}</button>
      </div>
      {err && <p className="inline-error">{err}</p>}
    </div>
  );
}

function CreateRequest({ token, chains, onCreated }: { token: string; chains: CatalogChain[]; onCreated: () => void }) {
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

  const check = chain && recipient ? validateAddress(chain, recipient) : null;
  const connectedHere = chain ? (validateAddress(chain, w.evm?.address ?? '').status === 'valid' ? w.evm?.address : validateAddress(chain, w.svm?.address ?? '').status === 'valid' ? w.svm?.address : undefined) : undefined;
  const ready = !!tok && /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && !!check && check.status !== 'invalid' && (check.status === 'valid' || ack);

  async function submit() {
    if (!tok) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.createRequest(token, { destAssetId: tok.assetId, amount, recipient, description: description.trim() || undefined, acknowledgeUncheckedAddress: ack });
      setCreated(r); onCreated();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (created) {
    const url = linkFor(created.slug);
    return (
      <div className="card accented">
        <h2>Payment link ready</h2>
        <div className="linkbox"><code>{url}</code></div>
        <div className="row">
          <button className="btn primary" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy link'}</button>
          <a className="btn" href={`#/pay/${created.slug}`}>Open payment page</a>
          <button className="btn" onClick={() => { setCreated(null); setAmount(''); setDescription(''); setCopied(false); }}>Create another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <TokenSelect chains={chains} chain={chain} assetId={tok?.assetId ?? ''} onChange={(c, t) => { setChain(c); setTok(t); setAck(false); }} chainLabelText="You receive on" tokenLabelText="You receive" />
      <label className="field"><span>Amount{tok ? ` (${tok.symbol})` : ''}</span>
        <input inputMode="decimal" placeholder="1.00" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
        {tok && amount && /^\d+\.\d+$/.test(amount) && amount.split('.')[1].length > tok.decimals && <small className="warn">{tok.symbol} supports at most {tok.decimals} decimal places.</small>}
      </label>
      <label className="field"><span>Recipient address{chain ? ` on ${chainLabel(chain)}` : ''}</span>
        <input placeholder="Where the funds should arrive" value={recipient} onChange={(e) => { setRecipient(e.target.value.trim()); setAck(false); }} spellCheck={false} />
        {connectedHere && !recipient && <button type="button" className="link" onClick={() => setRecipient(connectedHere)}>Use my connected address ({shortAddr(connectedHere)})</button>}
        {check?.status === 'invalid' && <small className="warn">{check.reason}</small>}
        {check?.status === 'unchecked' && (
          <small className="warn">SpendX cannot validate {chainLabel(chain)} addresses yet. A wrong address means lost funds.
            <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have double-checked this address</label>
          </small>
        )}
      </label>
      <label className="field"><span>Description (optional)</span>
        <input maxLength={140} placeholder="Order 42" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button className="btn primary" disabled={!ready || busy} onClick={submit}>{busy ? 'Creating…' : 'Create payment link'}</button>
      {err && <p className="inline-error">{err}</p>}
    </div>
  );
}

function Dashboard({ token, refreshKey, onExpired }: { token: string; refreshKey: number; onExpired: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.merchantRequests>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.merchantRequests(token)); setErr(null); }
    catch (e: any) { if (e?.status === 401) onExpired(); else setErr(errorMessage(e)); }
  }, [token, onExpired]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load, refreshKey]);

  if (!data) {
    return (
      <div className="card">
        <h2>Payments</h2>
        {err ? <p className="inline-error">{err}</p> : (
          <>
            <div className="stats">{[0, 1, 2].map((i) => <div key={i}><Skeleton w="40px" h="30px" /><Skeleton w="90px" h="14px" /></div>)}</div>
            <Skeleton w="100%" h="48px" block /><div style={{ height: 'var(--s3)' }} /><Skeleton w="100%" h="48px" block />
          </>
        )}
      </div>
    );
  }
  const chip = (a: AttemptView | null, status: string) => a ? <span className={`badge ${a.state === 'destination_confirmed' ? 'ok' : a.terminal ? 'bad' : ''}`}>{a.stateLabel}</span> : <span className="badge">{status === 'paid' ? 'Paid' : 'No payment yet'}</span>;
  return (
    <div className="card">
      <h2>Payments</h2>
      <div className="stats">
        <div><strong>{data.stats.total}</strong><span>Total requests</span></div>
        <div><strong>{data.stats.paid}</strong><span>Successful</span></div>
        <div><strong>{data.stats.pending}</strong><span>Pending</span></div>
      </div>
      {data.requests.length === 0 ? <p className="text-3">No payment requests yet.</p> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Created</th><th>Amount</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              {data.requests.map(({ request: r, latestAttempt: a }) => (
                <tr key={r.slug}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{r.destination.amountFormatted} {r.destination.symbol} <span className="muted">on {chainLabel(r.destination.blockchain)}</span>{r.description ? <div className="muted">{r.description}</div> : null}</td>
                  <td>{chip(a, r.status)}</td>
                  <td>
                    <a href={`#/pay/${r.slug}`}>Link</a>
                    {a ? <> · <a href={`#/attempt/${a.id}`}>Payment</a></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <p className="inline-error">{err}</p>}
    </div>
  );
}

export function Merchant() {
  const w = useWallets();
  const [chains, setChains] = useState<CatalogChain[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api.catalog().then((c) => setChains(c.chains)).catch((e) => setLoadErr(errorMessage(e))); }, []);

  const header = (
    <section className="page-head"><h1>Create payment link</h1></section>
  );
  if (!w.session) return <>{header}<section className="column"><SignIn /></section></>;
  return (
    <>{header}
    <div className="stack" style={{ gap: 'var(--s7)' }}>
      <div className="row between">
        <p className="text-3 small">Signed in as <span className="mono">{shortAddr(w.session.address, 8, 6)}</span> ({w.session.family === 'evm' ? 'EVM' : 'Solana'})</p>
        <button className="link" onClick={w.signOut}>Sign out</button>
      </div>
      <div className="column" style={{ width: 'min(600px, 100%)' }}>
        {loadErr ? <p className="inline-error">{loadErr}</p> : <CreateRequest token={w.session.token} chains={chains} onCreated={() => setTick((n) => n + 1)} />}
      </div>
      <Dashboard token={w.session.token} refreshKey={tick} onExpired={w.signOut} />
    </div>
    </>
  );
}
