import React, { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, FileText, Layers, Lock, Mail, MessageCircle } from 'lucide-react';
import { Button, Field } from './ui';
import { useClientAuth } from './auth';

const POINTS = [
  { Icon: Layers, text: 'Your services, plan and renewal dates' },
  { Icon: FileText, text: 'Every invoice, ready to download' },
  { Icon: MessageCircle, text: 'Tickets answered by your own Team Member' }
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
      <section className="cd-login-hero" aria-label="About the client dashboard">
        <div className="cd-brand" style={{ padding: 0 }}>
          <span className="cd-brand-tile"><img src="/amuwa-logo.png" alt="Amuwa Corporation logo" /></span>
          <span><b>Amuwa</b><small>Client dashboard</small></span>
        </div>
        <h2 style={{ marginTop: 'auto' }}>Everything you have with Amuwa, in one place.</h2>
        <p className="cd-login-lead">Check your services, pay what’s due and talk to your Support team — without waiting on email.</p>
        <ul className="cd-login-points">
          {POINTS.map(({ Icon, text }) => <li key={text}><Icon size={20} aria-hidden />{text}</li>)}
        </ul>
      </section>
      <div className="cd-login-form">
        <form className="cd-login-card" onSubmit={submit} noValidate>
          <div>
            <h1>Sign in</h1>
            <p className="cd-sub">Use the e-mail your Technical Consultant registered for you.</p>
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
          <p className="cd-small cd-muted" style={{ textAlign: 'center' }}>Forgot your password? Your Technical Consultant can reset it for you.</p>
        </form>
      </div>
    </div>
  );
};
