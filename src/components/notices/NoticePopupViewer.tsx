import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, Loader2, Megaphone, Paperclip, X } from 'lucide-react';
import type { CompanyNotice, NoticePriority } from '../../../shared/contracts';
import { NOTICE_CATEGORY_LABELS } from '../../../shared/validation';
import { employeeCasesApi } from '../../lib/api/employeeCases';
import { canPostpone } from './noticeQueue';
import { lockScroll } from '../../lib/scrollLock';

/**
 * One company notice at a time (Task 03 redesign). On a phone it is a compact bottom sheet: at most 55% of the screen, the text scrolling
 * inside it, "View full notice" to open it to nearly the full height, and the buttons above the home indicator (safe area). From 640 px it
 * is a centred dialog of about 512 px. The order is the order people read it in: category and priority, the title, who published it and
 * when, the text (a preview first), the files, then Acknowledge. Several notices are one queue ("Notice 2 of 5"), never overlapping
 * windows. Focus moves to Acknowledge, Tab stays inside the notice, the page behind does not scroll, and focus goes back where it was.
 * An Urgent notice has no close button and no Escape: it stays until it is acknowledged; the others can be put off with the close button,
 * "Remind me later" or Escape (they return the next time the CRM opens). No animation, no gradient, nothing decorative.
 */
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const PRIORITY: Record<NoticePriority, { label: string; dot: string; text: string }> = {
  URGENT: { label: 'Urgent', dot: 'bg-rose-500', text: 'text-rose-700' },
  IMPORTANT: { label: 'Important', dot: 'bg-amber-500', text: 'text-amber-700' },
  NORMAL: { label: 'Normal', dot: 'bg-slate-400', text: 'text-slate-600' }
};
const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const iconBtn = 'inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40';

export const NoticePopupViewer: React.FC<{
  queue: CompanyNotice[];
  index: number;
  busy: boolean;
  error: string;
  onIndex: (i: number) => void;
  onAcknowledge: (n: CompanyNotice) => void;
  onLater: (n: CompanyNotice) => void;
}> = ({ queue, index, busy, error, onIndex, onAcknowledge, onLater }) => {
  const n = queue[index];
  const ack = useRef<HTMLButtonElement>(null);
  const later = n ? canPostpone(n) : false;
  const [fileError, setFileError] = useState('');
  const [full, setFull] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // the focus goes to Acknowledge when a notice appears or changes; each notice starts as a preview
  useEffect(() => { ack.current?.focus(); setFileError(''); setFull(false); }, [n?.id]);
  // the page behind does not scroll; when the last notice is done, the focus goes back to what had it before
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const release = lockScroll();
    return () => { release(); if (opener && document.contains(opener)) opener.focus?.(); };
  }, []);
  // "View full notice" only when there is more than the preview shows
  const measure = useCallback(() => {
    const el = scroller.current;
    setOverflows(!!el && el.scrollHeight > el.clientHeight + 4);
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, n?.id, full]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && n && canPostpone(n)) { onLater(n); return; }
      // Tab and Shift+Tab stay inside the notice
      if (e.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!items.length) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (!panel.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [n, onLater]);
  if (!n) return null;
  const p = PRIORITY[n.priority];
  const openFile = async (id: string, action: 'view' | 'download') => {
    setFileError('');
    try { const { url } = await employeeCasesApi.fileUrl(id, action); window.open(url, '_blank', 'noopener,noreferrer'); } catch { setFileError('The file could not be opened. Please try again.'); }
  };
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-6" data-testid="notice-popup-overlay">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="notice-popup-title" aria-describedby="notice-popup-published" data-priority={n.priority}
        data-testid="notice-popup" data-expanded={full ? 'true' : 'false'}
        className={`flex w-full flex-col overflow-hidden border border-slate-200 bg-white shadow-lg rounded-t-xl sm:max-w-lg sm:rounded-xl
          pb-[env(safe-area-inset-bottom)] sm:pb-0 ${full ? 'max-h-[92dvh] sm:max-h-[85vh]' : 'max-h-[55dvh] sm:max-h-[min(34rem,85vh)]'}`}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5" data-testid="notice-popup-band">
          <Megaphone className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span className="text-sm font-medium text-slate-700">Company notice</span>
          <span className="ml-auto text-xs text-slate-500" data-testid="notice-popup-count" aria-live="polite">Notice {index + 1} of {queue.length}</span>
          {later ? <button type="button" onClick={() => onLater(n)} disabled={busy} aria-label="Close and remind me later" data-testid="notice-popup-close" className={iconBtn}><X className="h-4 w-4" aria-hidden /></button> : null}
        </div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 sm:py-4" tabIndex={0} aria-label="Notice text">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="font-semibold text-slate-600" data-testid="notice-popup-category">{NOTICE_CATEGORY_LABELS[n.category]}</span>
            <span className={`inline-flex items-center gap-1.5 font-medium ${p.text}`} data-testid="notice-popup-priority"><span className={`h-2 w-2 rounded-full ${p.dot}`} aria-hidden />{p.label}</span>
            {n.version > 1 ? <span className="font-medium text-slate-600">Updated</span> : null}
          </div>
          <h2 id="notice-popup-title" className="mt-1.5 text-base font-semibold leading-snug text-slate-900 break-words sm:text-lg" data-testid="notice-popup-title">{n.title}</h2>
          <p id="notice-popup-published" className="mt-1 text-xs text-slate-500" data-testid="notice-popup-published"><time dateTime={n.publishAt}>{when(n.publishAt)}</time> · Published by <span className="font-medium text-slate-700">{n.publisherName ?? 'the company'}</span></p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700" data-testid="notice-popup-body">{n.body}</p>
          {n.attachments.length ? (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-medium text-slate-500">Attachments</p>
              <ul className="space-y-1.5" aria-label="Attachments">
                {n.attachments.map(f => (
                  <li key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" data-testid="notice-popup-file">
                    <Paperclip className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-slate-800" title={f.name}>{f.name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{size(f.size)}</span>
                    <button type="button" onClick={() => void openFile(f.id, 'view')} aria-label={`View ${f.name}`} title="View" className={iconBtn}><Eye className="h-4 w-4" aria-hidden /></button>
                    <button type="button" onClick={() => void openFile(f.id, 'download')} aria-label={`Download ${f.name}`} title="Download" className={iconBtn}><Download className="h-4 w-4" aria-hidden /></button>
                  </li>
                ))}
              </ul>
              {fileError ? <p role="alert" className="mt-1.5 text-xs text-rose-700" data-testid="notice-popup-file-error">{fileError}</p> : null}
            </div>
          ) : null}
          {error ? <p role="alert" className="mt-4 text-sm text-rose-700" data-testid="notice-popup-error">{error}</p> : null}
        </div>
        {overflows || full ? (
          <div className="border-t border-slate-100 px-4 py-1.5 sm:px-5">
            <button type="button" onClick={() => setFull(f => !f)} aria-expanded={full} data-testid="notice-popup-full"
              className="h-8 text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
              {full ? 'Show less' : 'View full notice'}
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          {queue.length > 1 ? (
            <div className="flex items-center" role="group" aria-label="Move between notices">
              <button type="button" onClick={() => onIndex(index - 1)} disabled={index === 0 || busy} aria-label="Previous notice" data-testid="notice-popup-prev" className={iconBtn}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={() => onIndex(index + 1)} disabled={index >= queue.length - 1 || busy} aria-label="Next notice" data-testid="notice-popup-next" className={iconBtn}><ChevronRight className="h-4 w-4" aria-hidden /></button>
            </div>
          ) : null}
          <span className="flex-1 min-w-[6rem] text-xs text-slate-500" data-testid="notice-popup-unread">{queue.length} unread notice{queue.length === 1 ? '' : 's'}{later ? '' : ' · this one must be acknowledged'}</span>
          <div className="flex w-full gap-2 sm:w-auto">
          {later ? (
            <button type="button" onClick={() => onLater(n)} disabled={busy} data-testid="notice-popup-later"
              className="h-10 flex-1 sm:h-9 sm:flex-none rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Remind me later</button>
          ) : null}
          <button type="button" ref={ack} onClick={() => onAcknowledge(n)} disabled={busy} data-testid="notice-popup-ack"
            className="inline-flex h-10 flex-1 justify-center sm:h-9 sm:flex-none items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Acknowledge
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};
