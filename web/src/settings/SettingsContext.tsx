import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY, formatMoney, parseSettings, resolveTheme } from '../lib/settings.ts';
import type { Settings } from '../lib/settings.ts';

export type SettingsView = 'main' | 'currency' | 'balances' | 'alerts' | 'data';

interface SettingsValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
  /** a USD amount in the chosen display currency */
  money: (usd: number) => string;
  ratesStatus: 'ready' | 'loading' | 'unavailable';
  resolvedTheme: 'light' | 'dark';
  /** the Settings panel is controlled from here so other pages can open it on a given screen */
  panel: { open: boolean; view: SettingsView };
  openSettings: (view?: SettingsView) => void;
  closeSettings: () => void;
  setSettingsView: (view: SettingsView) => void;
}

const Ctx = createContext<SettingsValue | null>(null);
const DARK_QUERY = '(prefers-color-scheme: dark)';
const read = () => { try { return localStorage.getItem(SETTINGS_KEY); } catch { return null; } };

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => parseSettings(read()));
  const [deviceDark, setDeviceDark] = useState(() => (typeof matchMedia === 'function' ? matchMedia(DARK_QUERY).matches : true));
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 });
  const [ratesFailed, setRatesFailed] = useState(false);
  const [panel, setPanel] = useState<{ open: boolean; view: SettingsView }>({ open: false, view: 'main' });

  const openSettings = useCallback((view: SettingsView = 'main') => setPanel({ open: true, view }), []);
  const closeSettings = useCallback(() => setPanel({ open: false, view: 'main' }), []);
  const setSettingsView = useCallback((view: SettingsView) => setPanel((p) => ({ ...p, view })), []);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(DARK_QUERY);
    const on = () => setDeviceDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const resolvedTheme = resolveTheme(settings.theme, deviceDark);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'light' ? '#f4f6f9' : '#080a0e');
  }, [resolvedTheme]);

  // Exchange rates are only fetched when a non-USD currency is chosen.
  const needsRates = settings.currency !== 'USD' && !rates[settings.currency];
  useEffect(() => {
    if (!needsRates) return;
    let off = false;
    setRatesFailed(false);
    api.rates().then((r) => { if (!off) setRates({ USD: 1, ...r.rates }); }).catch(() => { if (!off) setRatesFailed(true); });
    return () => { off = true; };
  }, [needsRates, settings.currency]);

  const persist = (next: Settings) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage unavailable: the choice lasts until reload */ } };
  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => { const next = parseSettings(JSON.stringify({ ...s, ...patch })); persist(next); return next; }), []);
  const reset = useCallback(() => { persist(DEFAULT_SETTINGS); setSettings(DEFAULT_SETTINGS); }, []);
  const money = useCallback((usd: number) => formatMoney(usd, settings.currency, rates), [settings.currency, rates]);
  const ratesStatus: SettingsValue['ratesStatus'] = !needsRates ? 'ready' : ratesFailed ? 'unavailable' : 'loading';

  const value = useMemo(
    () => ({ settings, update, reset, money, ratesStatus, resolvedTheme, panel, openSettings, closeSettings, setSettingsView }),
    [settings, update, reset, money, ratesStatus, resolvedTheme, panel, openSettings, closeSettings, setSettingsView]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings must be used inside <SettingsProvider>');
  return v;
}
