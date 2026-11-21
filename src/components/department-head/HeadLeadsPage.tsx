import React, { useState } from 'react';
import { CheckCircle2, Plus, Search } from 'lucide-react';
import { AddLeadView } from '../team-member/pipeline/LeadForms';
import { CustomerQuickView } from '../team-member/pipeline/CustomerQuickView';
import { Pager, useDebounced } from '../team-member/pipeline/shared';
import { Avatar, Card, CardHead, fieldCls, LoadingLine, primaryBtn, StatCard, Tabs } from '../tasks/head/headParts';
import { dayText, headApi, inr, useHeadData, type LeadState } from '../../lib/headDashboard';
import { Badge, EmptyRow, LEAD_BADGE, PageError, Th } from './headBits';

type Filter = 'ALL' | LeadState;
const PAGE = 15;

/**
 * Leads of the head's department: the summary, the list (search, status, source) and "Add lead". The list is a read-only database function scoped to the
 * head's own department. "Add lead" is the CRM's existing lead form and lead creation; it only adds a "Lead owner" choice (the head, or a Team Lead / Team
 * Member of the department). The department is never sent: the database puts the lead in the owner's department and refuses anyone outside the head's.
 */
export const HeadLeadsPage: React.FC<{ /** Raised by the Overview's "Add lead": opens the page with the lead form open. */ startAdd?: number }> = ({ startAdd = 0 }) => {
  const [mode, setMode] = useState<'list' | 'add'>(startAdd > 0 ? 'add' : 'list');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const q = useDebounced(search, 300);
  const { data, error, loading, reload } = useHeadData(
    () => headApi.leads({ search: q, status: filter === 'ALL' ? null : filter, source: source || null, limit: PAGE, offset: (page - 1) * PAGE }),
    [q, filter, source, page]
  );
  const owners = useHeadData(() => headApi.leadOwners(), []);
  const s = data?.summary;

  if (mode === 'add') {
    return (
      <div className="space-y-4">
        {owners.error ? <PageError message={`The people you can give a lead to could not be loaded: ${owners.error}`} onRetry={owners.reload} /> : null}
        {owners.loading && !owners.data ? <LoadingLine label="Loading…" /> : (
          <AddLeadView
            owners={(owners.data ?? []).map(o => ({ id: o.id, name: o.role === 'Myself' ? 'Myself (Department Head)' : o.name, hint: o.role === 'Myself' ? undefined : [o.role, o.team].filter(Boolean).join(' · ') }))}
            onCancel={() => setMode('list')}
            onSaved={() => { setMode('list'); setNotice('Lead added to your department.'); reload(); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Leads</h1>
          <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">Every lead of your department, with where it stands.</p>
        </div>
        <button type="button" className={primaryBtn} onClick={() => { setNotice(null); setMode('add'); }} data-testid="add-lead"><Plus className="w-4 h-4" aria-hidden="true" /> Add lead</button>
      </div>
      {notice && <p className="p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-semibold flex items-center gap-2" role="status"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {notice}</p>}
      {error && <PageError message={error} onRetry={reload} />}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Lead summary">
        <StatCard label="Total leads" value={s?.total ?? '-'} testId="lead-total" />
        <StatCard label="New" value={s?.new ?? '-'} tone="blue" testId="lead-new" />
        <StatCard label="In progress" value={s?.inProgress ?? '-'} tone="amber" testId="lead-progress" />
        <StatCard label="Converted" value={s?.converted ?? '-'} tone="green" testId="lead-converted" />
        <StatCard label="Lost" value={s?.lost ?? '-'} testId="lead-lost" />
      </div>
      <Card label="Leads">
        <CardHead title="Lead list" hint={data ? `${data.total} lead${data.total === 1 ? '' : 's'}` : undefined} />
        <div className="px-5 pb-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <Tabs<Filter> label="Lead status" value={filter} onChange={f => { setFilter(f); setPage(1); }} options={[
              { id: 'ALL', label: 'All', count: s?.total }, { id: 'NEW', label: 'New', count: s?.new }, { id: 'IN_PROGRESS', label: 'In progress', count: s?.inProgress },
              { id: 'CONVERTED', label: 'Converted', count: s?.converted }, { id: 'LOST', label: 'Lost', count: s?.lost }]} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[13px] font-semibold text-slate-600 flex items-center gap-2">
                Source
                <select className={`${fieldCls} !h-10 w-44`} value={source} onChange={e => { setSource(e.target.value); setPage(1); }} aria-label="Lead source">
                  <option value="">All sources</option>
                  {(data?.sources ?? []).map(x => <option key={x.source} value={x.source}>{x.source} ({x.count})</option>)}
                </select>
              </label>
              <label className="relative lg:w-64">
                <span className="sr-only">Search leads</span>
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, company or phone" className={`${fieldCls} pl-9 !h-10 text-[13px]`} />
              </label>
            </div>
          </div>
        </div>
        {loading && !data ? <LoadingLine label="Loading leads…" /> : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><Th>Lead</Th><Th>Contact</Th><Th>Status</Th><Th>Source</Th><Th>Owner</Th><Th>Services</Th><Th>Added</Th></tr></thead>
              <tbody className="divide-y divide-slate-100" data-testid="lead-rows">
                {data?.items.length === 0 && <EmptyRow cols={7} title={filter === 'ALL' && !q && !source ? 'No leads yet' : 'No leads match'} hint={filter === 'ALL' && !q && !source ? 'Choose "Add lead" to add the first one.' : 'Try another filter or search.'} />}
                {data?.items.map(l => (
                  <tr key={l.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setOpenId(l.id)} data-testid="lead-row">
                    <td className="px-4 py-3">
                      <button type="button" className="text-left font-semibold text-slate-900 hover:text-blue-700" onClick={e => { e.stopPropagation(); setOpenId(l.id); }} aria-label={`Open lead ${l.name}`}>{l.company || l.name}</button>
                      <span className="block text-[11px] text-slate-500">{l.company ? l.name : l.code}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{l.phone || '-'}{l.email ? <span className="block text-[11px] text-slate-400">{l.email}</span> : null}</td>
                    <td className="px-4 py-3"><Badge tone={LEAD_BADGE[l.state].tone}>{LEAD_BADGE[l.state].label}</Badge></td>
                    <td className="px-4 py-3 text-slate-600">{l.source || <span className="text-slate-400">Not recorded</span>}</td>
                    <td className="px-4 py-3">{l.owner ? <span className="flex items-center gap-2"><Avatar name={l.owner.name} size={26} /><span className="text-slate-700">{l.owner.name}</span></span> : '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{l.services.length ? `${l.services[0]!.name}${l.services.length > 1 ? ` +${l.services.length - 1}` : ''}` : '-'}{l.expectedBudget ? <span className="block text-[11px] text-slate-400">Budget {inr(l.expectedBudget)}</span> : null}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dayText(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE && <Pager page={page} pageSize={PAGE} total={data.total} noun="leads" onPage={setPage} sizes={[PAGE]} />}
      </Card>
      {openId && <CustomerQuickView id={openId} title="Lead details" onClose={() => setOpenId(null)} />}
    </div>
  );
};
