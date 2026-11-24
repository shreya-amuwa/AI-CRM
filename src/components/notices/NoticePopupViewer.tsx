import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, Loader2, Megaphone, Paperclip, X } from 'lucide-react';
import type { CompanyNotice, NoticePriority } from '../../../shared/contracts';
import { NOTICE_CATEGORY_LABELS } from '../../../shared/validation';
import { employeeCasesApi } from '../../lib/api/employeeCases';
import { canPostpone } from './noticeQueue';

/**
 * One company notice at a time, in a regular modal: "Company notice" and the place in the queue ("Notice 2 of 5") on top with a close button, then the title, a
 * quiet priority marker (a dot and a word), category, who published it and when, the text, the files (View / Download) and the Acknowledge button. Several notices
 * are one queue, never overlapping windows. An Urgent notice has no close button and no Escape: it stays until it is acknowledged; the others can be put off with
 * the close button, "Remind me later" or Escape (they return the next time the CRM opens). No animation, no gradient, nothing decorative.
 */
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const PRIORITY: Record<NoticePriority, { label: string; dot: string; text: string }> = {
  URGENT: { label: 'Urgent', dot: 'bg-rose-500', text: 'text-rose-700' },
  IMPORTANT: { label: 'Important', dot: 'bg-amber-500', text: 'text-amber-700' },
  NORMAL: { label: 'Normal', dot: 'bg-slate-400', text: 'text-slate-600' }
};
const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40';

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
  // the focus goes to Acknowledge when a notice appears or changes
  useEffect(() => { ack.current?.focus(); setFileError(''); }, [n?.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && n && canPostpone(n)) onLater(n); };
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
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-3 sm:p-6" data-testid="notice-popup-overlay">
      <div role="dialog" aria-modal="true" aria-labelledby="notice-popup-title" data-priority={n.priority} data-testid="notice-popup"
        className="flex w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[min(34rem,85vh)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5" data-testid="notice-popup-band">
          <Megaphone className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span className="text-sm font-medium text-slate-700">Company notice</span>
          <span className="ml-auto text-xs text-slate-500" data-testid="notice-popup-count" aria-live="polite">Notice {index + 1} of {queue.length}</span>
          {later ? <button type="button" onClick={() => onLater(n)} disabled={busy} aria-label="Close and remind me later" data-testid="notice-popup-close" className={iconBtn}><X className="h-4 w-4" aria-hidden /></button> : null}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4" tabIndex={0} aria-label="Notice text">
          <h2 id="notice-popup-title" className="text-lg font-semibold leading-snug text-slate-900 break-words" data-testid="notice-popup-title">{n.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className={`inline-flex items-center gap-1.5 font-medium ${p.text}`} data-testid="notice-popup-priority"><span className={`h-2 w-2 rounded-full ${p.dot}`} aria-hidden />{p.label}</span>
            <span data-testid="notice-popup-category">{NOTICE_CATEGORY_LABELS[n.category]}</span>
            {n.version > 1 ? <span className="font-medium text-slate-600">Updated</span> : null}
          </div>
          <p className="mt-1 text-xs text-slate-500" data-testid="notice-popup-published">Published by <span className="font-medium text-slate-700">{n.publisherName ?? 'the company'}</span> · {when(n.publishAt)}</p>
          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700" data-testid="notice-popup-body">{n.body}</p>
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
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          {queue.length > 1 ? (
            <div className="flex items-center" role="group" aria-label="Move between notices">
              <button type="button" onClick={() => onIndex(index - 1)} disabled={index === 0 || busy} aria-label="Previous notice" data-testid="notice-popup-prev" className={iconBtn}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={() => onIndex(index + 1)} disabled={index >= queue.length - 1 || busy} aria-label="Next notice" data-testid="notice-popup-next" className={iconBtn}><ChevronRight className="h-4 w-4" aria-hidden /></button>
            </div>
          ) : null}
          <span className="flex-1 min-w-[6rem] text-xs text-slate-500" data-testid="notice-popup-unread">{queue.length} unread notice{queue.length === 1 ? '' : 's'}{later ? '' : ' · this one must be acknowledged'}</span>
          {later ? (
            <button type="button" onClick={() => onLater(n)} disabled={busy} data-testid="notice-popup-later"
              className="h-9 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Remind me later</button>
          ) : null}
          <button type="button" ref={ack} onClick={() => onAcknowledge(n)} disabled={busy} data-testid="notice-popup-ack"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};
