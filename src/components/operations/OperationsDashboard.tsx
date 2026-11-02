import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Building2, ChevronRight, RefreshCw, Users } from 'lucide-react';
import type { OperationsActivityEntry, OperationsDashboard as Dashboard, OperationsDashboardDepartment, OperationsDepartmentDetail } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { employeesApi } from '../../lib/api/endpoints';
import { EmployeeRequestsPanel } from '../employees/EmployeeRequestsPanel';
import { btn, ErrorBanner, longDateTime, Pill, Spinner } from '../team-member/pipeline/shared';

const Card: React.FC<{ label: string; value: number; hint?: string }> = ({ label, value, hint }) => (
  <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className="text-2xl font-extrabold text-slate-900 mt-1">{value}</div>
    {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
  </div>
);

/**
 * Operations Head dashboard: the departments the Super Admin assigned, each with its Department Heads, people and pending work, the Department Heads'
 * recent activity, and the Department Head requests this person approves. Everything comes from the database already scoped to those departments;
 * nothing here is company wide and nothing is made up.
 */
export const OperationsDashboard: React.FC = () => {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OperationsDashboardDepartment | null>(null);

  const load = useCallback(() => { employeesApi.dashboard().then(d => { setData(d); setError(null); }, e => setError(errorMessage(e))); }, []);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener('crm:employee-requests-changed', load);
    window.addEventListener('crm:pipeline-changed', load);
    window.addEventListener('focus', load);
    return () => { window.removeEventListener('crm:employee-requests-changed', load); window.removeEventListener('crm:pipeline-changed', load); window.removeEventListener('focus', load); };
  }, [load]);

  // Department filter: "all my departments" is the consolidated view; one department narrows the figures and opens its management view.
  const [filterId, setFilterId] = useState('');
  const shown = (data?.departments ?? []).filter(d => !filterId || d.id === filterId);
  const sum = (f: (d: OperationsDashboardDepartment) => number) => shown.reduce((n, d) => n + f(d), 0);
  const totals = {
    departments: shown.length,
    departmentHeads: sum(d => d.departmentHeads.length),
    teamLeads: sum(d => d.teamLeads),
    teamMembers: sum(d => d.teamMembers),
    awaitingAssignment: sum(d => d.awaitingAssignment),
    pendingDepartmentHeadApprovals: sum(d => d.pendingDepartmentHeadApprovals)
  };
  const picked = filterId ? shown[0] : selected && data?.departments.find(d => d.id === selected.id);
  return (
    <div className="space-y-6" data-testid="operations-dashboard">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-600" aria-hidden="true" /> Operations dashboard</h2>
          <p className="text-xs text-slate-500">Only the departments the Super Admin assigned to you.</p>
        </div>
        <button type="button" className={btn.secondary} onClick={load}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh</button>
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && <Spinner label="Loading your departments…" />}
      {data && data.departments.length === 0 && <p className="text-sm text-slate-500 bg-white rounded-2xl border border-slate-200/80 p-6 text-center">No department is assigned to you yet. The Super Admin assigns them.</p>}
      {data && data.departments.length > 0 && (
        <>
          <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700" htmlFor="ops-department-filter">
            <span>Department</span>
            <select id="ops-department-filter" className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-normal min-w-[16rem]" value={filterId} onChange={e => { setFilterId(e.target.value); setSelected(null); }} data-testid="ops-department-filter">
              <option value="">All my departments (consolidated)</option>
              {data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <span className="font-normal text-slate-500" data-testid="ops-department-count">{filterId ? 'One department' : `${data.departments.length} department${data.departments.length === 1 ? '' : 's'} on this one dashboard`}</span>
          </label>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <Card label="Departments" value={totals.departments} />
            <Card label="Department Heads" value={totals.departmentHeads} />
            <Card label="Team Leads" value={totals.teamLeads} />
            <Card label="Team Members" value={totals.teamMembers} hint={`${totals.awaitingAssignment} awaiting a Team Lead`} />
            <Card label="Head approvals" value={totals.pendingDepartmentHeadApprovals} hint="waiting for you" />
            <Card label="Awaiting assignment" value={totals.awaitingAssignment} />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[820px] text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="p-3 font-semibold">Department</th><th className="p-3 font-semibold">Department Head</th>
                  <th className="p-3 font-semibold text-right">Employees</th><th className="p-3 font-semibold text-right">Pending work</th><th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map(d => {
                  const pending = d.pendingDepartmentHeadApprovals + d.awaitingDepartmentHead + d.awaitingAssignment;
                  return (
                    <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(d)} data-testid="ops-department-row">
                      <td className="p-3 font-semibold text-slate-900">{d.name}{d.accountable && <span className="ml-2"><Pill tone="green">you approve heads</Pill></span>}</td>
                      <td className="p-3 text-slate-700">{d.departmentHeads.length ? d.departmentHeads.map(h => h.name + (h.side ? ` (${h.side.toLowerCase()})` : '')).join(', ') : <span className="text-amber-700">No Department Head</span>}</td>
                      <td className="p-3 text-right">{d.teamLeads + d.teamMembers} <span className="text-slate-400">({d.teamLeads} leads, {d.teamMembers} members)</span></td>
                      <td className="p-3 text-right">{pending}</td>
                      <td className="p-3 text-right text-slate-400"><ChevronRight className="w-4 h-4 inline" aria-hidden="true" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {picked && <DepartmentView department={picked} onClose={() => { setSelected(null); setFilterId(''); }} />}
        </>
      )}

      <EmployeeRequestsPanel view="approver" only="DEPARTMENT_HEAD" title="Department Head approvals" />
    </div>
  );
};

const DepartmentView: React.FC<{ department: OperationsDashboardDepartment; onClose: () => void }> = ({ department: d, onClose }) => {
  const [detail, setDetail] = useState<OperationsDepartmentDetail | null>(null);
  const [activity, setActivity] = useState<OperationsActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDetail(null); setActivity(null); setError(null);
    employeesApi.departmentDetail(d.id).then(setDetail, e => setError(errorMessage(e)));
    employeesApi.departmentActivity(d.id).then(setActivity, e => setError(errorMessage(e)));
  }, [d.id]);
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4" aria-label={`${d.name} management view`}>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900">{d.name}</h3>
        <button type="button" className={btn.secondary} onClick={onClose}>Close</button>
      </div>
      {error && <ErrorBanner message={error} />}
      <div className="grid sm:grid-cols-4 gap-3 text-xs">
        <div><div className="text-slate-500">Leads / Onboarding / Customers</div><div className="font-bold text-slate-900">{d.leads} / {d.onboarding} / {d.customers}</div></div>
        <div><div className="text-slate-500">Handed over, awaiting the head</div><div className="font-bold text-slate-900">{d.awaitingDepartmentHead}</div></div>
        <div><div className="text-slate-500">With the verifier</div><div className="font-bold text-slate-900">{d.withVerifier}</div></div>
        <div><div className="text-slate-500">Awaiting a Team Lead</div><div className="font-bold text-slate-900">{d.awaitingAssignment}</div></div>
      </div>
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" aria-hidden="true" /> Department Heads</h4>
        {d.departmentHeads.length === 0 ? <p className="text-xs text-amber-700">This department has no Department Head.</p> : (
          <ul className="space-y-1">{d.departmentHeads.map(h => <li key={h.id} className="text-xs text-slate-700">{h.name} · {h.email}{h.side ? ` · ${h.side.toLowerCase()}` : ''}{h.status !== 'ACTIVE' ? ` · ${h.status.toLowerCase()}` : ''}{h.lastLoginAt ? ` · last sign-in ${longDateTime(h.lastLoginAt)}` : ''}</li>)}</ul>
        )}
      </div>
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-1">Team Leads and their teams</h4>
        {!detail ? <Spinner /> : detail.teamLeads.length === 0 ? <p className="text-xs text-slate-500">No Team Lead yet.</p> : (
          <ul className="grid sm:grid-cols-2 gap-1">{detail.teamLeads.map(l => <li key={l.id} className="text-xs text-slate-700 rounded-lg border border-slate-200 px-3 py-1.5 flex justify-between"><span>{l.name} · {l.team ?? 'no team'}</span><span className="text-slate-500">{l.members} member{l.members === 1 ? '' : 's'}</span></li>)}</ul>
        )}
        {detail && detail.awaitingAssignment.length > 0 && <p className="text-[11px] text-slate-500 mt-2">Waiting for the Department Head to assign a Team Lead: {detail.awaitingAssignment.map(m => m.name).join(', ')}.</p>}
      </div>
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" aria-hidden="true" /> Department Head activity</h4>
        {!activity ? <Spinner /> : activity.length === 0 ? <p className="text-xs text-slate-500">No recorded activity yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-100"><th className="py-1.5 font-semibold">When</th><th className="font-semibold">Department Head</th><th className="font-semibold">Activity</th><th className="font-semibold">Reference</th><th className="font-semibold">Outcome</th></tr></thead>
            <tbody>{activity.map((a, i) => <tr key={i} className="border-b border-slate-50"><td className="py-1.5 whitespace-nowrap">{longDateTime(a.at)}</td><td>{a.departmentHead}</td><td>{(a.type ?? '').replace(/_/g, ' ').toLowerCase()}</td><td className="text-slate-500">{a.reference}</td><td>{a.outcome}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </section>
  );
};
