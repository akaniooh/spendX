import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { AttemptView, RequestView } from '../lib/types.ts';
import { chainLabel, shortAddr } from '../lib/labels.ts';
import { errorMessage } from '../lib/errors.ts';
import { txUrl } from '../lib/chains.ts';
import { mmss, secondsLeft, useNow } from '../lib/hooks.ts';
import { Skeleton } from './Icon.tsx';

const STEPS: { state: AttemptView['state']; label: string }[] = [
  { state: 'awaiting_payment', label: 'Awaiting payment' },
  { state: 'payment_initiated', label: 'Payment initiated' },
  { state: 'source_submitted', label: 'Source transaction submitted' },
  { state: 'processing', label: 'Processing cross-chain transfer' },
  { state: 'destination_confirmed', label: 'Destination payment confirmed' },
];

function Link({ href, children }: { href: string | null; children: string }) {
  return href ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>;
}

export function AttemptTracker({ id }: { id: string }) {
  const [data, setData] = useState<{ attempt: AttemptView; request: RequestView | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await api.attempt(id);
        if (stop) return;
        setData(d); setErr(null);
        if (!d.attempt.terminal) timer = setTimeout(tick, 3000);
      } catch (e) {
        if (stop) return;
        setErr(errorMessage(e));
        timer = setTimeout(tick, 6000);
      }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  if (!data) {
    return (
      <>
        <section className="page-head"><h1>Status</h1></section>
        <section className="column"><div className="card">
          {err ? <p className="inline-error">{err}</p> : (
            <><Skeleton w="45%" h="24px" block /><div style={{ height: 'var(--s4)' }} /><Skeleton w="70%" h="14px" block /><div style={{ height: 'var(--s5)' }} />
              {[0, 1, 2, 3].map((i) => <div key={i} style={{ marginBottom: 'var(--s3)' }}><Skeleton w="55%" h="16px" block /></div>)}</>
          )}
        </div></section>
      </>
    );
  }
  const { attempt: a, request: r } = data;
  const idx = STEPS.findIndex((s) => s.state === a.state);
  const bad = ['failed', 'refunded', 'expired', 'cancelled', 'incomplete_deposit', 'needs_review'].includes(a.state);
  const waiting = !a.source && (a.state === 'awaiting_payment' || a.state === 'payment_initiated');

  return (
    <>
    <section className="page-head"><h1>{r?.kind === 'swap' ? 'Swap' : 'Payment'} status</h1></section>
    <div className="column stack">
      <div className="card">
        <div className="row between">
          <h2>{a.state === 'destination_confirmed' ? (r?.kind === 'swap' ? 'Swap complete' : 'Payment complete') : (r?.kind === 'swap' ? 'Swap status' : 'Payment status')}</h2>
          <span className={`badge ${a.state === 'destination_confirmed' ? 'ok' : bad ? 'bad' : ''}`}>{a.stateLabel}</span>
        </div>
        {r && (r.kind === 'swap'
          ? <p className="text-3">Swap: {a.deposit.amountFormatted} {a.origin.symbol} on {chainLabel(a.origin.blockchain)} to at least {r.destination.amountFormatted} {r.destination.symbol} on {chainLabel(r.destination.blockchain)}, delivered to {shortAddr(r.recipient, 8, 6)}</p>
          : <p className="text-3">{r.destination.amountFormatted} {r.destination.symbol} on {chainLabel(r.destination.blockchain)} to {shortAddr(r.recipient, 8, 6)}{r.description ? ` · ${r.description}` : ''}</p>)}

        {!bad && (
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.state} className={i < idx || a.state === 'destination_confirmed' ? 'done' : i === idx ? 'current' : ''}>{s.label}</li>
            ))}
          </ol>
        )}

        {waiting && (
          <p className="text-3">Deposit window closes in <strong>{mmss(secondsLeft(a.deposit.deadline, now))}</strong>. {secondsLeft(a.deposit.deadline, now) === 0 ? 'The window has closed.' : 'Do not send funds after it closes.'}</p>
        )}
        {a.state === 'expired' && <p className="inline-error">The quote expired before a deposit was made. Nothing was sent. Start a new payment from the payment link.</p>}
        {a.state === 'cancelled' && <p className="text-3">This attempt was cancelled before anything was sent.</p>}
        {a.state === 'failed' && <p className="inline-error">The cross-chain transfer failed. If a deposit was made, NEAR Intents refunds it to your refund address.</p>}
        {a.state === 'incomplete_deposit' && <p className="inline-error">The deposit was smaller than required. A refund is pending with NEAR Intents.</p>}
        {a.state === 'needs_review' && <p className="inline-error">NEAR Intents reported success, but SpendX could not match the delivery on the destination chain. Do not treat this as paid. Keep the transaction links below and contact the merchant.</p>}
        {a.state === 'refunded' && (
          <p className="inline-error">Refunded{a.refund?.amountFormatted ? `: ${a.refund.amountFormatted} ${a.origin.symbol}` : ''}{a.refund?.reason ? ` (${a.refund.reason})` : ''}. The funds returned to {shortAddr(a.payerAddress, 8, 6)} on {chainLabel(a.origin.blockchain)}.</p>
        )}

        {a.state === 'destination_confirmed' && (
          <p className={a.delivery === 'verified' ? 'ok-text' : 'text-3'}>
            {a.delivery === 'verified'
              ? 'Verified on-chain: SpendX confirmed the transfer on the destination chain.'
              : 'Delivery reported by NEAR Intents, with the destination transaction below. SpendX has not independently verified this chain yet.'}
          </p>
        )}
      </div>

      <div className="card">
        <h3>Transactions</h3>
        <dl className="kv">
          <dt>You sent</dt><dd>{a.deposit.amountFormatted} {a.origin.symbol} on {chainLabel(a.origin.blockchain)}</dd>
          <dt>Source transaction</dt>
          <dd>{a.source ? <Link href={a.source.explorerUrl ?? txUrl(a.origin.blockchain, a.source.txHash)}>{shortAddr(a.source.txHash, 10, 8)}</Link> : <span className="text-3">not yet detected</span>}</dd>
          <dt>Destination transaction</dt>
          <dd>{a.destination.txs.length ? a.destination.txs.map((t) => <div key={t.hash}><Link href={t.explorerUrl}>{shortAddr(t.hash, 10, 8)}</Link></div>) : <span className="text-3">not yet delivered</span>}</dd>
          <dt>NEAR Intents</dt>
          <dd>{a.near.intentHashes.length ? a.near.intentHashes.map((h) => <div key={h} className="mono">{shortAddr(h, 10, 8)}</div>) : <span className="text-3">pending</span>}</dd>
          <dt>Deposit address</dt><dd className="mono">{shortAddr(a.deposit.address, 10, 8)}</dd>
          <dt>Refund address</dt><dd className="mono">{shortAddr(a.payerAddress, 10, 8)}</dd>
        </dl>
        {err && <p className="inline-error">{err}</p>}
      </div>
    </div>
    </>
  );
}
