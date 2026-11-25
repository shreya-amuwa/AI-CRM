import React, { useMemo, useState } from 'react';
import type { RecruiterContext, RecruiterInterview, RecruiterInterviewListItem } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { recruiterApi } from '../../lib/api/recruiter';
import { btn, Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import { InterviewDialog, InterviewResultDialog } from './Dialogs';
import type { RecruiterGo } from './RecruiterDashboard';
import { Empty, MODE_LABEL, RESULT_LABEL, ROUND_LABEL, fmtDateTime, useLoad } from './ui';
import { confirmAction } from '../feedback/AppFeedback';

type Tab = 'upcoming' | 'past';

/** Interview Management: upcoming and past interviews; confirm, reschedule, complete (with feedback and result). Bookings made by candidates appear here too. */
export const Interviews: React.FC<{ ctx: RecruiterContext; go: RecruiterGo; onChanged: () => void }> = ({ go, onChanged }) => {
  const { data, error, loading, reload } = useLoad<{ items: RecruiterInterviewListItem[] }>(() => recruiterApi.interviews(), []);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [reschedule, setReschedule] = useState<RecruiterInterviewListItem | null>(null);
  const [result, setResult] = useState<RecruiterInterviewListItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const items = data?.items ?? [];
  const { upcoming, past } = useMemo(() => ({
    upcoming: items.filter(i => i.status === 'SCHEDULED').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    past: items.filter(i => i.status !== 'SCHEDULED').sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
  }), [items]);
  const done = () => { setReschedule(null); setResult(null); reload(); onChanged(); };
  const simple = async (i: RecruiterInterviewListItem, action: 'CONFIRM' | 'CANCEL') => {
    if (busy) return;
    setBusy(i.id); setActionError(null);
    try { await recruiterApi.saveInterview(i.applicationId, { action, id: i.id, version: i.version }); done(); } catch (e) { setActionError(errorMessage(e)); } finally { setBusy(null); }
  };
  const asInterview = (i: RecruiterInterviewListItem): RecruiterInterview => i;
  const list = tab === 'upcoming' ? upcoming : past;
  return (
    <div className="space-y-4">
      <PageTitle title="Interview Management" subtitle="Interviews for your candidates, including the ones candidates booked themselves." />
      <div role="tablist" aria-label="Interviews" className="flex gap-1 border-b border-slate-200">
        {([['upcoming', `Upcoming (${upcoming.length})`], ['past', `Past (${past.length})`]] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>
        ))}
      </div>
      {(error || actionError) && <ErrorBanner message={(error ?? actionError)!} onRetry={error ? reload : undefined} />}
      {loading && !data ? <Spinner /> : list.length === 0 ? <Empty title={tab === 'upcoming' ? 'No upcoming interviews' : 'No past interviews'} hint="Schedule an interview from a candidate's profile." /> : (
        <ul className="space-y-3">{list.map(i => (
          <li key={i.id}><Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><button type="button" className="text-sm font-bold text-indigo-700 hover:underline" onClick={() => go('applications', { applicationId: i.applicationId })}>{i.candidate}</button>
                <p className="text-[11px] text-slate-500">{i.vacancy} · {ROUND_LABEL[i.round]}</p></div>
              <span className="text-xs font-semibold text-slate-700">{fmtDateTime(i.scheduledAt)}</span>
            </div>
            <p className="mt-1 text-xs text-slate-600">{[i.mode ? MODE_LABEL[i.mode] : null, i.location, i.interviewer].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-600">{i.status === 'SCHEDULED' ? (i.confirmedAt ? 'Confirmed' : 'Awaiting confirmation') : i.status === 'COMPLETED' ? `Completed · result: ${RESULT_LABEL[i.result ?? ''] ?? '–'}` : 'Cancelled'}{i.bookedBy === 'CANDIDATE' ? ' · booked by the candidate' : ''}</p>
            {i.feedback && <p className="mt-1 text-xs text-slate-700">{i.feedback}</p>}
            {i.status === 'SCHEDULED' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {!i.confirmedAt && <button type="button" className={btn.secondary} disabled={busy === i.id} onClick={() => void simple(i, 'CONFIRM')}>Confirm</button>}
                <button type="button" className={btn.secondary} onClick={() => setReschedule(i)}>Reschedule</button>
                <button type="button" className={btn.primary} onClick={() => setResult(i)}>Complete</button>
                <button type="button" className={btn.danger} disabled={busy === i.id} onClick={async () => { if (await confirmAction({ title: 'Cancel this interview?', description: 'The interview is cancelled for the candidate and the interviewers.', confirmLabel: 'Cancel interview', cancelLabel: 'Keep interview', variant: 'destructive' })) void simple(i, 'CANCEL'); }}>Cancel</button>
              </div>
            )}
          </Card></li>
        ))}</ul>
      )}
      {reschedule && <InterviewDialog applicationId={reschedule.applicationId} reschedule={asInterview(reschedule)} onClose={() => setReschedule(null)} onDone={done} />}
      {result && <InterviewResultDialog applicationId={result.applicationId} interview={asInterview(result)} onClose={() => setResult(null)} onDone={done} />}
    </div>
  );
};
