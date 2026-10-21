import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, ShieldCheck, X } from 'lucide-react';
import type { AuditEvent, AuditOutcome } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { auditApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Card, fieldCls, ghostBtn, LoadingLine } from '../tasks/head/headParts';

/**
 * Security & Audit Logs: who did what, when, and whether it worked or was refused. Read-only: nothing here edits or deletes an event
 * (the database refuses it too). What a person can see is decided by the database from their role: the Super Admin reads everything,
 * a Department Head their department, a Team Lead their team. Secrets are removed before an event is stored.
 */
const PAGE_SIZE = 25;

const OUTCOME_CLS: Record<AuditOutcome, string> = {
  SUCCESS: 'bg-emerald-50 text-emerald-700',
  FAILURE: 'bg-amber-50 text-amber-800',
  DENIED: 'bg-rose-50 text-rose-700'
};
const OUTCOME_LABEL: Record<AuditOutcome, string> = { SUCCESS: 'Success', FAILURE: 'Failed', DENIED: 'Refused' };
const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Super Admin', DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member' };

/** CUSTOMER_STAGE_CHANGED -> Customer stage changed */
const pretty = (action: string) => action.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const todayIso = () => new Date().toISOString().slice(0, 10);

export const SecurityAuditLogs: React.FC = () => {
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState<'' | AuditOutcome>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [actions, setActions] = useState<string[]>([]);
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AuditEvent | null>(null);

  useEffect(() => {
    auditApi.actions().then(setActions, () => setActions([]));
  }, []);

  // search as you type, after a short pause
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(typed.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(() => {
    setRows(null);
    auditApi
      .search({ page, pageSize: PAGE_SIZE, q: q || undefined, action: action || undefined, outcome: outcome || undefined, from: from || undefined, to: to || undefined })
      .then(
        r => {
          setRows(r.items);
          setTotal(r.total);
          setError(null);
        },
        e => {
          setError(errorMessage(e));
          setRows([]);
        }
      );
  }, [page, q, action, outcome, from, to]);
  useEffect(load, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reset = () => {
    setTyped('');
    setQ('');
    setAction('');
    setOutcome('');
    setFrom('');
    setTo('');
    setPage(1);
  };
  const filtered = !!(q || action || outcome || from || to);

  return (
    <div className="space-y-6">
      <PageTitle
        title="Security & Audit Logs"
        subtitle="Who did what, when, and whether it worked or was refused. Records cannot be edited or deleted."
        actions={
          <span className="inline-flex items-center gap-2 text-xs text-slate-600">
            <ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" /> Read-only
          </span>
        }
      />

      <Card label="Filters" className="p-4">
        <form
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
          onSubmit={e => {
            e.preventDefault();
            setQ(typed.trim());
            setPage(1);
          }}
        >
          <label className="lg:col-span-2">
            <span className="block text-xs font-semibold text-slate-600 mb-1">Search</span>
            <span className="relative block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
              <input className={`${fieldCls} pl-9`} value={typed} onChange={e => setTyped(e.target.value)} placeholder="Person, event or request id" maxLength={100} />
            </span>
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600 mb-1">Event type</span>
            <select
              className={fieldCls}
              value={action}
              onChange={e => {
                setAction(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All events</option>
              {actions.map(a => (
                <option key={a} value={a}>
                  {pretty(a)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600 mb-1">Outcome</span>
            <select
              className={fieldCls}
              value={outcome}
              onChange={e => {
                setOutcome(e.target.value as '' | AuditOutcome);
                setPage(1);
              }}
            >
              <option value="">All outcomes</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILURE">Failed</option>
              <option value="DENIED">Refused</option>
            </select>
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600 mb-1">From</span>
            <input
              type="date"
              className={fieldCls}
              value={from}
              max={to || todayIso()}
              onChange={e => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-600 mb-1">To</span>
            <input
              type="date"
              className={fieldCls}
              value={to}
              min={from || undefined}
              max={todayIso()}
              onChange={e => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </form>
        {filtered && (
          <div className="mt-3">
            <button type="button" className="text-[13px] font-bold text-blue-700 hover:text-blue-800" onClick={reset}>
              Clear filters
            </button>
          </div>
        )}
      </Card>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800">
          The log could not be loaded: {error}
        </div>
      )}

      <Card label="Events">
        {rows === null ? (
          <LoadingLine label="Loading events…" />
        ) : rows.length === 0 && !error ? (
          <p className="py-12 text-center text-sm text-slate-500" role="status">
            {filtered ? 'No event matches these filters.' : 'No events have been recorded yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[56rem]">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="py-2.5 pl-5 pr-3 font-semibold">When</th>
                  <th className="py-2.5 px-3 font-semibold">Who</th>
                  <th className="py-2.5 px-3 font-semibold">Event</th>
                  <th className="py-2.5 px-3 font-semibold">About</th>
                  <th className="py-2.5 px-3 font-semibold">Outcome</th>
                  <th className="py-2.5 pl-3 pr-5 font-semibold">Request</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 cursor-pointer" onClick={() => setOpen(r)}>
                    <td className="py-3 pl-5 pr-3 whitespace-nowrap text-slate-700">{when(r.at)}</td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{r.actor ? r.actor.replace(/\s*<[^>]*>/, '') : 'System or unknown'}</div>
                      <div className="text-xs text-slate-500">{[r.actorRole ? ROLE_LABEL[r.actorRole] ?? r.actorRole : null, r.department].filter(Boolean).join(' · ') || (r.ip ? `from ${r.ip}` : '')}</div>
                    </td>
                    <td className="py-3 px-3">
                      <button type="button" className="text-left font-semibold text-blue-700 hover:underline" onClick={e => { e.stopPropagation(); setOpen(r); }} aria-label={`Details of ${pretty(r.action)}`}>
                        {pretty(r.action)}
                      </button>
                    </td>
                    <td className="py-3 px-3 text-slate-600">
                      {r.entityType.replace(/_/g, ' ')}
                      {r.entityId && <span className="block text-xs font-mono text-slate-400">{r.entityId.slice(0, 8)}</span>}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${OUTCOME_CLS[r.outcome]}`}>{OUTCOME_LABEL[r.outcome]}</span>
                    </td>
                    <td className="py-3 pl-3 pr-5 font-mono text-xs text-slate-500">{r.requestId ? r.requestId.slice(0, 13) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-100 text-sm text-slate-600">
          <span>{total === 0 ? '0 events' : `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${new Intl.NumberFormat('en-IN').format(total)} events`}</span>
          <div className="flex items-center gap-2">
            <button type="button" className={`${ghostBtn} !h-9 !px-3`} disabled={page <= 1 || rows === null} onClick={() => setPage(p => p - 1)} aria-label="Previous page">
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="text-xs">Page {page} of {pages}</span>
            <button type="button" className={`${ghostBtn} !h-9 !px-3`} disabled={page >= pages || rows === null} onClick={() => setPage(p => p + 1)} aria-label="Next page">
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </Card>

      {open && <EventDetail event={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

const Field: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
  <div className="grid grid-cols-[8rem_1fr] gap-3 py-2 border-b border-slate-100 last:border-0">
    <dt className="text-xs font-semibold text-slate-500 pt-0.5">{k}</dt>
    <dd className="text-sm text-slate-900 break-words min-w-0">{children}</dd>
  </div>
);

const EventDetail: React.FC<{ event: AuditEvent; onClose: () => void }> = ({ event: e, onClose }) => {
  useEffect(() => {
    const onKey = (k: KeyboardEvent) => k.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const meta = Object.keys(e.metadata ?? {}).length ? JSON.stringify(e.metadata, null, 2) : null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Event details" className="w-full max-w-lg h-full bg-white shadow-2xl overflow-y-auto" onClick={ev => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-slate-900">{pretty(e.action)}</h2>
            <p className="text-xs font-mono text-slate-500 mt-0.5">{e.action}</p>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <dl className="px-6 py-3">
          <Field k="When">{when(e.at)}</Field>
          <Field k="Outcome">
            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${OUTCOME_CLS[e.outcome]}`}>{OUTCOME_LABEL[e.outcome]}</span>
          </Field>
          <Field k="Who">{e.actor ?? 'System or unknown'}</Field>
          <Field k="Role">{e.actorRole ? ROLE_LABEL[e.actorRole] ?? e.actorRole : '-'}</Field>
          <Field k="Department">{e.department ?? '-'}</Field>
          <Field k="About">
            {e.entityType.replace(/_/g, ' ')}
            {e.entityId && <span className="block font-mono text-xs text-slate-500">{e.entityId}</span>}
          </Field>
          <Field k="Request id">{e.requestId ? <span className="font-mono text-xs">{e.requestId}</span> : '-'}</Field>
          <Field k="Address">{e.ip ? <span className="font-mono text-xs">{e.ip}</span> : '-'}</Field>
          <Field k="Event number">{e.id}</Field>
        </dl>
        <div className="px-6 pb-8">
          <h3 className="text-xs font-semibold text-slate-500 mb-2">Details</h3>
          {meta ? <pre className="text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-words">{meta}</pre> : <p className="text-sm text-slate-500">No further details were recorded.</p>}
          <p className="mt-3 text-[11px] text-slate-500">Passwords, tokens and keys are never stored in an event.</p>
        </div>
      </aside>
    </div>
  );
};
