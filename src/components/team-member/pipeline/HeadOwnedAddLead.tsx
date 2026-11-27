import React from 'react';
import { AddLeadView } from './LeadForms';
import { headApi, useHeadData } from '../../../lib/headDashboard';
import { LoadingLine } from '../../tasks/head/headParts';

/**
 * "Add lead" for a Department Head (they belong to a department, not a team). The lead form gets a "Lead owner" choice: Myself (Department Head) first and
 * chosen by default, then the Team Leads and Team Members of their side of the department. The list is the database's own (head_lead_owners), and the lead
 * insert checks the owner again (private.can_assign_customer_owner). If the list cannot be loaded the form still opens without the choice: the server then
 * makes the Department Head the owner.
 */
export const HeadOwnedAddLead: React.FC<{ defaultSource?: string; onCancel: () => void; onSaved: (id: string) => void }> = ({ defaultSource, onCancel, onSaved }) => {
  const owners = useHeadData(() => headApi.leadOwners(), []);
  // the form reads its owner list when it opens: wait for the list (or for its failure) first
  if (owners.loading && !owners.data && !owners.error) return <LoadingLine label="Loading…" />;
  const list = owners.data ?? [];
  return (
    <AddLeadView
      defaultSource={defaultSource}
      owners={list.length ? list.map(o => ({
        id: o.id,
        name: o.role === 'Myself' ? 'Myself (Department Head)' : o.name,
        hint: o.role === 'Myself' ? undefined : [o.role, o.team].filter(Boolean).join(' · ')
      })) : undefined}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  );
};
