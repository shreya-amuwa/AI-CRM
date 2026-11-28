import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, ClipboardCheck, Search, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { fetchHrDirectory, type HrDirectory } from '../../lib/hrDirectory';
import { fmtDay } from '../../lib/support';
import { navigateTo } from '../../utils/router';
import { DashboardShell, groupNavItems } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { Card, ErrorBanner, inputCls, Pill, Spinner } from '../team-member/pipeline/shared';
import { HrPageHeader } from './hrUi';
import { EmployeeReviews } from './reviews/EmployeeReviews';

/**
 * The dashboard of a department's own HR (designation Department HR, e.g. "HR (Digitree)"). It shows that one department only: every call below is
 * filtered by the database to the department the person is placed in (hr_employee_directory, hr_probation_list ...), so nothing of another department
 * reaches this screen whatever the URL, the request or the browser state says. There is no department switcher.
 */
type Page = 'employees' | 'probation' | 'notifications';
const PAGES: { id: Page; label: string; icon: React.ElementType; segment: string }[] = [
  { id: 'employees', label: 'Employees', icon: Users, segment: '' },
  { id: 'probation', label: 'Employee Confirmations', icon: ClipboardCheck, segment: 'probation' },
  { id: 'notifications', label: 'Notifications', icon: Bell, segment: 'notifications' }
];
const BASE = (id: string) => `/hr-department/dashboard/${id}`;
const pageOf = (path: string): Page => PAGES.find(p => p.segment && path.endsWith(`/${p.segment}`))?.id ?? 'employees';

export const DepartmentHrDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  const [page, setPage] = useState<Page>(() => pageOf(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPage(pageOf(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((p: Page) => {
    setPage(p);
    const seg = PAGES.find(x => x.id === p)?.segment;
    navigateTo(`${BASE(userId)}${seg ? `/${seg}` : ''}`);
  }, [userId]);

  const departmentName = profile?.department?.name || 'Department';
  const groups = groupNavItems(PAGES.map(p => ({ id: p.id, label: p.label, icon: p.icon })), [
    { label: `${departmentName} HR`, ids: ['employees', 'probation'] },
    { label: 'Communication', ids: ['notifications'] }
  ]);

  return (
    <DashboardShell
      title="Amuwa HR"
      subtitle={departmentName}
      ariaLabel={`${departmentName} HR navigation`}
      groups={groups}
      active={page}
      onSelect={id => go(id as Page)}
      user={{ name: profile?.fullName || user?.name || 'HR', role: `HR (${departmentName})` }}
      onSignOut={() => void logout()}
      topLeft={<div className="hidden lg:block text-sm text-slate-500" data-testid="department-hr-scope">{departmentName} HR · this department only</div>}
      topActions={<><LeaveCenter /><NotificationBell /></>}
      wide
    >
      <div className="mx-auto w-full max-w-[1400px]">
        {page === 'employees' && <DepartmentEmployees departmentName={departmentName} />}
        {page === 'probation' && <EmployeeReviews type="PROBATION" />}
        {page === 'notifications' && <NotificationsPage />}
      </div>
    </DashboardShell>
  );
};

const DepartmentEmployees: React.FC<{ departmentName: string }> = ({ departmentName }) => {
  const [dir, setDir] = useState<HrDirectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const load = useCallback(() => {
    setError(null);
    fetchHrDirectory().then(setDir, e => setError(e instanceof Error ? e.message : 'Could not load the employees.'));
  }, []);
  useEffect(() => { load(); }, [load]);
  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...(dir?.employees ?? []), ...(dir?.pending ?? [])];
    return q ? all.filter(e => `${e.name} ${e.email} ${e.designation} ${e.id}`.toLowerCase().includes(q)) : all;
  }, [dir, query]);

  return (
    <section className="space-y-5" aria-label={`${departmentName} employees`}>
      <HrPageHeader as="h2" icon={Users} title={`${departmentName} employees`} subtitle={`Everyone in ${departmentName}. Other departments are not shown to this account.`} />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!dir && !error ? <Spinner /> : dir && (
        <>
          <label className="relative block max-w-md">
            <span className="sr-only">Search employees</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input className={`${inputCls} pl-9`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, e-mail, designation or ID" />
          </label>
          {people.length === 0 ? (
            <Card className="p-8 text-center text-xs text-slate-500">{query ? 'Nobody matches that search.' : `No employees in ${departmentName} yet.`}</Card>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="department-hr-employees">
                <thead className="bg-slate-50 text-slate-500 text-left">
                  <tr><th className="px-4 py-2 font-semibold">Name</th><th className="px-4 py-2 font-semibold">Employee ID</th><th className="px-4 py-2 font-semibold">Designation</th>
                    <th className="px-4 py-2 font-semibold">Team</th><th className="px-4 py-2 font-semibold">Joined</th><th className="px-4 py-2 font-semibold">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {people.map(e => (
                    <tr key={`${e.source}-${e.profileId ?? e.id}`}>
                      <td className="px-4 py-2"><div className="font-semibold text-slate-900">{e.name}</div><div className="text-slate-500">{e.email}</div></td>
                      <td className="px-4 py-2 text-slate-600">{e.id}</td>
                      <td className="px-4 py-2 text-slate-600">{e.designation || '–'}</td>
                      <td className="px-4 py-2 text-slate-600">{e.teamName || '–'}</td>
                      <td className="px-4 py-2 text-slate-600">{e.joiningDate ? fmtDay(e.joiningDate) : '–'}</td>
                      <td className="px-4 py-2"><Pill tone={e.status === 'Left' ? 'slate' : e.status === 'Training / Probation' ? 'orange' : 'green'}>{e.status}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </section>
  );
};
