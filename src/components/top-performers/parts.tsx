import React from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Award, Sparkles } from 'lucide-react';
import type { PerformerAwardType, PerformerCard, PerformerEvaluation, PerformerRecognitionStatus } from '../../../shared/contracts';
import { Avatar } from '../tasks/head/headParts';
import { Dialog, Pill, type Tone } from '../team-member/pipeline/shared';

/** Shared pieces of the Top Performers & Rankings screens. */

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
export const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));

export const AWARD_LABEL: Record<PerformerAwardType, string> = {
  EMPLOYEE_OF_MONTH: 'Employee of the Month',
  TOP_EMPLOYEE: 'Top 3 Employees of the Month',
  BEST_TEAM_LEAD: 'Best Performing Team Lead',
  MOST_IMPROVED: 'Most Improved Employee',
  HIGHEST_COMPLETION: 'Highest Task Completion Rate',
  BEST_REPORT_CONSISTENCY: 'Best Report Consistency'
};
export const AWARD_ORDER: PerformerAwardType[] = ['EMPLOYEE_OF_MONTH', 'TOP_EMPLOYEE', 'BEST_TEAM_LEAD', 'MOST_IMPROVED', 'HIGHEST_COMPLETION', 'BEST_REPORT_CONSISTENCY'];
export const STATUS_TONE: Record<PerformerRecognitionStatus, Tone> = { RECOMMENDED: 'orange', APPROVED: 'green', REJECTED: 'red' };
export const STATUS_LABEL: Record<PerformerRecognitionStatus, string> = { RECOMMENDED: 'AI recommendation', APPROVED: 'Official', REJECTED: 'Not approved' };

/** The profile picture when there is one, otherwise the initials. */
export const PersonAvatar: React.FC<{ name: string; url: string | null; size?: number }> = ({ name, url, size = 40 }) =>
  url ? <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover bg-slate-100" style={{ width: size, height: size }} loading="lazy" /> : <Avatar name={name} size={size} />;

export const scoreTone = (s: number | null) => (s === null ? 'text-slate-300' : s >= 80 ? 'text-emerald-700' : s >= 60 ? 'text-blue-700' : 'text-amber-700');

export const TrendBadge: React.FC<{ trend: PerformerCard['trend']; change: number | null }> = ({ trend, change }) => {
  if (!trend || change === null) return <span className="text-xs text-slate-400" title="No earlier month to compare with">—</span>;
  const cfg = trend === 'IMPROVING' ? { Icon: ArrowUpRight, cls: 'text-emerald-700 bg-emerald-50', label: 'Improving' } : trend === 'DECLINING' ? { Icon: ArrowDownRight, cls: 'text-rose-700 bg-rose-50', label: 'Declining' } : { Icon: ArrowRight, cls: 'text-slate-600 bg-slate-100', label: 'Steady' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.cls}`} title={`${cfg.label}: ${change > 0 ? '+' : ''}${change} points against last month`}>
      <cfg.Icon className="w-3 h-3" aria-hidden="true" />
      {change > 0 ? '+' : ''}{change}
    </span>
  );
};

export const SourceBadge: React.FC<{ ev: PerformerEvaluation }> = ({ ev }) => (
  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500" title={ev.source === 'AI' ? 'Written by the AI from the figures' : 'Written by rules from the same figures (the AI is not configured or did not answer)'}>
    <Sparkles className="w-3 h-3 text-blue-600" aria-hidden="true" />
    {ev.source === 'AI' ? 'AI evaluation' : 'Evaluation from the figures'}
    {!ev.current && <span className="text-amber-700"> · updating</span>}
  </span>
);

/** A horizontal bar for a 0-100 measure; a measure with no data says so instead of showing an empty bar as zero. */
export const MeasureBar: React.FC<{ label: string; value: number | null; weight: number; detail: string }> = ({ label, value, weight, detail }) => (
  <div>
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="font-semibold text-slate-700">{label} <span className="font-normal text-slate-400">· weight {weight}</span></span>
      <span className="font-bold tabular-nums text-slate-900">{value === null ? 'No data' : `${value}%`}</span>
    </div>
    <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${label}: ${value === null ? 'no data' : `${value} percent`}`}>
      {value !== null && <div className={`h-full rounded-full ${value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-blue-500' : 'bg-amber-500'}`} style={{ width: `${value}%` }} />}
    </div>
    <div className="mt-0.5 text-[11px] text-slate-500">{detail}</div>
  </div>
);

/** One performer's card: name, designation, picture, score, rank, completed tasks, productivity and the evaluation. */
export const PerformerTile: React.FC<{ p: PerformerCard; onOpen: () => void; highlight?: boolean }> = ({ p, onOpen, highlight }) => (
  <article className={`bg-white rounded-2xl border p-4 flex flex-col gap-3 ${highlight ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'}`} data-testid="performer-card" aria-label={`${p.name}, rank ${p.rank ?? 'not ranked'}`}>
    <div className="flex items-start gap-3">
      <PersonAvatar name={p.name} url={p.avatarUrl} size={48} />
      <div className="min-w-0 flex-1">
        <div className="font-extrabold text-slate-900 truncate">{p.name}</div>
        <div className="text-xs text-slate-500 truncate">{p.designation}{p.teamName ? ` · ${p.teamName}` : ''}</div>
        <div className="mt-1"><TrendBadge trend={p.trend} change={p.change} /></div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rank</div>
        <div className="text-2xl font-extrabold text-slate-900 leading-none" data-testid="performer-rank">{p.rank === null ? '—' : `#${p.rank}`}</div>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl bg-slate-50 py-2"><div className={`text-lg font-extrabold tabular-nums ${scoreTone(p.score)}`} data-testid="performer-score">{num(p.score)}</div><div className="text-[11px] text-slate-500">Score</div></div>
      <div className="rounded-xl bg-slate-50 py-2"><div className="text-lg font-extrabold tabular-nums text-slate-900">{p.metrics.tasks.completed}</div><div className="text-[11px] text-slate-500">Completed</div></div>
      <div className="rounded-xl bg-slate-50 py-2"><div className="text-lg font-extrabold tabular-nums text-slate-900">{pct(p.metrics.productivityPct)}</div><div className="text-[11px] text-slate-500">Productivity</div></div>
    </div>
    <p className="text-xs text-slate-600 leading-snug line-clamp-3 min-h-[3rem]">{p.evaluation?.summary ?? (p.status === 'INSUFFICIENT_DATA' ? p.insufficientReasons[0] : 'The evaluation is being prepared.')}</p>
    <button type="button" onClick={onOpen} className="self-start text-sm font-bold text-blue-700 hover:underline" aria-label={`Open the full card of ${p.name}`}>Full card</button>
  </article>
);

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-[11px] font-semibold text-slate-500">{label}</div><div className="text-base font-extrabold text-slate-900 tabular-nums">{value}</div></div>
);

/** The full individual performance card: figures, the measures behind the score and the evaluation. */
export const PerformerDetail: React.FC<{ p: PerformerCard; onClose: () => void }> = ({ p, onClose }) => {
  const t = p.metrics.tasks;
  const r = p.metrics.reports;
  const ex = t.excluded;
  const ev = p.evaluation;
  return (
    <Dialog title={p.name} description={`${p.designation}${p.teamName ? ` · ${p.teamName}` : ''}`} onClose={onClose} wide>
      <div className="space-y-5" data-testid="performer-detail">
        <div className="flex flex-wrap items-center gap-4">
          <PersonAvatar name={p.name} url={p.avatarUrl} size={56} />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{p.status === 'RANKED' ? 'Performance score' : 'Insufficient Data'}</div>
            <div className={`text-4xl font-extrabold tabular-nums ${scoreTone(p.score)}`}>{num(p.score)}</div>
          </div>
          <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Rank</div><div className="text-2xl font-extrabold text-slate-900">{p.rank === null ? '—' : `#${p.rank}`}</div></div>
          <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Against last month</div><TrendBadge trend={p.trend} change={p.change} /></div>
        </div>

        {p.status === 'INSUFFICIENT_DATA' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900" role="note">
            <b>Insufficient Data:</b> not ranked, so nobody is compared unfairly. {p.insufficientReasons.join(' ')}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Tasks assigned" value={t.assigned} />
          <Stat label="Tasks completed" value={t.completed} />
          <Stat label="Judged tasks" value={`${t.judgedDone} of ${t.judged}`} />
          <Stat label="Productivity" value={pct(p.metrics.productivityPct)} />
          <Stat label="On time / late" value={`${t.onTime} / ${t.late}`} />
          <Stat label="Approved reports" value={r.approved} />
          <Stat label="Waiting / sent back" value={`${r.pending} / ${r.rejected + r.revision}`} />
          <Stat label="Report coverage" value={pct(r.coveragePct)} />
        </div>

        {p.components.length > 0 && (
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 mb-2">How the score was made</h3>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
              {p.components.map(c => <MeasureBar key={c.key} label={c.label} value={c.value} weight={c.weight} detail={c.detail} />)}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">A measure with no data is left out and the others are scaled. Only approved reports count; duplicates count once ({ex.duplicates} here), instantly ticked tasks are not credited ({ex.instant}), tasks handed to members are theirs ({ex.delegated}), and blocked tasks are not penalised ({ex.blocked}).</p>
          </div>
        )}

        <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 space-y-2" data-testid="performer-evaluation">
          <div className="flex items-center gap-2"><Award className="w-4 h-4 text-blue-700" aria-hidden="true" /><h3 className="text-sm font-extrabold text-slate-900">Evaluation</h3>{ev && <SourceBadge ev={ev} />}</div>
          {!ev ? <p className="text-sm text-slate-500">{p.status === 'RANKED' ? 'The evaluation is being prepared.' : 'No evaluation without enough data.'}</p> : (
            <>
              <p className="text-sm text-slate-800">{ev.summary}</p>
              {ev.whyRanked && <p className="text-sm text-slate-700"><b>Why this score: </b>{ev.whyRanked}</p>}
              {ev.strengths.length > 0 && <div><div className="text-xs font-bold text-emerald-800">Strengths</div><ul className="list-disc pl-5 text-sm text-slate-700">{ev.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              {ev.improvementAreas.length > 0 && <div><div className="text-xs font-bold text-amber-800">To improve</div><ul className="list-disc pl-5 text-sm text-slate-700">{ev.improvementAreas.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export { Pill };
