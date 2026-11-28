import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, History, RotateCcw, UserCog } from 'lucide-react';
import { hrReviewsApi } from '../../../lib/api/endpoints';
import { confirmAction, promptInput, toast } from '../../feedback/AppFeedback';
import {
  DECISIONS, RATING_SCALE, RECOMMENDATIONS, REVIEW_TEXT_FIELDS, reviewCriteria, roleFamily,
  type ReviewDetail, type ReviewerRole, type ReviewEvaluation
} from '../../../../shared/hrUpgrade';
import { btn, ErrorBanner, inputCls, selectCls, Spinner } from '../../team-member/pipeline/shared';
import { configIssueText, daysText, fmtDate, fmtDateTime, hours, OverallStatus, ReportStatus, typeLabel } from './reviewUi';

const errText = (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f);
const ROLE_LABEL: Record<ReviewerRole, string> = { DH: 'Department Head', CEO: 'CEO', HR: 'HR' };
const recLabel = (type: string, v: string | null) =>
  [...RECOMMENDATIONS.PROBATION, ...RECOMMENDATIONS.INTERNSHIP, ...DECISIONS.PROBATION, ...DECISIONS.INTERNSHIP].find(x => x.value === v && (type === 'INTERNSHIP' ? true : true))?.label ?? v ?? '–';

const Section: React.FC<{ title: string; icon?: React.ElementType; children: React.ReactNode; testId?: string }> = ({ title, icon: Icon, children, testId }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3" data-testid={testId}>
    <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">{Icon && <Icon className="w-4 h-4 text-indigo-600" aria-hidden />}{title}</h3>
    {children}
  </section>
);
const Facts: React.FC<{ items: [string, React.ReactNode][] }> = ({ items }) => (
  <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 text-sm">
    {items.map(([k, v]) => (<div key={k} className="min-w-0"><dt className="text-[11px] text-slate-500">{k}</dt><dd className="font-semibold text-slate-900 break-words">{v ?? '–'}</dd></div>))}
  </dl>
);

/** One submitted / draft evaluation, read-only. */
const EvaluationView: React.FC<{ e: ReviewEvaluation; type: 'PROBATION' | 'INTERNSHIP'; family: string | null }> = ({ e, type, family }) => {
  const crit = reviewCriteria(type, e.role, family);
  const labels = new Map(crit.map(c => [c.key, c.label]));
  const texts = REVIEW_TEXT_FIELDS[e.role][type];
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2" data-testid={`eval-${e.role}-${e.round}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold text-slate-900">{ROLE_LABEL[e.role]} report</span><ReportStatus status={e.status} />
        <span className="text-slate-500">Round {e.round} · {e.reviewer?.name ?? '–'}{e.submittedAt ? ` · submitted ${fmtDateTime(e.submittedAt)}` : ''}{e.versions > 1 ? ` · ${e.versions} versions` : ''}</span>
      </div>
      {e.status === 'RETURNED' && e.returnedReason && <p className="text-xs text-amber-800">Returned: {e.returnedReason}</p>}
      {Object.keys(e.ratings).length > 0 && (
        <table className="w-full text-xs"><tbody>
          {Object.entries(e.ratings).map(([k, v]) => (
            <tr key={k} className="border-t border-slate-100"><td className="py-1 pr-2 text-slate-600">{labels.get(k) ?? k.replace(/_/g, ' ')}</td>
              <td className="py-1 text-right font-semibold text-slate-900">{v === null ? 'Not applicable' : `${v} – ${RATING_SCALE.find(s => s.value === v)?.label ?? ''}`}</td></tr>
          ))}
        </tbody></table>
      )}
      {[...texts, { key: 'recommendationReason', label: 'Reason' }, { key: 'extensionMonths', label: 'Proposed extension (months)' },
        { key: 'improvementExpectations', label: 'Improvement expected' }, { key: 'recommendedReviewDate', label: 'Recommended review date' }]
        .filter(f => e.answers[f.key]).map(f => (
          <div key={f.key} className="text-xs"><p className="font-semibold text-slate-600">{f.label}</p><p className="text-slate-900 whitespace-pre-wrap break-words">{e.answers[f.key]}</p></div>
        ))}
      {e.recommendation && <p className="text-xs"><span className="font-semibold text-slate-600">Recommendation: </span><b>{recLabel(type, e.recommendation)}</b></p>}
    </div>
  );
};

/** The Department Head's / CEO's evaluation form (save a draft, submit when complete). */
const EvaluationForm: React.FC<{ d: ReviewDetail; role: 'DH' | 'CEO'; onSaved: (d: ReviewDetail) => void }> = ({ d, role, onSaved }) => {
  const type = d.cycleType;
  const family = roleFamily(d.employee.designation, d.employee.salesSubRole);
  const crit = reviewCriteria(type, role, family);
  const mine = d.evaluations.find(e => e.role === role && e.round === d.round);
  const [ratings, setRatings] = useState<Record<string, number | null>>(mine?.ratings ?? {});
  const [answers, setAnswers] = useState<Record<string, string>>(mine?.answers ?? {});
  const [rec, setRec] = useState<string>(mine?.recommendation ?? '');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setAnswers(a => ({ ...a, [k]: v }));
  const save = async (submit: boolean) => {
    if (submit && !(await confirmAction({ title: `Submit your ${role === 'DH' ? 'Department Head' : 'CEO'} evaluation?`, description: 'HR is told at once. After submitting, the report can only change if HR returns it for revision.',
      details: [`${d.employeeName} · ${typeLabel(type)}`, `Recommendation: ${recLabel(type, rec || null)}`], confirmLabel: 'Submit evaluation' }))) return;
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim()));
      const r = await hrReviewsApi.save(d.id, { role, ratings, answers: clean, recommendation: rec || null, submit });
      toast.success(submit ? 'Evaluation submitted to HR.' : 'Draft saved. It is not submitted yet.');
      onSaved(r);
    } catch (e) { toast.error(errText(e, 'The evaluation could not be saved.')); } finally { setBusy(false); }
  };
  return (
    <Section title={`Your evaluation (${role === 'DH' ? 'Department Head' : 'CEO'})`} icon={ClipboardCheck} testId="review-form">
      {mine?.status === 'RETURNED' && <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1">Returned for revision: {mine.returnedReason}</p>}
      <div className="space-y-2">
        {crit.map(c => (
          <div key={c.key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <label htmlFor={`rate-${c.key}`} className="text-sm text-slate-700">{c.label}</label>
            <select id={`rate-${c.key}`} className={selectCls} value={c.key in ratings ? (ratings[c.key] === null ? 'na' : String(ratings[c.key])) : ''}
              onChange={e => setRatings(r => { const n = { ...r }; if (e.target.value === '') delete n[c.key]; else n[c.key] = e.target.value === 'na' ? null : Number(e.target.value); return n; })}>
              <option value="">Not rated</option>
              {RATING_SCALE.map(s => <option key={s.value} value={s.value}>{s.value} – {s.label}</option>)}
              <option value="na">Not applicable</option>
            </select>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {REVIEW_TEXT_FIELDS[role][type].map(f => (
          <label key={f.key} className="text-xs font-semibold text-slate-600">{f.label}
            <textarea className={`${inputCls} mt-1`} rows={2} maxLength={4000} value={answers[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} /></label>
        ))}
      </div>
      <fieldset className="space-y-1"><legend className="text-xs font-semibold text-slate-600">Overall recommendation</legend>
        {RECOMMENDATIONS[type].map(o => (
          <label key={o.value} className="flex items-center gap-2 text-sm"><input type="radio" name={`rec-${role}`} value={o.value} checked={rec === o.value} onChange={() => setRec(o.value)} />{o.label}</label>
        ))}
      </fieldset>
      {rec === 'EXTEND' && (
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-xs font-semibold text-slate-600">Proposed extension (months)
            <select className={`${selectCls} w-full mt-1`} value={answers.extensionMonths ?? ''} onChange={e => set('extensionMonths', e.target.value)}>
              <option value="">Choose</option>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Improvement expected
            <input className={`${inputCls} mt-1`} value={answers.improvementExpectations ?? ''} onChange={e => set('improvementExpectations', e.target.value)} /></label>
          <label className="text-xs font-semibold text-slate-600">Recommended review date
            <input type="date" className={`${inputCls} mt-1`} value={answers.recommendedReviewDate ?? ''} onChange={e => set('recommendedReviewDate', e.target.value)} /></label>
        </div>
      )}
      {rec && (
        <label className="block text-xs font-semibold text-slate-600">{rec === 'NOT_CONFIRM' || rec === 'NOT_CONTINUE' ? 'Detailed reason (required)' : rec === 'EXTEND' ? 'Reason for the extension (required)' : 'Reason'}
          <textarea className={`${inputCls} mt-1`} rows={3} maxLength={4000} value={answers.recommendationReason ?? ''} onChange={e => set('recommendationReason', e.target.value)} /></label>
      )}
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" className={btn.secondary} disabled={busy} onClick={() => void save(false)}>Save draft</button>
        <button type="button" className={btn.primary} disabled={busy} onClick={() => void save(true)}>Submit evaluation</button>
      </div>
    </Section>
  );
};

/** HR's evaluation and the final decision. */
const DecisionForm: React.FC<{ d: ReviewDetail; onDone: (d: ReviewDetail) => void }> = ({ d, onDone }) => {
  const type = d.cycleType;
  const reportsIn = d.dh.status === 'SUBMITTED' && d.ceo.status === 'SUBMITTED';
  const hrPrev = d.evaluations.find(e => e.role === 'HR' && e.round === d.round);
  const [answers, setAnswers] = useState<Record<string, string>>(hrPrev?.answers ?? {});
  const [ratings, setRatings] = useState<Record<string, number | null>>(hrPrev?.ratings ?? {});
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const [exceptional, setExceptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const needsReports = decision && decision !== 'HOLD' && !reportsIn;
  const submit = async () => {
    const body: Record<string, unknown> = { decision, reason, hrEvaluation: { ratings, answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim())) } };
    if (decision === 'CONFIRM' && f.effectiveDate) body.effectiveDate = f.effectiveDate;
    if (decision === 'EXTEND') { if (f.newDate) body.newDate = f.newDate; else if (f.months) body.extensionMonths = Number(f.months); body.expectations = f.expectations ?? ''; }
    if (decision === 'HOLD') body.nextReviewDate = f.nextReviewDate;
    if (decision === 'CONVERT') { if (f.fullTimeEffectiveDate) body.fullTimeEffectiveDate = f.fullTimeEffectiveDate; if (f.probationMonths) body.probationMonths = Number(f.probationMonths); }
    if (needsReports) body.exceptional = exceptional;
    const label = DECISIONS[type].find(x => x.value === decision)?.label ?? decision;
    const ok = await confirmAction({
      title: `${label}: ${d.employeeName}?`, variant: decision === 'NOT_CONFIRM' || decision === 'NOT_CONTINUE' ? 'destructive' : undefined,
      description: decision === 'CONFIRM' ? 'The existing confirmation runs: the confirmation e-mail is sent once the probation period is over, and the employee is confirmed when it is sent.'
        : decision === 'NOT_CONFIRM' || decision === 'NOT_CONTINUE' ? 'This records the decision only. The account is not changed; any exit follows the offboarding process.'
        : decision === 'CONVERT' ? 'The same employee record becomes full-time (same employee ID and history). A full-time probation review is opened; nothing is confirmed by this.'
        : 'This is recorded with your name and the reasons.',
      details: [`Department Head: ${d.dh.status === 'SUBMITTED' ? 'submitted' : 'not submitted'}`, `CEO: ${d.ceo.status === 'SUBMITTED' ? 'submitted' : 'not submitted'}`, ...(needsReports ? ['Exceptional decision (a report is missing)'] : [])],
      confirmLabel: label
    } as Parameters<typeof confirmAction>[0]);
    if (!ok) return;
    setBusy(true);
    try {
      const r = await hrReviewsApi.decide(d.id, body);
      if (r.notice) toast.warning(r.notice); else toast.success(`Decision recorded: ${label}.`);
      onDone(r);
    } catch (e) { toast.error(errText(e, 'The decision could not be recorded.')); } finally { setBusy(false); }
  };
  return (
    <Section title={type === 'INTERNSHIP' ? 'HR evaluation and internship decision' : 'HR evaluation and final confirmation decision'} icon={ClipboardCheck} testId="decision-form">
      {!reportsIn && <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1" role="status">Both management reports are required before the final decision{d.canDecideException ? ' (or record an exceptional decision with a documented reason).' : '. Only "On hold" is possible now.'}</p>}
      <div className="grid sm:grid-cols-2 gap-2">
        {REVIEW_TEXT_FIELDS.HR[type].map(x => (
          <label key={x.key} className="text-xs font-semibold text-slate-600">{x.label}
            <textarea className={`${inputCls} mt-1`} rows={2} maxLength={4000} value={answers[x.key] ?? ''} onChange={e => setAnswers(a => ({ ...a, [x.key]: e.target.value }))} /></label>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {reviewCriteria(type, 'HR').map(c => (
          <label key={c.key} className="text-xs font-semibold text-slate-600">{c.label}
            <select className={`${selectCls} block mt-1`} value={c.key in ratings ? (ratings[c.key] === null ? 'na' : String(ratings[c.key])) : ''}
              onChange={e => setRatings(r => { const n = { ...r }; if (e.target.value === '') delete n[c.key]; else n[c.key] = e.target.value === 'na' ? null : Number(e.target.value); return n; })}>
              <option value="">Not rated</option>{RATING_SCALE.map(s => <option key={s.value} value={s.value}>{s.value} – {s.label}</option>)}<option value="na">Not applicable</option>
            </select></label>
        ))}
      </div>
      <label className="block text-xs font-semibold text-slate-600">Final decision
        <select className={`${selectCls} block w-full mt-1`} value={decision} onChange={e => setDecision(e.target.value)} data-testid="decision-select">
          <option value="">Choose a decision</option>{DECISIONS[type].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      {decision === 'CONFIRM' && <label className="block text-xs font-semibold text-slate-600">Confirmation effective date (default {fmtDate(d.dueDate)})
        <input type="date" className={`${inputCls} mt-1`} value={f.effectiveDate ?? ''} onChange={e => setF({ ...f, effectiveDate: e.target.value })} /></label>}
      {decision === 'EXTEND' && (
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-xs font-semibold text-slate-600">Extension (months)
            <select className={`${selectCls} w-full mt-1`} value={f.months ?? ''} onChange={e => setF({ ...f, months: e.target.value, newDate: '' })}>
              <option value="">Choose</option>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">or revised date
            <input type="date" className={`${inputCls} mt-1`} value={f.newDate ?? ''} onChange={e => setF({ ...f, newDate: e.target.value, months: '' })} /></label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-3">Improvement expectations (required)
            <input className={`${inputCls} mt-1`} value={f.expectations ?? ''} onChange={e => setF({ ...f, expectations: e.target.value })} /></label>
        </div>
      )}
      {decision === 'HOLD' && <label className="block text-xs font-semibold text-slate-600">Next review date (required)
        <input type="date" className={`${inputCls} mt-1`} value={f.nextReviewDate ?? ''} onChange={e => setF({ ...f, nextReviewDate: e.target.value })} /></label>}
      {decision === 'CONVERT' && (
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-slate-600">Full-time effective date (default the day after completion)
            <input type="date" className={`${inputCls} mt-1`} value={f.fullTimeEffectiveDate ?? ''} onChange={e => setF({ ...f, fullTimeEffectiveDate: e.target.value })} /></label>
          <label className="text-xs font-semibold text-slate-600">Full-time probation (months, company policy 6)
            <select className={`${selectCls} w-full mt-1`} value={f.probationMonths ?? ''} onChange={e => setF({ ...f, probationMonths: e.target.value })}>
              <option value="">6 (policy)</option>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>
      )}
      <label className="block text-xs font-semibold text-slate-600">Supporting reasons (required{decision === 'NOT_CONFIRM' || decision === 'NOT_CONTINUE' ? ', in detail' : ''})
        <textarea className={`${inputCls} mt-1`} rows={3} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} data-testid="decision-reason" /></label>
      {needsReports && d.canDecideException && (
        <label className="flex items-start gap-2 text-xs text-amber-900"><input type="checkbox" checked={exceptional} onChange={e => setExceptional(e.target.checked)} />
          Record an exceptional decision without both management reports (the reason above must explain why, 30 characters at least).</label>
      )}
      <div className="flex justify-end"><button type="button" className={btn.primary} disabled={busy || !decision} onClick={() => void submit()}>Record decision</button></div>
    </Section>
  );
};

/** One review: everything HR / the reviewer needs on one screen. The database decides what each reader sees. */
export const ReviewDetailPanel: React.FC<{ id: string; onChanged?: () => void }> = ({ id, onChanged }) => {
  const [d, setD] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ role: ReviewerRole; to: string; reason: string } | null>(null);
  const load = useCallback(() => hrReviewsApi.get(id).then(x => { setD(x); setError(null); }, e => setError(errText(e, 'This review could not be loaded.'))), [id]);
  useEffect(() => { void load(); }, [load]);
  const changed = (x: ReviewDetail) => { setD(x); onChanged?.(); };
  const family = useMemo(() => (d ? roleFamily(d.employee.designation, d.employee.salesSubRole) : null), [d]);
  if (error) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!d) return <Spinner label="Loading the review…" />;

  const pending = d.status === 'PENDING' || d.status === 'ON_HOLD';
  const reassign = async (role: ReviewerRole, profileId: string, reason: string) => {
    try { changed(await hrReviewsApi.reassign(d.id, role, profileId, reason)); setPicking(null); toast.success('Review reassigned. The new reviewer was told.'); }
    catch (e) { toast.error(errText(e, 'The review could not be reassigned.')); }
  };
  const giveBack = async (role: 'DH' | 'CEO') => {
    const reason = await promptInput({ title: `Return the ${ROLE_LABEL[role]} report for revision?`, label: 'What should be revised', required: true, multiline: true, confirmLabel: 'Return for revision' });
    if (!reason) return;
    try { changed(await hrReviewsApi.returnForRevision(d.id, role, reason)); toast.success('Returned for revision. The reviewer was told.'); }
    catch (e) { toast.error(errText(e, 'The report could not be returned.')); }
  };
  const startNow = async () => {
    try { changed(await hrReviewsApi.start(d.id)); toast.success('Review started: the reviewers are assigned.'); } catch (e) { toast.error(errText(e, 'The review could not be started.')); }
  };
  const a = d.attendance;
  const current = d.evaluations.filter(e => e.round === d.round);
  const earlier = d.evaluations.filter(e => e.round !== d.round);

  return (
    <div className="space-y-3" data-testid="review-detail">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{typeLabel(d.cycleType)}{d.round > 1 ? ` · round ${d.round}` : ''}</p>
          <h2 className="text-lg font-extrabold text-slate-900">{d.employeeName}</h2>
          <p className="text-xs text-slate-500">{d.employeeCode} · {d.department ?? '–'} · due {fmtDate(d.dueDate)} ({daysText(d)})</p>
        </div>
        <OverallStatus status={d.overall} />
      </div>
      {d.configIssue && (
        <p className="text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-2 py-1 flex items-center gap-1.5" role="alert">
          <AlertTriangle className="w-4 h-4" aria-hidden /> Reviewer missing: {configIssueText(d.configIssue)}. {d.canReassign ? 'Assign one below.' : 'HR has been told.'}</p>
      )}
      {d.notice && <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1" role="status">{d.notice}</p>}

      <Section title="Employee information">
        <Facts items={[['Employee ID', d.employee.code], ['Department', d.employee.department], ['Designation', d.employee.designation ?? 'Not recorded'],
          ['Employment type', d.employee.employmentType ?? '–'], ['Team', d.employee.team ?? '–'], ['Joining date', fmtDate(d.employee.joiningDate)],
          [d.cycleType === 'INTERNSHIP' ? 'Internship' : 'Probation', `${d.employee.periodMonths} months`], ['Original date', fmtDate(d.employee.originalEnd)],
          ['Current date', fmtDate(d.employee.currentEnd)]]} />
      </Section>

      <Section title={`Attendance summary${a ? ` (${fmtDate(a.from)} – ${fmtDate(a.to)})` : ''}`} testId="review-attendance">
        {a ? <Facts items={[['Working days', a.workingDays], ['Present days', a.presentDays], ['Absent days', a.absentDays], ['Approved leave', a.approvedLeaveDays],
          ['Late arrivals', a.lateArrivals], ['Early departures', a.earlyDepartures], ['Working hours', hours(a.netMinutes)], ['Discrepancies', a.discrepancies]]} />
          : <p className="text-xs text-slate-500">No attendance is recorded in the CRM for this employee (an HR-only record).</p>}
      </Section>

      <Section title="Performance summary">
        {d.work ? <Facts items={[['Assigned tasks', d.work.assigned], ['Completed', d.work.completed], ['Pending', d.work.pending], ['Not completed', d.work.notCompleted], ['Overdue', d.work.overdue]]} />
          : <p className="text-xs text-slate-500">No task records for this period (not counted as zero performance).</p>}
        {d.meetings.length > 0 && <p className="text-xs text-slate-600">HR meetings in the period: {d.meetings.map(m => `${m.title} (${fmtDate(m.startsAt)})`).join('; ')}</p>}
      </Section>

      <Section title="Reviewers and reports" icon={UserCog} testId="review-reports">
        <div className="grid sm:grid-cols-3 gap-2">
          {(['DH', 'CEO', 'HR'] as ReviewerRole[]).map(r => {
            const s = r === 'DH' ? d.dh : r === 'CEO' ? d.ceo : d.hr;
            return (
              <div key={r} className="rounded-xl border border-slate-200 p-2 text-xs space-y-1">
                <p className="font-bold text-slate-800">{ROLE_LABEL[r]}</p>
                <p className="text-slate-600">{s.reviewer ? `${s.reviewer.name}${s.reviewer.active ? '' : ' (inactive)'}` : 'Not assigned'}</p>
                <ReportStatus status={s.status} />
                <div className="flex flex-wrap gap-1 pt-1">
                  {d.canReassign && s.status !== 'SUBMITTED' && <button type="button" className={btn.secondary} onClick={() => setPicking({ role: r, to: '', reason: '' })}>Reassign</button>}
                  {d.isHr && pending && r !== 'HR' && s.status === 'SUBMITTED' && <button type="button" className={btn.secondary} onClick={() => void giveBack(r as 'DH' | 'CEO')}><RotateCcw className="w-3.5 h-3.5" aria-hidden />Return</button>}
                </div>
              </div>
            );
          })}
        </div>
        {picking && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-2 grid sm:grid-cols-3 gap-2 items-end" data-testid="reassign-box">
            <label className="text-xs font-semibold text-slate-600">New {ROLE_LABEL[picking.role]} reviewer
              <select className={`${selectCls} block w-full mt-1`} value={picking.to} onChange={e => setPicking({ ...picking, to: e.target.value })}>
                <option value="">Choose</option>
                {(d.hrPeople ?? []).filter(p => picking.role === 'HR' || p.role === 'DEPARTMENT_HEAD').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label className="text-xs font-semibold text-slate-600">Reason<input className={`${inputCls} mt-1`} value={picking.reason} onChange={e => setPicking({ ...picking, reason: e.target.value })} /></label>
            <div className="flex gap-2"><button type="button" className={btn.primary} disabled={!picking.to || picking.reason.trim().length < 3}
              onClick={() => void reassign(picking.role, picking.to, picking.reason)}>Reassign</button>
              <button type="button" className={btn.secondary} onClick={() => setPicking(null)}>Cancel</button></div>
          </div>
        )}
        {d.isHr && pending && !d.reviewStarted && <button type="button" className={btn.secondary} onClick={() => void startNow()}>Start the review now</button>}
        {current.length === 0 ? <p className="text-xs text-slate-500">No report for this round yet.</p> : current.map(e => <EvaluationView key={e.id} e={e} type={d.cycleType} family={family} />)}
        {earlier.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-bold text-slate-700">Earlier rounds ({earlier.length})</summary>
          <div className="mt-2 space-y-2">{earlier.map(e => <EvaluationView key={e.id} e={e} type={d.cycleType} family={family} />)}</div></details>}
      </Section>

      {pending && (d.myRole === 'DH' || d.myRole === 'CEO') && (d.myRole === 'DH' ? d.dh : d.ceo).status !== 'SUBMITTED' && (
        <EvaluationForm key={`${d.round}-${d.myRole}`} d={d} role={d.myRole} onSaved={changed} />
      )}
      {d.canDecide && <DecisionForm key={d.round} d={d} onDone={changed} />}

      {(d.decisions.length > 0 || d.extensions.length > 0 || d.assignments.length > 0 || d.reminders.length > 0) && (
        <Section title="History" icon={History} testId="review-history">
          {d.extensions.map((x, i) => <p key={`x${i}`} className="text-xs text-slate-700">Extended {fmtDate(x.oldEnd)} → {fmtDate(x.newEnd)} by {x.by?.name ?? '–'} ({fmtDateTime(x.at)}): {x.reason}{x.expectations ? ` · Expected: ${x.expectations}` : ''}</p>)}
          {d.decisions.map((x, i) => <p key={`d${i}`} className="text-xs text-slate-700">Round {x.round}: <b>{recLabel(d.cycleType, x.decision)}</b>{x.exceptional ? ' (exceptional)' : ''} by {x.by?.name ?? '–'}, {fmtDateTime(x.at)}{x.reason ? ` — ${x.reason}` : ''}</p>)}
          {d.assignments.length > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold text-slate-700">Assignments ({d.assignments.length})</summary>
            <ul className="mt-1 space-y-0.5">{d.assignments.map((x, i) => <li key={i}>{fmtDateTime(x.at)} · {ROLE_LABEL[x.role]}: {x.from?.name ?? '–'} → {x.to?.name ?? 'nobody'}{x.by ? ` by ${x.by.name}` : ''}{x.reason ? ` (${x.reason})` : ''}</li>)}</ul></details>}
          {d.reminders.length > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold text-slate-700">Reminder e-mails ({d.reminders.length}{d.reminders.some(r => r.status === 'FAILED') ? ', some failed' : ''})</summary>
            <ul className="mt-1 space-y-0.5">{d.reminders.map((r, i) => <li key={i} className={r.status === 'FAILED' ? 'text-rose-700' : ''}>{r.kind === 'REVIEW_FIRST' ? 'First reminder' : r.kind === 'REVIEW_SECOND' ? 'Second reminder' : 'Overdue reminder'} · {r.role ?? 'HR'} · {r.to ?? '–'} · {r.status}{r.sentAt ? ` ${fmtDateTime(r.sentAt)}` : ''}{r.error ? ` — ${r.error}` : ''}</li>)}</ul></details>}
        </Section>
      )}
    </div>
  );
};

export default ReviewDetailPanel;
