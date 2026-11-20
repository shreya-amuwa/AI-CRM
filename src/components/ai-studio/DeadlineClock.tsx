import React, { useEffect, useSyncExternalStore } from 'react';
import { AlarmClock } from 'lucide-react';
import type { AiStudioDeadlineItem, AiStudioProjectStatus } from '../../../shared/contracts';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { countdown, countdownText, deadlineLabel, serverOffsetMs, type Countdown, type Urgency } from '../../lib/aiStudioDeadline';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { Card, CardHead } from '../tasks/head/headParts';
import { useAiStudioChanged } from './aiStudioEvents';
import { ProjectStatusBadge, useLoad } from './ui';

/**
 * The deadline clock of AI Studio. One timer for the whole page (every clock reads the same second), counting to the SERVER's time: the list comes
 * with the server's own time and the difference to this computer's clock is kept, so a computer with a wrong clock still counts to the right moment.
 */
let tickNow = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
let offsetMs = 0;
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  if (!timer) {
    tickNow = Date.now();
    timer = setInterval(() => { tickNow = Date.now(); listeners.forEach(l => l()); }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
};
const snapshot = () => tickNow;

let synced = false;
/** Remember the server's time (from the deadline list) so every clock counts to it. */
export const setServerNow = (serverNowIso: string) => { offsetMs = serverOffsetMs(serverNowIso, Date.now()); synced = true; };

/**
 * A page that shows a deadline chip without the deadline panel (Projects) still counts to the server's time: the first chip asks for it once. The panel
 * already has it, so nothing is asked twice; if the request fails the chip simply uses this computer's clock until the next page.
 */
function useServerClockSync() {
  useEffect(() => {
    if (synced) return;
    synced = true;
    aiStudioApi.deadlines().then(d => setServerNow(d.serverNow), () => { synced = false; });
  }, []);
}

/** The server's current time in ms, changing every second while a clock is on screen. */
export const useServerNow = (): number => useSyncExternalStore(subscribe, snapshot, snapshot) + offsetMs;

const TONE: Record<Urgency, { box: string; digit: string; chip: string; label: string }> = {
  ok: { box: 'bg-emerald-50 border-emerald-200', digit: 'text-emerald-800', chip: 'bg-emerald-50 text-emerald-700', label: 'On track' },
  soon: { box: 'bg-amber-50 border-amber-200', digit: 'text-amber-800', chip: 'bg-amber-50 text-amber-800', label: 'Due soon' },
  critical: { box: 'bg-rose-50 border-rose-200', digit: 'text-rose-700', chip: 'bg-rose-50 text-rose-700', label: 'Due within a day' },
  overdue: { box: 'bg-rose-600 border-rose-700', digit: 'text-white', chip: 'bg-rose-600 text-white', label: 'Overdue' }
};

const Digit: React.FC<{ value: number; unit: string; urgency: Urgency }> = ({ value, unit, urgency }) => (
  <div className={`flex-1 min-w-[4rem] rounded-xl border px-2 py-3 text-center ${TONE[urgency].box}`}>
    <div className={`text-3xl sm:text-4xl font-extrabold tabular-nums leading-none ${TONE[urgency].digit}`}>{String(value).padStart(2, '0')}</div>
    <div className={`mt-1 text-[11px] font-bold uppercase tracking-wide ${urgency === 'overdue' ? 'text-rose-100' : 'text-slate-500'}`}>{unit}</div>
  </div>
);

/** The big clock: days, hours, minutes and seconds to (or since) a deadline. */
export const DeadlineClock: React.FC<{ deadlineAt: string; name: string }> = ({ deadlineAt, name }) => {
  const now = useServerNow();
  const c = countdown(deadlineAt, now);
  if (!c) return null;
  return (
    // not announced every second to a screen reader: the label changes by the minute through the text below
    <div role="timer" aria-live="off" aria-label={`${name}: ${countdownText({ ...c, seconds: 0 })}`}>
      <div className="flex gap-2">
        <Digit value={c.days} unit="Days" urgency={c.urgency} />
        <Digit value={c.hours} unit="Hours" urgency={c.urgency} />
        <Digit value={c.minutes} unit="Minutes" urgency={c.urgency} />
        <Digit value={c.seconds} unit="Seconds" urgency={c.urgency} />
      </div>
      <p className={`mt-2 text-xs font-bold ${c.overdue ? 'text-rose-700' : 'text-slate-600'}`}>
        {c.overdue ? 'Overdue: the deadline passed ' : 'Due '}
        <time dateTime={deadlineAt}>{deadlineLabel(deadlineAt)}</time>
        {c.overdue ? ' (the clock counts how long ago)' : ''}
      </p>
    </div>
  );
};

/** A small ticking chip for a project card: "2d 04h 12m 09s left" / "… overdue" / "Due 25 Nov 2026" once the project is finished. */
export const DeadlineChip: React.FC<{ deadlineAt: string | null | undefined; status: AiStudioProjectStatus }> = ({ deadlineAt, status }) => {
  useServerClockSync();
  const now = useServerNow();
  if (!deadlineAt) return null;
  const running = status === 'ACTIVE' || status === 'ON_HOLD';
  const c: Countdown | null = running ? countdown(deadlineAt, now) : null;
  const cls = c ? TONE[c.urgency].chip : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap tabular-nums ${cls}`} title={`Deadline: ${deadlineLabel(deadlineAt)}`}>
      <AlarmClock className="w-3.5 h-3.5" aria-hidden="true" />
      {c ? countdownText(c) : `Due ${deadlineLabel(deadlineAt)}`}
    </span>
  );
};

const Row: React.FC<{ item: AiStudioDeadlineItem }> = ({ item }) => {
  const now = useServerNow();
  const c = countdown(item.deadlineAt, now);
  return (
    <li className="px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-slate-900 truncate flex items-center gap-2">{item.name}<ProjectStatusBadge status={item.status} /></div>
        <div className="text-xs text-slate-500">
          Due {deadlineLabel(item.deadlineAt)} · {item.openTasks} open task{item.openTasks === 1 ? '' : 's'}{item.myOpenTasks > 0 ? ` (${item.myOpenTasks} yours)` : ''}
        </div>
      </div>
      {c && <span className={`text-xs font-bold tabular-nums px-2.5 py-1 rounded-full ${TONE[c.urgency].chip}`}>{countdownText(c)}</span>}
    </li>
  );
};

/**
 * "Project deadlines" on the AI Studio dashboard: the nearest running deadline as a big ticking clock and every other one below it.
 * The people on a project see theirs; the Super Admin / Department Head see all. A Team Lead or Team Member cannot change a deadline.
 */
export const ProjectDeadlines: React.FC<{ canSet?: boolean; onManage?: () => void }> = ({ canSet = false, onManage }) => {
  const { data, error, loading, reload } = useLoad(async () => {
    const d = await aiStudioApi.deadlines();
    setServerNow(d.serverNow);
    return d;
  }, []);
  useAiStudioChanged(reload);
  const items = data?.items ?? [];
  const [next, ...others] = items;
  return (
    <Card label="Project deadlines">
      <CardHead
        title="Project deadlines"
        hint="The time left on each running project. Plan your day so the work is done before the clock reaches zero."
        right={canSet && onManage ? <button type="button" onClick={onManage} className="text-xs font-bold text-blue-600 hover:underline">Set deadlines</button> : undefined}
      />
      {error && <div className="px-5 pb-5"><ErrorBanner message={error} onRetry={reload} /></div>}
      {loading && !data && <div className="px-5 pb-5"><Spinner label="Loading the deadlines…" /></div>}
      {data && items.length === 0 && (
        <p className="px-5 pb-6 text-sm text-slate-500">
          {canSet ? 'No running project has a deadline yet. Open Project Management and set one when you add or edit a project.' : 'None of your projects has a deadline right now.'}
        </p>
      )}
      {next && (
        <div className="px-5 pb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-extrabold text-slate-900 truncate">{next.name}</span>
            <ProjectStatusBadge status={next.status} />
            <span className="text-xs text-slate-500">{next.openTasks} open task{next.openTasks === 1 ? '' : 's'}{next.myOpenTasks > 0 ? ` · ${next.myOpenTasks} yours` : ''}</span>
          </div>
          <DeadlineClock deadlineAt={next.deadlineAt} name={next.name} />
        </div>
      )}
      {others.length > 0 && <ul className="divide-y divide-slate-100 border-t border-slate-100">{others.map(i => <Row key={i.projectId} item={i} />)}</ul>}
    </Card>
  );
};
