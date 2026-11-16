import React, { useState } from 'react';
import type { AiStudioPerson } from '../../../shared/contracts';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { TeamMemberManagement } from '../common/TeamMemberManagement';
import { Avatar, Card, Tabs, fieldCls } from '../tasks/head/headParts';
import { notifyAiStudioChanged, useAiStudioChanged } from './aiStudioEvents';
import { TableWrap, tdCls, thCls, useLoad } from './ui';

const ROLE_LABEL: Record<string, string> = { DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member' };

/** Work allocation: everybody in AI Studio with their Team Lead, projects and open work. The Department Head can change a Team Member's Team Lead here. */
const Allocation: React.FC<{ canChange: boolean }> = ({ canChange }) => {
  const { data, error, loading, reload } = useLoad<AiStudioPerson[]>(() => aiStudioApi.people(), []);
  useAiStudioChanged(reload);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const people = data ?? [];
  const leads = people.filter(p => p.role === 'TEAM_HEAD' && p.status === 'ACTIVE');
  const change = async (m: AiStudioPerson, leadId: string) => {
    if (!leadId || leadId === m.leadId) return;
    setBusy(m.id);
    setProblem('');
    try { await aiStudioApi.setLead(m.id, leadId); notifyAiStudioChanged(); reload(); } catch (err) { setProblem(errorMessage(err)); } finally { setBusy(''); }
  };
  return (
    <Card>
      {error && <div className="p-4"><ErrorBanner message={error} onRetry={reload} /></div>}
      {problem && <div className="p-4"><ErrorBanner message={problem} /></div>}
      {loading && !data && <Spinner label="Loading the team…" />}
      {data && people.length === 0 && <p className="py-12 text-center text-sm text-slate-500">Nobody has been added to AI Studio yet.</p>}
      {data && people.length > 0 && (
        <TableWrap>
          <table className="w-full min-w-[52rem]">
            <thead className="border-b border-slate-100">
              <tr><th className={thCls}>Employee</th><th className={thCls}>Role</th><th className={thCls}>Team Lead</th><th className={thCls}>Projects</th><th className={thCls}>Open tasks</th><th className={thCls}>Completed</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map(p => (
                <tr key={p.id}>
                  <td className={tdCls}><div className="flex items-center gap-2.5"><Avatar name={p.fullName} /><div className="min-w-0"><div className="font-bold text-slate-900 truncate">{p.fullName}</div><div className="text-xs text-slate-500 truncate">{p.email}{p.status !== 'ACTIVE' ? ` · ${p.status.toLowerCase()}` : ''}</div></div></div></td>
                  <td className={tdCls}>{ROLE_LABEL[p.role]}</td>
                  <td className={tdCls}>
                    {p.role !== 'TEAM_MEMBER' ? <span className="text-slate-400">-</span>
                      : canChange && p.status === 'ACTIVE'
                        ? (
                          <select aria-label={`Team Lead of ${p.fullName}`} className={`${fieldCls} !w-auto min-w-[10rem]`} value={p.leadId ?? ''} disabled={busy === p.id} onChange={e => void change(p, e.target.value)}>
                            {!p.leadId && <option value="">No Team Lead yet</option>}
                            {leads.map(l => <option key={l.id} value={l.id}>{l.fullName}</option>)}
                          </select>
                        )
                        : (p.leadName ?? <span className="text-amber-700 font-semibold">No Team Lead yet</span>)}
                  </td>
                  <td className={tdCls}>{p.projects.length ? p.projects.map(x => x.name).join(', ') : <span className="text-slate-400">-</span>}</td>
                  <td className={tdCls}>{p.role === 'DEPARTMENT_HEAD' ? '-' : p.openTasks}</td>
                  <td className={tdCls}>{p.role === 'DEPARTMENT_HEAD' ? '-' : p.completedTasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
};

type TeamTab = 'allocation' | 'manage';

/** Team Management: the work allocation of the department, and (the existing screens) adding Team Leads and Team Members with their projects. */
export const AiStudioTeam: React.FC<{ canChange: boolean; departmentSlug: string }> = ({ canChange, departmentSlug }) => {
  const [tab, setTab] = useState<TeamTab>('allocation');
  return (
    <div className="space-y-6">
      <PageTitle title="Team Management" subtitle="Who works on what: Team Leads, Team Members, their projects and their open work." />
      <Tabs<TeamTab> label="Team views" value={tab} options={[{ id: 'allocation', label: 'Work allocation' }, { id: 'manage', label: 'Add or manage employees' }]} onChange={setTab} />
      {tab === 'allocation' && <Allocation canChange={canChange} />}
      {tab === 'manage' && <TeamMemberManagement departmentSlug={departmentSlug} />}
    </div>
  );
};
