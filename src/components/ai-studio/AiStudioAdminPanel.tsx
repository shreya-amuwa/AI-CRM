import React from 'react';
import { AiStudioOverviewPage } from './AiStudioOverview';
import { DepartmentTasks, ProjectManagement } from './AiStudioProjects';
import { DepartmentReports } from './AiStudioReports';

/**
 * AI Studio inside the Super Admin's Department Hub: the same overview, projects, tasks and reports as the Department Head sees, from the database as the Super
 * Admin (who reads and manages but takes no part in the report approval). People are managed in "Team Members & Access", the CRM's own screen.
 */
export const AiStudioAdminPanel: React.FC<{ activeTab: string; onSelectTab: (tab: 'ai_projects' | 'ai_reports') => void }> = ({ activeTab, onSelectTab }) => {
  if (activeTab === 'ai_projects') return <ProjectManagement role="ADMIN" />;
  if (activeTab === 'ai_tasks') return <DepartmentTasks role="ADMIN" />;
  if (activeTab === 'ai_reports') return <DepartmentReports role="ADMIN" />;
  return <AiStudioOverviewPage go={p => onSelectTab(p === 'projects' ? 'ai_projects' : 'ai_reports')} />;
};

export default AiStudioAdminPanel;
