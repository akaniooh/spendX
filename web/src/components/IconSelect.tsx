import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Icon } from './Icon.tsx';

export interface IconOption {
  value: string;
  label: string;
  /** shown in the list */
  icon: ReactNode;
  /** shown on the closed control when this option is selected (defaults to `icon`) */
  selectedIcon?: ReactNode;
  /** small text at the right of the row in the list (a token's price, for example) */
  detail?: string;
  /** a reason string disables the option and is shown beside it */
  disabledReason?: string | null;
}

interface Props {
  value: string;
  options: IconOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
  placeholderIcon?: ReactNode;
  disabled?: boolean;
  /** classes of the closed control, so it keeps the look of the box or pill it replaces */
  className?: string;
  /** open the list towards the left edge instead of the right (for controls at the right of a row) */
  alignRight?: boolean;
  arrowSize?: number;
  /** show a search box once the list is longer than this many options (default 6; pass Infinity to turn search off) */
  searchAbove?: number;
}

/**
 * A drop-down that can show an icon beside every choice, which a native <select> cannot.
 * Mouse, touch and keyboard (arrows, Home/End, Enter/Space, Escape) all work, and it reads as a listbox to screen readers.
 */
export function IconSelect({ value, options, onChange, ariaLabel, placeholder, placeholderIcon, disabled = false, className = '', alignRight = false, arrowSize = 16, searchAbove = 6 }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = options.find((o) => o.value === value);
  const searchable = options.length > searchAbove;
  const q = query.trim().toLowerCase();
  // `shown` is what the list displays; every index below (active, choose, step) refers to it
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase() === q) : options;
  const enabled = (i: number) => !!shown[i] && !shown[i].disabledReason;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => { if (open && active >= 0) (list.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }); }, [open, active]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  // on a mouse or keyboard device the search box takes focus at once; on a phone it is left alone so the keyboard does not cover the list
  useEffect(() => {
    if (open && searchable && window.matchMedia?.('(pointer: fine)').matches) search.current?.focus();
  }, [open, searchable]);

  const show = () => {
    if (disabled) return;
    const at = options.findIndex((o) => o.value === value);
    setQuery('');
    setActive(at >= 0 ? at : options.findIndex((o) => !o.disabledReason));
    setOpen(true);
  };
  const choose = (i: number) => {
    if (!enabled(i)) return;
    setOpen(false);
    setQuery('');
    button.current?.focus();
    if (shown[i].value !== value) onChange(shown[i].value);
  };
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < shown.length; i += dir) if (enabled(i)) return i;
    return from;
  };
  const onSearch = (text: string) => {
    setQuery(text);
    const next = text.trim().toLowerCase();
    const found = next ? options.filter((o) => o.label.toLowerCase().includes(next) || o.value.toLowerCase() === next) : options;
    setActive(found.findIndex((o) => !o.disabledReason));
  };

  const inSearch = (e: KeyboardEvent<HTMLElement>) => e.target === search.current;
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((a) => step(a, 1)); break;
      case 'ArrowUp': e.preventDefault(); setActive((a) => step(a, -1)); break;
      case 'Home': if (inSearch(e)) break; e.preventDefault(); setActive(step(-1, 1)); break;
      case 'End': if (inSearch(e)) break; e.preventDefault(); setActive(step(shown.length, -1)); break;
      case 'Enter': e.preventDefault(); if (active >= 0) choose(active); else if (!inSearch(e)) setOpen(false); break;
      case ' ': if (inSearch(e)) break; e.preventDefault(); if (active >= 0) choose(active); else setOpen(false); break;
      case 'Escape': e.preventDefault(); setOpen(false); setQuery(''); button.current?.focus(); break;
      case 'Tab': setOpen(false); setQuery(''); break;
    }
  };

  return (
    <div ref={root} className={`isel ${alignRight ? 'align-right' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}>
      <button ref={button} type="button" className="isel-btn" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={`${id}-list`} aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        disabled={disabled} onClick={() => (open ? (setOpen(false), setQuery('')) : show())} onKeyDown={onKey}>
        {selected ? (selected.selectedIcon ?? selected.icon) : placeholderIcon}
        <span className={`isel-label ${selected ? '' : 'placeholder'}`}>{selected ? selected.label : placeholder}</span>
      </button>
      <Icon name="arrowDown" size={arrowSize} />
      {open && (
        <>
        {/* shown only on phones (see styles.css): dims the page behind the bottom sheet and swallows the tap that closes it */}
        <button type="button" className="isel-scrim" tabIndex={-1} aria-hidden="true" onClick={() => { setOpen(false); setQuery(''); }} />
        <div className="isel-list" onKeyDown={onKey}>
          {searchable && (
            <div className="isel-search">
              <Icon name="search" size={16} />
              <input ref={search} type="text" role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-label={`Search ${ariaLabel}`}
                aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} placeholder="Search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                value={query} onChange={(e) => onSearch(e.target.value)} />
            </div>
          )}
          <ul ref={list} id={`${id}-list`} className="isel-opts" role="listbox" aria-label={ariaLabel}>
            {options.length === 0 && <li className="isel-empty">Nothing to choose yet</li>}
            {options.length > 0 && shown.length === 0 && <li className="isel-empty">No matches for “{query.trim()}”</li>}
            {shown.map((o, i) => (
              <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={o.value === value} aria-disabled={!!o.disabledReason}
                className={`isel-opt ${i === active ? 'active' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => enabled(i) && setActive(i)} onClick={() => choose(i)}>
                {o.icon}
                <span className="isel-label">{o.label}{o.disabledReason ? <small> ({o.disabledReason})</small> : null}</span>
                {o.detail ? <span className="isel-price">{o.detail}</span> : null}
                {o.value === value && <span className="tick"><Icon name="check" size={16} /></span>}
              </li>
            ))}
          </ul>
        </div>
        </>
      )}
    </div>
  );
}
