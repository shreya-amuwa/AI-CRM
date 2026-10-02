import React, { useState } from 'react';
import {
  Building2, ShoppingBag, MessageSquare, PhoneCall, Cpu, Layers, Sparkles, Star,
  ArrowRight, Plus, Lock, Unlock, X, AlertTriangle, GraduationCap, Users, FileText,
  Trash2, RotateCcw, DollarSign
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';
import { useTabs } from '../../context/TabContext';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { Department } from '../../types/crm';
import { DepartmentUnlockModal } from '../auth/DepartmentUnlockModal';
import { DEPARTMENTS as SEED_DEPARTMENTS } from '../../data/departments';

const getFallbackIcon = (iconName: string) => {
  switch (iconName) {
    case 'Building2': return Building2;
    case 'Sparkles': return Sparkles;
    case 'Star': return Star;
    case 'ShoppingBag': return ShoppingBag;
    case 'MessageSquare': return MessageSquare;
    case 'PhoneCall': return PhoneCall;
    case 'Cpu': return Cpu;
    case 'Layers': return Layers;
    case 'GraduationCap': return GraduationCap;
    case 'Users': return Users;
    case 'DollarSign': return DollarSign;
    default: return Building2;
  }
};

const CARD_BASE =
  'bg-white/95 backdrop-blur-xl rounded-3xl transition-all duration-300 group flex flex-col justify-between border shadow-md overflow-hidden relative p-6 space-y-5';

export const DepartmentSelector: React.FC = () => {
  const { selectDepartment, user, logout } = useAuth();
  const {
    departments,
    addDepartment,
    deleteDepartment,
    resetToDefaults,
    lockDepartment,
    unlockDepartment
  } = useDepartments();
  const { openDepartment, tabs } = useTabs();
  const isSuperAdmin = user?.role === 'superadmin';
  const isAdminOrHR = user?.role === 'admin' || user?.role === 'hr';

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [lockTarget, setLockTarget] = useState<Department | null>(null);
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<Department | null>(null);

  const handleEnter = (dept: Department) => {
    if (isSuperAdmin) {
      selectDepartment(dept.id);
      return;
    }

    // For admin/HR users, show unlock modal instead
    if (isAdminOrHR) {
      setUnlockTarget(dept);
      return;
    }
  };

  const handleOpenInTab = (e: React.MouseEvent, dept: Department) => {
    e.stopPropagation();
    openDepartment(dept.id, dept.name);
  };

  const handleDepartmentUnlock = (departmentId: string) => {
    selectDepartment(departmentId);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 sm:p-8 flex flex-col justify-between relative overflow-hidden selection:bg-blue-500/20">

      {/* 1. Animated Ambient Floating Gradient Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-gradient-to-tr from-purple-300/30 via-fuchsia-200/20 to-pink-300/30 blur-[130px] rounded-full pointer-events-none animate-orb-1" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[650px] h-[650px] bg-gradient-to-br from-blue-300/30 via-cyan-200/20 to-indigo-300/30 blur-[140px] rounded-full pointer-events-none animate-orb-2" />
      <div className="absolute top-[40%] right-[15%] w-[450px] h-[450px] bg-gradient-to-r from-teal-200/20 via-emerald-200/20 to-sky-300/20 blur-[120px] rounded-full pointer-events-none animate-orb-3" />

      {/* 2. Modern Dot Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(#94A3B8_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none" />

      {/* Top Navbar */}
      <header className="max-w-7xl w-full mx-auto flex items-center justify-between pb-6 border-b border-slate-200/80 z-10">
        <AmuwaLogo layout="horizontal" size="sm" />

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-white/90 border border-slate-200/80 text-xs font-mono text-slate-700 shadow-xs backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>{isSuperAdmin ? 'Super Admin' : 'Staff'}: <strong className="text-slate-900">{user?.name}</strong></span>
          </div>

          <button
            onClick={logout}
            className="px-4 py-1.5 rounded-xl bg-white/90 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium font-mono transition-all shadow-xs backdrop-blur-md active:scale-95"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Centered Page Title Header */}
      <div className="max-w-7xl w-full mx-auto my-6 text-center z-10 space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-mono font-semibold">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
          <span>{departments.length} Business Units &bull; Dedicated Control Panels</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold font-heading text-slate-900 tracking-tight drop-shadow-2xs">
          {isSuperAdmin ? 'Super Admin Dashboard' : 'Select Department Control Panel'}
        </h2>
        {isSuperAdmin && (
          <div className="pt-1">
            <button
              onClick={resetToDefaults}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 shadow-2xs transition-all cursor-pointer active:scale-95"
            >
              <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
              <span>Restore 11 Official Departments</span>
            </button>
          </div>
        )}
      </div>

      {/* Transient locked-department notice */}
      {lockedNotice && (
        <div className="max-w-7xl w-full mx-auto z-20 mb-2">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium shadow-sm animate-fade-in">
            <Lock className="w-4 h-4 shrink-0" />
            <span>{lockedNotice}</span>
          </div>
        </div>
      )}

      {/* Department Cards Grid */}
      <div className="max-w-7xl w-full mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 flex-1 z-10">
        {departments.map(dept => {
          const Icon = getFallbackIcon(dept.iconName);
          const isCustom = !SEED_DEPARTMENTS.some(s => s.id === dept.id);

          return (
            <div
              key={dept.id}
              className={`${CARD_BASE} ${
                dept.locked
                  ? 'border-slate-200/90 opacity-90'
                  : 'border-slate-200/90 hover:border-blue-500/80 hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1.5 shadow-slate-200/50 cursor-pointer'
              }`}
              onClick={() => handleEnter(dept)}
            >
              {/* Top Accent Gradient Stripe */}
              <div
                className="h-1.5 w-full bg-gradient-to-r transition-all duration-300 absolute top-0 left-0 right-0"
                style={{
                  backgroundImage: `linear-gradient(to right, ${dept.accentColor}, ${dept.accentColor}88)`
                }}
              />

              {/* Delete button for custom added departments */}
              {isCustom && isSuperAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteDepartment(dept.id);
                  }}
                  title="Delete custom department"
                  aria-label={`Delete ${dept.name}`}
                  className="absolute top-4 left-4 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Inline lock control for SuperAdmin or lock icon for Admin/HR */}
              {isSuperAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLockTarget(dept);
                  }}
                  title={dept.locked ? 'Unlock department' : 'Lock department'}
                  aria-label={dept.locked ? `Unlock ${dept.name}` : `Lock ${dept.name}`}
                  className={`absolute top-4 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-mono font-semibold border transition-all active:scale-95 ${
                    dept.locked
                      ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {dept.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  {dept.locked ? 'Locked' : 'Unlocked'}
                </button>
              )}

              {/* Lock icon indicator for Admin/HR users */}
              {isAdminOrHR && (
                <div className="absolute top-4 right-4 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 border border-blue-200 text-blue-600 cursor-pointer hover:bg-blue-100 transition-all group-hover:scale-110">
                  <Lock className="w-4 h-4" />
                </div>
              )}

              {/* LARGE HIGH-IMPACT BRAND LOGO DISPLAY */}
              <div className="h-28 sm:h-32 w-full flex items-center justify-center p-2 bg-slate-50/60 rounded-2xl border border-slate-100 group-hover:bg-blue-50/40 group-hover:border-blue-100 transition-colors mt-2">
                {dept.logoUrl ? (
                  <img
                    src={dept.logoUrl}
                    alt={dept.name}
                    className="max-h-full max-w-full w-auto object-contain transition-transform duration-300 group-hover:scale-105 drop-shadow-sm"
                  />
                ) : (
                  <div
                    className="p-4 rounded-2xl flex items-center justify-center text-blue-600 bg-blue-50 border border-blue-100 shadow-sm group-hover:scale-110 transition-transform duration-300"
                  >
                    <Icon className="w-12 h-12 text-blue-600" />
                  </div>
                )}
              </div>

              {/* Department Name + compact management info */}
              <div className="text-center space-y-1">
                <h3 className="text-xl font-bold font-heading text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">
                  {dept.name}
                </h3>
                {dept.headName && (
                  <p className="text-xs font-mono text-slate-400">Head: {dept.headName}</p>
                )}
              </div>

              {/* Enter Panel Action Buttons */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                {dept.locked ? (
                  <div className="w-full py-3.5 px-4 rounded-2xl bg-slate-100 text-slate-400 font-bold font-mono text-xs flex items-center justify-center gap-2">
                    <Lock className="w-4 h-4" />
                    <span>Department Locked</span>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEnter(dept); }}
                      className="w-full py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold font-mono text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 group-hover:bg-blue-600"
                    >
                      <span>Enter Panel</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>

                    {/* Open in New Tab button */}
                    {tabs.length > 0 && (
                      <button
                        onClick={(e) => handleOpenInTab(e, dept)}
                        className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold font-mono text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
                        title="Open in a new tab"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>New Tab</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* Add Department card — always the final card in this grid, never
            stored as a department record. Super Admin only. */}
        {isSuperAdmin && (
          <button
            onClick={() => setIsAddOpen(true)}
            className={`${CARD_BASE} border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/30 items-center justify-center text-center cursor-pointer min-h-[280px]`}
          >
            <div className="flex flex-col items-center justify-center gap-3 h-full">
              <div className="p-4 rounded-2xl bg-slate-100 group-hover:bg-blue-100 text-slate-500 group-hover:text-blue-600 transition-colors">
                <Plus className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-heading text-slate-700">Add Department</h3>
                <p className="text-xs text-slate-400 mt-1">Create a new department</p>
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Clean Footer */}
      <footer className="max-w-7xl w-full mx-auto mt-10 pt-6 border-t border-slate-200/80 text-center text-xs font-sans text-slate-400 z-10">
        &copy; 2026 Amuwa Corporation. All rights reserved.
      </footer>

      {isAddOpen && (
        <AddDepartmentModal onClose={() => setIsAddOpen(false)} onCreate={addDepartment} />
      )}

      {lockTarget && (
        <LockConfirmModal
          department={lockTarget}
          onCancel={() => setLockTarget(null)}
          onConfirm={() => {
            if (lockTarget.locked) unlockDepartment(lockTarget.id);
            else lockDepartment(lockTarget.id);
            setLockTarget(null);
          }}
        />
      )}

      {/* Department Unlock Modal for Admin/HR users */}
      <DepartmentUnlockModal
        isOpen={!!unlockTarget}
        department={unlockTarget}
        userRole={user?.role === 'hr' ? 'hr' : 'admin'}
        onUnlock={handleDepartmentUnlock}
        onClose={() => setUnlockTarget(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Add Department modal — opens in-place, never navigates away from this screen
// ---------------------------------------------------------------------------

interface AddDepartmentModalProps {
  onClose: () => void;
  onCreate: (input: { name: string; description: string; category?: string }) => { ok: boolean; error?: string };
}

const AddDepartmentModal: React.FC<AddDepartmentModalProps> = ({ onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = onCreate({ name, description, category: category || undefined });
    if (!result.ok) {
      setError(result.error || 'Could not create department.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-2xl relative animate-scale-up">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
          <div>
            <h3 className="text-xl font-bold font-heading text-slate-900">Add Department</h3>
            <p className="text-sm text-slate-500 mt-0.5">Create a new operational workspace</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="dept-name" className="block text-xs font-mono font-semibold text-slate-600 mb-1.5">
              Department Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="dept-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="e.g. Customer Success"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm transition-all"
            />
          </div>

          <div>
            <label htmlFor="dept-desc" className="block text-xs font-mono font-semibold text-slate-600 mb-1.5">
              Department Description
            </label>
            <textarea
              id="dept-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does this department handle?"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm transition-all resize-none"
            />
          </div>

          <div>
            <label htmlFor="dept-category" className="block text-xs font-mono font-semibold text-slate-600 mb-1.5">
              Department Category
            </label>
            <input
              id="dept-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Operations, Sales, Support"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm transition-all"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-100 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-md active:scale-95 transition-all"
            >
              Create Department
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Lock / Unlock confirmation — non-destructive, data always stays intact
// ---------------------------------------------------------------------------

interface LockConfirmModalProps {
  department: Department;
  onCancel: () => void;
  onConfirm: () => void;
}

const LockConfirmModal: React.FC<LockConfirmModalProps> = ({ department, onCancel, onConfirm }) => {
  const willLock = !department.locked;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 shadow-2xl relative animate-scale-up">
        <div className="flex items-start gap-3 mb-4">
          <div className={`p-2.5 rounded-xl ${willLock ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {willLock ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="text-lg font-bold font-heading text-slate-900">
              {willLock ? `Lock ${department.name}?` : `Unlock ${department.name}?`}
            </h3>
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
              {willLock
                ? 'Locking this department will temporarily prevent its Department Head and users from accessing it. Data and records will remain intact.'
                : 'Unlocking this department restores access for its Department Head and users immediately.'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-100 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-5 py-2.5 rounded-xl text-white text-sm font-bold shadow-md active:scale-95 transition-all ${
              willLock ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {willLock ? 'Lock Department' : 'Unlock Department'}
          </button>
        </div>
      </div>
    </div>
  );
};
