import React, { useEffect } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import type { Loaded } from './hooks';
import type { ClientTicketStatus, ServiceRequestStatus } from '../../shared/contracts';

// ---- formatting ----
export const inr = (n: number | null | undefined): string =>
  n === null || n === undefined ? '-' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
export const fmtDate = (v: string | null | undefined, withYear = true): string => {
  if (!v) return '-';
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
};
export const fmtDateTime = (v: string | null | undefined): string => {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
export const daysUntil = (v: string): number => Math.ceil((new Date(`${v.slice(0, 10)}T00:00:00`).getTime() - Date.now()) / 86_400_000);
export const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
export const tagOf = (name: string): string => initials(name).slice(0, 2);

// ---- status labels ----
export type Tone = 'success' | 'attention' | 'info' | 'neutral' | 'danger';
export const SERVICE_REQUEST_LABEL: Record<ServiceRequestStatus, { label: string; tone: Tone }> = {
  REQUESTED: { label: 'Request sent', tone: 'attention' },
  IN_REVIEW: { label: 'Being reviewed', tone: 'info' },
  IN_ADDON_WORKFLOW: { label: 'With Accounts', tone: 'info' },
  ACTIVATED: { label: 'Activated', tone: 'success' },
  REJECTED: { label: 'Not approved', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' }
};
export const TICKET_LABEL: Record<ClientTicketStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'attention' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  WAITING_CUSTOMER: { label: 'Waiting for you', tone: 'attention' },
  ESCALATED: { label: 'In progress', tone: 'info' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' }
};
export const TICKET_CATEGORIES: { value: string; label: string }[] = [
  { value: 'GENERAL', label: 'General question' }, { value: 'BILLING', label: 'Billing / invoice' }, { value: 'TECHNICAL', label: 'Technical problem' },
  { value: 'SERVICE_REQUEST', label: 'About a service' }, { value: 'ONBOARDING', label: 'Setup / onboarding' }, { value: 'COMPLAINT', label: 'Complaint' }, { value: 'OTHER', label: 'Something else' }
];
export const categoryLabel = (v: string) => TICKET_CATEGORIES.find(c => c.value === v)?.label ?? v;

// ---- primitives ----
export const Badge: React.FC<{ tone?: Tone | 'new'; children: React.ReactNode }> = ({ tone = 'neutral', children }) => (
  <span className={`cd-badge ${tone}`}>{children}</span>
);

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'danger'; small?: boolean; loading?: boolean };
export const Button: React.FC<BtnProps> = ({ variant = 'primary', small, loading, children, disabled, className = '', ...rest }) => (
  <button {...rest} disabled={disabled || loading} className={`cd-btn ${variant === 'primary' ? '' : variant === 'outline' ? 'ghost' : variant} ${small ? 'sm' : ''} ${className}`}>
    {loading ? <Loader2 size={16} className="cd-spin" aria-hidden /> : null}
    {children}
  </button>
);

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement> & { small?: boolean; onClick?: () => void }> = ({ small, onClick, className = '', children, ...rest }) => (
  <div
    {...rest}
    className={`cd-card ${small ? 'sm' : ''} ${onClick ? 'click' : ''} ${className}`}
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
  >
    {children}
  </div>
);

export const PageHeader: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div className="cd-head">
    <div>
      <h1 className="cd-page-title">{title}</h1>
      {subtitle ? <p className="cd-sub">{subtitle}</p> : null}
    </div>
    {action}
  </div>
);

export const Field: React.FC<{ label: string; htmlFor: string; hint?: string; children: React.ReactNode }> = ({ label, htmlFor, hint, children }) => (
  <div className="cd-field">
    <label htmlFor={htmlFor}>{label}</label>
    {children}
    {hint ? <span className="cd-small cd-muted">{hint}</span> : null}
  </div>
);

export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }> = ({ icon, title, text, action }) => (
  <div className="cd-empty">
    <div className="ic">{icon ?? <Inbox size={24} />}</div>
    <h3>{title}</h3>
    {text ? <p className="cd-small" style={{ maxWidth: 380 }}>{text}</p> : null}
    {action}
  </div>
);

export const ErrorState: React.FC<{ message: string; forbidden?: boolean; onRetry?: () => void }> = ({ message, forbidden, onRetry }) => (
  <div className="cd-empty" role="alert">
    <div className="ic" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{forbidden ? <ShieldAlert size={24} /> : <AlertTriangle size={24} />}</div>
    <h3>{forbidden ? 'You do not have access to this' : 'Something went wrong'}</h3>
    <p className="cd-small" style={{ maxWidth: 380 }}>{message}</p>
    {onRetry && !forbidden ? <Button variant="outline" small onClick={onRetry}><RefreshCw size={14} /> Try again</Button> : null}
  </div>
);

export const Skeleton: React.FC<{ h?: number; w?: string }> = ({ h = 16, w = '100%' }) => <div className="cd-skel" style={{ height: h, width: w }} aria-hidden />;
export const LoadingBlock: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div className="cd-stack" role="status" aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => <div key={i} className="cd-card"><div className="cd-stack" style={{ gap: 10 }}><Skeleton h={14} w="40%" /><Skeleton h={22} w="70%" /><Skeleton h={12} w="55%" /></div></div>)}
  </div>
);

/** Loading / error / (optional) empty / content for one loaded resource. */
export function Query<T>({ q, empty, children, rows }: { q: Loaded<T>; empty?: (d: T) => React.ReactNode | null; children: (d: T) => React.ReactNode; rows?: number }) {
  if (q.loading && !q.data) return <LoadingBlock rows={rows} />;
  if (q.error && !q.data) return <div className="cd-card"><ErrorState message={q.error} forbidden={q.forbidden} onRetry={q.reload} /></div>;
  if (!q.data) return null;
  const e = empty?.(q.data);
  if (e) return <>{e}</>;
  return <>{children(q.data)}</>;
}

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="cd-modal-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cd-modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 720 } : undefined}>
        <div className="cd-between" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 20 }}>{title}</h2>
          <button className="cd-bell" style={{ width: 38, height: 38 }} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
};
