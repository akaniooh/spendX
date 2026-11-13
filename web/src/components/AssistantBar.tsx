import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { balanceLabel, readBalances, type BalanceRow, type BalanceTarget } from '../lib/balances.ts';
import { errorMessage } from '../lib/errors.ts';
import { payLinkSlug } from '../lib/route.ts';
import type { AssistantResult } from '../lib/types.ts';
import { useWallets } from '../wallets/WalletContext.tsx';
import { Icon } from './Icon.tsx';

/**
 * Describe a swap in a sentence; the card below is filled in for you to review. Or ask for a balance ("my USDC balance
 * on Base"): the AI only names the token, and the balance is then read from YOUR connected wallet in this browser, so
 * neither the AI nor the server ever sees your address or holdings. The assistant only proposes:
 * it cannot connect, sign or send anything. A pasted SpendX payment link opens that payment directly (no AI involved).
 * Hidden entirely when the server has no AI key, so nothing here is ever a dead control.
 */
export function AssistantBar({ onResult }: { onResult: (r: AssistantResult) => string[] | void }) {
  const [status, setStatus] = useState<'loading' | 'on' | 'off' | 'unreachable'>('loading');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const w = useWallets();
  const [balances, setBalances] = useState<{ targets: BalanceTarget[]; rows: BalanceRow[] | null } | null>(null);
  const run = useRef(0); // a newer question makes the balance reads of an older one irrelevant

  useEffect(() => { api.config().then((c) => setStatus(c.assistant ? 'on' : 'off')).catch(() => setStatus('unreachable')); }, []);
  if (status === 'loading') return null;
  if (status !== 'on') {
    // Hidden for visitors. While developing, say why, so a missing key or a stopped server is not a mystery.
    if (!import.meta.env.DEV) return null;
    return (
      <p className="assistant-note">
        {status === 'unreachable'
          ? 'Dev note: the API is not reachable. Start it with npm start (port 8787).'
          : 'Dev note: the assistant is off. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env and restart npm start.'}
      </p>
    );
  }

  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setError(null);
    const slug = payLinkSlug(t);
    if (slug) { window.location.hash = `#/pay/${slug}`; return; }
    setBusy(true);
    const id = ++run.current;
    try {
      const r = await api.assistant(t);
      if (r.action === 'balance' && r.balance) {
        const targets = r.balance.tokens;
        setBalances({ targets, rows: null });
        setMessage(r.message);
        setIssues(r.issues);
        void readBalances(targets, w.adapterFor).then((rows) => { if (run.current === id) setBalances({ targets, rows }); });
        return;
      }
      setBalances(null);
      const extra = onResult(r) ?? [];
      setMessage(r.message);
      setIssues([...r.issues, ...extra]);
    } catch (e) {
      setBalances(null); setMessage(null); setIssues([]); setError(errorMessage(e));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <form className="assistant" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <input aria-label="Describe a swap or ask for a balance" placeholder="Try: 10 SOL to USDC on Base, or my USDC balance" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={busy || !text.trim()}><Icon name="sparkle" size={18} />{busy ? 'Reading…' : 'Fill in'}</button>
      </form>
      {(message || issues.length > 0 || error) && (
        <div className="assistant-result" role="status">
          {message && <p>{message}</p>}
          {issues.map((i) => <p key={i} className="warn">{i}</p>)}
          {error && <p className="inline-error" style={{ margin: 0 }}>{error}</p>}
        </div>
      )}
      {balances && (
        <div className="assistant-result" role="status" aria-live="polite">
          <ul className="balance-list">
            {balances.targets.map((t, i) => {
              const row = balances.rows?.[i];
              return (
                <li key={t.assetId}>
                  <span>{balanceLabel(t, balances.targets)}</span>
                  {!row && <span className="balance-note">Reading…</span>}
                  {row?.status === 'ok' && <strong>{row.amount}</strong>}
                  {row && row.status !== 'ok' && <span className={`balance-note ${row.status === 'error' ? 'warn' : ''}`}>{row.message}</span>}
                </li>
              );
            })}
          </ul>
          {balances.rows?.some((r) => r.status === 'no-wallet') && (
            <button type="button" className="balance-connect" onClick={w.openWalletModal}>Connect wallet</button>
          )}
          <p className="balance-note">Read from your connected wallet in this browser. Your balance is not sent to the AI.</p>
        </div>
      )}
      <p className="assistant-note">Read by an AI model. Never paste keys or seed phrases.</p>
    </div>
  );
}
