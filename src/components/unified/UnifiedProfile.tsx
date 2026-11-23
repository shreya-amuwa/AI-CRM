import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { PageTitle } from '../layout/shell';

const ROLE_LABEL: Record<string, string> = { DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member' };

/** The signed-in person's own details (read only): who they are, where they work and who they report to. Nothing here is editable by the browser. */
export const UnifiedProfile: React.FC = () => {
  const { profile } = useAuth();
  if (!profile) return <div role="status" className="p-8 text-sm text-slate-500">Loading</div>;
  const rows: [string, string | null | undefined][] = [
    ['Name', profile.fullName],
    ['Email', profile.email],
    ['Phone', profile.phone],
    ['Role', ROLE_LABEL[profile.role] || profile.role],
    ['Designation', profile.position],
    ['Department', profile.department?.name],
    ['Team', profile.team?.name]
  ];
  return (
    <div className="space-y-6" data-testid="unified-profile">
      <PageTitle title="Profile" subtitle="Your details in the CRM. To change them, ask your Department Head or HR." />
      <dl className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 max-w-2xl">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-2 px-5 py-3.5">
            <dt className="w-36 text-sm font-medium text-slate-500">{k}</dt>
            <dd className="text-sm text-slate-900 break-all">{v || 'Not set'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
