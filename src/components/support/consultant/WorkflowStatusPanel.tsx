import React, { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import {
  META_STATUS_LABELS, META_WORKFLOW_STATUSES, TC_MANUAL_STATUSES, TC_STATUS_LABELS,
  type CustomerWorkflow, type CustomerWorkflowStatuses, type MetaWorkflowStatus, type TcWorkflowStatus
} from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { btn, ErrorBanner, longDateTime, usePipelineRealtime, notifyPipelineChanged } from '../../team-member/pipeline/shared';

/**
 * The two workflow statuses of ONE customer: the Technical Consultant's (technical verification, add-on services, purchase tracking, technical
 * processing) and the Meta Verifier's (normal onboarding). They are independent: each role changes only its own, and nothing the Meta Verifier does
 * removes the customer from the Technical Consultant. What each role may change is decided by the database; this panel only offers it.
 */
const TC_TONE: Record<TcWorkflowStatus, string> = {
  NEW_LEAD: 'bg-slate-100 text-slate-700 border-slate-200',
  VERIFICATION_PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  VERIFICATION_IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  ADDON_SERVICES_RECOMMENDED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  WAITING_FOR_CUSTOMER_PURCHASE: 'bg-orange-50 text-orange-800 border-orange-200',
  PAYMENT_CONFIRMATION_PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  ADDON_PURCHASED: 'bg-teal-50 text-teal-700 border-teal-200',
  TECHNICAL_PROCESSING: 'bg-sky-50 text-sky-700 border-sky-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ON_HOLD: 'bg-slate-100 text-slate-600 border-slate-300'
};
const META_TONE: Record<MetaWorkflowStatus, string> = {
  ONBOARDING_PENDING: 'bg-slate-100 text-slate-700 border-slate-200',
  ONBOARDING_IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  DOCUMENTS_PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  VERIFICATION_PENDING: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ONBOARDING_COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  ON_HOLD: 'bg-slate-100 text-slate-600 border-slate-300'
};
const chip = 'inline-flex items-center rounded-full border font-semibold whitespace-nowrap px-2 py-0.5 text-[11px]';

/** On the Meta Verifier route the initial verification is not the consultant's: before any add-on work their status reads "Consultation". */
export const tcLabel = (status: TcWorkflowStatus, metaRoute = false) => (metaRoute && status === 'NEW_LEAD' ? 'Consultation' : TC_STATUS_LABELS[status]);
export const TcChip: React.FC<{ status: TcWorkflowStatus; metaRoute?: boolean }> = ({ status, metaRoute }) => (
  <span className={`${chip} ${TC_TONE[status]}`} title="Technical Consultant status" data-testid="tc-chip">{tcLabel(status, metaRoute)}</span>
);
export const MetaChip: React.FC<{ status: MetaWorkflowStatus }> = ({ status }) => (
  <span className={`${chip} ${META_TONE[status]}`} title="Meta Verifier status" data-testid="meta-chip">{META_STATUS_LABELS[status]}</span>
);

/** The statuses of the customers on a list page (one request). A failure just shows no chips: the list never depends on it. */
export function useWorkflowStatuses(ids: string[]): CustomerWorkflowStatuses {
  const [data, setData] = useState<CustomerWorkflowStatuses>({});
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    pipelineApi.workflowStatuses(key ? key.split(',') : []).then(d => live && setData(d), () => live && setData({}));
    return () => { live = false; };
  }, [key]);
  return data;
}

const since = (iso: string | null) => (iso ? longDateTime(iso) : '');

const TrackCard: React.FC<{
  title: string; testId: string; chipNode: React.ReactNode; by: string | null; source: 'SYSTEM' | 'USER'; at: string | null; note: string | null;
  canSet: boolean; options: { value: string; label: string }[]; current: string | null; hint: string;
  onSave: (status: string, note: string) => Promise<void>;
}> = ({ title, testId, chipNode, by, source, at, note, canSet, options, current, hint, onSave }) => {
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = options.filter(o => o.value !== current);
  const save = async () => {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(status, text);
      setStatus('');
      setText('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl border border-slate-200 p-4 space-y-2.5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900">{title}</h3>
        {chipNode}
      </div>
      <p className="text-[11px] text-slate-500">
        {at ? <>Since {since(at)} · {source === 'SYSTEM' ? 'updated automatically from the records' : `set by ${by ?? 'a team member'}`}</> : 'No change yet'}
      </p>
      {note && <p className="text-xs text-slate-700 bg-slate-50 rounded-lg px-2.5 py-1.5">“{note}”</p>}
      {canSet ? (
        <div className="space-y-2 pt-1">
          <label className="block text-[11px] font-semibold text-slate-600">Change status
            <select className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs" value={status} onChange={e => setStatus(e.target.value)} data-testid={`${testId}-select`}>
              <option value="">Choose…</option>
              {choices.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-slate-600">Note (required for On Hold and rejections)
            <input className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs" value={text} maxLength={500} onChange={e => setText(e.target.value)} data-testid={`${testId}-note`} />
          </label>
          {error && <p role="alert" className="text-xs font-semibold text-rose-700" data-testid={`${testId}-error`}>{error}</p>}
          <button type="button" className={btn.primary} disabled={!status || busy} onClick={() => void save()} data-testid={`${testId}-save`}>{busy ? 'Saving…' : 'Update status'}</button>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">{hint}</p>
      )}
    </div>
  );
};

export const WorkflowStatusPanel: React.FC<{ customerId: string; onChanged?: () => void }> = ({ customerId, onChanged }) => {
  const [w, setW] = useState<CustomerWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const load = useCallback(() => {
    pipelineApi.workflow(customerId).then(d => { setW(d); setError(null); }, e => setError(errorMessage(e)));
  }, [customerId]);
  useEffect(load, [load]);
  usePipelineRealtime(load);

  if (error && !w) return <ErrorBanner message={error} onRetry={load} />;
  if (!w) return null;
  const done = (d: CustomerWorkflow) => { setW(d); notifyPipelineChanged(); onChanged?.(); };
  const tc = w.technicalConsultant;
  const mv = w.metaVerifier;
  const metaRoute = !!(mv.applicable && mv.status);
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4" aria-labelledby="workflow-heading" data-testid="workflow-panel">
      <div>
        <h2 id="workflow-heading" className="font-bold text-slate-900">Workflow status</h2>
        <p className="text-xs text-slate-500">Two independent statuses for this one customer. Finishing Meta onboarding never closes the Technical Consultant's work: the customer stays with them until the add-on purchase, Accounts' payment confirmation and the technical processing are done.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <TrackCard
          title="Technical Consultant" testId="tc-status" chipNode={<TcChip status={tc.status} metaRoute={metaRoute} />} by={tc.by} source={tc.source} at={tc.since} note={tc.note}
          canSet={w.canSetTechnicalConsultant} current={tc.status}
          // on the Meta Verifier route the initial verification belongs to the Meta Verifier (the database refuses these two for the consultant)
          options={TC_MANUAL_STATUSES.filter(s => !metaRoute || (s !== 'VERIFICATION_PENDING' && s !== 'VERIFICATION_IN_PROGRESS')).map(s => ({ value: s, label: tcLabel(s, metaRoute) }))}
          hint={metaRoute
            ? 'Consultation and add-on services: the Meta Verifier does the initial onboarding. Only the Technical Consultant (and the Department Head) change this; payment statuses follow Accounts.'
            : 'Only the Technical Consultant (and the Department Head) change this. Payment statuses follow Accounts.'}
          onSave={async (status, note) => done(await pipelineApi.setTcStatus(customerId, { status: status as TcWorkflowStatus, note: note.trim() || undefined }))}
        />
        {mv.applicable && mv.status ? (
          <TrackCard
            title="Meta Verifier" testId="meta-status" chipNode={<MetaChip status={mv.status} />} by={mv.by} source={mv.source} at={mv.since} note={mv.note}
            canSet={w.canSetMetaVerifier} current={mv.status}
            options={META_WORKFLOW_STATUSES.map(s => ({ value: s, label: META_STATUS_LABELS[s] }))}
            hint="Only the Meta Verifier (and the Department Head) change this. Normal onboarding only: add-ons are not part of it."
            onSave={async (status, note) => done(await pipelineApi.setMetaStatus(customerId, { status: status as MetaWorkflowStatus, note: note.trim() || undefined }))}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 p-4" data-testid="meta-status">
            <h3 className="text-sm font-extrabold text-slate-900">Meta Verifier</h3>
            <p className="text-xs text-slate-500 mt-1">{tc.sentBySales ? 'This customer is not on the Meta Verifier route: the Technical Consultant verifies its documents.' : 'Starts when Sales sends the customer and its services need Meta verification.'}</p>
          </div>
        )}
      </div>
      <div>
        <button type="button" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline" onClick={() => setShowHistory(v => !v)} aria-expanded={showHistory} data-testid="workflow-history-toggle">
          <History className="w-3.5 h-3.5" aria-hidden="true" /> {showHistory ? 'Hide' : 'Show'} history ({w.history.length})
        </button>
        {showHistory && (
          <ol className="mt-2 space-y-1.5 text-xs text-slate-700" data-testid="workflow-history">
            {w.history.map((h, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="text-slate-400 tabular-nums">{longDateTime(h.at)}</span>
                <b>{h.track === 'TECHNICAL_CONSULTANT' ? 'Technical Consultant' : 'Meta Verifier'}</b>
                <span>{h.from ? `${(h.track === 'TECHNICAL_CONSULTANT' ? TC_STATUS_LABELS : META_STATUS_LABELS)[h.from as never] ?? h.from} → ` : ''}{(h.track === 'TECHNICAL_CONSULTANT' ? TC_STATUS_LABELS : META_STATUS_LABELS)[h.to as never] ?? h.to}</span>
                <span className="text-slate-500">{h.source === 'SYSTEM' ? 'automatic' : `by ${h.by ?? 'a team member'}`}{h.note ? ` · “${h.note}”` : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
};
