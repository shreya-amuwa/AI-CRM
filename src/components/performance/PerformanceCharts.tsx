import React from 'react';
import type { PerformanceMetrics } from '../../../shared/contracts';
import { fmtDay } from '../../lib/support';

/** Two small charts drawn as plain SVG / divs (no chart library): tasks per week, and how the period's tasks ended. */

export const WeeklyChart: React.FC<{ weekly: PerformanceMetrics['weekly'] }> = ({ weekly }) => {
  const rows = weekly.slice(-12);
  const max = Math.max(1, ...rows.map(w => Math.max(w.total, w.completed, w.overdue)));
  const H = 140;
  const colW = 100 / Math.max(rows.length, 1);
  const summary = rows.map(w => `week of ${fmtDay(w.weekStart)}: ${w.total} tasks, ${w.completed} completed, ${w.overdue} overdue`).join('; ');
  return (
    <div>
      <svg viewBox={`0 0 100 ${H + 18}`} preserveAspectRatio="none" className="w-full h-44" role="img" aria-label={`Tasks per week. ${summary}`}>
        {[0.25, 0.5, 0.75, 1].map(g => (
          <line key={g} x1="0" x2="100" y1={H - g * H} y2={H - g * H} stroke="#e2e8f0" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        {rows.map((w, i) => {
          const x = i * colW;
          const bw = colW / 4.2;
          const bar = (n: number, k: number, fill: string) => <rect key={k} x={x + colW * 0.12 + k * (bw + 0.4)} y={H - (n / max) * H} width={bw} height={(n / max) * H} fill={fill} rx="0.6" />;
          return (
            <g key={w.weekStart}>
              {bar(w.total, 0, '#bfdbfe')}
              {bar(w.completed, 1, '#2563eb')}
              {bar(w.overdue, 2, '#e11d48')}
            </g>
          );
        })}
      </svg>
      <div className="flex" aria-hidden="true">
        {rows.map(w => (
          <div key={w.weekStart} className="flex-1 text-center text-[10px] text-slate-500 truncate">
            {fmtDay(w.weekStart).replace(/ \d{4}$/, '')}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <Legend color="#bfdbfe" label="Tasks due / assigned" />
        <Legend color="#2563eb" label="Completed" />
        <Legend color="#e11d48" label="Overdue" />
      </div>
      <table className="sr-only">
        <caption>Tasks per week</caption>
        <thead><tr><th>Week of</th><th>Tasks</th><th>Completed</th><th>Overdue</th></tr></thead>
        <tbody>{rows.map(w => <tr key={w.weekStart}><td>{w.weekStart}</td><td>{w.total}</td><td>{w.completed}</td><td>{w.overdue}</td></tr>)}</tbody>
      </table>
    </div>
  );
};

const Legend: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" /> {label}</span>
);

/** How the tasks of the period ended: completed on time / late / without enough data to judge, still open, overdue. */
export const OutcomeBar: React.FC<{ m: PerformanceMetrics }> = ({ m }) => {
  const t = m.tasks;
  const parts = [
    { label: 'Completed on time', n: m.timing.onTime, color: '#059669' },
    { label: 'Completed late', n: m.timing.late, color: '#f59e0b' },
    { label: 'Completed, timing unknown', n: m.timing.completedUnknownTiming, color: '#94a3b8' },
    { label: 'Pending', n: t.pending, color: '#93c5fd' },
    { label: 'Overdue', n: t.overdue, color: '#e11d48' }
  ];
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (total === 0) return <p className="text-sm text-slate-500">No tasks in this period.</p>;
  return (
    <div>
      <div className="flex h-4 rounded-full overflow-hidden bg-slate-100" role="img" aria-label={parts.map(p => `${p.label}: ${p.n}`).join(', ')}>
        {parts.filter(p => p.n > 0).map(p => <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.n}`} />)}
      </div>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-700">
        {parts.map(p => (
          <li key={p.label} className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} aria-hidden="true" /> {p.label}</span>
            <b className="text-slate-900">{p.n}</b>
          </li>
        ))}
      </ul>
    </div>
  );
};
