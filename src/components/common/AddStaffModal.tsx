import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Users, X } from 'lucide-react';
import { useDepartments } from '../../context/DepartmentContext';
import { StaffManagementPanel } from './StaffManagementPanel';
import { AccessControlTab } from '../scope/AccessControlTab';

/**
 * Super Admin: create staff and manage who works where, from the main dashboard. Two tabs:
 *   Team Members     create a Department Head, Team Lead, Team Member or Technical Consultant, and list / manage the members of a department
 *   Access Control   pick an existing Department Head and tick the departments and functions (Sales / Support) they work in
 * The department list in the header only chooses whose members are listed.
 */
type Tab = 'members' | 'access';

export const AddStaffModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { departments } = useDepartments();
  const usable = departments.filter(d => d.dbId);
  const [slug, setSlug] = useState('');
  const [tab, setTab] = useState<Tab>('members');
  const [accessProfileId, setAccessProfileId] = useState<string | null>(null);
  const [accessDirty, setAccessDirty] = useState(false);
  // Access saved on the other tab: the member lists reload (an event, not polling).
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!slug && usable[0]) setSlug(usable[0].id);
  }, [slug, usable]);

  const close = useCallback(() => {
    if (accessDirty && !window.confirm('You have unsaved access changes. Close anyway? They will be lost.')) return;
    onClose();
  }, [accessDirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const showTab = (next: Tab) => {
    if (next === tab) return;
    if (tab === 'access' && accessDirty && !window.confirm('You have unsaved access changes. Leave this tab anyway? They will be lost.')) return;
    if (tab === 'access') setAccessDirty(false);
    setTab(next);
  };

  const tabButton = (id: Tab, label: string, Icon: typeof Users) => (
    <button
      type="button"
      role="tab"
      id={`staff-tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`staff-panel-${id}`}
      onClick={() => showTab(id)}
      className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition ${
        tab === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
      data-testid={`tab-${id}`}
    >
      <Icon className="w-4 h-4" aria-hidden="true" /> {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/50 flex items-start justify-center p-4 overflow-y-auto"
      onMouseDown={e => e.target === e.currentTarget && close()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="add-staff-title" className="w-full max-w-6xl my-6 bg-slate-50 rounded-3xl shadow-2xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 id="add-staff-title" className="text-lg font-bold text-slate-900">Team Members &amp; Access</h2>
            <p className="text-xs text-slate-500">
              {tab === 'members'
                ? 'Create accounts and manage members. A Department Head’s own departments are chosen in the form; the list on the right only chooses whose members are shown.'
                : 'Choose an existing Department Head and tick the departments and functions they work in.'}
            </p>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            {tab === 'members' && (
              <>
                <label className="text-xs font-semibold text-slate-700 shrink-0" htmlFor="add-staff-department">
                  Show members of
                </label>
                <select
                  id="add-staff-department"
                  value={slug}
                  onChange={e => setSlug(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm min-w-0 flex-1 sm:flex-none sm:min-w-[220px]"
                >
                  {usable.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button type="button" onClick={close} className="p-2 rounded-xl text-slate-500 hover:bg-slate-200" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div role="tablist" aria-label="Team Members and Access Control" className="flex gap-2">
          {tabButton('members', 'Team Members', Users)}
          {tabButton('access', 'Access Control', ShieldCheck)}
        </div>

        {/* both tabs stay mounted, so a half-filled account form is not lost when looking at Access Control */}
        <div role="tabpanel" id="staff-panel-members" aria-labelledby="staff-tab-members" hidden={tab !== 'members'}>
          {slug && (
            <StaffManagementPanel
              key={slug}
              departmentSlug={slug}
              refreshToken={refreshToken}
              onEditAccess={m => {
                setAccessProfileId(m.id);
                setTab('access');
              }}
            />
          )}
        </div>
        <div role="tabpanel" id="staff-panel-access" aria-labelledby="staff-tab-access" hidden={tab !== 'access'}>
          {tab === 'access' && (
            <AccessControlTab
              initialProfileId={accessProfileId}
              onDirtyChange={setAccessDirty}
              onSaved={() => setRefreshToken(t => t + 1)}
            />
          )}
        </div>
      </div>
    </div>
  );
};
