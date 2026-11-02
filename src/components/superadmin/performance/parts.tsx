import React, { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import type { LeaderboardRow, ScoreComponent } from '../../../../shared/contracts';
import { pctLabel } from '../../reports/reportUi';

export const TREND: Record<LeaderboardRow['trend'], { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  IMPROVING: { label: 'Improving', cls: 'text-emerald-700', Icon: ArrowUpRight },
  STABLE: { label: 'Stable', cls: 'text-slate-600', Icon: ArrowRight },
  DECLINING: { label: 'Declining', cls: 'text-rose-700', Icon: ArrowDownRight },
  NO_TREND: { label: 'Not enough data', cls: 'text-slate-400', Icon: Minus }
};
export const TrendBadge: React.FC<{ trend: LeaderboardRow['trend']; previous?: number | null }> = ({ trend, previous }) => {
  const t = TREND[trend];
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold ${t.cls}`} title={previous != null ? `Previous period: ${previous}` : undefined}><t.Icon className="w-3.5 h-3.5" aria-hidden="true" />{t.label}</span>;
};

export const CATEGORY_TONE = {
  STRONG: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  AVERAGE: 'bg-sky-50 text-sky-700 ring-sky-200',
  NEEDS_ATTENTION: 'bg-amber-50 text-amber-800 ring-amber-200',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-600 ring-slate-200'
} as const;
export const CATEGORY_LABEL = { STRONG: 'Strong', AVERAGE: 'Average', NEEDS_ATTENTION: 'Needs attention', INSUFFICIENT_DATA: 'Insufficient data' } as const;
export const CategoryPill: React.FC<{ category: keyof typeof CATEGORY_TONE }> = ({ category }) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 whitespace-nowrap ${CATEGORY_TONE[category]}`}>{CATEGORY_LABEL[category]}</span>
);

/** Why a person has the score: each measure with its value, weight and what it came from. A measure with no data is left out and the rest scaled. */
export const Breakdown: React.FC<{ items: ScoreComponent[]; score: number | null }> = ({ items, score }) => {
  const used = items.filter(i => i.value !== null && i.weight > 0);
  const total = used.reduce((a, i) => a + i.weight, 0);
  return (
    <div className="space-y-2" data-testid="score-breakdown">
      {items.map(i => {
        const has = i.value !== null && i.weight > 0;
        const share = has && total > 0 ? Math.round((100 * i.weight) / total) : 0;
        return (
          <div key={i.key} className={has ? '' : 'opacity-60'}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-800">{i.label} <span className="font-normal text-slate-500">(weight {i.weight}{has ? `, ${share}% of this score` : ', no data: left out'})</span></span>
              <span className="tabular-nums font-bold text-slate-900">{i.value === null ? 'No data' : `${i.value}`}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100" role="img" aria-label={`${i.label}: ${i.value === null ? 'no data' : i.value + ' out of 100'}`}>
              <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${i.value ?? 0}%` }} />
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">{i.detail}</p>
          </div>
        );
      })}
      <p className="text-xs text-slate-600">Overall score: <b>{score ?? 'not scored (insufficient data)'}</b>. The score is the weighted average of the measures that have data.</p>
    </div>
  );
};

/** The ranking table. Insufficient Data is shown as such: never as a low score. */
export const LeaderboardTable: React.FC<{ rows: LeaderboardRow[]; onOpen: (id: string) => void; empty: string }> = ({ rows, onOpen, empty }) => {
  const [why, setWhy] = useState<string | null>(null);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  const heads = ['Rank', 'Employee', 'Employee ID', 'Department', 'Designation', 'Team Lead', 'Assigned', 'Completed', 'Completion', 'Reporting compliance', 'HR rating', 'Score', 'Trend'];
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-xs" data-testid="leaderboard-table">
        <caption className="sr-only">Performance ranking</caption>
        <thead className="bg-slate-50 text-slate-500"><tr>{heads.map(h => <th key={h} scope="col" className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(r => (
            <React.Fragment key={r.id}>
              <tr className="hover:bg-slate-50/60">
                <td className="px-3 py-2 font-bold tabular-nums">{r.rank ?? '-'}</td>
                <th scope="row" className="px-3 py-2 text-left">
                  <button type="button" className="font-semibold text-indigo-700 hover:underline text-left" onClick={() => onOpen(r.id)} aria-label={`Open the profile of ${r.name}`}>{r.name}</button>
                  <span className="block text-[10px] font-normal text-slate-400">{r.role === 'TEAM_LEAD' ? 'Team Lead' : r.role === 'DEPARTMENT_HEAD' ? 'Department Head' : 'Team Member'}</span>
                </th>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.employeeId}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.department}</td>
                <td className="px-3 py-2">{r.designation ?? '-'}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.teamLead ?? '-'}</td>
                <td className="px-3 py-2 tabular-nums">{r.assignedTasks}</td>
                <td className="px-3 py-2 tabular-nums">{r.completedTasks}</td>
                <td className="px-3 py-2 tabular-nums">{pctLabel(r.completionRate)}</td>
                <td className="px-3 py-2 tabular-nums">{pctLabel(r.compliance)}</td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.hrRating === null ? 'Not reviewed' : `${r.hrRating} ${r.hrRatingLabel ? `(${r.hrRatingLabel})` : ''}`}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.status === 'RANKED' ? <button type="button" className="font-bold tabular-nums text-slate-900 hover:underline" aria-expanded={why === r.id} onClick={() => setWhy(w => (w === r.id ? null : r.id))} title="Show why">{r.score}</button> : <CategoryPill category="INSUFFICIENT_DATA" />}
                </td>
                <td className="px-3 py-2"><TrendBadge trend={r.trend} previous={r.previousScore} /></td>
              </tr>
              {why === r.id ? <tr><td colSpan={heads.length} className="bg-slate-50/70 px-4 py-3"><Breakdown items={r.breakdown} score={r.score} /></td></tr> : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** A small bar chart of one measure over the last weeks (a missing week is a gap, not a zero). */
export const WeeklyBars: React.FC<{ points: { label: string; value: number | null }[]; title: string }> = ({ points, title }) => (
  <figure>
    <figcaption className="text-xs font-semibold text-slate-700 mb-1">{title}</figcaption>
    <div className="flex items-end gap-1.5 h-20" role="img" aria-label={`${title}: ${points.map(p => `${p.label} ${p.value ?? 'no data'}`).join(', ')}`}>
      {points.map(p => (
        <div key={p.label} className="flex flex-1 flex-col items-center justify-end h-full min-w-0">
          {p.value === null ? <div className="w-full rounded-sm border border-dashed border-slate-300 h-1" /> : <div className="w-full rounded-t-sm bg-indigo-500" style={{ height: `${Math.max(p.value, 3)}%` }} title={`${p.label}: ${p.value}`} />}
          <span className="mt-1 text-[9px] text-slate-400 truncate w-full text-center">{p.label}</span>
        </div>
      ))}
    </div>
  </figure>
);
