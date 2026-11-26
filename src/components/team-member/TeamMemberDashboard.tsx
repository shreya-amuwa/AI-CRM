import React, { useState } from 'react';
import { useOpenWorkUpdateRequest } from '../tasks/workUpdateEvents';
import { TEAM_MEMBER_NAVS, TeamMemberLayout, TeamMemberNav } from './TeamMemberLayout';
import { MemberSections, useMemberWorkspace, type MemberSection } from './MemberSections';
import { PipelineWorkspace } from './pipeline/PipelineWorkspace';
import { usePipelineCounts } from './pipeline/shared';
import { useRememberedPage } from '../../hooks/useRememberedPage';

interface TeamMemberDashboardProps {
  currentUserId: string;
  userName: string;
}

const MEMBER_SECTIONS: TeamMemberNav[] = ['home', 'work-tasks', 'tasks', 'customers', 'calendar', 'invoices', 'settings', 'delivery', 'notifications'];

/**
 * The Team Member dashboard (every team member who is not in a Sales team: a Sales Team Member works in the unified Business Associate dashboard).
 * The pages are the shared member pages; the lead pipeline is the same pipeline the Business Associate dashboard shows.
 */
export const TeamMemberDashboard: React.FC<TeamMemberDashboardProps> = ({ currentUserId, userName }) => {
  const [activeNav, setActiveNavState] = useRememberedPage<TeamMemberNav>('team-member', 'home', TEAM_MEMBER_NAVS);
  // Bumped on every sidebar click so re-selecting a section returns to its list.
  const [navNonce, setNavNonce] = useState(0);
  const setActiveNav = (nav: TeamMemberNav) => {
    setActiveNavState(nav);
    setNavNonce(n => n + 1);
  };
  useOpenWorkUpdateRequest(React.useCallback(() => setActiveNav('work-tasks'), []));
  const { counts: pipelineCounts } = usePipelineCounts();
  const workspace = useMemberWorkspace(currentUserId);

  return (
    <TeamMemberLayout
      activeNav={activeNav}
      onSelectNav={setActiveNav}
      pipelineCounts={
        pipelineCounts
          ? {
              leads: pipelineCounts.leads.all,
              potential: pipelineCounts.potential.all,
              onboarding: pipelineCounts.onboarding.all,
              partPayments: pipelineCounts.partPayments ?? 0,
              returned: pipelineCounts.onboarding.RETURNED ?? 0
            }
          : null
      }
    >
      <div className="space-y-6 max-w-7xl mx-auto pb-10">
        {(activeNav === 'leads' || activeNav === 'potential' || activeNav === 'onboarding' || activeNav === 'part-payments') && (
          <PipelineWorkspace
            section={activeNav}
            counts={pipelineCounts}
            resetKey={navNonce}
            onNavigate={nav => setActiveNav(nav)}
          />
        )}
        {MEMBER_SECTIONS.includes(activeNav) && (
          <MemberSections section={activeNav as MemberSection} currentUserId={currentUserId} userName={userName} workspace={workspace} onOpenInvoices={() => setActiveNav('invoices')} />
        )}
      </div>
    </TeamMemberLayout>
  );
};
