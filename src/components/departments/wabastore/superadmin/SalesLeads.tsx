import React, { useState } from 'react';
import { LeadsView } from '../../../team-member/pipeline/LeadsView';
import { CustomerQuickView } from '../../../team-member/pipeline/CustomerQuickView';
import { useSalesOverview } from './useSalesOverview';

/**
 * Wabastore Sales - Leads for the Super Admin. The same lead list as the Sales Team
 * Member dashboard (search, service / source / follow-up filters, status tabs, paging),
 * showing every lead the sub-department's team added. View only: leads are still
 * created and worked by the Sales Team Members.
 */
export const SalesLeads: React.FC<{ departmentId: string | undefined; initialOwnerId?: string }> = ({ departmentId, initialOwnerId }) => {
  const { data } = useSalesOverview(departmentId);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!departmentId) return null;
  return (
    <>
      <LeadsView
        key={initialOwnerId || 'all'}
        counts={data ? { leads: data.leads } : null}
        showInbound={false}
        onAdd={() => undefined}
        onEdit={setOpenId}
        scope={{
          departmentId,
          division: 'SALES',
          initialOwnerId,
          members: (data?.members || []).map(m => ({ id: m.id, fullName: m.fullName })),
          title: 'Leads',
          subtitle: 'Every lead added by the Wabastore Sales team. Open one to see its details; the team members keep working them.'
        }}
      />
      {openId && <CustomerQuickView id={openId} title="Lead details" onClose={() => setOpenId(null)} />}
    </>
  );
};
