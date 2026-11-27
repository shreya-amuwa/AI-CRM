import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Search } from 'lucide-react';
import type { ImprovementRequestRow, PreviewRecent } from '../../../shared/contracts';
import {
  BUSINESS_FUNCTION_LABELS, DASHBOARD_CATEGORY_LABELS, DASHBOARD_REGISTRY, PREVIEW_DEPARTMENTS, dashboardById, departmentBySlug,
  type BusinessFunction, type DashboardCategory, type DashboardEntry
} from '../../../shared/dashboardExplorer';
import { dashboardExplorerApi } from '../../lib/api/dashboardExplorer';
import { errorMessage } from '../../lib/api/client';
import { PageTitle } from '../layout/shell';
import { fieldCls } from '../tasks/head/headParts';
import { PreviewWorkspace, type PreviewSelection } from './PreviewWorkspace';

/**
 * Dashboard Explorer (Managing Director only; docs/DASHBOARD_EXPLORER.md): every position's real dashboard, previewed with demonstration
 * data in an isolated frame. Not a "log in as" - no employee account, session or record is used or changed. The list comes from the shared
 * registry (shared/dashboardExplorer.ts), the same one the server checks.
 */
const STATUS_LABEL: Record<string, string> = { PENDING: 'Submitted', UNDER_REVIEW: 'Under review', NEEDS_INFO: 'Needs information', IN_PROGRESS: 'In progress', RESOLVED: 'Completed', REJECTED: 'Not planned', CLOSED: 'Closed' };
const STATUS_TONE: Record<string, string> = { PENDING: 'bg-slate-100 text-slate-700', UNDER_REVIEW: 'bg-blue-50 text-blue-800', NEEDS_INFO: 'bg-amber-50 text-amber-800',
  IN_PROGRESS: 'bg-indigo-50 text-indigo-800', RESOLVED: 'bg-emerald-50 text-emerald-800', REJECTED: 'bg-rose-50 text-rose-800', CLOSED: 'bg-slate-100 text-slate-600' };
const chip = 'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold';
const dayText = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const Card: React.FC<{ entry: DashboardEntry; onOpen: (dept: string) => void }> = ({ entry, onOpen }) => {
  const [dept, setDept] = useState(entry.departments[0]);
  return (
    <li className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-2" data-testid="dashboard-card">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900">{entry.position}</h3>
        <span className={`${chip} bg-slate-100 text-slate-600 shrink-0`}>{BUSINESS_FUNCTION_LABELS[entry.businessFunction]}</span>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">{entry.description}</p>
      {entry.availability === 'NO_DASHBOARD_YET' && <p className={`${chip} bg-amber-50 text-amber-800 self-start`}>No dedicated dashboard yet (shows the production notice page)</p>}
      <p className="text-[11px] text-slate-500"><span className="font-semibold text-slate-600">Modules:</span> {entry.modules.join(' · ')}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {entry.departments.length > 1 ? (
          <>
            <label className="sr-only" htmlFor={`dx-dept-${entry.id}`}>Department for {entry.position}</label>
            <select id={`dx-dept-${entry.id}`} className={`${fieldCls} !h-8 !text-xs flex-1 min-w-0`} value={dept} onChange={e => setDept(e.target.value)}>
              {entry.departments.map(s => <option key={s} value={s}>{departmentBySlug(s)?.name ?? s}</option>)}
            </select>
          </>
        ) : <span className="text-xs text-slate-500 flex-1">{departmentBySlug(dept)?.name}</span>}
        <button type="button" onClick={() => onOpen(dept)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800" aria-label={`Open dashboard preview: ${entry.position}`}>
          <Eye className="w-3.5 h-3.5" aria-hidden="true" /> Open Dashboard Preview
        </button>
      </div>
    </li>
  );
};

export const DashboardExplorer: React.FC = () => {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [fn, setFn] = useState<BusinessFunction | ''>('');
  const [category, setCategory] = useState<DashboardCategory | ''>('');
  const [preview, setPreview] = useState<PreviewSelection | null>(null);
  const [recent, setRecent] = useState<PreviewRecent[] | null>(null);
  const [requests, setRequests] = useState<ImprovementRequestRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([dashboardExplorerApi.recent(), dashboardExplorerApi.requests()]).then(
      ([r, q]) => { setRecent(r); setRequests(q); setLoadError(null); },
      e => setLoadError(errorMessage(e))
    );
  }, []);
  useEffect(reload, [reload]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return DASHBOARD_REGISTRY.filter(d => (!q || `${d.position} ${d.description} ${d.modules.join(' ')}`.toLowerCase().includes(q))
      && (!department || d.departments.includes(department)) && (!fn || d.businessFunction === fn) && (!category || d.category === category));
  }, [search, department, fn, category]);
  const groups = useMemo(() => (Object.keys(DASHBOARD_CATEGORY_LABELS) as DashboardCategory[]).map(c => ({ c, items: list.filter(d => d.category === c) })).filter(g => g.items.length), [list]);
  const open = (dashboardId: string, dept: string) => setPreview({ dashboardId, department: dept, scenario: 'normal' });
  const pending = (requests ?? []).filter(r => !['RESOLVED', 'REJECTED', 'CLOSED'].includes(r.status));

  return (
    <div className="space-y-6">
      <PageTitle title="Dashboard Explorer" subtitle="See the CRM as each position sees it. Previews use demonstration data only: no employee account is used and nothing in the live CRM changes." />
      {loadError && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{loadError}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Recently viewed" className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-extrabold text-slate-900">Recently viewed</h2>
          {recent === null ? <p className="mt-2 text-xs text-slate-500">Loading…</p> : recent.length === 0 ? <p className="mt-2 text-xs text-slate-500">No previews yet. Open one below.</p> : (
            <ul className="mt-2 divide-y divide-slate-100">
              {recent.map(r => (
                <li key={`${r.dashboardId}:${r.department}`} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate"><span className="font-semibold text-slate-800">{dashboardById(r.dashboardId)?.position ?? r.dashboardId}</span> · {departmentBySlug(r.department)?.name ?? r.department}</span>
                  <button type="button" className="text-blue-700 font-semibold hover:underline shrink-0" onClick={() => open(r.dashboardId, r.department)}>Open again</button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Dashboard improvement requests" className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-extrabold text-slate-900">Improvement requests {pending.length > 0 && <span className={`${chip} bg-blue-50 text-blue-800 ml-1`}>{pending.length} open</span>}</h2>
          {requests === null ? <p className="mt-2 text-xs text-slate-500">Loading…</p> : requests.length === 0 ? <p className="mt-2 text-xs text-slate-500">None yet. Use “Suggest improvement” inside a preview.</p> : (
            <ul className="mt-2 divide-y divide-slate-100 max-h-56 overflow-auto">
              {requests.map(r => (
                <li key={r.id} className="py-1.5 text-xs flex items-start justify-between gap-2">
                  <span className="min-w-0"><span className="font-semibold text-slate-800">{r.title}</span>
                    <span className="block text-slate-500">{r.reference} · {dashboardById(r.dashboardId ?? '')?.position ?? r.dashboardId}{r.page ? ` · ${r.page}` : ''} · {dayText(r.createdAt)}</span>
                    {r.resolutionNote && <span className="block text-slate-600">{r.resolutionNote}</span>}
                  </span>
                  <span className={`${chip} ${STATUS_TONE[r.status] ?? 'bg-slate-100 text-slate-700'} shrink-0`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-col lg:flex-row gap-2" role="search">
        <label className="relative flex-1">
          <span className="sr-only">Search by position</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input type="search" className={`${fieldCls} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by position or module" />
        </label>
        <label className="sr-only" htmlFor="dx-filter-dept">Department</label>
        <select id="dx-filter-dept" className={`${fieldCls} lg:w-52`} value={department} onChange={e => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {PREVIEW_DEPARTMENTS.map(d => <option key={d.slug} value={d.slug}>{d.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="dx-filter-fn">Business function</label>
        <select id="dx-filter-fn" className={`${fieldCls} lg:w-40`} value={fn} onChange={e => setFn(e.target.value as BusinessFunction | '')}>
          <option value="">All functions</option>
          {(Object.keys(BUSINESS_FUNCTION_LABELS) as BusinessFunction[]).map(f => <option key={f} value={f}>{BUSINESS_FUNCTION_LABELS[f]}</option>)}
        </select>
        <label className="sr-only" htmlFor="dx-filter-cat">Dashboard category</label>
        <select id="dx-filter-cat" className={`${fieldCls} lg:w-52`} value={category} onChange={e => setCategory(e.target.value as DashboardCategory | '')}>
          <option value="">All categories</option>
          {(Object.keys(DASHBOARD_CATEGORY_LABELS) as DashboardCategory[]).map(c => <option key={c} value={c}>{DASHBOARD_CATEGORY_LABELS[c]}</option>)}
        </select>
      </div>

      {groups.length === 0 ? <p className="text-sm text-slate-500">No dashboard matches. Clear a filter to see more.</p> : groups.map(g => (
        <section key={g.c} aria-label={DASHBOARD_CATEGORY_LABELS[g.c]}>
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{DASHBOARD_CATEGORY_LABELS[g.c]} · {g.items.length}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{g.items.map(d => <Card key={d.id} entry={d} onOpen={dept => open(d.id, dept)} />)}</ul>
        </section>
      ))}

      {preview && <PreviewWorkspace initial={preview} onExit={() => { setPreview(null); reload(); }} onSuggested={reload} />}
    </div>
  );
};

export default DashboardExplorer;
