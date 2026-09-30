import React, { useState } from 'react';
import { QrCode, Shield, Lock, ArrowRight, Key, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAiqrAuth } from '../../context/AiqrAuthContext';

export const AiqrLoginForm: React.FC = () => {
  const { login, loginError, isLockedOut } = useAiqrAuth();

  const [email, setEmail] = useState('admin@aiqr.io');
  const [passcode, setPasscode] = useState('admin123');
  const [securityKey, setSecurityKey] = useState('AIQR-2026-SECURE');
  const [authMode, setAuthMode] = useState<'passcode' | 'key'>('passcode');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    setTimeout(() => {
      login(email, passcode, authMode === 'key' ? securityKey : undefined);
      setIsSubmitting(false);
    }, 400);
  };

  const handleQuickLogin = (demoEmail: string, demoPass: string, demoKey: string) => {
    setEmail(demoEmail);
    setPasscode(demoPass);
    setSecurityKey(demoKey);
    login(demoEmail, demoPass, demoKey);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans">
      {/* Background Glow Overlay */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-indigo-600/20 to-purple-600/20 blur-[120px] rounded-full pointer-events-none" />

      {/* Main Container Card */}
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl relative z-10 space-y-6">
        
        {/* Header Branding */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 mb-1">
            <QrCode className="w-9 h-9" />
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-white font-heading">AIQR STUDIO</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                PRO ENGINE v2.4
              </span>
            </div>
            <p className="text-xs font-mono text-slate-400 mt-1">
              Secure QR Code Generation & Lead Ingestion Portal
            </p>
          </div>
        </div>

        {/* Auth Mode Tabs */}
        <div className="grid grid-cols-2 p-1 bg-slate-950/80 rounded-xl border border-slate-800 text-xs font-mono">
          <button
            type="button"
            onClick={() => setAuthMode('passcode')}
            className={`py-2 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 ${
              authMode === 'passcode' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Passcode Login</span>
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('key')}
            className={`py-2 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 ${
              authMode === 'key' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>Security Key</span>
          </button>
        </div>

        {/* Error Alert */}
        {loginError && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-start gap-2.5 animate-shake">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{loginError}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-mono">
          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">OPERATOR EMAIL</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="operator@aiqr.io"
              className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>

          {authMode === 'passcode' ? (
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">OPERATOR PASSCODE</label>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>
          ) : (
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">SECURITY ACCESS KEY</label>
              <input
                type="text"
                value={securityKey}
                onChange={(e) => setSecurityKey(e.target.value)}
                required
                placeholder="AIQR-2026-SECURE"
                className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono transition-all"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || isLockedOut}
            className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold tracking-wide flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/25 active:scale-[0.98] disabled:opacity-50"
          >
            <span>{isSubmitting ? 'Authenticating...' : 'Access AIQR Workspace'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Quick Demo Credentials Buttons */}
        <div className="pt-2 border-t border-slate-800/80 space-y-2">
          <span className="text-[11px] font-mono text-slate-400 block text-center uppercase tracking-wider">
            Quick One-Click Access
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleQuickLogin('admin@aiqr.io', 'admin123', 'AIQR-2026-SECURE')}
              className="py-2 px-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300 text-[11px] font-mono flex items-center justify-center gap-1.5 transition-all"
            >
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              <span>Super Admin</span>
            </button>
            <button
              type="button"
              onClick={() => handleQuickLogin('agency@aiqr.io', 'agency123', 'AIQR-AGENCY-99')}
              className="py-2 px-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-300 text-[11px] font-mono flex items-center justify-center gap-1.5 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Agency Manager</span>
            </button>
          </div>
        </div>

        {/* Footer Security Badges */}
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-2 border-t border-slate-800/40">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>256-Bit SSL Encrypted</span>
          </div>
          <span>IP Guard Active</span>
        </div>

      </div>
    </div>
  );
};
