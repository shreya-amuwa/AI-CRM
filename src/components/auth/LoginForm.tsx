import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, Eye, EyeOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AmuwaLogo } from '../common/AmuwaLogo';

import { SAMPLE_TEAM_MEMBERS } from '../../services/teamMemberStore';

export const LoginForm: React.FC = () => {
  const { loginWithGoogle, loginWithEmail, evictedNotice, clearEvictedNotice } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [customGoogleEmail, setCustomGoogleEmail] = useState('');
  const [loginError, setLoginError] = useState('');

  // Main Login Credentials
  const mainLoginCredentials = {
    superadmin: { email: 'superadmin@amuwa.com', password: 'superadmin123', name: 'Super Admin', role: 'superadmin' as const },
    admin: { email: 'admin@amuwa.com', password: 'admin123', name: 'Admin (Department Head)', role: 'admin' as const },
    hr: { email: 'hr@amuwa.com', password: 'hr123', name: 'HR Manager', role: 'hr' as const },
    lead: { email: 'lead@amuwa.com', password: 'lead123', name: 'Vikram Deshmukh (Team Lead)', role: 'team-lead' as const },
    accounts: { email: 'accounts@amuwa.com', password: 'accounts123', name: 'Rajiv Khanna (Accounts Head)', role: 'admin' as const, departmentId: 'accounts' }
  };

  const handleQuickFill = (targetEmail: string, targetPass: string) => {
    setEmail(targetEmail);
    setPassword(targetPass);
    setLoginError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setLoginError('Please enter both email and password');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Check Team Member Credentials
    const teamMember = SAMPLE_TEAM_MEMBERS.find(
      tm => tm.email.toLowerCase() === cleanEmail && tm.password === password
    );

    if (teamMember) {
      setLoginError('');
      loginWithEmail(teamMember.email, password, 'team-member', teamMember.departmentId);
      return;
    }

    // 2. Validate main login credentials (SuperAdmin / Admin / HR / Accounts)
    const validRole = Object.entries(mainLoginCredentials).find(
      ([_, creds]) => creds.email.toLowerCase() === cleanEmail && creds.password === password
    );

    if (!validRole) {
      setLoginError('Invalid email or password');
      return;
    }

    setLoginError('');
    const role = validRole[1].role;
    loginWithEmail(email, password, role, (validRole[1] as any).departmentId);
  };

  const handleGoogleSelect = (selectedEmail: string) => {
    loginWithGoogle(selectedEmail);
    setShowGoogleModal(false);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col justify-between items-center px-4 py-8 relative overflow-hidden selection:bg-blue-500/20">
      
      {/* 1. Animated Ambient Floating Gradient Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[650px] h-[650px] bg-gradient-to-tr from-purple-300/40 via-fuchsia-200/30 to-pink-300/40 blur-[130px] rounded-full pointer-events-none animate-orb-1" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[700px] h-[700px] bg-gradient-to-br from-blue-300/40 via-cyan-200/30 to-indigo-300/40 blur-[140px] rounded-full pointer-events-none animate-orb-2" />
      <div className="absolute top-[40%] right-[15%] w-[450px] h-[450px] bg-gradient-to-r from-teal-200/30 via-emerald-200/20 to-sky-300/30 blur-[120px] rounded-full pointer-events-none animate-orb-3" />

      {/* 2. Modern Dot Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(#94A3B8_1px,transparent_1px)] [background-size:24px_24px] opacity-25 pointer-events-none" />

      {/* 3. Decorative Wave Contour Lines SVG Overlay */}
      <svg className="absolute inset-0 w-full h-full opacity-40 pointer-events-none" viewBox="0 0 1440 900" fill="none">
        <path d="M-100 600 C300 350 650 750 1540 250" stroke="url(#waveGrad1)" strokeWidth="1.5" />
        <path d="M-100 650 C350 400 700 800 1540 300" stroke="url(#waveGrad2)" strokeWidth="1" />
        <path d="M-100 700 C400 450 750 850 1540 350" stroke="url(#waveGrad1)" strokeWidth="0.75" />
        <defs>
          <linearGradient id="waveGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#C084FC" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#38BDF8" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#818CF8" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="waveGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#F472B6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#34D399" stopOpacity="0.4" />
          </linearGradient>
        </defs>
      </svg>

      <div className="w-full flex-1 flex flex-col justify-center items-center z-10 my-auto">
        
        {/* Prominent Large Logo Component with Soft Glow */}
        <div className="mb-6 text-center flex justify-center drop-shadow-[0_12px_24px_rgba(37,99,235,0.15)] transition-transform hover:scale-[1.02] duration-300">
          <AmuwaLogo size="lg" />
        </div>

        {/* Eviction Notice Alert Banner if user was kicked from a session */}
        {evictedNotice && (
          <div className="max-w-[460px] w-full mb-4 p-4 rounded-2xl bg-amber-50/95 border border-amber-200 text-amber-900 text-sm flex items-start gap-3 shadow-lg backdrop-blur-md animate-fade-in">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-amber-950">Security Session Notice</p>
              <p className="text-xs text-amber-800 mt-0.5">{evictedNotice}</p>
            </div>
            <button 
              onClick={clearEvictedNotice} 
              className="text-amber-700 hover:text-amber-950 text-xs font-mono font-bold"
            >
              DISMISS
            </button>
          </div>
        )}

        {/* Clean Glassmorphic Card Container with Hover Shimmer & Elevation */}
        <div className="w-full max-w-[460px] bg-white/95 backdrop-blur-xl p-8 sm:p-10 rounded-3xl shadow-2xl shadow-blue-900/10 border border-white/90 hover:border-blue-300/80 transition-all duration-300 relative z-10">
          
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold font-heading text-[#0F172A] tracking-tight">
              Sign In
            </h2>
            <p className="text-xs text-slate-400 mt-1 font-sans">
              Welcome back! Please sign in to continue
            </p>
          </div>

          {/* 1. Google OAuth Button */}
          <button
            type="button"
            onClick={() => setShowGoogleModal(true)}
            className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-slate-700 text-sm font-semibold flex items-center justify-center gap-3 transition-all shadow-xs hover:shadow-md active:scale-[0.99] group btn-shimmer"
          >
            <svg className="w-5 h-5 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span>Continue with Google</span>
          </button>

          {/* Divider */}
          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-100" />
            </div>
            <span className="relative inline-block px-3 bg-white text-[10px] font-mono text-slate-400 uppercase tracking-widest font-semibold border border-slate-100 rounded-full">
              OR
            </span>
          </div>

          {/* Error Message Display */}
          {loginError && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          {/* 2. Email + Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1.5 uppercase tracking-wider font-mono">
                EMAIL ADDRESS
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  placeholder="name@amuwa.com"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    setLoginError('');
                  }}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-sm focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all font-sans"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1.5 uppercase tracking-wider font-mono">
                PASSWORD
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    setLoginError('');
                  }}
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-sm focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all font-sans"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Options line */}
            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-slate-600 select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500"
                />
                <span>Remember me</span>
              </label>

              <button
                type="button"
                className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                Forgot password?
              </button>
            </div>

            {/* Blue Sign In Button with Shimmer & Glow */}
            <button
              type="submit"
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 hover:shadow-xl hover:shadow-blue-600/40 transition-all active:scale-[0.99] mt-2 btn-shimmer group"
            >
              <span>Sign In</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>

          {/* Quick Demo Test Accounts */}
          <div className="mt-5 pt-4 border-t border-slate-100 space-y-2 text-left">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
              <span>TEST ACCOUNTS (1-CLICK FILL):</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 text-xs">

              <button
                type="button"
                onClick={() => handleQuickFill('lead@amuwa.com', 'lead123')}
                className="w-full px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200/80 flex items-center justify-between font-mono text-[11px] transition-colors"
              >
                <span><strong>Vikram Deshmukh</strong> (Team Lead)</span>
                <span className="text-[10px] bg-indigo-200/70 text-indigo-900 font-bold px-1.5 py-0.5 rounded">Pod Alpha</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('rahul@amuwa.com', 'TM@Pass1')}
                className="w-full px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 flex items-center justify-between font-mono text-[11px] transition-colors"
              >
                <span><strong>Rahul Kumar</strong> (Team Member)</span>
                <span className="text-[10px] bg-emerald-200/60 px-1.5 py-0.5 rounded">5 Leads</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('priya@amuwa.com', 'TM@Pass2')}
                className="w-full px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 flex items-center justify-between font-mono text-[11px] transition-colors"
              >
                <span><strong>Priya Singh</strong> (Team Member)</span>
                <span className="text-[10px] bg-emerald-200/60 px-1.5 py-0.5 rounded">4 Leads</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('amit@amuwa.com', 'TM@Pass3')}
                className="w-full px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 flex items-center justify-between font-mono text-[11px] transition-colors"
              >
                <span><strong>Amit Patel</strong> (Team Member)</span>
                <span className="text-[10px] bg-emerald-200/60 px-1.5 py-0.5 rounded">6 Leads</span>
              </button>

              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => handleQuickFill('admin@amuwa.com', 'admin123')}
                  className="px-1.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[10px] text-center border border-slate-200 transition-colors"
                >
                  Admin (Wabastore)
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickFill('accounts@amuwa.com', 'accounts123')}
                  className="px-1.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-mono text-[10px] text-center border border-emerald-200 font-bold transition-colors"
                >
                  Accounts Head
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickFill('superadmin@amuwa.com', 'superadmin123')}
                  className="px-1.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[10px] text-center border border-slate-200 transition-colors"
                >
                  Super Admin
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Page Footer */}
      <footer className="text-center text-xs font-semibold text-slate-500/80 font-sans z-10 mt-4">
        &copy; 2026 Amuwa Corporation. All rights reserved.
      </footer>

      {/* Simulated Google Account Picker Modal */}
      {showGoogleModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl animate-scale-up">
            <div className="flex items-center gap-3 mb-4">
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <h3 className="text-lg font-bold text-slate-900 font-heading">Sign in with Google</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">Select account:</p>

            <div className="space-y-2 mb-4">
              <button
                type="button"
                onClick={() => handleGoogleSelect('alexander.w@amuwa.com')}
                className="w-full p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-left transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">Alexander Wright</p>
                  <p className="text-xs text-slate-500 font-mono">alexander.w@amuwa.com</p>
                </div>
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
              </button>

              <button
                type="button"
                onClick={() => handleGoogleSelect('priya.sharma@amuwa.com')}
                className="w-full p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-left transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">Priya Sharma</p>
                  <p className="text-xs text-slate-500 font-mono">priya.sharma@amuwa.com</p>
                </div>
                <CheckCircle2 className="w-4 h-4 text-slate-300" />
              </button>
            </div>

            <div className="mb-4">
              <input
                type="email"
                placeholder="Or enter custom email"
                value={customGoogleEmail}
                onChange={e => setCustomGoogleEmail(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 font-mono"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowGoogleModal(false)}
                className="w-1/2 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleGoogleSelect(customGoogleEmail || 'staff.user@amuwa.com')}
                className="w-1/2 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
