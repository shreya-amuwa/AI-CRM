import React from 'react';
import { CheckCircle2, X } from 'lucide-react';

/**
 * The HR dashboard's shared page pieces, so every HR screen reads as one application: one page header (icon, title, one-line subtitle,
 * actions on the right), one set of button sizes, one empty state and one toast. Light theme, navy text, soft blue accents, subtle borders.
 */

/** Buttons: one height (36px), one radius, three weights. Combine with extra classes only for layout (w-full, ml-auto ...). */
export const hrBtn = {
  primary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-blue-600 text-white text-[13px] font-semibold shadow-xs hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1 transition-colors whitespace-nowrap',
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-[13px] font-semibold hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 transition-colors whitespace-nowrap',
  ghost:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-slate-600 text-[13px] font-semibold hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 transition-colors whitespace-nowrap',
  danger:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-rose-200 bg-white text-rose-700 text-[13px] font-semibold hover:bg-rose-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 transition-colors whitespace-nowrap',
  /** a square icon-only button (give it an aria-label) */
  icon:
    'inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 transition-colors'
} as const;

/** The standard card surface. */
export const hrCard = 'bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

export const HrPageHeader: React.FC<{
  icon?: React.ElementType;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** a small chip next to the title (status, shift ...) */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** h1 for a page, h2 when the header sits inside a page that already has one */
  as?: 'h1' | 'h2';
  className?: string;
}> = ({ icon: Icon, title, subtitle, meta, actions, as: Heading = 'h1', className = '' }) => (
  <header className={`flex flex-col gap-3 md:flex-row md:items-center md:justify-between ${className}`}>
    <div className="flex items-start gap-3 min-w-0">
      {Icon && (
        <span className="mt-0.5 w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0" aria-hidden="true">
          <Icon className="w-5 h-5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Heading className="text-lg sm:text-xl font-bold font-heading text-slate-900 leading-tight">{title}</Heading>
          {meta}
        </div>
        {subtitle && <p className="mt-1 text-[13px] text-slate-500 leading-snug max-w-3xl">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 md:justify-end shrink-0">{actions}</div>}
  </header>
);

/** A section title inside a page (with an optional count and actions). */
export const HrSectionTitle: React.FC<{ icon?: React.ElementType; title: React.ReactNode; count?: number; actions?: React.ReactNode; id?: string; tone?: 'default' | 'amber' }> = ({
  icon: Icon, title, count, actions, id, tone = 'default'
}) => (
  <div className="flex items-center justify-between gap-3">
    <h3 id={id} className={`text-[15px] font-bold flex items-center gap-2 ${tone === 'amber' ? 'text-amber-900' : 'text-slate-900'}`}>
      {Icon && <Icon className={`w-4 h-4 ${tone === 'amber' ? 'text-amber-600' : 'text-blue-600'}`} aria-hidden="true" />}
      {title}
      {count !== undefined && <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{count}</span>}
    </h3>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export const HrEmptyState: React.FC<{ icon: React.ElementType; title: string; hint?: string; action?: React.ReactNode }> = ({ icon: Icon, title, hint, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-10 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
    <span className="w-11 h-11 rounded-full bg-white border border-slate-200 text-slate-400 flex items-center justify-center" aria-hidden="true">
      <Icon className="w-5 h-5" />
    </span>
    <p className="mt-3 text-sm font-semibold text-slate-800">{title}</p>
    {hint && <p className="mt-1 text-xs text-slate-500 max-w-sm">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** A confirmation that floats in the corner, so it never pushes the page down. */
export const HrToast: React.FC<{ message: string | null; onClose: () => void }> = ({ message, onClose }) =>
  message ? (
    <div role="status" aria-live="polite"
      className="fixed z-[70] bottom-4 right-4 left-4 sm:left-auto sm:max-w-md flex items-start gap-2.5 p-3.5 rounded-xl bg-white border border-emerald-200 shadow-lg text-[13px] text-slate-800 animate-fade-in">
      <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-0.5 -m-0.5 rounded" aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  ) : null;
