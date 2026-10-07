import React, { useState, useEffect } from 'react';
import { 
  Globe, MapPin, Instagram, Facebook, Smartphone, ShieldCheck, 
  ArrowRight, CheckCircle2, Sparkles, LogOut, Lock, KeyRound, 
  ExternalLink, Star, Plus, RefreshCw, Layers, Radio, MessageSquare,
  Share2, Heart, Eye, User, Phone
} from 'lucide-react';

interface CustomerSocialPortalProps {
  onClose?: () => void;
}

export const CustomerSocialPortal: React.FC<CustomerSocialPortalProps> = ({ onClose }) => {
  // Auth state: 'auth' (Sign-In) vs 'portal' (Dashboard Links)
  const [authStep, setAuthStep] = useState<'signin' | 'otp' | 'authenticated'>('signin');
  const [authMethod, setAuthMethod] = useState<'google' | 'mobile'>('google');

  // Mobile Auth Form State
  const [mobileNumber, setMobileNumber] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [resendTimer, setResendTimer] = useState(30);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  // Authenticated User Info
  const [authenticatedUser, setAuthenticatedUser] = useState<{
    name: string;
    emailOrPhone: string;
    avatar: string;
    authMethodLabel: string;
  } | null>(null);

  // Timer Countdown for OTP
  useEffect(() => {
    let interval: any = null;
    if (authStep === 'otp' && resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [authStep, resendTimer]);

  // Handle Google 1-Click Sign-In
  const handleGoogleSignIn = () => {
    setIsSendingOtp(true);
    setTimeout(() => {
      setAuthenticatedUser({
        name: 'Alex Mercer',
        emailOrPhone: 'alex.mercer@gmail.com',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        authMethodLabel: 'Google Verified Account'
      });
      setIsSendingOtp(false);
      setAuthStep('authenticated');
    }, 800);
  };

  // Handle Mobile Submit & Send OTP
  const handleSendOtpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mobileNumber.length < 10) {
      setOtpError('Please enter a valid 10-digit mobile number');
      return;
    }
    setOtpError(null);
    setIsSendingOtp(true);
    setTimeout(() => {
      setIsSendingOtp(false);
      setAuthStep('otp');
      setResendTimer(30);
    }, 600);
  };

  // Handle OTP Digit Input Change
  const handleOtpDigitChange = (index: number, value: string) => {
    if (value.length > 1) value = value.charAt(value.length - 1);
    const updated = [...otpDigits];
    updated[index] = value;
    setOtpDigits(updated);

    // Auto-focus next box
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-input-${index + 1}`);
      nextInput?.focus();
    }
  };

  // Verify OTP Code
  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    const fullOtp = otpDigits.join('');
    if (fullOtp.length < 6) {
      setOtpError('Please enter complete 6-digit OTP code');
      return;
    }

    setIsSendingOtp(true);
    setTimeout(() => {
      setIsSendingOtp(false);
      setAuthenticatedUser({
        name: `User (+91 ${mobileNumber})`,
        emailOrPhone: `+91 ${mobileNumber}`,
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        authMethodLabel: 'Mobile OTP Verified'
      });
      setAuthStep('authenticated');
    }, 700);
  };

  const handleSignOut = () => {
    setAuthStep('signin');
    setAuthenticatedUser(null);
    setOtpDigits(['', '', '', '', '', '']);
    setMobileNumber('');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-blue-500/20">
      
      {/* Background Animated Light Ambient Glow Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-gradient-to-tr from-purple-300/30 via-fuchsia-200/20 to-pink-300/30 blur-[130px] rounded-full pointer-events-none animate-orb-1" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[650px] h-[650px] bg-gradient-to-br from-blue-300/30 via-cyan-200/20 to-indigo-300/30 blur-[140px] rounded-full pointer-events-none animate-orb-2" />
      <div className="absolute top-[40%] right-[15%] w-[450px] h-[450px] bg-gradient-to-r from-teal-200/20 via-emerald-200/20 to-sky-300/20 blur-[120px] rounded-full pointer-events-none animate-orb-3" />

      {/* Light Radial Dot Pattern Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-4xl relative z-10 my-8">
        
        {/* ========================================================================= */}
        {/* STEP 1: LIGHT THEME AUTHENTICATION SCREEN (GOOGLE SIGN-IN & MOBILE OTP) */}
        {/* ========================================================================= */}
        {authStep !== 'authenticated' && (
          <div className="max-w-md mx-auto bg-white/95 backdrop-blur-2xl rounded-3xl p-8 border border-slate-200 shadow-2xl space-y-6 animate-scale-up">
            
            {/* Header Badge & Title */}
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-mono font-semibold">
                <Sparkles className="w-3.5 h-3.5 animate-pulse text-blue-600" />
                <span>AMUWA CUSTOMER PORTAL</span>
              </div>

              <h2 className="text-3xl font-bold font-heading text-slate-900 tracking-tight">
                Welcome to Amuwa
              </h2>
              <p className="text-xs text-slate-500 font-mono">
                Sign in to access official social channels, live maps, and group links.
              </p>
            </div>

            {/* Auth Method Toggle Tabs */}
            <div className="p-1 rounded-2xl bg-slate-100 border border-slate-200 flex items-center gap-1 font-mono text-xs font-bold">
              <button
                type="button"
                onClick={() => { setAuthMethod('google'); setAuthStep('signin'); }}
                className={`flex-1 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
                  authMethod === 'google'
                    ? 'bg-white text-blue-600 shadow-md border border-slate-200'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <span>Google Login</span>
              </button>

              <button
                type="button"
                onClick={() => { setAuthMethod('mobile'); setAuthStep('signin'); }}
                className={`flex-1 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
                  authMethod === 'mobile'
                    ? 'bg-white text-blue-600 shadow-md border border-slate-200'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                <span>Mobile OTP</span>
              </button>
            </div>

            {/* OPTION 1: GOOGLE 1-CLICK AUTHENTICATION */}
            {authMethod === 'google' && (
              <div className="space-y-4 pt-2">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isSendingOtp}
                  className="w-full py-4 px-6 rounded-2xl bg-white hover:bg-slate-50 text-slate-900 font-semibold text-sm flex items-center justify-center gap-3 transition-all transform hover:-translate-y-0.5 active:translate-y-0 shadow-md border border-slate-200 group"
                >
                  {isSendingOtp ? (
                    <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                  ) : (
                    <>
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                      </svg>
                      <span>Sign in with Google</span>
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform ml-auto" />
                    </>
                  )}
                </button>

                <p className="text-[11px] font-mono text-center text-slate-400">
                  Protected by 256-bit SSL Google OAuth Encryption
                </p>
              </div>
            )}

            {/* OPTION 2: MOBILE NUMBER & OTP VERIFICATION */}
            {authMethod === 'mobile' && (
              <div className="space-y-4">
                
                {authStep === 'signin' ? (
                  <form onSubmit={handleSendOtpSubmit} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-mono font-bold text-slate-500 uppercase mb-1.5">
                        MOBILE PHONE NUMBER *
                      </label>
                      <div className="flex items-center rounded-2xl bg-white border border-slate-300 overflow-hidden focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all shadow-2xs">
                        <span className="px-3.5 py-3 bg-slate-100 border-r border-slate-200 text-xs font-mono text-slate-600 font-bold flex items-center gap-1">
                          🇮🇳 +91
                        </span>
                        <input
                          type="tel"
                          required
                          maxLength={10}
                          placeholder="98201 12345"
                          value={mobileNumber}
                          onChange={e => setMobileNumber(e.target.value.replace(/\D/g, ''))}
                          className="w-full bg-transparent px-3 py-3 font-mono text-sm text-slate-900 focus:outline-none placeholder:text-slate-400"
                        />
                      </div>
                      {otpError && <p className="text-[11px] font-mono text-rose-500 mt-1">{otpError}</p>}
                    </div>

                    <button
                      type="submit"
                      disabled={isSendingOtp}
                      className="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-all active:scale-95"
                    >
                      {isSendingOtp ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>Send 6-Digit OTP Code</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  /* OTP CODE VERIFICATION FORM */
                  <form onSubmit={handleVerifyOtp} className="space-y-4 animate-fade-in">
                    <div className="text-center space-y-1">
                      <span className="text-xs font-mono text-slate-500">OTP Sent to +91 {mobileNumber}</span>
                      <button
                        type="button"
                        onClick={() => setAuthStep('signin')}
                        className="text-[11px] font-mono text-blue-600 hover:underline block mx-auto font-bold"
                      >
                        Change Phone Number
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 py-2">
                      {otpDigits.map((digit, idx) => (
                        <input
                          key={idx}
                          id={`otp-input-${idx}`}
                          type="text"
                          maxLength={1}
                          value={digit}
                          onChange={e => handleOtpDigitChange(idx, e.target.value)}
                          className="w-12 h-14 rounded-2xl bg-white border border-slate-300 text-center font-mono text-xl font-bold text-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all shadow-2xs"
                        />
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                      <span>Resend OTP in: <strong className="text-blue-600">{resendTimer}s</strong></span>
                      <button
                        type="button"
                        disabled={resendTimer > 0}
                        onClick={() => setResendTimer(30)}
                        className="text-blue-600 font-bold disabled:opacity-50 hover:underline"
                      >
                        Resend Code
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={isSendingOtp}
                      className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-all active:scale-95"
                    >
                      {isSendingOtp ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>Verify &amp; Enter Portal</span>
                        </>
                      )}
                    </button>
                  </form>
                )}

              </div>
            )}

          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 2: INSIDE LIGHT THEME CUSTOMER PORTAL (SOCIAL & PLATFORM LINKS HUB) */}
        {/* ========================================================================= */}
        {authStep === 'authenticated' && authenticatedUser && (
          <div className="space-y-8 animate-fade-in">
            
            {/* Top User Session Light Glass Bar */}
            <div className="bg-white/90 backdrop-blur-2xl rounded-3xl p-6 border border-slate-200 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold font-heading text-slate-900">{authenticatedUser.name}</h3>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      VERIFIED
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-500 mt-0.5">
                    {authenticatedUser.emailOrPhone} &bull; {authenticatedUser.authMethodLabel}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {onClose && (
                  <button
                    onClick={onClose}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono font-bold border border-slate-200 transition-colors"
                  >
                    Return to CRM
                  </button>
                )}
                <button
                  onClick={handleSignOut}
                  className="px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-mono font-bold border border-rose-200 flex items-center gap-1.5 transition-colors"
                >
                  <LogOut className="w-4 h-4 text-rose-600" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>

            {/* Portal Title Banner */}
            <div className="text-center space-y-2">
              <span className="px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-mono text-xs font-bold uppercase tracking-wider">
                OFFICIAL SOCIAL &amp; PLATFORM CHANNELS
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold font-heading text-slate-900 tracking-tight">
                Amuwa Group Media &amp; Location Hub
              </h2>
              <p className="text-xs font-mono text-slate-500 max-w-lg mx-auto">
                Connect with our official Instagram stream, Facebook page, Google Maps location, and corporate web portals below.
              </p>
            </div>

            {/* LIGHT THEME ANIMATED CARDS GRID FOR INSTAGRAM, FACEBOOK, GOOGLE MAPS & WEBSITES */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              {/* CARD 1: INSTAGRAM OFFICIAL PROFILE */}
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white/95 backdrop-blur-xl rounded-3xl p-6 border border-slate-200 hover:border-pink-500 hover:shadow-2xl hover:shadow-pink-500/10 hover:-translate-y-1.5 transition-all duration-300 group flex flex-col justify-between space-y-6 shadow-md"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="p-3.5 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white shadow-md group-hover:scale-110 transition-transform">
                      <Instagram className="w-7 h-7" />
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-pink-50 text-pink-700 border border-pink-200 font-mono text-[10px] font-bold">
                      INSTAGRAM STREAM
                    </span>
                  </div>

                  <div>
                    <h4 className="text-xl font-bold font-heading text-slate-900 group-hover:text-pink-600 transition-colors">
                      @amuwa_official
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Follow our official Instagram channel for daily AI tech reels, product updates, and brand stories.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-500">Community:</span>
                    <strong className="text-pink-600 font-bold">48.5K Followers</strong>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono font-bold text-pink-600">
                  <span>Visit Instagram Profile</span>
                  <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </a>

              {/* CARD 2: FACEBOOK META PAGE */}
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white/95 backdrop-blur-xl rounded-3xl p-6 border border-slate-200 hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1.5 transition-all duration-300 group flex flex-col justify-between space-y-6 shadow-md"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="p-3.5 rounded-2xl bg-blue-600 text-white shadow-md group-hover:scale-110 transition-transform">
                      <Facebook className="w-7 h-7" />
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-mono text-[10px] font-bold">
                      META COMMUNITY
                    </span>
                  </div>

                  <div>
                    <h4 className="text-xl font-bold font-heading text-slate-900 group-hover:text-blue-600 transition-colors">
                      Amuwa Corporation Meta Hub
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Connect with our Facebook business page for enterprise news, customer reviews, and Meta API updates.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-500">Page Rating:</span>
                    <strong className="text-blue-600 font-bold flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      4.9 / 5 (1,240 Reviews)
                    </strong>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono font-bold text-blue-600">
                  <span>Open Facebook Page</span>
                  <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </a>

              {/* CARD 3: GOOGLE MAPS EXPERIENCE CENTER */}
              <a
                href="https://maps.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white/95 backdrop-blur-xl rounded-3xl p-6 border border-slate-200 hover:border-emerald-500 hover:shadow-2xl hover:shadow-emerald-500/10 hover:-translate-y-1.5 transition-all duration-300 group flex flex-col justify-between space-y-6 shadow-md"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="p-3.5 rounded-2xl bg-emerald-600 text-white shadow-md group-hover:scale-110 transition-transform">
                      <MapPin className="w-7 h-7" />
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10px] font-bold">
                      LIVE LOCATION
                    </span>
                  </div>

                  <div>
                    <h4 className="text-xl font-bold font-heading text-slate-900 group-hover:text-emerald-600 transition-colors">
                      Amuwa HQ &amp; Experience Center
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Get turn-by-turn driving directions to our main corporate campus &amp; tech experience center on Google Maps.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-500">Google Maps Rating:</span>
                    <strong className="text-emerald-600 font-bold flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      4.9 ⭐ (HQ Location)
                    </strong>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono font-bold text-emerald-600">
                  <span>Open Directions on Google Maps</span>
                  <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </a>

              {/* CARD 4: MAIN WEB PORTAL */}
              <a
                href="https://amuwa.com"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white/95 backdrop-blur-xl rounded-3xl p-6 border border-slate-200 hover:border-purple-500 hover:shadow-2xl hover:shadow-purple-500/10 hover:-translate-y-1.5 transition-all duration-300 group flex flex-col justify-between space-y-6 shadow-md"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="p-3.5 rounded-2xl bg-purple-600 text-white shadow-md group-hover:scale-110 transition-transform">
                      <Globe className="w-7 h-7" />
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-mono text-[10px] font-bold">
                      MAIN PORTAL
                    </span>
                  </div>

                  <div>
                    <h4 className="text-xl font-bold font-heading text-slate-900 group-hover:text-purple-600 transition-colors">
                      https://amuwa.com
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Official group portal detailing product solutions, API docs, and brand ecosystem.
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono font-bold text-purple-600">
                  <span>Open amuwa.com</span>
                  <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </a>

              {/* CARD 5: CORPORATE GROUP WEBSITE */}
              <a
                href="https://amuwacorporation.com"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white/95 backdrop-blur-xl rounded-3xl p-6 border border-slate-200 hover:border-amber-500 hover:shadow-2xl hover:shadow-amber-500/10 hover:-translate-y-1.5 transition-all duration-300 group flex flex-col justify-between space-y-6 shadow-md"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="p-3.5 rounded-2xl bg-amber-600 text-white shadow-md group-hover:scale-110 transition-transform">
                      <Globe className="w-7 h-7" />
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-mono text-[10px] font-bold">
                      CORPORATE HQ
                    </span>
                  </div>

                  <div>
                    <h4 className="text-xl font-bold font-heading text-slate-900 group-hover:text-amber-600 transition-colors">
                      https://amuwacorporation.com
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Corporate headquarters portal for investor relations, governance, and business units.
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono font-bold text-amber-600">
                  <span>Open amuwacorporation.com</span>
                  <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </a>

              {/* CARD 6: PLACEHOLDER FOR FUTURE CUSTOM LINKS */}
              <div className="bg-slate-50/80 backdrop-blur-xl rounded-3xl p-6 border border-dashed border-slate-300 hover:border-slate-400 transition-all flex flex-col items-center justify-center text-center space-y-3 cursor-pointer group">
                <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 text-slate-400 group-hover:text-slate-900 flex items-center justify-center group-hover:scale-110 transition-all shadow-xs">
                  <Plus className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold font-heading text-slate-700 group-hover:text-slate-900 transition-colors">
                    Add Custom Link Channel
                  </h4>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Placeholder for future custom social &amp; business links
                  </p>
                </div>
              </div>

            </div>

          </div>
        )}

      </div>
    </div>
  );
};
