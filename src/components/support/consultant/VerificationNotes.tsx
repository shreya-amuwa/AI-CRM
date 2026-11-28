import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { VERIFICATION_OUTCOMES, type VerificationNote, type VerificationOutcome } from '../../../../shared/contracts';
import { workflowApi } from '../../../lib/api/endpoints';
import { btn, ErrorBanner, inputCls, Pill, Spinner, usePipelineRealtime, type Tone } from '../../team-member/pipeline/shared';
import { Paged } from '../../common/Paged';
import { userMessage } from '../../../lib/feedback/errors';

const OUTCOME_LABEL: Record<VerificationOutcome, string> = {
  NOTE: 'Note',
  PENDING: 'Waiting for the customer',
  NEEDS_CORRECTION: 'Needs correction',
  VERIFIED: 'Verified'
};
const OUTCOME_TONE: Record<VerificationOutcome, Tone> = { NOTE: 'slate', PENDING: 'orange', NEEDS_CORRECTION: 'red', VERIFIED: 'green' };
const stamp = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

/**
 * The Meta Verifier's record of the first WhatsApp verification: what was checked, what the customer must correct, and the outcome.
 * Newest first, never overwritten - the history stays with the customer for the Department Head and the Technical Consultant who follow.
 */
export const VerificationNotes: React.FC<{ customerId: string; canWrite: boolean }> = ({ customerId, canWrite }) => {
  const [notes, setNotes] = useState<VerificationNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [outcome, setOutcome] = useState<VerificationOutcome>('NOTE');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    workflowApi.verificationNotes(customerId).then(
      n => {
        setNotes(n);
        setError(null);
      },
      e => setError(userMessage(e))
    );
  }, [customerId]);
  useEffect(load, [load]);
  usePipelineRealtime(() => !draft && load());

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return setError('Write the note first.');
    setBusy(true);
    setError(null);
    try {
      setNotes(await workflowApi.addVerificationNote(customerId, { body: draft.trim(), outcome }));
      setDraft('');
      setOutcome('NOTE');
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4" aria-labelledby="verification-notes-heading">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0" aria-hidden="true">
          <ShieldCheck className="w-4 h-4" />
        </span>
        <div>
          <h2 id="verification-notes-heading" className="font-bold text-slate-900">
            Verification notes
          </h2>
          <p className="text-xs text-slate-500">What was checked and the outcome. The Department Head and the Technical Consultant read them later.</p>
        </div>
      </div>

      {canWrite && (
        <form onSubmit={add} className="space-y-2" aria-label="Add a verification note">
          <div className="grid sm:grid-cols-[14rem_1fr] gap-2">
            <label className="text-xs font-semibold text-slate-700">
              Outcome
              <select className={`${inputCls} mt-1`} value={outcome} onChange={e => setOutcome(e.target.value as VerificationOutcome)} disabled={busy}>
                {VERIFICATION_OUTCOMES.map(o => (
                  <option key={o} value={o}>
                    {OUTCOME_LABEL[o]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Note
              <textarea rows={2} maxLength={2000} className={`${inputCls} mt-1`} value={draft} onChange={e => setDraft(e.target.value)} disabled={busy} />
            </label>
          </div>
          <div className="flex justify-end">
            <button type="submit" className={btn.primary} disabled={busy || !draft.trim()}>
              {busy ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </form>
      )}
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!notes && !error && <Spinner label="Loading notes…" />}
      {notes && notes.length === 0 && <p className="text-sm text-slate-500">No notes yet.</p>}
      {notes && notes.length > 0 && (
        <Paged items={notes} noun="notes">{rows => (
        <ul className="space-y-2">
          {rows.map(n => (
            <li key={n.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Pill tone={OUTCOME_TONE[n.outcome]}>{OUTCOME_LABEL[n.outcome]}</Pill>
                <span>{n.author ?? 'Someone'}</span>
                <span>· {stamp(n.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-line break-words text-slate-800">{n.body}</p>
            </li>
          ))}
        </ul>
        )}</Paged>
      )}
    </section>
  );
};
