import React, { useEffect } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import type { Loaded } from './hooks';
import type { ClientTicketStatus, ServiceRequestStatus } from '../../shared/contracts';
import { lockScroll } from '../lib/scrollLock';

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
/** A stable accent (1-6) per category so each kind of service looks distinct. */
export const hueOf = (category: string | null | undefined): number => {
  let h = 0;
  for (const ch of category || '') h = (h * 31 + ch.charCodeAt(0)) % 6;
  return h + 1;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const humanize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()).trim();
export interface DetailView { label: string; value: string }
/** What the team set up for a service, in plain words (the WhatsApp API package gets a usage bar). */
export function serviceDetails(code: string, details: Record<string, unknown> | null | undefined) {
  const d = details ?? {};
  const bought = num(d.packageMessages);
  const sent = num(d.messagesSent);
  const campaigns = num(d.campaignsSent);
  const usage = code.startsWith('WHATSAPP_API') && bought !== null && bought > 0
    ? { bought, sent: sent ?? 0, remaining: Math.max(0, bought - (sent ?? 0)), pct: Math.min(100, Math.round(((sent ?? 0) / bought) * 100)) }
    : null;
  const rows: DetailView[] = [];
  if (campaigns !== null) rows.push({ label: 'Campaigns sent', value: String(campaigns) });
  const known = new Set(['packageMessages', 'messagesSent', 'campaignsSent']);
  for (const [k, v] of Object.entries(d)) {
    if (known.has(k) || v === null || v === '' || typeof v === 'object') continue;
    rows.push({ label: humanize(k), value: String(v) });
  }
  return { usage, rows };
}

/** A package being used up (WhatsApp / RCS / Voice messages, AI Calling minutes or credits), for the usage bars and alerts. */
export interface UsageBar {
  label: string;
  unit: string;
  total: number;
  used: number;
  left: number;
  pct: number;
  tone: 'success' | 'attention' | 'danger';
  asOf: string | null;
  validUntil: string | null;
}
export function usageBar(s: { code: string; usage?: { kind: string; metrics: Record<string, unknown>; asOf: string | null; validUntil: string | null } | null; details?: Record<string, unknown> | null }): UsageBar | null {
  const make = (label: string, unit: string, total: number | null, used: number | null, left: number | null, asOf: string | null, validUntil: string | null): UsageBar | null => {
    if (total === null || total <= 0) return null;
    const usedN = Math.max(0, used ?? (left !== null ? total - left : 0));
    const leftN = Math.max(0, left ?? total - usedN);
    const pct = Math.min(100, Math.round((usedN / total) * 100));
    return { label, unit, total, used: usedN, left: leftN, pct, tone: pct >= 90 ? 'danger' : pct >= 75 ? 'attention' : 'success', asOf, validUntil };
  };
  const u = s.usage;
  if (u) {
    const m = u.metrics;
    if (u.kind === 'WHATSAPP') {
      const total = (num(m.packageMessages) ?? 0) + (num(m.extraMessages) ?? 0);
      return make('Messages', 'messages', total, num(m.sent), null, u.asOf, u.validUntil);
    }
    if (u.kind === 'AI_CALLING') {
      if (num(m.minutesBought)) return make('Calling minutes', 'minutes', num(m.minutesBought), null, num(m.minutesLeft), u.asOf, u.validUntil);
      return make('Calling credits', '₹', num(m.creditsBought), null, num(m.creditsLeft), u.asOf, u.validUntil);
    }
    if (u.kind === 'RCS' || u.kind === 'VOICE') return make(u.kind === 'RCS' ? 'RCS messages' : 'Voice messages', 'messages', num(m.packageMessages), num(m.sent), null, u.asOf, u.validUntil);
  }
  const old = serviceDetails(s.code, s.details).usage;
  return old ? make('Messages', 'messages', old.bought, old.sent, null, null, null) : null;
}
export const fmtNum = (n: number, unit = ''): string => (unit === '₹' ? inr(n) : `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`);

export const UsageMeter: React.FC<{ bar: UsageBar; compact?: boolean }> = ({ bar, compact }) => {
  const colour = bar.tone === 'danger' ? 'var(--danger)' : bar.tone === 'attention' ? 'var(--attention-text)' : 'var(--primary)';
  return (
    <div style={compact ? undefined : { border: '1px solid var(--divider)', background: 'var(--surface)', borderRadius: 14, padding: 14 }}>
      <div className="cd-between"><span className="cd-label">{bar.label}</span><b style={{ color: bar.tone === 'success' ? undefined : colour }}>{fmtNum(bar.left, bar.unit)} left</b></div>
      <div role="progressbar" aria-label={`${bar.label} used`} aria-valuenow={bar.pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 9, borderRadius: 99, background: 'var(--segment)', overflow: 'hidden', margin: '8px 0' }}>
        <i style={{ display: 'block', height: '100%', width: `${bar.pct}%`, background: colour, borderRadius: 99 }} />
      </div>
      <div className="cd-between cd-small cd-muted"><span>{fmtNum(bar.used, bar.unit)} used ({bar.pct}%)</span><span>of {fmtNum(bar.total, bar.unit)}</span></div>
      {!compact && (bar.asOf || bar.validUntil) ? (
        <p className="cd-small cd-muted" style={{ marginTop: 6 }}>{bar.asOf ? `Updated ${fmtDate(bar.asOf)}` : ''}{bar.asOf && bar.validUntil ? ' · ' : ''}{bar.validUntil ? `valid until ${fmtDate(bar.validUntil)}` : ''}</p>
      ) : null}
    </div>
  );
};

export const SERVICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  LIVE: { label: 'Live', tone: 'success' },
  SETTING_UP: { label: 'Setting up', tone: 'attention' },
  PAUSED: { label: 'Paused', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' }
};
export const serviceStatus = (s: string) => SERVICE_STATUS[s] ?? SERVICE_STATUS.SETTING_UP;

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
  ESCALATED: { label: 'Escalated', tone: 'info' },
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

export const ErrorState: React.FC<{ message: string; forbidden?: boolean; onRetry?: () => void; title?: string }> = ({ message, forbidden, onRetry, title }) => (
  <div className="cd-empty" role="alert">
    <div className="ic" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{forbidden ? <ShieldAlert size={24} /> : <AlertTriangle size={24} />}</div>
    <h3>{forbidden ? 'You do not have access to this' : title || 'Something went wrong'}</h3>
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

/**
 * Loading / error / (optional) empty / content for one loaded resource. `errorTitle` names what failed to load, and
 * `unavailableText` replaces the server's generic message when the failure is on the server's side (5xx / unreachable).
 */
export function Query<T>({ q, empty, children, rows, errorTitle, unavailableText }: {
  q: Loaded<T>; empty?: (d: T) => React.ReactNode | null; children: (d: T) => React.ReactNode; rows?: number; errorTitle?: string; unavailableText?: string;
}) {
  if (q.loading && !q.data) return <LoadingBlock rows={rows} />;
  if (q.error && !q.data) {
    const message = q.unavailable && unavailableText ? unavailableText : q.error;
    return <div className="cd-card"><ErrorState title={errorTitle} message={message} forbidden={q.forbidden} onRetry={q.reload} /></div>;
  }
  if (!q.data) return null;
  const e = empty?.(q.data);
  if (e) return <>{e}</>;
  return <>{children(q.data)}</>;
}

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const unlock = lockScroll();
    return () => { document.removeEventListener('keydown', onKey); unlock(); };
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
