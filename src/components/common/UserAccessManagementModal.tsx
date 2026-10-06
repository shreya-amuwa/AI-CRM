import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  UserX,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  Building2,
  Trash2,
  RotateCcw,
  X,
  Lock,
  Headphones,
  TrendingUp,
  UserMinus,
  Sparkles
} from 'lucide-react';
import type { ApprovalRequest, Profile, Team } from '../../../shared/contracts';
import { approvalsApi, organizationApi, usersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { APPROVALS_CHANGED_EVENT } from '../../hooks/usePendingApprovalsCount';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';

interface UserAccessManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'pending' | 'active' | 'revoked';
}

/** View model rendered by this modal, built from API data. */
interface StaffRow {
  id: string;
  requestId?: string;
  name: string;
  email: string;
  departmentId: string; // slug, used by the department filter
  departmentName: string;
  teamId: string | null;
  subDepartment: string;
  position: string;
  status: string;
  registeredAt: string;
  approvedBy?: string;
  revokeReason?: string | null;
  revokedBy?: string;
  revokedAt?: string;
}

const LIST_LIMIT = 100;

export const UserAccessManagementModal: React.FC<UserAccessManagementModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'pending'
}) => {
  const { user, profile } = useAuth();
  const { departments } = useDepartments();

  const [activeTab, setActiveTab] = useState<'pending' | 'active' | 'revoked'>(initialTab);
  const [pendingRows, setPendingRows] = useState<StaffRow[]>([]);
  const [activeRows, setActiveRows] = useState<StaffRow[]>([]);
  const [revokedRows, setRevokedRows] = useState<StaffRow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamChoice, setTeamChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('all');

  // Revoke Access dialog state
  const [revokingUser, setRevokingUser] = useState<StaffRow | null>(null);
  const [revokeReason, setRevokeReason] = useState('Employee left organization');
  const [customRevokeReason, setCustomRevokeReason] = useState('');

  // Toast / Status banner
  const [actionNotice, setActionNotice] = useState<{ text: string; type: 'success' | 'danger' } | null>(null);

  const notify = (text: string, type: 'success' | 'danger') => {
    setActionNotice({ text, type });
    setTimeout(() => setActionNotice(null), 5000);
  };

  const deptBySlugOrId = (id: string | null | undefined) => departments.find(d => d.dbId === id || d.id === id);

  const fromProfile = (p: Profile): StaffRow => ({
    id: p.id,
    name: p.fullName,
    email: p.email,
    departmentId: p.department?.slug || '',
    departmentName: p.department?.name || 'Unassigned',
    teamId: p.teamId,
    subDepartment: (p.team?.division || 'general').toLowerCase(),
    position: p.position || p.role.replace('_', ' ').toLowerCase(),
    status: p.status,
    registeredAt: p.createdAt,
    approvedBy: p.approvedAt ? new Date(p.approvedAt).toLocaleDateString() : undefined,
    revokeReason: p.statusReason
  });

  const fromRequest = (r: ApprovalRequest, teamList: Team[]): StaffRow => {
    const dept = deptBySlugOrId(r.departmentId);
    const team = teamList.find(t => t.id === r.teamId);
    return {
      id: r.subject?.id || r.id,
      requestId: r.id,
      name: r.subject?.fullName || 'Unknown user',
      email: r.subject?.email || '',
      departmentId: dept?.id || '',
      departmentName: dept?.name || 'No department selected',
      teamId: r.teamId,
      subDepartment: (team?.division || 'general').toLowerCase(),
      position: team ? `${team.name} team` : 'Team not selected',
      status: 'PENDING_APPROVAL',
      registeredAt: r.createdAt
    };
  };

  // Load everything from the API (RLS limits results to the caller's hierarchy)
  const refreshUsers = async () => {
    try {
      const [teamList, pending, active, revoked, suspended, rejected] = await Promise.all([
        organizationApi.teams(),
        approvalsApi.list({ status: 'PENDING', pageSize: LIST_LIMIT }),
        usersApi.list({ status: 'ACTIVE', pageSize: LIST_LIMIT }),
        usersApi.list({ status: 'REVOKED', pageSize: LIST_LIMIT }),
        usersApi.list({ status: 'SUSPENDED', pageSize: LIST_LIMIT }),
        usersApi.list({ status: 'REJECTED', pageSize: LIST_LIMIT })
      ]);
      setTeams(teamList);
      setPendingRows(pending.items.map(r => fromRequest(r, teamList)));
      setActiveRows(active.items.filter(p => p.id !== profile?.id).map(fromProfile));
      setRevokedRows([...revoked.items, ...suspended.items, ...rejected.items].map(fromProfile));
    } catch (err) {
      notify(errorMessage(err), 'danger');
    }
  };

  useEffect(() => {
    if (isOpen) void refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, departments.length]);

  if (!isOpen) return null;

  const isSuperAdmin = user?.role === 'superadmin';
  const currentApproverRole = (profile?.role || '').replace('_', ' ');

  const matches = (u: StaffRow) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.departmentName.toLowerCase().includes(q) ||
      u.position.toLowerCase().includes(q);
    return matchesSearch && (selectedDeptFilter === 'all' || u.departmentId === selectedDeptFilter);
  };

  const pendingList = pendingRows.filter(matches);
  const activeList = activeRows.filter(matches);
  const revokedList = revokedRows.filter(matches);

  const allPendingTotal = pendingRows.length;
  const allActiveTotal = activeRows.length;
  const allRevokedTotal = revokedRows.length;

  /** Run a server action, then reload from the database (the UI never assumes success). */
  const run = async (action: () => Promise<unknown>, success: string, type: 'success' | 'danger' = 'success') => {
    setBusy(true);
    try {
      await action();
      notify(success, type);
      window.dispatchEvent(new CustomEvent(APPROVALS_CHANGED_EVENT));
      await refreshUsers();
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Actions
  const handleApprove = (u: StaffRow) => {
    if (!u.requestId || busy) return;
    const teamId = u.teamId || teamChoice[u.requestId];
    if (!teamId) {
      notify(`Select a team for ${u.name} before approving.`, 'danger');
      return;
    }
    void run(
      () => approvalsApi.approve(u.requestId!, { teamId }),
      `✓ Authorized & Activated account for ${u.name} (${u.departmentName}). They can now sign in.`
    );
  };

  const handleReject = (u: StaffRow) => {
    if (!u.requestId || busy) return;
    if (window.confirm(`Are you sure you want to decline registration for ${u.name} (${u.email})?`)) {
      void run(() => approvalsApi.reject(u.requestId!), `Declined registration for ${u.name}.`, 'danger');
    }
  };

  const handleConfirmRevoke = () => {
    if (!revokingUser || busy) return;
    const target = revokingUser;
    const finalReason = revokeReason === 'Other' ? customRevokeReason.trim() || 'Separation / Security policy' : revokeReason;
    setRevokingUser(null);
    setCustomRevokeReason('');
    void run(
      () => usersApi.setStatus(target.id, 'REVOKED', finalReason),
      `🚫 Access REVOKED for ${target.name}. Their access to CRM data is blocked immediately.`,
      'danger'
    );
  };

  const handleRestoreAccess = (u: StaffRow) => {
    if (busy) return;
    if (u.status === 'REJECTED') {
      notify('Declined registrations cannot be restored; ask the person to contact their manager.', 'danger');
      return;
    }
    void run(() => usersApi.setStatus(u.id, 'ACTIVE'), `✓ System access restored for ${u.name}.`);
  };

  const handleDeletePermanent = (u: StaffRow) => {
    if (!isSuperAdmin) {
      notify('Only a Super Admin can permanently delete users.', 'danger');
      return;
    }
    if (window.confirm(`Permanently remove record for ${u.name}? This cannot be undone.`)) {
      void run(() => usersApi.remove(u.id), `Removed ${u.name}.`, 'danger');
    }
  };

  /** Team picker shown for pending requests that arrived without a team. */
  const renderTeamPicker = (u: StaffRow) => {
    if (u.teamId || !u.requestId) return null;
    const dept = departments.find(d => d.id === u.departmentId);
    const options = teams.filter(t => !dept || t.departmentId === dept.dbId);
    return (
      <select
        value={teamChoice[u.requestId] || ''}
        onChange={e => setTeamChoice(prev => ({ ...prev, [u.requestId!]: e.target.value }))}
        className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700"
        aria-label={`Team for ${u.name}`}
      >
        <option value="">Select team…</option>
        {options.map(t => (
          <option key={t.id} value={t.id}>
            {(departments.find(d => d.dbId === t.departmentId)?.name || '') + ' · ' + t.name}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fade-in font-sans">
      <div className="w-full max-w-4xl bg-white border border-slate-200/90 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-start justify-between bg-gradient-to-r from-slate-50 via-white to-slate-50">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold font-heading text-slate-900">
                  Staff Access & Approvals Control
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-blue-50 text-blue-700 border border-blue-200">
                  {currentApproverRole}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Authorize pending registrations & restrict access for offboarded employees to protect customer records.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Notice Alert */}
        {actionNotice && (
          <div
            className={`px-5 py-3 text-xs font-semibold flex items-center justify-between border-b ${
              actionNotice.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {actionNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{actionNotice.text}</span>
            </div>
            <button onClick={() => setActionNotice(null)} className="text-xs opacity-70 hover:opacity-100">
              Dismiss
            </button>
          </div>
        )}

        {/* Filter Controls & Tab Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-white space-y-3.5">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            
            {/* Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-2xl border border-slate-200/60 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setActiveTab('pending')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  activeTab === 'pending'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Pending Approvals</span>
                {allPendingTotal > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white animate-pulse">
                    {allPendingTotal}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('active')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  activeTab === 'active'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Active Staff</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                  {allActiveTotal}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('revoked')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  activeTab === 'revoked'
                    ? 'bg-white text-rose-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserX className="w-3.5 h-3.5" />
                <span>Revoked / Inactive</span>
                {allRevokedTotal > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                    {allRevokedTotal}
                  </span>
                )}
              </button>
            </div>

            {/* Department Filter & Search */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search staff or email..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 w-44 sm:w-56"
                />
              </div>

              <select
                value={selectedDeptFilter}
                onChange={e => setSelectedDeptFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-indigo-500 font-mono"
              >
                <option value="all">All Departments</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 bg-slate-50/50">

          {/* TAB 1: PENDING APPROVALS */}
          {activeTab === 'pending' && (
            <div className="space-y-3">
              {pendingList.length === 0 ? (
                <div className="text-center py-12 px-4 rounded-2xl bg-white border border-dashed border-slate-200">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">All Registration Requests Handled</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                    There are currently no new registration requests awaiting authorization. Any new registrations from outside or employees will appear here.
                  </p>
                </div>
              ) : (
                pendingList.map(item => (
                  <div
                    key={item.id}
                    className="p-4 sm:p-5 rounded-2xl bg-white border border-amber-200/80 shadow-xs hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-400 text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-xs">
                        {item.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-900">{item.name}</span>
                          <span className="text-xs text-slate-500 font-mono">({item.email})</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            Awaiting Authorization
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap">
                          <span className="flex items-center gap-1 font-semibold text-slate-800">
                            <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                            {item.departmentName}
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="flex items-center gap-1">
                            {item.subDepartment === 'support' ? (
                              <Headphones className="w-3.5 h-3.5 text-rose-500" />
                            ) : (
                              <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
                            )}
                            <strong className="capitalize">{item.subDepartment} Division</strong> ({item.position})
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            Registered: {new Date(item.registeredAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      {renderTeamPicker(item)}
                      <button
                        type="button"
                        onClick={() => handleReject(item)}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Decline</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(item)}
                        className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 active:scale-95"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Authorize & Activate</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 2: ACTIVE STAFF */}
          {activeTab === 'active' && (
            <div className="space-y-3">
              <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-2xl flex items-center justify-between text-xs text-blue-900">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    <strong>Organizational Offboarding Control:</strong> If an employee leaves the company, click <strong>"Revoke Access"</strong> to immediately lock their session and protect sensitive customer records.
                  </span>
                </div>
              </div>

              {activeList.map(item => (
                <div
                  key={item.id}
                  className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-xs">
                      {item.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900">{item.name}</span>
                        <span className="text-xs text-slate-500 font-mono">({item.email})</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Authorized & Active
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap">
                        <span className="flex items-center gap-1 font-semibold text-slate-800">
                          <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                          {item.departmentName}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="capitalize">{item.subDepartment} Division</span> ({item.position})
                        {item.approvedBy && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-400 text-[11px]">Approved by: {item.approvedBy}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => setRevokingUser(item)}
                      className="px-3.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs"
                      title="Restrict login access for separated employee"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                      <span>Revoke Access</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: REVOKED / INACTIVE */}
          {activeTab === 'revoked' && (
            <div className="space-y-3">
              {revokedList.length === 0 ? (
                <div className="text-center py-12 px-4 rounded-2xl bg-white border border-dashed border-slate-200">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">No Revoked User Accounts</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                    All authorized staff have active system access. Separated employees whose credentials have been revoked will be listed here.
                  </p>
                </div>
              ) : (
                revokedList.map(item => (
                  <div
                    key={item.id}
                    className="p-4 sm:p-5 rounded-2xl bg-white border border-rose-200/70 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-slate-200 text-slate-600 font-bold text-sm flex items-center justify-center shrink-0">
                        {item.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-900">{item.name}</span>
                          <span className="text-xs text-slate-500 font-mono">({item.email})</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" />
                            Access Blocked
                          </span>
                        </div>
                        <div className="text-xs text-slate-600">
                          <span>{item.departmentName} &bull; {item.position}</span>
                          <p className="text-rose-700 text-xs mt-1 font-mono">
                            Reason: {item.revokeReason || 'Separation / Security Policy'}
                          </p>
                          {item.revokedBy && (
                            <p className="text-slate-400 text-[11px] mt-0.5">
                              Revoked by: {item.revokedBy} ({item.revokedAt ? new Date(item.revokedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''})
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRestoreAccess(item)}
                        className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restore Access</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePermanent(item)}
                        className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition-colors"
                        title="Delete permanently"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-100 bg-white flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Multi-Department Security Protocol: Access gatekeeping active.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
          >
            Close
          </button>
        </div>

      </div>

      {/* CONFIRM REVOCATION SUB-MODAL */}
      {revokingUser && (
        <div className="fixed inset-0 z-60 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Revoke User Access</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Immediately terminate credentials and system access for <strong>{revokingUser.name}</strong> ({revokingUser.email}).
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 uppercase font-mono">
                Reason for Revocation
              </label>
              <select
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-rose-500 font-sans"
              >
                <option value="Employee left organization">Employee left organization (Offboarded)</option>
                <option value="Department transfer / Role change">Department transfer / Role change</option>
                <option value="Security policy violation">Security policy violation</option>
                <option value="Temporary leave / Access suspension">Temporary leave / Access suspension</option>
                <option value="Other">Other (Specify below)</option>
              </select>

              {revokeReason === 'Other' && (
                <input
                  type="text"
                  placeholder="Specify separation / revocation reason..."
                  value={customRevokeReason}
                  onChange={e => setCustomRevokeReason(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-rose-500"
                />
              )}
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-[11px] text-rose-800 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                Customer Data Security Guard
              </p>
              <p>
                Once revoked, the user will be immediately blocked from signing in. All sensitive customer leads, invoices, and organization chats will be unreachable.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRevokingUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRevoke}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-xs"
              >
                Confirm Revoke Access
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
