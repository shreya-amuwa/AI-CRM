import React from 'react';
import type { ActiveTab } from '../../../layout/Sidebar';
import { StaffManagementPanel } from '../../../common/StaffManagementPanel';
import { SupportLeadCustomers, SupportLeadTickets } from '../../../support-member/SupportLeadViews';
import { Spinner } from '../../../team-member/pipeline/shared';
import { SupportTeamPerformance } from './SupportTeamPerformance';
import { useSupportTeamIds } from './useSupportOverview';
import { useWabastoreId } from './useSalesOverview';

/**
 * Super Admin dashboard of the Wabastore Support sub-department. Same structure as the Sales one
 * (Team Members, Access Control, Team Performance) with the Support workflow in place of Leads:
 * Customers and Tickets, the existing supervisor screens scoped to the Support teams only.
 */
export const SupportSuperAdminDashboard: React.FC<{ activeTab: ActiveTab }> = ({ activeTab }) => {
  const departmentId = useWabastoreId();
  const teamIds = useSupportTeamIds(departmentId);

  switch (activeTab) {
    case 'staff_access':
      return <StaffManagementPanel departmentSlug="wabastore" subDept="support" view="access" />;
    case 'support_team_performance':
      return <SupportTeamPerformance departmentId={departmentId} />;
    case 'support_customers':
      return teamIds ? <SupportLeadCustomers teamIds={teamIds} canAdd={false} /> : <Spinner label="Loading customers…" />;
    case 'support_tickets':
      return teamIds ? <SupportLeadTickets teamIds={teamIds} /> : <Spinner label="Loading tickets…" />;
    default:
      return <StaffManagementPanel departmentSlug="wabastore" subDept="support" view="members" />;
  }
};
