import React, { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, ClipboardCheck, GitBranch, ShieldCheck, UserCheck, UserPlus, Users } from 'lucide-react';
import type { Profile } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';
import { creatableRoles } from '../../lib/auth/roleMapping';
import { AccessControlTab } from '../scope/AccessControlTab';
import { WorkflowSettings } from '../workflow/WorkflowSettings';
import { StaffManagementPanel } from './StaffManagementPanel';
import { DepartmentEmployeeDirectoryPanel } from '../employees/DepartmentEmployeeDirectory';
import { EmployeeRequestsPanel } from '../employees/EmployeeRequestsPanel';
import { OperationsHeadsAdminPanel } from '../employees/OperationsHeadsAdmin';

/**
 * Team Member Management: one full-screen page with three tabs, used by the Super Admin, Department Head and Team Lead dashboards.
 *
 *   Add Team Member   the account form (the roles offered follow the hierarchy: Super Admin -> Department Head, Team Lead, Team Member;
 *                     Department Head -> Team Lead, Team Member of their department; Team Lead -> Team Member of their team)
 *   Team Members      the directory of the people the signed-in user manages, with search, filters and the existing account actions
 *   Access Control    Super Admin only: the departments and functions each Department Head works in
 *
 * Which tabs appear follows the signed-in profile's real role, never the page that was opened. The tabs only decide what is shown: the API
 * and the database check every list, creation and access change again (creation: assert_can_create_user and the provisioning trigger;
 * the member list: Row Level Security on profiles; Access Control: department_access_get / department_access_apply refuse anyone but the
 * Super Admin), so a hand-typed URL or a direct API call gets nothing more.
 */
export type TeamMemberTab = 'add' | 'members' | 'access' | 'workflow' | 'approvals' | 'directory' | 'operations';

interface Props {
  /** The department whose people are managed. The Super Admin chooses it on the page; everybody else works in their own. */
  departmentSlug?: string;
  /** Sales / Support side of the dashboard: the default team for new members. */
  subDept?: 'sales' | 'support' | string | null;
  /** The tab to open first (e.g. 'add' from an "Add Team Member" button). Changing it switches tabs. */
  initialTab?: TeamMemberTab;
  /** Bumped by the parent to switch to initialTab again (e.g. the header button pressed twice). */
  openRequest?: number;
}

export const TeamMemberManagement: React.FC<Props> = ({ departmentSlug, subDept, initialTab, openRequest = 0 }) => {
  const { profile } = useAuth();
  const { departments } = useDepartments();
  const isSuperAdmin = profile?.role === 'SUPER_ADMIN';
  const canAdd = creatableRoles(profile?.role).length > 0;
  const isDepartmentHead = profile?.role === 'DEPARTMENT_HEAD';
  const isTeamLead = profile?.role === 'TEAM_HEAD';
  // Employee approvals: the Super Admin decides Operations Heads, a Department Head decides Team Leads and Team Members of their department.
  // The Department Head also puts approved Team Members under a Team Lead (a separate step from the approval).
  const tabs: TeamMemberTab[] = [
    ...(canAdd ? (['add'] as const) : []), 'members',
    ...(isSuperAdmin || isDepartmentHead ? (['approvals'] as const) : []),
    ...(isDepartmentHead ? (['directory'] as const) : []),
    ...(isSuperAdmin ? (['operations', 'access', 'workflow'] as const) : [])
  ];

  const firstTab = (wanted?: TeamMemberTab): TeamMemberTab => (wanted && tabs.includes(wanted) ? wanted : 'members');
  const [tab, setTab] = useState<TeamMemberTab>(() => firstTab(initialTab));
  const usable = departments.filter(d => d.dbId);
  const [slug, setSlug] = useState(departmentSlug || '');
  const [accessProfileId, setAccessProfileId] = useState<string | null>(null);
  const [accessDirty, setAccessDirty] = useState(false);
  // a new account or saved access: the directory reloads (an event, not polling)
  const [refreshToken, setRefreshToken] = useState(0);
  const [justAdded, setJustAdded] = useState<Profile | null>(null);

  // The Super Admin picks the department; everybody else always works in their own.
  useEffect(() => {
    if (!isSuperAdmin) setSlug(departmentSlug || profile?.department?.slug || '');
    else if (!slug && usable[0]) setSlug(departmentSlug || usable[0].id);
  }, [isSuperAdmin, departmentSlug, profile?.department?.slug, slug, usable]);

  const showTab = useCallback(
    (next: TeamMemberTab) => {
      if (next === tab || !tabs.includes(next)) return;
      if (tab === 'access' && accessDirty && !window.confirm('You have unsaved access changes. Leave this tab anyway? They will be lost.')) return;
      if (tab === 'access') setAccessDirty(false);
      setTab(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, accessDirty, tabs.join(',')]
  );

  // A parent button ("Add Team Member" in the header) asks for a tab.
  useEffect(() => {
    if (openRequest && initialTab) showTab(firstTab(initialTab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  // Leaving the page with unsaved access changes asks first (closing the tab or reloading).
  useEffect(() => {
    if (!accessDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [accessDirty]);

  if (!profile) return null;

  const meta: Record<TeamMemberTab, { label: string; icon: typeof Users; hint: string }> = {
    add: { label: 'Add Team Member', icon: UserPlus, hint: isTeamLead ? 'Add a team member to your team. The account is active at once: no approval is needed.' : 'Create an account. Only the roles you may create are offered.' },
    approvals: { label: 'Employee Approvals', icon: ClipboardCheck, hint: isSuperAdmin ? 'Operations Heads HR asked for. You decide them and choose the departments they manage.' : 'Team Leads and Team Members HR asked for in your department.' },
    directory: { label: 'Approved Employees', icon: UserCheck, hint: 'Put approved Team Members under a Team Lead.' },
    operations: { label: 'Operations Heads', icon: Building2, hint: 'The departments each Operations Head manages, and who approves the Department Heads of each.' },
    members: {
      label: 'Team Members',
      icon: Users,
      hint: isSuperAdmin
        ? 'Every person of the chosen department.'
        : profile.role === 'TEAM_HEAD'
          ? 'The people of your team.'
          : 'The people of your department.'
    },
    access: { label: 'Access Control', icon: ShieldCheck, hint: 'Choose a Department Head and tick the departments and functions they work in.' },
    workflow: { label: 'Workflow', icon: GitBranch, hint: 'Which services the Meta Verifier verifies first, and how long the Technical Consultant waits before the follow-up.' }
  };

  return (
    <div className="space-y-5 w-full" data-testid="team-member-management">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-slate-900">Team Member Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">{meta[tab].hint}</p>
        </div>
        {isSuperAdmin && tab !== 'access' && tab !== 'workflow' && tab !== 'approvals' && tab !== 'operations' && (
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700" htmlFor="add-staff-department">
            <span className="shrink-0">Department</span>
            <select
              id="add-staff-department"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-normal min-w-0 flex-1 lg:flex-none lg:min-w-[240px] cursor-pointer"
            >
              {usable.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div role="tablist" aria-label="Team Member Management" className="flex flex-wrap gap-1 p-1 rounded-2xl bg-slate-100 border border-slate-200 w-full sm:w-fit sm:max-w-full">
        {tabs.map(id => {
          const { label, icon: Icon } = meta[id];
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`staff-tab-${id}`}
              aria-selected={on}
              aria-controls={`staff-panel-${id}`}
              onClick={() => showTab(id)}
              data-testid={`tab-${id}`}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${
                on ? 'bg-white text-blue-700 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" /> {label}
            </button>
          );
        })}
      </div>

      {justAdded && tab === 'add' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900" role="status">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Team Member Added Successfully: {justAdded.fullName}.
          </span>
          <button type="button" onClick={() => showTab('members')} className="self-start sm:self-auto px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-xs font-bold text-emerald-800 hover:bg-emerald-100">
            View in Team Members
          </button>
        </div>
      )}

      {/* Add and Team Members stay mounted, so a half-filled form or a search is not lost when switching tabs. */}
      {canAdd && (
        <div role="tabpanel" id="staff-panel-add" aria-labelledby="staff-tab-add" hidden={tab !== 'add'}>
          {slug && (
            <StaffManagementPanel
              // one form for every department: choosing another department in the form (or at the top) keeps what was already typed
              key="add"
              departmentSlug={slug}
              subDept={subDept}
              view="add"
              departmentOptions={isSuperAdmin ? usable.map(d => ({ id: d.id, name: d.name })) : undefined}
              onDepartmentChange={isSuperAdmin ? setSlug : undefined}
              onCreated={p => {
                setJustAdded(p);
                setRefreshToken(t => t + 1);
              }}
            />
          )}
        </div>
      )}
      <div role="tabpanel" id="staff-panel-members" aria-labelledby="staff-tab-members" hidden={tab !== 'members'}>
        {slug && (
          <StaffManagementPanel
            key={`members-${slug}`}
            departmentSlug={slug}
            subDept={subDept}
            view="directory"
            refreshToken={refreshToken}
            onEditAccess={
              isSuperAdmin
                ? m => {
                    setAccessProfileId(m.id);
                    showTab('access');
                  }
                : undefined
            }
          />
        )}
      </div>
      {tabs.includes('approvals') && (
        <div role="tabpanel" id="staff-panel-approvals" aria-labelledby="staff-tab-approvals" hidden={tab !== 'approvals'}>
          {tab === 'approvals' && <EmployeeRequestsPanel view="approver" />}
        </div>
      )}
      {isDepartmentHead && (
        <div role="tabpanel" id="staff-panel-directory" aria-labelledby="staff-tab-directory" hidden={tab !== 'directory'}>
          {tab === 'directory' && <DepartmentEmployeeDirectoryPanel />}
        </div>
      )}
      {isSuperAdmin && (
        <div role="tabpanel" id="staff-panel-operations" aria-labelledby="staff-tab-operations" hidden={tab !== 'operations'}>
          {tab === 'operations' && <OperationsHeadsAdminPanel />}
        </div>
      )}
      {isSuperAdmin && (
        <div role="tabpanel" id="staff-panel-workflow" aria-labelledby="staff-tab-workflow" hidden={tab !== 'workflow'}>
          {tab === 'workflow' && <WorkflowSettings />}
        </div>
      )}
      {isSuperAdmin && (
        <div role="tabpanel" id="staff-panel-access" aria-labelledby="staff-tab-access" hidden={tab !== 'access'}>
          {tab === 'access' && (
            <AccessControlTab initialProfileId={accessProfileId} onDirtyChange={setAccessDirty} onSaved={() => setRefreshToken(t => t + 1)} />
          )}
        </div>
      )}
    </div>
  );
};
