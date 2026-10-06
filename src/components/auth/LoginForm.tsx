import React, { useState } from 'react';
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
  ChevronDown
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';
import { useNotifications } from '../../context/NotificationContext';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { SAMPLE_TEAM_MEMBERS } from '../../services/teamMemberStore';
import { userApprovalStore } from '../../services/userApprovalStore';

export const LoginForm: React.FC = () => {
  const { loginWithGoogle, loginWithEmail, evictedNotice, clearEvictedNotice } = useAuth();
  const { departments } = useDepartments();
  const { sendNotification } = useNotifications();

  // Mode: Sign In vs Sign Up
  const [isSignUp, setIsSignUp] = useState(false);

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
  const [regSubmittedModal, setRegSubmittedModal] = useState<{
    name: string;
    email: string;
    departmentName: string;
    subDepartment: 'sales' | 'support';
  } | null>(null);

  // Google OAuth Modal
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [customGoogleEmail, setCustomGoogleEmail] = useState('');

  // Main System Login Credentials
  const mainLoginCredentials = {
    superadmin: { email: 'superadmin@amuwa.com', password: 'superadmin123', name: 'Super Admin', role: 'superadmin' as const },
    admin: { email: 'admin@amuwa.com', password: 'admin123', name: 'Admin (Department Head)', role: 'admin' as const },
    hr: { email: 'hr@amuwa.com', password: 'hr123', name: 'HR Manager', role: 'hr' as const },
    lead: { email: 'lead@amuwa.com', password: 'lead123', name: 'Vikram Deshmukh (Team Lead)', role: 'team-lead' as const },
    accounts: { email: 'accounts@amuwa.com', password: 'accounts123', name: 'Rajiv Khanna (Accounts Head)', role: 'admin' as const, departmentId: 'accounts' },
    techsupport: { email: 'techsupport@wabastore.com', password: 'support123', name: 'Rohan Mehta (Technical Support)', role: 'technical-support' as const, departmentId: 'wabastore' }
  };

  const handleQuickFill = (targetEmail: string, targetPass: string) => {
    setEmail(targetEmail);
    setPassword(targetPass);
    setLoginError('');
  };

  // --------------------------------------------------------------------------
  // SIGN IN SUBMISSION (With security status verification)
  // --------------------------------------------------------------------------
  const handleSignInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setLoginError('Please enter both email and password');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Check User Approval Store (Handles PENDING_APPROVAL and REVOKED accounts)
    const approvalCheck = userApprovalStore.validateLogin(cleanEmail, password);
    if (approvalCheck.user) {
      if (!approvalCheck.allowed) {
        setLoginError(approvalCheck.message || 'Access restricted.');
        return;
      }
      // If approved & active in store:
      setLoginError('');
      loginWithEmail(
        approvalCheck.user.email,
        password,
        approvalCheck.user.role,
        approvalCheck.user.departmentId
      );
      return;
    }

    // 2. Check Static Team Member Credentials (fallback)
    const teamMember = SAMPLE_TEAM_MEMBERS.find(
      tm => tm.email.toLowerCase() === cleanEmail && tm.password === password
    );

    if (teamMember) {
      setLoginError('');
      loginWithEmail(teamMember.email, password, 'team-member', teamMember.departmentId);
      return;
    }

    // 3. Validate Main Login Credentials (SuperAdmin / Admin / HR / Accounts / TechSupport)
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

  // --------------------------------------------------------------------------
  // SIGN UP SUBMISSION
  // --------------------------------------------------------------------------
  const handleSignUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');

    if (!regName.trim()) {
      setRegError('Please enter your full name');
      return;
    }

    if (!regEmail.trim()) {
      setRegError('Please enter your organization email address');
      return;
    }

    if (!regDepartmentId) {
      setRegError('Please select your department from the dropdown');
      return;
    }

    if (!regPassword) {
      setRegError('Please enter a secure password');
      return;
    }

    if (regPassword.length < 6) {
      setRegError('Password must be at least 6 characters long');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setRegError('Passwords do not match. Please verify both password fields.');
      return;
    }

    const selectedDept = departments.find(d => d.id === regDepartmentId);
    const departmentName = selectedDept ? selectedDept.name : regDepartmentId;

    // Register user in store (status will be PENDING_APPROVAL)
    const result = userApprovalStore.register({
      name: regName.trim(),
      email: regEmail.trim(),
      password: regPassword,
      departmentId: regDepartmentId,
      departmentName,
      subDepartment: regSubDepartment
    });

    if (!result.success) {
      setRegError(result.message);
      return;
    }

    // Send high-priority notification to Super Admin, Department Heads, and Team Leads
    try {
      sendNotification({
        title: `🛡️ New Account Authorization Required: ${regName}`,
        message: `${regName} (${regEmail}) has registered for ${departmentName} [${regSubDepartment.toUpperCase()} Division]. Please review and authorize account access in Staff Access & Approvals.`,
        senderName: regName,
        senderDept: `${departmentName} (${regSubDepartment.toUpperCase()})`,
        senderDeptKey: `${regDepartmentId}_${regSubDepartment}`,
        targetKey: 'all',
        targetLabel: 'Super Admin, Department Head & Team Lead',
        priority: 'urgent'
      });
    } catch (err) {
      console.warn('Could not dispatch approval notification:', err);
    }

    // Show Confirmation Modal
    setRegSubmittedModal({
      name: regName,
      email: regEmail,
      departmentName,
      subDepartment: regSubDepartment
    });

    // Reset registration form fields
    setRegName('');
    setRegEmail('');
    setRegDepartmentId('');
    setRegSubDepartment('sales');
    setRegPassword('');
    setRegConfirmPassword('');
    setRegError('');
  };

  const handleGoogleSelect = (selectedEmail: string) => {
    loginWithGoogle(selectedEmail);
    setShowGoogleModal(false);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col justify-between items-center px-4 py-6 relative overflow-hidden selection:bg-blue-500/20 font-sans">
      
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

      <div className="w-full flex-1 flex flex-col justify-center items-center z-10 my-auto py-4">
        
        {/* Prominent Large Logo Component with Soft Glow */}
        <div className="mb-4 text-center flex justify-center drop-shadow-[0_12px_24px_rgba(37,99,235,0.15)] transition-transform hover:scale-[1.02] duration-300">
          <AmuwaLogo size="lg" />
        </div>

        {/* Eviction Notice Alert Banner if user was kicked from a session */}
        {evictedNotice && (
          <div className="max-w-[480px] w-full mb-3 p-3.5 rounded-2xl bg-amber-50/95 border border-amber-200 text-amber-900 text-xs flex items-start gap-3 shadow-lg backdrop-blur-md animate-fade-in">
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
        <div className="w-full max-w-[480px] bg-white/95 backdrop-blur-xl p-6 sm:p-8 rounded-3xl shadow-2xl shadow-blue-900/10 border border-white/90 hover:border-blue-300/80 transition-all duration-300 relative z-10">
          
          {/* Header Title & Subtitle */}
          <div className="text-center mb-5">
            <h2 className="text-2xl font-bold font-heading text-[#0F172A] tracking-tight">
              {isSignUp ? 'Create Account' : 'Sign In'}
            </h2>
            <p className="text-xs text-slate-400 mt-1 font-sans">
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
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{regError}</span>
                </div>
              )}

              <form onSubmit={handleSignUpSubmit} className="space-y-3.5">
                
                {/* 1. Name */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase tracking-wider font-mono">
                    TEAM MEMBER'S NAME <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Kunal Sharma"
                      value={regName}
                      onChange={e => {
                        setRegName(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all"
                    />
                  </div>
                </div>

                {/* 2. Email */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase tracking-wider font-mono">
                    EMAIL ADDRESS <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      placeholder="kunal@amuwa.com"
                      value={regEmail}
                      onChange={e => {
                        setRegEmail(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all font-mono"
                    />
                  </div>
                </div>

                {/* 3. Select Department Dropdown */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase tracking-wider font-mono">
                    SELECT DEPARTMENT <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <select
                      required
                      value={regDepartmentId}
                      onChange={e => {
                        setRegDepartmentId(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-10 pr-10 py-2 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all appearance-none cursor-pointer"
                    >
                      <option value="">Choose department...</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* 4. Role / Division Selection Cards (Reduced Box Size as explicitly requested) */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1.5 uppercase tracking-wider font-mono">
                    ROLE / DIVISION <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    
                    {/* Compact Sales Division Card */}
                    <div
                      onClick={() => setRegSubDepartment('sales')}
                      className={`p-2.5 rounded-2xl cursor-pointer transition-all border relative flex flex-col justify-between ${
                        regSubDepartment === 'sales'
                          ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/30 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                            regSubDepartment === 'sales'
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <TrendingUp className="w-3.5 h-3.5" />
                        </div>
                        {regSubDepartment === 'sales' && (
                          <div className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900 font-heading">Sales</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-100 text-blue-700">
                            Rep
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                          Sales rep dashboard &bull; Leads, Deals & EOD
                        </p>
                      </div>
                    </div>

                    {/* Compact Support Division Card */}
                    <div
                      onClick={() => setRegSubDepartment('support')}
                      className={`p-2.5 rounded-2xl cursor-pointer transition-all border relative flex flex-col justify-between ${
                        regSubDepartment === 'support'
                          ? 'border-rose-500 bg-rose-50/50 ring-2 ring-rose-400/30 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                            regSubDepartment === 'support'
                              ? 'bg-rose-500 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <Headphones className="w-3.5 h-3.5" />
                        </div>
                        {regSubDepartment === 'support' && (
                          <div className="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-xs">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900 font-heading">Support</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-700">
                            Tech
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                          Technical support &bull; 3-tier pipeline
                        </p>
                      </div>
                    </div>

                  </div>

                  {/* Informative Default Dashboard Indicator Pill */}
                  <div className="mt-2 px-3 py-1.5 rounded-xl bg-blue-50/70 border border-blue-200/60 flex items-center gap-2 text-[11px] text-blue-900">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0"></span>
                    <span>
                      Default Dashboard:{' '}
                      <strong className="font-semibold text-blue-950">
                        {regSubDepartment === 'support'
                          ? 'Technical Support Dashboard'
                          : 'Sales Team Member Dashboard'}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* 5. Password with Visibility Eye */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase tracking-wider font-mono">
                    PASSWORD <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showRegPassword ? 'text' : 'password'}
                      required
                      placeholder="••••••••••••"
                      value={regPassword}
                      onChange={e => {
                        setRegPassword(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-10 pr-10 py-2 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* 6. Confirm Password with Visibility Eye */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase tracking-wider font-mono">
                    CONFIRM PASSWORD <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showRegConfirmPassword ? 'text' : 'password'}
                      required
                      placeholder="••••••••••••"
                      value={regConfirmPassword}
                      onChange={e => {
                        setRegConfirmPassword(e.target.value);
                        setRegError('');
                      }}
                      className="w-full pl-10 pr-10 py-2 bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegConfirmPassword(!showRegConfirmPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showRegConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Sign Up Submit Button */}
                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 hover:shadow-xl hover:shadow-blue-600/40 transition-all active:scale-[0.99] mt-3 group"
                >
                  <span>Sign Up</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Toggle to Sign In */}
                <div className="text-center pt-2">
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
                onClick={() => setShowGoogleModal(true)}
                className="w-full py-3 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-slate-700 text-xs font-semibold flex items-center justify-center gap-3 transition-all shadow-xs hover:shadow-md active:scale-[0.99] group btn-shimmer"
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
              <div className="relative my-4 text-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-100" />
                </div>
                <span className="relative inline-block px-3 bg-white text-[10px] font-mono text-slate-400 uppercase tracking-widest font-semibold border border-slate-100 rounded-full">
                  OR
                </span>
              </div>

              {/* Error Message Display */}
              {loginError && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{loginError}</span>
                </div>
              )}

              {/* Email + Password Form */}
              <form onSubmit={handleSignInSubmit} className="space-y-3.5">
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
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all font-sans"
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
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all font-sans"
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
                <div className="flex items-center justify-between text-xs pt-1">
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
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 hover:shadow-xl hover:shadow-blue-600/40 transition-all active:scale-[0.99] mt-2 btn-shimmer group"
                >
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Toggle to Sign Up */}
                <div className="text-center pt-2">
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

              {/* Quick Demo Test Accounts */}
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-left">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>TEST ACCOUNTS (1-CLICK FILL):</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5 text-xs">

                  <button
                    type="button"
                    onClick={() => handleQuickFill('techsupport@wabastore.com', 'support123')}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200/80 flex items-center justify-between font-mono text-[11px] transition-colors"
                  >
                    <span><strong>Rohan Mehta</strong> (Technical Support)</span>
                    <span className="text-[10px] bg-teal-200/70 text-teal-900 font-bold px-1.5 py-0.5 rounded">Wabastore Support</span>
                  </button>

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
          )}

        </div>

      </div>

      {/* Page Footer */}
      <footer className="text-center text-xs font-semibold text-slate-500/80 font-sans z-10 mt-2">
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
              A notification has been sent to the <strong>Super Admin</strong>, <strong>Department Head</strong>, and <strong>Team Lead</strong>. Once authorized, you can sign in directly with your email and password.
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
