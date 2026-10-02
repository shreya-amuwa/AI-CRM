import React, { useState } from 'react';
import { Lock, X, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Department } from '../../types/crm';

interface DepartmentUnlockModalProps {
  isOpen: boolean;
  department: Department | null;
  userRole: 'admin' | 'hr';
  onUnlock: (departmentId: string) => void;
  onClose: () => void;
}

const DEPARTMENT_CREDENTIALS = {
  amuwa: { id: 'amuwa_admin', pass: 'amuwa123' },
  amuwastudio: { id: 'amuwastudio_admin', pass: 'amuwastudio123' },
  wabastar: { id: 'wabastar_admin', pass: 'wabastar123' },
  wabastore: { id: 'wabastore_admin', pass: 'wabastore123' },
  whatsbox: { id: 'whatsbox_admin', pass: 'whatsbox123' },
  dtalk: { id: 'dtalk_admin', pass: 'dtalk123' },
  digitree: { id: 'digitree_admin', pass: 'digitree123' },
  mpillar: { id: 'mpillar_admin', pass: 'mpillar123' },
  edutraining: { id: 'edutraining_admin', pass: 'edutraining123' },
  hr: { id: 'hr_access', pass: 'hr_dept123' },
  accounts: { id: 'accounts_admin', pass: 'accounts123' }
};

export const DepartmentUnlockModal: React.FC<DepartmentUnlockModalProps> = ({
  isOpen,
  department,
  userRole,
  onUnlock,
  onClose
}) => {
  const [deptId, setDeptId] = useState('');
  const [deptPass, setDeptPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!department) return;

    // Special allowance for accounts head alias
    const isAccountsMatch =
      department.id === 'accounts' &&
      (deptId.trim() === 'accounts_admin' || deptId.trim() === 'accounts_head' || deptId.trim() === 'accounts_access') &&
      deptPass.trim() === 'accounts123';

    const creds = DEPARTMENT_CREDENTIALS[department.id as keyof typeof DEPARTMENT_CREDENTIALS];

    if (!isAccountsMatch && (!creds || deptId.trim() !== creds.id || deptPass.trim() !== creds.pass)) {
      setError('Invalid department ID or password. Access restricted to SuperAdmin and Accounts Head.');
      return;
    }

    setError('');
    onUnlock(department.id);
    handleClose();
  };

  const handleClose = () => {
    setDeptId('');
    setDeptPass('');
    setError('');
    onClose();
  };

  if (!isOpen || !department) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-[460px] w-full p-8 animate-fade-in relative border border-slate-200">

        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-lg transition-all"
        >
          <X className="w-5 h-5 text-slate-600" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 mx-auto flex items-center justify-center mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Unlock {department.name}</h2>
          <p className="text-sm text-slate-500 mt-1">Enter department credentials to proceed</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Department ID */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
              Department ID
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                placeholder="e.g. amuwa_admin"
                value={deptId}
                onChange={e => {
                  setDeptId(e.target.value);
                  setError('');
                }}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-sm focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all"
              />
            </div>
          </div>

          {/* Department Password */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••••••"
                value={deptPass}
                onChange={e => {
                  setDeptPass(e.target.value);
                  setError('');
                }}
                className="w-full pl-10 pr-10 py-2.5 bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 text-sm focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all"
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
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 hover:shadow-xl hover:shadow-blue-600/40 transition-all active:scale-[0.99] mt-2"
          >
            <span>Unlock Department</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* Cancel Button */}
          <button
            type="button"
            onClick={handleClose}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
};
