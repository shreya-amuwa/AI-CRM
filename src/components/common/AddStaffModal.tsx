import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useDepartments } from '../../context/DepartmentContext';
import { StaffManagementPanel } from './StaffManagementPanel';

/**
 * Super Admin: create a Department Head, Team Lead, Team Member or Technical
 * Consultant for any department from the main dashboard. Pick the department,
 * then use the same "Add Team Member" form as inside the department panel
 * (its Role dropdown lists every role the Super Admin may create).
 */
export const AddStaffModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { departments } = useDepartments();
  const usable = departments.filter(d => d.dbId);
  const [slug, setSlug] = useState('');

  useEffect(() => {
    if (!slug && usable[0]) setSlug(usable[0].id);
  }, [slug, usable]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/50 flex items-start justify-center p-4 overflow-y-auto"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="add-staff-title" className="w-full max-w-6xl my-6 bg-slate-50 rounded-3xl shadow-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 id="add-staff-title" className="text-lg font-bold text-slate-900">Add Team Member</h2>
            <p className="text-xs text-slate-500">Choose the department, then the role: Department Head, Team Lead, Team Member or Technical Consultant.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-700" htmlFor="add-staff-department">
              Department
            </label>
            <select
              id="add-staff-department"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm min-w-[220px]"
            >
              {usable.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:bg-slate-200" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        {slug && <StaffManagementPanel key={slug} departmentSlug={slug} />}
      </div>
    </div>
  );
};
