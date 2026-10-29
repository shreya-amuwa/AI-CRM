import React, { useEffect, useState } from 'react';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { errorMessage } from '../../lib/api/client';
import { MIN_PASSPHRASE_LENGTH, formatFingerprint, passphraseProblem } from '../../lib/chat/e2ee';
import type { PeerInfo, SecureChatClient } from '../../lib/chat/secureChat';
import { useSecureSnapshot } from '../../lib/chat/useSecureChat';
import { ChatModal } from './ChatBits';

export type SecureMode = 'setup' | 'unlock' | 'reset';

const TITLE: Record<SecureMode, string> = { setup: 'Turn on secure messaging', unlock: 'Unlock secure messaging', reset: 'Reset secure messaging' };

/**
 * Setting up, unlocking and resetting secure messaging. The recovery passphrase is used in this browser only: it encrypts (or opens) the
 * backup of the key. It is never sent anywhere, and nobody - not Amuwa's administrators either - can recover it for you.
 */
export const SecureSetupDialog: React.FC<{ client: SecureChatClient; mode: SecureMode; onClose: () => void; onSwitch?: (m: SecureMode) => void }> = ({ client, mode, onClose, onSwitch }) => {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const snap = useSecureSnapshot(client);
  const creating = mode !== 'unlock';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (creating) {
      const problem = passphraseProblem(pass);
      if (problem) return setError(problem);
      if (pass !== again) return setError('The two passphrases are not the same.');
      if (mode === 'reset' && !confirmReset) return setError('Tick the box to confirm.');
    }
    setBusy(true);
    try {
      if (mode === 'setup') await client.setup(pass);
      else if (mode === 'unlock') await client.unlock(pass);
      else await client.reset(pass);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <ChatModal title={TITLE[mode]} onClose={busy ? () => undefined : onClose}
      footer={<>
        <button type="button" className="ch-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="secure-setup-form" className={`ch-btn ${mode === 'reset' ? 'danger' : 'primary'}`} disabled={busy || !pass}>
          {busy ? <Loader2 size={14} className="ch-spin" aria-hidden /> : null} {mode === 'setup' ? 'Turn on' : mode === 'unlock' ? 'Unlock' : 'Reset and turn on'}
        </button>
      </>}>
      <form id="secure-setup-form" onSubmit={e => void submit(e)} style={{ display: 'contents' }}>
        {mode === 'setup' && <p className="ch-note">Your messages to colleagues are end-to-end encrypted: only the devices of the people in a chat can read them, not the server, and not administrators. Choose a recovery passphrase; it is the only way to read your messages on another computer or phone.</p>}
        {mode === 'unlock' && <p className="ch-note">Secure messaging is already set up for your account. Enter your recovery passphrase to read and send messages on this device.</p>}
        {mode === 'reset' && <p className="ch-note warn">A reset makes a <b>new</b> key. Messages that were sealed for your old key can no longer be read on a device that does not already hold it, and your colleagues will be asked to accept your new key. Only do this if you have lost your passphrase.</p>}
        <label className="ch-field">Recovery passphrase
          <input type="password" autoComplete={creating ? 'new-password' : 'current-password'} value={pass} onChange={e => setPass(e.target.value)} data-testid="secure-pass" autoFocus />
        </label>
        {creating && (
          <label className="ch-field">Repeat the passphrase
            <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} data-testid="secure-pass-again" />
          </label>
        )}
        {creating && <p className="ch-note">At least {MIN_PASSPHRASE_LENGTH} characters; a few random words is best. <b>Write it down somewhere safe: it cannot be recovered.</b></p>}
        {mode === 'reset' && (
          <label style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={confirmReset} onChange={e => setConfirmReset(e.target.checked)} data-testid="secure-reset-confirm" /> I understand that older messages may become unreadable.
          </label>
        )}
        {!snap.persistent && <p className="ch-note warn">This browser cannot keep keys on the device (a private window?). They will be lost when you close this tab; you will need your passphrase again.</p>}
        {error && <p className="ch-note" role="alert" style={{ color: 'var(--ch-danger)' }}>{error}</p>}
        {onSwitch && mode === 'unlock' && <p className="ch-note">Lost your passphrase? <button type="button" className="ch-link" style={{ marginLeft: 0 }} onClick={() => onSwitch('reset')}>Reset secure messaging</button></p>}
      </form>
    </ChatModal>
  );
};

/** Change the recovery passphrase, reset the key, or take the keys off this device. */
const SelfSettings: React.FC<{ client: SecureChatClient; onReset: () => void }> = ({ client, onReset }) => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try { await client.changePassphrase(current, next); setMsg({ ok: true, text: 'Your recovery passphrase was changed.' }); setCurrent(''); setNext(''); setOpen(false); }
    catch (err) { setMsg({ ok: false, text: errorMessage(err) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="ch-note" data-testid="secure-settings" style={{ borderTop: '1px solid var(--ch-border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <b>Your secure messaging</b>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="ch-link" style={{ marginLeft: 0 }} onClick={() => setOpen(o => !o)}>Change recovery passphrase</button>
        <button type="button" className="ch-link" style={{ marginLeft: 0 }} onClick={onReset} data-testid="secure-reset">Reset secure messaging</button>
        <button type="button" className="ch-link" style={{ marginLeft: 0 }} data-testid="secure-remove-device"
          onClick={() => { if (window.confirm('Remove your secure messaging keys from this device? You will need your recovery passphrase to read messages here again.')) void client.removeFromDevice(); }}>Remove keys from this device</button>
      </div>
      {open && (
        <form onSubmit={e => void change(e)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="ch-field">Current passphrase<input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" /></label>
          <label className="ch-field">New passphrase<input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" /></label>
          <button type="submit" className="ch-btn primary" disabled={busy || !current || !next} style={{ alignSelf: 'flex-start' }}>{busy ? 'Saving…' : 'Change passphrase'}</button>
        </form>
      )}
      {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? '#14532d' : 'var(--ch-danger)' }}>{msg.text}</span>}
    </div>
  );
};

/** Who is in the chat, and the key fingerprint of each (compare it with the person, by phone or in person, to be sure nobody is in the middle). */
export const SecurityDialog: React.FC<{ client: SecureChatClient; conversationId: string; onClose: () => void; onChanged: () => void }> = ({ client, conversationId, onClose, onChanged }) => {
  const [peers, setPeers] = useState<PeerInfo[] | null>(null);
  const [error, setError] = useState('');
  const [reset, setReset] = useState(false);
  const snap = useSecureSnapshot(client);
  const load = () => { client.peers(conversationId).then(setPeers, e => setError(errorMessage(e))); };
  useEffect(load, [client, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (p: PeerInfo, verified: boolean) => {
    if (!p.fingerprint) return;
    await client.accept(p.profileId, p.fingerprint, verified);
    load();
    onChanged();
  };

  return (
    <ChatModal title="Security of this chat" onClose={onClose} footer={<button type="button" className="ch-btn primary" onClick={onClose}>Done</button>}>
      <p className="ch-note"><ShieldCheck size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> Messages in this chat are end-to-end encrypted. Only the people below can read them. To be sure you are talking to the right person, compare their fingerprint with what they see on their own screen.</p>
      {error && <p className="ch-note" role="alert" style={{ color: 'var(--ch-danger)' }}>{error}</p>}
      {!peers && !error && <p className="ch-note"><Loader2 size={14} className="ch-spin" aria-hidden /> Loading</p>}
      {snap.fingerprint && (
        <div>
          <p className="ch-note"><b>You</b> (this account)</p>
          <div className="ch-fp" data-testid="my-fingerprint">{formatFingerprint(snap.fingerprint)}</div>
        </div>
      )}
      {snap.status === 'ready' && <SelfSettings client={client} onReset={() => setReset(true)} />}
      {reset && <SecureSetupDialog client={client} mode="reset" onClose={() => { setReset(false); load(); onChanged(); }} />}
      {peers?.filter(p => !p.me).map(p => (
        <div key={p.profileId} data-testid={`peer-${p.profileId}`}>
          <p className="ch-note"><b>{p.name}</b>{p.verified ? ' - verified' : ''}</p>
          {p.fingerprint ? <div className="ch-fp">{formatFingerprint(p.fingerprint)}</div> : <p className="ch-note warn">{p.name} has not set up secure messaging yet.</p>}
          {p.changed && (
            <p className="ch-note warn" role="alert" style={{ marginTop: 6 }}>
              <ShieldAlert size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> {p.name}'s key changed since you last chatted (a new device or a reset, or someone is interfering). Check the fingerprint with them, then accept it.
              <button type="button" className="ch-link" onClick={() => void act(p, false)} data-testid={`accept-${p.profileId}`}>Accept new key</button>
            </p>
          )}
          {p.fingerprint && !p.changed && !p.verified && <button type="button" className="ch-link" style={{ marginLeft: 0 }} onClick={() => void act(p, true)}>I compared it: it matches</button>}
        </div>
      ))}
    </ChatModal>
  );
};
