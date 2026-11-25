import React, { useState } from 'react';
import { Tabs } from '../tasks/head/headParts';
import { PerformanceApprovals } from './PerformanceApprovals';
import { PerformanceManagement } from './PerformanceManagement';

/**
 * The Performance Management page of the Team Lead and Department Head dashboards: the approval view (figures from the task records and the approved
 * daily reports, with the Team Member -> Team Lead -> Department Head approval) and, next to it, the existing task analytics and written reports.
 */
export const PerformanceHub: React.FC<{ mode: 'TEAM_LEAD' | 'DEPARTMENT_HEAD'; /** another dashboard's own performance page, kept as the second tab instead of the task analytics */ existing?: { label: string; node: React.ReactNode } }> = ({ mode, existing }) => {
  const [tab, setTab] = useState<'approval' | 'analytics'>('approval');
  return (
    <div className="space-y-4">
      <Tabs label="Performance views" value={tab} onChange={setTab} options={[{ id: 'approval', label: 'Scores & Approvals' }, { id: 'analytics', label: existing?.label ?? 'Task Analytics & Reports' }]} />
      {tab === 'approval' ? <PerformanceApprovals title="Performance Management" /> : existing ? existing.node : <PerformanceManagement mode={mode} />}
    </div>
  );
};

/** My Performance (Team Member dashboards): the member's own figures and the approval status of their performance. */
export const MyPerformance: React.FC = () => (
  <PerformanceApprovals title="My Performance" subtitle="Your tasks and your approved daily reports, and whether your Team Lead has approved your performance." />
);
