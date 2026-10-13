import React, { useState } from 'react';
import type { ActiveTab } from '../../../layout/Sidebar';
import { StaffManagementPanel } from '../../../common/StaffManagementPanel';
import { SalesLeads, SalesOnboarding, SalesPartPayments, SalesPotential } from './SalesLeads';
import { SalesTeamPerformance } from './SalesTeamPerformance';
import { useWabastoreId } from './useSalesOverview';

/**
 * Super Admin dashboard of the Wabastore Sales sub-department:
 * Team Members, Access Control, Team Performance, Leads. Each page reuses the
 * existing implementation (member management, the Sales lead list).
 */
export const SalesSuperAdminDashboard: React.FC<{ activeTab: ActiveTab; onSelectTab: (tab: ActiveTab) => void }> = ({ activeTab, onSelectTab }) => {
  const departmentId = useWabastoreId();
  const [ownerId, setOwnerId] = useState<string | undefined>();

  switch (activeTab) {
    case 'staff_access':
      return <StaffManagementPanel departmentSlug="wabastore" subDept="sales" view="access" />;
    case 'sales_team_performance':
      return (
        <SalesTeamPerformance
          departmentId={departmentId}
          onViewLeads={id => {
            setOwnerId(id);
            onSelectTab('leads');
          }}
        />
      );
    case 'leads':
      return <SalesLeads departmentId={departmentId} initialOwnerId={ownerId} />;
    case 'sales_potential':
      return <SalesPotential departmentId={departmentId} initialOwnerId={ownerId} />;
    case 'sales_onboarding':
      return <SalesOnboarding departmentId={departmentId} initialOwnerId={ownerId} />;
    case 'sales_part_payments':
      return <SalesPartPayments departmentId={departmentId} />;
    default:
      return <StaffManagementPanel departmentSlug="wabastore" subDept="sales" view="members" />;
  }
};
