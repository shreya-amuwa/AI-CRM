import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Building2, History, RefreshCw } from 'lucide-react';
import type { OperationsActivityEntry, OperationsFunction, OperationsHeadAdmin, OperationsHeadsAdmin, WeeklyRoutingItem } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { employeesApi, usersApi } from '../../lib/api/endpoints';
import { weeklyReportsApi } from '../../lib/api/workReports';
import { btn, Dialog, ErrorBanner, longDateTime, Pill, Spinner } from '../team-member/pipeline/shared';
import { confirmAction } from '../feedback/AppFeedback';

/**
 * Super Admin: the Operations Heads, the departments each manages (a multi-select, stored as proper relations) and the ONE Operations Head accountable
 * for approving the Department Heads of each department. Only the Super Admin can change any of it; the database refuses everybody else.
 */
export const OperationsHeadsAdminPanel: React.FC = () => {
  const [data, setData] = useState<OperationsHeadsAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OperationsHeadAdmin | null>(null);
  const [history, setHistory] = useState<OperationsHeadAdmin | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  // the weekly reports with no eligible Operations Head (department and function), so they can be assigned here before a head is blocked
  const [routing, setRouting] = useState<WeeklyRoutingItem[] | null>(null);
  const load = useCallback(() => {
    employeesApi.operationsHeads().then(d => { setData(d); setError(null); }, e => setError(errorMessage(e)));
    weeklyReportsApi.routing().then(setRouting, () => setRouting(null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener('crm:employee-requests-changed', load);
    window.addEventListener('focus', load);
    return () => { window.removeEventListener('crm:employee-requests-changed', load); window.removeEventListener('focus', load); };
  }, [load]);

  // Suspending takes the access away at once (the sign-in is blocked and the person supervises nothing); reactivating gives the same departments back.
  const toggleStatus = async (h: OperationsHeadAdmin) => {
    const next = h.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (next === 'SUSPENDED' && !(await confirmAction({
      title: `Suspend ${h.name}?`,
      description: 'They cannot sign in until you reactivate them. Their departments, Department Heads and records stay as they are.',
      confirmLabel: 'Suspend CEO', cancelLabel: 'Keep active', variant: 'destructive'
    }))) return;
    setNotice(null);
    try {
      await usersApi.setStatus(h.id, next, next === 'SUSPENDED' ? 'Suspended from CEOs' : undefined);
      setNotice({ text: `${h.name} is now ${next === 'ACTIVE' ? 'active' : 'suspended'}.`, ok: true });
      load();
    } catch (e) {
      setNotice({ text: errorMessage(e), ok: false });
    }
  };

  return (
    <section className="space-y-4" aria-label="CEOs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-600" aria-hidden="true" /> CEOs</h2>
          <p className="text-xs text-slate-500">Choose the departments each CEO manages, and who approves the Department Heads of each. Create one with Add Team Member (any departments, even ones that already have a Department Head), or approve one HR asks for under Employee Approvals.</p>
        </div>
        <button type="button" className={btn.secondary} onClick={load}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh</button>
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <p role="status" className={`text-xs font-semibold ${notice.ok ? 'text-emerald-800' : 'text-rose-700'}`} data-testid="operations-notice">{notice.text}</p>}
      {!data && !error && <Spinner label="Loading CEOs…" />}
      {routing && routing.some(r => r.issue === 'MISSING' || r.issue === 'INACTIVE') && (
        <div role="status" data-testid="weekly-routing" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <div>
            <b>Departments with no CEO (their weekly report goes directly to HR):</b>
            <ul className="mt-1 list-disc pl-4">
              {routing.filter(r => r.issue === 'MISSING' || r.issue === 'INACTIVE').map(r => (
                <li key={`${r.departmentId}:${r.function}`}>
                  {r.department} - {r.function === 'ALL' ? 'whole department' : r.function === 'SALES' ? 'Sales' : 'Support'}
                  {r.departmentHeads.length ? ` (Department Head: ${r.departmentHeads.map(h => h.name).join(', ')})` : ''}
                  {r.issue === 'INACTIVE' ? ': the CEO named for it is not active' : ': none assigned'}
                </li>
              ))}
            </ul>
            Choose the departments of the right CEO below (with &quot;approves heads&quot; for that function). Until then the Department Heads of those departments send their weekly report directly to HR.
          </div>
        </div>
      )}
      {data && data.unowned.length > 0 && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <div>
            <b>No accountable CEO:</b> {data.unowned.map(u => `${u.name}${u.pendingRequests ? ` (${u.pendingRequests} request${u.pendingRequests === 1 ? '' : 's'} waiting)` : ''}`).join(', ')}.
            A Department Head request for these departments stays pending until you assign one.
          </div>
        </div>
      )}
      {data && data.heads.length === 0 && <p className="text-sm text-slate-500 bg-white rounded-2xl border border-slate-200/80 p-6 text-center">There is no CEO yet. HR submits one; you approve it.</p>}
      {data && data.heads.length > 0 && (
        <ul className="space-y-2">
          {data.heads.map(h => (
            <li key={h.id} className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[14rem]">
                  <div className="font-bold text-slate-900 text-sm">{h.name} {h.status !== 'ACTIVE' && <Pill tone="red">{h.status.toLowerCase()}</Pill>}</div>
                  <div className="text-xs text-slate-500 break-all">{h.email} · home: {h.homeDepartment?.name ?? '-'}{h.lastLoginAt ? ` · last sign-in ${longDateTime(h.lastLoginAt)}` : ''}</div>
                  {h.function !== undefined && <div className="text-xs font-semibold text-blue-800" data-testid={`operations-function-${h.id}`}>{FUNCTION_LABEL[h.function ?? 'BOTH']}</div>}
                </div>
                {h.pendingApprovals > 0 && <Pill tone="orange">{h.pendingApprovals} waiting</Pill>}
                <button type="button" className={btn.secondary} onClick={() => setHistory(h)}><History className="w-3.5 h-3.5" aria-hidden="true" /> Activity</button>
                <button type="button" className={btn.secondary} onClick={() => void toggleStatus(h)} data-testid={`operations-status-${h.id}`}>{h.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</button>
                <button type="button" className={btn.primary} onClick={() => setEditing(h)}>Edit departments</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {h.departments.length === 0 && <span className="text-xs text-slate-500">No department assigned.</span>}
                {h.departments.map(d => <span key={d.id} className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${d.primary ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`} title={d.primary ? 'Approves Department Heads of this department' : 'Oversees this department'}>{d.name}{d.function !== undefined ? ` · ${sideLabel(d.function)}` : ''}{d.primary ? ' · approves heads' : ''}</span>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && data && <ScopeDialog head={editing} all={data.departments} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); window.dispatchEvent(new Event('crm:employee-requests-changed')); load(); }} />}
      {history && <ActivityDialog head={history} onClose={() => setHistory(null)} />}
    </section>
  );
};

/** How an operations function is called on screen. */
export const FUNCTION_LABEL: Record<'SALES' | 'SUPPORT' | 'BOTH', string> = { SALES: 'Sales CEO', SUPPORT: 'Support CEO', BOTH: 'Sales & Support CEO' };
const sideLabel = (f: OperationsFunction | undefined) => (f === 'SALES' ? 'Sales' : f === 'SUPPORT' ? 'Support' : 'Sales & Support');

const ScopeDialog: React.FC<{ head: OperationsHeadAdmin; all: OperationsHeadsAdmin['departments']; onClose: () => void; onSaved: () => void }> = ({ head, all, onClose, onSaved }) => {
  const [scope, setScope] = useState<string[]>(head.departments.map(d => d.id));
  const [primary, setPrimary] = useState<string[]>(head.departments.filter(d => d.primary).map(d => d.id));
  // the operations function (Sales / Support / both) and an optional narrower side per department; absent on a database without 20261224000100
  const functional = head.function !== undefined;
  const [fn, setFn] = useState<OperationsFunction>(head.function ?? null);
  const [narrow, setNarrow] = useState<Record<string, OperationsFunction>>(Object.fromEntries(head.departments.map(d => [d.id, d.narrowed ?? null])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (functional) {
        await employeesApi.applyScope(head.id, {
          function: fn,
          departments: scope.map(id => ({ departmentId: id, division: fn ? null : narrow[id] ?? null, primary: primary.includes(id) }))
        });
      } else {
        await employeesApi.setScope(head.id, { departmentIds: scope, primaryDepartmentIds: primary.filter(p => scope.includes(p)) });
      }
      onSaved();
    }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={`Departments managed by ${head.name}`} description="Removing a department takes it off their dashboard at once; what they already approved stays in the history." onClose={onClose} wide>
      {functional && (
        <label className="block text-xs font-semibold text-slate-700">
          Operations function
          <select className="mt-1 block w-full sm:w-80 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={fn ?? 'BOTH'} onChange={e => setFn(e.target.value === 'BOTH' ? null : (e.target.value as 'SALES' | 'SUPPORT'))} data-testid="operations-function-select">
            <option value="SUPPORT">{FUNCTION_LABEL.SUPPORT}: the Support side of each department</option>
            <option value="SALES">{FUNCTION_LABEL.SALES}: the Sales side of each department</option>
            <option value="BOTH">{FUNCTION_LABEL.BOTH}: both sides, where assigned</option>
          </select>
          <span className="block mt-1 font-normal text-slate-500">They see and manage only this side: customers, people, tasks, reports, approvals and counts of the other side are not shown to them.</span>
        </label>
      )}
      <div className="grid sm:grid-cols-2 gap-1 max-h-72 overflow-y-auto">
        {all.map(d => {
          const otherOwner = d.owner && d.owner.id !== head.id ? d.owner.name : null;
          return (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs">
              <label className="flex items-center gap-2"><input type="checkbox" checked={scope.includes(d.id)} onChange={() => { setScope(flip(scope, d.id)); if (scope.includes(d.id)) setPrimary(primary.filter(p => p !== d.id)); }} /> {d.name}</label>
              <label className="flex items-center gap-1 text-[11px] text-slate-500" title={otherOwner ? `Now approved by ${otherOwner}` : undefined}>
                <input type="checkbox" disabled={!scope.includes(d.id)} checked={primary.includes(d.id)} onChange={() => setPrimary(flip(primary, d.id))} /> approves {fn ? sideLabel(fn) : ''} heads{otherOwner ? ` (now ${otherOwner})` : ''}
              </label>
              {functional && fn === null && scope.includes(d.id) && (
                <select aria-label={`Side of ${d.name}`} className="rounded border border-slate-300 px-1 py-0.5 text-[11px]" value={narrow[d.id] ?? 'BOTH'}
                  onChange={e => setNarrow({ ...narrow, [d.id]: e.target.value === 'BOTH' ? null : (e.target.value as 'SALES' | 'SUPPORT') })}>
                  <option value="BOTH">Both sides</option><option value="SALES">Sales only</option><option value="SUPPORT">Support only</option>
                </select>
              )}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btn.primary} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save departments'}</button>
      </div>
    </Dialog>
  );
};

const ActivityDialog: React.FC<{ head: OperationsHeadAdmin; onClose: () => void }> = ({ head, onClose }) => {
  const [rows, setRows] = useState<OperationsActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { employeesApi.headActivity(head.id).then(setRows, e => setError(errorMessage(e))); }, [head.id]);
  return (
    <Dialog title={`${head.name}: activity`} description="Approvals they made and changes to their departments." onClose={onClose} wide>
      {error && <ErrorBanner message={error} />}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <p className="text-sm text-slate-500">Nothing recorded yet.</p>}
      {rows && rows.length > 0 && <ul className="space-y-1 max-h-72 overflow-y-auto">{rows.map((a, i) => <li key={i} className="text-xs text-slate-700 flex justify-between gap-3 border-b border-slate-100 py-1"><span>{(a.action ?? a.type ?? '').replace(/_/g, ' ').toLowerCase()} · {a.reference}{a.department ? ` · ${a.department}` : ''}{a.by ? ` · by ${a.by}` : ''}</span><span className="text-slate-500 whitespace-nowrap">{longDateTime(a.at)}</span></li>)}</ul>}
      <div className="flex justify-end"><button type="button" className={btn.secondary} onClick={onClose}>Close</button></div>
    </Dialog>
  );
};
