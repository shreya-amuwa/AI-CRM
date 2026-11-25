/**
 * The CRM's in-app feedback (docs/APP_FEEDBACK_SYSTEM.md): toasts, confirmation dialogs and input dialogs, instead of the browser's own
 * alert() / confirm() / prompt(). This file is the state only (no React), so it can be used from any handler and tested in Node; the
 * <AppFeedbackProvider> (src/components/feedback/AppFeedback.tsx) draws it.
 *
 *   toast.success('Customer details updated.')                    non-blocking; success / info disappear by themselves
 *   if (!(await confirmAction({ title, description, ... }))) return; a decision; dismissing it is "no"
 *   const reason = await promptInput({ title, label, required })   text, or null when cancelled ('' when left empty and not required)
 *
 * Rules kept here, whoever calls:
 *   - one dialog at a time; others wait their turn (at most MAX_QUEUED waiting, anything beyond is answered "no" at once);
 *   - a dialog with onConfirm / onSubmit shows "working", runs it once (a second click does nothing), stays open with the error if it
 *     fails and resolves true only when it succeeded;
 *   - without a provider on the page nothing is confirmed (false / null), so an action can never run unasked;
 *   - at most MAX_TOASTS toasts are shown; the same message again refreshes the one already shown instead of stacking.
 */

export type ToastKind = 'success' | 'error' | 'warning' | 'info';
export interface ToastAction { label: string; onClick: () => void }
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  title?: string;
  /** null: stays until closed (an unresolved, important failure) */
  durationMs: number | null;
  action?: ToastAction;
  /** how many times the same message was raised while shown */
  repeat: number;
  createdAt: number;
}
export interface ToastOptions { title?: string; durationMs?: number | null; action?: ToastAction }

export interface ConfirmOptions {
  /** action-specific: "Delete this draft?", "End your workday?" (never just "Are you sure?") */
  title: string;
  description?: string;
  /** short facts shown as a list (who, what, amount) */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** destructive: red confirm button, the safe button is focused first and a click outside does not close it */
  variant?: 'default' | 'destructive';
  /** genuinely high-risk only: the person types this text before the confirm button works */
  requireText?: string;
  /** run the action inside the dialog: "working…", once, and the dialog stays open showing the error if it fails */
  onConfirm?: () => Promise<unknown> | unknown;
  /** information only: a single Close button (showDetails) */
  acknowledgeOnly?: boolean;
}
export interface InputOptions {
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  /** an empty value cannot be submitted */
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onSubmit?: (value: string) => Promise<unknown> | unknown;
}

export type DialogRequest =
  | { id: number; type: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; type: 'input'; options: InputOptions; resolve: (v: string | null) => void };

export interface FeedbackState { toasts: ToastItem[]; dialogs: DialogRequest[] }

export const MAX_TOASTS = 4;
export const MAX_QUEUED = 5;
export const TOAST_MS: Record<ToastKind, number> = { success: 4000, info: 5000, warning: 7000, error: 9000 };

let state: FeedbackState = { toasts: [], dialogs: [] };
let nextId = 1;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const set = (next: FeedbackState) => { state = next; emit(); };

export const getFeedbackState = () => state;
export function subscribeFeedback(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
/** The provider says it is on the page (dialogs can be shown). Returns the unregister function. */
export function registerFeedbackHost(): () => void {
  hosts += 1;
  return () => {
    hosts = Math.max(0, hosts - 1);
    // the page that could answer is gone: everything still waiting is "no", never left hanging
    if (!hosts) {
      for (const d of state.dialogs) (d.type === 'confirm' ? d.resolve(false) : d.resolve(null));
      set({ ...state, dialogs: [] });
    }
  };
}
export const hasFeedbackHost = () => hosts > 0;

// ------------------------------------------------------------------ toasts
export function showToast(kind: ToastKind, message: string, opts: ToastOptions = {}): number {
  const text = String(message ?? '').trim() || (kind === 'error' ? 'Something went wrong. Please try again.' : '');
  const same = state.toasts.find(t => t.kind === kind && t.message === text && (t.title ?? '') === (opts.title ?? ''));
  if (same) {
    set({ ...state, toasts: state.toasts.map(t => (t === same ? { ...t, repeat: t.repeat + 1, createdAt: Date.now() } : t)) });
    return same.id;
  }
  const item: ToastItem = {
    id: nextId++, kind, message: text, title: opts.title, action: opts.action, repeat: 1, createdAt: Date.now(),
    durationMs: opts.durationMs === undefined ? TOAST_MS[kind] : opts.durationMs
  };
  let toasts = [...state.toasts, item];
  // a bounded stack: the oldest one that would disappear anyway goes first, then the oldest
  while (toasts.length > MAX_TOASTS) {
    const i = toasts.findIndex(t => t.durationMs !== null);
    toasts.splice(i >= 0 ? i : 0, 1);
  }
  set({ ...state, toasts });
  return item.id;
}
export function dismissToast(id: number) {
  if (state.toasts.some(t => t.id === id)) set({ ...state, toasts: state.toasts.filter(t => t.id !== id) });
}
export function clearToasts() { set({ ...state, toasts: [] }); }

type ToastFn = ((message: string, opts?: ToastOptions & { kind?: ToastKind }) => number) & {
  success: (m: string, o?: ToastOptions) => number;
  error: (m: string, o?: ToastOptions) => number;
  warning: (m: string, o?: ToastOptions) => number;
  info: (m: string, o?: ToastOptions) => number;
};
export const toast: ToastFn = Object.assign((m: string, o: ToastOptions & { kind?: ToastKind } = {}) => showToast(o.kind ?? 'info', m, o), {
  success: (m: string, o?: ToastOptions) => showToast('success', m, o),
  error: (m: string, o?: ToastOptions) => showToast('error', m, o),
  warning: (m: string, o?: ToastOptions) => showToast('warning', m, o),
  info: (m: string, o?: ToastOptions) => showToast('info', m, o)
});

// ------------------------------------------------------------------ dialogs
function enqueue<T>(make: (id: number, resolve: (v: T) => void) => DialogRequest, none: T): Promise<T> {
  if (!hosts || state.dialogs.length >= MAX_QUEUED) {
    if (!hosts && typeof console !== 'undefined') console.warn('A confirmation was asked for with no feedback provider on the page; treated as cancelled.');
    return Promise.resolve(none);
  }
  return new Promise<T>(resolve => {
    const id = nextId++;
    set({ ...state, dialogs: [...state.dialogs, make(id, resolve)] });
  });
}
/** Ask the person to confirm. Resolves true only when they confirmed (and, with onConfirm, when that succeeded). */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return enqueue<boolean>((id, resolve) => ({ id, type: 'confirm', options, resolve }), false);
}
/** Show information that needs reading (no decision): one Close button. */
export function showDetails(options: { title: string; description?: string; details?: string[]; closeLabel?: string }): Promise<void> {
  return confirmAction({ title: options.title, description: options.description, details: options.details, confirmLabel: options.closeLabel ?? 'Close', acknowledgeOnly: true }).then(() => undefined);
}
/** Ask for text. Resolves the text, or null when cancelled. */
export function promptInput(options: InputOptions): Promise<string | null> {
  return enqueue<string | null>((id, resolve) => ({ id, type: 'input', options, resolve }), null);
}
/** The provider closes a dialog with its answer (only the dialog shown can be answered, and only once). */
export function settleDialog(id: number, value: boolean | string | null) {
  const d = state.dialogs.find(x => x.id === id);
  if (!d) return;
  set({ ...state, dialogs: state.dialogs.filter(x => x.id !== id) });
  if (d.type === 'confirm') d.resolve(value === true);
  else d.resolve(typeof value === 'string' ? value : null);
}

/** Test helper: back to an empty state. */
export function resetFeedbackForTests() { state = { toasts: [], dialogs: [] }; hosts = 0; emit(); }
