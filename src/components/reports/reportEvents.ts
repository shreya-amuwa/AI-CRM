import { useCallback, useEffect, useRef, useState } from 'react';
import { listenToTables } from '../../lib/realtimeShared';
import { workReportsApi } from '../../lib/api/workReports';
import { getSupabase } from '../../services/supabaseClient';

/** Other screens (a notification) can open the Reports page, on one report. */
export const OPEN_REPORTS_EVENT = 'crm:open-reports';
export interface OpenReportsDetail { id?: string }
let pending: OpenReportsDetail | null = null;

export const openReports = (detail: OpenReportsDetail) => {
  pending = detail;
  window.dispatchEvent(new CustomEvent<OpenReportsDetail>(OPEN_REPORTS_EVENT, { detail }));
};
/** The page takes what was asked for when it opens (once). */
export const takePendingReport = (): string | null => {
  const p = pending;
  pending = null;
  return p?.id ?? null;
};

/** For a dashboard: switch to its Reports page when something asks for it. */
export function useOpenReportsRequest(show: () => void) {
  useEffect(() => {
    const on = () => show();
    window.addEventListener(OPEN_REPORTS_EVENT, on);
    return () => window.removeEventListener(OPEN_REPORTS_EVENT, on);
  }, [show]);
}

/** Tells the sidebar badge to count again (after a report was submitted, decided or resubmitted). */
export const REPORTS_CHANGED_EVENT = 'crm:reports-changed';
export const notifyReportsChanged = () => window.dispatchEvent(new Event(REPORTS_CHANGED_EVENT));

/** How soon changes that arrive together (one decision touches several people) are read once, and the fallback check without Realtime. */
const LIVE_DEBOUNCE_MS = 350;
const FALLBACK_POLL_MS = 20_000;

/**
 * Calls `onChange` when a report that matters to this person changed (submitted, approved at either stage, rejected, sent back,
 * resubmitted, a package sent), without a page refresh. The database writes one small signal row for each affected person
 * (work_report_signals); Realtime delivers only the person's own rows, so what arrives is already limited by team, department and role.
 *
 *  - One shared channel per browser tab (listenToTables), closed when the last screen using it unmounts: no duplicate subscriptions.
 *  - Changes arriving together are read once (debounce); the caller refetches only the section on screen, so nothing is rebuilt.
 *  - Without Realtime (no Supabase client, or the table is not published yet) the screen is read again when the tab regains focus and,
 *    while it is visible, every 20 seconds.
 */
export function useReportsLive(onChange: () => void, enabled = true) {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => latest.current(), LIVE_DEBOUNCE_MS);
    };
    const stop = listenToTables(['work_report_signals'], fire);
    const onVisible = () => { if (document.visibilityState === 'visible') fire(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fire);
    const poll = getSupabase() ? undefined : setInterval(() => { if (document.visibilityState === 'visible') fire(); }, FALLBACK_POLL_MS);
    return () => {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fire);
    };
  }, [enabled]);
}

/**
 * The number on the Reports menu entry: reports waiting for this person's decision plus their own reports sent back. It comes from the
 * database and is read again when the page opens, when something changes and live (useReportsLive).
 */
export function useReportsBadge(): number {
  const [badge, setBadge] = useState(0);
  const load = useCallback(() => {
    workReportsApi.context().then(c => setBadge(c.badge), () => setBadge(0));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(REPORTS_CHANGED_EVENT, load);
    return () => window.removeEventListener(REPORTS_CHANGED_EVENT, load);
  }, [load]);
  useReportsLive(load);
  return badge;
}
