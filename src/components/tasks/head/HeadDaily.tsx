import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { isDirectMemberTask, localDateKey, summarize, type WorkTaskData } from '../../../lib/workTasks';
import { fmtDate, nameOf, ProgressBar, StatusPill, UpdateTimeline } from '../TaskParts';
import { Avatar, Card, CardHead, fieldCls, ghostBtn, LoadingLine, StatCard } from './headParts';

const shift = (key: string, days: number) => {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
};

export const HeadDaily: React.FC<{ data: WorkTaskData }> = ({ data }) => {
  const [day, setDay] = useState(localDateKey());
  // a Team Lead's task and the member tasks delegated from it are ONE piece of work: count the Team Lead's task only (its members' parts are
  // shown under it on the Assign page), and a member task that has no parent of the head's (a Team Lead's own task) on its own
  const dueThatDay = data.tasks.filter(t => t.dueDate === day && (t.parentId === null || !data.tasks.some(p => p.id === t.parentId)));
  const s = summarize(dueThatDay);
  const updatesThatDay = data.updates.filter(u => localDateKey(new Date(u.createdAt)) === day);
  const completedThatDay = data.tasks.filter(t => t.completedAt && localDateKey(new Date(t.completedAt)) === day);
  const isToday = day === localDateKey();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Daily Tasks</h1>
          <p className="mt-1.5 text-[15px] text-slate-600">What was due on a day, and how much of it got done.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={`${ghostBtn} !px-3`} onClick={() => setDay(shift(day, -1))} aria-label="Previous day">
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <label className="sr-only" htmlFor="daily-day">Day</label>
          <input id="daily-day" type="date" value={day} onChange={e => setDay(e.target.value || localDateKey())} className={`${fieldCls} w-44 font-semibold`} />
          <button type="button" className={`${ghostBtn} !px-3`} onClick={() => setDay(shift(day, 1))} aria-label="Next day">
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
          <button type="button" className={ghostBtn} onClick={() => setDay(localDateKey())} disabled={isToday}>
            Today
          </button>
        </div>
      </div>

      {data.loading ? (
        <LoadingLine />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label={`Due on ${fmtDate(day)}`} value={s.total} />
            <StatCard label="Completed" value={s.completed} tone="green" />
            <StatCard label="Still open" value={s.open} tone="blue" />
            <StatCard label="Not completed" value={s.notCompleted} tone="red" />
            <StatCard label="Completed that day" value={completedThatDay.length} tone="green" foot="Any due date" />
          </div>
          <Card className="p-5" label="Daily completion">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-bold text-slate-900">Daily completion</span>
              <span className="font-extrabold text-slate-900">{s.pct}%</span>
            </div>
            <ProgressBar value={s.pct} label="Daily completion" />
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
              <span><b className="text-emerald-700">{s.completed}</b> completed</span>
              <span><b className="text-blue-700">{s.open}</b> still open</span>
              <span><b className="text-rose-700">{s.notCompleted}</b> not completed</span>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <Card label="Tasks due">
              <CardHead title={`Tasks due (${dueThatDay.length})`} />
              {dueThatDay.length === 0 ? (
                <p className="px-5 pb-6 text-sm text-slate-500">Nothing is due on this day.</p>
              ) : (
                <ul className="divide-y divide-slate-100 px-5 pb-2">
                  {dueThatDay.map(t => (
                    <li key={t.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <Avatar name={nameOf(data.people, t.assigneeId)} />
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-900">{t.title}</div>
                          <div className="text-xs text-slate-500">
                            {nameOf(data.people, t.assigneeId)} · {t.parentId || isDirectMemberTask(t, data.people) ? 'Team member' : 'Team lead'} · {t.progress}%
                          </div>
                        </div>
                      </div>
                      <StatusPill status={t.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card label="Updates sent">
              <CardHead title={`Updates sent ${isToday ? 'today' : 'this day'} (${updatesThatDay.length})`} />
              <div className="px-5 pb-5">
                <UpdateTimeline updates={updatesThatDay} people={data.people} empty="No updates on this day." />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
