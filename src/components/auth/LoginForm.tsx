import React, { useEffect, useState } from 'react';
import {
  Mail,
  Lock,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Building2,
  TrendingUp,
  Headphones,
  User,
  ShieldCheck,
  Clock,
  ChevronDown,
  LogIn,
  UserPlus
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AmuwaLogo } from '../common/AmuwaLogo';
import type { RegistrationDepartment } from '../../../shared/contracts';
import { fetchRegistrationOptions } from '../../lib/api/endpoints';

export const LoginForm: React.FC = () => {
  const { signIn, signUp, loginWithGoogle, accountNotice, clearAccountNotice, evictedNotice, clearEvictedNotice } = useAuth();

  // Mode: Sign In vs Sign Up
  const [isSignUp, setIsSignUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sign In State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState('');

  // Sign Up State
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDepartmentId, setRegDepartmentId] = useState('');
  const [regSubDepartment, setRegSubDepartment] = useState<'sales' | 'support'>('sales');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);
  const [regError, setRegError] = useState('');
  const [regOptions, setRegOptions] = useState<RegistrationDepartment[]>([]);
  const [regSubmittedModal, setRegSubmittedModal] = useState<{
    name: string;
    email: string;
    departmentName: string;
    subDepartment: 'sales' | 'support';
    needsEmailConfirmation?: boolean;
  } | null>(null);

  // Departments/teams for sign-up come from the database (anon-callable RPC).
  useEffect(() => {
    if (!isSignUp || regOptions.length) return;
    fetchRegistrationOptions()
      .then(setRegOptions)
      .catch(err => setRegError(err.message));
  }, [isSignUp, regOptions.length]);

  // --------------------------------------------------------------------------
  // SIGN IN — Supabase Auth; role & account status are read from the database
  // --------------------------------------------------------------------------
  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setLoginError('Please enter both email and password');
      return;
    }
    setSubmitting(true);
    setLoginError('');
    clearAccountNotice();
    const result = await signIn(email, password);
    setSubmitting(false);
    if (!result.ok) setLoginError(result.message || 'Sign in failed.');
  };

  // --------------------------------------------------------------------------
  // SIGN UP — creates a PENDING account; the database routes the approval
  // request and notifications to the right Team Head / Department Head.
  // --------------------------------------------------------------------------
  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');

    if (!regName.trim()) return setRegError('Please enter your full name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(regEmail.trim())) return setRegError('Please enter a valid organization email address');
    if (!regDepartmentId) return setRegError('Please select your department from the dropdown');
    if (regPassword.length < 10) return setRegError('Password must be at least 10 characters long');
    if (regPassword !== regConfirmPassword) return setRegError('Passwords do not match. Please verify both password fields.');

    const selectedDept = regOptions.find(d => d.id === regDepartmentId);
    const division = regSubDepartment === 'support' ? 'SUPPORT' : 'SALES';
    const team = selectedDept?.teams.find(t => t.division === division) || (selectedDept?.teams.length === 1 ? selectedDept.teams[0] : undefined);

    setSubmitting(true);
    const result = await signUp({
      fullName: regName,
      email: regEmail,
      password: regPassword,
      departmentId: regDepartmentId,
      teamId: team?.id
    });
    setSubmitting(false);
    if (!result.ok) return setRegError(result.message || 'Registration failed.');

    setRegSubmittedModal({
      name: regName,
      email: regEmail,
      departmentName: selectedDept?.name || '',
      subDepartment: regSubDepartment,
      needsEmailConfirmation: result.needsEmailConfirmation
    });
    setRegName('');
    setRegEmail('');
    setRegDepartmentId('');
    setRegSubDepartment('sales');
    setRegPassword('');
    setRegConfirmPassword('');
  };

  const handleGoogleSignIn = async () => {
    const result = await loginWithGoogle();
    if (!result.ok) setLoginError(result.message || 'Google sign-in failed.');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col justify-between items-center px-4 py-4 sm:py-6 relative overflow-hidden selection:bg-blue-500/20 font-sans">
      
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

      <div className="w-full flex-1 flex flex-col justify-center items-center z-10 my-auto py-2 sm:py-4">
        
        {/* Prominent Large Logo Component with Soft Glow */}
        <div className="mb-3 sm:mb-4 text-center flex justify-center drop-shadow-[0_12px_24px_rgba(37,99,235,0.15)] transition-transform hover:scale-[1.02] duration-300">
          <AmuwaLogo size="lg" />
        </div>

        {/* Eviction Notice Alert Banner if user was kicked from a session */}
        {evictedNotice && (
          <div className="max-w-[480px] w-full mb-3 p-3 rounded-2xl bg-amber-50/95 border border-amber-200 text-amber-900 text-xs flex items-start gap-3 shadow-lg backdrop-blur-md animate-fade-in">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-amber-950">Security Session Notice</p>
              <p className="text-[11px] text-amber-800 mt-0.5">{evictedNotice}</p>
            </div>
            <button 
              onClick={clearEvictedNotice} 
              className="text-amber-700 hover:text-amber-950 text-xs font-mono font-bold"
            >
              DISMISS
            </button>
          </div>
        )}

        {/* Main Card Container */}
        <div className="w-full max-w-[480px] bg-white/95 backdrop-blur-xl p-5 sm:p-7 rounded-3xl shadow-2xl shadow-blue-900/10 border border-white/90 hover:border-blue-300/80 transition-all duration-300 relative z-10">
          
          {/* Top Side-by-Side Sign In & Sign Up Tab Bar (Prompt Requirement) */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl mb-4 border border-slate-200/80 shadow-inner">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(false);
                setLoginError('');
                setRegError('');
              }}
              className={`py-2 px-3 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                !isSignUp
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsSignUp(true);
                setLoginError('');
                setRegError('');
              }}
              className={`py-2 px-3 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                isSignUp
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Sign Up</span>
            </button>
          </div>

          {/* Header Title & Subtitle */}
          <div className="text-center mb-4">
            <h2 className="text-xl sm:text-2xl font-bold font-heading text-[#0F172A] tracking-tight">
              {isSignUp ? 'Create Account' : 'Sign In'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-sans">
              {isSignUp
                ? 'Register to request system access from your Department Head'
                : 'Welcome back! Please sign in to continue'}
            </p>
          </div>

          {/* ================================================================ */}
          {/* VIEW 1: SIGN UP FORM                                             */}
          {/* ================================================================ */}
          {isSignUp ? (
            <div>
              {/* Error Message Display */}
              {regError && (
                <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{regError}</span>
                </div>
              )}

              <form onSubmit={handleSignUpSubmit} className="space-y-2.5">
                
                {/* 1. Name */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5 uppercase tracking-wider font-mono">
                    TEAM MEMBER'S NAME <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Kunal Sharma"
                      value={regName}
                      onChange={e => {
                        setRegName(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-9 pr-3 py-1.5 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/15 transition-all"
                    />
                  </div>
                </div>

                {/* 2. Email */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5 uppercase tracking-wider font-mono">
                    EMAIL ADDRESS <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      placeholder="kunal@amuwa.com"
                      value={regEmail}
                      onChange={e => {
                        setRegEmail(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-9 pr-3 py-1.5 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/15 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* 3. Select Department Dropdown */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5 uppercase tracking-wider font-mono">
                    SELECT DEPARTMENT <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <select
                      required
                      value={regDepartmentId}
                      onChange={e => {
                        setRegDepartmentId(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-9 pr-8 py-1.5 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/15 transition-all appearance-none cursor-pointer"
                    >
                      <option value="">Choose department...</option>
                      {regOptions.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* 4. Compact Role / Division Cards (Significantly Reduced Size as requested) */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase tracking-wider font-mono">
                    ROLE / DIVISION <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    
                    {/* Ultra-compact Sales Card */}
                    <div
                      onClick={() => setRegSubDepartment('sales')}
                      className={`px-2.5 py-1.5 rounded-xl cursor-pointer transition-all border flex items-center justify-between ${
                        regSubDepartment === 'sales'
                          ? 'border-blue-600 bg-blue-50/80 ring-1 ring-blue-600 shadow-xs'
                          : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                            regSubDepartment === 'sales'
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <TrendingUp className="w-3 h-3" />
                        </div>
                        <div className="min-w-0 truncate">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-slate-900">Sales</span>
                            <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-blue-100 text-blue-700">
                              Rep
                            </span>
                          </div>
                          <p className="text-[9px] text-slate-400 truncate leading-none mt-0.5">Leads, Deals & EOD</p>
                        </div>
                      </div>
                      {regSubDepartment === 'sales' && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                      )}
                    </div>

                    {/* Ultra-compact Support Card */}
                    <div
                      onClick={() => setRegSubDepartment('support')}
                      className={`px-2.5 py-1.5 rounded-xl cursor-pointer transition-all border flex items-center justify-between ${
                        regSubDepartment === 'support'
                          ? 'border-rose-500 bg-rose-50/80 ring-1 ring-rose-500 shadow-xs'
                          : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                            regSubDepartment === 'support'
                              ? 'bg-rose-500 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <Headphones className="w-3 h-3" />
                        </div>
                        <div className="min-w-0 truncate">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-slate-900">Support</span>
                            <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-rose-100 text-rose-700">
                              Tech
                            </span>
                          </div>
                          <p className="text-[9px] text-slate-400 truncate leading-none mt-0.5">3-tier pipeline</p>
                        </div>
                      </div>
                      {regSubDepartment === 'support' && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-rose-500 shrink-0 ml-1" />
                      )}
                    </div>

                  </div>

                  {/* Single-line Target Dashboard Indicator */}
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500 font-sans">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${regSubDepartment === 'support' ? 'bg-rose-500' : 'bg-blue-600'}`} />
                    <span>
                      Target Dashboard:{' '}
                      <strong className="text-slate-700 font-semibold">
                        {regSubDepartment === 'support'
                          ? 'Technical Support Dashboard'
                          : 'Sales Team Member Dashboard'}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* 5. Password with Visibility Eye */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5 uppercase tracking-wider font-mono">
                    PASSWORD <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showRegPassword ? 'text' : 'password'}
                      required
                      placeholder="••••••••••••"
                      value={regPassword}
                      onChange={e => {
                        setRegPassword(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-9 pr-9 py-1.5 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/15 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showRegPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* 6. Confirm Password with Visibility Eye */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5 uppercase tracking-wider font-mono">
                    CONFIRM PASSWORD <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showRegConfirmPassword ? 'text' : 'password'}
                      required
                      placeholder="••••••••••••"
                      value={regConfirmPassword}
                      onChange={e => {
                        setRegConfirmPassword(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-9 pr-9 py-1.5 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/15 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegConfirmPassword(!showRegConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showRegConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Sign Up Submit Button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl disabled:opacity-60 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md shadow-blue-600/30 hover:shadow-lg transition-all active:scale-[0.99] mt-2 group"
                >
                  <span>Sign Up</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Toggle to Sign In */}
                <div className="text-center pt-1.5">
                  <span className="text-xs text-slate-500">Already have an account? </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignUp(false);
                      setRegError('');
                      setLoginError('');
                    }}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                  >
                    Sign In &rarr;
                  </button>
                </div>

              </form>
            </div>
          ) : (
            /* ================================================================ */
            /* VIEW 2: SIGN IN FORM                                             */
            /* ================================================================ */
            <div>
              {/* 1. Google OAuth Button */}
              <button
                type="button"
                onClick={() => void handleGoogleSignIn()}
                className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-slate-700 text-xs font-semibold flex items-center justify-center gap-2.5 transition-all shadow-xs hover:shadow-md active:scale-[0.99] group btn-shimmer"
              >
                <svg className="w-4 h-4 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Continue with Google</span>
              </button>

              {/* Divider */}
              <div className="relative my-3.5 text-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-100" />
                </div>
                <span className="relative inline-block px-3 bg-white text-[10px] font-mono text-slate-400 uppercase tracking-widest font-semibold border border-slate-100 rounded-full">
                  OR
                </span>
              </div>

              {/* Error Message Display */}
              {(loginError || accountNotice) && (
                <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{loginError || accountNotice}</span>
                </div>
              )}

              {/* Email + Password Form */}
              <form onSubmit={handleSignInSubmit} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase tracking-wider font-mono">
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
                      className="w-full pl-10 pr-4 py-2 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/15 transition-all font-sans"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase tracking-wider font-mono">
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
                      className="w-full pl-10 pr-10 py-2 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/15 transition-all font-sans"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Options line */}
                <div className="flex items-center justify-between text-xs pt-0.5">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={e => setRememberMe(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-blue-600 border-slate-300 focus:ring-blue-500"
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

                {/* Sign In Button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl disabled:opacity-60 bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md shadow-blue-600/30 hover:shadow-lg transition-all active:scale-[0.99] mt-1 btn-shimmer group"
                >
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Toggle to Sign Up */}
                <div className="text-center pt-1.5">
                  <span className="text-xs text-slate-500">Need an account? </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignUp(true);
                      setLoginError('');
                      setRegError('');
                    }}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                  >
                    Sign Up &rarr;
                  </button>
                </div>
              </form>

            </div>
          )}

        </div>

      </div>

      {/* Page Footer */}
      <footer className="text-center text-xs font-semibold text-slate-500/80 font-sans z-10 mt-1">
        &copy; 2026 Amuwa Corporation. All rights reserved. &bull; Enterprise Access Protected
      </footer>

      {/* ================================================================ */}
      {/* REGISTRATION SUBMITTED CONFIRMATION MODAL                        */}
      {/* ================================================================ */}
      {regSubmittedModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-2xl text-center space-y-4 animate-scale-up">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto shadow-xs">
              <Clock className="w-7 h-7 animate-pulse" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900 font-heading">
                Registration Request Submitted!
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Your account is pending authorization to protect sensitive organization and customer information.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-left text-xs space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Applicant:</span>
                <span className="font-bold text-slate-800">{regSubmittedModal.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Email:</span>
                <span className="text-slate-800">{regSubmittedModal.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Department:</span>
                <span className="font-semibold text-indigo-700">{regSubmittedModal.departmentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Division:</span>
                <span className="font-semibold capitalize text-slate-800">
                  {regSubmittedModal.subDepartment} ({regSubmittedModal.subDepartment === 'support' ? 'Technical Support' : 'Sales Representative'})
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200">
                <span className="text-slate-500">Status:</span>
                <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  PENDING AUTHORIZATION
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {regSubmittedModal.needsEmailConfirmation && (
                <><strong>First confirm your e-mail address</strong> using the link we sent you. </>
              )}
              Your request has been sent to your <strong>Team Head</strong> and <strong>Department Head</strong>. Once approved, you can sign in with your email and password.
            </p>

            <button
              type="button"
              onClick={() => {
                setRegSubmittedModal(null);
                setIsSignUp(false);
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md transition-all"
            >
              Back to Sign In
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
