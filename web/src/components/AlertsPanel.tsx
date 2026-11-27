import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { AlertStatus } from '../lib/api.ts';
import { errorMessage } from '../lib/errors.ts';
import { useWallets } from '../wallets/WalletContext.tsx';

/**
 * Email alerts for a merchant, shown inside Settings. Three steps, one at a time: type an email, type back the
 * 6-digit code we send to it, then alerts are on. Nothing is sent to an address until the code is confirmed.
 * Alerts belong to the signed-in merchant wallet, so without a sign-in this only points to the Merchant tab.
 */
export function AlertsPanel({ onClose }: { onClose: () => void }) {
  const { session, signOut } = useWallets();
  if (!session) {
    return (
      <div className="set-alerts">
        <p className="set-note">Email alerts are tied to your merchant sign-in, so sign in on the Merchant tab first. Then come back here to add your email.</p>
        <div className="row"><a className="btn primary" href="#/merchant" onClick={onClose}>Go to Merchant</a></div>
      </div>
    );
  }
  return <AlertsForm token={session.token} onExpired={signOut} />;
}

function AlertsForm({ token, onExpired }: { token: string; onExpired: () => void }) {
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [changing, setChanging] = useState(false); // typing a new address while one is already confirmed
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fail = useCallback((e: any) => { if (e?.status === 401) onExpired(); else setErr(errorMessage(e)); }, [onExpired]);
  useEffect(() => { api.alertsStatus(token).then(setStatus).catch(fail); }, [token, fail]);

  async function run(fn: () => Promise<AlertStatus>, then?: () => void) {
    setBusy(true); setErr(null);
    try { setStatus(await fn()); then?.(); } catch (e) { fail(e); } finally { setBusy(false); }
  }

  if (!status) return <div className="set-alerts">{err ? <p className="inline-error">{err}</p> : <p className="set-note">Loading…</p>}</div>;

  const on = !!status.verified && !changing;
  const confirming = !!status.email && !status.verified && !changing;

  return (
    <div className="set-alerts">
      <p className="set-status">{on ? 'Alerts are on' : confirming ? 'Confirm your email' : 'Get an email when you are paid'}</p>

      {on && (
        <>
          <p className="set-note">We email <strong>{status.email}</strong> when a payment link is paid, fails or is refunded.</p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => { setChanging(true); setEmail(''); setErr(null); }}>Change email</button>
            <button className="btn" disabled={busy} onClick={() => run(() => api.alertsRemove(token))}>Turn off</button>
          </div>
        </>
      )}

      {confirming && (
        <>
          <p className="set-note">We sent a 6-digit code to <strong>{status.email}</strong>. It can take a minute, and may land in spam.</p>
          <div className="m-box m-input">
            <input aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy || code.length !== 6} onClick={() => run(() => api.alertsVerify(token, code), () => setCode(''))}>{busy ? 'Checking…' : 'Confirm'}</button>
            <button className="btn" disabled={busy} onClick={() => run(() => api.alertsEmail(token, status.email!))}>Send a new code</button>
            <button className="link" disabled={busy} onClick={() => { setChanging(true); setEmail(''); setErr(null); }}>Use a different email</button>
          </div>
        </>
      )}

      {!on && !confirming && (
        <>
          <p className="set-note">{changing ? 'Alerts pause until you confirm the new address.' : 'We email you when a payment link is paid, fails or is refunded. You confirm your address first.'}</p>
          <div className="m-box m-input">
            <input aria-label="Email address" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" maxLength={254} value={email}
              onChange={(e) => setEmail(e.target.value.trim())} spellCheck={false} />
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy || !email.includes('@')} onClick={() => run(() => api.alertsEmail(token, email), () => { setChanging(false); setCode(''); })}>{busy ? 'Sending…' : 'Send code'}</button>
            {changing && <button className="link" disabled={busy} onClick={() => { setChanging(false); setErr(null); }}>Cancel</button>}
          </div>
        </>
      )}
      {err && <p className="inline-error">{err}</p>}
    </div>
  );
}
