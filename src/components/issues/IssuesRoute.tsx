import React, { Suspense, lazy } from 'react';
import { MessageSquareWarning } from 'lucide-react';

// the screens are only downloaded when somebody opens the page
const RaiseIssuePage = lazy(() => import('./RaiseIssuePage'));

/** What every employee dashboard (Team Member, Team Lead, Department Head) needs to offer the page: the menu item. */
export const ISSUES_NAV = { id: 'raise-issue', label: 'Raise an Issue', icon: MessageSquareWarning } as const;

/** The Raise an Issue page for a dashboard's content area (one page, one workflow, for all three roles). */
export const IssuesRoute: React.FC = () => (
  <Suspense fallback={<div role="status" className="p-8 text-sm text-slate-500">Loading</div>}>
    <RaiseIssuePage />
  </Suspense>
);
