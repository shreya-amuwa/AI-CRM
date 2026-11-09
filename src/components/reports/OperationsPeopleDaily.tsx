import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { OperationsPeopleDaily as PeopleData } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { Card, ErrorBanner, inputCls, Spinner } from '../team-member/pipeline/shared';
import { dateLabel } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const KIND: Record<string, string> = { DEPARTMENT_HEAD: 'Department Head', TEAM_LEAD: 'Team Lead', MEMBER: 'Team Member' };
const STAGE: Record<string, string> = { APPROVED: 'Approved', PENDING: 'Waiting', REJECTED: 'Rejected', REVISION_REQUIRED: 'Revision' };
type StatusFilter = 'all' | 'approved' | 'pending' | 'revision' | 'missing';

/**
 * Operations Head (and Super Admin): Department -> Team Lead -> Team Member -> daily reports and tasks, for a chosen period. Read-only: the
 * Team Lead and Department Head approvals are shown, never replaced. Only submitted reports appear (drafts stay private), and only the people of the
 * department and function the Operations Head supervises (the database decides).
 */
export const OperationsPeopleDaily: React.FC<{ departments: { id: string; name: string }[]; defaultFrom: string; defaultTo: string; onOpen: (id: string) => void }> = ({ departments, defaultFrom, defaultTo, onOpen }) => {
  const [dept, setDept] = useState(departments[0]?.id ?? '');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [data, setData] = useState<PeopleData | null>(null);
  const [error, setError] = useState('');
  const [find, setFind] = useState('');
  const [lead, setLead] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  useEffect(() => { if (!departments.some(d => d.id === dept)) setDept(departments[0]?.id ?? ''); }, [departments, dept]);
  useEffect(() => { setFrom(defaultFrom); setTo(defaultTo); }, [defaultFrom, defaultTo]);

  const load = useCallback(() => {
    if (!dept || !from || !to) return;
    setData(null);
    workReportsApi.operationsPeople(dept, from, to).then(d => { setError(''); setData(d); }, e => setError(errText(e)));
  }, [dept, from, to]);
  useEffect(load, [load]);

  const leads = useMemo(() => (data?.people ?? []).filter(p => p.kind === 'TEAM_LEAD'), [data]);
  const shown = useMemo(() => (data?.people ?? []).filter(p => {
    if (find.trim() && !p.name.toLowerCase().includes(find.trim().toLowerCase())) return false;
    if (lead && !(p.id === lead || p.teamLeadId === lead)) return false;
    if (status === 'approved') return p.reports.some(r => r.status === 'APPROVED');
    if (status === 'pending') return p.reports.some(r => ['SUBMITTED', 'UNDER_REVIEW', 'PENDING_DEPARTMENT_HEAD'].includes(r.status));
    if (status === 'revision') return p.reports.some(r => r.status === 'REVISION_REQUIRED' || r.status === 'REJECTED');
    if (status === 'missing') return p.reports.length === 0;
    return true;
  }), [data, find, lead, status]);

  if (!departments.length) return null;
  return (
    <Card className="p-5">
      <div className="mb-3">
        <h2 className="text-base font-bold text-slate-900">People and daily reports</h2>
        <p className="text-xs text-slate-500">Each person's daily reports and tasks in the period, with both approvals. Read only.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-xs font-semibold text-slate-600">Department
          <select className={`${inputCls} !py-1.5 mt-1`} value={dept} onChange={e => setDept(e.target.value)} data-testid="ppl-dept">
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">From<input type="date" className={`${inputCls} !py-1.5 mt-1`} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs font-semibold text-slate-600">To<input type="date" className={`${inputCls} !py-1.5 mt-1`} value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <label className="text-xs font-semibold text-slate-600">Team Lead
          <select className={`${inputCls} !py-1.5 mt-1`} value={lead} onChange={e => setLead(e.target.value)}>
            <option value="">All</option>
            {leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">Reports
          <select className={`${inputCls} !py-1.5 mt-1`} value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>
            <option value="all">All</option><option value="approved">Has approved</option><option value="pending">Waiting for approval</option>
            <option value="revision">Revision / rejected</option><option value="missing">No report</option>
          </select>
        </label>
        <input className={`${inputCls} !w-44 !py-1.5`} placeholder="Search employee" aria-label="Search employee" value={find} onChange={e => setFind(e.target.value)} />
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? (
        shown.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Nobody matches.</p> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-xs" data-testid="ppl-table">
              <caption className="sr-only">{data.department} people from {dateLabel(data.from)} to {dateLabel(data.to)}</caption>
              <thead className="bg-slate-50 text-slate-500"><tr>{['Person', 'Team Lead', 'Tasks assigned', 'Completed', 'Pending', 'Overdue', 'Daily reports'].map(h => <th key={h} scope="col" className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(p => (
                  <tr key={p.id} className="align-top">
                    <th scope="row" className="px-3 py-2 text-left"><span className="font-semibold text-slate-800">{p.name}</span><span className="block text-[11px] font-normal text-slate-500">{KIND[p.kind]}{p.team ? ` · ${p.team}` : ''}</span></th>
                    <td className="px-3 py-2">{p.teamLead ?? '-'}</td>
                    <td className="px-3 py-2 tabular-nums">{p.tasks.assigned}</td>
                    <td className="px-3 py-2 tabular-nums">{p.tasks.completed}</td>
                    <td className="px-3 py-2 tabular-nums">{p.tasks.pending}</td>
                    <td className={`px-3 py-2 tabular-nums ${p.tasks.overdue ? 'text-rose-700 font-semibold' : ''}`}>{p.tasks.overdue}</td>
                    <td className="px-3 py-2">
                      {p.reports.length === 0 ? <span className="text-slate-400">None</span> : (
                        <ul className="space-y-1">
                          {p.reports.slice(0, 7).map(r => (
                            <li key={r.id}>
                              <button type="button" className="text-left text-blue-700 hover:underline" onClick={() => onOpen(r.id)}>{dateLabel(r.date)}</button>
                              <span className="ml-1 text-slate-500">{r.status.replace(/_/g, ' ').toLowerCase()}
                                {r.teamLeadStatus ? ` · TL: ${STAGE[r.teamLeadStatus] ?? r.teamLeadStatus}` : ''}{r.departmentHeadStatus ? ` · DH: ${STAGE[r.departmentHeadStatus] ?? r.departmentHeadStatus}` : ''}</span>
                            </li>
                          ))}
                          {p.reports.length > 7 ? <li className="text-slate-400">+{p.reports.length - 7} more</li> : null}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </Card>
  );
};
