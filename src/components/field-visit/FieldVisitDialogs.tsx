import React, { useEffect, useRef, useState } from 'react';
import { LEAD_VISIT_STATUS_LABELS, type LeadVisit, type LeadVisitStatus } from '../../../shared/contracts';
import { fieldVisitCompleteSchema, fieldVisitScheduleSchema } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { fieldVisitApi } from '../../lib/api/endpoints';
import { captureLocation } from '../../services/fieldVisitStore';
import { Dialog, ErrorBanner, Field, Pill, Spinner, btn, inputCls, todayIso, type Tone } from '../team-member/pipeline/shared';
import { dateText, dateTimeText } from '../telecaller/ui';

/** The lead a visit is planned for (the few fields the dialogs need). */
export interface VisitLead {
  leadId: string;
  name: string;
  company?: string | null;
  address?: string | null;
}

export const VISIT_STATUS_TONE: Record<LeadVisitStatus | 'NOT_PLANNED', Tone> = {
  SCHEDULED: 'indigo',
  IN_PROGRESS: 'orange',
  COMPLETED: 'green',
  FOLLOW_UP_REQUIRED: 'orange',
  CANCELLED: 'slate',
  NOT_PLANNED: 'slate'
};
export const VisitStatusPill: React.FC<{ status: LeadVisitStatus | 'NOT_PLANNED' }> = ({ status }) => <Pill tone={VISIT_STATUS_TONE[status]}>{LEAD_VISIT_STATUS_LABELS[status]}</Pill>;

/** "10:30:00" -> "10:30 AM" */
export function timeText(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const Buttons: React.FC<{ onClose: () => void; busy: boolean; submitLabel: string; tone?: 'primary' | 'danger' }> = ({ onClose, busy, submitLabel, tone = 'primary' }) => (
  <div className="flex justify-end gap-2 pt-1">
    <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
      Close
    </button>
    <button type="submit" className={tone === 'danger' ? btn.danger : btn.primary} disabled={busy}>
      {busy ? 'Saving…' : submitLabel}
    </button>
  </div>
);

const fieldErrors = (issues: { path: PropertyKey[]; message: string }[]) => {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
};

/** Plan a visit, or change the plan of one that has not started. */
export const ScheduleVisitDialog: React.FC<{ lead: VisitLead; visit?: LeadVisit; onClose: () => void; onSaved: (v: LeadVisit) => void }> = ({ lead, visit, onClose, onSaved }) => {
  const [form, setForm] = useState({
    visitDate: visit?.visitDate ?? todayIso(),
    plannedTime: visit?.plannedTime ? visit.plannedTime.slice(0, 5) : '',
    address: visit?.address ?? lead.address ?? '',
    purpose: visit?.purpose ?? '',
    notes: visit?.notes ?? ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // one id per opened dialog: a double click or a retry returns the visit that was already made instead of a second one
  const requestId = useRef(crypto.randomUUID());
  const guard = useRef(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guard.current) return;
    const body = {
      visitDate: form.visitDate,
      plannedTime: form.plannedTime || null,
      address: form.address || null,
      purpose: form.purpose,
      notes: form.notes || null
    };
    const parsed = fieldVisitScheduleSchema.safeParse({ leadId: lead.leadId, ...body, ...(visit ? {} : { clientRequestId: requestId.current }) });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    if (form.visitDate < todayIso()) {
      setErrors({ visitDate: 'The visit date cannot be in the past.' });
      return;
    }
    setErrors({});
    setError(null);
    guard.current = true;
    setBusy(true);
    try {
      onSaved(visit ? await fieldVisitApi.update(visit.id, body as Parameters<typeof fieldVisitApi.update>[1]) : await fieldVisitApi.schedule({ leadId: lead.leadId, ...body, clientRequestId: requestId.current } as Parameters<typeof fieldVisitApi.schedule>[0]));
    } catch (err) {
      setError(errorMessage(err));
      guard.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog title={visit ? 'Change the visit plan' : 'Schedule a field visit'} description={`${lead.name}${lead.company ? ` · ${lead.company}` : ''}`} onClose={onClose} persistent>
      <form onSubmit={submit} className="space-y-3" noValidate data-testid="visit-schedule-form">
        {error && <ErrorBanner message={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Visit date" required htmlFor="visit-date" error={errors.visitDate}>
            <input id="visit-date" type="date" className={inputCls} value={form.visitDate} min={todayIso()} onChange={set('visitDate')} />
          </Field>
          <Field label="Planned time" htmlFor="visit-time" error={errors.plannedTime}>
            <input id="visit-time" type="time" className={inputCls} value={form.plannedTime} onChange={set('plannedTime')} />
          </Field>
        </div>
        <Field label="Visit address" htmlFor="visit-address" error={errors.address}>
          <input id="visit-address" className={inputCls} value={form.address} onChange={set('address')} maxLength={500} autoComplete="off" />
        </Field>
        <Field label="Purpose of the visit" required htmlFor="visit-purpose" error={errors.purpose}>
          <input id="visit-purpose" className={inputCls} value={form.purpose} onChange={set('purpose')} maxLength={300} autoComplete="off" placeholder="e.g. Demo at the shop, collect documents" />
        </Field>
        <Field label="Notes" htmlFor="visit-notes" error={errors.notes}>
          <textarea id="visit-notes" rows={3} className={inputCls} value={form.notes} onChange={set('notes')} maxLength={2000} />
        </Field>
        <Buttons onClose={onClose} busy={busy} submitLabel={visit ? 'Save the plan' : 'Schedule visit'} />
      </form>
    </Dialog>
  );
};

/**
 * Start a visit. The position is optional and is never invented: it is recorded only when the device really gave it, and a visit started
 * without it is shown as "location not captured".
 */
export const StartVisitDialog: React.FC<{ visit: LeadVisit; onClose: () => void; onSaved: (v: LeadVisit) => void }> = ({ visit, onClose, onSaved }) => {
  const [phase, setPhase] = useState<'ask' | 'locating' | 'denied'>('ask');
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  // a position request the person stopped waiting for must not start the visit when it finally answers
  const attempt = useRef(0);

  const start = async (withLocation: boolean) => {
    if (guard.current) return;
    guard.current = true;
    setError(null);
    setBusy(true);
    try {
      let body: Parameters<typeof fieldVisitApi.start>[1] = {};
      if (withLocation) {
        const mine = ++attempt.current;
        setPhase('locating');
        const { location, error: locationError } = await captureLocation();
        if (mine !== attempt.current) return;
        if (!location) {
          // permission denied or no signal: nothing is started, the person decides (the visit is never marked as GPS-captured)
          setReason(locationError || 'Could not read the location.');
          setPhase('denied');
          guard.current = false;
          setBusy(false);
          return;
        }
        body = { latitude: location.lat, longitude: location.lng, accuracyMeters: location.accuracyMeters };
      } else {
        body = { locationNote: reason ? 'Started without location: ' + reason : 'Started without location.' };
      }
      onSaved(await fieldVisitApi.start(visit.id, body));
    } catch (err) {
      setError(errorMessage(err));
      setPhase('ask');
      guard.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog title="Start the visit" description={`${visit.leadName} · ${dateText(visit.visitDate)}`} onClose={onClose} persistent>
      <div className="space-y-3" data-testid="visit-start">
        {error && <ErrorBanner message={error} />}
        {phase === 'locating' ? (
          <div className="space-y-2">
          <Spinner label="Reading your location…" />
          <p className="text-center text-xs text-slate-500">If your browser is asking for permission, allow it, or start without the location.</p>
          <div className="flex justify-center">
            <button
              type="button"
              className={btn.secondary}
              data-testid="visit-start-skip"
              onClick={() => {
                attempt.current++;
                guard.current = false;
                setReason('You chose not to wait for the location.');
                void start(false);
              }}
            >
              Start without location
            </button>
          </div>
        </div>
        ) : (
          <>
            <p className="text-sm text-slate-700">
              Share your location to record where the visit started. The place is stored as <b>captured by the device</b>; it is not checked against the customer's address.
            </p>
            {phase === 'denied' && (
              <div role="alert" className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs" data-testid="visit-gps-denied">
                {reason} You can try again, or start the visit without a location. It will then be shown as <b>location not captured</b>.
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
                Close
              </button>
              <button type="button" className={btn.secondary} onClick={() => void start(false)} disabled={busy} data-testid="visit-start-nogps">
                Start without location
              </button>
              <button type="button" className={btn.primary} onClick={() => void start(true)} disabled={busy} data-testid="visit-start-gps">
                {phase === 'denied' ? 'Try location again' : 'Start with my location'}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};

/** Record how the visit went. A follow-up needs its date; the lead's next follow-up is set only for the lead's own owner (the database decides). */
export const CompleteVisitDialog: React.FC<{ visit: LeadVisit; onClose: () => void; onSaved: (v: LeadVisit) => void }> = ({ visit, onClose, onSaved }) => {
  const [form, setForm] = useState({ status: 'COMPLETED' as 'COMPLETED' | 'FOLLOW_UP_REQUIRED', outcome: '', notes: visit.notes ?? '', requirements: '', nextSteps: '', followUpDate: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guard.current) return;
    const body = {
      status: form.status,
      outcome: form.outcome,
      notes: form.notes || null,
      requirements: form.requirements || null,
      nextSteps: form.nextSteps || null,
      followUpDate: form.followUpDate || null
    };
    const parsed = fieldVisitCompleteSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setError(null);
    guard.current = true;
    setBusy(true);
    try {
      onSaved(await fieldVisitApi.complete(visit.id, parsed.data as Parameters<typeof fieldVisitApi.complete>[1]));
    } catch (err) {
      setError(errorMessage(err));
      guard.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog title="Record the visit outcome" description={`${visit.leadName}${visit.company ? ` · ${visit.company}` : ''}`} onClose={onClose} persistent>
      <form onSubmit={submit} className="space-y-3" noValidate data-testid="visit-complete-form">
        {error && <ErrorBanner message={error} />}
        <div role="radiogroup" aria-label="Visit result" className="flex gap-2">
          {(['COMPLETED', 'FOLLOW_UP_REQUIRED'] as const).map(s => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={form.status === s}
              onClick={() => setForm(f => ({ ...f, status: s }))}
              className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-bold border transition-colors ${form.status === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
            >
              {LEAD_VISIT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <Field label="Outcome" required htmlFor="visit-outcome" error={errors.outcome}>
          <textarea id="visit-outcome" rows={3} className={inputCls} value={form.outcome} onChange={set('outcome')} maxLength={2000} />
        </Field>
        <Field label="Meeting notes" htmlFor="visit-meeting-notes" error={errors.notes}>
          <textarea id="visit-meeting-notes" rows={3} className={inputCls} value={form.notes} onChange={set('notes')} maxLength={2000} />
        </Field>
        <Field label="Customer requirements" htmlFor="visit-requirements" error={errors.requirements}>
          <textarea id="visit-requirements" rows={2} className={inputCls} value={form.requirements} onChange={set('requirements')} maxLength={2000} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Next steps" htmlFor="visit-next-steps" error={errors.nextSteps}>
            <input id="visit-next-steps" className={inputCls} value={form.nextSteps} onChange={set('nextSteps')} maxLength={1000} autoComplete="off" />
          </Field>
          <Field label="Next follow-up date" required={form.status === 'FOLLOW_UP_REQUIRED'} htmlFor="visit-followup" error={errors.followUpDate}>
            <input id="visit-followup" type="date" className={inputCls} value={form.followUpDate} min={todayIso()} onChange={set('followUpDate')} />
          </Field>
        </div>
        <Buttons onClose={onClose} busy={busy} submitLabel="Save outcome" />
      </form>
    </Dialog>
  );
};

/** Cancelling asks first and keeps the visit in the history. */
export const CancelVisitDialog: React.FC<{ visit: LeadVisit; onClose: () => void; onSaved: (v: LeadVisit) => void }> = ({ visit, onClose, onSaved }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      onSaved(await fieldVisitApi.cancel(visit.id, reason.trim() || null));
    } catch (err) {
      setError(errorMessage(err));
      guard.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog title="Cancel this visit?" description={`${visit.leadName} · ${dateText(visit.visitDate)}. It stays in the visit history as cancelled.`} onClose={onClose} persistent>
      <form onSubmit={submit} className="space-y-3" data-testid="visit-cancel-form">
        {error && <ErrorBanner message={error} />}
        <Field label="Reason (optional)" htmlFor="visit-cancel-reason">
          <input id="visit-cancel-reason" className={inputCls} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} autoComplete="off" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Keep the visit
          </button>
          <button type="submit" className={btn.danger} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel the visit'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export const LocationLine: React.FC<{ visit: LeadVisit }> = ({ visit }) =>
  visit.gpsCaptured ? (
    <span>
      Location captured by the device{visit.checkinAccuracyM !== null ? ` (±${visit.checkinAccuracyM} m)` : ''} · {dateTimeText(visit.checkinAt)}
    </span>
  ) : visit.startedAt ? (
    <span>Location not captured{visit.locationNote ? ` · ${visit.locationNote}` : ''}</span>
  ) : (
    <span>Not started</span>
  );

/** Every visit of one lead, newest first. Nothing here is ever overwritten: each visit is its own record. */
export const VisitHistoryDialog: React.FC<{ lead: Pick<VisitLead, 'leadId' | 'name'>; onClose: () => void }> = ({ lead, onClose }) => {
  const [items, setItems] = useState<LeadVisit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    fieldVisitApi.list({ scope: 'ALL', leadId: lead.leadId, pageSize: 100 }).then(d => setItems(d.items), err => setError(errorMessage(err)));
  };
  useEffect(load, [lead.leadId]);
  return (
    <Dialog title={`Visit history · ${lead.name}`} onClose={onClose} wide>
      <div className="space-y-3" data-testid="visit-history-dialog">
        {error && <ErrorBanner message={error} onRetry={load} />}
        {!items && !error && <Spinner />}
        {items && items.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No visits have been recorded for this lead yet.</p>}
        {items?.map(v => (
          <div key={v.id} className="rounded-xl border border-slate-200 p-3 space-y-1.5" data-testid="visit-history-item">
            <div className="flex flex-wrap items-center gap-2">
              <VisitStatusPill status={v.status} />
              <span className="text-sm font-bold text-slate-900">
                {dateText(v.visitDate)}
                {v.plannedTime ? ` · ${timeText(v.plannedTime)}` : ''}
              </span>
              <span className="text-xs text-slate-500">by {v.employee.fullName}</span>
            </div>
            <p className="text-sm text-slate-800">{v.purpose}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {(
                [
                  ['Address', v.address],
                  ['Outcome', v.outcome],
                  ['Notes', v.notes],
                  ['Requirements', v.requirements],
                  ['Next steps', v.nextSteps],
                  ['Next follow-up', v.nextFollowUp ? dateText(v.nextFollowUp) : null],
                  ['Cancelled because', v.cancelReason]
                ] as [string, string | null][]
              )
                .filter(([, value]) => value)
                .map(([k, value]) => (
                  <div key={k}>
                    <dt className="font-medium text-slate-500">{k}</dt>
                    <dd className="text-slate-800 whitespace-pre-wrap break-words">{value}</dd>
                  </div>
                ))}
              <div className="sm:col-span-2 text-slate-500">
                <LocationLine visit={v} />
                {v.completedAt ? ` · Finished ${dateTimeText(v.completedAt)}` : ''}
              </div>
            </dl>
          </div>
        ))}
        <div className="flex justify-end pt-1">
          <button type="button" className={btn.secondary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
};
