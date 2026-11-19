import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Search } from 'lucide-react';
import type { ZodError } from 'zod';
import type { AdsClient, AdsLink } from '../../../shared/contracts';
import { adsClientCreateSchema, adsClientUpdateSchema } from '../../../shared/validation';
import { SideDrawer } from '../common/SideDrawer';
import { notifyAdsChanged, takePendingAds, useOpenAdsRequest } from './adsEvents';
import {
  aiDesignStudioApi, Badge, Card, CardHead, cleanLinks, DetailRow, EmptyState, ErrorLine, errorMessage, fieldCls, FormField, fmtDate, fmtDateTime, ghostBtn, Flash,
  LinksField, LinksList, LoadingLine, primaryBtn, textareaCls, useAdsData
} from './adsUi';

interface ClientForm {
  clientName: string;
  companyName: string;
  contactPerson: string;
  contactNumber: string;
  email: string;
  businessAddress: string;
  requirements: string;
  designService: string;
  workDescription: string;
  remarks: string;
  attachments: AdsLink[];
  status: 'ACTIVE' | 'INACTIVE';
}
const EMPTY_FORM: ClientForm = {
  clientName: '', companyName: '', contactPerson: '', contactNumber: '', email: '', businessAddress: '', requirements: '', designService: '', workDescription: '',
  remarks: '', attachments: [], status: 'ACTIVE'
};
const formOf = (c: AdsClient): ClientForm => ({
  clientName: c.clientName, companyName: c.companyName ?? '', contactPerson: c.contactPerson ?? '', contactNumber: c.contactNumber ?? '', email: c.email ?? '',
  businessAddress: c.businessAddress ?? '', requirements: c.requirements ?? '', designService: c.designService ?? '', workDescription: c.workDescription ?? '',
  remarks: c.remarks ?? '', attachments: c.attachments.map(a => ({ ...a })), status: c.status
});
/** What is sent: the same fields the zod schema knows (empty text becomes null there). */
const payloadOf = (f: ClientForm) => ({
  clientName: f.clientName, companyName: f.companyName, contactPerson: f.contactPerson, contactNumber: f.contactNumber, email: f.email, businessAddress: f.businessAddress,
  requirements: f.requirements, designService: f.designService, workDescription: f.workDescription, remarks: f.remarks, attachments: cleanLinks(f.attachments)
});
function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const key = String(i.path[0] ?? 'form');
    if (!out[key]) out[key] = i.message;
  }
  return out;
}

/** The client form fields, shared by "add" and "edit". */
const ClientFields: React.FC<{ idPrefix: string; value: ClientForm; onChange: (v: ClientForm) => void; errors: Record<string, string>; disabled: boolean; withStatus?: boolean }> = ({
  idPrefix, value, onChange, errors, disabled, withStatus
}) => {
  const set = <K extends keyof ClientForm>(k: K, v: ClientForm[K]) => onChange({ ...value, [k]: v });
  const text = (k: keyof ClientForm, label: string, opts: { required?: boolean; type?: string; max: number; autoComplete?: string; className?: string }) => {
    const id = `${idPrefix}-${k}`;
    return (
      <FormField label={label} htmlFor={id} required={opts.required} error={errors[k]} className={opts.className}>
        <input id={id} type={opts.type || 'text'} className={fieldCls} value={String(value[k] ?? '')} maxLength={opts.max} disabled={disabled} autoComplete={opts.autoComplete}
          aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${id}-error` : undefined} onChange={e => set(k, e.target.value as never)} />
      </FormField>
    );
  };
  const area = (k: keyof ClientForm, label: string, max: number, rows = 3) => {
    const id = `${idPrefix}-${k}`;
    return (
      <FormField label={label} htmlFor={id} error={errors[k]} className="sm:col-span-2">
        <textarea id={id} rows={rows} className={textareaCls} value={String(value[k] ?? '')} maxLength={max} disabled={disabled}
          aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${id}-error` : undefined} onChange={e => set(k, e.target.value as never)} />
      </FormField>
    );
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {text('clientName', 'Client Name', { required: true, max: 150 })}
      {text('companyName', 'Company / Business Name', { max: 150 })}
      {text('contactPerson', 'Contact Person', { max: 150 })}
      {text('contactNumber', 'Contact Number', { type: 'tel', max: 25, autoComplete: 'off' })}
      {text('email', 'Email Address', { type: 'email', max: 200, autoComplete: 'off' })}
      {text('designService', 'Design Service Required', { max: 200 })}
      {area('businessAddress', 'Business Address', 500, 2)}
      {area('requirements', 'Client Requirements', 4000)}
      {area('workDescription', 'Project / Work Description', 4000)}
      {area('remarks', 'Additional Remarks', 2000, 2)}
      {withStatus && (
        <FormField label="Status" htmlFor={`${idPrefix}-status`}>
          <select id={`${idPrefix}-status`} className={fieldCls} value={value.status} disabled={disabled} onChange={e => set('status', e.target.value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </FormField>
      )}
      <div className="sm:col-span-2">
        <div className="block text-[13px] font-semibold text-slate-700 mb-1" id={`${idPrefix}-attachments-label`}>Attachments (links, up to 5)</div>
        <LinksField idPrefix={`${idPrefix}-att`} value={value.attachments} onChange={v => set('attachments', v)} disabled={disabled} />
        {errors.attachments && <p className="text-xs text-rose-700 mt-1" role="alert">{errors.attachments}</p>}
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: AdsClient['status'] }> = ({ status }) => <Badge tone={status === 'ACTIVE' ? 'green' : 'slate'}>{status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>;

/** One client: every field, and (for the people who may change it) an edit form. */
const ClientDrawer: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { data, loading, error, reload } = useAdsData(() => aiDesignStudioApi.client(id), [id]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const startEdit = () => {
    if (!data) return;
    setForm(formOf(data));
    setErrors({});
    setServerError(null);
    setEditing(true);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    const parsed = adsClientUpdateSchema.safeParse({ ...payloadOf(form), status: form.status });
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return; }
    setErrors({});
    setServerError(null);
    busy.current = true;
    setSaving(true);
    try {
      await aiDesignStudioApi.updateClient(id, parsed.data);
      setEditing(false);
      reload();
      onChanged();
      notifyAdsChanged();
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <SideDrawer
      title={data?.clientName || 'Client'}
      subtitle={data?.companyName || undefined}
      onClose={onClose}
      actions={data?.canEdit && !editing ? <button type="button" className={`${ghostBtn} !h-9 !text-[13px]`} onClick={startEdit}><Pencil className="w-4 h-4" /> Edit</button> : undefined}
    >
      <div className="p-5 space-y-4">
        {loading && !data && <LoadingLine />}
        <ErrorLine message={error} onRetry={reload} />
        {data && !editing && (
          <dl className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center"><StatusBadge status={data.status} /></div>
            <DetailRow label="Contact person">{data.contactPerson}</DetailRow>
            <DetailRow label="Contact number">{data.contactNumber}</DetailRow>
            <DetailRow label="Email address">{data.email}</DetailRow>
            <DetailRow label="Business address">{data.businessAddress}</DetailRow>
            <DetailRow label="Design service required">{data.designService}</DetailRow>
            <DetailRow label="Client requirements">{data.requirements}</DetailRow>
            <DetailRow label="Project / work description">{data.workDescription}</DetailRow>
            <DetailRow label="Additional remarks">{data.remarks}</DetailRow>
            <DetailRow label="Attachments"><LinksList links={data.attachments} /></DetailRow>
            <DetailRow label="Added by">{data.createdByName ? `${data.createdByName} · ${fmtDateTime(data.createdAt)}` : fmtDateTime(data.createdAt)}</DetailRow>
            <DetailRow label="Last updated">{fmtDateTime(data.updatedAt)}</DetailRow>
            {!data.canEdit && <p className="text-xs text-slate-500">You can view this client. Only the person who added it, their Team Lead or the Department Head can change it.</p>}
          </dl>
        )}
        {data && editing && (
          <form onSubmit={save} noValidate className="space-y-4" aria-label="Edit client">
            <ErrorLine message={serverError} />
            <ClientFields idPrefix="ads-edit-client" value={form} onChange={setForm} errors={errors} disabled={saving} withStatus />
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" className={ghostBtn} disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>
        )}
      </div>
    </SideDrawer>
  );
};

/** Client Add: add a client of AI Design Studio, and see / open / update the clients you may see. */
export const AdsClientAdd: React.FC = () => {
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(() => takePendingAds('ads_client'));

  // the search runs a moment after typing stops (in the database, not in the browser)
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const { data: clients, loading, error, reload } = useAdsData(() => aiDesignStudioApi.clients({ search: query || undefined }), [query]);

  useOpenAdsRequest(useCallback(d => { if (d.entityType === 'ads_client') setOpenId(takePendingAds('ads_client') ?? d.id ?? null); }, []));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    setFlash(null);
    const parsed = adsClientCreateSchema.safeParse(payloadOf(form));
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); setServerError(null); return; }
    setErrors({});
    setServerError(null);
    busy.current = true;
    setSaving(true);
    try {
      const created = await aiDesignStudioApi.createClient(parsed.data);
      setForm(EMPTY_FORM);
      setFlash(`${created.clientName} was added to your clients.`);
      reload();
      notifyAdsChanged();
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-slate-900">Client Add</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">Add a client of Amuwa Design Studio. The client is saved to the department&apos;s own client records and kept with your name.</p>
      </div>

      <Card label="Add a client">
        <CardHead title="New client" hint="Only the client name is required." />
        <form onSubmit={submit} noValidate className="px-5 pb-5 space-y-4" aria-label="Add a client">
          <Flash text={flash} onClose={() => setFlash(null)} />
          <ErrorLine message={serverError} />
          <ClientFields idPrefix="ads-client" value={form} onChange={setForm} errors={errors} disabled={saving} />
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" className={ghostBtn} disabled={saving} onClick={() => { setForm(EMPTY_FORM); setErrors({}); setServerError(null); }}>Clear</button>
            <button type="submit" className={primaryBtn} disabled={saving}><Plus className="w-4 h-4" /> {saving ? 'Saving…' : 'Save client'}</button>
          </div>
        </form>
      </Card>

      <Card label="Clients">
        <CardHead
          title="Your clients"
          hint="The clients you added, your team's, or ones you work on. Open a client to see everything and update it."
          right={
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input aria-label="Search clients" className={`${fieldCls} !pl-9`} placeholder="Search by client or company" value={search} maxLength={100} onChange={e => setSearch(e.target.value)} />
            </div>
          }
        />
        <div className="px-5 pb-5">
          <ErrorLine message={error} onRetry={reload} />
          {loading && !clients ? <LoadingLine /> : clients && clients.length === 0 ? (
            <EmptyState title={query ? 'No client matches your search.' : 'No clients yet.'} hint={query ? 'Try another name or clear the search.' : 'Add your first client with the form above.'} />
          ) : clients ? (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-left text-sm min-w-[720px]">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th scope="col" className="py-2 px-1 font-semibold">Client</th>
                    <th scope="col" className="py-2 px-1 font-semibold">Company</th>
                    <th scope="col" className="py-2 px-1 font-semibold">Contact</th>
                    <th scope="col" className="py-2 px-1 font-semibold">Service</th>
                    <th scope="col" className="py-2 px-1 font-semibold">Added by</th>
                    <th scope="col" className="py-2 px-1 font-semibold">Date</th>
                    <th scope="col" className="py-2 px-1 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => (
                    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(c.id)}>
                      <td className="py-2.5 px-1">
                        <button type="button" className="font-semibold text-blue-700 hover:underline text-left" onClick={e => { e.stopPropagation(); setOpenId(c.id); }}>{c.clientName}</button>
                      </td>
                      <td className="py-2.5 px-1 text-slate-700">{c.companyName || '–'}</td>
                      <td className="py-2.5 px-1 text-slate-700">{c.contactPerson || '–'}{c.contactNumber ? <div className="text-xs text-slate-500">{c.contactNumber}</div> : null}</td>
                      <td className="py-2.5 px-1 text-slate-700">{c.designService || '–'}</td>
                      <td className="py-2.5 px-1 text-slate-700">{c.createdByName || '–'}</td>
                      <td className="py-2.5 px-1 text-slate-700 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                      <td className="py-2.5 px-1"><StatusBadge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </Card>

      {openId && <ClientDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
};
