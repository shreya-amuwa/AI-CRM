import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserPlus, Users, Eye, EyeOff, CheckCircle2, AlertTriangle, ShieldCheck, Copy,
  RefreshCw, Ban, PauseCircle, PlayCircle, LayoutDashboard, KeyRound, ArrowUpCircle, Trash2, ChevronLeft, ChevronRight
} from 'lucide-react';
import type { Profile, Role, Team, TeamDivision } from '../../../shared/contracts';
import { userCreateSchema } from '../../../shared/validation';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';
import { organizationApi, usersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import {
  ROLE_LABELS, TECHNICAL_CONSULTANT_LABEL, creatableRoles, defaultDashboardLabel, isTechnicalConsultant, staffRoleLabel
} from '../../lib/auth/roleMapping';

/**
 * Team Members & Access - create staff accounts and manage their access.
 *
 * Who can create whom follows the hierarchy:
 *   Super Admin      → Department Head, Team Lead, Team Member
 *   Department Head  → Team Lead, Team Member (own department)
 *   Team Lead        → Team Member (own team)
 * Promotion follows the same chain: the Department Head makes a Team Member a
 * Team Lead; only the Super Admin makes a Team Lead a Department Head.
 * The UI only offers allowed roles; the API and database enforce the same
 * rules independently (POST /api/v1/users → assert_can_create_user + the
 * provisioning trigger), so a manipulated request is still rejected.
 *
 * New members are placed in the team of the current sub-department (e.g.
 * Wabastore → Support), which also decides their default dashboard.
 */
interface StaffManagementPanelProps {
  /** Department slug, e.g. 'wabastore'. */
  departmentSlug: string;
  /** Current sub-department; picks the default team for new members. */
  subDept?: 'sales' | 'support' | string | null;
}

type StaffRole = Exclude<Role, 'SUPER_ADMIN'>;
/** Technical Consultant is a team member of a support team with its own dashboard. */
type StaffChoice = StaffRole | 'TECHNICAL_CONSULTANT';

const DIVISION_BY_SUBDEPT: Record<string, TeamDivision> = { sales: 'SALES', support: 'SUPPORT' };

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SUSPENDED: 'bg-orange-50 text-orange-700 border-orange-200',
  REVOKED: 'bg-rose-50 text-rose-700 border-rose-200',
  REJECTED: 'bg-slate-100 text-slate-600 border-slate-200'
};

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export const StaffManagementPanel: React.FC<StaffManagementPanelProps> = ({ departmentSlug, subDept }) => {
  const { profile } = useAuth();
  const { departments } = useDepartments();
  const department = departments.find(d => d.id === departmentSlug);
  const departmentId = department?.dbId || (profile?.department?.slug === departmentSlug ? profile.departmentId || undefined : undefined);
  const division = subDept ? DIVISION_BY_SUBDEPT[subDept] : undefined;

  const allowedRoles = useMemo(() => creatableRoles(profile?.role), [profile?.role]);
  const isTeamLead = profile?.role === 'TEAM_HEAD';

  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [scope, setScope] = useState<'subdept' | 'department'>('subdept');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Create form
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [position, setPosition] = useState('');
  const [choice, setChoice] = useState<StaffChoice>('TEAM_MEMBER');
  const [teamId, setTeamId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ profile: Profile; dashboard: string } | null>(null);
  const [actionNotice, setActionNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [confirmBox, setConfirmBox] = useState<ConfirmRequest | null>(null);
  const [existingHead, setExistingHead] = useState<Profile | null>(null);
  const ask = (req: ConfirmRequest) => setConfirmBox(req);

  /** The team that matches the current sub-department (e.g. Support). */
  const defaultTeam = useMemo<Team | undefined>(() => {
    if (isTeamLead) return teams.find(t => t.id === profile?.teamId);
    return (division && teams.find(t => t.division === division)) || (teams.length === 1 ? teams[0] : undefined);
  }, [teams, division, isTeamLead, profile?.teamId]);

  useEffect(() => {
    if (defaultTeam) setTeamId(defaultTeam.id);
  }, [defaultTeam]);

  const supportTeams = useMemo(() => teams.filter(t => t.division === 'SUPPORT'), [teams]);
  // Offered next to Team Lead / Team Member wherever a support team can be picked.
  const canCreateConsultant = allowedRoles.includes('TEAM_MEMBER') && supportTeams.length > 0 && (!division || division === 'SUPPORT');
  const choices = useMemo<StaffChoice[]>(
    () => (canCreateConsultant ? [...allowedRoles, 'TECHNICAL_CONSULTANT'] : allowedRoles),
    [canCreateConsultant, allowedRoles]
  );
  const consultant = choice === 'TECHNICAL_CONSULTANT';
  const role: StaffRole = consultant ? 'TEAM_MEMBER' : choice;

  useEffect(() => {
    if (!choices.includes(choice) && allowedRoles.length) setChoice(allowedRoles[allowedRoles.length - 1]);
  }, [choices, allowedRoles, choice]);

  // A Technical Consultant always belongs to a support team.
  useEffect(() => {
    if (consultant && !supportTeams.some(t => t.id === teamId) && supportTeams[0]) setTeamId(supportTeams[0].id);
  }, [consultant, supportTeams, teamId]);

  const loadMembers = useCallback(async () => {
    if (!departmentId) return;
    setLoading(true);
    setListError(null);
    try {
      const listTeamId = isTeamLead ? profile?.teamId || undefined : scope === 'subdept' ? defaultTeam?.id : undefined;
      const result = await usersApi.list({ departmentId, teamId: listTeamId, page, pageSize: MEMBERS_PAGE_SIZE });
      setMembers(result.items.filter(m => m.id !== profile?.id));
      setTotal(result.total);
    } catch (err) {
      setListError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [departmentId, scope, defaultTeam?.id, isTeamLead, profile?.teamId, profile?.id, page]);

  // Back to page 1 when the list changes scope.
  useEffect(() => setPage(1), [scope, departmentId]);

  // One Department Head per department: warn before trying to create a second.
  useEffect(() => {
    if (!departmentId || !allowedRoles.includes('DEPARTMENT_HEAD')) return setExistingHead(null);
    usersApi
      .list({ departmentId, role: 'DEPARTMENT_HEAD', pageSize: 5 })
      .then(r => setExistingHead(r.items.find(p => p.status !== 'REVOKED' && p.status !== 'REJECTED') || null), () => setExistingHead(null));
  }, [departmentId, allowedRoles, created]);

  useEffect(() => {
    if (!departmentId) return;
    organizationApi.teams(departmentId).then(setTeams).catch(err => setListError(errorMessage(err)));
  }, [departmentId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  if (!profile || allowedRoles.length === 0) {
    return (
      <div className="p-6 rounded-2xl bg-white border border-slate-200 text-sm text-slate-600 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-slate-400" />
        You do not have permission to manage team members.
      </div>
    );
  }

  const selectedTeam = teams.find(t => t.id === teamId);
  const needsTeam = role !== 'DEPARTMENT_HEAD';
  const subDeptLabel = selectedTeam ? `${department?.name || ''} · ${selectedTeam.name}` : department?.name || departmentSlug;

  const resetForm = () => {
    setFullName('');
    setEmail('');
    setPassword('');
    setPosition('');
    setShowPassword(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreated(null);
    const parsed = userCreateSchema.safeParse({
      email,
      fullName,
      password,
      role,
      departmentId: role === 'DEPARTMENT_HEAD' ? departmentId : undefined,
      teamId: needsTeam ? teamId || undefined : undefined,
      position: position || undefined,
      technicalConsultant: consultant || undefined
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || 'Please check the form.');
      return;
    }
    setSaving(true);
    try {
      const newProfile = await usersApi.create(parsed.data);
      setCreated({
        profile: newProfile,
        dashboard: defaultDashboardLabel(newProfile.role, newProfile.team?.division, newProfile.department?.name, isTechnicalConsultant(newProfile))
      });
      resetForm();
      await loadMembers();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleConsultant = async (member: Profile) => {
    const value = !isTechnicalConsultant(member);
    setActionNotice(null);
    try {
      await usersApi.setTechnicalConsultant(member.id, value);
      setActionNotice({ text: `${member.fullName} is now a ${value ? TECHNICAL_CONSULTANT_LABEL : ROLE_LABELS.TEAM_MEMBER}.`, ok: true });
      await loadMembers();
    } catch (err) {
      setActionNotice({ text: errorMessage(err), ok: false });
    }
  };

  /**
   * Promotion. A Department Head (or Super Admin) makes a Team Member a Team Lead
   * of their current team; only the Super Admin makes a Team Lead a Department Head.
   * The server re-checks the hierarchy (PATCH /users/:id → assign_user).
   */
  const promote = async (member: Profile, to: 'TEAM_HEAD' | 'DEPARTMENT_HEAD') => {
    const label = to === 'TEAM_HEAD' ? 'Team Lead' : 'Department Head';
    ask({
      title: `Make ${member.fullName} a ${label}?`,
      message: 'Their dashboard and access change to match.',
      confirmLabel: `Make ${label}`,
      run: () => doPromote(member, to, label)
    });
  };
  const doPromote = async (member: Profile, to: 'TEAM_HEAD' | 'DEPARTMENT_HEAD', label: string) => {
    setActionNotice(null);
    try {
      if (to === 'TEAM_HEAD' && isTechnicalConsultant(member)) await usersApi.setTechnicalConsultant(member.id, false);
      await usersApi.assign(
        member.id,
        to === 'TEAM_HEAD'
          ? { role: 'TEAM_HEAD', teamId: member.teamId || undefined }
          : { role: 'DEPARTMENT_HEAD', departmentId: member.departmentId || undefined }
      );
      setActionNotice({ text: `${member.fullName} is now a ${label}.`, ok: true });
      await loadMembers();
    } catch (err) {
      setActionNotice({ text: errorMessage(err), ok: false });
    }
    setTimeout(() => setActionNotice(null), 6000);
  };

  const changeStatus = (member: Profile, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED') => {
    if (status === 'ACTIVE') return void doChangeStatus(member, status);
    ask({
      title: status === 'SUSPENDED' ? `Suspend ${member.fullName}?` : `Revoke access for ${member.fullName}?`,
      message:
        status === 'SUSPENDED'
          ? 'They are signed out and cannot use the CRM until you restore access.'
          : 'They lose access to the CRM. You can restore it later.',
      confirmLabel: status === 'SUSPENDED' ? 'Suspend' : 'Revoke access',
      danger: true,
      run: () => doChangeStatus(member, status)
    });
  };

  const removeMember = (member: Profile) =>
    ask({
      title: `Remove ${member.fullName}?`,
      message:
        'Their login is deleted permanently and cannot be restored. Customers they own move to their Team Lead. To pause access instead, use Suspend.',
      confirmLabel: 'Remove employee',
      danger: true,
      run: async () => {
        setActionNotice(null);
        try {
          await usersApi.remove(member.id);
          setActionNotice({ text: `${member.fullName} was removed.`, ok: true });
          if (members.length === 1 && page > 1) setPage(p => p - 1);
          else await loadMembers();
        } catch (err) {
          setActionNotice({ text: errorMessage(err), ok: false });
        }
        setTimeout(() => setActionNotice(null), 6000);
      }
    });

  const doChangeStatus = async (member: Profile, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED') => {
    try {
      await usersApi.setStatus(member.id, status, status === 'ACTIVE' ? undefined : `Changed by ${profile.fullName}`);
      setActionNotice({ text: `${member.fullName}: access ${status === 'ACTIVE' ? 'restored' : status.toLowerCase()}.`, ok: true });
      await loadMembers();
    } catch (err) {
      setActionNotice({ text: errorMessage(err), ok: false });
    }
    setTimeout(() => setActionNotice(null), 5000);
  };

  const inputClass =
    'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-3.5 rounded-2xl bg-indigo-50 text-indigo-700 border border-indigo-100">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-heading text-slate-900">Team Members & Access</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {subDeptLabel} &bull; signed in as <strong>{ROLE_LABELS[profile.role]}</strong> - you can create:{' '}
              {choices.map(r => (r === 'TECHNICAL_CONSULTANT' ? TECHNICAL_CONSULTANT_LABEL : ROLE_LABELS[r])).join(', ')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadMembers()}
          className="self-start sm:self-center px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Create member form */}
        <form onSubmit={handleCreate} className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <UserPlus className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">Add Team Member</h3>
          </div>

          {formError && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{formError}</span>
            </div>
          )}

          {created && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-4 h-4" /> {created.profile.fullName} can now sign in
              </div>
              <div>
                Login: <span className="font-mono">{created.profile.email}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(created.profile.email)}
                  className="ml-1.5 inline-flex items-center text-emerald-700 hover:underline"
                  title="Copy login e-mail"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <LayoutDashboard className="w-3.5 h-3.5" /> Default dashboard: <strong>{created.dashboard}</strong>
              </div>
              <div className="text-emerald-700">Share the password securely; they can change it after signing in.</div>
            </div>
          )}

          <label className="block text-xs font-semibold text-slate-700">
            Username (full name) *
            <input className={`${inputClass} mt-1`} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Kunal Sharma" required />
          </label>

          <label className="block text-xs font-semibold text-slate-700">
            Email (used to sign in) *
            <input type="email" className={`${inputClass} mt-1`} value={email} onChange={e => setEmail(e.target.value)} placeholder="kunal@amuwa.com" required />
          </label>

          <label className="block text-xs font-semibold text-slate-700">
            Password *
            <div className="relative mt-1">
              <input
                type={showPassword ? 'text' : 'password'}
                className={`${inputClass} pr-20 font-mono`}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="min. 10 characters"
                autoComplete="new-password"
                required
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button type="button" title="Generate strong password" onClick={() => { setPassword(generatePassword()); setShowPassword(true); }} className="p-1 text-slate-400 hover:text-blue-600">
                  <KeyRound className="w-4 h-4" />
                </button>
                <button type="button" title={showPassword ? 'Hide' : 'Show'} onClick={() => setShowPassword(s => !s)} className="p-1 text-slate-400 hover:text-slate-700">
                  {showPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </label>

          <label className="block text-xs font-semibold text-slate-700">
            Role *
            <select
              id="staff-role"
              className={`${inputClass} mt-1 cursor-pointer`}
              value={choice}
              onChange={e => setChoice(e.target.value as StaffChoice)}
            >
              {choices.map(r => (
                <option key={r} value={r}>{r === 'TECHNICAL_CONSULTANT' ? TECHNICAL_CONSULTANT_LABEL : ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>

          {needsTeam && (
            <label className="block text-xs font-semibold text-slate-700">
              Sub-department / Team *
              <select
                className={`${inputClass} mt-1 cursor-pointer disabled:opacity-70`}
                value={teamId}
                onChange={e => setTeamId(e.target.value)}
                disabled={isTeamLead}
              >
                <option value="">Select team…</option>
                {(consultant ? supportTeams : teams).map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.division.toLowerCase()})</option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-xs font-semibold text-slate-700">
            Position (optional)
            <input className={`${inputClass} mt-1`} value={position} onChange={e => setPosition(e.target.value)} placeholder="e.g. Support Executive" />
          </label>

          <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-100 text-[11px] text-blue-900 flex items-center gap-1.5">
            <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
            Will open: <strong>{defaultDashboardLabel(role, needsTeam ? selectedTeam?.division : undefined, department?.name, consultant)}</strong>
          </div>

          {role === 'DEPARTMENT_HEAD' && existingHead && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5" role="alert">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {department?.name || 'This department'} already has a Department Head (<strong>{existingHead.fullName}</strong>). A department can have only one.
              </span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !departmentId || (role === 'DEPARTMENT_HEAD' && !!existingHead)}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold shadow-md disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" /> {saving ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        {/* Member list */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">
              Members {loading ? '' : `(${total})`}
            </h3>
            {!isTeamLead && (
              <div className="flex gap-1 text-xs">
                {(['subdept', 'department'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={`px-2.5 py-1 rounded-lg border font-semibold ${scope === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
                  >
                    {s === 'subdept' ? defaultTeam?.name || 'This team' : 'Whole department'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {actionNotice && (
            <div className={`p-2.5 rounded-xl text-xs border ${actionNotice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
              {actionNotice.text}
            </div>
          )}
          {listError && <div className="p-2.5 rounded-xl text-xs border bg-rose-50 border-rose-200 text-rose-700">{listError}</div>}

          {!loading && members.length === 0 && !listError ? (
            <p className="text-xs text-slate-500 py-8 text-center">No members yet. Create the first account using the form.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="py-2 pr-3 font-semibold">Name / Email</th>
                    <th className="py-2 pr-3 font-semibold">Role</th>
                    <th className="py-2 pr-3 font-semibold">Default dashboard</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 font-semibold text-right">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} className="border-b border-slate-50 align-top">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-900">{m.fullName}</div>
                        <div className="text-slate-500 font-mono">{m.email}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        {staffRoleLabel(m)}
                        {m.team && <div className="text-slate-400">{m.team.name}</div>}
                        {m.role === 'TEAM_MEMBER' && m.team?.division === 'SUPPORT' && allowedRoles.includes('TEAM_MEMBER') && m.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => void toggleConsultant(m)}
                            className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                            aria-label={`${isTechnicalConsultant(m) ? 'Make team member' : 'Make Technical Consultant'}: ${m.fullName}`}
                          >
                            {isTechnicalConsultant(m) ? 'Make team member' : 'Make Technical Consultant'}
                          </button>
                        )}
                        {m.role === 'TEAM_MEMBER' && m.teamId && allowedRoles.includes('TEAM_HEAD') && m.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => promote(m, 'TEAM_HEAD')}
                            className="mt-1 ml-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700"
                            aria-label={`Make Team Lead: ${m.fullName}`}
                          >
                            <ArrowUpCircle className="w-3 h-3" aria-hidden="true" /> Make Team Lead
                          </button>
                        )}
                        {m.role === 'TEAM_HEAD' && profile.role === 'SUPER_ADMIN' && m.departmentId && m.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => promote(m, 'DEPARTMENT_HEAD')}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700"
                            aria-label={`Make Department Head: ${m.fullName}`}
                          >
                            <ArrowUpCircle className="w-3 h-3" aria-hidden="true" /> Make Department Head
                          </button>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">{defaultDashboardLabel(m.role, m.team?.division, undefined, isTechnicalConsultant(m))}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_STYLES[m.status] || ''}`}>{m.status}</span>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {m.status === 'ACTIVE' ? (
                          <>
                            <button type="button" onClick={() => changeStatus(m, 'SUSPENDED')} title="Suspend" aria-label={`Suspend ${m.fullName}`} className="p-1.5 rounded-lg text-orange-600 hover:bg-orange-50">
                              <PauseCircle className="w-4 h-4" />
                            </button>
                            <button type="button" onClick={() => changeStatus(m, 'REVOKED')} title="Revoke access" aria-label={`Revoke access for ${m.fullName}`} className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50">
                              <Ban className="w-4 h-4" />
                            </button>
                          </>
                        ) : m.status === 'SUSPENDED' || m.status === 'REVOKED' ? (
                          <button type="button" onClick={() => changeStatus(m, 'ACTIVE')} title="Restore access" aria-label={`Restore access for ${m.fullName}`} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50">
                            <PlayCircle className="w-4 h-4" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeMember(m)}
                          title="Remove employee"
                          aria-label={`Remove ${m.fullName}`}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > MEMBERS_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 pt-2 text-xs text-slate-500">
              <span>
                {(page - 1) * MEMBERS_PAGE_SIZE + 1}–{Math.min(page * MEMBERS_PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage(p => p - 1)} disabled={page <= 1 || loading} className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50" aria-label="Previous page">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2">
                  Page {page} of {Math.ceil(total / MEMBERS_PAGE_SIZE)}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= Math.ceil(total / MEMBERS_PAGE_SIZE) || loading}
                  className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          <p className="text-[11px] text-slate-400 pt-1">
            You only see and manage people below you in the hierarchy. Every action is re-checked by the server.
          </p>
        </div>
      </div>
      {confirmBox && <ConfirmDialog request={confirmBox} onClose={() => setConfirmBox(null)} />}
    </div>
  );
};

const MEMBERS_PAGE_SIZE = 10;

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void>;
}

/** In-app confirmation (replaces the browser's confirm box). */
const ConfirmDialog: React.FC<{ request: ConfirmRequest; onClose: () => void }> = ({ request, onClose }) => {
  const [busy, setBusy] = useState(false);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const confirm = async () => {
    setBusy(true);
    try {
      await request.run();
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 space-y-3">
        <div className="flex items-start gap-3">
          <span className={`p-2 rounded-xl shrink-0 ${request.danger ? 'bg-rose-50 text-rose-600' : 'bg-violet-50 text-violet-600'}`}>
            {request.danger ? <AlertTriangle className="w-5 h-5" aria-hidden="true" /> : <ArrowUpCircle className="w-5 h-5" aria-hidden="true" />}
          </span>
          <div>
            <h2 id="confirm-title" className="text-sm font-bold text-slate-900">
              {request.title}
            </h2>
            <p id="confirm-message" className="text-xs text-slate-600 mt-1">
              {request.message}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-60 ${request.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-violet-600 hover:bg-violet-700'}`}
          >
            {busy ? 'Working…' : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
