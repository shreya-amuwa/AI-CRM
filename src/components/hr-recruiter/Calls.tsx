import React, { useState } from 'react';
import type { RecruiterCallLists, RecruiterContext } from '../../../shared/contracts';
import { recruiterApi } from '../../lib/api/recruiter';
import { btn, Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import { CallDialog } from './Dialogs';
import type { RecruiterGo } from './RecruiterDashboard';
import { CALL_OUTCOME_LABEL, Empty, fmtDate, fmtDateTime, useLoad } from './ui';

/** Call Management: calls to make, follow-ups that are due, and the calls already made. Recording a call needs its outcome. */
export const Calls: React.FC<{ ctx: RecruiterContext; go: RecruiterGo; onChanged: () => void }> = ({ go, onChanged }) => {
  const { data, error, loading, reload } = useLoad<RecruiterCallLists>(() => recruiterApi.calls(), []);
  const [dialog, setDialog] = useState<{ applicationId: string; callId?: string } | null>(null);
  const open = (id: string) => go('applications', { applicationId: id });
  return (
    <div className="space-y-5">
      <PageTitle title="Call Management" subtitle="Calls to make, follow-ups that are due, and the calls you have made." />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          <Card className="p-4"><h2 className="text-sm font-bold text-slate-900 mb-2">Calls to make ({data.upcoming.length})</h2>
            {data.upcoming.length === 0 ? <Empty title="No calls scheduled" hint="Schedule a call from a candidate's profile." /> : (
              <ul className="divide-y divide-slate-100">{data.upcoming.map(c => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span><button type="button" className="text-sm font-semibold text-indigo-700 hover:underline" onClick={() => open(c.applicationId)}>{c.candidate}</button><span className="block text-[11px] text-slate-500">{c.vacancy}{c.phone ? ` · ${c.phone}` : ''}</span></span>
                  <span className="flex items-center gap-3"><span className={`text-xs font-semibold ${c.overdue ? 'text-rose-700' : 'text-slate-700'}`}>{c.overdue ? 'Overdue · ' : ''}{fmtDateTime(c.scheduledAt)}</span>
                    <button type="button" className={btn.secondary} onClick={() => setDialog({ applicationId: c.applicationId, callId: c.id })}>Record outcome</button></span>
                </li>))}</ul>
            )}
          </Card>
          <Card className="p-4"><h2 className="text-sm font-bold text-slate-900 mb-2">Follow-ups ({data.followUps.length})</h2>
            {data.followUps.length === 0 ? <Empty title="No follow-ups pending" /> : (
              <ul className="divide-y divide-slate-100">{data.followUps.map(c => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span><button type="button" className="text-sm font-semibold text-indigo-700 hover:underline" onClick={() => open(c.applicationId)}>{c.candidate}</button><span className="block text-[11px] text-slate-500">{c.vacancy}{c.phone ? ` · ${c.phone}` : ''} · last outcome: {CALL_OUTCOME_LABEL[c.outcome ?? ''] ?? '–'}</span></span>
                  <span className="flex items-center gap-3"><span className={`text-xs font-semibold ${c.overdue ? 'text-rose-700' : 'text-slate-700'}`}>{c.overdue ? 'Overdue · ' : ''}{fmtDate(c.followUpDate)}</span>
                    <button type="button" className={btn.secondary} onClick={() => setDialog({ applicationId: c.applicationId })}>Record a call</button></span>
                </li>))}</ul>
            )}
          </Card>
          <Card className="p-4"><h2 className="text-sm font-bold text-slate-900 mb-2">Recent calls</h2>
            {data.recent.length === 0 ? <Empty title="No calls recorded yet" /> : (
              <div className="overflow-x-auto"><table className="w-full text-xs"><caption className="sr-only">Recent calls</caption>
                <thead><tr className="text-left text-slate-500 border-b border-slate-100"><th scope="col" className="py-2 pr-3">Candidate</th><th scope="col" className="pr-3">Vacancy</th><th scope="col" className="pr-3">When</th><th scope="col" className="pr-3">Outcome</th><th scope="col">Notes</th></tr></thead>
                <tbody>{data.recent.map(c => (<tr key={c.id} className="border-b border-slate-50"><th scope="row" className="py-2 pr-3 text-left font-semibold"><button type="button" className="hover:underline" onClick={() => open(c.applicationId)}>{c.candidate}</button></th><td className="pr-3">{c.vacancy}</td><td className="pr-3 whitespace-nowrap">{fmtDateTime(c.calledAt)}</td><td className="pr-3">{CALL_OUTCOME_LABEL[c.outcome] ?? c.outcome}</td><td className="text-slate-600">{c.note ?? ''}</td></tr>))}</tbody></table></div>
            )}
          </Card>
        </>
      )}
      {dialog && <CallDialog applicationId={dialog.applicationId} pendingCallId={dialog.callId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); onChanged(); }} />}
    </div>
  );
};
