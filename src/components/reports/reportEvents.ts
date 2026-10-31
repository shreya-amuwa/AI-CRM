import { useCallback, useEffect, useState } from 'react';
import { workReportsApi } from '../../lib/api/workReports';

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

/**
 * The number on the Reports menu entry: reports waiting for this person's decision plus their own reports sent back. It comes from the
 * database and is read again when the page opens, when something changes and when the browser tab regains focus (no timers).
 */
export function useReportsBadge(): number {
  const [badge, setBadge] = useState(0);
  const load = useCallback(() => {
    workReportsApi.context().then(c => setBadge(c.badge), () => setBadge(0));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(REPORTS_CHANGED_EVENT, load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener(REPORTS_CHANGED_EVENT, load);
      window.removeEventListener('focus', load);
    };
  }, [load]);
  return badge;
}
