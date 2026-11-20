/**
 * AI Studio project deadlines: the arithmetic behind the ticking clock. No React and no browser objects, so it is tested in Node.
 * Times are instants (ISO strings with an offset); people read and type them in Indian time (the company works in it).
 */

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type Urgency = 'overdue' | 'critical' | 'soon' | 'ok';

export interface Countdown {
  /** The deadline has passed: the numbers then count how long ago. */
  overdue: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** Total milliseconds to the deadline (negative once it has passed). */
  remainingMs: number;
  urgency: Urgency;
}

/** Less than a day left is critical, less than three days is soon; everything else is on track. */
export function urgencyOf(remainingMs: number): Urgency {
  if (remainingMs <= 0) return 'overdue';
  if (remainingMs < DAY) return 'critical';
  if (remainingMs < 3 * DAY) return 'soon';
  return 'ok';
}

/** Days, hours, minutes and seconds between `nowMs` and the deadline (a malformed deadline gives null). */
export function countdown(deadlineAt: string | null | undefined, nowMs: number): Countdown | null {
  if (!deadlineAt) return null;
  const at = Date.parse(deadlineAt);
  if (Number.isNaN(at)) return null;
  const remainingMs = at - nowMs;
  const abs = Math.abs(remainingMs);
  return {
    overdue: remainingMs <= 0,
    days: Math.floor(abs / DAY),
    hours: Math.floor((abs % DAY) / HOUR),
    minutes: Math.floor((abs % HOUR) / MINUTE),
    seconds: Math.floor((abs % MINUTE) / SECOND),
    remainingMs,
    urgency: urgencyOf(remainingMs)
  };
}

const two = (n: number) => String(n).padStart(2, '0');

/** "3d 04h 12m 09s", or "04h 12m 09s" inside the last day: the short form used in a table row or a chip. */
export function countdownText(c: Countdown): string {
  const rest = `${two(c.hours)}h ${two(c.minutes)}m ${two(c.seconds)}s`;
  const t = c.days > 0 ? `${c.days}d ${rest}` : rest;
  return c.overdue ? `${t} overdue` : `${t} left`;
}

/** The offset between this computer's clock and the server's, from the server's own time (ms to ADD to Date.now()). */
export function serverOffsetMs(serverNowIso: string, localNowMs: number): number {
  const server = Date.parse(serverNowIso);
  return Number.isNaN(server) ? 0 : server - localNowMs;
}

/** What a <input type="datetime-local"> holds ("2026-11-25T18:00", Indian time) as an instant with its offset, or null when empty / not a time. */
export function istInputToIso(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:00+05:30`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** An instant as the value of a <input type="datetime-local"> in Indian time (empty when there is none). */
export function isoToIstInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** "25 Nov 2026, 06:00 pm IST" */
export function deadlineLabel(iso: string | null | undefined): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '-';
  const day = new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const time = new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  return `${day}, ${time} IST`;
}
