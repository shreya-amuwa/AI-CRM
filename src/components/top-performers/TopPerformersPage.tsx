import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Award, CheckCircle2, RefreshCw, Search, Trophy, XCircle } from 'lucide-react';
import type { PerformerCard, PerformerRecognition, PerformersCompany, PerformersDepartment } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { performersApi } from '../../lib/api/endpoints';
import { monthLabel, officeMonth } from '../../lib/officeTime';
import { PageTitle } from '../layout/shell';
import { KpiCard } from '../performance/KpiCard';
import { Card, CardHead, fieldCls, LoadingLine, Tabs } from '../tasks/head/headParts';
import { btn, Dialog, ErrorBanner, longDateTime, inputCls } from '../team-member/pipeline/shared';
import { AWARD_LABEL, AWARD_ORDER, MeasureBar, PerformerDetail, PerformerTile, PersonAvatar, Pill, SourceBadge, STATUS_LABEL, STATUS_TONE, TrendBadge, num, pct, scoreTone } from './parts';

/**
 * Top Performers & Rankings. The Department Head sees their own department (and decides the monthly recognition); an Operations Head or the
 * Super Admin sees the departments they oversee side by side and can open any of them (read only). Every figure is calculated by the database
 * from the real task and approved report records; this screen only shows it. Who may see what is decided by the database.
 */
const MONTHS_BACK = 24;
const minMonth = () => {
  const [y, m] = officeMonth().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - MONTHS_BACK, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const lastMonth = () => {
  const [y, m] = officeMonth().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const MonthBar: React.FC<{ month: string; onChange: (m: string) => void; closed?: boolean; right?: React.ReactNode }> = ({ month, onChange, closed, right }) => (
  <Card label="Month" className="p-5">
    <div className="flex flex-wrap items-end gap-4">
      <label className="block">
        <span className="block text-xs font-semibold text-slate-500 mb-1.5">Month</span>
        <input type="month" className={`${fieldCls} w-44`} value={month} min={minMonth()} max={officeMonth()} onChange={e => e.target.value && onChange(e.target.value)} data-testid="month-picker" />
      </label>
      <div className="flex gap-2 pb-0.5">
        <button type="button" className="h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50" onClick={() => onChange(officeMonth())}>This month</button>
        <button type="button" className="h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50" onClick={() => onChange(lastMonth())}>Last month</button>
      </div>
      <div className="text-sm text-slate-600 pb-2.5">
        Showing <b className="text-slate-900">{monthLabel(month)}</b>
        {closed !== undefined && <span className="ml-2 text-xs text-slate-500">{closed ? 'The month is over: recognition can be decided.' : 'The month is still running: figures and recommendations are provisional.'}</span>}
      </div>
      <div className="ml-auto pb-0.5">{right}</div>
    </div>
  </Card>
);

// --------------------------------------------------------------------------- one department
type DeptTab = 'ranking' | 'leads' | 'recognition' | 'compare' | 'insights' | 'method';

const DecisionDialog: React.FC<{ rec: PerformerRecognition; approve: boolean; onClose: () => void; onDone: () => void }> = ({ rec, approve, onClose, onDone }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!approve && note.trim().length < 3) return setError('Give the reason for rejecting.');
    setBusy(true);
    setError(null);
    try {
      await performersApi.decide(rec.id, { decision: approve ? 'APPROVE' : 'REJECT', note: note.trim() || undefined });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={approve ? `Approve ${AWARD_LABEL[rec.awardType]}?` : `Do not approve ${AWARD_LABEL[rec.awardType]}?`} description={`${rec.name} · ${monthLabel(rec.month.slice(0, 7))}`} onClose={onClose} persistent={busy}>
      <div className="space-y-3">
        <p className="text-sm text-slate-700">{approve ? 'This makes the recognition official and tells the employee.' : 'The recommendation stays on record as not approved.'}</p>
        <label className="block text-xs font-semibold text-slate-700">{approve ? 'Note (optional)' : 'Reason (required)'}
          <textarea className={`${inputCls} mt-1 min-h-[5rem]`} value={note} onChange={e => setNote(e.target.value)} maxLength={500} data-testid="decision-note" />
        </label>
        {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={approve ? btn.green : btn.primary} onClick={() => void send()} disabled={busy} data-testid="decision-confirm">{busy ? 'Saving…' : approve ? 'Approve' : 'Reject'}</button>
        </div>
      </div>
    </Dialog>
  );
};

const RecognitionItem: React.FC<{ r: PerformerRecognition; canDecide: boolean; closed: boolean; onDecide: (r: PerformerRecognition, approve: boolean) => void; showMonth?: boolean }> = ({ r, canDecide, closed, onDecide, showMonth }) => (
  <li className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-start gap-3" data-testid="recognition-item" data-status={r.status} data-award={r.awardType}>
    <PersonAvatar name={r.name} url={r.avatarUrl} size={44} />
    <div className="min-w-0 flex-1 basis-60">
      <div className="text-[11px] font-bold uppercase tracking-wide text-blue-700">{AWARD_LABEL[r.awardType]}{r.awardType === 'TOP_EMPLOYEE' ? ` · #${r.place}` : ''}{showMonth ? ` · ${monthLabel(r.month.slice(0, 7))}` : ''}</div>
      <div className="font-extrabold text-slate-900">{r.name}</div>
      <div className="text-xs text-slate-500">{r.designation}{r.departmentName ? ` · ${r.departmentName}` : ''}</div>
      <p className="mt-1 text-xs text-slate-600">{r.reason}</p>
      {r.summary && <p className="mt-1 text-xs text-slate-500 italic line-clamp-2">{r.summary}</p>}
      {r.status !== 'RECOMMENDED' && <p className="mt-1 text-[11px] text-slate-500">{r.status === 'APPROVED' ? 'Approved' : 'Not approved'} by {r.decidedBy ?? 'the Department Head'}{r.decidedAt ? ` · ${longDateTime(r.decidedAt)}` : ''}{r.decisionNote ? ` · “${r.decisionNote}”` : ''}</p>}
    </div>
    <div className="flex flex-col items-end gap-2">
      <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
      {canDecide && r.status === 'RECOMMENDED' && (
        <div className="flex gap-2">
          <button type="button" className={btn.green} disabled={!closed} title={closed ? undefined : 'The month is not over yet'} onClick={() => onDecide(r, true)} data-testid="approve-recognition"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Approve</button>
          <button type="button" className={btn.secondary} disabled={!closed} title={closed ? undefined : 'The month is not over yet'} onClick={() => onDecide(r, false)} data-testid="reject-recognition"><XCircle className="w-3.5 h-3.5" aria-hidden="true" /> Reject</button>
        </div>
      )}
    </div>
  </li>
);

const Bars: React.FC<{ rows: { label: string; value: number | null; note?: string }[] }> = ({ rows }) => (
  <ul className="space-y-2" data-testid="trend-bars">
    {rows.map(r => (
      <li key={r.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-xs">
        <span className="font-semibold text-slate-600">{r.label}</span>
        <div className="h-3 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${r.label}: ${r.value === null ? 'no data' : r.value}`}>{r.value !== null && <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, r.value)}%` }} />}</div>
        <span className="font-bold tabular-nums text-slate-900">{r.value === null ? '—' : r.value}{r.note ? <span className="ml-2 font-normal text-slate-400">{r.note}</span> : null}</span>
      </li>
    ))}
  </ul>
);

export const DepartmentView: React.FC<{ departmentId?: string; onBack?: () => void }> = ({ departmentId, onBack }) => {
  const [month, setMonth] = useState(officeMonth());
  const [data, setData] = useState<PerformersDepartment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [tab, setTab] = useState<DeptTab>('ranking');
  const [topN, setTopN] = useState<'3' | '5'>('3');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PerformerCard | null>(null);
  const [decision, setDecision] = useState<{ rec: PerformerRecognition; approve: boolean } | null>(null);
  const tried = useRef(new Set<string>());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await performersApi.department({ month, departmentId }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [month, departmentId]);
  useEffect(() => { void load(); }, [load]);

  // The written evaluations are prepared once per figures: when some are missing, ask for them once and show the result.
  useEffect(() => {
    if (!data || data.evaluationsPending === 0) return;
    const key = `${data.department.id}:${data.month}:${data.evaluationsPending}`;
    if (tried.current.has(key)) return;
    tried.current.add(key);
    setEvaluating(true);
    performersApi.evaluate({ month, departmentId }).then(run => setData(run.data), () => undefined).finally(() => setEvaluating(false));
  }, [data, month, departmentId]);

  const ranked = useMemo(() => (data?.employees ?? []).filter(e => e.status === 'RANKED'), [data]);
  const top = ranked.slice(0, Number(topN));
  const eom = data?.recognitions.find(r => r.awardType === 'EMPLOYEE_OF_MONTH') ?? null;
  const shown = useMemo(() => (data?.employees ?? []).filter(e => !query || e.name.toLowerCase().includes(query.toLowerCase())), [data, query]);
  const grouped = useMemo(() => AWARD_ORDER.map(a => ({ award: a, items: (data?.recognitions ?? []).filter(r => r.awardType === a).sort((x, y) => x.place - y.place) })).filter(g => g.items.length), [data]);
  const s = data?.summary;
  const change = s && s.avgScore !== null && s.previousAvgScore !== null ? Math.round((s.avgScore - s.previousAvgScore) * 10) / 10 : null;
  const pending = data?.recognitions.filter(r => r.status === 'RECOMMENDED').length ?? 0;
  const improving = [...(data?.employees ?? []), ...(data?.teamLeads ?? [])].filter(p => p.trend === 'IMPROVING');
  const declining = [...(data?.employees ?? []), ...(data?.teamLeads ?? [])].filter(p => p.trend === 'DECLINING');

  const header = (
    <PageTitle
      title={onBack && data ? `${data.department.name}: Top Performers & Rankings` : 'Top Performers & Rankings'}
      subtitle="Scores are calculated from the real task records and approved reports. AI recommendations become official only when the Department Head approves them."
      actions={onBack ? <button type="button" className={btn.secondary} onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> All departments</button> : undefined}
    />
  );

  return (
    <div className="space-y-6" data-testid="top-performers-page">
      {header}
      <MonthBar month={month} onChange={setMonth} closed={data?.monthClosed} right={<button type="button" className={btn.secondary} onClick={() => void load()}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh</button>} />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {loading && !data && <LoadingLine label="Calculating the rankings from the records…" />}
      {evaluating && <p role="status" className="text-xs font-semibold text-blue-700">Preparing the evaluations…</p>}

      {data && s && (
        <>
          <div className="grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 items-stretch" role="group" aria-label="Department summary">
            <KpiCard label="Department performance" value={s.avgScore === null ? null : `${s.avgScore}`} tone="blue" testId="kpi-dept-score" description={s.avgScore === null ? 'Nobody has enough data yet' : change === null ? 'average score of ranked people' : `${change >= 0 ? '+' : ''}${change} against last month`} />
            <KpiCard label="Ranked people" value={`${s.ranked} of ${s.people}`} testId="kpi-ranked" description={s.insufficient > 0 ? `employees and Team Leads; ${s.insufficient} with Insufficient Data` : 'employees and Team Leads: everyone has enough data'} />
            <KpiCard label="Task completion" value={s.taskCompletionPct === null ? null : `${s.taskCompletionPct}%`} testId="kpi-completion" description="priority-weighted, employees" />
            <KpiCard label="Report coverage" value={s.reportCoveragePct === null ? null : `${s.reportCoveragePct}%`} testId="kpi-coverage" description="working days covered by approved reports" />
            <KpiCard label="Waiting for your decision" value={pending} tone={pending ? 'amber' : 'neutral'} testId="kpi-pending" description={data.canDecide ? 'recognition recommendations' : 'recognition recommendations (the Department Head decides)'} />
          </div>

          {eom && (
            <Card label="Employee of the Month" className="p-5 border-blue-200 bg-gradient-to-r from-blue-50/70 to-white">
              <div className="flex flex-wrap items-center gap-4" data-testid="eom-card">
                <Trophy className="w-8 h-8 text-amber-500" aria-hidden="true" />
                <PersonAvatar name={eom.name} url={eom.avatarUrl} size={56} />
                <div className="min-w-0 flex-1 basis-60">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-blue-700">{eom.status === 'APPROVED' ? 'Employee of the Month' : 'Recommended: Employee of the Month'} · {monthLabel(data.month.slice(0, 7))}</div>
                  <div className="text-lg font-extrabold text-slate-900">{eom.name}</div>
                  <p className="text-sm text-slate-600">{eom.reason}</p>
                  {eom.summary && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{eom.summary}</p>}
                </div>
                <Pill tone={STATUS_TONE[eom.status]}>{STATUS_LABEL[eom.status]}</Pill>
              </div>
            </Card>
          )}

          <Card>
            <CardHead title="Top performers" hint="Ranked on the overall score: task completion, deadlines, report approval and consistency, not on the number of tasks alone"
              right={<Tabs label="How many" value={topN} onChange={setTopN} options={[{ id: '3', label: 'Top 3' }, { id: '5', label: 'Top 5' }]} />} />
            {top.length === 0 ? (
              <p className="px-5 pb-6 text-sm text-slate-500" data-testid="no-ranked">No employee has enough data to be ranked for this month yet.</p>
            ) : (
              <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="top-cards">
                {top.map(p => <PerformerTile key={p.profileId} p={p} highlight={p.rank === 1} onOpen={() => setOpen(p)} />)}
              </div>
            )}
          </Card>

          <Tabs label="Views" value={tab} onChange={setTab} options={[
            { id: 'ranking', label: 'Complete ranking', count: data.employees.length },
            { id: 'leads', label: 'Team Leads', count: data.teamLeads.length },
            { id: 'recognition', label: 'Monthly recognition', count: data.recognitions.length },
            { id: 'compare', label: 'Monthly comparison' },
            { id: 'insights', label: 'AI insights' },
            { id: 'method', label: 'How scores work' }
          ]} />

          {tab === 'ranking' && (
            <Card>
              <CardHead title="Complete employee ranking" hint="Team Members of the department. People with too little data are listed last as Insufficient Data and are not ranked." />
              <div className="px-5 pb-4">
                <label className="relative block max-w-sm"><span className="sr-only">Search by name</span>
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                  <input className={`${fieldCls} pl-9`} placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} /></label>
              </div>
              {shown.length === 0 ? <p className="px-5 pb-8 text-sm text-slate-500">{data.employees.length === 0 ? 'No Team Members in this department yet.' : 'Nobody matches the search.'}</p> : (
                <div className="relative overflow-x-auto">
                  <table className="w-full text-sm min-w-[48rem]" data-testid="ranking-table">
                    <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50/60">
                      <th scope="col" className="px-5 py-2.5 font-semibold">Rank</th><th scope="col" className="px-3 py-2.5 font-semibold">Employee</th><th scope="col" className="px-3 py-2.5 font-semibold">Score</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Trend</th><th scope="col" className="px-3 py-2.5 font-semibold">Tasks done</th><th scope="col" className="px-3 py-2.5 font-semibold">Productivity</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Reports</th><th scope="col" className="px-5 py-2.5"><span className="sr-only">Open</span></th></tr></thead>
                    <tbody>
                      {shown.map(p => (
                        <tr key={p.profileId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60" data-testid="ranking-row" data-status={p.status}>
                          <td className="px-5 py-3 font-extrabold text-slate-900">{p.rank === null ? '—' : `#${p.rank}`}</td>
                          <td className="px-3 py-3"><div className="flex items-center gap-2.5 min-w-0"><PersonAvatar name={p.name} url={p.avatarUrl} size={34} /><div className="min-w-0"><div className="font-bold text-slate-900 truncate">{p.name}</div><div className="text-xs text-slate-500 truncate">{p.designation}{p.teamName ? ` · ${p.teamName}` : ''}</div></div></div></td>
                          <td className={`px-3 py-3 font-extrabold tabular-nums ${scoreTone(p.score)}`}>{p.status === 'RANKED' ? num(p.score) : <Pill tone="orange">Insufficient Data</Pill>}</td>
                          <td className="px-3 py-3"><TrendBadge trend={p.trend} change={p.change} /></td>
                          <td className="px-3 py-3 text-slate-700">{p.metrics.tasks.completed} <span className="text-xs text-slate-500">of {p.metrics.tasks.assigned}</span></td>
                          <td className="px-3 py-3 text-slate-700">{pct(p.metrics.productivityPct)}</td>
                          <td className="px-3 py-3 text-slate-700">{p.metrics.reports.approved} <span className="text-xs text-slate-500">approved{p.metrics.reports.pending ? ` · ${p.metrics.reports.pending} waiting` : ''}</span></td>
                          <td className="px-5 py-3 text-right"><button type="button" onClick={() => setOpen(p)} className="text-sm font-bold text-blue-700 hover:underline" aria-label={`Open the card of ${p.name}`}>Card</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === 'leads' && (
            <Card>
              <CardHead title="Team Leads compared" hint="Own tasks and reports, the team's results, how fast reports are reviewed, how work is spread, and the team's improvement" />
              {data.teamLeads.length === 0 ? <p className="px-5 pb-8 text-sm text-slate-500">No Team Leads in this department yet.</p> : (
                <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="lead-cards">
                  {data.teamLeads.map(p => <PerformerTile key={p.profileId} p={p} highlight={p.rank === 1} onOpen={() => setOpen(p)} />)}
                </div>
              )}
            </Card>
          )}

          {tab === 'recognition' && (
            <div className="space-y-4" data-testid="recognition-panel">
              <Card>
                <CardHead title={`Recognition for ${monthLabel(data.month.slice(0, 7))}`} hint={data.canDecide ? (data.monthClosed ? 'Review the AI recommendations. Nothing is official until you approve it.' : 'Recommendations are provisional until the month ends. You can approve them afterwards.') : 'Read only: the Department Head of the department approves recognition.'} />
                {grouped.length === 0 ? <p className="px-5 pb-8 text-sm text-slate-500">No recommendation yet: at least two ranked employees (and two ranked Team Leads for the Team Lead award) are needed.</p> : (
                  <div className="px-5 pb-5 space-y-5">
                    {grouped.map(g => (
                      <section key={g.award} aria-label={AWARD_LABEL[g.award]}>
                        <h3 className="text-sm font-extrabold text-slate-900 mb-2 flex items-center gap-2"><Award className="w-4 h-4 text-blue-700" aria-hidden="true" />{AWARD_LABEL[g.award]}</h3>
                        <ul className="space-y-2">{g.items.map(r => <RecognitionItem key={r.id} r={r} canDecide={data.canDecide} closed={data.monthClosed} onDecide={(rec, approve) => setDecision({ rec, approve })} />)}</ul>
                      </section>
                    ))}
                  </div>
                )}
              </Card>
              {data.approvedHistory.length > 0 && (
                <Card>
                  <CardHead title="Past official recognition" hint="Approved by the Department Head in earlier months" />
                  <ul className="px-5 pb-5 space-y-2" data-testid="recognition-history">{data.approvedHistory.map(r => <RecognitionItem key={r.id} r={r} canDecide={false} closed onDecide={() => undefined} showMonth />)}</ul>
                </Card>
              )}
            </div>
          )}

          {tab === 'compare' && (
            <div className="grid lg:grid-cols-2 gap-4">
              <Card><CardHead title="Monthly comparison" hint="Average score of the ranked people, month by month" />
                <div className="px-5 pb-5">{data.monthly.length === 0 ? <p className="text-sm text-slate-500">No earlier months yet.</p> : <Bars rows={data.monthly.map(m => ({ label: monthLabel(m.month.slice(0, 7)), value: m.avgScore, note: `${m.ranked} ranked` }))} />}</div></Card>
              <Card><CardHead title="Quarterly comparison" hint="Average score by quarter" />
                <div className="px-5 pb-5">{data.quarterly.length === 0 ? <p className="text-sm text-slate-500">No quarter yet.</p> : <Bars rows={data.quarterly.map(q => ({ label: `Q${Math.floor((Number(q.quarterStart.slice(5, 7)) - 1) / 3) + 1} ${q.quarterStart.slice(0, 4)}`, value: q.avgScore, note: `${q.ranked} scores` }))} />}</div></Card>
            </div>
          )}

          {tab === 'insights' && (
            <Card>
              <CardHead title="Performance insights" hint="Calculated from the figures. Each person's written evaluation (AI when it is configured) is on their card." />
              <ul className="px-5 pb-5 space-y-3 text-sm text-slate-700" data-testid="insights">
                <li>{s.avgScore === null ? 'Nobody has enough data to be ranked yet.' : `The department scored ${s.avgScore}${change === null ? '' : `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)} points on last month`}. ${s.ranked} of ${s.people} people have enough data.`}</li>
                {improving.length > 0 && <li><b className="text-emerald-800">Improving: </b>{improving.map(p => `${p.name} (+${p.change})`).join(', ')}.</li>}
                {declining.length > 0 && <li><b className="text-rose-800">Declining: </b>{declining.map(p => `${p.name} (${p.change})`).join(', ')}.</li>}
                {s.insufficient > 0 && <li><b className="text-amber-800">Insufficient Data: </b>{[...data.employees, ...data.teamLeads].filter(p => p.status === 'INSUFFICIENT_DATA').map(p => p.name).join(', ')}: not ranked, so nobody is compared unfairly.</li>}
                {[...data.employees].filter(p => p.status === 'RANKED' && (p.metrics.reports.coveragePct ?? 0) === 0).length > 0 && <li><b>No approved reports: </b>{data.employees.filter(p => p.status === 'RANKED' && (p.metrics.reports.coveragePct ?? 0) === 0).map(p => p.name).join(', ')}. Reports that are not approved do not raise a score.</li>}
                {ranked[0]?.evaluation && <li><b>Highest score: </b>{ranked[0].evaluation.summary} <SourceBadge ev={ranked[0].evaluation} /></li>}
              </ul>
            </Card>
          )}

          {tab === 'method' && (
            <Card>
              <CardHead title="How scores work" hint="The same methodology for everyone; every measure and weight is shown on the person's card" />
              <div className="px-5 pb-5 grid md:grid-cols-2 gap-6">
                {([['Team Members', data.methodology.member], ['Team Leads', data.methodology.teamLead]] as const).map(([title, list]) => (
                  <div key={title}><h3 className="text-sm font-extrabold text-slate-900 mb-2">{title}</h3>
                    <ul className="space-y-2">{list.map(c => <li key={c.key}><MeasureBar label={c.label} value={c.weight} weight={c.weight} detail="" /></li>)}</ul></div>
                ))}
                <ul className="md:col-span-2 list-disc pl-5 text-sm text-slate-700 space-y-1" data-testid="methodology-rules">{data.methodology.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            </Card>
          )}
        </>
      )}

      {open && <PerformerDetail p={open} onClose={() => setOpen(null)} />}
      {decision && <DecisionDialog rec={decision.rec} approve={decision.approve} onClose={() => setDecision(null)} onDone={() => { setDecision(null); void load(); }} />}
    </div>
  );
};

// --------------------------------------------------------------------------- company (Operations Head / Super Admin)
export const CompanyView: React.FC = () => {
  const [month, setMonth] = useState(officeMonth());
  const [data, setData] = useState<PerformersCompany | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dept, setDept] = useState<string | null>(null);
  const [open, setOpen] = useState<PerformerCard | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await performersApi.company({ month }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  if (dept) return <DepartmentView departmentId={dept} onBack={() => setDept(null)} />;
  const pendingTotal = data?.departments.reduce((n, d) => n + d.pendingRecommendations, 0) ?? 0;
  const approvedTotal = data?.departments.reduce((n, d) => n + d.approvedRecognitions, 0) ?? 0;
  const rankedTotal = data?.departments.reduce((n, d) => n + d.ranked, 0) ?? 0;
  const best = data?.departments.find(d => d.avgScore !== null) ?? null;

  return (
    <div className="space-y-6" data-testid="company-performers">
      <PageTitle title="Top Performers & Rankings" subtitle="Departments compared on the same method, from the real task and approved report records. Each Department Head approves the recognition of their own department." />
      <MonthBar month={month} onChange={setMonth} closed={data?.monthClosed} right={<button type="button" className={btn.secondary} onClick={() => void load()}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh</button>} />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {loading && !data && <LoadingLine label="Calculating the rankings from the records…" />}
      {data && (
        <>
          <div className="grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-4 gap-3 items-stretch" role="group" aria-label="Company summary">
            <KpiCard label="Departments" value={data.departments.length} testId="kpi-departments" description="in your scope" />
            <KpiCard label="Highest performing department" value={best ? best.name : null} tone="blue" testId="kpi-best-dept" description={best ? `average score ${best.avgScore}` : 'No department has enough data yet'} />
            <KpiCard label="Ranked people" value={rankedTotal} testId="kpi-ranked-total" description="with enough data this month" />
            <KpiCard label="Recognition" value={`${approvedTotal} official`} testId="kpi-recognition" description={`${pendingTotal} recommendation(s) waiting for a Department Head`} />
          </div>

          <Card>
            <CardHead title="Departments ranked by average score" hint="Open a department to see its employees, Team Leads and recognition (read only)" />
            {data.departments.length === 0 ? <p className="px-5 pb-8 text-sm text-slate-500">No department is in your scope.</p> : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm min-w-[56rem]" data-testid="department-table">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50/60">
                    <th scope="col" className="px-5 py-2.5 font-semibold">Department</th><th scope="col" className="px-3 py-2.5 font-semibold">Avg score</th><th scope="col" className="px-3 py-2.5 font-semibold">Ranked</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Task completion</th><th scope="col" className="px-3 py-2.5 font-semibold">Report coverage</th><th scope="col" className="px-3 py-2.5 font-semibold">Top employee</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Top Team Lead</th><th scope="col" className="px-3 py-2.5 font-semibold">Recognition</th><th scope="col" className="px-5 py-2.5"><span className="sr-only">Open</span></th></tr></thead>
                  <tbody>
                    {data.departments.map(d => {
                      const ch = d.avgScore !== null && d.previousAvgScore !== null ? Math.round((d.avgScore - d.previousAvgScore) * 10) / 10 : null;
                      return (
                        <tr key={d.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60" data-testid="department-row">
                          <td className="px-5 py-3 font-bold text-slate-900">{d.name}</td>
                          <td className={`px-3 py-3 font-extrabold tabular-nums ${scoreTone(d.avgScore)}`}>{num(d.avgScore)} {ch !== null && <span className={`text-xs font-semibold ${ch >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{ch >= 0 ? '+' : ''}{ch}</span>}</td>
                          <td className="px-3 py-3 text-slate-700">{d.ranked} of {d.people}{d.insufficient ? <span className="text-xs text-amber-700"> · {d.insufficient} insufficient</span> : null}</td>
                          <td className="px-3 py-3 text-slate-700">{pct(d.taskCompletionPct)}</td>
                          <td className="px-3 py-3 text-slate-700">{pct(d.reportCoveragePct)}</td>
                          <td className="px-3 py-3 text-slate-700">{d.topEmployee ? `${d.topEmployee.name} (${d.topEmployee.score})` : '—'}</td>
                          <td className="px-3 py-3 text-slate-700">{d.topTeamLead ? `${d.topTeamLead.name} (${d.topTeamLead.score})` : '—'}</td>
                          <td className="px-3 py-3 text-xs text-slate-600">{d.approvedRecognitions} official · {d.pendingRecommendations} waiting</td>
                          <td className="px-5 py-3 text-right"><button type="button" className="text-sm font-bold text-blue-700 hover:underline" onClick={() => setDept(d.id)} aria-label={`Open ${d.name}`}>Open</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Top employees across departments" hint="The ten highest scores in your scope" />
            {data.topEmployees.length === 0 ? <p className="px-5 pb-8 text-sm text-slate-500">No employee has enough data to be ranked for this month yet.</p> : (
              <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="company-top-employees">
                {data.topEmployees.map(p => <div key={p.profileId} className="space-y-1"><div className="text-[11px] font-bold uppercase tracking-wide text-blue-700">{p.departmentName}</div><PerformerTile p={p} onOpen={() => setOpen(p)} /></div>)}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Best Team Leads" hint="Own work, team results, report review speed, task distribution and team improvement" />
            {data.topTeamLeads.length === 0 ? <p className="px-5 pb-8 text-sm text-slate-500">No Team Lead has enough data to be ranked for this month yet.</p> : (
              <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {data.topTeamLeads.map(p => <div key={p.profileId} className="space-y-1"><div className="text-[11px] font-bold uppercase tracking-wide text-blue-700">{p.departmentName}</div><PerformerTile p={p} onOpen={() => setOpen(p)} /></div>)}
              </div>
            )}
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHead title="Historical trend" hint="Average score of each department, last six months" />
              <div className="px-5 pb-5 space-y-4" data-testid="company-trends">
                {data.trends.length === 0 ? <p className="text-sm text-slate-500">No history yet.</p> : data.trends.map(t => (
                  <div key={t.departmentId}><div className="text-xs font-bold text-slate-700 mb-1">{t.name}</div>
                    <Bars rows={t.points.map(p => ({ label: monthLabel(p.month.slice(0, 7)), value: p.avgScore }))} /></div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHead title="Recommendations and official recognition" hint="Read only: each Department Head decides their own department" />
              {data.recognitions.length === 0 ? <p className="px-5 pb-8 text-sm text-slate-500">No recommendation for this month yet.</p> : (
                <ul className="px-5 pb-5 space-y-2 max-h-[40rem] overflow-y-auto" data-testid="company-recognitions">
                  {data.recognitions.map(r => <RecognitionItem key={r.id} r={r} canDecide={false} closed={data.monthClosed} onDecide={() => undefined} />)}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
      {open && <PerformerDetail p={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

export const TopPerformersPage: React.FC<{ mode: 'DEPARTMENT_HEAD' | 'COMPANY' }> = ({ mode }) => (mode === 'COMPANY' ? <CompanyView /> : <DepartmentView />);
