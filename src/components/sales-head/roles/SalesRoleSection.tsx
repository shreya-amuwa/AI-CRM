import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import type { SalesRole, SalesRoleList, SalesRolePersonDashboard } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { salesHeadApi } from '../../../lib/api/endpoints';
import { saveBlob, toCsv } from '../../../lib/xlsxWriter';
import { PageTitle } from '../../layout/shell';
import { Avatar, Card, CardHead, Tabs } from '../../tasks/head/headParts';
import { ErrorBanner, Spinner } from '../../team-member/pipeline/shared';
import { EmptyState, dateText, dateTimeText, tcBtn, tcInput, tcSelect } from '../../telecaller/ui';
import { PeriodBar, lastDays, type Range } from '../periodBar';
import { CROCODIAL_STATE_TEXT, ROLE_CONFIG, exportFileName, exportRows, formatMetric, rollUp, statusLabel, type Grain } from './salesRoleView';
import { callDuration, callTypeLabel, connectedLabel } from '../../../../shared/crocodialFields';

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SUSPENDED: 'bg-amber-50 text-amber-700 border-amber-200',
  REVOKED: 'bg-slate-100 text-slate-600 border-slate-200'
};
const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status] ?? STATUS_STYLE.REVOKED}`}>{statusLabel(status)}</span>
);
const PAGE_SIZE = 25;
const label = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : '–');

/**
 * One Sales role's list (Telecaller / Business Associate): filters, search, sort, pages and a CSV export. The database decides who is listed
 * (the head's own department, its Sales teams, that role) and counts every figure; nothing here is estimated.
 */
export const SalesRoleListPage: React.FC<{ role: SalesRole; onOpen: (id: string) => void }> = ({ role, onOpen }) => {
  const cfg = ROLE_CONFIG[role];
  const [range, setRange] = useState<Range>(lastDays(30));
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [teamLeadId, setTeamLeadId] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<SalesRoleList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // typing waits a moment before asking the server
  useEffect(() => {
    const t = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => ({ from: range.from, to: range.to, search: term || undefined, teamLeadId: teamLeadId || undefined, status: status || undefined, sort }),
    [range, term, teamLeadId, status, sort]);
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current; // an older, slower answer never overwrites a newer one
    setLoading(true);
    setError(null);
    salesHeadApi.roleList(role, { ...query, page, pageSize: PAGE_SIZE }).then(
      r => { if (mine === latest.current) { setList(r); setLoading(false); } },
      e => { if (mine === latest.current) { setError(errorMessage(e)); setLoading(false); } }
    );
  }, [role, query, page]);
  useEffect(load, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await salesHeadApi.roleList(role, { ...query, page: 1, pageSize: 500 });
      saveBlob(toCsv(exportRows(all)), exportFileName(all));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;
  // the Crocodial columns first, then the CRM ones (a person without Crocodial figures gets one cell saying why, never zeros)
  const crocCols = cfg.columns.filter(c => c.source === 'CROCODIAL');
  const crmCols = cfg.columns.filter(c => c.source === 'CRM');
  const sortHead = (key: string, text: string, align = 'text-right', croc = false) => (
    <th scope="col" className={`px-3 py-2.5 font-bold ${align}`} aria-sort={sort === key ? (key === 'name' || key === 'teamLead' || key === 'status' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-blue-700" onClick={() => { setSort(key); setPage(1); }}>
        {text}{sort === key && <ArrowDown className="w-3 h-3" aria-hidden="true" />}
      </button>
      {croc && <span className="block text-[10px] font-semibold text-indigo-600">Crocodial</span>}
    </th>
  );

  return (
    <div className="space-y-5" data-testid={`role-list-${role}`}>
      <PageTitle title={cfg.title} subtitle={cfg.subtitle}
        actions={<button type="button" className={tcBtn.secondary} onClick={exportCsv} disabled={exporting || !list?.total}><Download className="w-4 h-4" aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export CSV'}</button>} />
      <Card className="p-4 space-y-4">
        <PeriodBar value={range} onChange={r => { setRange(r); setPage(1); }} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold text-slate-700">Name or Employee ID
            <span className="relative block mt-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input aria-label="Name or Employee ID" className={`${tcInput} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, ID, e-mail, phone" />
            </span>
          </label>
          <label className="text-xs font-semibold text-slate-700">Team Lead
            <select aria-label="Team Lead" className={`${tcSelect} mt-1`} value={teamLeadId} onChange={e => { setTeamLeadId(e.target.value); setPage(1); }}>
              <option value="">All Team Leads</option>
              {(list?.teamLeads ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">Status
            <select aria-label="Status" className={`${tcSelect} mt-1`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Any status</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="REVOKED">Access removed</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">Sort by
            <select aria-label="Sort by" className={`${tcSelect} mt-1`} value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}>
              <option value="name">Name (A–Z)</option>
              <option value="teamLead">Team Lead</option>
              <option value="status">Status</option>
              {cfg.columns.filter(c => c.sortable).map(c => <option key={c.key} value={c.key}>{c.label} (highest first)</option>)}
            </select>
          </label>
        </div>
      </Card>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!list && !error && <Spinner />}
      {list && (
        <Card className="overflow-hidden">
          {list.items.length === 0 ? (
            <div className="p-6">
              <EmptyState title={term || teamLeadId || status ? `No ${cfg.noun} matches these filters.` : `No ${cfg.noun}s in your Sales teams yet.`}>
                {!(term || teamLeadId || status) && `Give a Sales member the ${cfg.noun} role in Team Members & Access and they appear here.`}
              </EmptyState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-busy={loading}>
                <caption className="sr-only">{cfg.title}, {dateText(list.from)} to {dateText(list.to)}</caption>
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    {sortHead('name', 'Name', 'text-left')}
                    <th scope="col" className="px-3 py-2.5 text-left font-bold">Employee ID</th>
                    {sortHead('teamLead', 'Team Lead', 'text-left')}
                    {[...crocCols, ...crmCols].map(c => <React.Fragment key={c.key}>{sortHead(c.key, c.label, 'text-right', c.source === 'CROCODIAL')}</React.Fragment>)}
                    {sortHead('status', 'Status', 'text-left')}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.items.map(p => (
                    <tr key={p.id} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2.5">
                        <button type="button" className="flex items-center gap-2 text-left font-semibold text-slate-900 hover:text-blue-700" onClick={() => onOpen(p.id)}
                          aria-label={`Open ${p.name}'s dashboard`}>
                          <Avatar name={p.name} size={28} />
                          <span className="min-w-0"><span className="block truncate max-w-[12rem]">{p.name}</span>
                            <span className="block text-[11px] font-normal text-slate-500">{p.teamName ?? 'No team'}</span></span>
                        </button>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{p.employeeCode}</td>
                      <td className="px-3 py-2.5 text-slate-700">{p.teamLeadName ?? '–'}</td>
                      {p.metrics.crocodial === 'ON' ? crocCols.map(c => <td key={c.key} className="px-3 py-2.5 text-right tabular-nums">{formatMetric(p.metrics[c.key] as number | null, c.format)}</td>)
                        : <td colSpan={crocCols.length} className="px-3 py-2.5 text-center text-xs text-slate-500">{CROCODIAL_STATE_TEXT[p.metrics.crocodial]}</td>}
                      {crmCols.map(c => <td key={c.key} className="px-3 py-2.5 text-right tabular-nums">{formatMetric(p.metrics[c.key] as number | null, c.format)}</td>)}
                      <td className="px-3 py-2.5"><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
            <span>{list.total} {list.total === 1 ? cfg.noun : `${cfg.noun}s`} · {dateText(list.from)} – {dateText(list.to)}</span>
            <span className="flex items-center gap-2">
              <button type="button" className={tcBtn.row} disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
              Page {Math.min(page, pages)} of {pages}
              <button type="button" className={tcBtn.row} disabled={page >= pages || loading} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
            </span>
          </div>
        </Card>
      )}
    </div>
  );
};

const SOURCE_TAG = { CROCODIAL: 'Crocodial', CRM: 'CRM' } as const;

/** One person's full-page dashboard: their details, the figures of the period, day / week / month figures and the records behind them. */
export const SalesRolePersonPage: React.FC<{ role: SalesRole; id: string; onBack: () => void }> = ({ role, id, onBack }) => {
  const cfg = ROLE_CONFIG[role];
  const [range, setRange] = useState<Range>(lastDays(30));
  const [data, setData] = useState<SalesRolePersonDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grain, setGrain] = useState<Grain>('DAY');
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    setError(null);
    salesHeadApi.rolePerson(role, id, range).then(r => mine === latest.current && setData(r), e => mine === latest.current && setError(errorMessage(e)));
  }, [role, id, range]);
  useEffect(load, [load]);

  const croc = data?.crocodial.state ?? 'OFF';
  // the series of the period; the Crocodial ones only when the person is connected (otherwise they would read as zeros)
  const series = useMemo(() => cfg.series.filter(s => s.source === 'CRM' || croc === 'ON'), [cfg, croc]);
  const rows = useMemo(() => (data ? rollUp(data.daily, series.map(s => s.key), grain) : []), [data, series, grain]);
  const max = useMemo(() => Math.max(1, ...rows.map(r => r.values[series[0]?.key] ?? 0)), [rows, series]);
  const back = <button type="button" className={tcBtn.secondary} onClick={onBack}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to {cfg.title}</button>;

  if (error && !data) {
    return <div className="space-y-4">{back}<ErrorBanner message={error} onRetry={load} /></div>;
  }
  if (!data) return <div className="space-y-4">{back}<Spinner /></div>;
  const p = data.person;
  const crocCards = cfg.cards.filter(c => c.source === 'CROCODIAL');
  const crmCards = cfg.cards.filter(c => c.source === 'CRM');
  const card = (c: (typeof cfg.cards)[number]) => (
    <div key={c.key} className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-500">{c.label}</div>
      <div className="mt-1 text-2xl font-extrabold text-slate-900 tabular-nums" data-testid={`metric-${c.key}`}>{formatMetric(data.metrics[c.key] as number | null, c.format)}</div>
    </div>
  );
  return (
    <div className="space-y-5" data-testid={`role-person-${role}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">{back}</div>
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={p.name} size={52} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold text-slate-900 flex flex-wrap items-center gap-2">{p.name} <StatusBadge status={p.status} /></h1>
            <p className="text-sm text-slate-600 mt-1">{cfg.noun} · {p.teamName ?? 'No team'} · Team Lead {p.teamLeadName ?? '–'}</p>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="inline font-semibold">Employee ID: </dt><dd className="inline font-mono">{p.employeeCode}</dd></div>
              <div><dt className="inline font-semibold">E-mail: </dt><dd className="inline break-all">{p.email ?? '–'}</dd></div>
              <div><dt className="inline font-semibold">Phone: </dt><dd className="inline">{p.phone ?? '–'}</dd></div>
              <div><dt className="inline font-semibold">In the CRM since: </dt><dd className="inline">{dateText(p.joinedAt)}</dd></div>
            </dl>
          </div>
        </div>
      </Card>
      <Card className="p-4"><PeriodBar value={range} onChange={setRange} /></Card>
      {error && <ErrorBanner message={error} onRetry={load} />}

      <section aria-label="Calls (Crocodial)" className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">Calls <span className="font-normal text-slate-500">· source: Crocodial{data.crocodial.lastSyncAt ? `, last synced ${dateTimeText(data.crocodial.lastSyncAt)}` : ''}</span></h2>
        {croc === 'ON' ? (
          <>
            {data.crocodial.stale && <p className="text-xs text-amber-800" role="status">The last complete Crocodial sync is more than 24 hours old: these figures may not be current.</p>}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">{crocCards.map(card)}</div>
          </>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" role="status" data-testid="croc-state">
            {croc === 'OFF' ? `${p.name} is not connected to Crocodial, so there are no call figures. The Super Admin connects a person under Crocodial Integration > People.`
              : 'Crocodial is connected but the first sync has not finished: call figures appear once it has (they are not zero).'}
          </p>
        )}
      </section>
      <section aria-label="CRM records" className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{role === 'TELECALLER' ? 'Leads' : 'Leads, demos and deals'} <span className="font-normal text-slate-500">· source: CRM</span></h2>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">{crmCards.map(card)}</div>
      </section>

      <Card>
        <CardHead title="Performance over time" hint={`${dateText(data.from)} – ${dateText(data.to)}`}
          right={<Tabs label="Group by" value={grain} onChange={setGrain} options={[{ id: 'DAY', label: 'Daily' }, { id: 'WEEK', label: 'Weekly' }, { id: 'MONTH', label: 'Monthly' }]} />} />
        <div className="overflow-x-auto px-2 pb-4 max-h-[26rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-600 sticky top-0 bg-white">
              <tr><th scope="col" className="px-3 py-2 text-left">{grain === 'DAY' ? 'Day' : grain === 'WEEK' ? 'Week' : 'Month'}</th>
                {series.map(s => <th key={s.key} scope="col" className="px-3 py-2 text-right">{s.label}<span className="block text-[10px] font-normal text-slate-400">{SOURCE_TAG[s.source]}</span></th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...rows].reverse().map(r => (
                <tr key={r.label}>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="block">{r.label}</span>
                    <span className="block h-1.5 mt-1 rounded-full bg-blue-500/80" style={{ width: `${Math.round(((r.values[series[0]?.key] ?? 0) / max) * 100)}%`, minWidth: r.values[series[0]?.key] ? 4 : 0 }} aria-hidden="true" />
                  </td>
                  {series.map(s => <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">{r.values[s.key] ?? '–'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Records data={data} />
    </div>
  );
};

function RecordTable<T>({ title, hint, rows, empty, cols, rowKey }: {
  title: string; hint?: string; rows: T[] | undefined; empty: string; rowKey: (r: T) => string;
  cols: { head: string; cell: (r: T) => React.ReactNode; right?: boolean }[];
}) {
  const list = rows ?? [];
  return (
    <Card>
      <CardHead title={`${title} (${list.length})`} hint={hint} />
      {list.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-500">{empty}</p> : (
        <div className="overflow-x-auto px-2 pb-3 max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-600 sticky top-0 bg-white"><tr>{cols.map(c => <th key={c.head} scope="col" className={`px-3 py-2 ${c.right ? 'text-right' : 'text-left'}`}>{c.head}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map(r => <tr key={rowKey(r)}>{cols.map(c => <td key={c.head} className={`px-3 py-1.5 align-top ${c.right ? 'text-right tabular-nums' : ''}`}>{c.cell(r)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const money = (n: number | null | undefined) => formatMetric(n ?? null, 'money');

type Tab = 'calls' | 'leads' | 'contacts' | 'demos' | 'quotations' | 'deals';
/** The records behind the figures: the Crocodial call log (when connected), then the CRM records of the role. */
const Records: React.FC<{ data: SalesRolePersonDashboard }> = ({ data }) => {
  const r = data.records;
  const croc = data.crocodial.state === 'ON';
  const tabs: { id: Tab; label: string; count?: number }[] = [
    ...(croc ? [{ id: 'calls' as Tab, label: 'Calls', count: r.calls.length }] : []),
    ...(data.role === 'TELECALLER'
      ? [{ id: 'leads' as Tab, label: 'Leads', count: r.leads?.length ?? 0 }]
      : [{ id: 'contacts' as Tab, label: 'Leads assigned', count: r.contacts?.length ?? 0 }, { id: 'demos' as Tab, label: 'Demos', count: r.demos?.length ?? 0 },
         { id: 'quotations' as Tab, label: 'Quotations', count: r.quotations?.length ?? 0 }, { id: 'deals' as Tab, label: 'Deals', count: r.deals?.length ?? 0 }])
  ];
  const [tab, setTab] = useState<Tab>(tabs[0].id);
  const current = tabs.some(t => t.id === tab) ? tab : tabs[0].id;
  return (
    <div className="space-y-3">
      <Tabs label="Records" value={current} onChange={setTab} options={tabs} />
      {current === 'calls' && <RecordTable title="Calls" hint="The Crocodial call log of the period, newest first (the calls the figures count)." rows={r.calls} rowKey={c => String(c.id)}
        empty="No calls in this period."
        cols={[
          { head: 'Date and time', cell: c => dateTimeText(c.callAt) },
          { head: 'Contact', cell: c => <><span className="font-semibold">{c.contactName || 'Unknown'}</span>{c.leadStatus && <span className="block text-xs text-slate-500">Lead status: {c.leadStatus}</span>}</> },
          { head: 'Number', cell: c => c.phone ?? '–' },
          { head: 'Type', cell: c => callTypeLabel(c.type) },
          { head: 'Status', cell: c => <span className={c.connected === true ? 'font-semibold text-emerald-700' : c.connected === false ? 'text-rose-700' : 'text-slate-500'}>{connectedLabel(c.connected)}</span> },
          { head: 'Duration', cell: c => callDuration(c.durationSeconds, c.connected), right: true }
        ]} />}
      {current === 'leads' && <RecordTable title="Leads" hint="Leads they created in the period, and to whom each was converted." rows={r.leads} rowKey={l => l.id} empty="No leads in this period."
        cols={[
          { head: 'Lead', cell: l => <><span className="font-semibold">{l.name}</span>{l.company && <span className="block text-xs text-slate-500">{l.company}</span>}</> },
          { head: 'Stage', cell: l => label(l.stage) },
          { head: 'Lead status', cell: l => label(l.leadStatus) },
          { head: 'Converted to', cell: l => l.convertedTo ?? '–' },
          { head: 'Created', cell: l => dateText(l.createdAt) }
        ]} />}
      {current === 'contacts' && <RecordTable title="Leads assigned" hint="Contacts assigned to them in the period, newest first." rows={r.contacts} rowKey={c => c.id} empty="No leads assigned in this period."
        cols={[
          { head: 'Client', cell: c => <><span className="font-semibold">{c.name}</span>{c.company && <span className="block text-xs text-slate-500">{c.company}</span>}</> },
          { head: 'Stage', cell: c => label(c.stage) },
          { head: 'From Telecaller', cell: c => c.telecaller ?? '–' },
          { head: 'Assigned', cell: c => dateText(c.assignedAt) }
        ]} />}
      {current === 'demos' && <RecordTable title="Demos" hint="Demos starting in the period (CRM demo schedule)." rows={r.demos} rowKey={d => d.id} empty="No demos in this period."
        cols={[
          { head: 'Demo', cell: d => <><span className="font-semibold">{d.title}</span><span className="block text-xs text-slate-500">{d.client}</span></> },
          { head: 'When', cell: d => dateTimeText(d.startsAt) },
          { head: 'Mode', cell: d => (d.mode === 'IN_PERSON' ? 'In person' : 'Online') },
          { head: 'Status', cell: d => label(d.status) }
        ]} />}
      {current === 'quotations' && <RecordTable title="Final quotations" hint="Finalised in the period; each quotation once, at its latest revision." rows={r.quotations} rowKey={q => q.id} empty="No quotations finalised in this period."
        cols={[
          { head: 'Number', cell: q => <span className="font-mono text-xs">{q.number} · rev {q.revision}</span> },
          { head: 'Client', cell: q => q.client },
          { head: 'Total', cell: q => money(q.total), right: true },
          { head: 'Finalised', cell: q => dateText(q.finalizedAt) }
        ]} />}
      {current === 'deals' && <RecordTable title="Deals closed" hint="Their leads that moved to Onboarding or Customer in the period." rows={r.deals} rowKey={d => d.id} empty="No deals closed in this period."
        cols={[
          { head: 'Client', cell: d => <><span className="font-semibold">{d.name}</span>{d.company && <span className="block text-xs text-slate-500">{d.company}</span>}</> },
          { head: 'Stage', cell: d => label(d.stage) },
          { head: 'Deal value', cell: d => money(d.dealAmount), right: true },
          { head: 'Closed', cell: d => dateText(d.closedAt) }
        ]} />}
    </div>
  );
};
