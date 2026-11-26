import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { WALLET_LOCKED_EVENT, walletPinApi, type WalletPinAnswer, type WalletPinStatus } from '../../lib/wallet';
import { Notice } from './walletParts';

/**
 * The Wallet PIN screen in front of every employee's Wallet (20270220000100; docs/EMPLOYEE_WALLET.md "Wallet PIN"). First open: set a 6-digit PIN
 * twice. Afterwards: enter it once per sign-in (15 minutes, renewed while the wallet is used). Forgot PIN: a one-time code is e-mailed and typed here
 * with a new PIN. The database checks and hashes the PIN and refuses the wallet's data until it was entered: this screen is the way in, not the lock.
 */
type View = 'loading' | 'error' | 'set' | 'enter' | 'forgot' | 'open';
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-lg tracking-[0.5em] text-center font-bold focus:outline-none focus:ring-2 focus:ring-blue-500';
const primary = 'inline-flex w-full items-center justify-center gap-2 min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50';
const link = 'text-sm font-semibold text-blue-700 hover:underline disabled:opacity-50';

const PinInput: React.FC<{ id: string; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }> = ({ id, label, value, onChange, autoFocus }) => (
  <div>
    <label htmlFor={id} className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
    <input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={6} pattern="[0-9]{6}" value={value} autoFocus={autoFocus}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} className={field} />
  </div>
);

const Card: React.FC<{ title: string; hint: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="mx-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4" data-testid="wallet-pin-card">
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Lock className="h-5 w-5" aria-hidden /></span>
      <div className="min-w-0"><h1 className="text-base font-bold text-slate-900">{title}</h1><p className="text-xs text-slate-500">{hint}</p></div>
    </div>
    {children}
  </div>
);

export const WalletPinGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [view, setView] = useState<View>('loading');
  const [status, setStatus] = useState<WalletPinStatus | null>(null);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [oldPin, setOldPin] = useState('');

  const clear = () => { setPin(''); setConfirm(''); setCode(''); setOldPin(''); };
  const load = useCallback(async () => {
    setView('loading'); setError(null);
    try {
      const s = await walletPinApi.status();
      setStatus(s);
      setView(!s.hasPin ? 'set' : s.unlocked ? 'open' : 'enter');
    } catch (e) {
      setError(msg(e, 'Your wallet could not be opened.')); setView('error');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // a wallet read refused because the unlock ran out: back to the PIN screen
  useEffect(() => {
    const relock = () => { setChanging(false); setInfo('Your wallet was locked. Enter your PIN again.'); void load(); };
    window.addEventListener(WALLET_LOCKED_EVENT, relock);
    return () => window.removeEventListener(WALLET_LOCKED_EVENT, relock);
  }, [load]);

  const run = async (work: () => Promise<WalletPinAnswer | void>, after: (r: WalletPinAnswer | void) => void) => {
    if (busy) return;
    setBusy(true); setError(null); setInfo(null);
    try { after(await work()); } catch (e) { setError(msg(e, 'That did not work. Try again.')); } finally { setBusy(false); }
  };
  const wrong = (r: WalletPinAnswer) => {
    setPin(''); setOldPin('');
    if (r.lockedUntil) setError(`Too many wrong PINs. Your wallet is locked until ${time(r.lockedUntil)}. You can also use Forgot PIN.`);
    else setError(`Wrong PIN. ${r.triesLeft ?? 0} ${r.triesLeft === 1 ? 'try' : 'tries'} left before the wallet locks for 15 minutes.`);
  };

  if (view === 'open') {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Wallet unlocked</span>
          <button type="button" className={link} onClick={() => { setChanging(c => !c); clear(); setError(null); setInfo(null); }}>Change PIN</button>
          <button type="button" className={link} disabled={busy}
            onClick={() => void run(() => walletPinApi.lock(), () => { clear(); setInfo('Wallet locked.'); setView('enter'); })}>Lock wallet</button>
        </div>
        {changing && (
          <form className="mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-4 space-y-3" aria-label="Change Wallet PIN" data-testid="wallet-pin-change"
            onSubmit={e => { e.preventDefault(); void run(() => walletPinApi.change(oldPin, pin, confirm), r => { if (r?.changed) { clear(); setChanging(false); setInfo('Your Wallet PIN was changed.'); } else if (r) wrong(r); }); }}>
            <PinInput id="wp-old" label="Current PIN" value={oldPin} onChange={setOldPin} autoFocus />
            <PinInput id="wp-new" label="New PIN (6 digits)" value={pin} onChange={setPin} />
            <PinInput id="wp-new2" label="New PIN again" value={confirm} onChange={setConfirm} />
            {error && <Notice tone="error">{error}</Notice>}
            <button type="submit" className={primary} disabled={busy || oldPin.length !== 6 || pin.length !== 6 || confirm.length !== 6}>{busy ? 'Saving…' : 'Change PIN'}</button>
          </form>
        )}
        {info && !changing && <Notice tone="ok">{info}</Notice>}
        {children}
      </div>
    );
  }

  return (
    <div className="py-6" data-testid="wallet-pin-gate">
      {view === 'loading' && <p role="status" className="text-center text-sm text-slate-500">Opening your wallet…</p>}
      {view === 'error' && (
        <Card title="Wallet" hint="Your wallet could not be opened.">
          <Notice tone="error">{error}</Notice>
          <button type="button" className={primary} onClick={() => void load()}>Try again</button>
        </Card>
      )}
      {view === 'set' && (
        <Card title="Set your Wallet PIN" hint="Choose 6 digits. You will enter this PIN each time you sign in and open your wallet.">
          <form className="space-y-3" aria-label="Set Wallet PIN"
            onSubmit={e => { e.preventDefault(); void run(() => walletPinApi.set(pin, confirm), () => { clear(); setInfo('Your Wallet PIN is set.'); setView('open'); }); }}>
            <PinInput id="wp-set" label="New PIN" value={pin} onChange={setPin} autoFocus />
            <PinInput id="wp-set2" label="Confirm PIN" value={confirm} onChange={setConfirm} />
            {confirm.length === 6 && pin !== confirm && <p className="text-xs text-rose-700" role="alert">The two PINs do not match.</p>}
            {error && <Notice tone="error">{error}</Notice>}
            <button type="submit" className={primary} disabled={busy || pin.length !== 6 || pin !== confirm}><KeyRound className="h-4 w-4" aria-hidden /> {busy ? 'Saving…' : 'Set PIN'}</button>
            <p className="text-[11px] text-slate-500">Not the same digit six times or a simple sequence like 123456. Nobody from Amuwa will ever ask for it.</p>
          </form>
        </Card>
      )}
      {view === 'enter' && (
        <Card title="Enter your Wallet PIN" hint="Your income and incentives are protected by your PIN.">
          <form className="space-y-3" aria-label="Enter Wallet PIN"
            onSubmit={e => { e.preventDefault(); void run(() => walletPinApi.unlock(pin), r => { if (r?.unlocked) { clear(); setView('open'); } else if (r) wrong(r); }); }}>
            {info && <Notice tone="info">{info}</Notice>}
            {status?.lockedUntil && !error && <Notice tone="warn">Too many wrong PINs. Your wallet is locked until {time(status.lockedUntil)}.</Notice>}
            <PinInput id="wp-pin" label="PIN" value={pin} onChange={setPin} autoFocus />
            {error && <Notice tone="error">{error}</Notice>}
            <button type="submit" className={primary} disabled={busy || pin.length !== 6}>{busy ? 'Checking…' : 'Unlock wallet'}</button>
            <div className="text-center"><button type="button" className={link} onClick={() => { clear(); setError(null); setInfo(null); setView('forgot'); }}>Forgot PIN?</button></div>
          </form>
        </Card>
      )}
      {view === 'forgot' && (
        <Card title="Reset your Wallet PIN" hint="We e-mail a one-time code to your work e-mail. It works once, for 30 minutes.">
          <button type="button" className={primary} disabled={busy}
            onClick={() => void run(async () => {
              const r = await walletPinApi.forgot();
              if (r.sent) setInfo('Code sent. Check your inbox (and spam folder).'); else setError(r.detail ?? 'The e-mail could not be sent.');
            }, () => undefined)}>{busy ? 'Sending…' : 'E-mail me a code'}</button>
          <form className="space-y-3" aria-label="Reset Wallet PIN"
            onSubmit={e => { e.preventDefault(); void run(() => walletPinApi.reset(code, pin, confirm), r => {
              if (r?.reset) { clear(); setInfo('Your new Wallet PIN is set.'); setView('open'); }
              else setError(`That code is not right. ${r?.triesLeft ?? 0} ${r?.triesLeft === 1 ? 'try' : 'tries'} left.`);
            }); }}>
            {info && <Notice tone="ok">{info}</Notice>}
            <div>
              <label htmlFor="wp-code" className="block text-xs font-semibold text-slate-700 mb-1">Code from the e-mail</label>
              <input id="wp-code" autoComplete="one-time-code" maxLength={12} value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base font-bold tracking-widest text-center uppercase focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <PinInput id="wp-r1" label="New PIN (6 digits)" value={pin} onChange={setPin} />
            <PinInput id="wp-r2" label="New PIN again" value={confirm} onChange={setConfirm} />
            {error && <Notice tone="error">{error}</Notice>}
            <button type="submit" className={primary} disabled={busy || code.trim().length < 8 || pin.length !== 6 || pin !== confirm}>{busy ? 'Saving…' : 'Set new PIN'}</button>
            <div className="text-center"><button type="button" className={link} onClick={() => { clear(); setError(null); setInfo(null); void load(); }}>Back</button></div>
          </form>
        </Card>
      )}
    </div>
  );
};
