import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Eye, Loader2, Pencil, Plus, Receipt, Search, X } from 'lucide-react';
import type { RechargeKind, RechargeStatus, SupportRecharge, SupportRechargeList } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { rechargesApi } from '../../lib/api/endpoints';
import { Card, Dialog, ErrorBanner, Field, Pager, Spinner, btn, inputCls, selectCls, useDebounced } from '../team-member/pipeline/shared';
import { RechargeForm } from './RechargeForm';
import { KIND_LABEL, RechargeStatusPill, STATUSES, STATUS_LABEL, rechargeDateTime, rechargeDay, rechargeMoney } from './rechargeParts';

interface Filters { search: string; status: '' | RechargeStatus; from: string; to: string; min: string; max: string; page: number; pageSize: number }
const EMPTY: Filters = { search: '', status: '', from: '', to: '', min: '', max: '', page: 1, pageSize: 20 };
const KINDS: RechargeKind[] = ['PANEL', 'MESSAGE'];

/** One tab's records: loads again when its filters change; a late answer for an old filter is ignored. */
function useRecharges(kind: RechargeKind, f: Filters) {
  const [data, setData] = useState<SupportRechargeList | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const search = useDebounced(f.search, 300);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const r = await rechargesApi.list({
        kind, search, status: f.status, from: f.from, to: f.to, min: f.min === '' ? '' : Number(f.min), max: f.max === '' ? '' : Number(f.max),
        limit: f.pageSize, offset: (f.page - 1) * f.pageSize
      });
      if (mine === seq.current) setData(r);
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [kind, search, f.status, f.from, f.to, f.min, f.max, f.page, f.pageSize]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

const Stat: React.FC<{ label: string; value: string; testId: string }> = ({ label, value, testId }) => (
  <div className="rounded-2xl border border-slate-200/80 bg-white p-3 sm:p-4 min-w-0" data-testid={testId}>
    <div className="text-[11px] font-medium text-slate-500 truncate">{label}</div>
    <div className="mt-1 text-base sm:text-lg font-extrabold text-slate-900 break-words">{value}</div>
  </div>
);

/** The payment screenshot, fetched through a short-lived link only when somebody asks for it (never stored in the page). */
const ScreenshotView: React.FC<{ fileId: string; name: string; mime: string }> = ({ fileId, name, mime }) => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setUrl(''); setError('');
    rechargesApi.fileUrl(fileId, 'view').then(r => { if (live) setUrl(r.url); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [fileId]);
  if (error) return <ErrorBanner message={error} />;
  if (!url) return <Spinner label="Opening the screenshot…" />;
  if (mime === 'application/pdf') {
    return <a className={btn.secondary} href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5" aria-hidden /> Open {name} (PDF)</a>;
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 flex justify-center" data-testid="recharge-shot">
      <img src={url} alt={`Payment screenshot ${name}`} className="max-w-full max-h-[55dvh] object-contain rounded-lg" referrerPolicy="no-referrer" />
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0"><dt className="text-[11px] font-medium text-slate-500">{label}</dt><dd className="text-sm text-slate-800 break-words">{children}</dd></div>
);

/** One recharge in full: the details, the screenshot, and (when the database allows it) the status change. */
const RechargeDetail: React.FC<{ id: string; onClose: () => void; onEdit: (r: SupportRecharge) => void; onChanged: () => void }> = ({ id, onClose, onEdit, onChanged }) => {
  const [r, setR] = useState<SupportRecharge | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let live = true;
    rechargesApi.get(id).then(x => { if (live) setR(x); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [id]);
  const change = async () => {
    if (!r || !status) return;
    setBusy(true); setProblem('');
    try {
      const next = await rechargesApi.setStatus(r.id, status, note);
      setR(next); setStatus(''); setNote('');
      onChanged();
    } catch (e) { setProblem(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={r ? `${KIND_LABEL[r.kind]} · ${r.reference}` : 'Recharge'} description={r ? `${r.customerName} · ${rechargeDay(r.rechargeDate)}` : undefined} onClose={onClose} size="xl">
      {error && <ErrorBanner message={error} />}
      {!r && !error && <Spinner label="Loading the recharge…" />}
      {r && (
        <div className="space-y-4" data-testid="recharge-detail">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Row label="Status"><RechargeStatusPill status={r.status} /></Row>
            <Row label="Recorded by">{r.createdByName ?? '-'}{r.teamName ? ` · ${r.teamName}` : ''}</Row>
            <Row label="GST amount">{rechargeMoney(r.gstAmount)}{r.gstDetails ? ` · ${r.gstDetails}` : ''}</Row>
            <Row label="Non-GST amount">{rechargeMoney(r.nonGstAmount)}{r.nonGstDetails ? ` · ${r.nonGstDetails}` : ''}</Row>
            <Row label="Total recharge amount"><b>{rechargeMoney(r.totalAmount)}</b></Row>
            <Row label="Recorded on">{rechargeDateTime(r.createdAt)}</Row>
            {r.remarks && <div className="sm:col-span-2"><Row label="Remarks"><span className="whitespace-pre-wrap">{r.remarks}</span></Row></div>}
            {r.statusAt && <div className="sm:col-span-2"><Row label="Last status change">{STATUS_LABEL[r.status]} by {r.statusByName ?? 'someone'} · {rechargeDateTime(r.statusAt)}{r.statusNote ? ` · “${r.statusNote}”` : ''}</Row></div>}
          </dl>
          <div>
            <h3 className="text-xs font-bold text-slate-700 mb-2">Payment screenshot</h3>
            {r.screenshot ? <ScreenshotView fileId={r.screenshot.id} name={r.screenshot.name} mime={r.screenshot.mime} /> : <p className="text-sm text-slate-500">No screenshot.</p>}
          </div>
          {r.nextStatuses.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2" role="group" aria-label="Change the status">
              <h3 className="text-xs font-bold text-slate-700">Change the status</h3>
              <div className="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-2">
                <select aria-label="New status" className={`${selectCls} w-full`} value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="">Choose…</option>
                  {r.nextStatuses.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <input aria-label="Note" className={inputCls} placeholder={status === 'REJECTED' ? 'Why is it rejected? (required)' : 'Note (optional)'} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
              </div>
              {problem && <ErrorBanner message={problem} />}
              <button type="button" className={btn.primary} disabled={!status || busy} onClick={() => void change()}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />} Update status</button>
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={onClose}>Close</button>
            {r.canEdit && <button type="button" className={btn.primary} onClick={() => onEdit(r)}><Pencil className="w-3.5 h-3.5" aria-hidden /> Edit</button>}
          </div>
        </div>
      )}
    </Dialog>
  );
};

/**
 * Recharges (Support dashboards): Panel Recharge and Message Recharge are two tabs over the same screen, each with its own records, summary and
 * filters. Who sees what, who may edit and who may change a status is decided by the database; this screen only shows what it was given.
 */
export const RechargesPage: React.FC = () => {
  const [kind, setKind] = useState<RechargeKind>('PANEL');
  const [filters, setFilters] = useState<Record<RechargeKind, Filters>>({ PANEL: EMPTY, MESSAGE: EMPTY });
  const f = filters[kind];
  const { data, error, loading, reload } = useRecharges(kind, f);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SupportRecharge | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const set = (patch: Partial<Filters>) => setFilters(s => ({ ...s, [kind]: { ...s[kind], page: 1, ...patch } }));
  const dirty = f.search || f.status || f.from || f.to || f.min || f.max;
  const sum = data?.summary;
  const roleHint = data?.role === 'MEMBER' ? 'Your recharges' : data?.role === 'LEAD' ? 'Your team’s recharges' : data?.role === 'HEAD' ? 'The department’s recharges' : data ? 'All recharges' : '';

  const saved = (r: SupportRecharge, was: 'created' | 'updated') => {
    setCreating(false); setEditing(null);
    setNotice(`${r.reference} was ${was}.`);
    reload();
  };
  return (
    <div className="space-y-4" data-testid="recharges-page">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><Receipt className="w-5 h-5 text-indigo-600" aria-hidden /> Recharges</h1>
          <p className="text-xs text-slate-500 mt-0.5">{roleHint || 'Panel and Message recharges with their payment proof.'}</p>
        </div>
        {data?.canCreate && (
          <button type="button" className={`${btn.primary} w-full sm:w-auto`} onClick={() => { setNotice(''); setCreating(true); }}>
            <Plus className="w-3.5 h-3.5" aria-hidden /> Create {KIND_LABEL[kind]}
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Recharge type" className="flex gap-1 p-1 rounded-xl bg-slate-100 w-full sm:w-fit">
        {KINDS.map(k => (
          <button key={k} type="button" role="tab" id={`rc-tab-${k}`} aria-selected={kind === k} aria-controls="rc-panel" data-testid={`tab-${k}`}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap ${kind === k ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            onClick={() => { setKind(k); setNotice(''); }}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div id="rc-panel" role="tabpanel" aria-labelledby={`rc-tab-${kind}`} className="space-y-4">
        {notice && <div role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-2" data-testid="recharge-notice">{notice}</div>}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3" data-testid="recharge-summary">
          <Stat testId="stat-total" label="Total recharges" value={sum ? sum.totalRecharges.toLocaleString('en-IN') : '–'} />
          <Stat testId="stat-amount" label="Total recharge amount" value={sum ? rechargeMoney(sum.totalAmount) : '–'} />
          <Stat testId="stat-gst" label="Total GST" value={sum ? rechargeMoney(sum.totalGst) : '–'} />
          <Stat testId="stat-non-gst" label="Total non-GST" value={sum ? rechargeMoney(sum.totalNonGst) : '–'} />
          <Stat testId="stat-pending" label="Pending" value={sum ? sum.pending.toLocaleString('en-IN') : '–'} />
          <Stat testId="stat-completed" label="Completed" value={sum ? sum.completed.toLocaleString('en-IN') : '–'} />
        </div>

        <Card className="p-3 sm:p-4">
          <form className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" role="search" aria-label="Filter recharges" onSubmit={e => e.preventDefault()}>
            <Field label="Customer name" htmlFor="rc-f-search">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input id="rc-f-search" className={`${inputCls} pl-8`} type="search" placeholder="Search by customer" value={f.search} maxLength={100} onChange={e => set({ search: e.target.value })} />
              </div>
            </Field>
            <Field label="Status" htmlFor="rc-f-status">
              <select id="rc-f-status" className={`${selectCls} w-full`} value={f.status} onChange={e => set({ status: e.target.value as Filters['status'] })}>
                <option value="">All statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="From date" htmlFor="rc-f-from"><input id="rc-f-from" type="date" className={inputCls} value={f.from} max={f.to || undefined} onChange={e => set({ from: e.target.value })} /></Field>
            <Field label="To date" htmlFor="rc-f-to"><input id="rc-f-to" type="date" className={inputCls} value={f.to} min={f.from || undefined} onChange={e => set({ to: e.target.value })} /></Field>
            <Field label="Min amount (₹)" htmlFor="rc-f-min"><input id="rc-f-min" className={inputCls} inputMode="decimal" placeholder="0" value={f.min} onChange={e => set({ min: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
            <Field label="Max amount (₹)" htmlFor="rc-f-max"><input id="rc-f-max" className={inputCls} inputMode="decimal" placeholder="Any" value={f.max} onChange={e => set({ max: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
            <div className="flex items-end">
              <button type="button" className={`${btn.secondary} w-full sm:w-auto`} disabled={!dirty} onClick={() => setFilters(s => ({ ...s, [kind]: { ...EMPTY, pageSize: s[kind].pageSize } }))}><X className="w-3.5 h-3.5" aria-hidden /> Clear filters</button>
            </div>
          </form>
        </Card>

        {error && <ErrorBanner message={error} onRetry={reload} />}
        <Card className="overflow-hidden">
          {loading && !data ? <Spinner label="Loading recharges…" /> : data && data.items.length === 0 && !error ? (
            <div className="py-12 px-4 text-center" data-testid="recharge-empty">
              <Receipt className="w-8 h-8 mx-auto text-slate-300" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-slate-700">{dirty ? 'No recharges match these filters.' : `No ${KIND_LABEL[kind].toLowerCase()}s yet.`}</p>
              <p className="text-xs text-slate-500">{dirty ? 'Change or clear the filters.' : data.canCreate ? 'Use the Create button to record the first one.' : ''}</p>
            </div>
          ) : data && (
            <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm" data-testid="recharge-table">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Reference</th><th className="text-left px-3 py-2 font-semibold">Customer</th><th className="text-left px-3 py-2 font-semibold">Date</th>
                      <th className="text-right px-3 py-2 font-semibold">GST</th><th className="text-right px-3 py-2 font-semibold">Non-GST</th><th className="text-right px-3 py-2 font-semibold">Total</th>
                      <th className="text-left px-3 py-2 font-semibold">Status</th>{data.role !== 'MEMBER' && <th className="text-left px-3 py-2 font-semibold">Recorded by</th>}<th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.items.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50/60" data-testid="recharge-row">
                        <td className="px-3 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">{r.reference}</td>
                        <td className="px-3 py-2 font-medium text-slate-900 max-w-[16rem] truncate" title={r.customerName}>{r.customerName}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-600">{rechargeDay(r.rechargeDate)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{rechargeMoney(r.gstAmount)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{rechargeMoney(r.nonGstAmount)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap font-bold">{rechargeMoney(r.totalAmount)}</td>
                        <td className="px-3 py-2"><RechargeStatusPill status={r.status} /></td>
                        {data.role !== 'MEMBER' && <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.createdByName ?? '-'}</td>}
                        <td className="px-3 py-2 whitespace-nowrap text-right">
                          <button type="button" className={btn.secondary} onClick={() => setOpenId(r.id)} aria-label={`View ${r.reference}`}><Eye className="w-3.5 h-3.5" aria-hidden /> View</button>
                          {r.canEdit && <button type="button" className={`${btn.secondary} ml-1`} onClick={() => setEditing(r)} aria-label={`Edit ${r.reference}`}><Pencil className="w-3.5 h-3.5" aria-hidden /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="md:hidden divide-y divide-slate-100" data-testid="recharge-cards">
                {data.items.map(r => (
                  <li key={r.id} className="p-3 space-y-2" data-testid="recharge-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><div className="font-semibold text-slate-900 break-words">{r.customerName}</div><div className="text-[11px] text-slate-500">{r.reference} · {rechargeDay(r.rechargeDate)}</div></div>
                      <RechargeStatusPill status={r.status} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><div className="text-slate-500">GST</div><div className="font-semibold break-words">{rechargeMoney(r.gstAmount)}</div></div>
                      <div><div className="text-slate-500">Non-GST</div><div className="font-semibold break-words">{rechargeMoney(r.nonGstAmount)}</div></div>
                      <div><div className="text-slate-500">Total</div><div className="font-extrabold break-words">{rechargeMoney(r.totalAmount)}</div></div>
                    </div>
                    {data.role !== 'MEMBER' && <div className="text-[11px] text-slate-500">Recorded by {r.createdByName ?? '-'}</div>}
                    <div className="flex gap-2">
                      <button type="button" className={`${btn.secondary} flex-1`} onClick={() => setOpenId(r.id)} aria-label={`View ${r.reference}`}><Eye className="w-3.5 h-3.5" aria-hidden /> View</button>
                      {r.canEdit && <button type="button" className={`${btn.secondary} flex-1`} onClick={() => setEditing(r)} aria-label={`Edit ${r.reference}`}><Pencil className="w-3.5 h-3.5" aria-hidden /> Edit</button>}
                    </div>
                  </li>
                ))}
              </ul>
              <Pager page={f.page} pageSize={f.pageSize} total={data.total} noun="recharges" onPage={p => setFilters(s => ({ ...s, [kind]: { ...s[kind], page: p } }))}
                onPageSize={n => set({ pageSize: n })} />
            </div>
          )}
        </Card>
      </div>

      {creating && <RechargeForm kind={kind} onClose={() => setCreating(false)} onSaved={r => saved(r, 'created')} />}
      {editing && <RechargeForm kind={editing.kind} existing={editing} onClose={() => setEditing(null)} onSaved={r => { setOpenId(null); saved(r, 'updated'); }} />}
      {openId && !editing && <RechargeDetail id={openId} onClose={() => setOpenId(null)} onEdit={r => setEditing(r)} onChanged={() => { reload(); }} />}
    </div>
  );
};
