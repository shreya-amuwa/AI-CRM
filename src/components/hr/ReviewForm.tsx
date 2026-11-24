import React, { useEffect, useId, useState } from 'react';
import { Save, Send } from 'lucide-react';
import type { HrReview, HrReviewSaved, PersonStats, RatingScaleLevel } from '../../../shared/contracts';
import { hrReviewSaveSchema } from '../../../shared/validation';
import { ApiError } from '../../lib/api/client';
import { hrReviewsApi } from '../../lib/api/reportPerformance';
import { btn, ErrorBanner, Field, inputCls, selectCls } from '../team-member/pipeline/shared';
import { dateLabel, pctLabel, Stat, timeLabel } from '../reports/reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** The measurable record of a person in the week (from the task records and the daily reports; HR cannot change any of it). */
export const PersonFigures: React.FC<{ stats: PersonStats }> = ({ stats: s }) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5" data-testid="person-figures">
    <Stat label="Assigned tasks (records)" value={s.tasksAssigned} />
    <Stat label="Completed tasks (records)" value={s.tasksCompleted} tone="good" />
    <Stat label="Task completion rate" value={pctLabel(s.taskCompletionRate)} />
    <Stat label="Daily reports" value={`${s.submitted}/${s.expected}`} hint="Submitted / expected" />
    <Stat label="Reporting compliance" value={pctLabel(s.compliance)} tone={typeof s.compliance === 'number' && s.compliance < 80 ? 'warn' : 'good'} />
    <Stat label="Team Lead approved" value={s.tlApproved} />
    <Stat label="Department Head approved" value={s.dhApproved} />
    <Stat label="Revision requests" value={s.revisionRequests} tone={s.revisionRequests ? 'warn' : 'neutral'} />
    <Stat label="Sent on time" value={`${s.onTime}/${s.submitted}`} hint="On the day or the next" />
    <Stat label="Rejected" value={s.rejected} tone={s.rejected ? 'bad' : 'neutral'} />
  </div>
);

const HistoryList: React.FC<{ subjectId: string; currentId?: string }> = ({ subjectId, currentId }) => {
  const [items, setItems] = useState<HrReview[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { hrReviewsApi.history(subjectId).then(setItems, e => setError(errText(e))); }, [subjectId]);
  if (error) return <p role="alert" className="text-xs text-rose-700">{error}</p>;
  if (!items) return <p className="text-xs text-slate-500">Loading history...</p>;
  const rows = items.filter(r => r.id !== currentId);
  if (rows.length === 0) return <p className="text-xs text-slate-500">No earlier reviews.</p>;
  return (
    <ul className="space-y-1.5" data-testid="review-history">
      {rows.map(r => (
        <li key={r.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <b>{dateLabel(r.periodStart)} - {dateLabel(r.periodEnd)}</b>: {r.rating} ({r.ratingLabel}) by {r.reviewer}, {timeLabel(r.submittedAt)}
          {r.comments ? <span className="block text-slate-600">{r.comments}</span> : null}
        </li>
      ))}
    </ul>
  );
};

/**
 * HR's review of ONE person for the week (a Team Lead or a Team Member): the rating on the configured scale, the reporting consistency
 * note, the work assessment, the comments and the recommendations. A draft can be saved and finished later (by any HR colleague); a
 * submitted review is final and stays in the person's history. The review never changes a daily report or its approval.
 */
export const ReviewForm: React.FC<{
  packageId: string;
  subject: { id: string; name: string; kind: 'TEAM_LEAD' | 'TEAM_MEMBER' };
  review: HrReview | null;
  scale: RatingScaleLevel[];
  periodStart: string;
  periodEnd: string;
  canReview: boolean;
  stats: PersonStats;
  onSaved: (r: HrReviewSaved) => void;
}> = ({ packageId, subject, review, scale, periodStart, periodEnd, canReview, stats, onSaved }) => {
  const uid = useId();
  const [rating, setRating] = useState<number | null>(review?.rating ?? null);
  const [consistency, setConsistency] = useState(review?.consistencyNote ?? '');
  const [assessment, setAssessment] = useState(review?.workAssessment ?? '');
  const [comments, setComments] = useState(review?.comments ?? '');
  const [recs, setRecs] = useState(review?.recommendations ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  const [showHistory, setShowHistory] = useState(false);
  const locked = review?.status === 'SUBMITTED' || !canReview;

  const run = async (submit: boolean) => {
    setProblem('');
    setNote('');
    const body = { packageId, subjectId: subject.id, rating, consistencyNote: consistency.trim() || undefined, workAssessment: assessment.trim() || undefined, comments: comments.trim() || undefined, recommendations: recs.trim() || undefined, submit };
    const parsed = hrReviewSaveSchema.safeParse(body);
    if (!parsed.success) { const e: Record<string, string> = {}; for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message; setErrors(e); return; }
    if (submit && !window.confirm(`Submit the review of ${subject.name}? A submitted review cannot be changed.`)) return;
    setErrors({});
    setBusy(submit ? 'submit' : 'draft');
    try {
      const saved = await hrReviewsApi.save(body);
      setNote(submit ? 'Review submitted.' : 'Draft saved.');
      onSaved(saved);
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <form onSubmit={e => { e.preventDefault(); void run(true); }} noValidate className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3" aria-label={`Performance review of ${subject.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-bold text-slate-900">{subject.kind === 'TEAM_LEAD' ? 'Team Lead performance review' : 'Performance review'}</h5>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${review?.status === 'SUBMITTED' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : review ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
          {review?.status === 'SUBMITTED' ? 'Submitted' : review ? 'Draft' : 'Pending HR review'}
        </span>
      </div>
      {problem ? <ErrorBanner message={problem} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Performance review period" htmlFor={`${uid}-period`}><input id={`${uid}-period`} className={inputCls} readOnly value={`${dateLabel(periodStart)} to ${dateLabel(periodEnd)}`} /></Field>
        <Field label="Performance rating" required htmlFor={`${uid}-rating`} error={errors.rating}>
          <select id={`${uid}-rating`} className={`${selectCls} w-full`} value={rating ?? ''} disabled={locked} onChange={e => { setRating(e.target.value ? Number(e.target.value) : null); setErrors(x => ({ ...x, rating: '' })); }} aria-invalid={!!errors.rating}>
            <option value="">Choose a rating</option>
            {scale.map(l => <option key={l.value} value={l.value}>{l.value} - {l.label}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Attendance / reporting consistency" htmlFor={`${uid}-cons`}>
            <span className="block text-[11px] text-slate-500 mb-1">Recorded: {stats.submitted} of {stats.expected} daily reports ({pctLabel(stats.compliance)}), {stats.onTime} sent on time. Add what attendance data shows, if you have it.</span>
            <textarea id={`${uid}-cons`} className={`${inputCls} min-h-14`} value={consistency} maxLength={1000} disabled={locked} onChange={e => setConsistency(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Work performance assessment" htmlFor={`${uid}-assess`} error={errors.workAssessment}>
            <textarea id={`${uid}-assess`} className={`${inputCls} min-h-16`} value={assessment} maxLength={2000} disabled={locked} onChange={e => setAssessment(e.target.value)} />
          </Field>
        </div>
        <Field label="HR review comments" htmlFor={`${uid}-com`}><textarea id={`${uid}-com`} className={`${inputCls} min-h-16`} value={comments} maxLength={2000} disabled={locked} onChange={e => setComments(e.target.value)} /></Field>
        <Field label="Recommendations" htmlFor={`${uid}-rec`}><textarea id={`${uid}-rec`} className={`${inputCls} min-h-16`} value={recs} maxLength={2000} disabled={locked} onChange={e => setRecs(e.target.value)} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {locked ? null : (
          <>
            <button type="button" className={btn.secondary} onClick={() => void run(false)} disabled={!!busy}><Save className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'draft' ? 'Saving...' : 'Save draft'}</button>
            <button type="submit" className={btn.primary} disabled={!!busy}><Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'submit' ? 'Submitting...' : 'Submit review'}</button>
          </>
        )}
        <button type="button" className="text-xs font-semibold text-indigo-700 hover:underline" onClick={() => setShowHistory(h => !h)} aria-expanded={showHistory}>{showHistory ? 'Hide review history' : 'Previous reviews'}</button>
        {review?.status === 'SUBMITTED' ? <span className="text-[11px] text-slate-500">Submitted by {review.reviewer}, {timeLabel(review.submittedAt)}. It stays unchanged in the history.</span> : !canReview ? <span className="text-[11px] text-slate-500">This week was already sent to the Managing Director.</span> : null}
        {note ? <span role="status" className="text-xs text-emerald-700">{note}</span> : null}
      </div>
      {showHistory ? <HistoryList subjectId={subject.id} currentId={review?.id} /> : null}
    </form>
  );
};
