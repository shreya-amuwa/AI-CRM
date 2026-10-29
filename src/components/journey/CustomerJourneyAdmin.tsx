import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, ShieldCheck, UserRound, Wrench } from 'lucide-react';
import type { CustomerJourneyStatus, MetaStatus, ServiceSetupStatus } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';

/**
 * The team's side of the client's onboarding journey: Meta verification (status, feedback the client sees, the Meta Verifier), the
 * Relationship Manager, and the setup of each purchased service. Every button is a request to the server, which checks who may and
 * whether the move is allowed (a completed verification needs every document authorized; a service becomes ready only after its
 * prerequisites), so this screen only offers what is likely to work and shows the server's reason when it is not.
 */
const META_LABEL: Record<MetaStatus, string> = { PENDING: 'Pending', IN_PROGRESS: 'In progress', DOCUMENTS_REQUIRED: 'Documents required', REJECTED: 'Rejected', COMPLETED: 'Completed' };
const META_TONE: Record<MetaStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-600 border-slate-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  DOCUMENTS_REQUIRED: 'bg-amber-50 text-amber-800 border-amber-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200'
};
const NEXT: Record<MetaStatus, ('IN_PROGRESS' | 'DOCUMENTS_REQUIRED' | 'REJECTED' | 'COMPLETED')[]> = {
  PENDING: ['IN_PROGRESS'],
  IN_PROGRESS: ['DOCUMENTS_REQUIRED', 'REJECTED', 'COMPLETED'],
  DOCUMENTS_REQUIRED: ['IN_PROGRESS', 'REJECTED'],
  REJECTED: ['IN_PROGRESS'],
  COMPLETED: []
};
const SERVICE_TONE: Record<ServiceSetupStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Not started', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  IN_PROGRESS: { label: 'Setting up', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  READY: { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);
const pill = (cls: string, text: string) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-bold ${cls}`}>{text}</span>;
const btnCls = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-60';

export const CustomerJourneyAdmin: React.FC<{ customerId: string; onChanged?: () => void }> = ({ customerId, onChanged }) => {
  const [data, setData] = useState<CustomerJourneyStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<'IN_PROGRESS' | 'DOCUMENTS_REQUIRED' | 'REJECTED' | 'COMPLETED' | ''>('');
  const [feedback, setFeedback] = useState('');
  const [candidates, setCandidates] = useState<{ id: string; fullName: string }[] | null>(null);
  const [pick, setPick] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    pipelineApi.journeyStatus(customerId).then(d => { setData(d); setHidden(false); }, () => setHidden(true));
  }, [customerId]);
  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<CustomerJourneyStatus>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      setData(await fn());
      after?.();
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (hidden) return null;
  if (!data) return <div className="bg-white rounded-2xl border border-slate-200/80 p-5 text-xs text-slate-500" role="status"><Loader2 className="inline w-4 h-4 animate-spin mr-1" aria-hidden="true" />Loading the onboarding journey…</div>;
  if (!data.applies && !data.completedAt) return null;

  const m = data.meta;
  const options = NEXT[m.status];
  const needsFeedback = next === 'DOCUMENTS_REQUIRED' || next === 'REJECTED';

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-5" aria-labelledby={`jr-${customerId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`jr-${customerId}`} className="font-bold text-slate-900">Client onboarding journey</h2>
        {data.completedAt && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Completed {when(data.completedAt)}</span>}
      </div>
      <p className="text-xs text-slate-500">What the client sees on their dashboard. The client&apos;s sections open as each step is completed here.</p>
      {error && <p role="alert" className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}

      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-slate-400" aria-hidden="true" /> Meta verification</h3>
        {!data.metaRequired ? (
          <p className="text-xs text-slate-600">These services need no Meta verification.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {pill(META_TONE[m.status], META_LABEL[m.status])}
              {m.startedAt && <span className="text-slate-500">started {when(m.startedAt)}</span>}
              {m.status === 'COMPLETED' && m.completedAt && <span className="text-slate-500">completed {when(m.completedAt)}</span>}
            </div>
            {m.feedback && <p className="text-xs text-slate-700 bg-slate-50 rounded-xl px-3 py-2"><b>Shown to the client:</b> {m.feedback}</p>}
            <p className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
              <UserRound className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" /> Meta Verifier: <b>{m.verifier?.fullName ?? 'not assigned yet'}</b>
              {m.canAssign && m.status !== 'COMPLETED' && (
                <>
                  <button type="button" className={`${btnCls} border-slate-300 bg-white text-slate-700`} disabled={busy !== null} onClick={() => void run('assign', () => pipelineApi.assignMetaVerifier(customerId, null))}>
                    {busy === 'assign' ? 'Assigning…' : 'Assign to me'}
                  </button>
                  {candidates === null ? (
                    <button type="button" className={`${btnCls} border-slate-300 bg-white text-slate-700`} onClick={() => void pipelineApi.metaVerifierCandidates(customerId).then(setCandidates, () => setCandidates([]))}>Choose someone else</button>
                  ) : candidates.length > 0 ? (
                    <span className="inline-flex items-center gap-2">
                      <select aria-label="Meta Verifier" className="border border-slate-300 rounded-lg px-2 py-1 text-xs" value={pick} onChange={e => setPick(e.target.value)}>
                        <option value="">Choose…</option>
                        {candidates.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                      </select>
                      <button type="button" className={`${btnCls} border-blue-600 bg-blue-600 text-white`} disabled={!pick || busy !== null} onClick={() => void run('assign', () => pipelineApi.assignMetaVerifier(customerId, pick), () => setPick(''))}>Assign</button>
                    </span>
                  ) : null}
                </>
              )}
            </p>

            {m.canChange && options.length > 0 && (
              <form className="space-y-2 border-t border-slate-100 pt-3" onSubmit={e => { e.preventDefault(); if (next) void run('meta', () => pipelineApi.setMetaVerification(customerId, { status: next, feedback: feedback.trim() || null }), () => { setNext(''); setFeedback(''); }); }}>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs text-slate-600">
                    <span className="block font-semibold mb-1">Change the status to</span>
                    <select className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs min-w-[11rem]" value={next} onChange={e => setNext(e.target.value as typeof next)}>
                      <option value="">Choose…</option>
                      {options.map(o => (
                        <option key={o} value={o} disabled={o === 'COMPLETED' && !m.readyToComplete}>
                          {META_LABEL[o]}{o === 'COMPLETED' && !m.readyToComplete ? ' (authorize every document first)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={`${btnCls} border-blue-600 bg-blue-600 text-white`} disabled={!next || busy !== null || (needsFeedback && !feedback.trim())}>
                    {busy === 'meta' ? 'Saving…' : 'Update status'}
                  </button>
                </div>
                {(needsFeedback || next === 'COMPLETED' || next === 'IN_PROGRESS') && (
                  <label className="block text-xs text-slate-600">
                    <span className="block font-semibold mb-1">{needsFeedback ? 'What the client needs to do (shown to them)' : 'Note (not shown)'}</span>
                    <textarea className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs" rows={2} maxLength={1000} value={feedback} onChange={e => setFeedback(e.target.value)} />
                  </label>
                )}
                {!m.readyToComplete && <p className="text-[11px] text-slate-500">Completing needs every document and detail (including the WABA ID) authorized. Uploading a document never completes it.</p>}
              </form>
            )}
          </>
        )}
      </div>

      <div className="space-y-1">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><UserRound className="w-4 h-4 text-slate-400" aria-hidden="true" /> Relationship Manager</h3>
        <p className="text-xs text-slate-600">{data.relationshipManager ? <b>{data.relationshipManager.fullName}</b> : 'Not assigned yet. The Department Head hands the customer over after Meta verification is completed.'}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Wrench className="w-4 h-4 text-slate-400" aria-hidden="true" /> Service setup</h3>
        {data.services.length === 0 ? <p className="text-xs text-slate-500">No services.</p> : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {data.services.map(s => (
              <li key={s.code} className="p-3 flex flex-col lg:flex-row lg:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                  <p className="text-[11px] text-slate-500">{s.status === 'READY' && s.readyAt ? `Ready ${when(s.readyAt)}` : s.updatedAt ? `Updated ${when(s.updatedAt)}` : 'Not started'}{s.note ? ` · ${s.note}` : ''}</p>
                </div>
                {pill(SERVICE_TONE[s.status].cls, SERVICE_TONE[s.status].label)}
                {s.canChange && s.status !== 'READY' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input aria-label={`Note for ${s.name}`} className="border border-slate-300 rounded-lg px-2 py-1 text-xs w-44" placeholder="Note for the client (optional)" maxLength={500}
                      value={notes[s.code] ?? ''} onChange={e => setNotes(n => ({ ...n, [s.code]: e.target.value }))} />
                    {s.status === 'PENDING' && (
                      <button type="button" className={`${btnCls} border-slate-300 bg-white text-slate-700`} disabled={busy !== null}
                        onClick={() => void run(`s-${s.code}`, () => pipelineApi.setServiceSetup(customerId, s.code, { status: 'IN_PROGRESS', note: notes[s.code]?.trim() || null }))}><Clock className="w-3.5 h-3.5" aria-hidden="true" /> Start setup</button>
                    )}
                    <button type="button" className={`${btnCls} border-emerald-600 bg-emerald-600 text-white`} disabled={busy !== null}
                      onClick={() => void run(`s-${s.code}`, () => pipelineApi.setServiceSetup(customerId, s.code, { status: 'READY', note: notes[s.code]?.trim() || null }))}>
                      {busy === `s-${s.code}` ? 'Saving…' : 'Mark ready'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-500">A service can be marked ready only after the payment is confirmed, Meta verification is completed, the Relationship Manager is assigned and the service&apos;s documents are authorized.</p>
      </div>
    </section>
  );
};
