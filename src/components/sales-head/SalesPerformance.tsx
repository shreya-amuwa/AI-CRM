import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, Search } from 'lucide-react';
import type { SalesLeadList, SalesReportRow, SalesTaskList } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { salesHeadApi, type PerformanceReportKey } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { ReportView } from '../performance/ReportView';
import { periodLabel } from '../performance/periods';
import { Avatar, Card, CardHead, StatCard, Tabs } from '../tasks/head/headParts';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { CallStatusBadge, EmptyState, TemperatureBadge, dateText, dateTimeText, tcBtn, tcInput } from '../telecaller/ui';
import { PeriodBar, lastDays, type Range } from './periodBar';

interface Person extends SalesReportRow { kind: 'TEAM_LEAD' | 'TEAM_MEMBER' }

/** An honest indicator from the recorded tasks: no score is invented. */
export function indicatorOf(p: Pick<SalesReportRow, 'tasksAssigned' | 'tasksCompleted' | 'tasksOverdue'>): { label: string; cls: string } {
  if (p.tasksAssigned === 0) return { label: 'No tasks in this period', cls: 'bg-slate-100 text-slate-700' };
  if (p.tasksOverdue > 0) return { label: `${p.tasksOverdue} overdue`, cls: 'bg-rose-50 text-rose-700' };
  if (p.tasksCompleted === p.tasksAssigned) return { label: 'All tasks done', cls: 'bg-emerald-50 text-emerald-700' };
  return { label: 'On track', cls: 'bg-blue-50 text-blue-700' };
}

/** Performance Management: a card for every Sales team member; opening one shows their leads, tasks and activity, and the AI-assisted report. */
export const SalesPerformance: React.FC = () => {
  const [range, setRange] = useState<Range>(lastDays(30));
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'ALL' | 'TEAM_LEAD' | 'TEAM_MEMBER'>('ALL');
  const [employee, setEmployee] = useState('');
  const [open, setOpen] = useState<Person | null>(null);

  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current; // a slower, older answer must not overwrite a newer one
    setError(null);
    Promise.all([salesHeadApi.reports({ who: 'TEAM_LEAD', from: range.from, to: range.to }), salesHeadApi.reports({ who: 'TEAM_MEMBER', from: range.from, to: range.to })]).then(
      ([l, m]) => mine === latest.current && setPeople([...l.rows.map(r => ({ ...r, kind: 'TEAM_LEAD' as const })), ...m.rows.map(r => ({ ...r, kind: 'TEAM_MEMBER' as const }))]),
      e => mine === latest.current && (setError(errorMessage(e)), setPeople(p => p ?? []))
    );
  }, [range]);
  useEffect(load, [load]);

  const shown = useMemo(() => (people ?? []).filter(p => (role === 'ALL' || p.kind === role) && (!employee || p.name.toLowerCase().includes(employee.toLowerCase()))), [people, role, employee]);

  if (open) return <Workspace person={open} range={range} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-5">
      <PageTitle title="Performance Management" subtitle="How the Sales team is working, from the leads and tasks on record." />
      <Card className="p-4 space-y-4">
        <PeriodBar value={range} onChange={setRange} />
        <div className="flex flex-wrap items-center gap-3">
          <Tabs label="Role" value={role} onChange={setRole} options={[{ id: 'ALL', label: 'Everyone', count: people?.length }, { id: 'TEAM_LEAD', label: 'Team Leads' }, { id: 'TEAM_MEMBER', label: 'Team Members' }]} />
          <div className="relative min-w-[14rem]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className={`${tcInput} pl-9`} value={employee} onChange={e => setEmployee(e.target.value)} placeholder="Find an employee" aria-label="Find an employee" />
          </div>
        </div>
      </Card>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {people === null ? <Spinner label="Loading the team…" /> : shown.length === 0 ? (
        <Card><EmptyState title={people.length === 0 ? 'No Sales team members yet' : 'Nobody matches these filters'} /></Card>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" aria-label="Sales team">
          {shown.map(p => {
            const ind = indicatorOf(p);
            return (
              <li key={`${p.kind}-${p.id}`}>
                <button type="button" onClick={() => setOpen(p)} className="w-full text-left bg-white rounded-2xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 transition" aria-label={`Open ${p.name}`}>
                  <div className="flex items-center gap-3">
                    <Avatar name={p.name} size={42} />
                    <div className="min-w-0"><div className="font-extrabold text-slate-900 truncate">{p.name}</div><div className="text-xs text-slate-500">{p.kind === 'TEAM_LEAD' ? 'Team Lead' : p.subRole ? p.subRole.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') : 'Team Member'} · {p.team}</div></div>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                    {[['Assigned leads', p.leadsAssigned], ['Tasks completed', p.tasksCompleted], ['Pending tasks', p.tasksPending], ['Overdue', p.tasksOverdue], ['Follow-ups', p.followUps], ['Conversions', p.conversions]].map(([k, v]) => (
                      <div key={k as string}><dd className={`text-xl font-extrabold ${k === 'Overdue' && (v as number) > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{v}</dd><dt className="text-[11px] text-slate-500">{k}</dt></div>
                    ))}
                  </dl>
                  <div className="mt-4"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${ind.cls}`}>{ind.label}</span></div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const Workspace: React.FC<{ person: Person; range: Range; onBack: () => void }> = ({ person, range, onBack }) => {
  const [leads, setLeads] = useState<SalesLeadList | null>(null);
  const [tasks, setTasks] = useState<SalesTaskList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState(false);

  useEffect(() => {
    Promise.all([salesHeadApi.leads({ assigneeId: person.id, pageSize: 100 }), salesHeadApi.tasks({ assigneeId: person.id, pageSize: 50 })]).then(
      ([l, t]) => (setLeads(l), setTasks(t)),
      e => setError(errorMessage(e))
    );
  }, [person.id]);

  const key: PerformanceReportKey = { scope: 'MEMBER', subjectId: person.id, kind: 'CUSTOM', start: range.from, end: range.to };
  if (report) return <ReportView reportKey={key} title={`${person.name} · ${periodLabel(range.from, range.to)}`} onBack={() => setReport(false)} />;

  const items = leads?.items ?? [];
  const temp = (t: string) => items.filter(l => l.temperature === t).length;
  const byCall = items.reduce<Record<string, number>>((m, l) => ((m[l.callStatus ?? 'NONE'] = (m[l.callStatus ?? 'NONE'] ?? 0) + 1), m), {});
  const days = Array.from({ length: 7 }, (_v, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().slice(0, 10); });
  const perDay = days.map(d => ({ d, n: items.filter(l => l.lastContacted && l.lastContacted.slice(0, 10) === d).length }));
  const maxDay = Math.max(1, ...perDay.map(x => x.n));
  const followUps = items.filter(l => l.followUp).sort((a, b) => (b.followUp ?? '').localeCompare(a.followUp ?? '')).slice(0, 10);
  const ind = indicatorOf(person);
  const converted = items.filter(l => l.converted).length;

  return (
    <div className="space-y-5">
      <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline" onClick={onBack}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> All employees</button>
      <PageTitle
        title={person.name}
        subtitle={`${person.kind === 'TEAM_LEAD' ? 'Team Lead' : 'Team Member'} · ${person.team} · ${periodLabel(range.from, range.to)}`}
        actions={<button type="button" className={tcBtn.primary} onClick={() => setReport(true)}><FileText className="w-4 h-4" aria-hidden="true" /> Performance report</button>}
      />
      {error && <ErrorBanner message={error} />}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <StatCard label="Assigned leads" value={person.leadsAssigned} foot="in this period" />
        <StatCard label="Leads contacted" value={person.leadsContacted} />
        <StatCard label="Follow-ups" value={person.followUps} tone="amber" />
        <StatCard label="Conversions" value={person.conversions} tone="green" />
        <StatCard label="Tasks completed" value={person.tasksCompleted} tone="green" foot={`of ${person.tasksAssigned}`} />
        <StatCard label="Pending / overdue" value={`${person.tasksPending} / ${person.tasksOverdue}`} tone={person.tasksOverdue ? 'red' : 'neutral'} />
      </div>
      <div className="text-sm text-slate-600">Indicator: <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${ind.cls}`}>{ind.label}</span> <span className="text-xs text-slate-500">— from the recorded tasks only; the written report separates what was measured from what is suggested.</span></div>

      {!leads ? <Spinner label="Loading their work…" /> : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <Card>
            <CardHead title="Lead status" hint={leads.total > 100 ? 'First 100 leads' : `${leads.total} leads`} />
            <div className="px-5 pb-5 space-y-3 text-sm">
              <div className="space-y-1.5">{(['HOT', 'WARM', 'COLD'] as const).map(t => <div key={t} className="flex items-center justify-between"><TemperatureBadge value={t} /><b>{temp(t)}</b></div>)}</div>
              <div className="border-t border-slate-100 pt-2 space-y-1">{Object.entries(byCall).map(([k, n]) => <div key={k} className="flex justify-between"><span>{k === 'NONE' ? 'Not recorded' : <CallStatusBadge status={k as never} />}</span><b>{n}</b></div>)}</div>
              <div className="border-t border-slate-100 pt-2 flex justify-between text-slate-700"><span>Converted</span><b>{converted}</b></div>
            </div>
          </Card>
          <Card>
            <CardHead title="Daily activity" hint="Leads last contacted, last 7 days" />
            <div className="px-5 pb-5 flex items-end gap-2 h-32" role="img" aria-label="Leads contacted per day">
              {perDay.map(x => (
                <div key={x.d} className="flex-1 flex flex-col items-center justify-end gap-1 h-full"><span className="text-[11px] font-semibold text-slate-700">{x.n}</span><div className="w-full rounded-t bg-blue-500" style={{ height: `${(x.n / maxDay) * 70}%`, minHeight: x.n ? 4 : 1 }} /><span className="text-[10px] text-slate-500">{x.d.slice(8)}/{x.d.slice(5, 7)}</span></div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHead title="Follow-up history" hint="Latest follow-up dates" />
            {followUps.length === 0 ? <EmptyState title="No follow-ups recorded" /> : (
              <ul className="divide-y divide-slate-100 px-5 pb-3">{followUps.map(l => <li key={l.id} className="py-2 text-sm flex justify-between gap-2"><span className="truncate font-medium text-slate-800">{l.name}</span><span className="text-xs text-slate-500 shrink-0">{dateTimeText(l.followUp)}</span></li>)}</ul>
            )}
          </Card>
          <Card className="xl:col-span-2 overflow-hidden">
            <CardHead title="Assigned leads" />
            {items.length === 0 ? <EmptyState title="No leads assigned" /> : (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-sm min-w-[40rem]"><thead><tr className="text-left text-[11px] text-slate-500 bg-slate-50/60 sticky top-0">{['Lead', 'Company', 'Temperature', 'Call status', 'Last contacted', 'Follow-up'].map(h => <th key={h} className="px-4 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">{items.map(l => <tr key={l.id}><td className="px-4 py-2 font-semibold text-slate-900">{l.name}</td><td className="px-4 py-2 text-slate-600">{l.company || '-'}</td><td className="px-4 py-2"><TemperatureBadge value={l.temperature} /></td><td className="px-4 py-2"><CallStatusBadge status={l.callStatus} /></td><td className="px-4 py-2 text-slate-600 whitespace-nowrap">{dateText(l.lastContacted)}</td><td className="px-4 py-2 text-slate-600 whitespace-nowrap">{dateText(l.followUp)}</td></tr>)}</tbody></table>
              </div>
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHead title="Tasks" hint={tasks ? `${tasks.counts.all} in total` : undefined} />
            {!tasks || tasks.items.length === 0 ? <EmptyState title="No tasks" /> : (
              <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">{tasks.items.map(t => <li key={t.id} className="px-5 py-2.5 text-sm"><div className="flex justify-between gap-2"><span className="font-semibold text-slate-900 truncate">{t.title}</span><span className={`text-xs font-bold shrink-0 ${t.overdue ? 'text-rose-700' : 'text-slate-500'}`}>{t.status === 'COMPLETED' ? 'Done' : t.overdue ? 'Overdue' : `${t.progress}%`}</span></div><div className="text-xs text-slate-500">{t.dueDate ? `Due ${dateText(t.dueDate)}` : 'No deadline'}</div></li>)}</ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};
