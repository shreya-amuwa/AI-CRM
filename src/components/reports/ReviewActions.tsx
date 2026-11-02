import React, { useId, useState } from 'react';
import type { ReportApprovalStage, WorkReportDetail } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { btn, inputCls } from '../team-member/pipeline/shared';
import { notifyReportsChanged } from './reportEvents';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/**
 * The decision for one report: a comment (needed to reject or ask for a revision) and Approve / Request revision / Reject. Used in the
 * report dialog and in the Department Head's approval list. The database decides which stage the decision belongs to (Team Lead or
 * Department Head) from the report's state and the caller's own login; the stage shown here only words the buttons.
 */
export const ReviewActions: React.FC<{
  id: string;
  stage?: ReportApprovalStage | null;
  onDone: (r: WorkReportDetail) => void;
}> = ({ id, stage, onDone }) => {
  const uid = useId();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const decide = async (decision: 'APPROVED' | 'REJECTED' | 'REVISION_REQUIRED') => {
    if (decision !== 'APPROVED' && comment.trim().length < 3) { setProblem('Write a comment so the author knows what to do.'); return; }
    setBusy(true);
    setProblem('');
    try {
      const r = await workReportsApi.review(id, decision, comment.trim() || undefined);
      setComment('');
      notifyReportsChanged();
      onDone(r);
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Your decision" className="rounded-xl border border-slate-200 p-3 space-y-2">
      <label htmlFor={`${uid}-comment`} className="block text-xs font-semibold text-slate-700">
        Comment <span className="font-normal text-slate-500">(needed to reject or ask for a revision)</span>
      </label>
      <textarea id={`${uid}-comment`} className={`${inputCls} min-h-16`} value={comment} onChange={e => { setComment(e.target.value); setProblem(''); }} maxLength={2000} disabled={busy} />
      {problem ? <p role="alert" className="text-xs text-rose-700">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.green} onClick={() => void decide('APPROVED')} disabled={busy}>
          {stage === 'TEAM_LEAD' ? 'Approve and send to Department Head' : stage === 'DEPARTMENT_HEAD' ? 'Give final approval' : 'Approve'}
        </button>
        <button type="button" className={btn.secondary} onClick={() => void decide('REVISION_REQUIRED')} disabled={busy}>Request revision</button>
        <button type="button" className={btn.danger} onClick={() => void decide('REJECTED')} disabled={busy}>Reject</button>
      </div>
    </section>
  );
};
