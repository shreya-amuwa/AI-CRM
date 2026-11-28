import React, { useMemo, useState } from 'react';
import { BarChart3, ShieldCheck } from 'lucide-react';
import type { AiStudioHrAccess, AiStudioHrLeadReport, AiStudioHrMemberReport, AiStudioHrPerformance as Data, AiStudioHrTask } from '../../../shared/contracts';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { Card, Tabs, fieldCls, ghostBtn, primaryBtn } from '../tasks/head/headParts';
import { ReportStatusBadge, TableWrap, dateText, dateTimeText, tdCls, thCls, todayIso, useLoad } from '../ai-studio/ui';
import { HrPageHeader } from './hrUi';

/**
 * HR > AI Studio Performance (20270302000100). The approved AI Studio daily reports reach HR here: a report a Team Lead approved (or the Department
 * Head, for a member without a Team Lead), and every Team Lead's own team report. Open to the HR employees the Super Admin named (e.g. Simran
 * Kumari) and to the Super Admin; the database checks it on every call (ai_studio_hr_performance), the menu entry only follows that answer.
 * Four views of the same period: Team Lead reports, Team Member reports (Team -> Member -> Project -> report), Team-wise and Project-wise.
 */
type View = 'leads' | 'members' | 'teams' | 'projects';
const VIEWS: { id: View; label: string }[] = [
  { id: 'leads', label: 'Team Lead Reports' }, { id: 'members', label: 'Team Member Reports' }, { id: 'teams', label: 'Team-wise Performance' }, { id: 'projects', label: 'Project-wise Performance' }
];
const minusDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);

export const AiStudioHrPerformance: React.FC = () => {
  const access = useLoad<AiStudioHrAccess>(() => aiStudioApi.hrAccess(), []);
  const [view, setView] = useState<View>('members');
  const [to, setTo] = useState(todayIso());
  const [from, setFrom] = useState(minusDays(todayIso(), 29));
  const allowed = !!access.data?.allowed;
  const data = useLoad<Data | null>(() => (allowed ? aiStudioApi.hrPerformance(from, to) : Promise.resolve(null)), [allowed, from, to]);

  if (access.loading && !access.data) return <Spinner label="Opening Daily Reports – AI Studio…" />;
  if (access.error) return <ErrorBanner message={access.error} onRetry={access.reload} />;
  if (!allowed) {
    return <Card className="p-8 text-center text-sm text-slate-500" label="No access">Daily Reports – AI Studio is open only to the HR employees the Super Admin named, and the Super Admin.</Card>;
  }
  const d = data.data;
  return (
    <section className="space-y-5" aria-label="Daily Reports – AI Studio" data-testid="ai-studio-hr-performance">
      {/* (20270308000100) AI Studio's daily reports go Team Member -> Team Lead -> HR: the Team Lead's approval is final and the report arrives here */}
      <HrPageHeader as="h2" icon={BarChart3} title="Daily Reports – AI Studio"
        subtitle="AI Studio daily reports go Team Member → Team Lead → HR. The reports the Team Leads approved, and the Team Leads' own reports: employee-wise, team-wise and project-wise, with the Team Lead's approval." />
      {access.data?.canManage && <AccessManager access={access.data} onChanged={access.reload} />}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-600">From
            <input type="date" className={`${fieldCls} mt-1 !w-auto`} value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600">To
            <input type="date" className={`${fieldCls} mt-1 !w-auto`} value={to} min={from} max={todayIso()} onChange={e => e.target.value && setTo(e.target.value)} />
          </label>
          {d && (
            <div className="flex flex-wrap gap-2 text-xs" data-testid="hr-perf-counts">
              <Stat label="Approved member reports" value={d.memberReports.length} />
              <Stat label="Team Lead reports" value={d.leadReports.length} />
              <Stat label="Completed tasks" value={sum(d.memberReports, r => r.completedTasks)} />
              <Stat label="Pending tasks" value={sum(d.memberReports, r => r.pendingTasks)} />
            </div>
          )}
        </div>
      </Card>
      <Tabs<View> label="Daily Reports – AI Studio views" value={view} options={VIEWS} onChange={setView} />
      {data.error && <ErrorBanner message={data.error} onRetry={data.reload} />}
      {data.loading && !d && <Spinner label="Loading the reports…" />}
      {d && view === 'leads' && <LeadReports d={d} />}
      {d && view === 'members' && <MemberReports d={d} />}
      {d && view === 'teams' && <TeamWise d={d} />}
      {d && view === 'projects' && <ProjectWise d={d} />}
    </section>
  );
};

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);
const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <span className="rounded-xl border border-slate-200 bg-white px-3 py-1.5"><b className="text-slate-900">{value}</b> <span className="text-slate-500">{label}</span></span>
);
const Empty: React.FC<{ text: string }> = ({ text }) => <Card className="p-8 text-center text-sm text-slate-500">{text}</Card>;
const projectsOf = (tasks: AiStudioHrTask[]) => [...new Set(tasks.map(t => t.projectName).filter(Boolean))].join(', ') || 'No specific project';

/** One report's text and tasks, opened on demand. */
const ReportBody: React.FC<{ r: AiStudioHrMemberReport | AiStudioHrLeadReport; projectId?: string }> = ({ r, projectId }) => {
  const tasks = projectId ? r.tasks.filter(t => t.projectId === projectId) : r.tasks;
  // the report's three fields (20270308000100); a description or challenges are shown only on an older report that has them
  const parts: [string, string | null][] = [['Work Completed', r.workCompleted], ['Work Pending', r.pendingWork], ['Additional Note', r.remarks], ['Daily work description', r.description], ['Challenges', r.blockers]];
  return (
    <div className="space-y-3 text-sm">
      {tasks.length > 0 && (
        <ul className="space-y-1">
          {tasks.map((t, i) => (
            <li key={`${t.taskId}-${i}`} className="flex flex-wrap items-center gap-2">
              <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${t.completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{t.completed ? 'Completed' : t.progress != null ? `${t.progress}%` : 'Pending'}</span>
              <span className="font-semibold text-slate-800">{t.title}</span>
              <span className="text-xs text-slate-500">{t.projectName ?? ''}</span>
              {t.notes.length > 0 && <span className="text-xs text-slate-500 basis-full pl-2 break-words">{t.notes.join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
      {parts.filter(([, v]) => (v ?? '').trim() !== '').map(([k, v]) => (
        <div key={k}><div className="text-xs font-semibold text-slate-500">{k}</div><p className="whitespace-pre-wrap break-words text-slate-800">{v}</p></div>
      ))}
    </div>
  );
};

const MemberReportRow: React.FC<{ r: AiStudioHrMemberReport; projectId?: string }> = ({ r, projectId }) => (
  <details className="rounded-xl border border-slate-200 p-3" data-testid="hr-member-report">
    <summary className="cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-bold text-slate-900">{dateText(r.reportDate)}</span>
      <span className="text-slate-600">{r.tasks.length ? r.tasks.map(t => t.title).slice(0, 3).join(', ') : 'No specific task'}</span>
      <span className="text-xs rounded-full bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5">Approved by {r.approvedBy ?? 'the Team Lead'} · {dateTimeText(r.approvedAt)}</span>
      <span className="text-xs text-slate-500">{r.completedTasks} completed · {r.pendingTasks} pending</span>
    </summary>
    <div className="mt-3"><ReportBody r={r} projectId={projectId} /></div>
  </details>
);

// ------------------------------------------------------------------------------------------------ A. Team Lead reports
const LeadReports: React.FC<{ d: Data }> = ({ d }) => {
  const [team, setTeam] = useState('');
  const rows = d.leadReports.filter(r => !team || r.leadId === team);
  return (
    <Card>
      <div className="p-4 border-b border-slate-100">
        <select aria-label="Team" className={`${fieldCls} !w-auto min-w-[12rem]`} value={team} onChange={e => setTeam(e.target.value)}>
          <option value="">All teams</option>{d.teams.filter(t => t.leadId).map(t => <option key={t.leadId} value={t.leadId!}>{t.teamName}</option>)}
        </select>
      </div>
      {rows.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No Team Lead report in this period.</p> : (
        <TableWrap>
          <table className="w-full min-w-[52rem]" data-testid="hr-lead-reports">
            <thead className="border-b border-slate-100"><tr>
              <th className={thCls}>Team</th><th className={thCls}>Date</th><th className={thCls}>Projects</th><th className={thCls}>Members</th>
              <th className={thCls}>Completed</th><th className={thCls}>Pending</th><th className={thCls}>Team summary</th><th className={thCls}>Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className={tdCls}><div className="font-bold text-slate-900">{r.teamName}</div><div className="text-xs text-slate-500">{r.leadName}</div></td>
                  <td className={tdCls}>{dateText(r.reportDate)}</td>
                  <td className={tdCls}>{projectsOf(r.tasks)}</td>
                  <td className={tdCls}>{r.teamMembers}</td>
                  <td className={tdCls}>{r.completedTasks}</td>
                  <td className={tdCls}>{r.pendingTasks}</td>
                  <td className={tdCls}>
                    <div className="text-xs text-slate-600">{r.approvedMemberReports} of {r.teamMembers} member report{r.teamMembers === 1 ? '' : 's'} approved for the day</div>
                    <details className="mt-1"><summary className="cursor-pointer text-xs font-bold text-blue-700">The Team Lead's report and remarks</summary><div className="mt-2"><ReportBody r={r} /></div></details>
                  </td>
                  <td className={tdCls}><ReportStatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
};

// ------------------------------------------------------------------------------------------------ B. Team Member reports: Team -> Member -> Project -> report
const MemberReports: React.FC<{ d: Data }> = ({ d }) => {
  const [team, setTeam] = useState('');
  const [member, setMember] = useState('');
  const [project, setProject] = useState('');
  const teams = d.teams.filter(t => !team || (t.leadId ?? 'none') === team);
  const reportsOf = (memberId: string) => d.memberReports.filter(r => r.memberId === memberId && (!project || r.projectIds.includes(project)));
  const anything = teams.some(t => t.members.some(m => (!member || m.id === member) && reportsOf(m.id).length > 0));
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <select aria-label="Team" className={`${fieldCls} !w-auto min-w-[12rem]`} value={team} onChange={e => { setTeam(e.target.value); setMember(''); }}>
            <option value="">All teams</option>{d.teams.map(t => <option key={t.leadId ?? 'none'} value={t.leadId ?? 'none'}>{t.teamName}</option>)}
          </select>
          <select aria-label="Team member" className={`${fieldCls} !w-auto min-w-[12rem]`} value={member} onChange={e => setMember(e.target.value)}>
            <option value="">All team members</option>{teams.flatMap(t => t.members).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select aria-label="Project" className={`${fieldCls} !w-auto min-w-[12rem]`} value={project} onChange={e => setProject(e.target.value)}>
            <option value="">All projects</option>{d.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </Card>
      {!anything && <Empty text="No approved Team Member report matches." />}
      {teams.map(t => {
        const members = t.members.filter(m => (!member || m.id === member) && reportsOf(m.id).length > 0);
        if (!members.length) return null;
        return (
          <Card key={t.leadId ?? 'none'} className="p-4 space-y-3" label={t.teamName}>
            <h3 className="text-sm font-extrabold text-slate-900">{t.teamName}{t.leadName ? <span className="font-normal text-slate-500"> · Team Lead {t.leadName}</span> : null}</h3>
            {members.map(m => {
              const reps = reportsOf(m.id);
              const byProject = new Map<string, { name: string; reports: AiStudioHrMemberReport[] }>();
              for (const r of reps) {
                const keys = r.tasks.length ? [...new Set(r.tasks.map(x => `${x.projectId ?? ''}|${x.projectName ?? 'No specific project'}`))] : ['|No specific project'];
                for (const k of keys) {
                  const [id, name] = k.split('|');
                  if (project && id !== project) continue;
                  const g = byProject.get(id) ?? { name, reports: [] };
                  g.reports.push(r);
                  byProject.set(id, g);
                }
              }
              return (
                <details key={m.id} className="rounded-xl bg-slate-50 p-3" open={!!member} data-testid="hr-member">
                  <summary className="cursor-pointer text-sm font-bold text-slate-900">{m.name} <span className="font-normal text-slate-500">· {reps.length} approved report{reps.length === 1 ? '' : 's'} · {sum(reps, r => r.completedTasks)} completed · {sum(reps, r => r.pendingTasks)} pending</span></summary>
                  <div className="mt-3 space-y-3">
                    {[...byProject.entries()].map(([pid, g]) => (
                      <div key={pid || 'none'} className="space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{g.name}</div>
                        {g.reports.map(r => <MemberReportRow key={`${pid}-${r.id}`} r={r} projectId={pid || undefined} />)}
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </Card>
        );
      })}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ C. Team-wise
const TeamWise: React.FC<{ d: Data }> = ({ d }) => {
  const [team, setTeam] = useState(d.teams[0]?.leadId ?? 'none');
  const t = d.teams.find(x => (x.leadId ?? 'none') === team);
  if (!d.teams.length) return <Empty text="AI Studio has no team yet." />;
  const reports = t ? d.memberReports.filter(r => t.members.some(m => m.id === r.memberId)) : [];
  const leadReports = t?.leadId ? d.leadReports.filter(r => r.leadId === t.leadId) : [];
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <select aria-label="Team" className={`${fieldCls} !w-auto min-w-[12rem]`} value={team} onChange={e => setTeam(e.target.value)} data-testid="hr-team-select">
          {d.teams.map(x => <option key={x.leadId ?? 'none'} value={x.leadId ?? 'none'}>{x.teamName}</option>)}
        </select>
        {t && (
          <div className="flex flex-wrap gap-2 text-xs" data-testid="hr-team-summary">
            <Stat label="Team members" value={t.members.length} />
            <Stat label="Approved reports" value={reports.length} />
            <Stat label="Completed tasks" value={sum(reports, r => r.completedTasks)} />
            <Stat label="Pending tasks" value={sum(reports, r => r.pendingTasks)} />
            <Stat label="Team Lead reports" value={leadReports.length} />
          </div>
        )}
      </Card>
      {t && (
        <Card>
          <TableWrap>
            <table className="w-full min-w-[40rem]">
              <thead className="border-b border-slate-100"><tr><th className={thCls}>Team member</th><th className={thCls}>Assigned projects</th><th className={thCls}>Approved reports</th><th className={thCls}>Completed</th><th className={thCls}>Pending</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {t.members.map(m => {
                  const reps = reports.filter(r => r.memberId === m.id);
                  return (
                    <tr key={m.id}>
                      <td className={tdCls}><b className="text-slate-900">{m.name}</b></td>
                      <td className={tdCls}>{m.projects.map(p => p.name).join(', ') || '-'}</td>
                      <td className={tdCls}>{reps.length}</td>
                      <td className={tdCls}>{sum(reps, r => r.completedTasks)}</td>
                      <td className={tdCls}>{sum(reps, r => r.pendingTasks)}</td>
                    </tr>
                  );
                })}
                {t.members.length === 0 && <tr><td className={tdCls} colSpan={5}>No team members.</td></tr>}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
      {reports.length > 0 && <div className="space-y-2">{reports.map(r => <MemberReportRow key={r.id} r={r} />)}</div>}
      {leadReports.length > 0 && (
        <Card className="p-4 space-y-2">
          <h3 className="text-sm font-extrabold text-slate-900">The Team Lead's daily reports</h3>
          {leadReports.map(r => (
            <details key={r.id} className="rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm"><b>{dateText(r.reportDate)}</b> <span className="text-slate-500">· {r.approvedMemberReports} of {r.teamMembers} member reports approved · {r.completedTasks} completed · {r.pendingTasks} pending</span></summary>
              <div className="mt-3"><ReportBody r={r} /></div>
            </details>
          ))}
        </Card>
      )}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ D. Project-wise
const ProjectWise: React.FC<{ d: Data }> = ({ d }) => {
  const [project, setProject] = useState(d.projects[0]?.id ?? '');
  const p = d.projects.find(x => x.id === project);
  const reports = useMemo(() => d.memberReports.filter(r => r.projectIds.includes(project)), [d, project]);
  if (!d.projects.length) return <Empty text="AI Studio has no project yet." />;
  const leads = p ? p.people.filter(x => x.role === 'LEAD') : [];
  const members = p ? p.people.filter(x => x.role === 'MEMBER') : [];
  const teamOf = (leadId: string | null) => d.teams.find(t => t.leadId === leadId)?.teamName ?? 'No Team Lead';
  const tasksOn = (r: AiStudioHrMemberReport) => r.tasks.filter(t => t.projectId === project);
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <select aria-label="Project" className={`${fieldCls} !w-auto min-w-[12rem]`} value={project} onChange={e => setProject(e.target.value)} data-testid="hr-project-select">
          {d.projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {p && (
          <div className="grid sm:grid-cols-3 gap-3 text-sm" data-testid="hr-project-summary">
            <div><div className="text-xs font-semibold text-slate-500">Assigned team{leads.length === 1 ? '' : 's'}</div>{[...new Set([...leads.map(l => teamOf(l.id)), ...members.map(m => teamOf(m.leadId))])].join(', ') || '-'}</div>
            <div><div className="text-xs font-semibold text-slate-500">Team Lead{leads.length === 1 ? '' : 's'}</div>{leads.map(l => l.name).join(', ') || '-'}</div>
            <div><div className="text-xs font-semibold text-slate-500">Team members</div>{members.map(m => m.name).join(', ') || '-'}</div>
          </div>
        )}
      </Card>
      <Card>
        <TableWrap>
          <table className="w-full min-w-[40rem]">
            <thead className="border-b border-slate-100"><tr><th className={thCls}>Employee</th><th className={thCls}>Approved reports</th><th className={thCls}>Completed work</th><th className={thCls}>Pending work</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {members.map(m => {
                const reps = reports.filter(r => r.memberId === m.id);
                return (
                  <tr key={m.id}>
                    <td className={tdCls}><b className="text-slate-900">{m.name}</b><div className="text-xs text-slate-500">{teamOf(m.leadId)}</div></td>
                    <td className={tdCls}>{reps.length}</td>
                    <td className={tdCls}>{sum(reps, r => tasksOn(r).filter(t => t.completed).length)}</td>
                    <td className={tdCls}>{sum(reps, r => tasksOn(r).filter(t => !t.completed).length)}</td>
                  </tr>
                );
              })}
              {members.length === 0 && <tr><td className={tdCls} colSpan={4}>No team member is assigned to this project.</td></tr>}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      <div className="space-y-2" data-testid="hr-project-history">
        <h3 className="text-sm font-extrabold text-slate-900">Project history (approved reports, newest first)</h3>
        {reports.length === 0 ? <Empty text="No approved report on this project in this period." /> : reports.map(r => (
          <div key={r.id}>
            <div className="text-xs text-slate-500 mb-1">{r.memberName} · {r.teamName}</div>
            <MemberReportRow r={r} projectId={project} />
          </div>
        ))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ the Super Admin names the HR employees who may open it
const AccessManager: React.FC<{ access: AiStudioHrAccess; onChanged: () => void }> = ({ access, onChanged }) => {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const set = async (id: string, allowed: boolean) => {
    setBusy(true); setProblem('');
    try { await aiStudioApi.setHrViewer(id, allowed); setPick(''); onChanged(); } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  };
  const named = new Set(access.viewers.map(v => v.id));
  return (
    <Card className="p-4 space-y-3" label="Who may open AI Studio Performance">
      <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-4 h-4" aria-hidden="true" /> HR access (Super Admin)</h3>
      <p className="text-xs text-slate-500">Only the HR employees named here open AI Studio Performance and receive its notifications. Other HR employees do not.</p>
      <ul className="flex flex-wrap gap-2" data-testid="hr-viewers">
        {access.viewers.map(v => (
          <li key={v.id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-sm">
            {v.name}{!v.active && <span className="text-xs text-amber-700">(not an active HR employee)</span>}
            <button type="button" className="text-xs font-bold text-rose-700" disabled={busy} onClick={() => void set(v.id, false)} aria-label={`Remove ${v.name}`}>Remove</button>
          </li>
        ))}
        {access.viewers.length === 0 && <li className="text-sm text-slate-500">Nobody yet.</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select aria-label="HR employee" className={`${fieldCls} !w-auto min-w-[14rem]`} value={pick} onChange={e => setPick(e.target.value)} data-testid="hr-viewer-pick">
          <option value="">Choose an HR employee…</option>
          {access.candidates.filter(c => !named.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}
        </select>
        <button type="button" className={primaryBtn} disabled={!pick || busy} onClick={() => void set(pick, true)}>Give access</button>
        {busy && <button type="button" className={ghostBtn} disabled>Saving…</button>}
      </div>
      {problem && <ErrorBanner message={problem} />}
    </Card>
  );
};
