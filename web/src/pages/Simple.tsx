import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { slugFromInput } from '../lib/route.ts';
import { parseHistory } from '../lib/history.ts';
import type { HistoryEntry } from '../lib/history.ts';
import { shortAddr } from '../lib/labels.ts';
import { useWallets } from '../wallets/WalletContext.tsx';

function useHistory(): HistoryEntry[] {
  const [h, setH] = useState<HistoryEntry[]>([]);
  useEffect(() => { try { setH(parseHistory(localStorage.getItem('spendx.history'))); } catch { setH([]); } }, []);
  return h;
}

function StateChip({ id }: { id: string }) {
  const [label, setLabel] = useState<string>('…');
  const [kind, setKind] = useState('');
  useEffect(() => {
    let off = false;
    api.attempt(id).then((d) => { if (!off) { setLabel(d.attempt.stateLabel); setKind(d.attempt.state === 'destination_confirmed' ? 'ok' : d.attempt.terminal ? 'bad' : ''); } }).catch(() => { if (!off) setLabel('unavailable'); });
    return () => { off = true; };
  }, [id]);
  return <span className={`badge ${kind}`}>{label}</span>;
}

function HistoryList({ items }: { items: HistoryEntry[] }) {
  if (items.length === 0) return <p className="muted">No payments from this browser yet.</p>;
  return (
    <ul className="list">
      {items.map((e) => (
        <li key={e.attemptId}>
          <a href={`#/attempt/${e.attemptId}`}>{e.label}</a>
          <span className="muted">{new Date(e.createdAt).toLocaleString()}</span>
          <StateChip id={e.attemptId} />
        </li>
      ))}
    </ul>
  );
}

export function Home() {
  const w = useWallets();
  const h = useHistory();
  return (
    <div className="stack">
      <div className="hero">
        <h1>Pay on any chain, with any token.</h1>
        <p className="muted">Merchants ask for an exact amount on the network they prefer. Customers pay from whatever they hold. Or swap your own tokens to any other chain in one step. NEAR Intents handles the conversion, the bridging and the delivery.</p>
        <div className="row">
          <a className="btn primary" href="#/merchant">Create payment</a>
          <a className="btn" href="#/payments">Pay a merchant</a>
          <a className="btn" href="#/swap">Swap across chains</a>
        </div>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Connected wallets</h3>
          {!w.evm && !w.svm ? <p className="muted">No wallet connected. Use the buttons at the top right.</p> : (
            <ul className="list">
              {w.evm && <li><span>EVM · {w.evm.name}</span><span className="mono">{shortAddr(w.evm.address, 8, 6)}</span></li>}
              {w.svm && <li><span>Solana · Phantom</span><span className="mono">{shortAddr(w.svm.address, 8, 6)}</span></li>}
            </ul>
          )}
        </div>
        <div className="card">
          <h3>Recent activity</h3>
          <HistoryList items={h.slice(0, 5)} />
        </div>
      </div>
    </div>
  );
}

export function Payments() {
  const [input, setInput] = useState('');
  const slug = slugFromInput(input);
  return (
    <div className="card narrow">
      <h2>Pay a merchant</h2>
      <p className="muted">Paste the payment link the merchant sent you.</p>
      <label className="field"><span>Payment link</span>
        <input placeholder="https://…/#/pay/…" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
        {input && !slug && <small className="warn">That does not look like a SpendX payment link.</small>}
      </label>
      <button className="btn primary" disabled={!slug} onClick={() => { if (slug) window.location.hash = `#/pay/${slug}`; }}>Open payment</button>
    </div>
  );
}

export function Activity() {
  const h = useHistory();
  return (
    <div className="card">
      <h2>Your activity</h2>
      <p className="muted">Payments started in this browser. Open one to see live status and transaction links.</p>
      <HistoryList items={h} />
    </div>
  );
}
