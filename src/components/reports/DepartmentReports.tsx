import React, { useCallback, useEffect, useState } from 'react';
import type { DepartmentReportBox } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { workReportsApi } from '../../lib/api/workReports';
import { Card, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { TeamLeadBoxView } from './TeamLeadBoxView';
import { PeriodBar, presetPeriod, type Period } from './reportUi';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/**
 * The Department Head's team reports: one expandable box per Team Lead of the department (loaded from the database, nothing hard-coded).
 * Opened, a box shows the Team Lead's individual daily report and then the Team Members' daily reports with both approval statuses. Only
 * Team Member reports both approvals passed count as approved. (The reports waiting for the head's decision are on Pending Approvals; the
 * weekly report to the Operations Head is on its own tab.)
 */
export const DepartmentReports: React.FC<{ reloadKey: number; onOpen: (id: string) => void }> = ({ reloadKey, onOpen }) => {
  const [period, setPeriod] = useState<Period>(() => presetPeriod('TODAY'));
  const [data, setData] = useState<DepartmentReportBox | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    workReportsApi.department(period.from, period.to).then(d => { setError(''); setData(d); }, e => setError(errText(e)));
  }, [period.from, period.to]);
  useEffect(() => { setData(null); }, [period.from, period.to]);
  useEffect(load, [load, reloadKey]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Team reports</h2>
          <p className="text-xs text-slate-500">{data ? <>{data.department ?? 'Your department'} - one box per Team Lead</> : 'One box per Team Lead of your department.'}</p>
        </div>
        <PeriodBar value={period} onChange={setPeriod} />
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? (
        data.teams.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No Team Leads are set up in your department yet.</p> : (
          <div className="space-y-3" data-testid="department-boxes">
            {data.teams.map(b => <TeamLeadBoxView key={b.leadId} box={b} onOpen={onOpen} />)}
          </div>
        )
      ) : null}
    </Card>
  );
};
