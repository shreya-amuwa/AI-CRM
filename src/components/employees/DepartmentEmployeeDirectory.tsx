import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import type { DepartmentDirectoryMember, DepartmentEmployeeDirectory, TeamAssignmentRecord } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { employeesApi } from '../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, inputCls, longDateTime, Pill, Spinner, type Tone } from '../team-member/pipeline/shared';

const STATE: Record<DepartmentDirectoryMember['state'], { label: string; tone: Tone }> = {
  AWAITING_ASSIGNMENT: { label: 'Awaiting a Team Lead', tone: 'orange' }, ASSIGNED: { label: 'Assigned', tone: 'green' }, INACTIVE: { label: 'Inactive', tone: 'slate' }
};

/**
 * Department Head: the department's approved employees and the Team Leads, and assigning a Team Member under a Team Lead. Approval already happened;
 * this is a separate step and creates no employee request. Reassigning keeps the earlier assignment in the history.
 */
export const DepartmentEmployeeDirectoryPanel: React.FC<{ departmentId?: string }> = ({ departmentId }) => {
  const [data, setData] = useState<DepartmentEmployeeDirectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | DepartmentDirectoryMember['state']>('ALL');
  const [assigning, setAssigning] = useState<DepartmentDirectoryMember | null>(null);
  const [history, setHistory] = useState<DepartmentDirectoryMember | null>(null);

  const load = useCallback(() => { employeesApi.directory(departmentId).then(d => { setData(d); setError(null); }, e => setError(errorMessage(e))); }, [departmentId]);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener('crm:employee-requests-changed', load);
    window.addEventListener('focus', load);
    return () => { window.removeEventListener('crm:employee-requests-changed', load); window.removeEventListener('focus', load); };
  }, [load]);

  const shown = useMemo(() => (data?.members ?? []).filter(m => filter === 'ALL' || m.state === filter), [data, filter]);
  const counts = useMemo(() => ({
    AWAITING_ASSIGNMENT: data?.members.filter(m => m.state === 'AWAITING_ASSIGNMENT').length ?? 0,
    ASSIGNED: data?.members.filter(m => m.state === 'ASSIGNED').length ?? 0,
    INACTIVE: data?.members.filter(m => m.state === 'INACTIVE').length ?? 0
  }), [data]);

  return (
    <section className="space-y-3" aria-label="Approved employees">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><Users className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Approved employees{data?.department ? `: ${data.department.name}` : ''}</h2>
          <p className="text-xs text-slate-500">Employees you or HR had approved. Put each Team Member under a Team Lead. People still waiting for approval are under Employee Approvals.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium" value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Show">
            <option value="ALL">All ({data?.members.length ?? 0})</option>
            <option value="AWAITING_ASSIGNMENT">Awaiting a Team Lead ({counts.AWAITING_ASSIGNMENT})</option>
            <option value="ASSIGNED">Assigned ({counts.ASSIGNED})</option>
            <option value="INACTIVE">Inactive ({counts.INACTIVE})</option>
          </select>
          <button type="button" className={btn.secondary} onClick={load}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh</button>
        </div>
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && <Spinner label="Loading employees…" />}
      {data && shown.length === 0 && <p className="text-sm text-slate-500 bg-white rounded-2xl border border-slate-200/80 p-6 text-center">No employees in this view.</p>}
      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map(m => (
            <li key={m.id} className="bg-white rounded-2xl border border-slate-200/80 p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[14rem]">
                <div className="font-bold text-slate-900 text-sm">{m.name}</div>
                <div className="text-xs text-slate-500 break-all">{m.email}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{m.state === 'AWAITING_ASSIGNMENT' ? 'Not under a Team Lead yet' : `Team: ${m.team.name}${m.lead ? ` · Team Lead: ${m.lead.name}` : ''}`}{m.lastAssignment ? ` · ${m.lastAssignment.kind.toLowerCase()} ${longDateTime(m.lastAssignment.at)}` : ''}</div>
              </div>
              <Pill tone={STATE[m.state].tone}>{STATE[m.state].label}</Pill>
              <button type="button" className={btn.secondary} onClick={() => setHistory(m)}>History</button>
              {m.state !== 'INACTIVE' && <button type="button" className={btn.primary} onClick={() => setAssigning(m)}>{m.state === 'AWAITING_ASSIGNMENT' ? 'Assign to Team Lead' : 'Change Team Lead'}</button>}
            </li>
          ))}
        </ul>
      )}
      {assigning && data && <AssignDialog member={assigning} leads={data.leads} onClose={() => setAssigning(null)} onDone={() => { setAssigning(null); window.dispatchEvent(new Event('crm:employee-requests-changed')); load(); }} />}
      {history && <HistoryDialog member={history} onClose={() => setHistory(null)} />}
    </section>
  );
};

const AssignDialog: React.FC<{ member: DepartmentDirectoryMember; leads: DepartmentEmployeeDirectory['leads']; onClose: () => void; onDone: () => void }> = ({ member, leads, onClose, onDone }) => {
  const options = leads.filter(l => l.status === 'ACTIVE' && l.id !== member.lead?.id);
  const [leadId, setLeadId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!leadId) return setError('Choose a Team Lead.');
    setBusy(true); setError(null);
    try { await employeesApi.assignToLead(member.id, { leadId, note: note.trim() || undefined }); onDone(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={`Assign ${member.name}`} description="They move into the Team Lead's team. This is not a new approval." onClose={onClose}>
      <label className="block text-xs font-semibold text-slate-700">Team Lead
        <select className={`${inputCls} mt-1`} value={leadId} onChange={e => setLeadId(e.target.value)}>
          <option value="">Choose a Team Lead</option>
          {options.map(l => <option key={l.id} value={l.id}>{l.name} · {l.team.name} ({l.members})</option>)}
        </select>
      </label>
      {options.length === 0 && <p className="text-xs text-amber-700">There is no other active Team Lead in this department. Ask HR for one.</p>}
      <label className="block text-xs font-semibold text-slate-700">Note (optional)<textarea rows={2} maxLength={500} className={`${inputCls} mt-1`} value={note} onChange={e => setNote(e.target.value)} /></label>
      {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btn.primary} onClick={save} disabled={busy || options.length === 0}>{busy ? 'Saving…' : 'Assign'}</button>
      </div>
    </Dialog>
  );
};

const HistoryDialog: React.FC<{ member: DepartmentDirectoryMember; onClose: () => void }> = ({ member, onClose }) => {
  const [rows, setRows] = useState<TeamAssignmentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { employeesApi.assignments(member.id).then(setRows, e => setError(errorMessage(e))); }, [member.id]);
  return (
    <Dialog title={`${member.name}: team history`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <p className="text-sm text-slate-500">No history yet.</p>}
      {rows && <ul className="space-y-1">{rows.map(r => <li key={r.id} className="text-xs text-slate-700 border-b border-slate-100 py-1">{r.kind.toLowerCase()}: {r.fromTeam ? `${r.fromTeam} → ` : ''}{r.toTeam}{r.lead ? ` (Team Lead ${r.lead})` : ''}{r.assignedBy ? ` · by ${r.assignedBy}` : ''} · {longDateTime(r.createdAt)}{r.note ? ` · ${r.note}` : ''}</li>)}</ul>}
      <div className="flex justify-end"><button type="button" className={btn.secondary} onClick={onClose}>Close</button></div>
    </Dialog>
  );
};
