import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, Clock, MapPin, MessageCircle, Phone } from 'lucide-react';
import type { LeadStatus, PipelineCustomerDetail, ServiceCatalogItem } from '../../../../shared/contracts';
import { LEAD_STATUSES } from '../../../../shared/contracts';
import { leadCreateSchema } from '../../../../shared/validation';
import { ApiError, errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import {
  blockDecimals,
  Avatar,
  Breadcrumb,
  btn,
  BUSINESS_CATEGORIES,
  Card,
  categoryDot,
  Dialog,
  ErrorBanner,
  Field,
  inputCls,
  LEAD_SOURCES,
  LEAD_STATUS_HINT,
  LEAD_STATUS_LABEL,
  longDate,
  notifyPipelineChanged,
  Pill,
  Spinner,
  todayIso,
  useServiceCatalog
} from './shared';

type Errors = Record<string, string>;

/** Map zod issues / API validation details to { field: message }. */
function fieldErrors(issues: { path: (string | number)[] | string; message: string }[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const key = Array.isArray(i.path) ? String(i.path[0] ?? '') : i.path.split('.')[0];
    if (key && !out[key]) out[key] = i.message;
  }
  return out;
}
function apiFieldErrors(err: unknown): Errors {
  if (err instanceof ApiError && Array.isArray(err.details)) return fieldErrors(err.details as any);
  return {};
}

/** datetime-local value ⇄ ISO with the user's offset. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

// ---------------------------------------------------------------------------
// Service picker (grouped checkboxes / chips)
// ---------------------------------------------------------------------------
const ServicePicker: React.FC<{
  services: ServiceCatalogItem[];
  value: string[];
  onChange: (v: string[]) => void;
  variant: 'grid' | 'chips';
  error?: string;
}> = ({ services, value, onChange, variant, error }) => {
  const groups = useMemo(() => {
    const m = new Map<string, ServiceCatalogItem[]>();
    for (const s of services) m.set(s.category, [...(m.get(s.category) || []), s]);
    return [...m.entries()];
  }, [services]);
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);

  if (variant === 'chips') {
    const ordered = [...services].sort((a, b) => Number(value.includes(b.code)) - Number(value.includes(a.code)));
    return (
      <div className="flex flex-wrap gap-2">
        {ordered.map(s => {
          const on = value.includes(s.code);
          return (
            <button
              key={s.code}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(s.code)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                on ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {on ? (
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-white inline-flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
              ) : (
                <span className={`w-1.5 h-1.5 rounded-full ${categoryDot(s.category)}`} />
              )}
              {s.name}
            </button>
          );
        })}
        {error && <p className="w-full text-[11px] text-rose-600">{error}</p>}
      </div>
    );
  }
  return (
    <fieldset aria-describedby={error ? 'services-error' : undefined}>
      <legend className="sr-only">Services interested in</legend>
      <div className="space-y-4">
        {groups.map(([category, items]) => (
          <div key={category}>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-2">
              <span className={`w-1.5 h-1.5 rounded-full ${categoryDot(category)}`} />
              {category}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              {items.map(s => {
                const on = value.includes(s.code);
                return (
                  <label
                    key={s.code}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-medium cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-indigo-300 ${
                      on ? 'border-indigo-300 bg-indigo-50/70 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={on} onChange={() => toggle(s.code)} />
                    {s.name}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p id="services-error" className="mt-2 text-[11px] text-rose-600">
          {error}
        </p>
      )}
    </fieldset>
  );
};

// ---------------------------------------------------------------------------
// 1b · Add lead
// ---------------------------------------------------------------------------
const EMPTY = {
  name: '',
  company: '',
  phone: '',
  whatsapp: '',
  email: '',
  city: '',
  businessCategory: '',
  leadSource: 'Walk-in',
  leadStatus: 'NEW' as LeadStatus,
  nextFollowUpAt: '',
  expectedBudget: '',
  notes: ''
};

export const AddLeadView: React.FC<{ onCancel: () => void; onSaved: (id: string) => void }> = ({ onCancel, onSaved }) => {
  const { items: services, error: catalogError } = useServiceCatalog();
  const [form, setForm] = useState(EMPTY);
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...form,
      whatsapp: form.whatsapp || null,
      email: form.email || null,
      city: form.city || null,
      businessCategory: form.businessCategory || null,
      nextFollowUpAt: fromLocalInput(form.nextFollowUpAt),
      expectedBudget: form.expectedBudget === '' ? null : form.expectedBudget,
      notes: form.notes || null,
      services: selected
    };
    const parsed = leadCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      setError('Please fix the highlighted fields.');
      return;
    }
    setErrors({});
    setError(null);
    setSaving(true);
    try {
      const lead = await pipelineApi.createLead(parsed.data);
      notifyPipelineChanged();
      onSaved(lead.id);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const input = (k: keyof typeof EMPTY, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={`lead-${k}`}
      className={`${inputCls} ${errors[k] ? 'border-rose-400' : ''}`}
      value={form[k]}
      onChange={set(k)}
      aria-invalid={!!errors[k]}
      aria-describedby={errors[k] ? `lead-${k}-error` : undefined}
      {...props}
    />
  );

  return (
    <form onSubmit={submit} className="space-y-4 max-w-5xl" noValidate>
      <div>
        <Breadcrumb items={[{ label: 'Leads', onClick: onCancel }, { label: 'New lead' }]} />
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Add a new lead</h1>
        <p className="text-sm text-slate-500 mt-0.5">Fill in the customer's details and tick every service they asked about.</p>
      </div>
      {error && <ErrorBanner message={error} />}

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3">Customer details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Contact person" required htmlFor="lead-name" error={errors.name}>
            {input('name', { autoComplete: 'name', required: true })}
          </Field>
          <Field label="Business name" required htmlFor="lead-company" error={errors.company}>
            {input('company', { autoComplete: 'organization', required: true })}
          </Field>
          <Field label="Mobile number" required htmlFor="lead-phone" error={errors.phone}>
            {input('phone', { type: 'tel', placeholder: '+91', autoComplete: 'tel', required: true })}
          </Field>
          <Field label="WhatsApp number" htmlFor="lead-whatsapp" error={errors.whatsapp}>
            {input('whatsapp', { type: 'tel', placeholder: 'Same as mobile' })}
          </Field>
          <Field label="Email" htmlFor="lead-email" error={errors.email}>
            {input('email', { type: 'email', placeholder: 'name@business.com', autoComplete: 'email' })}
          </Field>
          <Field label="City" htmlFor="lead-city" error={errors.city}>
            {input('city', { placeholder: 'e.g. Mumbai' })}
          </Field>
          <Field label="Business category" htmlFor="lead-businessCategory">
            <select id="lead-businessCategory" className={inputCls} value={form.businessCategory} onChange={set('businessCategory')}>
              <option value="">Select…</option>
              {BUSINESS_CATEGORIES.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Lead source" required htmlFor="lead-leadSource" error={errors.leadSource}>
            <select id="lead-leadSource" className={inputCls} value={form.leadSource} onChange={set('leadSource')}>
              {LEAD_SOURCES.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">
            Services interested in <span aria-hidden="true">*</span>
          </h2>
          <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold" aria-live="polite">
            {selected.length} selected
          </span>
        </div>
        {catalogError ? (
          <ErrorBanner message={catalogError} />
        ) : services.length === 0 ? (
          <Spinner label="Loading services…" />
        ) : (
          <ServicePicker services={services} value={selected} onChange={setSelected} variant="grid" error={errors.services} />
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3">Follow-up</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Lead status" htmlFor="lead-leadStatus">
            <select id="lead-leadStatus" className={inputCls} value={form.leadStatus} onChange={set('leadStatus')}>
              {LEAD_STATUSES.map(s => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Next follow-up" htmlFor="lead-nextFollowUpAt" error={errors.nextFollowUpAt}>
            {input('nextFollowUpAt', { type: 'datetime-local' })}
          </Field>
          <Field label="Expected budget (₹)" htmlFor="lead-expectedBudget" error={errors.expectedBudget}>
            {input('expectedBudget', { type: 'number', min: 0, inputMode: 'numeric', placeholder: 'Optional' })}
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notes from the conversation" htmlFor="lead-notes" error={errors.notes}>
            <textarea
              id="lead-notes"
              rows={4}
              className={inputCls}
              value={form.notes}
              onChange={set('notes')}
              placeholder="What did the customer ask for? Any timeline or objections?"
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className={btn.primary} disabled={saving}>
          {saving ? 'Saving…' : 'Save lead'}
        </button>
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// 1c · Edit lead
// ---------------------------------------------------------------------------
export const EditLeadView: React.FC<{
  id: string;
  onBack: () => void;
  onMovedToPotential: () => void;
}> = ({ id, onBack, onMovedToPotential }) => {
  const { items: services } = useServiceCatalog();
  const [lead, setLead] = useState<PipelineCustomerDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '', city: '', leadSource: '', nextFollowUpAt: '' });
  const [status, setStatus] = useState<LeadStatus>('NEW');
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);

  const hydrate = (l: PipelineCustomerDetail) => {
    setLead(l);
    setForm({
      name: l.name,
      company: l.company || '',
      phone: l.phone || '',
      email: l.email || '',
      city: l.city || '',
      leadSource: l.leadSource || '',
      nextFollowUpAt: toLocalInput(l.nextFollowUpAt)
    });
    setStatus(l.leadStatus);
    setSelected(l.services);
  };
  const load = () => {
    setLoadError(null);
    pipelineApi.get(id).then(hydrate, err => setLoadError(errorMessage(err)));
  };
  useEffect(load, [id]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;
  if (!lead) return <Spinner label="Loading lead…" />;
  if (lead.lifecycleStage !== 'LEAD') {
    return (
      <div className="space-y-3">
        <ErrorBanner message={`${lead.company || lead.name} is no longer a lead (now in ${lead.lifecycleStage.toLowerCase()}).`} />
        <button type="button" className={btn.secondary} onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to leads
        </button>
      </div>
    );
  }

  /** Only the fields that changed are sent. */
  const changes = () => {
    const body: Record<string, unknown> = {};
    const cmp = (k: string, next: unknown, prev: unknown) => {
      if ((next ?? null) !== (prev ?? null)) body[k] = next;
    };
    cmp('name', form.name.trim(), lead.name);
    cmp('company', form.company.trim(), lead.company);
    cmp('phone', form.phone.trim(), lead.phone);
    cmp('email', form.email.trim() || null, lead.email);
    cmp('city', form.city.trim() || null, lead.city);
    cmp('leadSource', form.leadSource, lead.leadSource);
    cmp('nextFollowUpAt', fromLocalInput(form.nextFollowUpAt), lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toISOString() : null);
    if (status !== lead.leadStatus) body.leadStatus = status;
    if ([...selected].sort().join() !== [...lead.services].sort().join()) body.services = selected;
    return body;
  };

  const save = async (): Promise<boolean> => {
    const body = changes();
    if (Object.keys(body).length === 0) return true;
    if (Array.isArray(body.services) && (body.services as string[]).length === 0) {
      setErrors({ services: 'Select at least one service.' });
      return false;
    }
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      await pipelineApi.updateLead(id, body as any);
      const fresh = await pipelineApi.get(id);
      hydrate(fresh);
      notifyPipelineChanged();
      return true;
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onSave = async () => {
    if (await save()) setNotice('Changes saved.');
  };

  const phoneDigits = (lead.whatsapp || lead.phone || '').replace(/\D/g, '');
  const statusIndex = LEAD_STATUSES.indexOf(status);
  const firstName = lead.name.split(' ')[0];

  const detailRow = (label: string, key: keyof typeof form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] items-center gap-2 py-2.5 border-b border-slate-100 last:border-0">
      <label htmlFor={`edit-${key}`} className="text-xs text-slate-500">
        {label}
      </label>
      <div>
        <input
          id={`edit-${key}`}
          className={`${inputCls} bg-slate-50 border-transparent focus:bg-white ${errors[key] ? 'border-rose-400' : ''}`}
          value={form[key]}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          aria-invalid={!!errors[key]}
          {...props}
        />
        {errors[key] && <p className="mt-1 text-[11px] text-rose-600">{errors[key]}</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to leads
        </button>
        <div className="flex gap-2">
          <button type="button" className={btn.secondary} onClick={() => hydrate(lead)} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={btn.primary} onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {notice && !error && (
        <p role="status" className="text-xs text-emerald-700">
          {notice}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar name={lead.name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900 truncate">{lead.name}</h1>
                <Pill tone={status === 'READY_TO_BUY' ? 'green' : status === 'INTERESTED' ? 'orange' : status === 'CONTACTED' ? 'indigo' : 'slate'}>
                  {LEAD_STATUS_LABEL[status]}
                </Pill>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" /> {lead.company}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" /> {lead.phone}
                </span>
                {lead.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {lead.city}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Added {longDate(lead.createdAt)}
                  {lead.leadSource ? ` · ${lead.leadSource}` : ''}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {lead.phone && (
              <a className={btn.secondary} href={`tel:${lead.phone.replace(/\s/g, '')}`}>
                <Phone className="w-3.5 h-3.5" /> Call
              </a>
            )}
            {phoneDigits && (
              <a className={btn.secondary} href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </a>
            )}
          </div>
        </div>

        <div className="px-5 pb-5 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Where is this lead?</h2>
            <span className="text-xs text-slate-500">Tap a step to change the status</span>
          </div>
          <ol className="mt-4 grid grid-cols-4 relative" aria-label="Lead status">
            <div className="absolute top-4 left-[12.5%] right-[12.5%] h-0.5 bg-slate-200" aria-hidden="true">
              <div className="h-full bg-emerald-700 transition-all" style={{ width: `${(statusIndex / 3) * 100}%` }} />
            </div>
            {LEAD_STATUSES.map((s, i) => {
              const done = i < statusIndex;
              const current = i === statusIndex;
              return (
                <li key={s} className="relative flex flex-col items-center text-center">
                  <button
                    type="button"
                    onClick={() => setStatus(s)}
                    aria-pressed={current}
                    aria-label={`${LEAD_STATUS_LABEL[s]} — ${LEAD_STATUS_HINT[s]}`}
                    className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 ${
                      done || current ? 'bg-emerald-700 text-white' : 'bg-white border-2 border-slate-200 text-slate-400 hover:border-emerald-400'
                    } ${current ? 'ring-4 ring-emerald-100' : ''}`}
                  >
                    {done ? <Check className="w-4 h-4" /> : i + 1}
                  </button>
                  <span className={`mt-2 text-xs ${current ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>{LEAD_STATUS_LABEL[s]}</span>
                  <span className="text-[11px] text-slate-400">{LEAD_STATUS_HINT[s]}</span>
                </li>
              );
            })}
          </ol>
          {status === 'READY_TO_BUY' && (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-emerald-800 text-white">
              <div>
                <div className="text-sm font-bold">{firstName} is ready to buy</div>
                <div className="text-xs text-emerald-100">Saving moves this customer out of Leads and into the Potential section to collect payment.</div>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-emerald-800 text-xs font-bold hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={() => setMoveOpen(true)}
                disabled={saving}
              >
                Save &amp; move to Potential <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-1">Customer details</h2>
            {detailRow('Contact person', 'name')}
            {detailRow('Business name', 'company')}
            {detailRow('Mobile', 'phone', { type: 'tel' })}
            {detailRow('Email', 'email', { type: 'email' })}
            {detailRow('City', 'city')}
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] items-center gap-2 py-2.5 border-b border-slate-100">
              <label htmlFor="edit-leadSource" className="text-xs text-slate-500">
                Lead source
              </label>
              <select
                id="edit-leadSource"
                className={`${inputCls} bg-slate-50 border-transparent`}
                value={form.leadSource}
                onChange={e => setForm(f => ({ ...f, leadSource: e.target.value }))}
              >
                {[...new Set([form.leadSource, ...LEAD_SOURCES])].filter(Boolean).map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            {detailRow('Next follow-up', 'nextFollowUpAt', { type: 'datetime-local' })}
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900">Services interested in</h2>
              <span className="text-xs text-slate-500">{selected.length} selected</span>
            </div>
            <ServicePicker services={services} value={selected} onChange={setSelected} variant="chips" error={errors.services} />
          </Card>
        </div>
        <ActivityCard activities={lead.activities} />
      </div>

      {moveOpen && (
        <MoveToPotentialDialog
          leadName={lead.company || lead.name}
          defaultAmount={lead.expectedBudget}
          onClose={() => setMoveOpen(false)}
          onConfirm={async (dealAmount, paymentDueDate) => {
            // Persist pending edits (incl. READY_TO_BUY) first, then move.
            if (!(await save())) return false;
            await pipelineApi.moveToPotential(id, { dealAmount, paymentDueDate });
            notifyPipelineChanged();
            onMovedToPotential();
            return true;
          }}
        />
      )}
    </div>
  );
};

const MoveToPotentialDialog: React.FC<{
  leadName: string;
  defaultAmount: number | null;
  onClose: () => void;
  onConfirm: (amount: number, due: string) => Promise<boolean>;
}> = ({ leadName, defaultAmount, onClose, onConfirm }) => {
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '');
  const [due, setDue] = useState(() => {
    const d = new Date(Date.now() + 7 * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0)) return setError('Enter the deal amount.');
    if (!Number.isInteger(n)) return setError('Enter whole rupees only (no paise), e.g. 15000.');
    if (!due) return setError('Choose the payment due date.');
    setBusy(true);
    setError(null);
    try {
      if (!(await onConfirm(n, due))) setBusy(false);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Move to Potential" description={`${leadName} will move from Leads to Potential to collect payment.`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Deal amount (₹)" required htmlFor="move-amount">
          <input id="move-amount" type="number" min={1} step={1} inputMode="numeric" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} onKeyDown={blockDecimals} />
        </Field>
        <Field label="Payment due date" required htmlFor="move-due">
          <input id="move-due" type="date" min={todayIso()} className={inputCls} value={due} onChange={e => setDue(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btn.green} disabled={busy}>
            {busy ? 'Moving…' : 'Save & move to Potential'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

const ACTIVITY_DOT: Record<string, string> = {
  STATUS_NEW: 'bg-slate-400',
  STATUS_CONTACTED: 'bg-indigo-500',
  STATUS_INTERESTED: 'bg-orange-500',
  STATUS_READY_TO_BUY: 'bg-emerald-600'
};
const activityTitle = (type: string) =>
  type.startsWith('STATUS_')
    ? LEAD_STATUS_LABEL[type.slice(7) as LeadStatus] || type
    : type
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^\w/, c => c.toUpperCase());

export const ActivityCard: React.FC<{ activities: PipelineCustomerDetail['activities']; footer?: React.ReactNode }> = ({ activities, footer }) => (
  <Card className="p-5 h-fit">
    <h2 className="text-sm font-bold text-slate-900 mb-3">Activity</h2>
    {activities.length === 0 ? (
      <p className="text-xs text-slate-500">No activity yet.</p>
    ) : (
      <ol className="space-y-3">
        {/* Only the five most recent entries. */}
        {activities.slice(0, 5).map(a => (
          <li key={a.id} className="flex gap-2.5">
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${ACTIVITY_DOT[a.type] || 'bg-indigo-400'}`} aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-xs">
                <span className="font-semibold text-slate-900">{activityTitle(a.type)}</span>
                <span className="text-slate-400"> · {longDate(a.occurredAt)}</span>
              </div>
              {a.note && <div className="text-xs text-slate-600 break-words">{a.note}</div>}
            </div>
          </li>
        ))}
      </ol>
    )}
    {footer}
  </Card>
);
