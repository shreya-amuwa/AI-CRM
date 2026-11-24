import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, MessageCircle, Phone, PhoneCall } from 'lucide-react';
import { FOLLOWUP_CHANNELS, TC_FOLLOWUP_OUTCOMES, type FollowUpChannel, type TcFollowUp, type TcFollowUpOutcome, type TcFollowUpStatus } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { workflowApi } from '../../../lib/api/endpoints';
import { useRealtime } from '../../../lib/support';
import { btn, Dialog, ErrorBanner, Field, inputCls, longDate, notifyPipelineChanged, Pill, Spinner, usePipelineRealtime, type Tone } from '../../team-member/pipeline/shared';

const STATUS_LABEL: Record<TcFollowUpStatus, string> = {
  AWAITING_CONFIGURATION: 'Waiting for the delay to be set',
  SCHEDULED: 'Scheduled',
  DUE: 'Due',
  DONE: 'Done',
  CANCELLED: 'Cancelled'
};
const STATUS_TONE: Record<TcFollowUpStatus, Tone> = { AWAITING_CONFIGURATION: 'orange', SCHEDULED: 'indigo', DUE: 'red', DONE: 'green', CANCELLED: 'slate' };
const OUTCOME_LABEL: Record<TcFollowUpOutcome, string> = {
  NO_ANSWER: 'No answer',
  CALL_BACK: 'Call back later',
  CONTACTED: 'Spoke to the customer',
  ADDON_INTERESTED: 'Interested in add-ons',
  NOT_INTERESTED: 'Not interested',
  COMPLETED: 'Consultation completed'
};
const CHANNEL_LABEL: Record<FollowUpChannel, string> = { CALL: 'Call', WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', MEETING: 'Meeting', OTHER: 'Other' };
const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '-';

const ContactDialog: React.FC<{ item: TcFollowUp; onClose: () => void; onDone: () => void }> = ({ item, onClose, onDone }) => {
  const [channel, setChannel] = useState<FollowUpChannel>('CALL');
  const [outcome, setOutcome] = useState<TcFollowUpOutcome>('CONTACTED');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Call back later" and "no answer" need the next date; the other outcomes close the follow-up (or hand to the add-on flow)
  const needsNext = outcome === 'NO_ANSWER' || outcome === 'CALL_BACK';
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await workflowApi.recordContact(item.id, { channel, outcome, note: note.trim() || null, nextFollowUpAt: needsNext && next ? new Date(next).toISOString() : null });
      notifyPipelineChanged();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Record the consultation" description={`${item.customer}${item.contact ? ` · ${item.contact}` : ''}`} onClose={() => !busy && onClose()}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="How did you reach the customer?" htmlFor="fu-channel">
            <select id="fu-channel" className={inputCls} value={channel} onChange={e => setChannel(e.target.value as FollowUpChannel)} disabled={busy}>
              {FOLLOWUP_CHANNELS.map(c => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Outcome" htmlFor="fu-outcome">
            <select id="fu-outcome" className={inputCls} value={outcome} onChange={e => setOutcome(e.target.value as TcFollowUpOutcome)} disabled={busy}>
              {TC_FOLLOWUP_OUTCOMES.map(o => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {needsNext && (
          <Field label="Follow up again on" htmlFor="fu-next" required>
            <input id="fu-next" type="datetime-local" className={inputCls} value={next} onChange={e => setNext(e.target.value)} disabled={busy} />
          </Field>
        )}
        <Field label="Notes (optional)" htmlFor="fu-note">
          <textarea id="fu-note" rows={3} maxLength={2000} className={inputCls} value={note} onChange={e => setNote(e.target.value)} disabled={busy} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btn.primary} disabled={busy || (needsNext && !next)}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

/**
 * The Technical Consultant's follow-ups: customers the Meta Verifier handed over and the Department Head passed on, scheduled for a
 * consultation after the delay the Super Admin configured. Each shows why it exists, who handed it over and when it is due; recording a
 * consultation keeps the history. A follow-up for a customer who is no longer eligible is cancelled by the database, not shown as work.
 */
export const TcFollowUps: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const [scope, setScope] = useState<'OPEN' | 'DONE' | 'ALL'>('OPEN');
  const [items, setItems] = useState<TcFollowUp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contacting, setContacting] = useState<TcFollowUp | null>(null);

  const load = useCallback(() => {
    workflowApi.followUps(scope).then(
      r => {
        setItems(r);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [scope]);
  useEffect(load, [load]);
  usePipelineRealtime(load);
  // a follow-up falls due or is cancelled in the database: the list follows (no timer)
  useRealtime('tc_followups', load);

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold text-slate-900">Follow-ups</h1>
          <p className="text-sm text-slate-500 mt-1">
            Customers handed over after the first verification. Each is due for a consultation after the waiting time the Managing Director set.
          </p>
        </div>
        <div role="tablist" aria-label="Follow-ups" className="flex gap-1.5">
          {(['OPEN', 'DONE', 'ALL'] as const).map(k => (
            <button
              key={k}
              role="tab"
              aria-selected={scope === k}
              onClick={() => setScope(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${scope === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
            >
              {k === 'OPEN' ? 'Open' : k === 'DONE' ? 'Done' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!items && !error && <Spinner label="Loading follow-ups…" />}
      {items && items.length === 0 && <p className="py-10 text-center text-sm text-slate-500 bg-white rounded-2xl border border-slate-200/80">Nothing to follow up.</p>}

      {items && items.length > 0 && (
        <ul className="space-y-2" aria-label="Follow-ups">
          {items.map(f => (
            <li key={f.id} className="bg-white rounded-2xl border border-slate-200/80 p-4 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_auto] items-start" data-testid="followup-row">
              <div className="min-w-0 space-y-1">
                <p className="font-bold text-slate-900 truncate">{f.customer}</p>
                <p className="text-xs text-slate-500 truncate">{[f.contact, f.services.join(', ')].filter(Boolean).join(' · ')}</p>
                <p className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {f.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" aria-hidden="true" /> {f.phone}
                    </span>
                  )}
                  {f.whatsapp && (
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" aria-hidden="true" /> {f.whatsapp}
                    </span>
                  )}
                </p>
                {f.reason && <p className="text-xs text-slate-600">Reason: {f.reason}</p>}
                {f.handoverNote && <p className="text-xs text-slate-500 break-words">Handover note: {f.handoverNote}</p>}
              </div>
              <div className="min-w-0 space-y-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={STATUS_TONE[f.effectiveStatus]}>{STATUS_LABEL[f.effectiveStatus]}</Pill>
                  {f.dueAt && (
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" /> {dateTime(f.dueAt)}
                    </span>
                  )}
                </div>
                {f.status === 'AWAITING_CONFIGURATION' && <p className="text-amber-800">The waiting time is not set yet. It is scheduled as soon as the Managing Director sets it.</p>}
                {f.status === 'CANCELLED' && f.cancelledReason && <p className="text-slate-500">{f.cancelledReason}</p>}
                {f.lastContact && (
                  <p className="text-slate-600">
                    Last: {CHANNEL_LABEL[f.lastContact.channel]} · {OUTCOME_LABEL[f.lastContact.outcome]} · {longDate(f.lastContact.at)}
                    {f.contacts > 1 ? ` (${f.contacts} contacts)` : ''}
                  </p>
                )}
                {f.assignedTo && <p className="text-slate-500">With {f.assignedTo.name}</p>}
              </div>
              <div className="flex md:flex-col gap-2">
                {(f.status === 'SCHEDULED' || f.status === 'DUE') && (
                  <button type="button" className={btn.primary} onClick={() => setContacting(f)}>
                    <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" /> Record consultation
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {contacting && (
        <ContactDialog
          item={contacting}
          onClose={() => setContacting(null)}
          onDone={() => {
            setContacting(null);
            load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
};
