import React, { useCallback, useEffect, useState } from 'react';
import { Building2, RefreshCw } from 'lucide-react';
import type { OperationsOverviewRow } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { usersApi } from '../../lib/api/endpoints';

/**
 * Operations Head: the departments they are authorised for, side by side - people, leads, onboarding, customers and what waits at the
 * verifier or the Department Head. Read-only: it is an overview, not another permission. The database lists only the departments the
 * person is assigned to (the Super Admin sees all).
 */
export const OperationsOverview: React.FC = () => {
  const [rows, setRows] = useState<OperationsOverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    usersApi.operationsOverview().then(setRows, e => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  // reload when something in the pipeline changes (no timer)
  useEffect(() => {
    window.addEventListener('crm:pipeline-changed', load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener('crm:pipeline-changed', load);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  return (
    <section aria-label="Operations overview" className="space-y-4" data-testid="operations-overview">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-600" aria-hidden="true" /> Operations overview
          </h2>
          <p className="text-xs text-slate-500">The departments you oversee, side by side. Switch department in the header to work inside one.</p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {!rows && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-slate-500">No department is assigned to you yet. The Super Admin assigns them in Access Control.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="p-3 font-semibold">Department</th>
                <th className="p-3 font-semibold text-right">People</th>
                <th className="p-3 font-semibold text-right">Leads</th>
                <th className="p-3 font-semibold text-right">Onboarding</th>
                <th className="p-3 font-semibold text-right">Customers</th>
                <th className="p-3 font-semibold text-right">With the verifier</th>
                <th className="p-3 font-semibold text-right">Awaiting Department Head</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.departmentId} className="border-b border-slate-50 last:border-0" data-testid={`ops-row-${r.slug}`}>
                  <th scope="row" className="p-3 text-left font-semibold text-slate-900">{r.name}</th>
                  <td className="p-3 text-right">{r.people}</td>
                  <td className="p-3 text-right">{r.leads}</td>
                  <td className="p-3 text-right">{r.onboarding}</td>
                  <td className="p-3 text-right">{r.customers}</td>
                  <td className="p-3 text-right">{r.withVerifier}</td>
                  <td className="p-3 text-right">{r.awaitingDepartmentHead}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
