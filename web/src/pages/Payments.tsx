import { useState } from 'react';
import { slugFromInput } from '../lib/route.ts';
import { Icon } from '../components/Icon.tsx';

export function Payments() {
  const [input, setInput] = useState('');
  const slug = slugFromInput(input);
  return (
    <>
      <section className="page-head"><h1>Pay with links</h1></section>
      <section className="column">
        <div className="card">
          <label className="field" style={{ marginTop: 0 }}><span>Payment link</span>
            <input placeholder="Paste a payment link" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
            {input && !slug && <small className="warn">That is not a SpendX payment link.</small>}
          </label>
          <button className="cta" style={{ marginTop: 'var(--s5)' }} disabled={!slug} onClick={() => { if (slug) window.location.hash = `#/pay/${slug}`; }}>Open payment{slug && <Icon name="arrow" />}</button>
        </div>
      </section>
    </>
  );
}
