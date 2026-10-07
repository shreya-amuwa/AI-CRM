import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import type { LeadStatus, PipelineCounts, ServiceCatalogItem } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { getSupabase } from '../../../services/supabaseClient';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : inr.format(n));

export const initials = (s: string | null | undefined) =>
  (s || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('');

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const dayDiff = (iso: string) =>
  Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(new Date()).getTime()) / 86400000);

/** "Today, 4:00 PM" / "08 Oct" */
export function formatFollowUp(iso: string | null): { text: string; urgent: boolean } {
  if (!iso) return { text: '—', urgent: false };
  const d = new Date(iso);
  const diff = dayDiff(iso);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toUpperCase();
  if (diff === 0) return { text: `Today, ${time}`, urgent: true };
  if (diff < 0) return { text: `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} (overdue)`, urgent: true };
  return { text: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), urgent: false };
}

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
export const longDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function relativeDays(iso: string): string {
  const diff = -dayDiff(iso);
  if (diff <= 0) return 'today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}

/** Local-date YYYY-MM-DD (not UTC) for date inputs. */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  INTERESTED: 'Interested',
  READY_TO_BUY: 'Ready to buy'
};
export const LEAD_STATUS_HINT: Record<LeadStatus, string> = {
  NEW: 'Not contacted',
  CONTACTED: 'Spoke once',
  INTERESTED: 'Wants a quote',
  READY_TO_BUY: 'Moves to Potential'
};
export const LEAD_SOURCES = ['Walk-in', 'Instagram', 'Meta Ads', 'Website', 'Referral', 'Cold call', 'WhatsApp', 'Google', 'Other'];
export const BUSINESS_CATEGORIES = [
  'Jewellery / Gold', 'Retail', 'Restaurant / Food', 'Healthcare', 'Education', 'Real Estate',
  'Beauty / Salon', 'Fitness', 'Manufacturing', 'Services', 'Other'
];
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CARD: 'Card', CHEQUE: 'Cheque', OTHER: 'Other'
};

const CATEGORY_DOT: Record<string, string> = {
  'Messaging & AI': 'bg-teal-500',
  'Google & Social': 'bg-pink-500',
  'Video & Content': 'bg-violet-500',
  'Creative & Branding': 'bg-emerald-600'
};
export const categoryDot = (category?: string) => CATEGORY_DOT[category || ''] || 'bg-slate-400';

const AVATAR_TONES = [
  'bg-indigo-50 text-indigo-700', 'bg-pink-50 text-pink-700', 'bg-cyan-50 text-cyan-700',
  'bg-orange-50 text-orange-700', 'bg-emerald-50 text-emerald-700', 'bg-violet-50 text-violet-700'
];

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------
export const Avatar: React.FC<{ name: string | null; size?: 'sm' | 'lg' }> = ({ name, size = 'sm' }) => {
  const tone = AVATAR_TONES[[...(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span
      aria-hidden="true"
      className={`${tone} ${size === 'lg' ? 'w-14 h-14 text-lg rounded-2xl' : 'w-9 h-9 text-[11px] rounded-xl'} shrink-0 inline-flex items-center justify-center font-bold`}
    >
      {initials(name)}
    </span>
  );
};

export const ServiceChips: React.FC<{ codes: string[]; catalog: Map<string, ServiceCatalogItem>; max?: number }> = ({ codes, catalog, max = 2 }) => {
  const shown = codes.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map(code => {
        const s = catalog.get(code);
        return (
          <span key={code} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-medium text-slate-700">
            <span className={`w-1.5 h-1.5 rounded-full ${categoryDot(s?.category)}`} />
            {s?.name || code}
          </span>
        );
      })}
      {codes.length > max && (
        <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-[11px] font-medium text-slate-600" title={codes.slice(max).map(c => catalog.get(c)?.name || c).join(', ')}>
          +{codes.length - max}
        </span>
      )}
    </div>
  );
};

const PILL_TONES = {
  slate: 'bg-slate-100 text-slate-700',
  indigo: 'bg-indigo-50 text-indigo-700',
  orange: 'bg-orange-50 text-orange-700',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-rose-50 text-rose-700'
} as const;
const DOT_TONES = { slate: 'bg-slate-400', indigo: 'bg-indigo-500', orange: 'bg-orange-500', green: 'bg-emerald-500', red: 'bg-rose-500' } as const;
export type Tone = keyof typeof PILL_TONES;

export const Pill: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${PILL_TONES[tone]}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${DOT_TONES[tone]}`} />
    {children}
  </span>
);

export const LEAD_STATUS_TONE: Record<LeadStatus, Tone> = { NEW: 'slate', CONTACTED: 'indigo', INTERESTED: 'orange', READY_TO_BUY: 'green' };

export const Breadcrumb: React.FC<{ items: { label: string; onClick?: () => void }[] }> = ({ items }) => (
  <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
    {items.map((it, i) => (
      <span key={it.label}>
        {i > 0 && <span className="mx-1">/</span>}
        {it.onClick ? (
          <button type="button" onClick={it.onClick} className="underline text-indigo-600 hover:text-indigo-700">
            {it.label}
          </button>
        ) : (
          <span aria-current={i === items.length - 1 ? 'page' : undefined}>{it.label}</span>
        )}
      </span>
    ))}
  </nav>
);

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-xs ${className}`}>{children}</div>
);

export const ErrorBanner: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
    <span className="flex-1">{message}</span>
    {onRetry && (
      <button type="button" onClick={onRetry} className="font-semibold underline">
        Retry
      </button>
    )}
  </div>
);

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div role="status" className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
    <Loader2 className="w-4 h-4 animate-spin" /> {label}
  </div>
);

export const btn = {
  primary:
    'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 transition-colors',
  green:
    'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 transition-colors',
  secondary:
    'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition-colors',
  danger:
    'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 transition-colors'
};
export const inputCls =
  'w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 disabled:bg-slate-50';
export const selectCls =
  'px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300';

export const Field: React.FC<{ label: string; required?: boolean; error?: string; htmlFor: string; children: React.ReactNode }> = ({
  label,
  required,
  error,
  htmlFor,
  children
}) => (
  <div>
    <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 mb-1">
      {label}
      {required && <span aria-hidden="true"> *</span>}
    </label>
    {children}
    {error && (
      <p id={`${htmlFor}-error`} className="mt-1 text-[11px] text-rose-600">
        {error}
      </p>
    )}
  </div>
);

/** Numbered pagination with page-size selector, as in the design. */
export const Pager: React.FC<{
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
  sizes?: number[];
}> = ({ page, pageSize, total, noun, onPage, onPageSize, sizes = [10, 20, 50] }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const nums: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p <= 3 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
      <span aria-live="polite">
        Showing <b className="text-slate-700">{from}–{to}</b> of {total.toLocaleString('en-IN')} {noun}
      </span>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn.secondary} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} className="px-1">…</span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onPage(n)}
              aria-current={n === page ? 'page' : undefined}
              className={n === page ? 'min-w-8 px-2 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold' : `${btn.secondary} min-w-8`}
            >
              {n}
            </button>
          )
        )}
        <button type="button" className={btn.secondary} onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        {onPageSize && (
          <label className="flex items-center gap-1.5 ml-2">
            Per page
            <select className={selectCls} value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>
              {sizes.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
};

/** Accessible modal dialog: focus moves in, Escape closes, focus returns. */
export const Dialog: React.FC<{ title: string; description?: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  description,
  onClose,
  children
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="pl-dialog-title" className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <div>
          <h2 id="pl-dialog-title" className="text-base font-bold text-slate-900">
            {title}
          </h2>
          {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
        </div>
        {children}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------
let catalogPromise: Promise<ServiceCatalogItem[]> | null = null;

export function useServiceCatalog() {
  const [items, setItems] = useState<ServiceCatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    catalogPromise ||= pipelineApi.services().catch(err => {
      catalogPromise = null;
      throw err;
    });
    catalogPromise.then(setItems, err => setError(errorMessage(err)));
  }, []);
  const byCode = React.useMemo(() => new Map(items.map(s => [s.code, s])), [items]);
  return { items, byCode, error };
}

/**
 * Calls `onChange` (debounced) when pipeline rows this user can see change in
 * the database — keeps counts and lists fresh across tabs and teammates.
 */
export function usePipelineRealtime(onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 400);
    };
    const channel = sb
      .channel(`pipeline-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, fire)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_documents' }, fire)
      .subscribe();
    return () => {
      clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, []);
}

export function usePipelineCounts() {
  const [counts, setCounts] = useState<PipelineCounts | null>(null);
  const refresh = useCallback(() => {
    pipelineApi.counts().then(setCounts, err => console.warn('[pipeline] counts failed', errorMessage(err)));
  }, []);
  useEffect(refresh, [refresh]);
  usePipelineRealtime(refresh);
  useEffect(() => {
    window.addEventListener('crm:pipeline-changed', refresh);
    return () => window.removeEventListener('crm:pipeline-changed', refresh);
  }, [refresh]);
  return { counts, refresh };
}

/** Tell every pipeline view (counts, lists) that data changed. */
export const notifyPipelineChanged = () => window.dispatchEvent(new CustomEvent('crm:pipeline-changed'));

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
