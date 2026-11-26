import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalSearchProvider, GlobalSearchTrigger, useSearchPages } from '../../../src/components/search/GlobalSearch';
import { OPEN_MEETING_EVENT } from '../../../src/components/meetings/meetingEvents';
import './withAppFeedback';

// A small dashboard: its menu is registered with search (as DashboardShell does) and shows which page is open.
const PAGES = [
  { navId: '__attendance', label: 'Attendance' }, { navId: '__meetings', label: 'Meetings' }, { navId: 'team', label: 'Team Members', group: 'Team' },
  { navId: 'incentives', label: 'Sales Incentives', group: 'Income & Reports' }, { navId: 'customers', label: 'Customer Management', group: 'Customers' }
];
const Dashboard: React.FC = () => {
  const [page, setPage] = useState('overview');
  useSearchPages(PAGES, setPage);
  return (
    <div>
      <header className="flex items-center gap-2 p-3 border-b border-slate-200 bg-white"><span className="font-bold">CRM</span><span className="ml-auto" /><GlobalSearchTrigger /><button type="button" id="other">Other</button></header>
      <main className="p-4"><p data-testid="current-page">{page}</p><input id="notes" aria-label="Notes" className="border" /></main>
    </div>
  );
};
(window as any).__events = [];
window.addEventListener(OPEN_MEETING_EVENT, (e: Event) => (window as any).__events.push({ meeting: (e as CustomEvent).detail?.id }));
(window as any).mount = (userId: string) => createRoot(document.getElementById('root')!).render(<GlobalSearchProvider userId={userId}><Dashboard /></GlobalSearchProvider>);
