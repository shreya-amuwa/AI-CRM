import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, RotateCcw } from 'lucide-react';
import type { CeoOfficeStatus } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { meetingsApi } from '../../lib/api/meetings';
import { listenToTables } from '../../lib/realtimeShared';

/**
 * CEO office arrival (migration 20270128000300). HR presses "CEO HAS ARRIVED" on the HR dashboard; everyone asking the CEO for time sees a
 * red "has not arrived yet" or a green "has arrived" banner. It is information only: meeting requests are never disabled, hidden, refused
 * or decided by it (the database does not read it when a request is made). The status lives in the database and changes at once on every
 * screen (Supabase Realtime on ceo_office_arrivals), and again when the tab is shown.
 */
export function useCeoOffice(enabled = true): { office: CeoOfficeStatus | null; reload: () => void; setOffice: (o: CeoOfficeStatus) => void } {
  const [office, setOffice] = useState<CeoOfficeStatus | null>(null);
  const reload = useCallback(() => { if (enabled) meetingsApi.ceoOffice().then(setOffice).catch(() => undefined); }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    reload();
    let stop: () => void = () => undefined;
    try { stop = listenToTables(['ceo_office_arrivals'], reload); } catch { /* without Realtime: it still loads, and reloads when shown again */ }
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, reload]);
  return { office, reload, setOffice };
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

/** At the top of the CEO meeting request section. ceoId: the CEO being asked (when there is more than one). Never blocks anything. */
export const CeoArrivalBanner: React.FC<{ ceoId?: string }> = ({ ceoId }) => {
  const { office } = useCeoOffice();
  const ceo = office?.ceos.find(c => c.ceoId === ceoId) ?? office?.ceos[0];
  if (!ceo) return null;
  return ceo.arrived ? (
    <div role="status" aria-live="polite" data-testid="ceo-arrival" data-arrived="true" className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
      <p className="text-sm font-extrabold"><span aria-hidden="true">🟢 </span>MANAGING DIRECTOR HAS ARRIVED AT THE OFFICE</p>
      <p className="text-xs mt-0.5">Sir has arrived at the office. You can schedule meetings based on the available time slots.{ceo.arrivedAt ? ` (Arrived at ${time(ceo.arrivedAt)}.)` : ''}</p>
    </div>
  ) : (
    <div role="status" aria-live="polite" data-testid="ceo-arrival" data-arrived="false" className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3 text-rose-900">
      <p className="text-sm font-extrabold"><span aria-hidden="true">🔴 </span>MANAGING DIRECTOR HAS NOT ARRIVED AT THE OFFICE YET</p>
      <p className="text-xs mt-0.5">Sir has not arrived at the office yet. You can still schedule your meeting request. Meeting confirmation and availability will be subject to the Managing Director&apos;s arrival and approval.</p>
    </div>
  );
};

/** The HR dashboard's button (HR staff only; everyone else sees nothing here). */
export const CeoArrivalControl: React.FC = () => {
  const { office, setOffice } = useCeoOffice();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  if (!office?.canMark || !office.ceos.length) return null;
  const run = async (ceoId: string, undo: boolean) => {
    setBusy(ceoId);
    setMessage(null);
    try {
      const o = undo ? await meetingsApi.ceoArrivalUndo(ceoId) : await meetingsApi.ceoArrived(ceoId);
      setOffice(o);
      const c = o.ceos.find(x => x.ceoId === ceoId);
      setMessage({ tone: 'ok', text: undo ? 'Undone: employees see "has not arrived yet" again.' : o.duplicate ? `Already marked at ${time(c?.arrivedAt ?? null)}.` : `Marked at ${time(c?.arrivedAt ?? null)}: employees now see that the Managing Director has arrived.` });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-labelledby="ceo-arrival-h" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3" data-testid="ceo-arrival-control">
      <div>
        <h2 id="ceo-arrival-h" className="text-sm font-bold text-slate-900">Managing Director office arrival (today)</h2>
        <p className="text-xs text-slate-500">Shown to everyone who asks the Managing Director for time. It never stops anyone from sending a meeting request.</p>
      </div>
      {office.ceos.map(c => (
        <div key={c.ceoId} className="flex flex-wrap items-center gap-3">
          {office.ceos.length > 1 ? <span className="text-sm font-semibold text-slate-800">{c.name}</span> : null}
          {c.arrived ? (
            <>
              <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-800" data-testid="ceo-arrived-at">
                🟢 Arrived at {time(c.arrivedAt)}{c.markedBy ? ` · marked by ${c.markedBy}` : ''}
              </span>
              <button type="button" disabled={busy === c.ceoId} onClick={() => void run(c.ceoId, true)} data-testid="ceo-arrival-undo"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Undo (pressed by mistake)
              </button>
            </>
          ) : (
            <button type="button" disabled={busy === c.ceoId} onClick={() => void run(c.ceoId, false)} data-testid="ceo-arrived-button"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white shadow hover:bg-emerald-700 disabled:opacity-50">
              {busy === c.ceoId ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null} MANAGING DIRECTOR HAS ARRIVED{office.ceos.length > 1 ? ` (${c.name})` : ''}
            </button>
          )}
        </div>
      ))}
      {message ? <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>{message.text}</p> : null}
    </section>
  );
};

/** The warning the employee reads when the CEO has not arrived. The wording is fixed; it never blocks: "OK, continue" returns to the form. */
export const CEO_NOT_ARRIVED_NOTICE = 'Managing Director has not arrived yet. You can still schedule your meeting request. Please plan your preferred meeting time accordingly.';

export const CeoNotArrivedPopup: React.FC<{ onContinue: () => void }> = ({ onContinue }) => {
  const button = React.useRef<HTMLButtonElement>(null);
  const continueRef = React.useRef(onContinue);
  continueRef.current = onContinue;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); continueRef.current(); } };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
  }, []);
  // in the page body: the request form sits in a drawer that is moved with a transform, which would pin a fixed popup inside it
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4" data-testid="ceo-not-arrived-popup">
      <div role="alertdialog" aria-modal="true" aria-labelledby="ceo-na-title" aria-describedby="ceo-na-text" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl border border-rose-200">
        <h2 id="ceo-na-title" className="text-base font-extrabold text-rose-800"><span aria-hidden="true">🔴 </span>Managing Director has not arrived</h2>
        <p id="ceo-na-text" className="mt-2 text-sm text-slate-800" data-testid="ceo-not-arrived-text">{CEO_NOT_ARRIVED_NOTICE}</p>
        <div className="mt-4 flex justify-end">
          <button ref={button} type="button" onClick={onContinue} data-testid="ceo-not-arrived-continue"
            className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">OK, continue with my request</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/** A one-line "CEO today" status next to a meeting request (information only). */
export const CeoArrivalChip: React.FC<{ ceoId?: string | null }> = ({ ceoId }) => {
  const { office } = useCeoOffice();
  const ceo = office?.ceos.find(c => c.ceoId === ceoId) ?? office?.ceos[0];
  if (!ceo) return null;
  return (
    <span data-testid="ceo-arrival-chip" data-arrived={ceo.arrived ? 'true' : 'false'}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ceo.arrived ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
      <span aria-hidden="true">{ceo.arrived ? '🟢' : '🔴'}</span> Managing Director {ceo.arrived ? `has arrived${ceo.arrivedAt ? ` (${time(ceo.arrivedAt)})` : ''}` : 'has not arrived yet'}
    </span>
  );
};
