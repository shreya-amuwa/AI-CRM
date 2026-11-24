import React, { useState } from 'react';
import { CalendarClock, CheckCircle2, Crown, Loader2, XCircle } from 'lucide-react';
import type { CeoOfficeCeo } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { meetingsApi } from '../../lib/api/meetings';
import { useCeoOffice } from './CeoArrival';
import { HrPageHeader } from '../hr/hrUi';

/**
 * HR dashboards > CEO Availability (migration 20270201000100). The status lives in the database (ceo_office_arrivals) and every screen follows it
 * through Supabase Realtime: what HR sets here is what an employee sees on "Ask the CEO for time". HR staff press CEO Arrived / CEO Not Arrived
 * (the database lets only them, and the Super Admin); every other person who opens this page, such as an HR Recruiter, only reads. It is
 * information only: it never blocks, hides or decides a meeting request.
 */
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

const CeoCard: React.FC<{ ceo: CeoOfficeCeo; canMark: boolean; multiple: boolean; onChange: (o: Awaited<ReturnType<typeof meetingsApi.ceoOffice>>) => void }> = ({ ceo, canMark, multiple, onChange }) => {
  const [busy, setBusy] = useState<'arrived' | 'not-arrived' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = async (kind: 'arrived' | 'not-arrived') => {
    setBusy(kind);
    setMessage(null);
    try {
      const o = kind === 'arrived' ? await meetingsApi.ceoArrived(ceo.ceoId) : await meetingsApi.ceoNotArrived(ceo.ceoId);
      onChange(o);
      setMessage({ tone: 'ok', text: o.duplicate
        ? (kind === 'arrived' ? 'The Managing Director was already marked as arrived today. Nothing changed.' : 'The Managing Director is already marked as not arrived. Nothing changed.')
        : (kind === 'arrived' ? 'Saved: employees now see that the Managing Director has arrived.' : 'Saved: employees now see that the Managing Director has not arrived yet.') });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const arrived = ceo.arrived;
  return (
    <section aria-labelledby={`ceo-av-${ceo.ceoId}`} data-testid="ceo-availability-card" data-status={arrived ? 'ARRIVED' : 'NOT_ARRIVED'}
      className={`rounded-2xl border-2 p-5 shadow-sm space-y-4 ${arrived ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${arrived ? 'bg-emerald-600' : 'bg-rose-600'} text-white`} aria-hidden="true">
          {arrived ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
        </span>
        <div>
          <h2 id={`ceo-av-${ceo.ceoId}`} className="text-base font-extrabold text-slate-900">{multiple ? ceo.name : 'Current availability'}</h2>
          <p className="text-sm font-bold" data-testid="ceo-availability-status">
            <span className={arrived ? 'text-emerald-800' : 'text-rose-800'}>{arrived ? 'Managing Director has arrived at the office' : 'Managing Director has not arrived yet'}</span>
          </p>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="ceo-availability-updated">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest status update</dt>
          <dd className="text-slate-900">
            {ceo.updatedAt
              ? <>{ceo.updatedStatus === 'ARRIVED' ? 'Managing Director Arrived' : 'Managing Director Not Arrived'} · <time dateTime={ceo.updatedAt}>{when(ceo.updatedAt)}</time>{ceo.updatedBy ? ` · by ${ceo.updatedBy}` : ''}</>
              : 'No update has been recorded yet.'}
          </dd>
        </div>
        {ceo.updatedAt && ceo.updatedToday === false ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Today</dt>
            <dd className="text-slate-900">No update yet today, so the Managing Director shows as not arrived.</dd>
          </div>
        ) : null}
      </dl>

      {canMark ? (
        <div className="flex flex-wrap gap-3" role="group" aria-label="Update the Managing Director's availability">
          <button type="button" data-testid="ceo-set-arrived" disabled={busy !== null || arrived} aria-pressed={arrived} onClick={() => void run('arrived')}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-extrabold text-white shadow hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy === 'arrived' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <CheckCircle2 className="w-4 h-4" aria-hidden />} Managing Director Arrived
          </button>
          <button type="button" data-testid="ceo-set-not-arrived" disabled={busy !== null || !arrived && ceo.updatedToday === true && ceo.updatedStatus === 'NOT_ARRIVED'} aria-pressed={!arrived} onClick={() => void run('not-arrived')}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-extrabold text-white shadow hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy === 'not-arrived' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <XCircle className="w-4 h-4" aria-hidden />} Managing Director Not Arrived
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-600" data-testid="ceo-availability-readonly">Only HR staff update the Managing Director&apos;s availability. You see the latest status here.</p>
      )}
      {message ? <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-800'}`}>{message.text}</p> : null}
    </section>
  );
};

export const CeoAvailabilityPage: React.FC = () => {
  const { office, setOffice } = useCeoOffice();
  return (
    <div className="space-y-5 max-w-3xl" data-testid="ceo-availability-page">
      <HrPageHeader icon={Crown} title="Managing Director Availability"
        subtitle="Whether the Managing Director has arrived at the office today. Every dashboard shows the same latest status, and it is shown to employees who ask the Managing Director for time. It never stops anyone from sending a meeting request." />
      {office === null ? (
        <p role="status" className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading the Managing Director&apos;s availability…</p>
      ) : office.ceos.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No Managing Director account was found.</p>
      ) : (
        office.ceos.map(c => <CeoCard key={c.ceoId} ceo={c} canMark={office.canMark} multiple={office.ceos.length > 1} onChange={setOffice} />)
      )}
      <p className="text-xs text-slate-500 flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" aria-hidden /> The status is for today (India time); it starts each day as not arrived.</p>
    </div>
  );
};

export default CeoAvailabilityPage;
