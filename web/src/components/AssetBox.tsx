import type { ReactNode } from 'react';
import { chainLabel, formatTokenPrice, tokenOptionLabel } from '../lib/labels.ts';
import type { CatalogChain, CatalogToken } from '../lib/types.ts';
import { ChainIcon, TokenIcon } from './Icon.tsx';
import { IconSelect } from './IconSelect.tsx';

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
        <IconSelect className="token-select" alignRight ariaLabel={`${p.label}: token`} value={p.token?.assetId ?? ''} disabled={!current}
          placeholder={current ? 'Select token' : 'Select network'} placeholderIcon={<span className="token-icon empty">?</span>}
          options={(current?.tokens ?? []).map((t) => ({
            value: t.assetId, label: tokenOptionLabel(t), detail: formatTokenPrice(t.price) || undefined, disabledReason: p.tokenDisabled?.(t, current!) ?? null,
            icon: <TokenIcon symbol={t.symbol} chain={p.chain} small plain={t.duplicateSymbol} />,
            selectedIcon: <TokenIcon symbol={t.symbol} chain={p.chain} plain={t.duplicateSymbol} />,
          }))}
          onChange={(id) => p.onChange(p.chain, current?.tokens.find((t) => t.assetId === id) ?? null)} />
      </div>
      <div className="asset-bottom">
        <IconSelect className="chain-select-wrap" arrowSize={14} ariaLabel={`${p.label}: network`} value={p.chain}
          placeholder="Select network" placeholderIcon={<span className="chain-icon small empty">?</span>}
          options={p.chains.map((c) => ({ value: c.blockchain, label: chainLabel(c.blockchain), disabledReason: p.chainDisabled?.(c) ?? null, icon: <ChainIcon chain={c.blockchain} small /> }))}
          onChange={(v) => p.onChange(v, null)} />
        <span className="asset-sub">{p.sub}</span>
      </div>
      {p.token?.duplicateSymbol && <p className="asset-note warn">Another token on this network shares the symbol {p.token.symbol}. Check the contract before continuing.</p>}
      {reason && <p className="asset-note warn">{reason}</p>}
    </div>
  );
}
