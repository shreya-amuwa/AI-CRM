import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import type { EmployeeRequest } from '../../../shared/contracts';
import { useDepartments } from '../../context/DepartmentContext';
import { errorMessage } from '../../lib/api/client';
import { employeesApi } from '../../lib/api/endpoints';
import { getSupabase } from '../../services/supabaseClient';
import { btn, Dialog, ErrorBanner, inputCls, longDate, Pill, Spinner, type Tone } from '../team-member/pipeline/shared';
import { APPROVER_LABEL, ROLE_LABEL } from './EmployeeRequestForm';
import type { EmployeeRequestRole } from '../../../shared/validation';

const STATUS_TONE: Record<EmployeeRequest['status'], Tone> = { PENDING: 'orange', APPROVED: 'green', REJECTED: 'red' };

/** Refresh when a request changes (Realtime), when something in this tab changes, or when the tab is focused again. No timer. */
function useRequestsLive(onChange: () => void) {
  useEffect(() => {
    const supabase = getSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 250); };
    const channel = supabase?.channel(`employee-requests-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_requests' }, fire).subscribe();
    window.addEventListener('crm:employee-requests-changed', fire);
    window.addEventListener('focus', fire);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('crm:employee-requests-changed', fire);
      window.removeEventListener('focus', fire);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [onChange]);
}

/**
 * Employee requests. `hr`: every request HR submitted, with its status, and a way to correct and send a rejected one again. `approver`: the requests the
 * signed-in person may decide (the database says which), with Approve and Reject (a reason is required). `scope` narrows an approver list to one kind.
 */
export const EmployeeRequestsPanel: React.FC<{ view: 'hr' | 'approver'; title?: string; only?: EmployeeRequestRole }> = ({ view, title, only }) => {
  const { departments } = useDepartments();
  const [rows, setRows] = useState<EmployeeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'WAITING' | 'ALL'>(view === 'approver' ? 'WAITING' : 'ALL');
  const [open, setOpen] = useState<EmployeeRequest | null>(null);
  const [decision, setDecision] = useState<{ request: EmployeeRequest; approve: boolean } | null>(null);
  const [resubmitFor, setResubmitFor] = useState<EmployeeRequest | null>(null);

  const load = useCallback(() => {
    employeesApi.list({ toDecide: view === 'approver' && filter === 'WAITING' ? true : undefined }).then(
      r => { setRows(r); setError(null); },
      e => setError(errorMessage(e))
    );
  }, [view, filter]);
  useEffect(load, [load]);
  useRequestsLive(load);

  const shown = useMemo(() => (rows ?? []).filter(r => !only || r.requestedRole === only), [rows, only]);
  const changed = () => { window.dispatchEvent(new Event('crm:employee-requests-changed')); load(); };

  return (
    <section className="space-y-3" aria-label={title ?? 'Employee requests'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">{title ?? (view === 'hr' ? 'Employee requests' : 'Employee approvals')}</h2>
          <p className="text-xs text-slate-500">{view === 'hr' ? 'Every employee you asked for, and where it stands.' : 'Employees waiting for your decision. They get access only after you approve.'}</p>
        </div>
        <div className="flex items-center gap-2">
          {view === 'approver' && (
            <select className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium" value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Show">
              <option value="WAITING">Waiting for me</option><option value="ALL">All I can see</option>
            </select>
          )}
          <button type="button" className={btn.secondary} onClick={load}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh</button>
        </div>
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!rows && !error && <Spinner label="Loading requests…" />}
      {rows && shown.length === 0 && <p className="text-sm text-slate-500 bg-white rounded-2xl border border-slate-200/80 p-6 text-center">{view === 'approver' && filter === 'WAITING' ? 'Nothing is waiting for you.' : 'No requests yet.'}</p>}
      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map(r => (
            <li key={r.id} className="bg-white rounded-2xl border border-slate-200/80 p-4 flex flex-wrap items-center gap-3">
              <button type="button" className="flex-1 min-w-[14rem] text-left" onClick={() => setOpen(r)}>
                <div className="font-bold text-slate-900 text-sm">{r.employee?.name ?? 'Employee'}</div>
                <div className="text-xs text-slate-500 break-all">{r.employee?.email}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{ROLE_LABEL[r.requestedRole as EmployeeRequestRole]} · {r.department?.name ?? '-'}{r.division ? ` · ${r.division.toLowerCase()}` : ''} · sent {longDate(r.submittedAt)} by {r.submittedBy?.name ?? '-'}</div>
              </button>
              <div className="flex flex-col items-end gap-1">
                <Pill tone={STATUS_TONE[r.status]}>{r.status === 'PENDING' ? (r.awaitingOwner ? 'Waiting for an owner' : 'Pending') : r.status === 'APPROVED' ? 'Approved' : 'Rejected'}</Pill>
                {r.attempt > 1 && <span className="text-[10px] text-slate-500">Attempt {r.attempt}</span>}
              </div>
              <div className="flex items-center gap-2">
                {view === 'approver' && r.canDecide && (
                  <>
                    <button type="button" className={btn.green} onClick={() => setDecision({ request: r, approve: true })}><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Approve</button>
                    <button type="button" className={btn.secondary} onClick={() => setDecision({ request: r, approve: false })}><XCircle className="w-3.5 h-3.5" aria-hidden="true" /> Reject</button>
                  </>
                )}
                {view === 'hr' && r.status === 'REJECTED' && !shown.some(o => o.employee?.id === r.employee?.id && o.attempt > r.attempt) && (
                  <button type="button" className={btn.primary} onClick={() => setResubmitFor(r)}>Correct and resend</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && <RequestDetails id={open.id} fallback={open} onClose={() => setOpen(null)} />}
      {decision && <DecisionDialog request={decision.request} approve={decision.approve} departments={departments.filter(d => d.dbId).map(d => ({ id: d.dbId!, name: d.name }))} onClose={() => setDecision(null)} onDone={() => { setDecision(null); changed(); }} />}
      {resubmitFor && <ResubmitDialog request={resubmitFor} departments={departments.filter(d => d.dbId).map(d => ({ id: d.dbId!, name: d.name }))} onClose={() => setResubmitFor(null)} onDone={() => { setResubmitFor(null); changed(); }} />}
    </section>
  );
};

const RequestDetails: React.FC<{ id: string; fallback: EmployeeRequest; onClose: () => void }> = ({ id, fallback, onClose }) => {
  const [r, setR] = useState<EmployeeRequest>(fallback);
  useEffect(() => { employeesApi.get(id).then(setR, () => undefined); }, [id]);
  const row = (k: string, v: React.ReactNode) => (<div className="flex justify-between gap-4 text-xs py-1 border-b border-slate-100"><span className="text-slate-500">{k}</span><span className="font-semibold text-slate-800 text-right break-all">{v ?? '-'}</span></div>);
  return (
    <Dialog title={r.employee?.name ?? 'Employee'} description={`${ROLE_LABEL[r.requestedRole as EmployeeRequestRole]} request`} onClose={onClose}>
      <div>
        {row('E-mail', r.employee?.email)}{row('Contact number', r.employee?.contactNumber)}{row('Employee ID', r.employee?.employeeCode)}
        {row('Designation', r.employee?.designation)}{row('Department', r.department?.name)}{row('Joining date', longDate(r.employee?.joiningDate))}
        {row('Submitted by', r.submittedBy?.name)}{row('Submitted', longDate(r.submittedAt))}
        {row('Approver', r.approver?.name ?? (r.awaitingOwner ? 'Nobody owns this department yet' : APPROVER_LABEL[r.requestedRole as EmployeeRequestRole]))}
        {row('Status', r.status)}{r.decidedBy && row('Decided by', `${r.decidedBy.name}, ${longDate(r.decidedAt)}`)}{r.decisionNote && row('Reason / note', r.decisionNote)}
      </div>
      {r.history && r.history.length > 1 && (
        <div>
          <p className="text-xs font-bold text-slate-700 mb-1">Earlier attempts</p>
          <ul className="space-y-1">{r.history.map(h => <li key={h.id} className="text-xs text-slate-600">Attempt {h.attempt}: {h.status.toLowerCase()}{h.decidedBy ? ` by ${h.decidedBy}` : ''}{h.decisionNote ? ` - ${h.decisionNote}` : ''}</li>)}</ul>
        </div>
      )}
      <div className="flex justify-end"><button type="button" className={btn.secondary} onClick={onClose}>Close</button></div>
    </Dialog>
  );
};

const DecisionDialog: React.FC<{ request: EmployeeRequest; approve: boolean; departments: { id: string; name: string }[]; onClose: () => void; onDone: () => void }> = ({ request, approve, departments, onClose, onDone }) => {
  const isOperationsHead = request.requestedRole === 'OPERATIONS_HEAD';
  const [note, setNote] = useState('');
  const [scope, setScope] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const send = async () => {
    if (!approve && note.trim().length < 3) return setError('Give the reason for rejecting.');
    setBusy(true); setError(null);
    try {
      await employeesApi.decide(request.id, { approve, note: note.trim() || undefined, ...(approve && isOperationsHead ? { departmentIds: scope, primaryDepartmentIds: primary.filter(p => scope.includes(p)) } : {}) });
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={approve ? `Approve ${request.employee?.name}?` : `Reject ${request.employee?.name}?`} description={approve ? 'The account becomes active when you approve.' : 'The account stays inactive and HR is told why.'} onClose={onClose} wide={approve && isOperationsHead}>
      {approve && isOperationsHead && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold text-slate-700">Departments managed by this Operations Head</legend>
          <p className="text-[11px] text-slate-500">Tick the departments they oversee. "Approves Department Heads" makes them the one accountable Operations Head of that department. You can change this later.</p>
          <div className="grid sm:grid-cols-2 gap-1 max-h-64 overflow-y-auto">
            {departments.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs">
                <label className="flex items-center gap-2"><input type="checkbox" checked={scope.includes(d.id)} onChange={() => toggle(scope, setScope, d.id)} /> {d.name}</label>
                <label className="flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" disabled={!scope.includes(d.id)} checked={primary.includes(d.id)} onChange={() => toggle(primary, setPrimary, d.id)} /> approves heads</label>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <label className="block text-xs font-semibold text-slate-700">{approve ? 'Note (optional)' : 'Reason (required)'}
        <textarea rows={3} maxLength={500} className={`${inputCls} mt-1`} value={note} onChange={e => setNote(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={approve ? btn.green : btn.primary} onClick={send} disabled={busy}>{busy ? 'Saving…' : approve ? 'Approve' : 'Reject'}</button>
      </div>
    </Dialog>
  );
};

const ResubmitDialog: React.FC<{ request: EmployeeRequest; departments: { id: string; name: string }[]; onClose: () => void; onDone: () => void }> = ({ request, departments, onClose, onDone }) => {
  const [role, setRole] = useState<EmployeeRequestRole>(request.requestedRole as EmployeeRequestRole);
  const [departmentId, setDepartmentId] = useState(request.department?.id ?? '');
  const [division, setDivision] = useState(request.division ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setError(null);
    try {
      await employeesApi.resubmit(request.id, { role, departmentId, division: division || undefined });
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={`Send ${request.employee?.name} again`} description={request.decisionNote ? `Rejected: ${request.decisionNote}` : 'Correct the request and send it again. The earlier attempt stays in the history.'} onClose={onClose}>
      <label className="block text-xs font-semibold text-slate-700">Designation
        <select className={`${inputCls} mt-1`} value={role} onChange={e => setRole(e.target.value as EmployeeRequestRole)}>{(Object.keys(ROLE_LABEL) as EmployeeRequestRole[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
      </label>
      <label className="block text-xs font-semibold text-slate-700">Department
        <select className={`${inputCls} mt-1`} value={departmentId} onChange={e => setDepartmentId(e.target.value)}>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </label>
      {role !== 'OPERATIONS_HEAD' && (
        <label className="block text-xs font-semibold text-slate-700">Side
          <select className={`${inputCls} mt-1`} value={division} onChange={e => setDivision(e.target.value as typeof division)}><option value="">Not specified</option><option value="SALES">Sales</option><option value="SUPPORT">Support</option><option value="GENERAL">General</option></select>
        </label>
      )}
      {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btn.primary} onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send again'}</button>
      </div>
    </Dialog>
  );
};
