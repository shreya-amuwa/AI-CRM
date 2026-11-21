import React, { useCallback, useEffect, useState } from 'react';
import { DoorOpen, Loader2, LogIn, Video } from 'lucide-react';
import type { CeoPresence, Meeting } from '../../../shared/contracts';
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
function usePresence(ids: string[] | null, enabled: boolean): { list: CeoPresence[] | null; reload: () => void } {
  const [list, setList] = useState<CeoPresence[] | null>(null);
  const key = ids ? ids.join(',') : '';
  const reload = useCallback(() => {
    if (!enabled || (ids && !ids.length)) { setList(ids ? [] : null); return; }
    meetingsApi.presence(ids ?? undefined).then(setList).catch(() => setList(cur => cur ?? []));
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

/** The signed-in employee's own status ([] for the Super Admin, whose availability is not tracked). */
export const useMyPresence = (enabled = true) => usePresence(null, enabled);
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

/** Next to the bell on every dashboard: a reminder while the signed-in employee is marked BUSY (nothing for the Super Admin). */
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
  onDone: (text: string) => void;
  onError: (text: string) => void;
  onOpen: (id: string) => void;
}> = ({ today, onDone, onError, onOpen }) => {
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
      if (enter) await meetingsApi.presenceEnter(meetingId || null);
      else await meetingsApi.presenceExit();
      onDone(enter ? 'You are in a meeting: colleagues now see you as BUSY.' : 'You are AVAILABLE again: colleagues see it at once.');
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
              ? `In a meeting since ${since(me.since)}. Colleagues see you as BUSY and cannot book you into a meeting starting within 30 minutes.`
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
    </section>
  );
};
