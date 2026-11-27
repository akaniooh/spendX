import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CURRENCIES } from '../../../shared/src/currencies.ts';
import { ACTIVITY_HISTORY_KEY, PORTFOLIO_HISTORY_KEY, clearLocalData } from '../lib/local-data.ts';
import { PAGE_SIZES, SMALL_BALANCE_USD } from '../lib/settings.ts';
import type { ThemePref } from '../lib/settings.ts';
import { useSettings } from '../settings/SettingsContext.tsx';
import type { SettingsView } from '../settings/SettingsContext.tsx';
import { AlertsPanel } from './AlertsPanel.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

type View = SettingsView;
const TITLES: Record<View, string> = { main: 'Settings', currency: 'Local currency', balances: 'Balances and activity', alerts: 'Email alerts', data: 'App data' };

function Row({ icon, label, value, onClick }: { icon: IconName; label: string; value?: string; onClick: () => void }) {
  return (
    <button type="button" className="set-row" onClick={onClick}>
      <Icon name={icon} size={20} /><span className="set-label">{label}</span>
      {value && <span className="set-value">{value}</span>}
      <Icon name="chevron" size={18} />
    </button>
  );
}

function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="set-row switch-row">
      <span className="set-label">{label}{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** A destructive action asks twice: the first tap turns the button into a confirmation. */
function DangerRow({ label, hint, onConfirm }: { label: string; hint: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return (
    <button type="button" className={`set-row danger ${armed ? 'armed' : ''}`} onClick={() => { if (!armed) { setArmed(true); setDone(false); return; } onConfirm(); setArmed(false); setDone(true); }}>
      <span className="set-label">{armed ? 'Tap again to confirm' : done ? `${label}: done` : label}<small>{hint}</small></span>
    </button>
  );
}

export function SettingsMenu() {
  const { settings, update, reset, ratesStatus, panel, openSettings, closeSettings, setSettingsView } = useSettings();
  const { open, view } = panel;
  const setView = setSettingsView;
  const close = closeSettings;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { view === 'main' ? close() : setView('main'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view]);

  const themes: { v: ThemePref; icon: IconName; label: string }[] = [{ v: 'auto', icon: 'themeHalf', label: 'Auto' }, { v: 'light', icon: 'sun', label: 'Light' }, { v: 'dark', icon: 'moon', label: 'Dark' }];

  let body: ReactNode;
  if (view === 'currency') {
    body = (
      <>
        <p className="set-note">Shown on your Portfolio. Payments and swaps always show USD, the currency they settle in.</p>
        {ratesStatus === 'unavailable' && <p className="set-note warn">Exchange rates are unavailable right now, so amounts still show in USD.</p>}
        <ul className="set-list">
          {CURRENCIES.map((c) => (
            <li key={c.code}>
              <button type="button" className="set-row" aria-pressed={settings.currency === c.code} onClick={() => { update({ currency: c.code }); setView('main'); }}>
                <span className="set-label">{c.code}<small>{c.name}</small></span>
                {settings.currency === c.code && <Icon name="check" size={18} />}
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  } else if (view === 'balances') {
    body = (
      <>
        <Switch label="Hide balances" hint="Replace amounts on the Portfolio with ••••" checked={settings.hideBalances} onChange={(v) => update({ hideBalances: v })} />
        <Switch label="Hide small balances" hint={`Leave out tokens worth under $${SMALL_BALANCE_USD} from the Portfolio list`} checked={settings.hideSmall} onChange={(v) => update({ hideSmall: v })} />
        <div className="set-block">
          <span className="set-label">Activity rows per page</span>
          <div className="seg" role="group" aria-label="Activity rows per page">
            {PAGE_SIZES.map((n) => <button key={n} type="button" aria-pressed={settings.activityPageSize === n} onClick={() => update({ activityPageSize: n })}>{n}</button>)}
          </div>
        </div>
      </>
    );
  } else if (view === 'alerts') {
    body = <AlertsPanel onClose={close} />;
  } else if (view === 'data') {
    body = (
      <>
        <p className="set-note">SpendX keeps these in this browser only. Clearing them does not touch your wallets or any payment.</p>
        <DangerRow label="Clear portfolio history" hint="The saved balance readings behind the Portfolio chart" onConfirm={() => clearLocalData(PORTFOLIO_HISTORY_KEY)} />
        <DangerRow label="Clear activity saved here" hint="Swaps and payments remembered by this browser" onConfirm={() => clearLocalData(ACTIVITY_HISTORY_KEY)} />
        <DangerRow label="Reset settings" hint="Back to the defaults" onConfirm={reset} />
      </>
    );
  } else {
    const cur = CURRENCIES.find((c) => c.code === settings.currency);
    body = (
      <>
        <h3 className="set-section">Preferences</h3>
        <div className="set-row theme-row">
          <Icon name="themeHalf" size={20} /><span className="set-label">Theme</span>
          <div className="seg icons" role="group" aria-label="Theme">
            {themes.map((t) => <button key={t.v} type="button" aria-pressed={settings.theme === t.v} aria-label={t.label} title={t.label} onClick={() => update({ theme: t.v })}>{t.v === 'auto' ? 'Auto' : <Icon name={t.icon} size={16} />}</button>)}
          </div>
        </div>
        <Row icon="coins" label="Local currency" value={cur ? cur.code : 'USD'} onClick={() => setView('currency')} />
        <Row icon="bars" label="Balances and activity" onClick={() => setView('balances')} />
        <h3 className="set-section">Merchant</h3>
        <Row icon="bell" label="Email alerts" onClick={() => setView('alerts')} />
        <h3 className="set-section">Advanced</h3>
        <Row icon="database" label="App data" onClick={() => setView('data')} />
      </>
    );
  }

  return (
    <div className="settings-wrap">
      <button type="button" className={`icon-button ${open ? 'on' : ''}`} aria-label="Settings" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : openSettings())}>
        <Icon name="settings" size={20} />
      </button>
      {open && (
        <>
          <button type="button" className="settings-backdrop" aria-label="Close settings" onClick={close} />
          <div className="settings-pop" role="dialog" aria-label="Settings">
            <div className="settings-head">
              {view !== 'main' ? <button type="button" className="set-back" aria-label="Back" onClick={() => setView('main')}><Icon name="back" size={20} /></button> : <span className="set-back" aria-hidden="true" />}
              <h2>{TITLES[view]}</h2>
              <button type="button" className="set-back" aria-label="Close" onClick={close}><Icon name="close" size={18} /></button>
            </div>
            <div className="settings-body">{body}</div>
          </div>
        </>
      )}
    </div>
  );
}
