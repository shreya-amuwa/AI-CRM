import React, { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  confirmAction, dismissToast, getFeedbackState, promptInput, registerFeedbackHost, settleDialog, showDetails, subscribeFeedback, toast,
  type ConfirmOptions, type DialogRequest, type InputOptions, type ToastItem, type ToastKind
} from '../../lib/feedback/feedbackStore';
import { userMessage } from '../../lib/feedback/errors';

/**
 * <AppFeedbackProvider>: the one place toasts and confirmation / input dialogs are drawn (docs/APP_FEEDBACK_SYSTEM.md). Mounted once around
 * the whole app in src/main.tsx (staff CRM, customers' dashboard, booking and set-password pages alike). Call sites use the plain functions
 * (toast, confirmAction, promptInput) or the hooks below; they never draw their own copy.
 */
export { toast, confirmAction, promptInput, showDetails };
export const useToast = () => toast;
export const useConfirm = () => confirmAction;
export const usePrompt = () => promptInput;

const useFeedback = () => useSyncExternalStore(subscribeFeedback, getFeedbackState, getFeedbackState);

export const AppFeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => registerFeedbackHost(), []);
  const { toasts, dialogs } = useFeedback();
  const active = dialogs[0];
  return (
    <>
      {children}
      {active ? (active.type === 'confirm'
        ? <ConfirmDialog key={active.id} request={active} />
        : <InputDialog key={active.id} request={active} />) : null}
      <ToastViewport toasts={toasts} />
    </>
  );
};

// ---------------------------------------------------------------------------------------------------------------- dialogs
const BTN = {
  base: 'inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition-colors',
  safe: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-400',
  primary: 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-500',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-400'
};

/** Focus inside while open (Tab / Shift+Tab cycle), back to where it was after. */
function useDialogFocus(ref: React.RefObject<HTMLElement>, first: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => (first.current ?? ref.current)?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      if (before && before.isConnected && typeof before.focus === 'function') before.focus();
    };
  }, [ref, first]);
  return useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  }, [ref]);
}

const Frame: React.FC<{
  titleId: string; descId: string; destructive: boolean; busy: boolean; onCancel: () => void; children: React.ReactNode;
  boxRef: React.RefObject<HTMLDivElement>; onKeyDown: (e: React.KeyboardEvent) => void; testId: string;
}> = ({ titleId, descId, destructive, busy, onCancel, children, boxRef, onKeyDown, testId }) => {
  // Escape cancels wherever the focus is (also in the instant before it has moved into the dialog)
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); cancelRef.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
  <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="app-dialog-layer">
    {/* a click outside closes an ordinary dialog; a destructive one needs a deliberate choice */}
    <div className="absolute inset-0 bg-slate-900/40 motion-safe:animate-[fadeIn_120ms_ease-out]" aria-hidden onClick={() => { if (!destructive && !busy) onCancel(); }} />
    <div ref={boxRef} role={destructive ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} data-testid={testId}
      onKeyDown={onKeyDown}
      className="relative w-full sm:max-w-md bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl shadow-xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5 max-h-[90vh] overflow-y-auto">
      {children}
    </div>
  </div>
  );
};

const ConfirmDialog: React.FC<{ request: Extract<DialogRequest, { type: 'confirm' }> }> = ({ request }) => {
  const o: ConfirmOptions = request.options;
  const destructive = o.variant === 'destructive';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const once = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const safeBtn = useRef<HTMLButtonElement>(null);
  const goBtn = useRef<HTMLButtonElement>(null);
  const typeBox = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();
  const trap = useDialogFocus(box, (o.requireText ? typeBox : destructive && !o.acknowledgeOnly ? safeBtn : goBtn) as React.RefObject<HTMLElement>);
  const blocked = !!o.requireText && typed.trim() !== o.requireText;

  const cancel = () => { if (!busy) settleDialog(request.id, false); };
  const go = async () => {
    if (busy || blocked || once.current) return;
    if (!o.onConfirm) { once.current = true; settleDialog(request.id, true); return; }
    once.current = true;
    setBusy(true);
    setError('');
    try {
      await o.onConfirm();
      settleDialog(request.id, true);
    } catch (e) {
      // stays open: the person can try again or cancel
      once.current = false;
      setBusy(false);
      setError(userMessage(e, 'That did not work. Please try again.'));
    }
  };
  return (
    <Frame titleId={titleId} descId={descId} destructive={destructive} busy={busy} onCancel={cancel} boxRef={box} onKeyDown={trap} testId="confirm-dialog">
      <div className="flex gap-3">
        {destructive ? <span className="mt-0.5 shrink-0 w-9 h-9 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center" aria-hidden><AlertTriangle className="w-5 h-5" /></span> : null}
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-bold text-slate-900">{o.title}</h2>
          <div id={descId} className="mt-1 text-sm text-slate-600 space-y-2">
            {o.description ? <p className="whitespace-pre-line">{o.description}</p> : null}
            {o.details?.length ? <ul className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[13px] text-slate-700 space-y-0.5">{o.details.map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
          </div>
        </div>
      </div>
      {o.requireText ? (
        <label className="block mt-4 text-sm text-slate-700">
          Type <b className="font-mono text-slate-900">{o.requireText}</b> to confirm
          <input ref={typeBox} value={typed} onChange={e => setTyped(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
        </label>
      ) : null}
      {error ? <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        {o.acknowledgeOnly ? null : <button ref={safeBtn} type="button" className={`${BTN.base} ${BTN.safe}`} onClick={cancel} disabled={busy}>{o.cancelLabel ?? 'Cancel'}</button>}
        <button ref={goBtn} type="button" className={`${BTN.base} ${destructive ? BTN.danger : o.acknowledgeOnly ? BTN.safe : BTN.primary}`} onClick={() => void go()} disabled={busy || blocked}
          data-testid="confirm-dialog-confirm">
          {busy ? 'Working…' : o.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </Frame>
  );
};

const InputDialog: React.FC<{ request: Extract<DialogRequest, { type: 'input' }> }> = ({ request }) => {
  const o: InputOptions = request.options;
  const destructive = o.variant === 'destructive';
  const [value, setValue] = useState(o.initialValue ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const once = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const titleId = useId();
  const descId = useId();
  const fieldId = useId();
  const errId = useId();
  const trap = useDialogFocus(box, field as React.RefObject<HTMLElement>);
  const missing = !!o.required && !value.trim();

  const cancel = () => { if (!busy) settleDialog(request.id, null); };
  const submit = async () => {
    setTouched(true);
    if (busy || missing || once.current) return;
    const v = value.trim();
    once.current = true;
    if (!o.onSubmit) { settleDialog(request.id, v); return; }
    setBusy(true);
    setError('');
    try {
      await o.onSubmit(v);
      settleDialog(request.id, v);
    } catch (e) {
      once.current = false;
      setBusy(false);
      setError(userMessage(e, 'That did not work. Please try again.'));
    }
  };
  const common = {
    id: fieldId, value, disabled: busy, placeholder: o.placeholder, maxLength: o.maxLength,
    'aria-invalid': touched && missing ? true : undefined, 'aria-describedby': touched && missing ? errId : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
    className: 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 aria-[invalid=true]:border-rose-400'
  };
  return (
    <Frame titleId={titleId} descId={descId} destructive={destructive} busy={busy} onCancel={cancel} boxRef={box} onKeyDown={trap} testId="input-dialog">
      <h2 id={titleId} className="text-base font-bold text-slate-900">{o.title}</h2>
      <p id={descId} className="mt-1 text-sm text-slate-600 whitespace-pre-line">{o.description ?? ''}</p>
      <form className="mt-4" onSubmit={e => { e.preventDefault(); void submit(); }} noValidate>
        <label htmlFor={fieldId} className="block text-sm font-medium text-slate-800">{o.label}{o.required ? <span className="text-rose-600"> *</span> : <span className="text-slate-500 font-normal"> (optional)</span>}</label>
        {o.multiline
          ? <textarea ref={field} rows={3} {...common} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }} />
          : <input ref={field} type="text" {...common} />}
        <div className="mt-1 flex justify-between gap-2 text-xs">
          <span id={errId} className="text-rose-700">{touched && missing ? 'This is required.' : ''}</span>
          {o.maxLength ? <span className="text-slate-500 tabular-nums">{value.length}/{o.maxLength}</span> : null}
        </div>
        {error ? <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
        <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className={`${BTN.base} ${BTN.safe}`} onClick={cancel} disabled={busy}>{o.cancelLabel ?? 'Cancel'}</button>
          <button type="submit" className={`${BTN.base} ${destructive ? BTN.danger : BTN.primary}`} disabled={busy} data-testid="input-dialog-confirm">
            {busy ? 'Working…' : o.confirmLabel ?? 'Submit'}
          </button>
        </div>
      </form>
    </Frame>
  );
};

// ---------------------------------------------------------------------------------------------------------------- toasts
const KIND: Record<ToastKind, { icon: React.ElementType; tone: string; label: string }> = {
  success: { icon: CheckCircle2, tone: 'text-emerald-600', label: 'Success' },
  error: { icon: XCircle, tone: 'text-rose-600', label: 'Error' },
  warning: { icon: AlertTriangle, tone: 'text-amber-600', label: 'Warning' },
  info: { icon: Info, tone: 'text-slate-500', label: 'Information' }
};

const Toast: React.FC<{ t: ToastItem }> = ({ t }) => {
  const [paused, setPaused] = useState(false);
  const left = useRef(t.durationMs ?? 0);
  const startedAt = useRef(Date.now());
  // a repeated message starts its time again
  useEffect(() => { left.current = t.durationMs ?? 0; startedAt.current = Date.now(); }, [t.createdAt, t.durationMs]);
  useEffect(() => {
    if (t.durationMs === null || paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => dismissToast(t.id), Math.max(500, left.current));
    return () => { window.clearTimeout(timer); left.current -= Date.now() - startedAt.current; };
  }, [t.id, t.durationMs, t.createdAt, paused]);
  const k = KIND[t.kind];
  const Icon = k.icon;
  return (
    <div role={t.kind === 'error' ? 'alert' : 'status'} data-testid={`toast-${t.kind}`}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className="pointer-events-auto w-full sm:w-[360px] flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-lg motion-safe:animate-[toastIn_160ms_ease-out]">
      <Icon className={`w-[18px] h-[18px] mt-0.5 shrink-0 ${k.tone}`} aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <span className="sr-only">{k.label}: </span>
        {t.title ? <p className="font-semibold text-slate-900">{t.title}</p> : null}
        <p className="text-slate-700 break-words">{t.message}{t.repeat > 1 ? <span className="ml-1 text-xs text-slate-500">(×{t.repeat})</span> : null}</p>
        {t.action ? (
          <button type="button" className="mt-1.5 text-sm font-semibold text-slate-900 underline underline-offset-2 hover:text-slate-700"
            onClick={() => { t.action?.onClick(); dismissToast(t.id); }}>{t.action.label}</button>
        ) : null}
      </div>
      <button type="button" className="shrink-0 -mr-1 -mt-0.5 w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>
        <X className="w-4 h-4" aria-hidden />
      </button>
    </div>
  );
};

const ToastViewport: React.FC<{ toasts: ToastItem[] }> = ({ toasts }) => (
  // phones: at the top (clear of the keyboard and the bottom actions); larger screens: bottom right
  <div aria-label="Notifications" role="region" data-testid="app-toasts"
    className="pointer-events-none fixed z-[210] inset-x-0 top-0 sm:top-auto sm:bottom-0 sm:left-auto sm:right-0 flex flex-col sm:flex-col-reverse items-stretch sm:items-end gap-2 px-3 sm:px-5 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-0 sm:pb-5">
    {toasts.map(t => <Toast key={t.id} t={t} />)}
  </div>
);

export default AppFeedbackProvider;
