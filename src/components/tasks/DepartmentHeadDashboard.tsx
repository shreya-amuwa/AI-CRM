import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarCheck,
  ChevronDown,
  ClipboardList,
  Headset,
  ShieldCheck,
  UserPlus,
  HelpCircle,
  LogOut,
  Menu,
  Plus,
  UserCheck,
  X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { HandoverBoard } from '../handover/HandoverBoard';
import { StaffManagementPanel } from '../common/StaffManagementPanel';
import { SupportDeskPage } from '../support-member/SupportDeskPage';
import {
  isDirectMemberTask,
  localDateKey,
  summarize,
  useWorkTasks,
  workTasksApi,
  type Person,
  type TaskPriority,
  type WorkTask,
  type WorkTaskData
} from '../../lib/workTasks';
import { DueLabel, EmptyState, fmtDate, nameOf, PriorityPill, ProgressBar, StatusPill, UpdateTimeline } from './TaskParts';

type Nav = 'assign' | 'reports' | 'daily' | 'support' | 'clients' | 'team';

/**
 * Department Head dashboard.
 *   Assign      — give a task to a Team Lead; see how the lead split it
 *                 across team members and every update that came back.
 *   Reports     — how much work is completed / not, per team lead and member.
 *   Daily Tasks — what was due on a day and how much of it is completed.
 */
export const DepartmentHeadDashboard: React.FC<{ onOpenHub?: () => void }> = ({ onOpenHub }) => {
  const { user, profile, logout } = useAuth();
  const [nav, setNav] = useState<Nav>('assign');
  const [mobileOpen, setMobileOpen] = useState(false);
  const data = useWorkTasks();

  const items: { id: Nav; label: string; icon: React.ElementType }[] = [
    { id: 'assign', label: 'Assign', icon: ClipboardList },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'daily', label: 'Daily Tasks', icon: CalendarCheck },
    { id: 'support', label: 'Support Desk', icon: Headset },
    { id: 'clients', label: 'Client Hand-overs', icon: UserCheck },
    { id: 'team', label: 'Team Members & Access', icon: UserPlus }
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex font-sans antialiased">
      {mobileOpen && <div className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-60 bg-white border-r border-slate-200/80 z-50 flex flex-col justify-between p-4 transition-transform ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        aria-label="Department Head navigation"
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div className="leading-tight">
                <span className="block text-sm font-bold text-slate-900">Amuwa</span>
                <span className="block text-[11px] text-slate-500 font-medium -mt-0.5">{profile?.department?.name || 'Department'}</span>
              </div>
            </div>
            <button onClick={() => setMobileOpen(false)} className="lg:hidden p-1.5 text-slate-400 rounded-lg" aria-label="Close menu">
              <X className="w-5 h-5" />
            </button>
          </div>
          <nav className="space-y-1">
            {items.map(item => {
              const Icon = item.icon;
              const active = nav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setNav(item.id);
                    setMobileOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition-all ${
                    active ? 'bg-blue-50 text-blue-600 font-bold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-blue-600' : 'text-slate-400'}`} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
            {onOpenHub && (
              <button
                type="button"
                onClick={onOpenHub}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-left text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                <Building2 className="w-4 h-4 text-slate-400" aria-hidden="true" />
                Department Hub
              </button>
            )}
          </nav>
        </div>
        <div className="space-y-2 pt-4 border-t border-slate-100">
          <a href="mailto:support@amuwa.com" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50">
            <HelpCircle className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <span>
              <span className="block text-xs font-semibold text-slate-700">Need help?</span>
              <span className="block text-[10px] text-slate-400">Contact support</span>
            </span>
          </a>
          <button type="button" onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50">
            <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-30">
          <button type="button" onClick={() => setMobileOpen(true)} className="lg:hidden p-2 rounded-xl text-slate-500" aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
          <div className="ml-auto pl-3 border-l border-slate-200">
            <div className="text-xs font-bold text-slate-900 leading-none">{user?.name}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Department Head</div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full">
          {data.error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs" role="alert">
              {data.error}
            </div>
          )}
          {nav === 'assign' && <AssignPage data={data} />}
          {nav === 'reports' && <ReportsPage data={data} />}
          {nav === 'daily' && <DailyPage data={data} />}
          {nav === 'support' && <SupportDeskPage />}
          {nav === 'clients' && <HandoverBoard role="DEPARTMENT_HEAD" />}
          {nav === 'team' && <StaffManagementPanel departmentSlug={profile?.department?.slug || ''} />}
        </main>
      </div>
    </div>
  );
};

const PageTitle: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div className="mb-5">
    <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">{title}</h1>
    <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{subtitle}</p>
  </div>
);

const inputCls = 'mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20';

// ---------------------------------------------------------------------------
// Assign
// ---------------------------------------------------------------------------
const AssignPage: React.FC<{ data: WorkTaskData }> = ({ data }) => {
  const { profile } = useAuth();
  const leads = data.people.filter(p => p.role === 'TEAM_HEAD' && p.status === 'ACTIVE' && p.departmentId === profile?.departmentId);
  const leadTasks = data.tasks.filter(t => t.parentId === null && t.assignedBy === profile?.id);

  const [assigneeId, setAssigneeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState(localDateKey());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigneeId || !title.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      await workTasksApi.assignToTeamLead({ assigneeId, title: title.trim(), description, priority, dueDate });
      setNotice({ ok: true, text: `Task assigned to ${nameOf(data.people, assigneeId)}.` });
      setTitle('');
      setDescription('');
      await data.reload();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not assign the task.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle
        title="Assign"
        subtitle="Assign a task to a team lead. The team lead assigns it to their team members; updates come back to you."
      />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <form onSubmit={submit} className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3" aria-label="Assign a task to a team lead">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <Plus className="w-4 h-4 text-blue-600" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-900">New task for a team lead</h2>
          </div>
          {notice && (
            <p role={notice.ok ? 'status' : 'alert'} className={`p-2.5 rounded-lg text-xs ${notice.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
              {notice.text}
            </p>
          )}
          <label className="block text-xs font-semibold text-slate-700">
            Team lead *
            <select className={inputCls} value={assigneeId} onChange={e => setAssigneeId(e.target.value)} required>
              <option value="">Choose a team lead</option>
              {leads.map(l => (
                <option key={l.id} value={l.id}>
                  {l.fullName}
                  {l.teamId ? ` — ${data.teams.find(t => t.id === l.teamId)?.name || 'Team'}` : ''}
                </option>
              ))}
            </select>
            {leads.length === 0 && <span className="block mt-1 text-[11px] text-amber-700">No active team leads in your department yet.</span>}
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Task *
            <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required placeholder="e.g. Call all new WhatsApp leads" />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Details
            <textarea className={inputCls} rows={3} maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-700">
              Priority
              <select className={inputCls} value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Due date
              <input type="date" className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </label>
          </div>
          <button
            type="submit"
            disabled={busy || !assigneeId || !title.trim()}
            className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Assigning…' : 'Assign to team lead'}
          </button>
        </form>

        <section className="lg:col-span-3 space-y-3" aria-label="Assigned tasks">
          <h2 className="text-sm font-bold text-slate-900">Assigned tasks ({leadTasks.length})</h2>
          {data.loading ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : leadTasks.length === 0 ? (
            <EmptyState title="No tasks assigned yet" hint="Tasks you assign to team leads appear here with their team members' progress." />
          ) : (
            leadTasks.map(t => <LeadTaskCard key={t.id} task={t} data={data} />)
          )}
        </section>
      </div>
    </div>
  );
};

const LeadTaskCard: React.FC<{ task: WorkTask; data: WorkTaskData }> = ({ task, data }) => {
  const [open, setOpen] = useState(false);
  const children = data.tasks.filter(c => c.parentId === task.id);
  const done = children.filter(c => c.status === 'COMPLETED').length;
  const leadUpdates = data.updates.filter(u => u.taskId === task.id);

  return (
    <article className="bg-white rounded-2xl border border-slate-200/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">{task.title}</h3>
            <PriorityPill priority={task.priority} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Team lead: <strong className="text-slate-700">{nameOf(data.people, task.assigneeId)}</strong> · <DueLabel task={task} />
          </p>
        </div>
        <StatusPill status={task.status} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <ProgressBar value={task.progress} label={`Progress of ${task.title}`} />
        </div>
        <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">
          {children.length ? `${done}/${children.length} members done` : 'Not yet assigned to members'}
        </span>
      </div>
      {task.lastUpdateNote && (
        <p className="mt-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
          <strong>Latest from team lead:</strong> {task.lastUpdateNote}
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
        {open ? 'Hide team progress' : 'Show team progress'}
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border border-slate-200">
            <div className="text-xs font-bold text-slate-800 mb-2">Team members</div>
            {children.length === 0 ? (
              <p className="text-[11px] text-slate-400">The team lead has not assigned it to anyone yet.</p>
            ) : (
              <ul className="space-y-2">
                {children.map(c => (
                  <li key={c.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{nameOf(data.people, c.assigneeId)}</span>
                      <StatusPill status={c.status} />
                    </div>
                    <div className="mt-1">
                      <ProgressBar value={c.progress} label={`Progress of ${nameOf(data.people, c.assigneeId)}`} />
                    </div>
                    {c.lastUpdateNote && <p className="mt-1 text-[11px] text-slate-500">{c.lastUpdateNote}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="p-3 rounded-xl border border-slate-200">
            <div className="text-xs font-bold text-slate-800 mb-2">Updates from the team lead</div>
            <UpdateTimeline updates={leadUpdates} people={data.people} empty="No update from the team lead yet." />
          </div>
        </div>
      )}
    </article>
  );
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
type Range = 'all' | 'week' | 'month';

const ReportsPage: React.FC<{ data: WorkTaskData }> = ({ data }) => {
  const [range, setRange] = useState<Range>('all');
  const since = useMemo(() => {
    if (range === 'all') return null;
    const d = new Date();
    d.setDate(d.getDate() - (range === 'week' ? 7 : 30));
    return d.toISOString();
  }, [range]);
  const inRange = data.tasks.filter(t => !since || t.createdAt >= since);
  const leadTasks = inRange.filter(t => t.parentId === null && !isDirectMemberTask(t, data.people));
  const memberTasks = inRange.filter(t => t.parentId !== null || isDirectMemberTask(t, data.people));
  const s = summarize(leadTasks);
  const m = summarize(memberTasks);

  const byPerson = (list: WorkTask[]) => {
    const map = new Map<string, WorkTask[]>();
    list.forEach(t => map.set(t.assigneeId, [...(map.get(t.assigneeId) || []), t]));
    return [...map.entries()].map(([id, tasks]) => ({ id, ...summarize(tasks) })).sort((a, b) => b.total - a.total);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <PageTitle title="Reports" subtitle="How much work is completed and how much is not, for team leads and team members." />
        <div role="tablist" aria-label="Period" className="flex gap-1.5 mb-5">
          {(['all', 'month', 'week'] as Range[]).map(r => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${range === r ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}
            >
              {r === 'all' ? 'All time' : r === 'month' ? 'Last 30 days' : 'Last 7 days'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Stat label="Tasks assigned" value={s.total} />
        <Stat label="Completed" value={s.completed} tone="text-emerald-700" />
        <Stat label="In progress" value={s.inProgress} tone="text-blue-700" />
        <Stat label="Pending" value={s.notStarted} />
        <Stat label="Not completed" value={s.notCompleted + s.overdue} tone="text-rose-700" hint={`${s.overdue} overdue`} />
        <Stat label="Completion" value={`${s.pct}%`} tone="text-emerald-700" />
      </div>

      <ReportTable title="By team lead" rows={byPerson(leadTasks)} people={data.people} />
      <ReportTable title={`By team member (${m.completed}/${m.total} completed)`} rows={byPerson(memberTasks)} people={data.people} />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number | string; tone?: string; hint?: string }> = ({ label, value, tone, hint }) => (
  <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
    <div className="text-[11px] font-medium text-slate-500">{label}</div>
    <div className={`text-2xl font-bold mt-1 ${tone || 'text-slate-900'}`}>{value}</div>
    {hint && <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>}
  </div>
);

const ReportTable: React.FC<{ title: string; rows: (ReturnType<typeof summarize> & { id: string })[]; people: Person[] }> = ({ title, rows, people }) => (
  <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-label={title}>
    <h2 className="text-sm font-bold text-slate-900 mb-3">{title}</h2>
    {rows.length === 0 ? (
      <p className="text-xs text-slate-400">No tasks in this period.</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-100">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 px-2 font-medium text-right">Assigned</th>
              <th className="py-2 px-2 font-medium text-right">Completed</th>
              <th className="py-2 px-2 font-medium text-right">In progress</th>
              <th className="py-2 px-2 font-medium text-right">Not completed</th>
              <th className="py-2 px-2 font-medium text-right">Overdue</th>
              <th className="py-2 pl-3 font-medium w-40">Completion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-3 font-semibold text-slate-800">{nameOf(people, r.id)}</td>
                <td className="py-2 px-2 text-right">{r.total}</td>
                <td className="py-2 px-2 text-right text-emerald-700 font-semibold">{r.completed}</td>
                <td className="py-2 px-2 text-right">{r.open}</td>
                <td className="py-2 px-2 text-right text-rose-700">{r.notCompleted}</td>
                <td className="py-2 px-2 text-right text-rose-700">{r.overdue}</td>
                <td className="py-2 pl-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <ProgressBar value={r.pct} label={`Completion of ${nameOf(people, r.id)}`} />
                    </div>
                    <span className="w-9 text-right font-semibold">{r.pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

// ---------------------------------------------------------------------------
// Daily tasks
// ---------------------------------------------------------------------------
const DailyPage: React.FC<{ data: WorkTaskData }> = ({ data }) => {
  const [day, setDay] = useState(localDateKey());
  const dueThatDay = data.tasks.filter(t => t.dueDate === day);
  const s = summarize(dueThatDay);
  const updatesThatDay = data.updates.filter(u => localDateKey(new Date(u.createdAt)) === day);
  const completedThatDay = data.tasks.filter(t => t.completedAt && localDateKey(new Date(t.completedAt)) === day);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <PageTitle title="Daily Tasks" subtitle="Tasks due on a day and how much of them is completed." />
        <label className="text-xs font-semibold text-slate-700 mb-5">
          Day
          <input type="date" value={day} onChange={e => setDay(e.target.value || localDateKey())} className="ml-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" />
        </label>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label={`Due on ${fmtDate(day)}`} value={s.total} />
        <Stat label="Completed" value={s.completed} tone="text-emerald-700" />
        <Stat label="Still open" value={s.open} tone="text-blue-700" />
        <Stat label="Not completed" value={s.notCompleted} tone="text-rose-700" />
        <Stat label="Completed that day (any due date)" value={completedThatDay.length} tone="text-emerald-700" />
      </div>
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-semibold text-slate-700">Daily completion</span>
          <span className="font-bold text-slate-900">{s.pct}%</span>
        </div>
        <ProgressBar value={s.pct} label="Daily completion" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-label="Tasks due">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Tasks due ({dueThatDay.length})</h2>
          {dueThatDay.length === 0 ? (
            <p className="text-xs text-slate-400">Nothing is due on this day.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dueThatDay.map(t => (
                <li key={t.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800">{t.title}</div>
                    <div className="text-slate-500">
                      {nameOf(data.people, t.assigneeId)} · {t.parentId || isDirectMemberTask(t, data.people) ? 'Team member' : 'Team lead'} · {t.progress}%
                    </div>
                  </div>
                  <StatusPill status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-label="Updates sent">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Updates sent this day ({updatesThatDay.length})</h2>
          <UpdateTimeline updates={updatesThatDay} people={data.people} empty="No updates on this day." />
        </section>
      </div>
    </div>
  );
};
