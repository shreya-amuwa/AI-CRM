import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Pencil, Plus, Search } from 'lucide-react';
import {
  CALL_STATUSES, CALL_STATUS_LABELS, LEAD_TEMPERATURES, type CallStatus, type LeadTemperature, type TelecallerLead, type TelecallerLeadList
} from '../../../shared/contracts';
import { telecallerLeadSchema } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { telecallerApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Card } from '../tasks/head/headParts';
import { Avatar, Dialog, ErrorBanner, Field, LEAD_SOURCES, Pager, Spinner, todayIso, useDebounced, useServiceCatalog } from '../team-member/pipeline/shared';
import {
  CALL_STATUS_OPTIONS, CallStatusBadge, EmptyState, TEMPERATURE_DOT, TEMPERATURE_LABELS, TEMPERATURE_STYLE, TemperatureBadge, dateText, notifyTelecallerChanged, tcBtn, tcInput, tcSelect
} from './ui';

/** The calls the Leads page makes: the Telecaller and the Business Associate each have their own endpoints (and their own data), the page is the same. */
export interface LeadsApi {
  list: typeof telecallerApi.leads;
  create: typeof telecallerApi.createLead;
  update: typeof telecallerApi.updateLead;
}
export const telecallerLeadsApi: LeadsApi = { list: telecallerApi.leads, create: telecallerApi.createLead, update: telecallerApi.updateLead };

/**
 * Leads: the leads the signed-in person owns (the same Sales leads the rest of the CRM shows), with their temperature and call status.
 * The Telecaller and the Business Associate use this one page with their own `api`; `onChanged` tells that dashboard's Home to reload,
 * and `renderRowAction` lets the Telecaller convert a qualified lead.
 */
export const LeadsPage: React.FC<{
  openAdd?: boolean;
  api?: LeadsApi;
  onChanged?: () => void;
  subtitle?: string;
  renderRowAction?: (lead: TelecallerLead, reload: () => void) => React.ReactNode;
}> = ({ openAdd = false, api = telecallerLeadsApi, onChanged = notifyTelecallerChanged, subtitle, renderRowAction }) => {
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const [temperature, setTemperature] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<TelecallerLeadList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: 'add' } | { mode: 'view' | 'edit'; lead: TelecallerLead } | null>(openAdd ? { mode: 'add' } : null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    api.list({ search: query || undefined, temperature: temperature || undefined, callStatus: callStatus || undefined, source: source || undefined, page, pageSize }).then(
      d => mine === seq.current && (setData(d), setLoading(false)),
      err => mine === seq.current && (setError(errorMessage(err)), setLoading(false))
    );
  }, [query, temperature, callStatus, source, page, pageSize]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [query, temperature, callStatus, source, pageSize]);

  const saved = (lead: TelecallerLead, created: boolean) => {
    setDialog(null);
    setNotice(created ? `${lead.name} was added to your leads.` : `${lead.name} was updated.`);
    setTimeout(() => setNotice(null), 4000);
    if (created) setPage(1);
    load(); // the new lead appears without a manual refresh
    onChanged();
  };

  const filtered = !!(query || temperature || callStatus || source);

  return (
    <div className="space-y-5">
      <PageTitle
        title="Leads"
        subtitle={subtitle ?? 'Customers you have spoken to. Mark each one Hot, Warm or Cold and keep track of the next call.'}
        actions={<button type="button" className={tcBtn.primary} onClick={() => setDialog({ mode: 'add' })}><Plus className="w-4 h-4" aria-hidden="true" /> Add Lead</button>}
      />

      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">{notice}</div>}

      <Card className="overflow-hidden">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
          <div className="relative flex-1 min-w-[14rem] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className={`${tcInput} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, company, phone or email" aria-label="Search leads" />
          </div>
          <select className={tcSelect} value={temperature} onChange={e => setTemperature(e.target.value)} aria-label="Filter by lead temperature">
            <option value="">All temperatures</option>
            {LEAD_TEMPERATURES.map(t => <option key={t} value={t}>{TEMPERATURE_LABELS[t]}</option>)}
          </select>
          <select className={tcSelect} value={callStatus} onChange={e => setCallStatus(e.target.value)} aria-label="Filter by call status">
            <option value="">All call statuses</option>
            {CALL_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className={tcSelect} value={source} onChange={e => setSource(e.target.value)} aria-label="Filter by lead source">
            <option value="">All sources</option>
            {(data?.sources ?? []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {loading && !data ? (
          <Spinner label="Loading leads…" />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title={filtered ? 'No leads match' : 'No leads yet'}>
            {filtered ? 'Try another filter or clear the search.' : 'Add the first lead after a call with a customer who is interested.'}
            {!filtered && <div className="mt-4"><button type="button" className={tcBtn.primary} onClick={() => setDialog({ mode: 'add' })}><Plus className="w-4 h-4" aria-hidden="true" /> Add Lead</button></div>}
          </EmptyState>
        ) : (
          <>
            <div className="hidden xl:block">
              <table className="w-full table-fixed text-left text-[13px]" aria-busy={loading}>
                <colgroup>{[14, 10, 10, 18, 7, 8, 11, 7, 7, 8].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 bg-slate-50/60">
                    {['Customer Name', 'Company / Business Name', 'Phone', 'Email', 'Lead Source', 'Lead Temperature', 'Call Status', 'Follow-up Date', 'Created Date', 'Actions'].map(h => (
                      <th key={h} scope="col" className="px-3 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map(l => (
                    <tr key={l.id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-3"><div className="flex items-center gap-2.5"><Avatar name={l.name} /><span className="font-semibold text-slate-900 break-words min-w-0">{l.name}</span></div></td>
                      <td className="px-3 py-3 text-slate-600 break-words">{l.company || '-'}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{l.phone ? <a href={`tel:${l.phone}`} className="text-blue-600 hover:underline">{l.phone}</a> : '-'}</td>
                      <td className="px-3 py-3 text-slate-600"><span className="block truncate" title={l.email || undefined}>{l.email || '-'}</span></td>
                      <td className="px-3 py-3 text-slate-600 break-words">{l.leadSource || '-'}</td>
                      <td className="px-3 py-3"><TemperatureBadge value={l.leadTemperature} /></td>
                      <td className="px-3 py-3 [&>span]:whitespace-normal [&>span]:text-center"><CallStatusBadge status={l.callStatus} /></td>
                      <td className="px-3 py-3 text-slate-600">{dateText(l.followUpDate)}</td>
                      <td className="px-3 py-3 text-slate-600">{dateText(l.createdAt)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-stretch gap-1.5">
                          <button type="button" className={tcBtn.row} onClick={() => setDialog({ mode: 'view', lead: l })} aria-label={`View ${l.name}`}><Eye className="w-3.5 h-3.5" aria-hidden="true" /> View</button>
                          <button type="button" className={tcBtn.row} onClick={() => setDialog({ mode: 'edit', lead: l })} aria-label={`Edit ${l.name}`}><Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit</button>
                          {renderRowAction?.(l, load)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="xl:hidden divide-y divide-slate-100">
              {data.items.map(l => (
                <li key={l.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{l.name}</div>
                      <div className="text-xs text-slate-500">{l.company || 'No company'}</div>
                    </div>
                    <TemperatureBadge value={l.leadTemperature} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {l.phone && <a href={`tel:${l.phone}`} className="text-blue-600 font-semibold">{l.phone}</a>}
                    <CallStatusBadge status={l.callStatus} />
                  </div>
                  <div className="text-xs text-slate-500">{l.leadSource || 'No source'} · Follow-up {dateText(l.followUpDate)} · Created {dateText(l.createdAt)}</div>
                  <div className="flex gap-2">
                    <button type="button" className={tcBtn.secondary} onClick={() => setDialog({ mode: 'view', lead: l })}>View</button>
                    <button type="button" className={tcBtn.secondary} onClick={() => setDialog({ mode: 'edit', lead: l })}>Edit</button>
                    {renderRowAction?.(l, load)}
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={page} pageSize={pageSize} total={data.total} noun="leads" onPage={setPage} onPageSize={setPageSize} />
          </>
        )}
      </Card>

      {dialog?.mode === 'add' && <LeadDialog api={api} onClose={() => setDialog(null)} onSaved={l => saved(l, true)} />}
      {dialog?.mode === 'edit' && <LeadDialog api={api} lead={dialog.lead} onClose={() => setDialog(null)} onSaved={l => saved(l, false)} />}
      {dialog?.mode === 'view' && <LeadView lead={dialog.lead} onClose={() => setDialog(null)} onEdit={() => setDialog({ mode: 'edit', lead: dialog.lead })} />}
    </div>
  );
};

const LeadView: React.FC<{ lead: TelecallerLead; onClose: () => void; onEdit: () => void }> = ({ lead, onClose, onEdit }) => {
  const rows: [string, React.ReactNode][] = [
    ['Company / Business', lead.company], ['Phone', lead.phone], ['Email', lead.email], ['Business address', lead.address], ['Interested service', lead.serviceNames],
    ['Lead source', lead.leadSource], ['Follow-up date', dateText(lead.followUpDate)], ['Created', dateText(lead.createdAt)], ['Notes', lead.notes]
  ];
  return (
    <Dialog title={lead.name} description="Lead details" onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2"><TemperatureBadge value={lead.leadTemperature} /><CallStatusBadge status={lead.callStatus} /></div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className={k === 'Notes' || k === 'Business address' ? 'sm:col-span-2' : ''}>
            <dt className="text-xs font-medium text-slate-500">{k}</dt>
            <dd className="text-slate-800 whitespace-pre-wrap break-words">{v || '-'}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className={tcBtn.secondary} onClick={onClose}>Close</button>
        <button type="button" className={tcBtn.primary} onClick={onEdit}>Edit</button>
      </div>
    </Dialog>
  );
};

const emptyForm = (lead?: TelecallerLead) => ({
  name: lead?.name ?? '',
  company: lead?.company ?? '',
  phone: lead?.phone ?? '',
  email: lead?.email ?? '',
  address: lead?.address ?? '',
  services: lead?.services ?? ([] as string[]),
  leadSource: lead?.leadSource && LEAD_SOURCES.includes(lead.leadSource) ? lead.leadSource : lead?.leadSource ? 'Other' : 'Cold call',
  otherSource: lead?.leadSource && !LEAD_SOURCES.includes(lead.leadSource) ? lead.leadSource : '',
  leadTemperature: (lead?.leadTemperature ?? '') as LeadTemperature | '',
  callStatus: (lead?.callStatus ?? 'PENDING') as CallStatus,
  followUpDate: lead?.followUpDate ?? '',
  notes: lead?.notes ?? ''
});

/** Add or edit a lead. The same rules run here (for early feedback), in the API and in the database. */
const LeadDialog: React.FC<{ api: LeadsApi; lead?: TelecallerLead; onClose: () => void; onSaved: (lead: TelecallerLead) => void }> = ({ api, lead, onClose, onSaved }) => {
  const catalog = useServiceCatalog();
  const [form, setForm] = useState(() => emptyForm(lead));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));
  const text = (k: 'name' | 'company' | 'phone' | 'email' | 'address' | 'notes' | 'otherSource' | 'followUpDate') => ({
    id: `lead-${k}`,
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value)
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return; // a double click must not create the lead twice
    const source = form.leadSource === 'Other' ? form.otherSource.trim() : form.leadSource;
    const payload = {
      name: form.name, company: form.company, phone: form.phone, email: form.email || null, address: form.address || null, leadSource: source,
      notes: form.notes || null, services: form.services, leadTemperature: form.leadTemperature, callStatus: form.callStatus, followUpDate: form.followUpDate || null
    };
    const parsed = telecallerLeadSchema.safeParse(payload);
    const found: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) found[String(i.path[0])] ??= i.message;
    if (form.leadSource === 'Other' && !source) found.leadSource = 'Type the lead source.';
    if (form.callStatus === 'FOLLOW_UP_REQUIRED' && !form.followUpDate) found.followUpDate = 'Enter the follow-up date.';
    setErrors(found);
    if (Object.keys(found).length > 0 || !parsed.success) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const body = parsed.data;
      onSaved(lead ? await api.update(lead.id, body) : await api.create(body));
    } catch (err) {
      setError(errorMessage(err));
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog title={lead ? `Edit lead · ${lead.name}` : 'Add Lead'} description="Fields marked * are required." onClose={onClose} wide persistent>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Customer Name" htmlFor="lead-name" required error={errors.name}><input className={tcInput} {...text('name')} maxLength={200} autoComplete="off" /></Field>
          <Field label="Company / Business Name" htmlFor="lead-company" required error={errors.company}><input className={tcInput} {...text('company')} maxLength={200} autoComplete="off" /></Field>
          <Field label="Phone Number" htmlFor="lead-phone" required error={errors.phone}><input className={tcInput} {...text('phone')} type="tel" inputMode="tel" placeholder="+91 98765 43210" autoComplete="off" /></Field>
          <Field label="Email" htmlFor="lead-email" error={errors.email}><input className={tcInput} {...text('email')} type="email" autoComplete="off" /></Field>
          <div className="sm:col-span-2"><Field label="Business Address" htmlFor="lead-address" error={errors.address}><input className={tcInput} {...text('address')} maxLength={500} autoComplete="off" /></Field></div>

          <div className="sm:col-span-2">
            <span className="block text-xs font-medium text-slate-600 mb-1">Interested Service <span aria-hidden="true">*</span></span>
            <div role="group" aria-label="Interested service" className="flex flex-wrap gap-2">
              {catalog.items.length === 0 && <span className="text-xs text-slate-500">{catalog.error || 'Loading services…'}</span>}
              {catalog.items.map(s => {
                const on = form.services.includes(s.code);
                return (
                  <button
                    key={s.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('services', on ? form.services.filter(c => c !== s.code) : [...form.services, s.code])}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
            {errors.services && <p className="mt-1 text-[11px] text-rose-600">{errors.services}</p>}
          </div>

          <Field label="Lead Source" htmlFor="lead-source" required error={errors.leadSource}>
            <select id="lead-source" className={tcInput} value={form.leadSource} onChange={e => set('leadSource', e.target.value)}>
              {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {form.leadSource === 'Other' && <input className={`${tcInput} mt-2`} {...text('otherSource')} placeholder="Type the lead source" maxLength={60} aria-label="Other lead source" />}
          </Field>
          <Field label="Follow-up Date" htmlFor="lead-followUpDate" required={form.callStatus === 'FOLLOW_UP_REQUIRED'} error={errors.followUpDate}>
            <input className={tcInput} {...text('followUpDate')} type="date" min={lead ? undefined : todayIso()} />
          </Field>

          <div>
            <span id="lead-temp-label" className="block text-xs font-medium text-slate-600 mb-1">Lead Temperature <span aria-hidden="true">*</span></span>
            <div role="radiogroup" aria-labelledby="lead-temp-label" className="flex gap-2">
              {LEAD_TEMPERATURES.map(t => {
                const on = form.leadTemperature === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set('leadTemperature', t)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold ring-1 ring-inset transition ${on ? `${TEMPERATURE_STYLE[t]} ring-2 ring-current` : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${TEMPERATURE_DOT[t]}`} aria-hidden="true" />{TEMPERATURE_LABELS[t]}
                  </button>
                );
              })}
            </div>
            {errors.leadTemperature && <p className="mt-1 text-[11px] text-rose-600">{errors.leadTemperature}</p>}
          </div>
          <Field label="Call Status" htmlFor="lead-callStatus" required error={errors.callStatus}>
            <select id="lead-callStatus" className={tcInput} value={form.callStatus} onChange={e => set('callStatus', e.target.value as CallStatus)}>
              {CALL_STATUSES.map(s => <option key={s} value={s}>{CALL_STATUS_LABELS[s]}</option>)}
            </select>
          </Field>

          <div className="sm:col-span-2"><Field label="Notes" htmlFor="lead-notes" error={errors.notes}><textarea className={`${tcInput} min-h-[88px]`} {...text('notes')} maxLength={5000} /></Field></div>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={tcBtn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={tcBtn.primary} disabled={saving}>{saving ? 'Saving…' : lead ? 'Save changes' : 'Add Lead'}</button>
        </div>
      </form>
    </Dialog>
  );
};
