import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ClipboardList, Phone, RefreshCw, Target } from 'lucide-react';
import { TC_OUTCOMES, TC_REPORT_FIELDS, type TcProfile, type TcWeekRow } from '../../../../shared/hrUpgrade';
import { telecallerPerformanceApi } from '../../../lib/api/endpoints';
import { confirmAction, promptInput, toast } from '../../feedback/AppFeedback';
import { btn, ErrorBanner, inputCls, Pill, selectCls, Spinner, type Tone } from '../../team-member/pipeline/shared';
import { fmtDate, fmtDateTime, StatCard } from '../reviews/reviewUi';

/** Shared labels of the Telecaller performance screens (docs/hr-dashboard-upgrade.md, Phase 3). */
export const CATEGORY: Record<string, [string, Tone]> = {
  TARGET_ACHIEVED: ['Target achieved', 'green'], ON_TRACK: ['On track', 'indigo'], NEEDS_IMPROVEMENT: ['Needs improvement', 'orange'],
  LOW_PERFORMANCE: ['Low performance', 'red'], INSUFFICIENT_DATA: ['Insufficient data', 'slate'], SYNC_PENDING: ['Call sync pending', 'slate'],
  NOT_EVALUATED: ['Not evaluated', 'slate'], DATA_PENDING: ['Data pending', 'slate']
};
export const REVIEW: Record<string, [string, Tone]> = {
  NONE: ['–', 'slate'], PENDING_SCHEDULING: ['Pending scheduling', 'orange'], SCHEDULED: ['Meeting scheduled', 'indigo'], COMPLETED: ['Review completed', 'green'],
  CANCELLED: ['Meeting cancelled', 'slate'], NOT_REQUIRED: ['Not required', 'slate']
};
export const CategoryPill: React.FC<{ value: string }> = ({ value }) => { const [l, t] = CATEGORY[value] ?? [value, 'slate' as Tone]; return <Pill tone={t}>{l}</Pill>; };
export const ReviewPill: React.FC<{ value: string }> = ({ value }) => {
  if (value === 'NONE') return <span className="text-slate-400">–</span>;
  const [l, t] = REVIEW[value] ?? [value, 'slate' as Tone];
  return <Pill tone={t}>{l}</Pill>;
};
export const pctText = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(Number(v) * 10) / 10}%`);
export const talkText = (s: number | null | undefined) => (s === null || s === undefined ? '–' : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);
export const errText = (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f);
const OUTCOME_LABEL = Object.fromEntries(TC_OUTCOMES.map(o => [o.value, o.label]));

/** HR's meeting report (and the improvement plan when that is the outcome). */
const ReportForm: React.FC<{ week: TcWeekRow; onDone: (p: TcProfile) => void; onCancel: () => void }> = ({ week, onDone, onCancel }) => {
  const [outcome, setOutcome] = useState('PERFORMANCE_REVIEWED');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [followUp, setFollowUp] = useState('');
  const [plan, setPlan] = useState({ targets: '', support: '', deadline: '' });
  const [busy, setBusy] = useState(false);
  const wantsPlan = outcome === 'IMPROVEMENT_PLAN';
  const submit = async () => {
    if ((fields.performanceGap ?? '').trim().length < 5 || (fields.hrObservations ?? '').trim().length < 5) { toast.error('Record the performance gap and your observations.'); return; }
    if (wantsPlan && (plan.targets.trim().length < 5 || !plan.deadline)) { toast.error('An improvement plan needs the agreed targets and the review deadline.'); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { outcome, fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim())) };
      if (followUp) body.followUpDate = followUp;
      if (wantsPlan) body.plan = { targets: plan.targets, deadline: plan.deadline, ...(plan.support.trim() ? { support: plan.support } : {}) };
      onDone(await telecallerPerformanceApi.report(week.id, body));
      toast.success('Meeting report saved. The review is completed.');
    } catch (e) { toast.error(errText(e, 'The report could not be saved.')); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2" data-testid="tc-report-form">
      <p className="text-sm font-bold text-slate-800">Meeting report: week of {fmtDate(week.weekStart)}</p>
      {TC_REPORT_FIELDS.map(f => (
        <label key={f.key} className="block text-xs font-semibold text-slate-600">{f.label}{'required' in f && f.required ? ' (required)' : ''}
          <textarea className={`${inputCls} mt-1`} rows={2} maxLength={4000} value={fields[f.key] ?? ''} onChange={e => setFields({ ...fields, [f.key]: e.target.value })} /></label>
      ))}
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-slate-600">Outcome
          <select className={`${selectCls} w-full mt-1`} value={outcome} onChange={e => setOutcome(e.target.value)}>
            {TC_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Follow-up date (optional)
          <input type="date" className={`${inputCls} mt-1`} value={followUp} onChange={e => setFollowUp(e.target.value)} /></label>
      </div>
      {wantsPlan && (
        <div className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2">
          <label className="text-xs font-semibold text-slate-600">Agreed targets (required)
            <textarea className={`${inputCls} mt-1`} rows={2} value={plan.targets} onChange={e => setPlan({ ...plan, targets: e.target.value })} /></label>
          <label className="text-xs font-semibold text-slate-600">Support offered
            <textarea className={`${inputCls} mt-1`} rows={2} value={plan.support} onChange={e => setPlan({ ...plan, support: e.target.value })} /></label>
          <label className="text-xs font-semibold text-slate-600">Review deadline (required)
            <input type="date" className={`${inputCls} mt-1`} value={plan.deadline} onChange={e => setPlan({ ...plan, deadline: e.target.value })} /></label>
        </div>
      )}
      <p className="text-[11px] text-slate-500">This is a supportive review record. Nothing disciplinary is created, and the Telecaller does not see HR's notes.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className={btn.primary} onClick={() => void submit()} disabled={busy}>Save report</button>
      </div>
    </div>
  );
};

/** One week's HR actions: schedule / move / cancel the meeting, write the report, recalculate. The database checks each again. */
const WeekActions: React.FC<{ w: TcWeekRow; isHr: boolean; canRecalc: boolean; onChanged: () => void; onReport: () => void }> = ({ w, isHr, canRecalc, onChanged, onReport }) => {
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await f(); toast.success(ok); onChanged(); } catch (e) { toast.error(errText(e, 'That did not work.')); } finally { setBusy(false); }
  };
  const schedule = async () => {
    const at = await promptInput({ title: w.meetingId ? 'Move the review meeting' : 'Schedule a review meeting', label: 'Date and time (YYYY-MM-DD HH:MM, India time)', required: true });
    if (!at) return;
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/.exec(at.trim());
    if (!m) { toast.error('Use the form YYYY-MM-DD HH:MM, for example 2026-12-02 11:30.'); return; }
    await run(() => telecallerPerformanceApi.schedule(w.id, { startsAt: `${m[1]}T${m[2]}:${m[3]}:00+05:30` }), 'Review meeting scheduled. HR and the Telecaller are invited.');
  };
  const cancel = async () => {
    if (!(await confirmAction({ title: 'Cancel the review meeting?', description: 'The invitation is withdrawn in the meetings calendar.', confirmLabel: 'Cancel meeting', variant: 'destructive' }))) return;
    await run(() => telecallerPerformanceApi.schedule(w.id, { cancel: true }), 'Review meeting cancelled.');
  };
  const recalc = async () => {
    const reason = await promptInput({ title: `Recalculate the week of ${fmtDate(w.weekStart)}?`, label: 'Why (late call logs, corrected target …)', required: true });
    if (!reason) return;
    await run(() => telecallerPerformanceApi.recalculate(w.id, reason), 'Week recalculated. The previous figures are kept in the history.');
  };
  const open = w.reviewStatus === 'SCHEDULED' || w.reviewStatus === 'PENDING_SCHEDULING';
  return (
    <div className="flex flex-wrap gap-1.5">
      {isHr && w.reviewStatus !== 'COMPLETED' && <button type="button" className={btn.secondary} disabled={busy} onClick={() => void schedule()}><CalendarClock className="w-3.5 h-3.5" />{w.meetingId && w.reviewStatus === 'SCHEDULED' ? 'Move meeting' : 'Schedule meeting'}</button>}
      {isHr && w.reviewStatus === 'SCHEDULED' && <button type="button" className={btn.danger} disabled={busy} onClick={() => void cancel()}>Cancel meeting</button>}
      {isHr && open && <button type="button" className={btn.primary} disabled={busy} onClick={onReport}><ClipboardList className="w-3.5 h-3.5" />Write report</button>}
      {canRecalc && w.status === 'FINAL' && <button type="button" className={btn.secondary} disabled={busy} onClick={() => void recalc()}><RefreshCw className="w-3.5 h-3.5" />Recalculate</button>}
    </div>
  );
};

/**
 * One Telecaller's call performance: today and this week (live), the weekly history, review meetings, HR's reports and improvement plans.
 * The Telecaller sees their own figures, plans and meetings (never HR's notes); HR and the managers who cover them see more. The database decides.
 */
export const TelecallerProfile: React.FC<{ profileId: string; canRecalc?: boolean }> = ({ profileId, canRecalc = false }) => {
  const [p, setP] = useState<TcProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<TcWeekRow | null>(null);
  const load = useCallback(async () => {
    try { setP(await telecallerPerformanceApi.profile(profileId)); setError(null); } catch (e) { setError(errText(e, 'The call performance could not be loaded.')); }
  }, [profileId]);
  useEffect(() => { setP(null); void load(); }, [load]);
  const closePlan = async (id: string) => {
    const remarks = await promptInput({ title: 'Close the improvement plan', label: 'Closing remarks', required: true });
    if (!remarks) return;
    try { setP(await telecallerPerformanceApi.closePlan(id, remarks)); toast.success('Improvement plan closed.'); } catch (e) { toast.error(errText(e, 'The plan could not be closed.')); }
  };
  if (error) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!p) return <Spinner label="Loading call performance…" />;
  const w = p.thisWeek;
  return (
    <div className="space-y-4" data-testid="tc-profile">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Calls today" value={p.todayCalls} />
        <StatCard label="Daily target" value={p.dailyTarget ?? 'Not set'} />
        <StatCard label="This week (adjusted target)" value={w ? `${w.actualCalls} / ${w.adjustedTarget ?? '–'}` : '–'} />
        <StatCard label="This week's achievement" value={w ? pctText(w.achievement) : '–'} />
      </div>
      {!p.dailyTarget && <p className="text-xs text-slate-500 rounded-xl border border-dashed border-slate-200 p-2">No call target applies yet, so the weeks are shown as "Not evaluated".</p>}

      <section>
        <h3 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5"><Target className="w-4 h-4" />Weekly history</h3>
        {p.weeks.length === 0 ? <p className="text-sm text-slate-500">No weeks calculated yet. The figures appear after the first weekly run.</p> : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr>
                <th className="text-left p-2">Week</th><th className="text-right p-2">Working days</th><th className="text-right p-2">Target</th><th className="text-right p-2">Calls</th>
                <th className="text-right p-2">Connected</th><th className="text-right p-2">Achievement</th><th className="text-left p-2">Category</th><th className="text-left p-2">Review</th>
                {(p.isHr || canRecalc) && <th className="text-left p-2">Actions</th>}
              </tr></thead>
              <tbody>{p.weeks.map(x => (
                <tr key={x.id} className="border-t border-slate-100 align-top">
                  <td className="p-2 whitespace-nowrap">{fmtDate(x.weekStart)}{x.status === 'PRELIMINARY' && <span className="ml-1 text-[10px] text-slate-400">(preliminary)</span>}</td>
                  <td className="p-2 text-right">{x.eligibleDays}</td><td className="p-2 text-right">{x.adjustedTarget ?? '–'}</td><td className="p-2 text-right">{x.actualCalls}</td>
                  <td className="p-2 text-right">{x.connectedCalls}</td><td className="p-2 text-right font-semibold">{pctText(x.achievement)}</td>
                  <td className="p-2"><CategoryPill value={x.category} />{x.reason && <p className="text-[10px] text-slate-400 mt-0.5 max-w-[14rem]">{x.reason}</p>}</td>
                  <td className="p-2"><ReviewPill value={x.reviewStatus} />{x.meeting && <p className="text-[10px] text-slate-500 mt-0.5">{fmtDateTime(x.meeting.startsAt)}</p>}</td>
                  {(p.isHr || canRecalc) && <td className="p-2"><WeekActions w={x} isHr={p.isHr} canRecalc={canRecalc || p.isHr} onChanged={() => void load()} onReport={() => setReportFor(x)} /></td>}
                </tr>))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-[11px] text-slate-400">Call dispositions, qualified leads, campaigns and call quality are not provided by Crocodial, so they are not shown.</p>
      </section>
      {reportFor && <ReportForm week={reportFor} onCancel={() => setReportFor(null)} onDone={np => { setP(np); setReportFor(null); }} />}

      <section>
        <h3 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5"><Phone className="w-4 h-4" />Review meetings</h3>
        {p.meetings.length === 0 ? <p className="text-sm text-slate-500">No review meetings.</p> : (
          <ul className="space-y-1">{p.meetings.map(m => (
            <li key={m.id} className="text-sm rounded-xl border border-slate-200 bg-white px-3 py-2 flex flex-wrap justify-between gap-2">
              <span>{m.title}</span><span className="text-slate-500">{fmtDateTime(m.startsAt)} · {m.status.toLowerCase()}</span></li>))}</ul>
        )}
      </section>

      {p.reports.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-slate-800 mb-2">Meeting reports</h3>
          <ul className="space-y-2">{p.reports.map(r => (
            <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <p className="font-semibold">{OUTCOME_LABEL[r.outcome] ?? r.outcome} <span className="font-normal text-slate-500">· {r.by ?? 'HR'} · {fmtDateTime(r.at)}</span></p>
              {TC_REPORT_FIELDS.filter(f => r.fields[f.key]).map(f => <p key={f.key} className="mt-1"><span className="text-slate-500">{f.label}:</span> {r.fields[f.key]}</p>)}
              {r.followUpDate && <p className="mt-1 text-slate-500">Follow-up: {fmtDate(r.followUpDate)}</p>}
            </li>))}</ul>
        </section>
      )}

      <section>
        <h3 className="text-sm font-bold text-slate-800 mb-2">Improvement plans</h3>
        {p.plans.length === 0 ? <p className="text-sm text-slate-500">No improvement plans.</p> : (
          <ul className="space-y-2">{p.plans.map(ip => (
            <li key={ip.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm" data-testid="tc-plan">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold">{ip.status === 'OPEN' ? 'Open' : 'Closed'} · {fmtDate(ip.startDate)} – {fmtDate(ip.deadline)}</p>
                {p.isHr && ip.status === 'OPEN' && <button type="button" className={btn.secondary} onClick={() => void closePlan(ip.id)}>Close plan</button>}
              </div>
              <p className="mt-1"><span className="text-slate-500">Targets:</span> {ip.targets}</p>
              {ip.support && <p className="mt-1"><span className="text-slate-500">Support:</span> {ip.support}</p>}
              {ip.closedRemarks && <p className="mt-1"><span className="text-slate-500">Closing remarks:</span> {ip.closedRemarks}</p>}
            </li>))}</ul>
        )}
      </section>
    </div>
  );
};

/** The Telecaller's own page: My Call Performance. */
export const MyCallPerformance: React.FC<{ profileId: string }> = ({ profileId }) => (
  <div className="space-y-4" data-testid="my-call-performance">
    <div>
      <h1 className="text-lg sm:text-xl font-bold text-slate-900">My Call Performance</h1>
      <p className="text-[13px] text-slate-500">Your outgoing calls against your target. The weekly target is adjusted for approved leave, holidays and weekly offs.</p>
    </div>
    <TelecallerProfile profileId={profileId} />
  </div>
);
