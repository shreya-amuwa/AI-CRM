import React, { useCallback, useEffect, useState } from 'react';
import { Crown, DoorOpen, Loader2, LogIn, Video } from 'lucide-react';
import type { CeoPresence, CeoPresenceExit, Meeting } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { meetingsApi } from '../../lib/api/meetings';
import { listenToTables } from '../../lib/realtimeShared';
import { notifyMeetingsChanged } from './meetingEvents';

/**
 * Live availability of the CEO (Super Admin), migration 20270114000200.
 *  - The state lives in the database (public.meeting_presence); every open dashboard listens to that table through Supabase Realtime and
 *    reloads at once, so BUSY / AVAILABLE changes everywhere without a refresh. Coming back to the tab reloads too (a missed event).
 *  - Only the Super Admin presses Enter / Exit Meeting for themself; the database refuses anyone else.
 */
export function useCeoPresence(enabled = true): { list: CeoPresence[] | null; reload: () => void } {
  const [list, setList] = useState<CeoPresence[] | null>(null);
  const reload = useCallback(() => {
    if (!enabled) return;
    meetingsApi.presence().then(setList).catch(() => setList(cur => cur ?? []));
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    reload();
    let stop: () => void = () => undefined;
    try {
      stop = listenToTables(['meeting_presence'], () => {
        reload();
        notifyMeetingsChanged();   // an Exit may just have scheduled waiting requests: an open Meetings page shows them
      });
    } catch {
      // a client without Realtime: the status still loads, and reloads when the tab is shown again
    }
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, reload]);
  return { list, reload };
}

const since = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** BUSY (red, pulsing) / AVAILABLE (green). */
export const AvailabilityPill: React.FC<{ status: CeoPresence['status']; label?: string; compact?: boolean }> = ({ status, label, compact }) => {
  const busy = status === 'BUSY';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-bold ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} ${
        busy ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
      data-testid="ceo-availability"
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

/** In every dashboard header (next to the bell): the CEO's live status. Screen readers hear changes. */
export const CeoAvailabilityBadge: React.FC = () => {
  const { list } = useCeoPresence();
  if (!list || !list.length) return null;
  return (
    <span className="hidden sm:inline-flex items-center gap-1.5" aria-live="polite" title="The CEO's live meeting availability">
      {list.slice(0, 2).map(p => (
        <AvailabilityPill key={p.hostId} status={p.status} label={list.length > 1 ? p.hostName.split(' ')[0] : 'CEO'} compact />
      ))}
    </span>
  );
};

/**
 * The Meetings page panel.
 *  - The Super Admin: Enter Meeting (optionally the meeting being entered, from today's) or Exit Meeting, the live status, the current
 *    meeting, and the requests waiting for them to be free.
 *  - Everybody else: each CEO's live status, and how many of their own requests are waiting.
 */
export const CeoPresencePanel: React.FC<{
  isCeo: boolean;
  today: Meeting[];
  onDone: (text: string) => void;
  onError: (text: string) => void;
  onOpen: (id: string) => void;
  /** Bumped by the Meetings page when meetings change (a request sent, one cancelled): the waiting counts follow. */
  reloadKey?: number;
}> = ({ isCeo, today, onDone, onError, onOpen, reloadKey = 0 }) => {
  const { list, reload } = useCeoPresence();
  useEffect(() => { if (reloadKey) reload(); }, [reloadKey, reload]);
  const [busy, setBusy] = useState(false);
  const [meetingId, setMeetingId] = useState('');
  if (!list) return null;
  // the CEO's own row: the only one that carries its waiting queue (the server sends it to that CEO alone)
  const mine = isCeo ? list.find(p => p.pending !== null) : undefined;

  const enter = async () => {
    setBusy(true);
    try {
      await meetingsApi.presenceEnter(meetingId || null);
      onDone('You are in a meeting: everyone now sees you as BUSY. Requests made now wait for you.');
      reload();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exit = async () => {
    setBusy(true);
    try {
      const r: CeoPresenceExit = await meetingsApi.presenceExit();
      const n = r.scheduled?.length ?? 0;
      onDone(`You are AVAILABLE again.${n ? ` ${n} waiting request${n === 1 ? ' was' : 's were'} scheduled; each person is told the confirmed time.` : ''}`);
      setMeetingId('');
      reload();
      notifyMeetingsChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (isCeo && mine) {
    const inMeeting = mine.status === 'BUSY';
    const choices = today.filter(m => m.status === 'SCHEDULED');
    return (
      <section className={`rounded-xl border p-4 ${inMeeting ? 'border-rose-200 bg-rose-50/40' : 'border-emerald-200 bg-emerald-50/30'}`} aria-labelledby="presence-heading" data-testid="ceo-presence-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="presence-heading" className="text-sm font-bold text-slate-900 flex items-center gap-2">
              Your meeting availability <AvailabilityPill status={mine.status} />
            </h2>
            <p className="text-xs text-slate-600 mt-1" aria-live="polite">
              {inMeeting
                ? `In a meeting since ${since(mine.since)}. Everyone who can ask for your time sees you as BUSY; their requests wait and are scheduled when you exit.`
                : 'Everyone sees you as AVAILABLE. Press Enter Meeting when you go into a meeting.'}
            </p>
            {inMeeting && mine.meeting && (
              <p className="text-xs text-slate-800 mt-2">
                Current meeting:{' '}
                <button type="button" className="font-semibold text-indigo-700 hover:underline" onClick={() => onOpen(mine.meeting!.id)}>{mine.meeting.title}</button>
                {' '}· {since(mine.meeting.startsAt)} – {since(mine.meeting.endsAt)}
                {mine.meeting.meetLink && (
                  <a className="ml-2 inline-flex items-center gap-1 text-indigo-700 hover:underline" href={mine.meeting.meetLink} target="_blank" rel="noopener noreferrer"><Video className="w-3.5 h-3.5" /> Join</a>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!inMeeting && choices.length > 0 && (
              <label className="text-xs text-slate-600">
                <span className="sr-only">The meeting you are entering</span>
                <select className="rounded-lg border border-slate-300 px-2 py-2 text-xs" value={meetingId} onChange={e => setMeetingId(e.target.value)} data-testid="presence-meeting">
                  <option value="">Not one of today&apos;s meetings</option>
                  {choices.map(m => <option key={m.id} value={m.id}>{since(m.startsAt)} · {m.title}</option>)}
                </select>
              </label>
            )}
            {inMeeting ? (
              <button type="button" disabled={busy} onClick={exit} data-testid="presence-exit"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <DoorOpen className="w-4 h-4" />} Exit Meeting
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={enter} data-testid="presence-enter"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} Enter Meeting
              </button>
            )}
          </div>
        </div>
        {!!mine.pending?.length && (
          <div className="mt-3 border-t border-slate-200 pt-3">
            <h3 className="text-xs font-bold text-slate-800">Waiting for you to be free ({mine.pending.length}) — scheduled automatically, oldest first, when you exit</h3>
            <ul className="mt-1.5 space-y-1">
              {mine.pending.map(p => (
                <li key={p.id} className="text-xs text-slate-700">
                  <button type="button" className="font-semibold text-slate-900 hover:underline" onClick={() => onOpen(p.id)}>{p.title}</button>
                  {' '}· asked by {p.requestedBy ?? 'a colleague'} for {when(p.startsAt)} ({Math.round((new Date(p.endsAt).getTime() - new Date(p.startsAt).getTime()) / 60000)} min)
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-3" aria-label="CEO availability" data-testid="ceo-presence-panel">
      {list.map(p => (
        <div key={p.hostId} className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
          <Crown className="w-4 h-4 text-amber-500" aria-hidden="true" />
          <span className="font-semibold text-slate-800">{p.hostName}</span>
          <AvailabilityPill status={p.status} />
          <span className="text-xs text-slate-500">
            {p.status === 'BUSY' ? `In a meeting since ${since(p.since)}. Requests you send now wait and are scheduled automatically.` : 'Free to be asked for a meeting.'}
          </span>
          {p.pendingCount > 0 && (
            <span className="text-xs font-semibold text-amber-700" data-testid="my-pending-count">{p.pendingCount} of your requests waiting</span>
          )}
        </div>
      ))}
    </section>
  );
};
