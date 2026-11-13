import { useEffect, useState } from 'react';
import { useWallets } from '../wallets/WalletContext.tsx';
import type { ConnectableFamily } from '../wallets/WalletContext.tsx';
import { shortAddr } from '../lib/labels.ts';
import { errorMessage } from '../lib/errors.ts';
import { Icon } from './Icon.tsx';

function Row({ mark, name, detail, connected, onConnect, onDisconnect, disabled }: {
  mark: string; name: string; detail: string; connected: boolean; onConnect: () => void; onDisconnect: () => void; disabled?: boolean;
}) {
  return (
    <div className={`wallet-option ${connected ? 'connected' : ''}`}>
      <span>{mark}</span>
      <div><strong>{name}</strong><small>{detail}</small></div>
      {connected
        ? <button className="mini-button" onClick={onDisconnect}>Disconnect</button>
        : <button className="mini-button primary" disabled={disabled} onClick={onConnect}>Connect</button>}
    </div>
  );
}

export function WalletModal() {
  const w = useWallets();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!w.walletModalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') w.closeWalletModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [w.walletModalOpen, w.closeWalletModal]);
  if (!w.walletModalOpen) return null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setErr(null); setBusy(key);
    try { await fn(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  };
  const off = (f: ConnectableFamily) => () => w.disconnect(f);

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="Connect wallet">
      <button className="backdrop" aria-label="Close" onClick={w.closeWalletModal} />
      <div className="modal">
        <button className="modal-close" aria-label="Close" onClick={w.closeWalletModal}><Icon name="close" size={18} /></button>
        <div className="modal-head"><h2>Connect wallet</h2></div>
        <div className="modal-body">

        <div className="wallet-group">
          <h3>EVM</h3>
          {w.evmWallets.length === 0 && <p className="text-3 small">No EVM wallet detected.</p>}
          {w.evmWallets.map((x) => {
            const connected = w.evm?.name === x.name;
            return <Row key={x.id} mark={x.name.slice(0, 1).toUpperCase()} name={x.name} detail={connected && w.evm ? shortAddr(w.evm.address, 8, 6) : 'Browser wallet'} connected={connected}
              disabled={busy !== null} onConnect={() => run(x.id, () => w.connectEvm(x.id))} onDisconnect={off('evm')} />;
          })}
        </div>

        <div className="wallet-group">
          <h3>Solana</h3>
          {w.phantomAvailable
            ? <Row mark="P" name="Phantom" detail={w.svm ? shortAddr(w.svm.address, 8, 6) : 'Browser extension'} connected={!!w.svm} disabled={busy !== null}
                onConnect={() => run('phantom', w.connectSvm)} onDisconnect={off('svm')} />
            : <p className="text-3 small">Phantom not detected.</p>}
        </div>

        <div className="wallet-group">
          <h3>NEAR</h3>
          <Row mark="N" name="NEAR wallet" detail={w.near ? shortAddr(w.near.address, 10, 8) : 'Choose a NEAR wallet'} connected={!!w.near} disabled={busy !== null}
            onConnect={() => run('near', w.connectNear)} onDisconnect={off('near')} />
        </div>

        {err && <p className="inline-error">{err}</p>}
        </div>
        <p className="modal-note">SpendX never asks for your private keys or seed phrase.</p>
      </div>
    </div>
  );
}
