import React, { useState } from 'react';
import { UserCheck, UserPlus } from 'lucide-react';
import type { AiStudioPerson } from '../../../shared/contracts';
import { aiStudioApi } from '../../lib/api/aiStudio';
import { errorMessage } from '../../lib/api/client';
import { PageTitle } from '../layout/shell';
import { Dialog, ErrorBanner, Field, Spinner } from '../team-member/pipeline/shared';
import { StaffManagementPanel } from '../common/StaffManagementPanel';
import { Avatar, Card, Tabs, fieldCls, ghostBtn, primaryBtn } from '../tasks/head/headParts';
import { notifyAiStudioChanged, useAiStudioChanged } from './aiStudioEvents';
import { TableWrap, dateText, tdCls, thCls, useLoad } from './ui';


type AssignFilter = 'all' | 'unassigned' | 'assigned';

/** Assignment status chip: Not Assigned (no Team Lead yet) / Assigned. */
const AssignmentBadge: React.FC<{ assigned: boolean }> = ({ assigned }) => (
  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${assigned ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{assigned ? 'Assigned' : 'Not Assigned'}</span>
);

/** Choose an active AI Studio Team Lead for the selected Team Members and save (all or nothing). */
const AssignLeadDialog: React.FC<{ members: AiStudioPerson[]; leads: AiStudioPerson[]; onClose: () => void; onDone: (message: string) => void }> = ({ members, leads, onClose, onDone }) => {
  const [leadId, setLeadId] = useState(leads[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadId) { setError('Choose a Team Lead.'); return; }
    setSaving(true);
    setError('');
    try {
      const r = await aiStudioApi.assignLead(members.map(m => m.id), leadId);
      const lead = leads.find(l => l.id === leadId)?.fullName ?? 'the Team Lead';
      notifyAiStudioChanged();
      onDone(r.assigned === 0 ? `Nothing changed: they already report to ${lead}.` : `${r.assigned} Team Member${r.assigned === 1 ? '' : 's'} assigned to ${lead}. They now appear in the Team Lead's dashboard.`);
    } catch (err) { setError(errorMessage(err)); setSaving(false); }
  };
  return (
    <Dialog title="Assign Team Lead" description={`${members.length} Team Member${members.length === 1 ? '' : 's'} selected: ${members.slice(0, 4).map(m => m.fullName).join(', ')}${members.length > 4 ? ` and ${members.length - 4} more` : ''}`} onClose={onClose} persistent={saving}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Team Lead" htmlFor="ai-al-lead" required>
          <select id="ai-al-lead" className={fieldCls} value={leadId} onChange={e => setLeadId(e.target.value)}>
            {leads.length === 0 && <option value="">No active Team Lead yet</option>}
            {leads.map(l => <option key={l.id} value={l.id}>{l.fullName}</option>)}
          </select>
        </Field>
        <p className="text-xs text-slate-500">Reports they submit from now on go to this Team Lead first, then to the Managing Director. Reports already submitted keep their route and history.</p>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={saving || !leadId}>{saving ? 'Saving…' : 'Assign Team Lead'}</button>
        </div>
      </form>
    </Dialog>
  );
};

/** Every AI Studio Team Member, with a filter for those not yet assigned to a Team Lead, multi-select and the Assign Team Lead action. */
const MembersList: React.FC<{ people: AiStudioPerson[]; leads: AiStudioPerson[]; onChanged: () => void }> = ({ people, leads, onChanged }) => {
  const [filter, setFilter] = useState<AssignFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState('');
  const members = people.filter(p => p.role === 'TEAM_MEMBER');
  const unassigned = members.filter(m => !m.leadId);
  const shown = members.filter(m => (filter === 'all' || (filter === 'unassigned') === !m.leadId) && (!search.trim() || `${m.fullName} ${m.email}`.toLowerCase().includes(search.trim().toLowerCase())));
  // a selection only ever holds people that are still listed
  const chosen = members.filter(m => selected.has(m.id) && m.status === 'ACTIVE');
  const allShownSelected = shown.filter(m => m.status === 'ACTIVE').length > 0 && shown.filter(m => m.status === 'ACTIVE').every(m => selected.has(m.id));
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(prev => {
    const n = new Set(prev);
    const ids = shown.filter(m => m.status === 'ACTIVE').map(m => m.id);
    if (allShownSelected) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id));
    return n;
  });
  return (
    <Card>
      <div className="p-4 border-b border-slate-100 space-y-3">
        {unassigned.length > 0 && (
          <p role="status" className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            {unassigned.length} Team Member{unassigned.length === 1 ? ' is' : 's are'} not assigned to a Team Lead yet. Their daily reports go straight to you until one is assigned.
          </p>
        )}
        {notice && <p role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs<AssignFilter> label="Assignment filter" value={filter} options={[{ id: 'all', label: 'All', count: members.length }, { id: 'unassigned', label: 'Not Assigned to Team Lead', count: unassigned.length }, { id: 'assigned', label: 'Assigned to Team Lead', count: members.length - unassigned.length }]} onChange={setFilter} />
          <div className="flex items-center gap-2">
            <input aria-label="Search Team Members" placeholder="Search name or e-mail" className={`${fieldCls} !w-56`} value={search} onChange={e => setSearch(e.target.value)} />
            <button type="button" className={primaryBtn} disabled={chosen.length === 0} onClick={() => { setNotice(''); setAssigning(true); }}>
              <UserCheck className="w-4 h-4" aria-hidden="true" /> Assign Team Lead{chosen.length ? ` (${chosen.length})` : ''}
            </button>
          </div>
        </div>
      </div>
      {members.length === 0 && <p className="py-12 px-6 text-center text-sm text-slate-500">No Team Member yet. Use Add Team Member: a Team Lead is not needed first.</p>}
      {members.length > 0 && shown.length === 0 && <p className="py-12 px-6 text-center text-sm text-slate-500">No Team Member matches this filter.</p>}
      {shown.length > 0 && (
        <TableWrap>
          <table className="w-full min-w-[56rem]">
            <thead className="border-b border-slate-100">
              <tr>
                <th className={`${thCls} w-10`}><input type="checkbox" aria-label="Select all listed Team Members" checked={allShownSelected} onChange={toggleAll} /></th>
                <th className={thCls}>Employee</th><th className={thCls}>Project</th><th className={thCls}>Created</th><th className={thCls}>Status</th><th className={thCls}>Assigned Team Lead</th><th className={thCls}>Open tasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map(m => (
                <tr key={m.id} className={selected.has(m.id) ? 'bg-blue-50/40' : ''}>
                  <td className={tdCls}><input type="checkbox" aria-label={`Select ${m.fullName}`} checked={selected.has(m.id)} disabled={m.status !== 'ACTIVE'} onChange={() => toggle(m.id)} /></td>
                  <td className={tdCls}>
                    <div className="flex items-center gap-2.5"><Avatar name={m.fullName} />
                      <div className="min-w-0"><div className="font-bold text-slate-900 truncate">{m.fullName}</div><div className="text-xs text-slate-500 truncate">{m.email}{m.status !== 'ACTIVE' ? ` · ${m.status.toLowerCase()}` : ''}</div></div>
                    </div>
                  </td>
                  <td className={tdCls}>{m.projects.length ? m.projects.map(x => x.name).join(', ') : <span className="text-slate-400">No project yet</span>}</td>
                  <td className={tdCls}>{dateText(m.joiningDate ?? m.createdAt)}</td>
                  <td className={tdCls}><AssignmentBadge assigned={!!m.leadId} /></td>
                  <td className={tdCls}>{m.leadName ?? <span className="text-slate-400">-</span>}</td>
                  <td className={tdCls}>{m.openTasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {assigning && <AssignLeadDialog members={chosen} leads={leads} onClose={() => setAssigning(false)} onDone={message => { setAssigning(false); setSelected(new Set()); setNotice(message); onChanged(); }} />}
    </Card>
  );
};

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
  const role = kind === 'LEAD' ? 'TEAM_HEAD' : 'TEAM_MEMBER';
  const label = kind === 'LEAD' ? 'Team Lead' : 'Team Member';
  const all = data ?? [];
  const people = all.filter(p => p.role === role);
  const leads = all.filter(p => p.role === 'TEAM_HEAD' && p.status === 'ACTIVE');
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
      {tab === 'list' && kind === 'MEMBER' && (
        <>
          {error && <ErrorBanner message={error} onRetry={reload} />}
          {loading && !data && <Spinner label="Loading the Team Members…" />}
          {data && <MembersList people={all} leads={leads} onChanged={reload} />}
        </>
      )}
      {tab === 'list' && kind === 'LEAD' && (
        <Card>
          {error && <div className="p-4"><ErrorBanner message={error} onRetry={reload} /></div>}
          {loading && !data && <Spinner label="Loading the Team Leads…" />}
          {data && people.length === 0 && <p className="py-12 px-6 text-center text-sm text-slate-500">No Team Lead yet. Use Add Team Lead to create the first one; Team Members can be added with or without one.</p>}
          {data && people.length > 0 && (
            <TableWrap>
              <table className="w-full min-w-[44rem]">
                <thead className="border-b border-slate-100">
                  <tr><th className={thCls}>Employee</th><th className={thCls}>Team Members</th><th className={thCls}>Projects</th><th className={thCls}>Open tasks</th><th className={thCls}>Completed</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {people.map(p => (
                    <tr key={p.id}>
                      <td className={tdCls}>
                        <div className="flex items-center gap-2.5"><Avatar name={p.fullName} />
                          <div className="min-w-0"><div className="font-bold text-slate-900 truncate">{p.fullName}</div><div className="text-xs text-slate-500 truncate">{p.email}{p.status !== 'ACTIVE' ? ` · ${p.status.toLowerCase()}` : ''}</div></div>
                        </div>
                      </td>
                      <td className={tdCls}>{all.filter(m => m.role === 'TEAM_MEMBER' && m.leadId === p.id).length}</td>
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
