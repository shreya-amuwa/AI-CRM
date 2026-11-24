import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { lockScroll } from '../../lib/scrollLock';

/**
 * A compact dialog: a bottom sheet on phones (at most `maxPhoneHeight` of the screen, scrolling inside, above the home indicator) and a
 * centred dialog from 640 px. Focus moves into it and stays there (Tab cycles), Escape closes it when `dismissible`, and focus returns to
 * whatever opened it. The page behind stays visible (a light scrim, no blur).
 */
export const BottomSheet: React.FC<{
  title: string;
  /** A short line under the title. */
  subtitle?: React.ReactNode;
  /** Above the title: a category, a small icon. */
  eyebrow?: React.ReactNode;
  onClose: () => void;
  /** Escape, the scrim and the close button close it. False for something the person must answer (an acknowledgement). */
  dismissible?: boolean;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** Tailwind max-height class on phones, e.g. 'max-h-[55vh]'. */
  maxPhoneHeight?: string;
  /** Width from 640 px. */
  size?: 'sm' | 'md' | 'lg';
  testId?: string;
  /** role="alertdialog" for a confirmation that interrupts. */
  alert?: boolean;
}> = ({ title, subtitle, eyebrow, onClose, dismissible = true, footer, children, maxPhoneHeight = 'max-h-[85vh]', size = 'md', testId, alert = false }) => {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const release = lockScroll();
    // the first field or button inside, else the panel itself
    const first = panel.current?.querySelector<HTMLElement>('textarea, input, select, [data-autofocus], button:not([data-sheet-close])');
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!items.length) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      release();
      opener?.focus?.();
    };
  }, [dismissible]);

  const width = size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-xl' : 'sm:max-w-md';
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="presentation" data-testid={testId}>
      <div className="absolute inset-0 bg-slate-900/30" aria-hidden="true" onClick={() => dismissible && onClose()} />
      <div
        ref={panel}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descId : undefined}
        tabIndex={-1}
        className={`relative w-full ${width} ${maxPhoneHeight} sm:max-h-[85vh] flex flex-col bg-white outline-none
          rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-lg pb-[env(safe-area-inset-bottom)] sm:pb-0`}
      >
        <div className="sm:hidden mx-auto mt-2 h-1 w-9 rounded-full bg-slate-300" aria-hidden="true" />
        <div className="flex items-start gap-3 px-4 sm:px-5 pt-3 sm:pt-4 pb-2">
          <div className="min-w-0 flex-1">
            {eyebrow ? <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</div> : null}
            <h2 id={titleId} className="text-base font-semibold text-slate-900 leading-snug">{title}</h2>
            {subtitle ? <div id={descId} className="mt-0.5 text-sm text-slate-600">{subtitle}</div> : null}
          </div>
          {dismissible ? (
            <button type="button" data-sheet-close onClick={onClose} aria-label="Close"
              className="shrink-0 -mr-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5 pb-3 text-sm text-slate-700">{children}</div> : null}
        {footer ? <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-slate-100 px-4 sm:px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
};
