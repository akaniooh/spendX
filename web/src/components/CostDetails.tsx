import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/**
 * The rows people check first (`rows`) are always visible. Under them sits the estimated cost; tapping it opens the
 * breakdown (`children`). Rows are <div><dt>label</dt><dd>value</dd></div>.
 * With `expandable={false}` (nothing to show in the breakdown) the cost is a plain row with no arrow.
 * The breakdown stays open while quotes refresh, so someone reading it is not interrupted.
 */
export function CostDetails({ rows, label, value, expandable = true, children }: {
  rows?: ReactNode; label: string; value: ReactNode; expandable?: boolean; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!expandable) {
    return <dl className="details">{rows}<div><dt>{label}</dt><dd>{value}</dd></div></dl>;
  }
  return (
    <div className="cost-block">
      {rows && <dl className="details">{rows}</dl>}
      <div className={`cost-details${open ? ' open' : ''}`}>
        <button type="button" className="cost-summary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="cost-label">{label}</span>
          <span className="cost-value">{value}<Icon name="arrowDown" size={18} /></span>
        </button>
        {open && <dl className="details cost-more">{children}</dl>}
      </div>
    </div>
  );
}
