import React, { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Megaphone, Paperclip } from 'lucide-react';
import type { CompanyNotice, NoticePriority } from '../../../shared/contracts';
import { NOTICE_CATEGORY_LABELS } from '../../../shared/validation';
import { employeeCasesApi } from '../../lib/api/employeeCases';
import { canPostpone } from './noticeQueue';

/**
 * One company notice at a time, in a dialog (20270202000100): the heading, title, category, priority, who published it and when, the whole text, the files, and the
 * Acknowledge button. Several notices are one queue ("Notice 2 of 5"), never overlapping windows. An Urgent notice has a red band and cannot be closed without
 * acknowledging; the others offer "Remind me later" (they return the next time the CRM opens). No animation.
 */
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const BAND: Record<NoticePriority, { cls: string; label: string }> = {
  URGENT: { cls: 'bg-rose-600 text-white', label: 'URGENT NOTICE: please read and acknowledge' },
  IMPORTANT: { cls: 'bg-amber-500 text-slate-900', label: 'Important notice' },
  NORMAL: { cls: 'bg-slate-100 text-slate-700', label: 'Company notice' }
};
const PRIORITY_LABEL: Record<NoticePriority, string> = { NORMAL: 'Normal', IMPORTANT: 'Important', URGENT: 'Urgent' };

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
  // the focus goes to Acknowledge when a notice appears or changes
  useEffect(() => { ack.current?.focus(); }, [n?.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && n && canPostpone(n)) onLater(n); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [n, onLater]);
  if (!n) return null;
  const band = BAND[n.priority];
  const openFile = async (id: string) => {
    try { const { url } = await employeeCasesApi.fileUrl(id, 'view'); window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* the notice stays readable */ }
  };
  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4" data-testid="notice-popup-overlay">
      <div role="dialog" aria-modal="true" aria-labelledby="notice-popup-title" data-priority={n.priority} data-testid="notice-popup"
        className="flex max-h-[100dvh] sm:max-h-[90vh] w-full sm:max-w-2xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold ${band.cls}`} data-testid="notice-popup-band">
          {n.priority === 'URGENT' ? <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden /> : <Megaphone className="w-4 h-4 shrink-0" aria-hidden />}
          <span className="flex-1">{band.label}</span>
          <span className="text-xs font-semibold" data-testid="notice-popup-count" aria-live="polite">Notice {index + 1} of {queue.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <h2 id="notice-popup-title" className="text-xl font-extrabold leading-snug text-slate-900" data-testid="notice-popup-title">{n.title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full border px-2 py-0.5 font-bold ${n.priority === 'URGENT' ? 'border-rose-300 bg-rose-50 text-rose-700' : n.priority === 'IMPORTANT' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
              data-testid="notice-popup-priority">{PRIORITY_LABEL[n.priority]}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600" data-testid="notice-popup-category">{NOTICE_CATEGORY_LABELS[n.category]}</span>
            <span className="text-slate-500">Published by <b className="text-slate-700">{n.publisherName ?? 'the company'}</b> · {when(n.publishAt)}</span>
            {n.version > 1 ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">Updated</span> : null}
          </div>
          <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-[15px] leading-relaxed text-slate-800" data-testid="notice-popup-body">{n.body}</p>
          {n.attachments.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Attachments">
              {n.attachments.map(f => (
                <li key={f.id}><button type="button" onClick={() => void openFile(f.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                  <Paperclip className="w-3.5 h-3.5" aria-hidden /> {f.name} <span className="font-normal text-slate-400">{Math.max(1, Math.round(f.size / 1024))} KB</span></button></li>
              ))}
            </ul>
          ) : null}
          {error ? <p role="alert" className="text-sm text-rose-700" data-testid="notice-popup-error">{error}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-4 py-3">
          {queue.length > 1 ? (
            <div className="flex items-center gap-1" role="group" aria-label="Move between notices">
              <button type="button" onClick={() => onIndex(index - 1)} disabled={index === 0 || busy} aria-label="Previous notice" data-testid="notice-popup-prev"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" aria-hidden /></button>
              <button type="button" onClick={() => onIndex(index + 1)} disabled={index >= queue.length - 1 || busy} aria-label="Next notice" data-testid="notice-popup-next"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" aria-hidden /></button>
            </div>
          ) : null}
          <span className="flex-1 text-xs text-slate-500" data-testid="notice-popup-unread">{queue.length} unread notice{queue.length === 1 ? '' : 's'}</span>
          {later ? (
            <button type="button" onClick={() => onLater(n)} disabled={busy} data-testid="notice-popup-later"
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Remind me later</button>
          ) : null}
          <button type="button" ref={ack} onClick={() => onAcknowledge(n)} disabled={busy} data-testid="notice-popup-ack"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <CheckCircle2 className="w-4 h-4" aria-hidden />} Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};
