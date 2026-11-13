import { chainLabel, tokenOptionLabel } from '../lib/labels.ts';
import type { CatalogChain, CatalogToken } from '../lib/types.ts';

interface Props {
  chains: CatalogChain[];
  chain: string;
  assetId: string;
  onChange: (chain: string, token: CatalogToken | null) => void;
  /** return a reason string to disable a token or chain, or null to allow it */
  chainDisabled?: (c: CatalogChain) => string | null;
  tokenDisabled?: (t: CatalogToken, c: CatalogChain) => string | null;
  chainLabelText?: string;
  tokenLabelText?: string;
}

// Built entirely from the live NEAR Intents catalog: no chain or token is hardcoded here.
export function TokenSelect({ chains, chain, assetId, onChange, chainDisabled, tokenDisabled, chainLabelText = 'Network', tokenLabelText = 'Token' }: Props) {
  const current = chains.find((c) => c.blockchain === chain);
  const token = current?.tokens.find((t) => t.assetId === assetId) ?? null;
  const tokenReason = token && current && tokenDisabled ? tokenDisabled(token, current) : null;

  return (
    <div className="grid2">
      <label className="field">
        <span>{chainLabelText}</span>
        <select value={chain} onChange={(e) => onChange(e.target.value, null)}>
          <option value="">Select a network</option>
          {chains.map((c) => {
            const why = chainDisabled?.(c) ?? null;
            return <option key={c.blockchain} value={c.blockchain} disabled={!!why}>{chainLabel(c.blockchain)}{why ? ` (${why})` : ''}</option>;
          })}
        </select>
      </label>
      <label className="field">
        <span>{tokenLabelText}</span>
        <select value={assetId} disabled={!current} onChange={(e) => onChange(chain, current?.tokens.find((t) => t.assetId === e.target.value) ?? null)}>
          <option value="">{current ? 'Select a token' : 'Choose a network first'}</option>
          {current?.tokens.map((t) => {
            const why = tokenDisabled?.(t, current) ?? null;
            return <option key={t.assetId} value={t.assetId} disabled={!!why}>{tokenOptionLabel(t)}{why ? ` (${why})` : ''}</option>;
          })}
        </select>
        {token?.duplicateSymbol && <small className="warn">Another token on this network shares the symbol {token.symbol}. Check the contract before continuing.</small>}
        {tokenReason && <small className="warn">{tokenReason}</small>}
      </label>
    </div>
  );
}
