import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { AlertStatus } from '../lib/api.ts';
import { alertsPromptDismissed, dismissAlertsPrompt, shouldPromptForAlerts } from '../lib/alerts-prompt.ts';
import { useSettings } from '../settings/SettingsContext.tsx';
import { Icon } from './Icon.tsx';

/**
 * A one-time nudge on the Merchant tab: "add your email in Settings to get alerts". The email itself is set up and
 * confirmed in Settings > Email alerts; this only points there. It stays out of the way once the merchant confirmed
 * an address, and after they press "Not now".
 */
export function AlertsPrompt({ token, address, onExpired }: { token: string; address: string; onExpired: () => void }) {
  const { openSettings } = useSettings();
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [hidden, setHidden] = useState(() => alertsPromptDismissed(address));

  useEffect(() => { setHidden(alertsPromptDismissed(address)); }, [address]);
  useEffect(() => {
    let off = false;
    api.alertsStatus(token).then((s) => { if (!off) setStatus(s); }).catch((e: any) => { if (e?.status === 401) onExpired(); });
    return () => { off = true; };
  }, [token, onExpired]);

  const show = shouldPromptForAlerts(status, hidden);
  const notNow = () => { dismissAlertsPrompt(address); setHidden(true); };
  const goToSettings = () => { setHidden(true); openSettings('alerts'); }; // not remembered: if they leave without finishing, it asks again next visit

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') notNow(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  if (!show) return null;

  const pending = !!status?.email && !status.verified;
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="Email alerts">
      <button className="backdrop" aria-label="Close" onClick={notNow} />
      <div className="modal alerts-prompt">
        <button className="modal-close" aria-label="Close" onClick={notNow}><Icon name="close" size={18} /></button>
        <span className="icon-tile"><Icon name="bell" size={22} /></span>
        <div className="modal-head"><h2 style={{ paddingRight: 0 }}>{pending ? 'Finish your email setup' : 'Get an email when you are paid'}</h2></div>
        <p>{pending
          ? 'You started adding an email but have not confirmed it yet. Open Settings to enter the code.'
          : 'Add your email in Settings to get alerts when a payment link is paid, fails or is refunded.'}</p>
        <div className="row">
          <button className="btn primary" onClick={goToSettings}>{pending ? 'Open Settings' : 'Set up in Settings'}</button>
          <button className="btn" onClick={notNow}>Not now</button>
        </div>
      </div>
    </div>
  );
}
