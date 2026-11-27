import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { AlertStatus } from '../lib/api.ts';
import { errorMessage } from '../lib/errors.ts';
import { Icon } from './Icon.tsx';

/**
 * Email alerts for a merchant. Three steps, one at a time: type an email, type back the 6-digit code we send to it,
 * then alerts are on. Nothing is sent to an address until the code is confirmed.
 */
export function AlertsCard({ token, onExpired }: { token: string; onExpired: () => void }) {
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

  if (!status?.enabled) return null; // the server has no email provider set up, so there is nothing to show

  const on = !!status.verified && !changing;
  const confirming = !!status.email && !status.verified && !changing;

  return (
    <div className="m-card m-alerts">
      <div className="m-card-head">
        <span className="icon-tile"><Icon name="bell" size={22} /></span>
        <div><span className="eyebrow">Email alerts</span><h2>{on ? 'Alerts are on' : 'Get an email when you are paid'}</h2></div>
      </div>

      {on && (
        <>
          <p className="text-3">We email <strong>{status.email}</strong> when a payment link is paid, fails or is refunded.</p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => { setChanging(true); setEmail(''); setErr(null); }}>Change email</button>
            <button className="btn" disabled={busy} onClick={() => run(() => api.alertsRemove(token))}>Turn off</button>
          </div>
        </>
      )}

      {confirming && (
        <>
          <p className="text-3">We sent a 6-digit code to <strong>{status.email}</strong>. It can take a minute, and may land in spam.</p>
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
          <p className="text-3">{changing ? 'Alerts pause until you confirm the new address.' : 'We email you when a payment link is paid, fails or is refunded. You confirm your address first.'}</p>
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
