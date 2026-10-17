import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { CLIENT_ACTIVITY_KINDS, type ClientActivityInput, type ClientActivityKind, type ClientActivityList, type ClientCalendarEvent, type ClientMetric } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { Empty, ErrorBanner, FormField, Loading, PageHeader, inputClass } from '../support-member/SupportParts';
import { btn } from '../team-member/pipeline/shared';

const KIND_LABEL: Record<ClientActivityKind, string> = {
  CAMPAIGN: 'Campaign', CALL_CAMPAIGN: 'Call campaign', POST: 'Post', AD: 'Ad', SETUP: 'Setup / configuration', REPORT: 'Report', MEETING: 'Meeting / call with the client', OTHER: 'Other update'
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
// Ideas for the insights of each kind, to save typing (the team can write anything).
const SUGGESTIONS: Partial<Record<ClientActivityKind, string[]>> = {
  CAMPAIGN: ['Messages sent', 'Delivered', 'Read', 'Replies'],
  CALL_CAMPAIGN: ['Calls made', 'Answered', 'Interested', 'Leads generated'],
  AD: ['Reach', 'Impressions', 'Clicks', 'Leads', 'Amount spent'],
  POST: ['Reach', 'Likes', 'Comments', 'Shares']
};

/**
 * Support: log what was done for a client on a date (a campaign, a post, a call campaign ...) with its insights.
 * The client sees it on their Calendar.
 */
export const ClientActivityManager: React.FC = () => {
  const [search, setSearch] = useState('');
  const [list, setList] = useState<{ id: string; code: string | null; name: string; company: string | null; hasClientLogin: boolean }[] | null>(null);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      pipelineApi.clientCustomers(search.trim()).then(r => { setList(r); setError(null); }, e => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="space-y-5">
      <PageHeader title="Client calendar" subtitle="Log what your team did for a client on a date, with the results. The client sees it on their dashboard Calendar." />
      {error && <ErrorBanner message={error} />}
      {!customer ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input className={`${inputClass} pl-9`} placeholder="Search a client by name, business, code or phone" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search clients" />
          </div>
          {!list ? <Loading label="Loading clients..." /> : list.length === 0 ? <Empty title="No client found" hint="Only customers in onboarding or already customers of your department are listed." /> : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {list.map(c => (
                <li key={c.id}>
                  <button type="button" className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between gap-3" onClick={() => setCustomer({ id: c.id, name: c.company || c.name })}>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900 truncate">{c.company || c.name}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{c.company ? `${c.name} · ` : ''}{c.code ?? ''}</span>
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${c.hasClientLogin ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{c.hasClientLogin ? 'Has dashboard login' : 'No login yet'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <CustomerActivity customer={customer} onBack={() => setCustomer(null)} />
      )}
    </div>
  );
};

const CustomerActivity: React.FC<{ customer: { id: string; name: string }; onBack: () => void }> = ({ customer, onBack }) => {
  const [data, setData] = useState<ClientActivityList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ClientCalendarEvent | 'new' | null>(null);
  const load = useCallback(() => {
    pipelineApi.clientActivity(customer.id).then(r => { setData(r); setError(null); }, e => setError(errorMessage(e)));
  }, [customer.id]);
  useEffect(load, [load]);

  const remove = async (e: ClientCalendarEvent) => {
    if (!window.confirm(`Remove "${e.title}" from the client's calendar?`)) return;
    try { await pipelineApi.deleteClientActivity(e.id); load(); } catch (err) { setError(errorMessage(err)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <button type="button" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700" onClick={onBack}>All clients</button>
          <h2 className="text-lg font-bold text-slate-900 truncate">{customer.name}</h2>
          {data && !data.hasClientLogin && <p className="text-[11px] text-amber-700">This client has no dashboard login yet. What you log is saved and shows once they sign in.</p>}
        </div>
        <button type="button" className={btn.primary} onClick={() => setEditing('new')} disabled={!data}><CalendarPlus className="w-4 h-4" /> Log an activity</button>
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error ? <Loading label="Loading..." /> : null}
      {data && data.events.length === 0 && <Empty title="Nothing logged yet" hint="Log a campaign, a post or a call campaign and it appears on the client's Calendar with its insights." />}
      {data && data.events.length > 0 && (
        <ul className="space-y-3">
          {data.events.map(e => (
            <li key={e.id} className="bg-white rounded-2xl border border-slate-200/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">{KIND_LABEL[e.kind as ClientActivityKind] ?? e.kind}</span>
                    <span className="text-slate-500">{longDate(e.date)}</span>
                    {e.serviceName && <span className="text-slate-500">{e.serviceName}</span>}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mt-1">{e.title}</h3>
                  {e.summary && <p className="text-xs text-slate-600 mt-1 whitespace-pre-line break-words">{e.summary}</p>}
                  {e.metrics.length > 0 && (
                    <dl className="mt-2 flex flex-wrap gap-2">
                      {e.metrics.map((m, i) => <div key={i} className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200"><dt className="text-[10px] text-slate-500">{m.label}</dt><dd className="text-xs font-bold text-slate-900">{m.value}</dd></div>)}
                    </dl>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button type="button" className={btn.secondary} onClick={() => setEditing(e)} aria-label={`Edit ${e.title}`}><Pencil className="w-3.5 h-3.5" /></button>
                  <button type="button" className={btn.danger} onClick={() => remove(e)} aria-label={`Remove ${e.title}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && data && (
        <ActivityForm customerId={customer.id} services={data.services} event={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
};

const ActivityForm: React.FC<{ customerId: string; services: { code: string; name: string }[]; event: ClientCalendarEvent | null; onClose: () => void; onSaved: () => void }> = ({ customerId, services, event, onClose, onSaved }) => {
  const [form, setForm] = useState({
    serviceCode: event?.serviceCode ?? '', date: event?.date ?? today(), kind: (event?.kind as ClientActivityKind) ?? 'CAMPAIGN',
    title: event?.title ?? '', summary: event?.summary ?? ''
  });
  const [metrics, setMetrics] = useState<ClientMetric[]>(event?.metrics.length ? event.metrics : [{ label: '', value: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const input: ClientActivityInput = {
      serviceCode: form.serviceCode || null, date: form.date, kind: form.kind, title: form.title.trim(), summary: form.summary.trim() || null,
      metrics: metrics.filter(m => m.label.trim() || m.value.trim()).map(m => ({ label: m.label.trim(), value: m.value.trim() }))
    };
    setSaving(true); setError(null);
    try {
      if (event) await pipelineApi.updateClientActivity(event.id, input); else await pipelineApi.logClientActivity(customerId, input);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={event ? 'Edit activity' : 'Log an activity'}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <form onSubmit={save} className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-sm font-bold text-slate-900">{event ? 'Edit activity' : 'Log an activity'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormField label="Date" htmlFor="act-date" required><input id="act-date" type="date" className={inputClass} value={form.date} onChange={set('date')} required /></FormField>
            <FormField label="What was it" htmlFor="act-kind" required>
              <select id="act-kind" className={inputClass} value={form.kind} onChange={set('kind')}>{CLIENT_ACTIVITY_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
            </FormField>
            <FormField label="Service" htmlFor="act-service">
              <select id="act-service" className={inputClass} value={form.serviceCode} onChange={set('serviceCode')}><option value="">Not tied to one service</option>{services.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
            </FormField>
          </div>
          <FormField label="Title" htmlFor="act-title" required hint="What the client sees on that day, for example: Diwali offer broadcast"><input id="act-title" className={inputClass} value={form.title} onChange={set('title')} maxLength={160} required /></FormField>
          <FormField label="Details" htmlFor="act-summary" hint="What was done, in plain words"><textarea id="act-summary" className={inputClass} rows={3} value={form.summary} onChange={set('summary')} maxLength={2000} /></FormField>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-700">Insights (results)</span>
              <button type="button" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1" disabled={metrics.length >= 12} onClick={() => setMetrics(m => [...m, { label: '', value: '' }])}><Plus className="w-3.5 h-3.5" /> Add</button>
            </div>
            {SUGGESTIONS[form.kind] && (
              <div className="flex flex-wrap gap-1.5 mb-2" aria-label="Suggested insights">
                {SUGGESTIONS[form.kind]!.filter(s => !metrics.some(m => m.label === s)).map(s => (
                  <button key={s} type="button" className="px-2 py-0.5 rounded-full border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50"
                    onClick={() => setMetrics(m => (m.length === 1 && !m[0].label && !m[0].value ? [{ label: s, value: '' }] : [...m, { label: s, value: '' }]).slice(0, 12))}>+ {s}</button>
                ))}
              </div>
            )}
            <div className="space-y-2">
              {metrics.map((m, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input className={inputClass} placeholder="e.g. Messages sent" aria-label={`Insight ${i + 1} name`} value={m.label} maxLength={60} onChange={e => setMetrics(list => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <input className={inputClass} placeholder="e.g. 4,200" aria-label={`Insight ${i + 1} value`} value={m.value} maxLength={60} onChange={e => setMetrics(list => list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <button type="button" className="px-2 text-slate-400 hover:text-rose-600" aria-label={`Remove insight ${i + 1}`} onClick={() => setMetrics(list => (list.length === 1 ? [{ label: '', value: '' }] : list.filter((_, j) => j !== i)))}><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={saving}>{saving ? 'Saving...' : event ? 'Save changes' : 'Log it'}</button>
        </div>
      </form>
    </div>
  );
};
