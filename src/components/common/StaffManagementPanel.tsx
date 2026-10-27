import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  UserPlus, Users, Eye, EyeOff, CheckCircle2, AlertTriangle, ShieldCheck, Copy,
  RefreshCw, Ban, PauseCircle, PlayCircle, LayoutDashboard, KeyRound, ArrowUpCircle, Trash2, ChevronLeft, ChevronRight
} from 'lucide-react';
import { HEAD_DIVISIONS, HEAD_DIVISION_LABELS, SALES_SUB_ROLES, SALES_SUB_ROLE_LABELS, type DepartmentHeadAccess, type HeadDivision, type Profile, type Role, type SalesSubRole, type Team, type TeamDivision } from '../../../shared/contracts';
import { BLOOD_GROUPS, DESIGNATIONS, userCreateSchema } from '../../../shared/validation';
import { useAuth } from '../../context/AuthContext';
import { useDepartments } from '../../context/DepartmentContext';
import { organizationApi, usersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { DepartmentAccessDialog } from '../scope/DepartmentAccessDialog';
import { HeadDepartmentsField } from '../scope/HeadDepartmentsField';
import { buildHeadAssignment, type AssignableDepartment, type AssignableTeam, type HeadFunction } from '../../lib/scope/headAssignment';
import {
  ROLE_LABELS, TECHNICAL_CONSULTANT_LABEL, creatableRoles, defaultDashboardLabel, isSalesHead, isTechnicalConsultant, staffRoleLabel
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
  /**
   * 'all' (default): the combined "Team Members & Access" page.
   * 'members': a read-only member list with an "Add Team Member" button.
   * 'access': "Access Control" - the form plus role / access management.
   * 'add': only the Add Member form (its own page).
   * 'manage': only the member list with role / access management (its own page).
   * 'directory': the full-width member directory of Team Member Management (search, filters, every account action; no form).
   * 'members' and 'access' list every team of the sub-department's division.
   */
  view?: 'all' | 'members' | 'access' | 'add' | 'manage' | 'directory';
  /** Called after an account was created (Team Member Management offers "View in Team Members"). */
  onCreated?: (profile: Profile) => void;
  /** The Access Control tab: when given, "Edit Access" opens it for that person; otherwise a small editor opens here. */
  onEditAccess?: (member: Profile) => void;
  /** Changes when access was saved elsewhere: the lists reload. */
  refreshToken?: number;
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

export const StaffManagementPanel: React.FC<StaffManagementPanelProps> = ({ departmentSlug, subDept, view = 'all', onEditAccess, refreshToken = 0, onCreated }) => {
  const { profile } = useAuth();
  const { departments, allDepartments } = useDepartments();
  const department = departments.find(d => d.id === departmentSlug);
  const departmentId = department?.dbId || (profile?.department?.slug === departmentSlug ? profile.departmentId || undefined : undefined);
  const division = subDept ? DIVISION_BY_SUBDEPT[subDept] : undefined;

  const allowedRoles = useMemo(() => creatableRoles(profile?.role), [profile?.role]);
  const isTeamLead = profile?.role === 'TEAM_HEAD';

  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [scope, setScope] = useState<'subdept' | 'department'>(view === 'manage' || view === 'directory' ? 'department' : 'subdept');
  // the full-width directory: like the combined page's list, with the filters for everybody and a few more columns
  const directory = view === 'directory';
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Create form
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [position, setPosition] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [designation, setDesignation] = useState<string>('Team Member');
  const [choice, setChoice] = useState<StaffChoice>('TEAM_MEMBER');
  const [teamId, setTeamId] = useState('');
  const [salesSubRole, setSalesSubRole] = useState<SalesSubRole | ''>('');
  const [formOpen, setFormOpen] = useState(false);
  const manage = view !== 'members';
  const showForm = view === 'manage' || view === 'directory' ? false : view !== 'members' || formOpen;
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The Create button sits at the bottom of a long form: show the reason next to it and bring it into view.
  const formErrorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (formError) formErrorRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [formError]);
  const [created, setCreated] = useState<{ profile: Profile; dashboard: string; password?: string } | null>(null);
  const [showCreatedPassword, setShowCreatedPassword] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [confirmBox, setConfirmBox] = useState<ConfirmRequest | null>(null);
  const [accessFor, setAccessFor] = useState<Profile | null>(null);
  // Search and filters of the member list (role and status; the department is the one chosen for the panel).
  const [search, setSearch] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'SUSPENDED' | 'REVOKED' | ''>('');
  useEffect(() => {
    const t = setTimeout(() => setSearchApplied(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  // Heads already in the chosen department; one per side (Sales / Support) is allowed.
  const [existingHeads, setExistingHeads] = useState<Profile[]>([]);
  // Department Head account: the function (Sales / Support / one person for both) and the departments ONE account manages (the first is the home department).
  const [headFn, setHeadFn] = useState<HeadFunction | ''>('');
  const [headDepts, setHeadDepts] = useState<string[]>([]);
  const [headDeptsInit, setHeadDeptsInit] = useState(false);
  const [assignTeams, setAssignTeams] = useState<AssignableTeam[]>([]);
  const [headAccess, setHeadAccess] = useState<DepartmentHeadAccess[]>([]);
  const headDivision: HeadDivision | '' = headFn === 'SALES' || headFn === 'SUPPORT' ? headFn : '';
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
  // The designation starts as the matching one for the role (they stay separate fields: the role decides access).
  useEffect(() => {
    setDesignation(role === 'DEPARTMENT_HEAD' ? 'Department Head' : role === 'TEAM_HEAD' ? 'Team Lead' : 'Team Member');
  }, [role]);

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
      const bySubDept = view !== 'all' && view !== 'directory' && !isTeamLead && scope === 'subdept' && !!division;
      const listTeamId = isTeamLead ? profile?.teamId || undefined : bySubDept ? undefined : scope === 'subdept' ? defaultTeam?.id : undefined;
      const result = await usersApi.list({
        departmentId, teamId: listTeamId, division: bySubDept ? division : undefined, page, pageSize: MEMBERS_PAGE_SIZE,
        search: searchApplied || undefined, role: roleFilter || undefined, status: statusFilter || undefined
      });
      setMembers(result.items.filter(m => m.id !== profile?.id));
      setTotal(result.total);
    } catch (err) {
      setListError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [departmentId, scope, defaultTeam?.id, isTeamLead, profile?.teamId, profile?.id, page, view, division, searchApplied, roleFilter, statusFilter]);

  // Back to page 1 when the list changes scope.
  useEffect(() => setPage(1), [scope, departmentId, searchApplied, roleFilter, statusFilter]);

  const assignable = useMemo<AssignableDepartment[]>(
    () => allDepartments.filter(d => d.dbId).map(d => ({ id: d.dbId as string, name: d.name, slug: d.id, facetOf: d.facetOf, facetDivision: d.facetDivision })),
    [allDepartments]
  );
  // The department list at the top only chooses whose members are shown; the head starts with that department selected.
  useEffect(() => {
    if (departmentId && !headDeptsInit) {
      setHeadDepts([departmentId]);
      setHeadDeptsInit(true);
    }
  }, [departmentId, headDeptsInit]);
  // The functions each department has teams for (a head can only be given a function the department really has).
  useEffect(() => {
    if (profile?.role !== 'SUPER_ADMIN' || !allowedRoles.includes('DEPARTMENT_HEAD')) return;
    organizationApi.teams().then(ts => setAssignTeams(ts.map(t => ({ departmentId: t.departmentId, division: t.division }))), () => setAssignTeams([]));
  }, [profile?.role, allowedRoles]);
  // The department the head is placed in (the first one chosen; a side department such as Wabatalk is placed in its base department).
  const headHome = headDepts[0] ? assignable.find(d => d.id === headDepts[0]) : undefined;
  const headHomeId = headHome ? headHome.facetOf ?? headHome.id : departmentId;
  const headHomeName = (headHome && (assignable.find(d => d.id === headHomeId)?.name || headHome.name)) || department?.name;

  // One Department Head per department and side (Sales / Support): warn before trying to create a second.
  useEffect(() => {
    if (!headHomeId || !allowedRoles.includes('DEPARTMENT_HEAD')) return setExistingHeads([]);
    usersApi
      .list({ departmentId: headHomeId, role: 'DEPARTMENT_HEAD', pageSize: 10 })
      .then(r => setExistingHeads(r.items.filter(p => p.status !== 'REVOKED' && p.status !== 'REJECTED')), () => setExistingHeads([]));
  }, [headHomeId, allowedRoles, created, members]);

  // Heads who work in this department without being placed in it (shared heads), with every department they work in.
  const loadHeadAccess = useCallback(async () => {
    if (!departmentId || view === 'members' || (profile?.role !== 'SUPER_ADMIN' && profile?.role !== 'DEPARTMENT_HEAD')) return setHeadAccess([]);
    setHeadAccess(await usersApi.departmentHeads(departmentId).catch(() => []));
  }, [departmentId, view, profile?.role]);
  useEffect(() => {
    void loadHeadAccess();
  }, [loadHeadAccess, created, refreshToken]);

  useEffect(() => {
    if (!departmentId) return;
    // The Sales Department Head works with the Sales teams only (the database refuses the rest as well).
    organizationApi.teams(departmentId).then(ts => setTeams(profile && isSalesHead(profile) ? ts.filter(t => t.division === 'SALES') : ts)).catch(err => setListError(errorMessage(err)));
  }, [departmentId, profile]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers, refreshToken]);

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
  const headOfSide = (side: HeadDivision) => existingHeads.find(h => h.headDivision === side) || null;
  const unlabelledHead = existingHeads.find(h => !h.headDivision) || null;
  const existingHead = role === 'DEPARTMENT_HEAD' && headDivision ? headOfSide(headDivision) : null;
  // The Sales role (Telecaller, ...) is chosen for a Team Member of a Sales team, by the Super Admin or the Department Head.
  const canSetSalesRole = profile?.role === 'SUPER_ADMIN' || profile?.role === 'DEPARTMENT_HEAD';
  const showSalesRole = canSetSalesRole && role === 'TEAM_MEMBER' && !consultant && selectedTeam?.division === 'SALES';
  const subDeptLabel = selectedTeam ? `${department?.name || ''} · ${selectedTeam.name}` : department?.name || departmentSlug;

  // Heads who work here without being placed here (shared heads) are listed too, with every department they work in.
  const accessOf = new Map(headAccess.map(h => [h.profile.id, h.access]));
  const memberIds = new Set(members.map(m => m.id));
  const sharedIds = new Set(headAccess.filter(h => !memberIds.has(h.profile.id) && h.profile.id !== profile.id).map(h => h.profile.id));
  // Department Heads belong to no team, so (as the heads placed here) they show under "Whole department".
  const showShared = !isTeamLead && scope === 'department';
  const rows = [...members, ...(showShared ? headAccess.filter(h => sharedIds.has(h.profile.id)).map(h => h.profile) : [])];

  const resetForm = () => {
    setFullName('');
    setEmail('');
    setPassword('');
    setPosition('');
    setJoiningDate('');
    setDateOfBirth('');
    setBloodGroup('');
    setEmergencyContact('');
    setSalesSubRole('');
    setHeadFn('');
    setHeadDepts(departmentId ? [departmentId] : []);
    setShowPassword(false);
  };

  /** Give an existing Sales member a Sales role (or clear it); the database lets only the Super Admin and the Department Head do it. */
  const changeSalesRole = async (member: Profile, value: SalesSubRole | '') => {
    setActionNotice(null);
    try {
      await usersApi.setSalesSubRole(member.id, value || null);
      setActionNotice({ text: value ? `${member.fullName} is now a ${SALES_SUB_ROLE_LABELS[value]}.` : `${member.fullName} no longer has a Sales role.`, ok: true });
      await loadMembers();
    } catch (err) {
      setActionNotice({ text: errorMessage(err), ok: false });
    }
    setTimeout(() => setActionNotice(null), 6000);
  };

  /** The Super Admin labels an existing Department Head Sales or Support. */
  const changeHeadDivision = async (member: Profile, value: HeadDivision | '') => {
    setActionNotice(null);
    try {
      await usersApi.setHeadDivision(member.id, value || null);
      setActionNotice({ text: value ? `${member.fullName} is now the ${HEAD_DIVISION_LABELS[value]} Department Head.` : `${member.fullName} no longer has a Sales or Support label.`, ok: true });
      await loadMembers();
    } catch (err) {
      setActionNotice({ text: errorMessage(err), ok: false });
    }
    setTimeout(() => setActionNotice(null), 6000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreated(null);
    setShowCreatedPassword(false);
    const todayIso = new Date().toISOString().slice(0, 10);
    if (dateOfBirth && dateOfBirth > todayIso) {
      setFormError('Date of birth cannot be in the future. Please enter the real date of birth.');
      return;
    }
    let headPlan: { departmentId: string; headDivision?: HeadDivision; additionalAccess: { departmentId: string; division: HeadDivision }[] } | null = null;
    if (role === 'DEPARTMENT_HEAD') {
      const plan = buildHeadAssignment({ fn: headFn, selectedIds: headDepts, departments: assignable, teams: assignTeams });
      if (!plan.ok) {
        setFormError(plan.error);
        return;
      }
      headPlan = plan;
    }
    const parsed = userCreateSchema.safeParse({
      email,
      fullName,
      password,
      role,
      departmentId: headPlan ? headPlan.departmentId : undefined,
      teamId: needsTeam ? teamId || undefined : undefined,
      position: position || undefined,
      technicalConsultant: consultant || undefined,
      salesSubRole: showSalesRole && salesSubRole ? salesSubRole : undefined,
      headDivision: headPlan?.headDivision,
      additionalAccess: headPlan && headPlan.additionalAccess.length ? headPlan.additionalAccess : undefined,
      details: { designation, joiningDate, dateOfBirth, bloodGroup, emergencyContact }
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || 'Please check the form.');
      return;
    }
    setSaving(true);
    try {
      const newProfile = await usersApi.create(parsed.data);
      // HR logins: the Super Admin sees the initial password once, here, to pass on. It is kept only in this panel's memory
      // (never stored or logged) and disappears when the next account is started or the panel is closed.
      setShowCreatedPassword(false);
      setCreated({
        profile: newProfile,
        password: newProfile.department?.slug === 'hr' ? password : undefined,
        dashboard: defaultDashboardLabel(newProfile.role, newProfile.team?.division, newProfile.department?.name, isTechnicalConsultant(newProfile), newProfile.department?.slug, newProfile.salesSubRole, newProfile.headDivision)
      });
      resetForm();
      onCreated?.(newProfile);
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
            <h2 className="text-xl font-bold font-heading text-slate-900">{view === 'members' || directory ? 'Team Members' : view === 'access' || view === 'manage' ? 'Access Control' : view === 'add' ? 'Add Member' : 'Team Members & Access'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {view === 'manage' ? (
                <>{department?.name || departmentSlug} &bull; change roles, suspend, restore or remove members</>
              ) : directory ? (
                <>
                  {isTeamLead ? subDeptLabel : department?.name || departmentSlug} &bull; signed in as <strong>{ROLE_LABELS[profile.role]}</strong> - search, filter and manage the accounts you are responsible for
                </>
              ) : (
                <>
                  {subDeptLabel} &bull; signed in as <strong>{ROLE_LABELS[profile.role]}</strong> - you can create:{' '}
                  {choices.map(r => (r === 'TECHNICAL_CONSULTANT' ? TECHNICAL_CONSULTANT_LABEL : ROLE_LABELS[r])).join(', ')}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="self-start sm:self-center flex items-center gap-2">
          {view === 'members' && (
            <button
              type="button"
              onClick={() => setFormOpen(o => !o)}
              className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" /> {formOpen ? 'Close form' : 'Add Team Member'}
            </button>
          )}
          {view !== 'add' && <button
            type="button"
            onClick={() => void loadMembers()}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Create member form */}
        {showForm && <form onSubmit={handleCreate} className={`${view === 'add' ? 'lg:col-span-5 w-full max-w-3xl' : 'lg:col-span-2'} bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5`}>
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <UserPlus className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">Add Team Member</h3>
          </div>

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
              {created.password ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    Password: <span className="font-mono">{showCreatedPassword ? created.password : '••••••••••••'}</span>
                    <button type="button" onClick={() => setShowCreatedPassword(v => !v)} className="inline-flex items-center text-emerald-700 hover:underline" title={showCreatedPassword ? 'Hide password' : 'Show password'} aria-label={showCreatedPassword ? 'Hide password' : 'Show password'}>
                      {showCreatedPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(created.password!)} className="inline-flex items-center text-emerald-700 hover:underline" title="Copy password" aria-label="Copy password">
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-emerald-700">Shown only now, and not stored by the CRM. Give it to them privately (in person or a call, not in a group chat); they can change it after signing in.</div>
                </div>
              ) : (
                <div className="text-emerald-700">Share the password securely; they can change it after signing in.</div>
              )}
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

          {role !== 'DEPARTMENT_HEAD' && (
            <label className="block text-xs font-semibold text-slate-700">
              Department
              <input className={`${inputClass} mt-1 bg-slate-50 text-slate-600`} value={department?.name || departmentSlug} readOnly aria-readonly="true" />
              <span className="block mt-1 font-normal text-slate-500">The department chosen at the top of this window.</span>
            </label>
          )}

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

          {role === 'DEPARTMENT_HEAD' && (
            <>
              <HeadDepartmentsField
                fn={headFn}
                onFn={setHeadFn}
                selected={headDepts}
                onSelected={setHeadDepts}
                departments={assignable}
                teams={assignTeams}
                inputClass={inputClass}
              />
              <p className="text-[11px] text-slate-500">
                A department has one Sales head and one Support head (the department the head is placed in is checked for this); a head can also be given other departments they share.
                {unlabelledHead && ` ${unlabelledHead.fullName} has no side set yet — set it in the list below.`}
              </p>
            </>
          )}

          {showSalesRole && (
            <label className="block text-xs font-semibold text-slate-700">
              Sales Role / Sales Sub-Role
              <select
                id="staff-sales-role"
                className={`${inputClass} mt-1 cursor-pointer`}
                value={salesSubRole}
                onChange={e => setSalesSubRole(e.target.value as SalesSubRole | '')}
              >
                <option value="">Sales Team Member (no specific role)</option>
                {SALES_SUB_ROLES.map(r => <option key={r} value={r}>{SALES_SUB_ROLE_LABELS[r]}</option>)}
              </select>
              <span className="block mt-1 font-normal text-slate-500">The person stays in the Sales team. Telecaller opens the Telecaller dashboard.</span>
            </label>
          )}

          <label className="block text-xs font-semibold text-slate-700">
            Designation *
            <select className={`${inputClass} mt-1 cursor-pointer`} value={designation} onChange={e => setDesignation(e.target.value)} required>
              {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-700">
              Joining date *
              <input type="date" className={`${inputClass} mt-1`} value={joiningDate} onChange={e => setJoiningDate(e.target.value)} required />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Date of birth *
              <input type="date" className={`${inputClass} mt-1`} max={new Date().toISOString().slice(0, 10)} value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} required />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Blood group *
              <select className={`${inputClass} mt-1 cursor-pointer`} value={bloodGroup} onChange={e => setBloodGroup(e.target.value)} required>
                <option value="">Select…</option>
                {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Emergency contact number *
              <input type="tel" inputMode="tel" className={`${inputClass} mt-1`} value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} placeholder="+91 98765 43210" autoComplete="off" required />
            </label>
          </div>

          <label className="block text-xs font-semibold text-slate-700">
            Position (optional)
            <input className={`${inputClass} mt-1`} value={position} onChange={e => setPosition(e.target.value)} placeholder="e.g. Support Executive" />
          </label>

          <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-100 text-[11px] text-blue-900 flex items-center gap-1.5">
            <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
            Will open: <strong>{defaultDashboardLabel(role, needsTeam ? selectedTeam?.division : undefined, department?.name, consultant, departmentSlug, showSalesRole ? salesSubRole || null : null, role === 'DEPARTMENT_HEAD' ? headDivision || null : null)}</strong>
          </div>

          {role === 'DEPARTMENT_HEAD' && existingHead && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5" role="alert">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {headHomeName || 'This department'} already has a {HEAD_DIVISION_LABELS[headDivision as HeadDivision]} Department Head (<strong>{existingHead.fullName}</strong>). A department can have only one for each side.
              </span>
            </div>
          )}

          {formError && (
            <div ref={formErrorRef} role="alert" className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{formError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !departmentId || (role === 'DEPARTMENT_HEAD' && (!headFn || headDepts.length === 0 || !!existingHead))}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold shadow-md disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" /> {saving ? 'Creating account…' : 'Create Account'}
          </button>
        </form>}

        {/* Member list */}
        <div className={`${view === 'add' ? 'hidden ' : ''}${showForm ? 'lg:col-span-3' : 'lg:col-span-5'} bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">
              Members {loading ? '' : `(${total})`}
            </h3>
            {!isTeamLead && (view === 'all' || directory) && (
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

          {manage && ((!isTeamLead && view === 'all') || directory) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="search" aria-label="Filter members">
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name or e-mail"
                aria-label="Search members by name or e-mail"
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                data-testid="member-search"
              />
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as Role | '')} aria-label="Filter by role" className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white cursor-pointer" data-testid="member-role-filter">
                <option value="">All roles</option>
                {(['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'] as Role[]).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by account status" className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white cursor-pointer" data-testid="member-status-filter">
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="REVOKED">Removed</option>
              </select>
            </div>
          )}

          {actionNotice && (
            <div className={`p-2.5 rounded-xl text-xs border ${actionNotice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
              {actionNotice.text}
            </div>
          )}
          {listError && <div className="p-2.5 rounded-xl text-xs border bg-rose-50 border-rose-200 text-rose-700">{listError}</div>}

          {!loading && rows.length === 0 && !listError ? (
            <p className="text-xs text-slate-500 py-8 text-center">{directory ? (searchApplied || roleFilter || statusFilter ? 'Nobody matches these filters.' : 'No members yet. Use the Add Team Member tab to create the first account.') : view === 'manage' ? 'No members yet. Use Add Member to create the first account.' : manage ? 'No members yet. Create the first account using the form.' : 'No members yet. Use Add Team Member to create the first account.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={`w-full text-xs ${directory ? 'min-w-[960px]' : ''}`}>
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="py-2 pr-3 font-semibold">Name / Email</th>
                    <th className="py-2 pr-3 font-semibold">Role</th>
                    {directory && <th className="py-2 pr-3 font-semibold">Department / Team</th>}
                    {directory && <th className="py-2 pr-3 font-semibold">Position</th>}
                    {directory && <th className="py-2 pr-3 font-semibold">Added</th>}
                    {manage && <th className="py-2 pr-3 font-semibold">Default dashboard</th>}
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    {manage && <th className="py-2 font-semibold text-right">Access</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(m => (
                    <tr key={m.id} className="border-b border-slate-50 align-top">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-900">{m.fullName}</div>
                        <div className="text-slate-500 font-mono">{m.email}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        {staffRoleLabel(m)}
                        {m.role === 'DEPARTMENT_HEAD' && m.headDivision && <div className="text-slate-400">{HEAD_DIVISION_LABELS[m.headDivision]}</div>}
                        {m.role === 'DEPARTMENT_HEAD' && (accessOf.get(m.id)?.length ?? 0) > 0 && (
                          <div className="mt-0.5 text-[11px] text-indigo-700" data-testid={`head-access-${m.id}`}>
                            Home: {m.department?.name || '-'} · Works in: {accessOf.get(m.id)!.map(a => `${a.department}${a.division ? ` (${HEAD_DIVISION_LABELS[a.division]})` : ''}`).join(', ')}
                          </div>
                        )}
                        {m.role === 'DEPARTMENT_HEAD' && sharedIds.has(m.id) && <div className="text-[11px] text-slate-400">Shared head · home department {m.department?.name || '-'}</div>}
                        {manage && profile.role === 'SUPER_ADMIN' && m.role === 'DEPARTMENT_HEAD' && m.status === 'ACTIVE' && (
                          <label className="mt-1 block text-[11px] font-semibold text-blue-600">
                            <span className="sr-only">Side of {m.fullName}</span>
                            <select
                              className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-semibold text-slate-700 cursor-pointer"
                              value={m.headDivision || ''}
                              onChange={e => void changeHeadDivision(m, e.target.value as HeadDivision | '')}
                              aria-label={`Sales or Support side of ${m.fullName}`}
                            >
                              <option value="">No side set</option>
                              {HEAD_DIVISIONS.map(d => <option key={d} value={d}>{HEAD_DIVISION_LABELS[d]} head</option>)}
                            </select>
                          </label>
                        )}
                        {manage && profile.role === 'SUPER_ADMIN' && m.role === 'DEPARTMENT_HEAD' && m.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => (onEditAccess ? onEditAccess(m) : setAccessFor(m))}
                            className="mt-1 block text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                            aria-label={`Edit access of ${m.fullName}`}
                            data-testid={`departments-functions-${m.id}`}
                          >
                            Edit Access
                          </button>
                        )}
                        {m.team && <div className="text-slate-400">{m.team.name}{m.salesSubRole ? ` · ${SALES_SUB_ROLE_LABELS[m.salesSubRole]}` : ''}</div>}
                        {manage && canSetSalesRole && m.role === 'TEAM_MEMBER' && m.team?.division === 'SALES' && m.status === 'ACTIVE' && (
                          <label className="mt-1 block text-[11px] font-semibold text-blue-600">
                            <span className="sr-only">Sales role of {m.fullName}</span>
                            <select
                              className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-semibold text-slate-700 cursor-pointer"
                              value={m.salesSubRole || ''}
                              onChange={e => void changeSalesRole(m, e.target.value as SalesSubRole | '')}
                              aria-label={`Sales role of ${m.fullName}`}
                            >
                              <option value="">No Sales role</option>
                              {SALES_SUB_ROLES.map(r => <option key={r} value={r}>{SALES_SUB_ROLE_LABELS[r]}</option>)}
                            </select>
                          </label>
                        )}
                        {manage && m.role === 'TEAM_MEMBER' && m.team?.division === 'SUPPORT' && allowedRoles.includes('TEAM_MEMBER') && m.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => void toggleConsultant(m)}
                            className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                            aria-label={`${isTechnicalConsultant(m) ? 'Make team member' : 'Make Technical Consultant'}: ${m.fullName}`}
                          >
                            {isTechnicalConsultant(m) ? 'Make team member' : 'Make Technical Consultant'}
                          </button>
                        )}
                        {manage && m.role === 'TEAM_MEMBER' && m.teamId && allowedRoles.includes('TEAM_HEAD') && m.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => promote(m, 'TEAM_HEAD')}
                            className="mt-1 ml-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700"
                            aria-label={`Make Team Lead: ${m.fullName}`}
                          >
                            <ArrowUpCircle className="w-3 h-3" aria-hidden="true" /> Make Team Lead
                          </button>
                        )}
                        {manage && m.role === 'TEAM_HEAD' && profile.role === 'SUPER_ADMIN' && m.departmentId && m.status === 'ACTIVE' && (
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
                      {directory && (
                        <td className="py-2.5 pr-3 text-slate-600">
                          <div>{m.department?.name || '-'}</div>
                          {m.team && <div className="text-slate-400">{m.team.name}</div>}
                        </td>
                      )}
                      {directory && <td className="py-2.5 pr-3 text-slate-600">{m.position || '-'}</td>}
                      {directory && (
                        <td className="py-2.5 pr-3 text-slate-600 whitespace-nowrap">
                          {new Date(m.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                      )}
                      {manage && <td className="py-2.5 pr-3 text-slate-600">{defaultDashboardLabel(m.role, m.team?.division, undefined, isTechnicalConsultant(m), m.department?.slug, m.salesSubRole, m.headDivision)}</td>}
                      <td className="py-2.5 pr-3">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_STYLES[m.status] || ''}`}>{m.status}</span>
                      </td>
                      {manage && <td className="py-2.5 text-right whitespace-nowrap">
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
                      </td>}
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
      {accessFor && (
        <DepartmentAccessDialog
          member={accessFor}
          onClose={() => {
            setAccessFor(null);
            void loadMembers();
            void loadHeadAccess();
          }}
        />
      )}
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
