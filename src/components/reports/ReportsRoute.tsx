import React, { Suspense, lazy } from 'react';
import { FileBarChart } from 'lucide-react';

// the screens are only downloaded when somebody opens the page
const ReportsWorkspace = lazy(() => import('./ReportsWorkspace'));

/** What every dashboard in the reporting chain (Team Member, Team Lead, Department Head, Operations Head) offers: the menu item. */
export const REPORTS_NAV = { id: 'work-reports', label: 'Daily Reports', icon: FileBarChart } as const;

/** The Reports page for a dashboard's content area (one workspace; what it shows follows the person's place in the chain). */
export const ReportsRoute: React.FC = () => (
  <Suspense fallback={<div role="status" className="p-8 text-sm text-slate-500">Loading</div>}>
    <ReportsWorkspace />
  </Suspense>
);
