import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquareText, Pencil, Plus } from 'lucide-react';
import type { ConsultantNote } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { btn, ErrorBanner, inputCls, Spinner, useServiceCatalog, usePipelineRealtime } from '../../team-member/pipeline/shared';

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

/**
 * The Technical Consultant's notes about a customer: why they bought or did not, what they said,
 * their concerns and what to do next. Newest first, never overwritten. Only the author edits a note;
 * the Department Head and the CEO read them (`canWrite` is false for them).
 */
export const ConsultationNotes: React.FC<{ customerId: string; canWrite: boolean; services?: string[] }> = ({ customerId, canWrite, services = [] }) => {
  const { byCode } = useServiceCatalog();
  const [notes, setNotes] = useState<ConsultantNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [service, setService] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  const load = useCallback(() => {
    pipelineApi.consultantNotes(customerId).then(
      n => {
        setNotes(n);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [customerId]);
  useEffect(load, [load]);
  // Another consultant or tab may add a note; the periodic refresh keeps the history current.
  usePipelineRealtime(() => !editing && !draft && load());

  const run = async (fn: () => Promise<ConsultantNote[]>, done: () => void) => {
    setBusy(true);
    setError(null);
    try {
      setNotes(await fn());
      done();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return setError('Write the note first.');
    void run(
      () => pipelineApi.consultantAddNote(customerId, { body: draft.trim(), serviceCode: service || null }),
      () => {
        setDraft('');
        setService('');
      }
    );
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-labelledby={`notes-${customerId}`}>
      <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
        <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center" aria-hidden="true">
          <MessageSquareText className="w-4 h-4" />
        </span>
        <div>
          <h2 id={`notes-${customerId}`} className="font-bold text-slate-900">
            Consultation notes
          </h2>
          <p className="text-xs text-slate-500">What the customer said, why they bought or did not, their concerns and the follow-up.</p>
        </div>
      </div>

      {canWrite && (
        <form onSubmit={add} className="mt-4 space-y-2" aria-label="Add a consultation note">
          <label htmlFor={`note-${customerId}`} className="sr-only">
            New note
          </label>
          <textarea
            id={`note-${customerId}`}
            rows={3}
            maxLength={4000}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="e.g. Customer liked the WhatsApp API but is worried about the price. Will decide after the demo on Friday."
            className={inputCls}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {services.length > 0 ? (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Related service
                <select value={service} onChange={e => setService(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs">
                  <option value="">None</option>
                  {services.map(c => (
                    <option key={c} value={c}>
                      {byCode.get(c)?.name || c}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span />
            )}
            <button type="submit" disabled={busy || !draft.trim()} className={btn.primary}>
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}

      {!notes && !error ? (
        <Spinner label="Loading notes…" />
      ) : notes && notes.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">{canWrite ? 'No notes yet. Add the first one after your conversation with the customer.' : 'The consultant has not written any notes yet.'}</p>
      ) : (
        <ul className="mt-4 space-y-3" aria-label="Consultation notes">
          {notes?.map(n => (
            <li key={n.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60">
              {editing?.id === n.id ? (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    void run(
                      () => pipelineApi.consultantUpdateNote(customerId, n.id, editing.body.trim()),
                      () => setEditing(null)
                    );
                  }}
                  className="space-y-2"
                >
                  <textarea rows={3} maxLength={4000} value={editing.body} onChange={e => setEditing({ id: n.id, body: e.target.value })} className={inputCls} aria-label="Edit note" autoFocus />
                  <div className="flex justify-end gap-2">
                    <button type="button" className={btn.secondary} onClick={() => setEditing(null)} disabled={busy}>
                      Cancel
                    </button>
                    <button type="submit" className={btn.primary} disabled={busy || !editing.body.trim()}>
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="text-sm text-slate-800 whitespace-pre-line break-words">{n.body}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>
                      {n.author?.fullName || 'Unknown'} · {stamp(n.createdAt)}
                      {n.updatedAt !== n.createdAt && ` · edited ${stamp(n.updatedAt)}`}
                      {n.serviceCode && ` · ${byCode.get(n.serviceCode)?.name || n.serviceCode}`}
                    </span>
                    {n.canEdit && (
                      <button type="button" className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline" onClick={() => setEditing({ id: n.id, body: n.body })} aria-label="Edit this note">
                        <Pencil className="w-3 h-3" aria-hidden="true" /> Edit
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
