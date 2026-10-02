import React, { useState } from 'react';
import { Lock, ArrowRight, Eye, EyeOff, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AmuwaLogo } from '../common/AmuwaLogo';

interface DepartmentAccessFormProps {
  tempUser: { email: string; role: 'admin' | 'hr'; name: string } | null;
  onBack: () => void;
}

export const DepartmentAccessForm: React.FC<DepartmentAccessFormProps> = ({ tempUser, onBack }) => {
  const { loginWithEmail, setTempAuthUser } = useAuth();

  const [departmentId, setDepartmentId] = useState('');
  const [departmentPass, setDepartmentPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Department-Specific Access for Admins
  const departmentAdminAccess = {
    amuwa: { deptId: 'amuwa', deptName: 'Amuwa', adminId: 'amuwa_admin', adminPass: 'amuwa123' },
    wabastore: { deptId: 'wabastore', deptName: 'Wabastore', adminId: 'wabastore_admin', adminPass: 'wabastore123' },
    mpillar: { deptId: 'mpillar', deptName: 'M-Pillar', adminId: 'mpillar_admin', adminPass: 'mpillar123' },
    edutraining: { deptId: 'edutraining', deptName: 'Edu Training', adminId: 'edutraining_admin', adminPass: 'edutraining123' },
    whatsbox: { deptId: 'whatsbox', deptName: 'Whatsbox', adminId: 'whatsbox_admin', adminPass: 'whatsbox123' },
    digitree: { deptId: 'digitree', deptName: 'Digitree', adminId: 'digitree_admin', adminPass: 'digitree123' },
    dtalk: { deptId: 'dtalk', deptName: 'D-Talk', adminId: 'dtalk_admin', adminPass: 'dtalk123' },
    accounts: { deptId: 'accounts', deptName: 'Accounts Department', adminId: 'accounts_admin', adminPass: 'accounts123' }
  };

  // HR Department Access
  const hrAccess = {
    hr: { deptId: 'hr', deptName: 'HR Department', hrId: 'hr_access', hrPass: 'hr_dept123' }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!departmentId || !departmentPass) {
      setLoginError('Please enter both ID and password');
      return;
    }

    if (!tempUser) {
      setLoginError('Session expired. Please login again.');
      return;
    }

    // Validate department access
    if (tempUser.role === 'admin') {
      const deptAccess = departmentAdminAccess[departmentId as keyof typeof departmentAdminAccess];
      if (!deptAccess) {
        setLoginError('Invalid department');
        return;
      }
      if (departmentId !== deptAccess.adminId && departmentPass !== deptAccess.adminPass) {
        setLoginError('Invalid department ID or password');
        return;
      }
      // Successfully logged in as department admin
      setLoginError('');
      loginWithEmail(tempUser.email, departmentPass, 'admin', deptAccess.deptId);
      setTempAuthUser(null);
    } else if (tempUser.role === 'hr') {
      const hrDept = hrAccess['hr'];
      if (departmentId !== hrDept.hrId || departmentPass !== hrDept.hrPass) {
        setLoginError('Invalid HR ID or password');
        return;
      }
      // Successfully logged in as HR
      setLoginError('');
      loginWithEmail(tempUser.email, departmentPass, 'hr', 'hr');
      setTempAuthUser(null);
    }
  };

  if (!tempUser) return null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col justify-between items-center px-4 py-8 relative overflow-hidden selection:bg-blue-500/20">

      {/* Animated Ambient Floating Gradient Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[650px] h-[650px] bg-gradient-to-tr from-purple-300/40 via-fuchsia-200/30 to-pink-300/40 blur-[130px] rounded-full pointer-events-none animate-orb-1" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[700px] h-[700px] bg-gradient-to-br from-blue-300/40 via-cyan-200/30 to-indigo-300/40 blur-[140px] rounded-full pointer-events-none animate-orb-2" />
      <div className="absolute top-[40%] right-[15%] w-[450px] h-[450px] bg-gradient-to-r from-teal-200/30 via-emerald-200/20 to-sky-300/30 blur-[120px] rounded-full pointer-events-none animate-orb-3" />

      {/* Modern Dot Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(#94A3B8_1px,transparent_1px)] [background-size:24px_24px] opacity-25 pointer-events-none" />

      <div className="w-full flex-1 flex flex-col justify-center items-center z-10 my-auto">

        {/* Logo */}
        <div className="mb-6 text-center flex justify-center drop-shadow-[0_12px_24px_rgba(37,99,235,0.15)] transition-transform hover:scale-[1.02] duration-300">
          <AmuwaLogo size="lg" />
        </div>

        {/* Card Container */}
        <div className="w-full max-w-[460px] bg-white/95 backdrop-blur-xl p-8 sm:p-10 rounded-3xl shadow-2xl shadow-blue-900/10 border border-white/90 hover:border-blue-300/80 transition-all duration-300 relative z-10">

          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold font-heading text-[#0F172A] tracking-tight">
              {tempUser.role === 'admin' ? 'Select Department' : 'HR Access'}
            </h2>
            <p className="text-xs text-slate-400 mt-1 font-sans">
              {tempUser.role === 'admin'
                ? 'Enter your department ID and password'
                : 'Enter your HR access credentials'}
            </p>
          </div>

          {/* Error Message */}
          {loginError && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          {/* Step Info */}
          <div className="mb-4 p-3 rounded-xl bg-blue-50/50 border border-blue-200 text-slate-700 text-xs">
            <p className="font-semibold mb-1">Logged in as: <span className="text-slate-900">{tempUser.name}</span></p>
            <p className="font-mono text-slate-600">Email: <span className="font-semibold">{tempUser.email}</span></p>
          </div>

          {/* Department/HR Selection Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Quick Select Buttons for Admins */}
            {tempUser.role === 'admin' && (
              <div className="mb-4">
                <label className="block text-[11px] font-bold text-slate-700 mb-2 uppercase tracking-wider font-mono">
                  Quick Select Department
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries({
                    amuwa: { name: 'Amuwa', id: 'amuwa_admin', pass: 'amuwa123' },
                    wabastore: { name: 'Wabastore', id: 'wabastore_admin', pass: 'wabastore123' },
                    mpillar: { name: 'M-Pillar', id: 'mpillar_admin', pass: 'mpillar123' },
                    edutraining: { name: 'Edu Training', id: 'edutraining_admin', pass: 'edutraining123' },
                    whatsbox: { name: 'Whatsbox', id: 'whatsbox_admin', pass: 'whatsbox123' },
                    digitree: { name: 'Digitree', id: 'digitree_admin', pass: 'digitree123' },
                    dtalk: { name: 'D-Talk', id: 'dtalk_admin', pass: 'dtalk123' }
                  }).map(([key, dept]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setDepartmentId(dept.id);
                        setDepartmentPass(dept.pass);
                        setLoginError('');
                      }}
                      className={`p-2 rounded-lg border-2 transition-all text-xs font-semibold ${
                        departmentId === dept.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-slate-50 hover:border-blue-300'
                      }`}
                    >
                      {dept.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Manual ID Input */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1.5 uppercase tracking-wider font-mono">
                {tempUser.role === 'admin' ? 'DEPARTMENT ID' : 'HR ID'}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder={tempUser.role === 'admin' ? 'amuwa_admin' : 'hr_access'}
                  value={departmentId}
                  onChange={e => {
                    setDepartmentId(e.target.value);
                    setLoginError('');
                  }}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-sm focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all font-sans"
                />
              </div>
            </div>

            {/* Password Input */}
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
                  value={departmentPass}
                  onChange={e => {
                    setDepartmentPass(e.target.value);
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

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 hover:shadow-xl hover:shadow-blue-600/40 transition-all active:scale-[0.99] mt-2 btn-shimmer group"
            >
              <span>Access {tempUser.role === 'admin' ? 'Department' : 'HR'}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>

            {/* Back Button */}
            <button
              type="button"
              onClick={onBack}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm flex items-center justify-center gap-2 transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Login</span>
            </button>
          </form>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center text-xs font-semibold text-slate-500/80 font-sans z-10 mt-4">
        &copy; 2026 Amuwa Corporation. All rights reserved.
      </footer>
    </div>
  );
};
