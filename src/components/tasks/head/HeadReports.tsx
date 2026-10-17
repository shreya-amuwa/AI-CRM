import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { isDirectMemberTask, summarize, type Person, type WorkTask, type WorkTaskData } from '../../../lib/workTasks';
import { nameOf, ProgressBar } from '../TaskParts';
import { Avatar, Card, CardHead, ghostBtn, LoadingLine, StatCard, Tabs } from './headParts';

type Range = 'all' | 'month' | 'week';
type Row = ReturnType<typeof summarize> & { id: string };

const byPerson = (list: WorkTask[]): Row[] => {
  const map = new Map<string, WorkTask[]>();
  list.forEach(t => map.set(t.assigneeId, [...(map.get(t.assigneeId) || []), t]));
  return [...map.entries()].map(([id, tasks]) => ({ id, ...summarize(tasks) })).sort((a, b) => b.total - a.total);
};

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export const HeadReports: React.FC<{ data: WorkTaskData }> = ({ data }) => {
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
  const leadRows = byPerson(leadTasks);
  const memberRows = byPerson(memberTasks);
  const rangeLabel = range === 'all' ? 'All time' : range === 'month' ? 'Last 30 days' : 'Last 7 days';

  const exportCsv = () => {
    const lines = [['Group', 'Name', 'Assigned', 'Completed', 'In progress', 'Not completed', 'Overdue', 'Completion %']];
    const add = (group: string, rows: Row[]) => rows.forEach(r => lines.push([group, nameOf(data.people, r.id), r.total, r.completed, r.open, r.notCompleted, r.overdue, r.pct] as unknown as string[]));
    add('Team lead', leadRows);
    add('Team member', memberRows);
    const blob = new Blob([lines.map(l => l.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-report-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const circ = 2 * Math.PI * 42;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Reports</h1>
          <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">How much work is completed, and how much is not, for team leads and team members.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            label="Period"
            value={range}
            onChange={setRange}
            options={[
              { id: 'all', label: 'All time' },
              { id: 'month', label: 'Last 30 days' },
              { id: 'week', label: 'Last 7 days' }
            ]}
          />
          <button type="button" className={ghostBtn} onClick={exportCsv} disabled={leadRows.length + memberRows.length === 0}>
            <Download className="w-4 h-4" aria-hidden="true" /> Export
          </button>
        </div>
      </div>

      {data.loading ? (
        <LoadingLine />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
            <Card className="p-5 flex items-center gap-5" label="Completion">
              <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0 -rotate-90" role="img" aria-label={`${s.pct}% completion`}>
                <circle cx="50" cy="50" r="42" fill="none" stroke="#E7E9EE" strokeWidth="10" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="#2F5BEA" strokeWidth="10" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - s.pct / 100)} />
              </svg>
              <div>
                <div className="text-[32px] leading-none font-extrabold text-slate-900">{s.pct}%</div>
                <div className="mt-1 text-[13px] font-bold text-slate-700">Completion</div>
                <div className="text-xs text-slate-500">
                  {s.completed} of {s.total} tasks done · {rangeLabel}
                </div>
              </div>
            </Card>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <StatCard label="Tasks assigned" value={s.total} />
              <StatCard label="Completed" value={s.completed} tone="green" />
              <StatCard label="In progress" value={s.inProgress} tone="blue" />
              <StatCard label="Pending" value={s.notStarted} />
              <StatCard label="Not completed" value={s.notCompleted + s.overdue} tone="red" foot={`${s.overdue} overdue`} />
              <StatCard label="Team member tasks" value={m.total} foot={`${m.completed} completed`} />
            </div>
          </div>
          <ReportTable title="By team lead" sub={`${s.completed}/${s.total} completed`} rows={leadRows} people={data.people} />
          <ReportTable title="By team member" sub={`${m.completed}/${m.total} completed`} rows={memberRows} people={data.people} />
        </>
      )}
    </div>
  );
};

const ReportTable: React.FC<{ title: string; sub: string; rows: Row[]; people: Person[] }> = ({ title, sub, rows, people }) => (
  <Card label={title}>
    <CardHead title={title} hint={sub} />
    {rows.length === 0 ? (
      <p className="px-5 pb-6 text-sm text-slate-500">No tasks in this period.</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-y border-slate-100 bg-slate-50">
              <th className="py-2.5 pl-5 pr-3 font-semibold">Name</th>
              <th className="py-2.5 px-3 font-semibold text-right">Assigned</th>
              <th className="py-2.5 px-3 font-semibold text-right">Completed</th>
              <th className="py-2.5 px-3 font-semibold text-right">In progress</th>
              <th className="py-2.5 px-3 font-semibold text-right">Not completed</th>
              <th className="py-2.5 px-3 font-semibold text-right">Overdue</th>
              <th className="py-2.5 pl-3 pr-5 font-semibold w-48">Completion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 pl-5 pr-3">
                  <div className="flex items-center gap-2.5 font-bold text-slate-900">
                    <Avatar name={nameOf(people, r.id)} /> {nameOf(people, r.id)}
                  </div>
                </td>
                <td className="py-3 px-3 text-right">{r.total}</td>
                <td className="py-3 px-3 text-right text-emerald-700 font-bold">{r.completed}</td>
                <td className="py-3 px-3 text-right">{r.open}</td>
                <td className="py-3 px-3 text-right text-rose-700">{r.notCompleted}</td>
                <td className="py-3 px-3 text-right text-rose-700">{r.overdue}</td>
                <td className="py-3 pl-3 pr-5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <ProgressBar value={r.pct} label={`Completion of ${nameOf(people, r.id)}`} />
                    </div>
                    <span className="w-10 text-right text-xs font-bold">{r.pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Card>
);
