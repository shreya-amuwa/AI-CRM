import React, { useCallback, useState } from 'react';
import { ReportDetailDialog } from '../../reports/ReportDetailDialog';
import { useReportsLive } from '../../reports/reportEvents';
import { Tabs } from '../../reports/reportUi';
import { AiAnalysis } from './AiAnalysis';
import { CompanyReports } from './CompanyReports';
import { DepartmentPerformance, EmployeePerformance } from './DepartmentPerformance';
import { EmployeeProfileDialog } from './EmployeeProfileDialog';
import { Leaderboard } from './Leaderboard';

const TABS = [
  { id: 'company', label: 'Company Reports' },
  { id: 'departments', label: 'Department Performance' },
  { id: 'employees', label: 'Employee Performance' },
  { id: 'analysis', label: 'AI Performance Analysis' },
  { id: 'leaderboard', label: 'Performance Leaderboard' }
];

/**
 * The Super Admin's company reporting and performance workspace. It updates by itself when HR submits a consolidated report or an
 * analysis is written (the live report signals), reading again only what is on screen.
 */
const ReportPerformance: React.FC<{ initialTab?: string }> = ({ initialTab = 'company' }) => {
  const [tab, setTab] = useState(initialTab);
  const [tick, setTick] = useState(0);
  const [profile, setProfile] = useState<{ id: string; period: { type: string; from?: string; to?: string } } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  useReportsLive(useCallback(() => setTick(t => t + 1), []));
  const openEmployee = useCallback((id: string, period: { type: string; from?: string; to?: string }) => setProfile({ id, period }), []);
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto" data-testid="report-performance">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Reports &amp; Performance</h1>
        <p className="text-sm text-slate-500">The company's reporting, HR reviews, AI analysis and the performance leaderboard, from the records.</p>
      </header>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'company' ? <CompanyReports reloadKey={tick} onOpenReport={setReport} /> : null}
      {tab === 'departments' ? <DepartmentPerformance reloadKey={tick} onOpenEmployee={openEmployee} /> : null}
      {tab === 'employees' ? <EmployeePerformance reloadKey={tick} onOpenEmployee={openEmployee} /> : null}
      {tab === 'analysis' ? <AiAnalysis reloadKey={tick} onOpenEmployee={openEmployee} /> : null}
      {tab === 'leaderboard' ? <Leaderboard reloadKey={tick} onOpenEmployee={openEmployee} /> : null}
      {profile ? <EmployeeProfileDialog id={profile.id} period={profile.period} onClose={() => setProfile(null)} onOpenReport={id => { setProfile(null); setReport(id); }} /> : null}
      {report ? <ReportDetailDialog id={report} simple onClose={() => setReport(null)} /> : null}
    </div>
  );
};

export default ReportPerformance;
