import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { AiStudioPerson } from '../../../shared/contracts';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { StaffManagementPanel } from '../common/StaffManagementPanel';
import { Avatar, Card, Tabs, fieldCls, primaryBtn } from '../tasks/head/headParts';
import { notifyAiStudioChanged, useAiStudioChanged } from './aiStudioEvents';
import { TableWrap, tdCls, thCls, useLoad } from './ui';

type Tab = 'list' | 'add';

/**
 * Team Leads / Team Members of AI Studio, for the Super Admin (the Department Head of AI Studio). The list is the department's real people with their Team Lead, projects and
 * open work; "Add" is the CRM's own employee form (the department and the role are fixed; Select Project and, for a Team Member, the reporting Team Lead come with it).
 * The accounts are created by the existing employee flow and the database checks every choice again.
 */
export const AiStudioPeoplePage: React.FC<{ kind: 'LEAD' | 'MEMBER'; departmentSlug: string }> = ({ kind, departmentSlug }) => {
  const [tab, setTab] = useState<Tab>('list');
  const { data, error, loading, reload } = useLoad<AiStudioPerson[]>(() => aiStudioApi.people(), []);
  useAiStudioChanged(reload);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const role = kind === 'LEAD' ? 'TEAM_HEAD' : 'TEAM_MEMBER';
  const label = kind === 'LEAD' ? 'Team Lead' : 'Team Member';
  const all = data ?? [];
  const people = all.filter(p => p.role === role);
  const leads = all.filter(p => p.role === 'TEAM_HEAD' && p.status === 'ACTIVE');
  const change = async (m: AiStudioPerson, leadId: string) => {
    if (!leadId || leadId === m.leadId) return;
    setBusy(m.id);
    setProblem('');
    try { await aiStudioApi.setLead(m.id, leadId); notifyAiStudioChanged(); reload(); } catch (err) { setProblem(errorMessage(err)); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-6">
      <PageTitle
        title={`${label}s`}
        subtitle={kind === 'LEAD' ? 'The Team Leads of AI Studio, their projects and their teams.' : 'The Team Members of AI Studio, their Team Lead, projects and open work.'}
        actions={tab === 'list' ? <button type="button" className={primaryBtn} onClick={() => setTab('add')}><UserPlus className="w-4 h-4" aria-hidden="true" /> Add {label}</button> : undefined}
      />
      <Tabs<Tab> label={`${label} views`} value={tab} options={[{ id: 'list', label: `${label}s`, count: people.length }, { id: 'add', label: `Add ${label}` }]} onChange={setTab} />
      {tab === 'add' && (
        <StaffManagementPanel
          departmentSlug={departmentSlug}
          view="add"
          lockedRole={role}
          onCreated={() => { notifyAiStudioChanged(); reload(); }}
        />
      )}
      {tab === 'list' && (
        <Card>
          {error && <div className="p-4"><ErrorBanner message={error} onRetry={reload} /></div>}
          {problem && <div className="p-4"><ErrorBanner message={problem} /></div>}
          {loading && !data && <Spinner label={`Loading the ${label}s…`} />}
          {data && people.length === 0 && (
            <p className="py-12 px-6 text-center text-sm text-slate-500">
              No {label} yet. {kind === 'MEMBER' && leads.length === 0 ? 'Add a Team Lead first, then the Team Members who report to them.' : `Use Add ${label} to create the first one.`}
            </p>
          )}
          {data && people.length > 0 && (
            <TableWrap>
              <table className="w-full min-w-[52rem]">
                <thead className="border-b border-slate-100">
                  <tr>
                    <th className={thCls}>Employee</th>
                    {kind === 'MEMBER' && <th className={thCls}>Reports to</th>}
                    {kind === 'LEAD' && <th className={thCls}>Team Members</th>}
                    <th className={thCls}>Projects</th><th className={thCls}>Open tasks</th><th className={thCls}>Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {people.map(p => (
                    <tr key={p.id}>
                      <td className={tdCls}>
                        <div className="flex items-center gap-2.5"><Avatar name={p.fullName} />
                          <div className="min-w-0"><div className="font-bold text-slate-900 truncate">{p.fullName}</div><div className="text-xs text-slate-500 truncate">{p.email}{p.status !== 'ACTIVE' ? ` · ${p.status.toLowerCase()}` : ''}</div></div>
                        </div>
                      </td>
                      {kind === 'MEMBER' && (
                        <td className={tdCls}>
                          {p.status === 'ACTIVE'
                            ? (
                              <select aria-label={`Team Lead of ${p.fullName}`} className={`${fieldCls} !w-auto min-w-[10rem]`} value={p.leadId ?? ''} disabled={busy === p.id} onChange={e => void change(p, e.target.value)}>
                                {!p.leadId && <option value="">No Team Lead yet</option>}
                                {leads.map(l => <option key={l.id} value={l.id}>{l.fullName}</option>)}
                              </select>
                            )
                            : (p.leadName ?? '-')}
                        </td>
                      )}
                      {kind === 'LEAD' && <td className={tdCls}>{all.filter(m => m.role === 'TEAM_MEMBER' && m.leadId === p.id).length}</td>}
                      <td className={tdCls}>{p.projects.length ? p.projects.map(x => x.name).join(', ') : <span className="text-slate-400">-</span>}</td>
                      <td className={tdCls}>{p.openTasks}</td>
                      <td className={tdCls}>{p.completedTasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}
    </div>
  );
};
