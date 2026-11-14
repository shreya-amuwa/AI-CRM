/**
 * Free slots of a booking link, and the time-zone arithmetic behind them (no library: Intl knows every zone's offsets, including
 * daylight-saving changes). Pure functions, unit-tested in supabase/tests/meetings_slots.test.ts.
 *
 * The database checks a booked slot again (inside the working hours, no other meeting of the host at that time, the buffer), so a
 * slot offered here that has just been taken is refused there; this file only decides what to OFFER.
 */

export interface AvailabilityWindow {
  weekday: number; // 0 = Sunday ... 6 = Saturday
  start: string; // 'HH:MM' in the host's time zone
  end: string;
}

export interface BusyInterval {
  start: string | Date;
  end: string | Date;
}

export interface SlotRules {
  timezone: string;
  windows: AvailabilityWindow[];
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
}

/** Monday-Saturday 10:00-18:00: the working hours of a host who has not set their own (the database uses the same default). */
export const DEFAULT_WINDOWS: AvailabilityWindow[] = [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '10:00', end: '18:00' }));

const MINUTE = 60_000;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(at: Date, tz: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  });
  const out: Record<string, number> = {};
  for (const p of dtf.formatToParts(at)) {
    if (p.type === 'weekday') out.weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.value);
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Minutes the zone is ahead of UTC at that instant (Asia/Kolkata: 330). */
export function zoneOffsetMinutes(at: Date, tz: string): number {
  const p = parts(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE);
}

/** The instant a wall-clock time in a zone stands for (a time skipped by a daylight-saving change moves forward). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess - zoneOffsetMinutes(new Date(guess), tz) * MINUTE;
  const second = guess - zoneOffsetMinutes(new Date(t), tz) * MINUTE;
  if (second !== t) t = second;
  return new Date(t);
}

/** The calendar date and weekday of an instant in a zone. */
export function localDate(at: Date, tz: string): { year: number; month: number; day: number; weekday: number } {
  const p = parts(at, tz);
  return { year: p.year, month: p.month, day: p.day, weekday: p.weekday };
}

const hm = (s: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Bad time "${s}"`);
  return [Number(m[1]), Number(m[2])];
};

/** The gap between offered start times: the meeting length up to 30 minutes, then every half hour. */
export function slotStep(durationMinutes: number): number {
  return Math.max(10, Math.min(durationMinutes, 30));
}

/**
 * Every start time a guest may pick: inside the host's working hours (in the host's zone), at least `minNoticeMinutes` from now, at most
 * `maxDaysAhead` days ahead, ending the same local day, and clear (with the buffer on both sides) of every busy interval.
 */
export function freeSlots(rules: SlotRules, busy: BusyInterval[], now: Date = new Date()): string[] {
  const tz = isValidTimeZone(rules.timezone) ? rules.timezone : 'Asia/Kolkata';
  const windows = rules.windows.length ? rules.windows : DEFAULT_WINDOWS;
  const duration = rules.durationMinutes * MINUTE;
  const buffer = rules.bufferMinutes * MINUTE;
  const step = slotStep(rules.durationMinutes) * MINUTE;
  const earliest = now.getTime() + rules.minNoticeMinutes * MINUTE;
  const latest = now.getTime() + rules.maxDaysAhead * 24 * 60 * MINUTE;
  const blocks = busy
    .map(b => [new Date(b.start).getTime() - buffer, new Date(b.end).getTime() + buffer] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: string[] = [];
  const today = localDate(now, tz);
  for (let d = 0; d <= rules.maxDaysAhead + 1; d++) {
    // walk the host's calendar days (noon UTC of the local date avoids any daylight-saving edge)
    const anchor = new Date(Date.UTC(today.year, today.month - 1, today.day + d, 12));
    const day = { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() + 1, day: anchor.getUTCDate(), weekday: anchor.getUTCDay() };
    for (const w of windows.filter(x => x.weekday === day.weekday)) {
      const [sh, sm] = hm(w.start);
      const [eh, em] = hm(w.end);
      const winStart = zonedTimeToUtc(day.year, day.month, day.day, sh, sm, tz).getTime();
      const winEnd = zonedTimeToUtc(day.year, day.month, day.day, eh, em, tz).getTime();
      for (let s = winStart; s + duration <= winEnd; s += step) {
        if (s < earliest || s > latest) continue;
        const e = s + duration;
        if (blocks.some(([bs, be]) => bs < e && be > s)) continue;
        out.push(new Date(s).toISOString());
      }
    }
  }
  return [...new Set(out)].sort();
}
