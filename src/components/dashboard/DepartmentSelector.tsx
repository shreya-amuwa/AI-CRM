import React, { useState } from 'react';
import {
  Building2, ShoppingBag, MessageSquare, PhoneCall, Cpu, Layers, Sparkles, Star,
  ArrowRight, Plus, Lock, X, AlertTriangle, GraduationCap, Users, FileText,
  Trash2, DollarSign
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';
import { useTabs } from '../../context/TabContext';
import { Department } from '../../types/crm';
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

/**
 * The department cards: open a department's own panel, add or delete one (Super Admin). They live on the "Departments" page of the
 * Super Admin dashboard. There is no lock / unlock here: the Super Admin enters every department.
 */
export const DepartmentGrid: React.FC = () => {
  const { selectDepartment, user } = useAuth();
  const { departments, addDepartment, deleteDepartment } = useDepartments();
  const { openDepartment, tabs } = useTabs();
  const isSuperAdmin = user?.role === 'superadmin';
  const isAdminOrHR = user?.role === 'admin' || user?.role === 'hr';

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  };

  // Access is decided by the user's database profile: Super Admins may open
  // any department, department heads only their own. (No shared
  // department passwords - data inside is scoped by RLS regardless.)
  const handleEnter = (dept: Department) => {
    if (!selectDepartment(dept.id)) {
      showNotice(`You do not have access to ${dept.name}.`);
    }
  };

  const handleOpenInTab = (e: React.MouseEvent, dept: Department) => {
    e.stopPropagation();
    openDepartment(dept.id, dept.name);
  };

  return (
    <div>
      {/* Transient notice (no access / could not delete) */}
      {notice && (
        <div className="z-20 mb-2">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium shadow-sm animate-fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
        </div>
      )}

      {/* Department Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 flex-1 z-10">
        {departments.map(dept => {
          const Icon = getFallbackIcon(dept.iconName);
          const isCustom = !SEED_DEPARTMENTS.some(s => s.id === dept.id);

          return (
            <div
              key={dept.id}
              className={`${CARD_BASE} border-slate-200/90 hover:border-blue-500/80 hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1.5 shadow-slate-200/50 cursor-pointer`}
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
                    if (!window.confirm(`Delete ${dept.name}? This cannot be undone.`)) return;
                    void deleteDepartment(dept.id).then(r => !r.ok && showNotice(r.error || 'Could not delete department.'));
                  }}
                  title="Delete custom department"
                  aria-label={`Delete ${dept.name}`}
                  className="absolute top-4 left-4 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Lock icon indicator for Admin/HR users */}
              {isAdminOrHR && dept.id !== user?.departmentId && (
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
              </div>
            </div>
          );
        })}

        {/* Add Department card - always the final card in this grid, never
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

      {isAddOpen && (
        <AddDepartmentModal onClose={() => setIsAddOpen(false)} onCreate={addDepartment} />
      )}

    </div>
  );
};

// ---------------------------------------------------------------------------
// Add Department modal - opens in-place, never navigates away from this screen
// ---------------------------------------------------------------------------

interface AddDepartmentModalProps {
  onClose: () => void;
  onCreate: (input: { name: string; description: string; category?: string }) => Promise<{ ok: boolean; error?: string }>;
}

const AddDepartmentModal: React.FC<AddDepartmentModalProps> = ({ onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await onCreate({ name, description, category: category || undefined });
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
