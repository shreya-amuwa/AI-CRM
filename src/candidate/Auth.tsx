import React, { useState } from 'react';
import { emailSchema, clientNewPasswordSchema } from '../../shared/validation';
import { candidateAuth } from './api';
import {
  Card,
  Field,
  Notice,
  button,
  secondary,
  textInput,
  readable,
} from './parts';
export const CandidateLogin: React.FC<{
  recovery: boolean;
  onRecovered: () => void;
}> = ({ recovery, onRecovered }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const client = candidateAuth();
      if (recovery) {
        const p = clientNewPasswordSchema.safeParse({ password });
        if (!p.success) throw new Error(p.error.issues[0].message);
        const result = await client.auth.updateUser({ password });
        if (result.error) throw result.error;
        onRecovered();
        return;
      }
      const valid = emailSchema.safeParse(email);
      if (!valid.success) throw new Error(valid.error.issues[0].message);
      if (mode === 'forgot') {
        const result = await client.auth.resetPasswordForEmail(valid.data, {
          redirectTo: `${window.location.origin}/candidate`,
        });
        if (result.error) throw result.error;
        setNotice(
          'If an account exists, you will receive a password reset link.',
        );
      } else if (mode === 'register') {
        const p = clientNewPasswordSchema.safeParse({ password });
        if (!p.success) throw new Error(p.error.issues[0].message);
        const result = await client.auth.signUp({
          email: valid.data,
          password,
          options: {
            data: { candidate_portal: true },
            emailRedirectTo: `${window.location.origin}/candidate`,
          },
        });
        if (result.error) throw result.error;
        setNotice('Check your email to verify your account, then sign in.');
        setPassword('');
      } else {
        const result = await client.auth.signInWithPassword({
          email: valid.data,
          password,
        });
        if (result.error) throw result.error;
      }
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-lg mx-auto py-5">
      <Card
        title={
          recovery
            ? 'Choose a new password'
            : mode === 'register'
              ? 'Create your candidate account'
              : mode === 'forgot'
                ? 'Reset your password'
                : 'Welcome back'
        }
      >
        <p className="text-sm text-slate-500 mb-5">
          Your application, assessments and next steps, in one place.
        </p>
        <form onSubmit={submit} className="space-y-4">
          {!recovery && (
            <Field label="Email address" id="candidate-email">
              <input
                id="candidate-email"
                type="email"
                autoComplete="email"
                required
                className={textInput}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          )}
          {(recovery || mode !== 'forgot') && (
            <Field label="Password" id="candidate-password">
              <input
                id="candidate-password"
                type="password"
                autoComplete={
                  recovery || mode === 'register'
                    ? 'new-password'
                    : 'current-password'
                }
                required
                className={textInput}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          <button className={`${button} w-full`} disabled={busy}>
            {busy
              ? 'Please wait…'
              : recovery
                ? 'Save new password'
                : mode === 'register'
                  ? 'Register'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : 'Sign in'}
          </button>
        </form>
        {!recovery && (
          <div className="mt-5 flex gap-3 flex-wrap">
            {(['login', 'register', 'forgot'] as const)
              .filter((m) => m !== mode)
              .map((m) => (
                <button
                  className={secondary}
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setError('');
                    setNotice('');
                    setPassword('');
                  }}
                >
                  {m === 'login'
                    ? 'Sign in'
                    : m === 'register'
                      ? 'Create account'
                      : 'Forgot password?'}
                </button>
              ))}
          </div>
        )}
      </Card>
    </div>
  );
};
