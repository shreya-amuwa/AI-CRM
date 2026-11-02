import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownUp, Eye, MapPinned, Search, UserCheck } from 'lucide-react';
import { SALES_LEAD_FILTERS, type SalesTeamPerson, type SalesLeadDetail, type SalesLeadFilter, type SalesLeadList, type SalesLeadRow } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { salesHeadApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Avatar, Card, Tabs } from '../tasks/head/headParts';
import { Dialog, ErrorBanner, Pager, Spinner, useDebounced } from '../team-member/pipeline/shared';
import { CallStatusBadge, EmptyState, TemperatureBadge, dateText, dateTimeText, tcBtn, tcInput, tcSelect } from '../telecaller/ui';
import { AssignVisitDialog } from '../field-visit/AssignVisitDialog';
import type { SalesHeadNavigate } from './SalesHeadDashboard';

const FILTER_LABEL: Record<SalesLeadFilter, string> = {
  ALL: 'All Leads', HOT: 'Hot Leads', WARM: 'Warm Leads', COLD: 'Cold Leads', UNASSIGNED: 'Unassigned', ASSIGNED: 'Assigned', FOLLOW_UP: 'Follow-up Required', CONVERTED: 'Converted'
};
const COUNT_KEY: Record<SalesLeadFilter, keyof SalesLeadList['counts']> = {
  ALL: 'all', HOT: 'hot', WARM: 'warm', COLD: 'cold', UNASSIGNED: 'unassigned', ASSIGNED: 'assigned', FOLLOW_UP: 'followUp', CONVERTED: 'converted'
};
const SORTS: { id: string; label: string }[] = [
  { id: 'assignedAt', label: 'Assigned date' }, { id: 'name', label: 'Customer name' }, { id: 'company', label: 'Company' }, { id: 'temperature', label: 'Temperature' },
  { id: 'callStatus', label: 'Call status' }, { id: 'lastContacted', label: 'Last contacted' }, { id: 'followUp', label: 'Follow-up date' }, { id: 'assignee', label: 'Assigned to' }
];
const isFilter = (v: string | undefined): v is SalesLeadFilter => !!v && (SALES_LEAD_FILTERS as readonly string[]).includes(v);

const Conversion: React.FC<{ row: SalesLeadRow }> = ({ row }) =>
  row.converted ? (
    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 whitespace-nowrap">Converted · {row.stage.charAt(0) + row.stage.slice(1).toLowerCase()}</span>
  ) : row.kind === 'INBOUND' ? (
    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 whitespace-nowrap">Not taken yet</span>
  ) : (
    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 whitespace-nowrap">In pipeline</span>
  );

/** Lead List: the leads of the Sales teams (and the enquiries nobody has taken), searchable, filterable and sortable. */
export const LeadList: React.FC<{ initialFilter?: string; go: SalesHeadNavigate }> = ({ initialFilter }) => {
  const [filter, setFilter] = useState<SalesLeadFilter>(isFilter(initialFilter) ? initialFilter : 'ALL');
  const [search, setSearch] = useState('');
  const query = useDebounced(search, 300);
  const [assignee, setAssignee] = useState('');
  const [sort, setSort] = useState('assignedAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<SalesLeadList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<SalesTeamPerson[]>([]);
  const [detail, setDetail] = useState<{ id: string; lead: SalesLeadDetail | null; error?: string } | null>(null);
  const [assigning, setAssigning] = useState<SalesLeadRow | null>(null);
  const [visitFor, setVisitFor] = useState<SalesLeadRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setPage(1), [filter, query, assignee, sort, dir, pageSize]);
  useEffect(() => {
    salesHeadApi.teamPeople().then(setPeople, () => setPeople([]));
  }, []);

  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current; // a slower, older answer must not overwrite a newer one
    setLoading(true);
    setError(null);
    salesHeadApi.leads({ search: query || undefined, filter, assigneeId: assignee || undefined, sort, dir, page, pageSize }).then(
      d => mine === latest.current && (setData(d), setLoading(false)),
      e => mine === latest.current && (setError(errorMessage(e)), setLoading(false))
    );
  }, [query, filter, assignee, sort, dir, page, pageSize]);
  useEffect(load, [load]);

  const open = (row: SalesLeadRow) => {
    setDetail({ id: row.id, lead: null });
    salesHeadApi.lead(row.id).then(
      lead => setDetail(d => (d?.id === row.id ? { id: row.id, lead } : d)),
      e => setDetail(d => (d?.id === row.id ? { id: row.id, lead: null, error: errorMessage(e) } : d))
    );
  };

  const counts = data?.counts;
  return (
    <div className="space-y-5">
      <PageTitle title="Lead List" subtitle="Every lead of the Sales teams: who owns it, how warm it is and when it was last followed up." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">{notice}</div>}

      <Tabs
        label="Lead filter"
        value={filter}
        onChange={setFilter}
        options={SALES_LEAD_FILTERS.map(f => ({ id: f, label: FILTER_LABEL[f], count: counts ? counts[COUNT_KEY[f]] : undefined }))}
      />

      <Card className="overflow-hidden">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
          <div className="relative flex-1 min-w-[14rem] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className={`${tcInput} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, company, phone, email or lead ID" aria-label="Search leads" />
          </div>
          <select className={tcSelect} value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="Filter by assigned team member">
            <option value="">All team members</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <select className={tcSelect} value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort leads by">
              {SORTS.map(s => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
            </select>
            <button type="button" className={tcBtn.row} onClick={() => setDir(d => (d === 'asc' ? 'desc' : 'asc'))} aria-label={`Sort order: ${dir === 'asc' ? 'ascending' : 'descending'}`}>
              <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" /> {dir === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>
        </div>

        {loading && !data ? <Spinner label="Loading leads…" /> : !data || data.items.length === 0 ? (
          <EmptyState title={query || assignee || filter !== 'ALL' ? 'No leads match' : 'No leads yet'}>
            {query || assignee || filter !== 'ALL' ? 'Try another filter or clear the search.' : 'Leads appear here when you assign an Excel sheet or a team member adds one.'}
          </EmptyState>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[1500px]" aria-busy={loading}>
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 bg-slate-50/60">
                    {['Lead ID', 'Customer Name', 'Company / Business', 'Phone', 'Email', 'Lead Source', 'Temperature', 'Call Status', 'Assigned To', 'Assigned', 'Last Contacted', 'Follow-up', 'Conversion', 'Actions'].map(h => (
                      <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map(l => (
                    <tr key={l.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 text-xs font-mono text-slate-500 whitespace-nowrap">{l.leadCode}</td>
                      <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={l.name} /><span className="font-semibold text-slate-900 text-[13px] whitespace-nowrap">{l.name}</span></div></td>
                      <td className="px-4 py-3 text-slate-600 min-w-[9rem]">{l.company || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{l.phone ? <a href={`tel:${l.phone}`} className="text-blue-600 hover:underline">{l.phone}</a> : '-'}</td>
                      <td className="px-4 py-3 text-slate-600 min-w-[16rem] whitespace-nowrap">{l.email || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{l.source || '-'}</td>
                      <td className="px-4 py-3"><TemperatureBadge value={l.temperature} /></td>
                      <td className="px-4 py-3"><CallStatusBadge status={l.callStatus} /></td>
                      <td className="px-4 py-3 whitespace-nowrap">{l.assignee ? <span className="text-slate-800 font-medium">{l.assignee}</span> : <span className="text-amber-700 font-semibold">Unassigned</span>}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateText(l.assignedAt)}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateText(l.lastContacted)}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateText(l.followUp)}</td>
                      <td className="px-4 py-3"><Conversion row={l} /></td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button type="button" className={tcBtn.row} onClick={() => open(l)} aria-label={`View ${l.name}`}><Eye className="w-3.5 h-3.5" aria-hidden="true" /> View</button>
                          {l.kind === 'INBOUND' && <button type="button" className={tcBtn.row} onClick={() => setAssigning(l)} aria-label={`Assign ${l.name}`}><UserCheck className="w-3.5 h-3.5" aria-hidden="true" /> Assign</button>}
                          {l.kind === 'CUSTOMER' && <button type="button" className={tcBtn.row} onClick={() => setVisitFor(l)} aria-label={`Assign ${l.name} for a field visit`} data-testid="assign-visit"><MapPinned className="w-3.5 h-3.5" aria-hidden="true" /> Field visit</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="lg:hidden divide-y divide-slate-100">
              {data.items.map(l => (
                <li key={l.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="font-semibold text-slate-900">{l.name}</div><div className="text-xs text-slate-500">{l.company || 'No company'} · {l.leadCode}</div></div>
                    <TemperatureBadge value={l.temperature} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {l.phone && <a href={`tel:${l.phone}`} className="text-blue-600 font-semibold">{l.phone}</a>}
                    <CallStatusBadge status={l.callStatus} /><Conversion row={l} />
                  </div>
                  <div className="text-xs text-slate-500">{l.assignee ? `Owner ${l.assignee}` : 'Unassigned'} · Follow-up {dateText(l.followUp)}</div>
                  <div className="flex gap-2">
                    <button type="button" className={tcBtn.row} onClick={() => open(l)}><Eye className="w-3.5 h-3.5" aria-hidden="true" /> View</button>
                    {l.kind === 'INBOUND' && <button type="button" className={tcBtn.row} onClick={() => setAssigning(l)}><UserCheck className="w-3.5 h-3.5" aria-hidden="true" /> Assign</button>}
                    {l.kind === 'CUSTOMER' && <button type="button" className={tcBtn.row} onClick={() => setVisitFor(l)}><MapPinned className="w-3.5 h-3.5" aria-hidden="true" /> Field visit</button>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="p-4 border-t border-slate-100">
              <Pager page={page} pageSize={pageSize} total={data.total} noun="leads" onPage={setPage} onPageSize={setPageSize} />
            </div>
          </>
        )}
      </Card>

      {detail && (
        <Dialog title={detail.lead?.name ?? 'Lead'} description={detail.lead ? `${detail.lead.leadCode} · ${detail.lead.company || 'No company'}` : undefined} onClose={() => setDetail(null)} wide>
          {detail.error ? <ErrorBanner message={detail.error} /> : !detail.lead ? <Spinner label="Loading the lead…" /> : <LeadDetailBody lead={detail.lead} />}
        </Dialog>
      )}
      {visitFor && (
        <AssignVisitDialog
          lead={visitFor}
          onClose={() => setVisitFor(null)}
          onDone={message => {
            setVisitFor(null);
            setNotice(message);
            setTimeout(() => setNotice(null), 5000);
          }}
        />
      )}
      {assigning && (
        <AssignInbound
          lead={assigning}
          people={people.filter(p => p.subRole === null)}
          onClose={() => setAssigning(null)}
          onDone={name => {
            setAssigning(null);
            setNotice(`${assigning.name} was assigned to ${name}.`);
            setTimeout(() => setNotice(null), 5000);
            load();
          }}
        />
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><dt className="text-[11px] font-semibold text-slate-500">{label}</dt><dd className="text-sm text-slate-900">{children}</dd></div>
);

const LeadDetailBody: React.FC<{ lead: SalesLeadDetail }> = ({ lead }) => {
  const d = (lead.details ?? {}) as Record<string, unknown>;
  const text = (k: string) => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : '-');
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Row label="Phone">{lead.phone || '-'}</Row>
        <Row label="Email">{lead.email || '-'}</Row>
        <Row label="Lead source">{lead.source || '-'}</Row>
        <Row label="Owner">{lead.assignee ? `${lead.assignee}${lead.team ? ` · ${lead.team}` : ''}` : 'Unassigned (not taken yet)'}</Row>
        <Row label="Temperature"><TemperatureBadge value={lead.temperature} /></Row>
        <Row label="Call status"><CallStatusBadge status={lead.callStatus} /></Row>
        <Row label="Assigned">{dateText(lead.assignedAt)}</Row>
        <Row label="Last contacted">{dateTimeText(lead.lastContacted)}</Row>
        <Row label="Follow-up">{dateTimeText(lead.followUp)}</Row>
        <Row label="Stage">{lead.converted ? `Converted · ${lead.stage.toLowerCase()}` : lead.stage.toLowerCase()}</Row>
        {lead.sheet && <Row label="Imported from">{lead.sheet}</Row>}
        {lead.kind === 'CUSTOMER' && <Row label="City">{text('city')}</Row>}
        <div className="col-span-2"><Row label="Notes">{text('notes') !== '-' ? text('notes') : text('requirement')}</Row></div>
      </dl>
      <div>
        <h3 className="text-sm font-extrabold text-slate-900 mb-2">Latest follow-up details</h3>
        {lead.history.length === 0 ? <p className="text-sm text-slate-500">No activity recorded yet.</p> : (
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {lead.history.map((h, i) => (
              <li key={i} className="text-sm border-l-2 border-blue-100 pl-3"><div className="text-xs text-slate-500">{dateTimeText(h.at)} · {h.type.toLowerCase().replace(/_/g, ' ')}</div>{h.note && <div className="text-slate-800">{h.note}</div>}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const AssignInbound: React.FC<{ lead: SalesLeadRow; people: SalesTeamPerson[]; onClose: () => void; onDone: (name: string) => void }> = ({ lead, people, onClose, onDone }) => {
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!who || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await salesHeadApi.assignInbound(lead.id, who);
      onDone(r.assignee);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Assign ${lead.name}`} description="This enquiry has not been taken by anyone. It becomes a lead in the pipeline of the person you choose." onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <label className="block text-xs font-semibold text-slate-700">
          Sales team member
          <select className={`${tcInput} mt-1`} value={who} onChange={e => setWho(e.target.value)}>
            <option value="">Choose…</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role} · {p.team}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={tcBtn.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={tcBtn.primary} disabled={!who || busy} onClick={submit}>{busy ? 'Assigning…' : 'Assign lead'}</button>
        </div>
      </div>
    </Dialog>
  );
};
