import React, { useCallback, useEffect, useState } from 'react';
import { DoorOpen, Loader2, LogIn, Video } from 'lucide-react';
import type { CeoPresence, CeoPresenceExit, Meeting } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { meetingsApi } from '../../lib/api/meetings';
import { listenToTables } from '../../lib/realtimeShared';

/**
 * Employee availability: Enter Meeting / Exit Meeting (migration 20270122000100).
 *  - Every employee except the Super Admin presses Enter Meeting (BUSY) and Exit Meeting (AVAILABLE) for themself; the database refuses the
 *    Super Admin and records the entry and exit times.
 *  - The state lives in the database (public.meeting_presence). Every screen that shows it listens to that table through Supabase Realtime and
 *    reloads at once, so BUSY / AVAILABLE changes everywhere without a refresh; coming back to the tab reloads too (a missed event).
 */
function usePresence(ids: string[] | null, enabled: boolean, ceo = false): { list: CeoPresence[] | null; reload: () => void } {
  const [list, setList] = useState<CeoPresence[] | null>(null);
  const key = ceo ? 'ceo' : ids ? ids.join(',') : '';
  const reload = useCallback(() => {
    if (!enabled || (!ceo && ids && !ids.length)) { setList(ids ? [] : null); return; }
    (ceo ? meetingsApi.ceoPresence() : meetingsApi.presence(ids ?? undefined)).then(setList).catch(() => setList(cur => cur ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  useEffect(() => {
    if (!enabled) return;
    reload();
    let stop: () => void = () => undefined;
    try {
      stop = listenToTables(['meeting_presence'], reload);
    } catch {
      // a client without Realtime: the status still loads, and reloads when the tab is shown again
    }
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, reload]);
  return { list, reload };
}

/** The signed-in person's own status (the Super Admin's carries their queue of waiting requests). */
export const useMyPresence = (enabled = true) => usePresence(null, enabled);
/** The CEOs' live status, for "Ask the CEO for time": a request made while BUSY joins the queue (20270128000100). */
export const useCeoPresence = (enabled = true) => usePresence(null, enabled, true);
/** The live status of some colleagues (the people being invited to a meeting). */
export const usePresenceOf = (ids: string[]) => usePresence(ids, ids.length > 0);

const since = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

/** BUSY (red, pulsing) / AVAILABLE (green). */
export const AvailabilityPill: React.FC<{ status: CeoPresence['status']; label?: string; compact?: boolean }> = ({ status, label, compact }) => {
  const busy = status === 'BUSY';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-bold ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} ${
        busy ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
      data-testid="availability"
      data-status={status}
    >
      <span className="relative flex w-2 h-2" aria-hidden="true">
        {busy && <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />}
        <span className={`relative inline-flex w-2 h-2 rounded-full ${busy ? 'bg-rose-500' : 'bg-emerald-500'}`} />
      </span>
      {label ? `${label}: ` : ''}{busy ? 'BUSY' : 'AVAILABLE'}
    </span>
  );
};

/** Next to the bell on every dashboard: a reminder while the signed-in person is marked BUSY. */
export const MyAvailabilityBadge: React.FC = () => {
  const { list } = useMyPresence();
  const me = list?.[0];
  if (!me || me.status !== 'BUSY') return null;
  return (
    <span className="hidden sm:inline-flex" aria-live="polite" title={`You are in a meeting since ${since(me.since)}: colleagues see you as BUSY. Exit it on the Meetings page.`}>
      <AvailabilityPill status="BUSY" label="You" compact />
    </span>
  );
};

/**
 * The Meetings page panel for an employee (not shown to the Super Admin): Enter Meeting (optionally the meeting being entered, from today's)
 * or Exit Meeting, the live status and since when.
 */
export const MyAvailabilityPanel: React.FC<{
  today: Meeting[];
  /** the Super Admin: Exit confirms the next request waiting in their queue */
  isCeo?: boolean;
  onDone: (text: string) => void;
  onError: (text: string) => void;
  onOpen: (id: string) => void;
}> = ({ today, isCeo = false, onDone, onError, onOpen }) => {
  const { list, reload } = useMyPresence();
  const [busy, setBusy] = useState(false);
  const [meetingId, setMeetingId] = useState('');
  const me = list?.[0];
  if (!me) return null;
  const inMeeting = me.status === 'BUSY';
  const choices = today.filter(m => m.status === 'SCHEDULED');

  const act = async (enter: boolean) => {
    setBusy(true);
    try {
      if (enter) {
        await meetingsApi.presenceEnter(meetingId || null);
        onDone(isCeo ? 'You are in a meeting: everyone sees you as BUSY, and requests for your time join your queue.' : 'You are in a meeting: colleagues now see you as BUSY.');
      } else {
        const r = await meetingsApi.presenceExit();
        const next = r.scheduled?.[0] as (CeoPresenceExit['scheduled'][number] & { stillWaiting?: number; startsNow?: boolean }) | undefined;
        // it starts now, or right after a meeting you already have confirmed (never on top of it: 20270128000300)
        const when = next && next.startsNow === false ? `at ${since(next.startsAt)}, after your next confirmed meeting` : 'and starts now';
        onDone(next
          ? `You are AVAILABLE again. The next queued meeting is confirmed ${when}: "${next.title}". The employee is e-mailed the meeting room link.${next.stillWaiting ? ` ${next.stillWaiting} more waiting.` : ''}`
          : 'You are AVAILABLE again: colleagues see it at once.');
      }
      if (!enter) setMeetingId('');
      reload();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`rounded-xl border p-4 ${inMeeting ? 'border-rose-200 bg-rose-50/40' : 'border-emerald-200 bg-emerald-50/30'}`} aria-labelledby="presence-heading" data-testid="presence-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="presence-heading" className="text-sm font-bold text-slate-900 flex flex-wrap items-center gap-2">
            Your availability <AvailabilityPill status={me.status} />
          </h2>
          <p className="text-xs text-slate-600 mt-1" aria-live="polite">
            {inMeeting
              ? isCeo
                ? `In a meeting since ${since(me.since)}. Requests for your time join your queue; Exit Meeting confirms the next one, starting then.`
                : `In a meeting since ${since(me.since)}. Colleagues see you as BUSY and cannot book you into a meeting starting within 30 minutes.`
              : 'Colleagues see you as AVAILABLE. Press Enter Meeting when you go into a meeting.'}
          </p>
          {inMeeting && me.meeting && (
            <p className="text-xs text-slate-800 mt-2">
              Current meeting:{' '}
              <button type="button" className="font-semibold text-indigo-700 hover:underline" onClick={() => onOpen(me.meeting!.id)}>{me.meeting.title}</button>
              {' '}· {since(me.meeting.startsAt)} – {since(me.meeting.endsAt)}
              {me.meeting.meetLink && (
                <a className="ml-2 inline-flex items-center gap-1 text-indigo-700 hover:underline" href={me.meeting.meetLink} target="_blank" rel="noopener noreferrer"><Video className="w-3.5 h-3.5" /> Join</a>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!inMeeting && choices.length > 0 && (
            <label className="text-xs text-slate-600">
              <span className="sr-only">The meeting you are entering</span>
              <select className="rounded-lg border border-slate-300 px-2 py-2 text-xs max-w-[14rem]" value={meetingId} onChange={e => setMeetingId(e.target.value)} data-testid="presence-meeting">
                <option value="">Not one of today&apos;s meetings</option>
                {choices.map(m => <option key={m.id} value={m.id}>{since(m.startsAt)} · {m.title}</option>)}
              </select>
            </label>
          )}
          {inMeeting ? (
            <button type="button" disabled={busy} onClick={() => act(false)} data-testid="presence-exit"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <DoorOpen className="w-4 h-4" />} Exit Meeting
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => act(true)} data-testid="presence-enter"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} Enter Meeting
            </button>
          )}
        </div>
      </div>
      {isCeo && !!me.pending?.length && (
        <div className="mt-3 border-t border-slate-200 pt-3" data-testid="ceo-queue">
          <h3 className="text-xs font-bold text-slate-800">Waiting in your queue ({me.pending.length}) — each Exit Meeting confirms the next one, oldest first</h3>
          <ol className="mt-1.5 space-y-1 list-decimal list-inside">
            {me.pending.map(p => (
              <li key={p.id} className="text-xs text-slate-700">
                <button type="button" className="font-semibold text-slate-900 hover:underline" onClick={() => onOpen(p.id)}>{p.title}</button>
                {' '}· asked by {p.requestedBy ?? 'a colleague'} · {Math.round((new Date(p.endsAt).getTime() - new Date(p.startsAt).getTime()) / 60000)} min
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
};
