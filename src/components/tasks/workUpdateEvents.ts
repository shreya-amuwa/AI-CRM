import { useEffect } from 'react';

/**
 * A work update notification (a request, a reminder, a submitted update) opens the right dashboard page on its task:
 *   a Department Head: Work Updates, a Team Lead: Assigned Tasks (its Work Updates section), a Team Member: My Tasks (Update Requests).
 */
export const OPEN_WORK_UPDATE_EVENT = 'crm:open-work-update';
export interface OpenWorkUpdateDetail { taskId?: string }

let pending: OpenWorkUpdateDetail | null = null;

export const openWorkUpdate = (detail: OpenWorkUpdateDetail) => {
  pending = detail;
  window.dispatchEvent(new CustomEvent<OpenWorkUpdateDetail>(OPEN_WORK_UPDATE_EVENT, { detail }));
};
/** The page takes the task asked for when it opens (once). */
export const takePendingWorkUpdate = (): OpenWorkUpdateDetail | null => {
  const p = pending;
  pending = null;
  return p;
};

/** For a dashboard: switch to the page that shows work updates when something asks for it. */
export function useOpenWorkUpdateRequest(show: () => void) {
  useEffect(() => {
    const on = () => show();
    window.addEventListener(OPEN_WORK_UPDATE_EVENT, on);
    return () => window.removeEventListener(OPEN_WORK_UPDATE_EVENT, on);
  }, [show]);
}

/** For the page that lists them: also learn which task to show. */
export function useOpenWorkUpdateTask(show: (taskId?: string) => void) {
  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<OpenWorkUpdateDetail>).detail?.taskId);
    window.addEventListener(OPEN_WORK_UPDATE_EVENT, on);
    return () => window.removeEventListener(OPEN_WORK_UPDATE_EVENT, on);
  }, [show]);
}
