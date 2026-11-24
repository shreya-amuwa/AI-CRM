import { useEffect } from 'react';

/**
 * Opening the Notice Board from elsewhere (20270131000200): a notice notification in the bell, or a tapped push (public/sw.js posts
 * "open-notice" to an open CRM window, or opens /?open=notice&id=...). The board then opens that exact notice.
 */
export const OPEN_NOTICE_EVENT = 'crm:open-notice';
/** a notice was published or read: badges reload */
export const NOTICES_CHANGED_EVENT = 'crm:notices-changed';
let pending: { id?: string } | null = null;

export const openNotice = (id?: string) => {
  pending = { id };
  window.dispatchEvent(new CustomEvent(OPEN_NOTICE_EVENT, { detail: { id } }));
};
export const takePendingNotice = (): { id?: string } | null => {
  const p = pending;
  pending = null;
  return p;
};
export const noticesChanged = () => window.dispatchEvent(new CustomEvent(NOTICES_CHANGED_EVENT));
/** The CRM was opened from a tapped notice notification (/?open=notice&id=...). */
export const noticeRequested = () => {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('open') !== 'notice') return false;
  pending = { id: q.get('id') ?? undefined };
  return true;
};
/** For a dashboard: show the Notice Board when something asks for it (the bell, a tapped push while the CRM is open). */
export function useOpenNoticeRequest(show: (id?: string) => void) {
  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<{ id?: string }>).detail?.id);
    const fromWorker = (e: MessageEvent) => { if (e.data?.type === 'open-notice') openNotice(e.data.id || undefined); };
    window.addEventListener(OPEN_NOTICE_EVENT, on);
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    sw?.addEventListener('message', fromWorker);
    return () => { window.removeEventListener(OPEN_NOTICE_EVENT, on); sw?.removeEventListener('message', fromWorker); };
  }, [show]);
}
