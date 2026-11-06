import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Briefcase, CalendarClock, ClipboardCheck, LayoutDashboard, Phone, Scale, Settings, Users, Workflow } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { recruiterApi, type RecruiterQuery } from '../../lib/api/recruiter';
import { navigateTo } from '../../utils/router';
import { DashboardShell, groupNavItems } from '../layout/shell';
import { LeaveCenter } from '../leave/LeaveCenter';
import { MemberSettingsDashboard } from '../team-member/MemberSettingsDashboard';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { Applications } from './Applications';
import { Assessments } from './Assessments';
import { Calls } from './Calls';
import { Decisions } from './Decisions';
import { Interviews } from './Interviews';
import { Overview } from './Overview';
import { Pipeline } from './Pipeline';
import { Reports } from './Reports';
import { Vacancies } from './Vacancies';
import { useLoad } from './ui';

export type RecruiterPage = 'dashboard' | 'vacancies' | 'applications' | 'pipeline' | 'calls' | 'interviews' | 'assessments' | 'decisions' | 'reports' | 'settings' | 'notifications';
export interface RecruiterTarget { applicationId?: string; vacancyId?: string; stage?: RecruiterQuery['stage'] }
export type RecruiterGo = (page: RecruiterPage, target?: RecruiterTarget) => void;

/**
 * The sidebar of the HR Recruiter (pages listed here; the sections are in RECRUITER_SECTIONS). There is no e-mail page: candidate messages are
 * sent by the server on its own.
 */
const NAV: { id: RecruiterPage; label: string; icon: React.ElementType; segment: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, segment: '' },
  { id: 'vacancies', label: 'Vacancies', icon: Briefcase, segment: 'vacancies' },
  { id: 'applications', label: 'Candidate Applications', icon: Users, segment: 'applications' },
  { id: 'pipeline', label: 'Candidate Pipeline', icon: Workflow, segment: 'pipeline' },
  { id: 'calls', label: 'Call Management', icon: Phone, segment: 'calls' },
  { id: 'interviews', label: 'Interview Management', icon: CalendarClock, segment: 'interviews' },
  { id: 'assessments', label: 'Assessment & Test Results', icon: ClipboardCheck, segment: 'assessments' },
  { id: 'decisions', label: 'Selection & Rejection', icon: Scale, segment: 'selection' },
  { id: 'reports', label: 'Recruitment Reports', icon: BarChart3, segment: 'reports' },
  { id: 'settings', label: 'Settings', icon: Settings, segment: 'settings' }
];
/** Work = the day's work (the overview, calls and follow-ups, the interview schedule); Recruitment = vacancies and candidates; Management. */
const RECRUITER_SECTIONS: { label: string; ids: RecruiterPage[]; collapsible: boolean }[] = [
  { label: 'Work', ids: ['dashboard', 'calls', 'interviews'], collapsible: true },
  { label: 'Recruitment', ids: ['vacancies', 'applications', 'pipeline', 'assessments', 'decisions'], collapsible: true },
  { label: 'Management', ids: ['reports', 'settings'], collapsible: true }
];
export const RECRUITER_BASE = (userId: string) => `/hr-recruiter/dashboard/${userId}`;

export function parseRecruiterRoute(path: string): { page: RecruiterPage; id?: string } {
  const parts = path.replace(/\/+$/, '').split('/');
  const seg = parts[4] ?? '';
  const id = parts[5] || undefined;
  if (seg === 'notifications') return { page: 'notifications' };
  const found = NAV.find(n => n.segment === seg);
  return { page: found?.id ?? 'dashboard', id };
}

/**
 * The HR Recruiter workspace. Every page reads and writes through the API; the database lets a Recruiter see only the vacancies allocated to them and the
 * applications of those vacancies (HR leadership: all). Navigation here is convenience only, never authorization.
 */
export const RecruiterDashboard: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const userId = user?.id || profile?.id || '';
  const [route, setRoute] = useState(() => parseRecruiterRoute(window.location.pathname));
  const [initial, setInitial] = useState<{ stage?: RecruiterQuery['stage']; n: number }>({ n: 0 });
  const ctx = useLoad(() => recruiterApi.context(), []);

  useEffect(() => {
    const onPop = () => setRoute(parseRecruiterRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go: RecruiterGo = useCallback((page, target) => {
    const nav = NAV.find(n => n.id === page);
    const id = target?.applicationId ?? target?.vacancyId;
    setInitial(i => ({ stage: target?.stage, n: i.n + 1 }));
    setRoute({ page, id });
    const base = RECRUITER_BASE(userId);
    navigateTo(page === 'notifications' ? `${base}/notifications` : `${base}${nav?.segment ? `/${nav.segment}` : ''}${id ? `/${id}` : ''}`);
  }, [userId]);

  const displayName = profile?.fullName || user?.name || 'HR Recruiter';
  const c = ctx.data;
  const items = NAV.map(n => ({ id: n.id, label: n.label, icon: n.icon, badge: n.id === 'applications' && c?.newApplications ? c.newApplications : undefined, count: undefined }));
  const groups = groupNavItems(items, RECRUITER_SECTIONS);

  return (
    <DashboardShell
      title="Amuwa HR"
      subtitle="Recruiter"
      ariaLabel="HR Recruiter navigation"
      groups={groups}
      active={route.page === 'notifications' ? '' : route.page}
      onSelect={id => go(id as RecruiterPage)}
      user={{ name: displayName, role: c?.isLeadership ? 'HR leadership' : 'HR Recruiter' }}
      onSignOut={() => void logout()}
      topLeft={<div className="hidden lg:block text-sm text-slate-500" title={profile?.email}>{profile?.department?.name || 'HR'} · Recruitment</div>}
      topActions={<><LeaveCenter /><NotificationBell /></>}
      wide
    >
      {/* the Vacancies pages use the full content width (the vacancy detail lays out three columns across it); the other pages keep the calm column */}
      <div className={route.page === 'vacancies' ? 'w-full' : 'mx-auto w-full max-w-[1400px]'}>
        {ctx.loading && !c ? <Spinner /> : ctx.error || !c ? (
          <ErrorBanner message={ctx.error ?? 'The recruiter workspace could not be opened.'} onRetry={ctx.reload} />
        ) : (
          <>
            {route.page === 'dashboard' && <Overview ctx={c} go={go} />}
            {route.page === 'vacancies' && <Vacancies ctx={c} go={go} openId={route.id} onChanged={ctx.reload} />}
            {route.page === 'applications' && <Applications key={`apps-${initial.n}`} ctx={c} go={go} applicationId={route.id} initial={initial.stage ? { stage: initial.stage } : undefined} onChanged={ctx.reload} />}
            {route.page === 'pipeline' && <Pipeline ctx={c} go={go} />}
            {route.page === 'calls' && <Calls ctx={c} go={go} onChanged={ctx.reload} />}
            {route.page === 'interviews' && <Interviews ctx={c} go={go} onChanged={ctx.reload} />}
            {route.page === 'assessments' && <Assessments ctx={c} go={go} />}
            {route.page === 'decisions' && <Decisions ctx={c} go={go} onChanged={ctx.reload} />}
            {route.page === 'reports' && <Reports ctx={c} />}
            {route.page === 'settings' && <MemberSettingsDashboard currentUserId={userId} userName={displayName} />}
            {route.page === 'notifications' && <NotificationsPage />}
          </>
        )}
      </div>
    </DashboardShell>
  );
};
