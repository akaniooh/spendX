import type { ReactNode } from 'react';
import { chainLabel, tokenOptionLabel } from '../lib/labels.ts';
import type { CatalogChain, CatalogToken } from '../lib/types.ts';
import { ChainIcon, Icon, TokenIcon } from './Icon.tsx';

interface Props {
  label: string;
  hint?: ReactNode;
  amount: ReactNode;
  sub?: ReactNode;
  chains: CatalogChain[];
  chain: string;
  token: CatalogToken | null;
  onChange: (chain: string, token: CatalogToken | null) => void;
  chainDisabled?: (c: CatalogChain) => string | null;
  tokenDisabled?: (t: CatalogToken, c: CatalogChain) => string | null;
}

/** "You send / You receive": amount and token on one line, network and value below. Built from the live catalog. */
export function AssetBox(p: Props) {
  const current = p.chains.find((c) => c.blockchain === p.chain);
  const reason = p.token && current && p.tokenDisabled ? p.tokenDisabled(p.token, current) : null;
  return (
    <div className="asset-box">
      <div className="asset-top"><span>{p.label}</span><span className="asset-hint">{p.hint}</span></div>
      <div className="asset-main">
        <div className="amount-wrap">{p.amount}</div>
        <label className="token-select">
          {p.token ? <TokenIcon symbol={p.token.symbol} chain={p.chain} /> : <span className="token-icon empty">?</span>}
          <select aria-label={`${p.label}: token`} value={p.token?.assetId ?? ''} disabled={!current}
            onChange={(e) => p.onChange(p.chain, current?.tokens.find((t) => t.assetId === e.target.value) ?? null)}>
            <option value="">{current ? 'Select token' : 'Select network'}</option>
            {current?.tokens.map((t) => {
              const why = p.tokenDisabled?.(t, current) ?? null;
              return <option key={t.assetId} value={t.assetId} disabled={!!why}>{tokenOptionLabel(t)}{why ? ` (${why})` : ''}</option>;
            })}
          </select>
          <Icon name="arrowDown" size={16} />
        </label>
      </div>
      <div className="asset-bottom">
        <label className="chain-select-wrap">
          {p.chain ? <ChainIcon chain={p.chain} small /> : <span className="chain-icon small empty">?</span>}
          <select aria-label={`${p.label}: network`} value={p.chain} onChange={(e) => p.onChange(e.target.value, null)}>
            <option value="">Select network</option>
            {p.chains.map((c) => {
              const why = p.chainDisabled?.(c) ?? null;
              return <option key={c.blockchain} value={c.blockchain} disabled={!!why}>{chainLabel(c.blockchain)}{why ? ` (${why})` : ''}</option>;
            })}
          </select>
          <Icon name="arrowDown" size={14} />
        </label>
        <span className="asset-sub">{p.sub}</span>
      </div>
      {p.token?.duplicateSymbol && <p className="asset-note warn">Another token on this network shares the symbol {p.token.symbol}. Check the contract before continuing.</p>}
      {reason && <p className="asset-note warn">{reason}</p>}
    </div>
  );
}
