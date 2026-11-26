import React from 'react';
import { createRoot } from 'react-dom/client';
import { UnifiedDashboard } from '../../../src/components/unified/UnifiedDashboard';
import './withAppFeedback';

/**
 * The real unified dashboard (International / Reseller) inside the real dashboard shell and the real navigation, for a Department Head, a Team Lead or a
 * Team Member. The pages it opens are replaced by markers (data-stub) by the test, which checks WHICH page each sidebar entry opens for each role; the
 * pages themselves have their own tests. The CRM API is answered in the page; every request is recorded in window.__calls.
 */
const w = window as any;
w.__calls = [];
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/api/v1/')) return realFetch(input as RequestInfo, init);
  w.__calls.push({ method: (init?.method || 'GET').toUpperCase(), path: url.pathname });
  const data = url.pathname.endsWith('/bugs/access') ? { isDeveloper: false, isLead: false, developers: [] } : [];
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const PEOPLE = {
  head: { role: 'DEPARTMENT_HEAD', fullName: 'Ira Head', team: null, defaultDashboard: 'unified-head' },
  lead: { role: 'TEAM_HEAD', fullName: 'Leena Lead', defaultDashboard: 'unified-lead' },
  member: { role: 'TEAM_MEMBER', fullName: 'Mohan Member', defaultDashboard: 'unified-member' }
} as const;
let root: ReturnType<typeof createRoot> | null = null;
w.mount = (who: keyof typeof PEOPLE, dept: 'International' | 'Reseller' = 'International') => {
  const slug = dept.toLowerCase();
  w.__profile = { id: 'u1', email: 'u@example.com', status: 'ACTIVE', phone: '9800000000', position: null, department: { id: `d-${slug}`, name: dept, slug },
    team: { id: `t-${slug}`, name: `${dept} Team`, division: 'GENERAL' }, ...PEOPLE[who] };
  root = createRoot(document.getElementById('root')!);
  root.render(<UnifiedDashboard />);
};
w.signOut = () => { root?.unmount(); root = null; document.body.innerHTML = '<div id="root"></div>'; w.__calls = []; };
