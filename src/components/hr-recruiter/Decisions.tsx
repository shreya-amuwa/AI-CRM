import React, { useState } from 'react';
import type { RecruiterContext, RecruiterDecisionListItem } from '../../../shared/contracts';
import { recruiterApi } from '../../lib/api/recruiter';
import { btn, Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { PageTitle } from '../layout/shell';
import { DecisionDialog } from './Dialogs';
import type { RecruiterGo } from './RecruiterDashboard';
import { CATEGORY_LABEL, Empty, STEP_LABEL, StagePill, fmtDate, fmtDateTime, useLoad } from './ui';

/**
 * Selection & Rejection: candidates ready for a decision, and the decisions already made. The decision is per application, so a candidate who applied to two
 * vacancies has two independent decisions. Nothing on this page mentions or controls any message to the candidate.
 */
export const Decisions: React.FC<{ ctx: RecruiterContext; go: RecruiterGo; onChanged: () => void }> = ({ go, onChanged }) => {
  const [view, setView] = useState<'READY' | 'DECIDED'>('READY');
  const { data, error, loading, reload } = useLoad<RecruiterDecisionListItem[]>(() => recruiterApi.decisions(view), [view]);
  const [deciding, setDeciding] = useState<{ item: RecruiterDecisionListItem; decision: 'SELECTED' | 'REJECTED' } | null>(null);
  return (
    <div className="space-y-4">
      <PageTitle title="Selection & Rejection" subtitle="Record the final decision for each application. A decision applies to one vacancy only." />
      <div role="tablist" aria-label="Decisions" className="flex gap-1 border-b border-slate-200">
        {([['READY', 'Ready for decision'], ['DECIDED', 'Decided']] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={view === id} onClick={() => setView(id)} className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 ${view === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>
        ))}
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : !data || data.length === 0 ? (
        <Empty title={view === 'READY' ? 'No candidates are ready for a decision' : 'No decisions recorded yet'} hint={view === 'READY' ? 'Candidates appear here after a completed interview or test, or when you mark them ready on their profile.' : undefined} />
      ) : (
        <ul className="space-y-3">{data.map(i => (
          <li key={i.applicationId}><Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><button type="button" className="text-sm font-bold text-indigo-700 hover:underline" onClick={() => go('applications', { applicationId: i.applicationId })}>{i.name}</button>
                <p className="text-[11px] text-slate-500">{i.vacancy}{i.department ? ` · ${i.department}` : ''} · applied {fmtDate(i.appliedAt)}</p></div>
              <StagePill stage={i.stage} />
            </div>
            {view === 'READY' ? (
              <>
                <p className="mt-2 text-[11px] text-slate-600">Assessment: {i.testStatus === 'NONE' ? 'not invited' : i.testStatus.toLowerCase()}{i.testScore !== null ? ` (${i.testScore})` : ''} · Interview: {i.interviewStatus.toLowerCase()}</p>
                {i.missingSteps.length > 0 && <p className="mt-1 text-[11px] font-semibold text-amber-800">Still needed before selection: {i.missingSteps.map(m => STEP_LABEL[m] ?? m).join(', ')}</p>}
                <div className="mt-3 flex gap-2"><button type="button" className={btn.green} onClick={() => setDeciding({ item: i, decision: 'SELECTED' })}>Select</button><button type="button" className={btn.danger} onClick={() => setDeciding({ item: i, decision: 'REJECTED' })}>Reject</button></div>
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-600">{i.decision === 'SELECTED' ? 'Selected' : 'Rejected'} {fmtDateTime(i.decidedAt)}{i.decidedBy ? ` by ${i.decidedBy}` : ''}{i.category ? ` · ${CATEGORY_LABEL[i.category] ?? i.category}` : ''}{i.reason ? ` · ${i.reason}` : ''}</p>
            )}
          </Card></li>
        ))}</ul>
      )}
      {deciding && (
        <DecisionDialog applicationId={deciding.item.applicationId} candidate={deciding.item.name} vacancy={deciding.item.vacancy} decision={deciding.decision} remaining={deciding.item.openings}
          missingSteps={deciding.item.missingSteps.map(m => STEP_LABEL[m] ?? m)} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); reload(); onChanged(); }} />
      )}
    </div>
  );
};
