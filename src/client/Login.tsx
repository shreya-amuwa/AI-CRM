import React, { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Lock, Mail, MessageCircle, Megaphone, Phone, QrCode } from 'lucide-react';
import { Button, Field } from './ui';
import { useClientAuth } from './auth';

const FLOATERS = [
  { Icon: MessageCircle, color: '#1F7A45', left: '14%', top: '34%' }, { Icon: Megaphone, color: '#1F4E8C', left: '78%', top: '26%' },
  { Icon: QrCode, color: '#A8480F', left: '22%', top: '72%' }, { Icon: Phone, color: '#5B3FA0', left: '70%', top: '70%' }
];

export const Login: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { signIn, notice, clearNotice } = useClientAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); clearNotice();
    if (!email.trim() || !password) { setError('Enter your e-mail and password.'); return; }
    setBusy(true);
    try { await signIn(email, password); onDone(); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };

  return (
    <div className="cd-login">
      <div className="cd-login-hero" aria-hidden={false}>
        {[420, 300, 200].map((s, i) => <span key={s} className="ring" style={{ width: s, height: s, opacity: 0.5 + i * 0.25 }} />)}
        {FLOATERS.map(({ Icon, color, left, top }, i) => (
          <span key={i} aria-hidden style={{ position: 'absolute', left, top, width: 48, height: 48, borderRadius: 16, background: '#fff', display: 'grid', placeItems: 'center', color, boxShadow: '0 8px 20px rgba(0,0,0,.18)' }}>
            <Icon size={22} />
          </span>
        ))}
        <span style={{ alignSelf: 'flex-start', position: 'relative', background: '#fff', borderRadius: 18, padding: 8, display: 'inline-flex' }}><img src="/amuwa-logo.png" alt="Amuwa" style={{ height: 52, width: 52, objectFit: 'contain' }} /></span>
        <div style={{ position: 'relative' }}>
          <h1 style={{ fontSize: 34, lineHeight: 1.1, maxWidth: 420 }}>Everything about your Amuwa services, in one place.</h1>
          <p className="muted" style={{ marginTop: 10, maxWidth: 420, color: 'var(--on-primary-subtle)' }}>Your services, plan, invoices and support, all in one place.</p>
        </div>
      </div>
      <div className="cd-login-form">
        <form className="cd-login-card" onSubmit={submit} noValidate>
          <div>
            <h2 style={{ fontSize: 28 }}>Welcome back</h2>
            <p className="cd-sub">Sign in with the e-mail and password your Amuwa consultant gave you.</p>
          </div>
          {(error || notice) && (
            <div className="cd-banner danger" role="alert"><AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error || notice}</span></div>
          )}
          <Field label="E-mail" htmlFor="cd-email">
            <div style={{ position: 'relative' }}>
              <Mail size={18} aria-hidden style={{ position: 'absolute', left: 14, top: 15, color: 'var(--placeholder)' }} />
              <input id="cd-email" className="cd-input" style={{ paddingLeft: 42 }} type="email" autoComplete="username" inputMode="email" autoCapitalize="none"
                placeholder="you@yourbusiness.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </Field>
          <Field label="Password" htmlFor="cd-password">
            <div style={{ position: 'relative' }}>
              <Lock size={18} aria-hidden style={{ position: 'absolute', left: 14, top: 15, color: 'var(--placeholder)' }} />
              <input id="cd-password" className="cd-input" style={{ paddingLeft: 42, paddingRight: 46 }} type={show ? 'text' : 'password'} autoComplete="current-password"
                placeholder="Your password" value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                style={{ position: 'absolute', right: 6, top: 4, width: 40, height: 40, border: 0, background: 'transparent', color: 'var(--muted)' }}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          <Button type="submit" loading={busy}>Sign in</Button>
          <p className="cd-small cd-muted">Forgot your password? Ask your Amuwa Technical Consultant to reset it for you.</p>
        </form>
      </div>
    </div>
  );
};
