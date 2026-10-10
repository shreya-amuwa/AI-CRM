import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, Clock, MapPin, MessageCircle, Phone, Send } from 'lucide-react';
import type { Conversation, LeadStatus, PaymentOverview, PipelineCustomerDetail, ServiceCatalogItem } from '../../../../shared/contracts';
import { LEAD_STATUSES } from '../../../../shared/contracts';
import { leadCreateSchema } from '../../../../shared/validation';
import { ApiError, errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { fmtDate, PaymentHistory, rupees, WorkflowBadge } from '../../payments/PaymentBits';
import { ConversationSection } from './LeadConversations';
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
  disabled?: boolean;
}> = ({ services, value, onChange, variant, error, disabled }) => {
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
              disabled={disabled}
              onClick={() => toggle(s.code)}
              className={`disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
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
  const [sendOpen, setSendOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [overview, setOverview] = useState<PaymentOverview | null>(null);

  const hydrate = (l: PipelineCustomerDetail) => {
    setLead(l);
    setConversations(l.conversations);
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
  /** Refresh only the activity list (a conversation was saved) without touching what is being edited. */
  const refreshActivities = () => {
    void pipelineApi.get(id).then(l => setLead(cur => (cur ? { ...cur, activities: l.activities } : cur)), () => undefined);
  };
  // Where the lead is in the Accounts workflow (the request, who sent it, any reason it came back).
  useEffect(() => {
    if (!lead || lead.paymentWorkflow === 'NONE') return setOverview(null);
    let live = true;
    pipelineApi.paymentOverview(id).then(o => live && setOverview(o), () => live && setOverview(null));
    return () => {
      live = false;
    };
  }, [id, lead?.paymentWorkflow]);
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
  /** With Accounts for payment confirmation: Sales cannot change the lead until Accounts answers. */
  const locked = lead.paymentWorkflow === 'PENDING_PAYMENT_CONFIRMATION';

  const detailField = (label: string, key: keyof typeof form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`edit-${key}`} className="block text-xs font-medium text-slate-500 mb-1">
        {label}
      </label>
      <input
        id={`edit-${key}`}
        className={`${inputCls} bg-slate-50 border-transparent focus:bg-white ${errors[key] ? 'border-rose-400' : ''}`}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        aria-invalid={!!errors[key]}
        disabled={locked}
        {...props}
      />
      {errors[key] && <p className="mt-1 text-[11px] text-rose-600">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to leads
        </button>
        {!locked && (
          <div className="flex gap-2">
            <button type="button" className={btn.secondary} onClick={() => hydrate(lead)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={btn.primary} onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
      {error && <ErrorBanner message={error} />}
      {notice && !error && (
        <p role="status" className="text-xs text-emerald-700">
          {notice}
        </p>
      )}

      {/* 1 · Lead header and the actions available on this lead */}
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
                <WorkflowBadge workflow={lead.paymentWorkflow} />
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
          <div className="flex flex-wrap gap-2">
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
            <span className="text-xs text-slate-500">{locked ? 'With Accounts — locked until they answer' : 'Tap a step to change the status'}</span>
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
                    disabled={locked}
                    aria-pressed={current}
                    aria-label={`${LEAD_STATUS_LABEL[s]} — ${LEAD_STATUS_HINT[s]}`}
                    className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
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
          {status === 'READY_TO_BUY' && !locked && (
            <div className="mt-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 rounded-xl bg-emerald-800 text-white">
              <div>
                <div className="text-sm font-bold">{firstName} is ready to buy</div>
                <div className="text-xs text-emerald-100">Send them to Accounts to confirm the payment. Accounts then returns them to Customer onboarding.</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-emerald-800 text-xs font-bold hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  onClick={() => setSendOpen(true)}
                  disabled={saving}
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" /> Send to Accounts
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-emerald-300/60 text-white text-xs font-bold hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  onClick={() => setMoveOpen(true)}
                  disabled={saving}
                >
                  Save &amp; move to Potential <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
          {status !== 'READY_TO_BUY' && !locked && (
            <div className="mt-4 flex justify-end">
              <button type="button" className={btn.secondary} onClick={() => setSendOpen(true)} disabled={saving}>
                <Send className="w-3.5 h-3.5" aria-hidden="true" /> Send to Accounts
              </button>
            </div>
          )}
        </div>
      </Card>

      {lead.paymentWorkflow !== 'NONE' && lead.paymentWorkflow !== 'PAYMENT_CONFIRMED' && <AccountsStateCard workflow={lead.paymentWorkflow} overview={overview} />}

      {/* 2 · Customer details — full width */}
      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900 mb-4">Customer details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-4">
          {detailField('Contact person', 'name')}
          {detailField('Business name', 'company')}
          {detailField('Mobile', 'phone', { type: 'tel' })}
          {detailField('Email', 'email', { type: 'email' })}
          {detailField('City', 'city')}
          <div>
            <label htmlFor="edit-leadSource" className="block text-xs font-medium text-slate-500 mb-1">
              Lead source
            </label>
            <select
              id="edit-leadSource"
              className={`${inputCls} bg-slate-50 border-transparent`}
              value={form.leadSource}
              disabled={locked}
              onChange={e => setForm(f => ({ ...f, leadSource: e.target.value }))}
            >
              {[...new Set([form.leadSource, ...LEAD_SOURCES])].filter(Boolean).map(s => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {detailField('Next follow-up', 'nextFollowUpAt', { type: 'datetime-local' })}
        </div>
      </Card>

      {/* 3 · Services interested in — full width */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">Services interested in</h2>
          <span className="text-xs text-slate-500">{selected.length} selected</span>
        </div>
        <ServicePicker services={services} value={selected} onChange={setSelected} variant="chips" error={errors.services} disabled={locked} />
      </Card>

      {/* 4 + 5 · Last conversation and the conversation history */}
      <ConversationSection customerId={id} conversations={conversations} onChange={setConversations} onSaved={refreshActivities} />

      {/* 6 · Last activities — full width, at the bottom */}
      <ActivityCard activities={lead.activities} title="Last activities" />

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
      {sendOpen && (
        <SendToAccountsDialog
          leadName={lead.company || lead.name}
          defaultAmount={lead.dealAmount ?? lead.expectedBudget}
          hasServices={selected.length > 0}
          onClose={() => setSendOpen(false)}
          onConfirm={async (amount, note) => {
            // Persist pending edits first; the database then re-checks everything.
            if (!(await save())) return false;
            await pipelineApi.sendToAccounts(id, { amount, note });
            notifyPipelineChanged();
            hydrate(await pipelineApi.get(id));
            setSendOpen(false);
            setNotice('Sent to Accounts. You will be notified when they confirm the payment or return the customer.');
            return true;
          }}
        />
      )}
    </div>
  );
};

/** Where the lead is in the Accounts workflow: waiting, or returned with the reason. */
const AccountsStateCard: React.FC<{ workflow: 'PENDING_PAYMENT_CONFIRMATION' | 'RETURNED_FROM_ACCOUNTS' | string; overview: PaymentOverview | null }> = ({ workflow, overview }) => {
  const pending = workflow === 'PENDING_PAYMENT_CONFIRMATION';
  const req = overview?.request ?? null;
  return (
    <section
      role="status"
      aria-label={pending ? 'With Accounts' : 'Returned from Accounts'}
      className={`rounded-2xl border p-5 ${pending ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}
    >
      <h2 className="text-sm font-bold">{pending ? 'With Accounts — payment confirmation pending' : 'Returned from Accounts'}</h2>
      {pending ? (
        <p className="mt-1 text-xs">
          {req ? `Sent by ${req.requestedBy ?? 'Sales'} on ${fmtDate(req.requestedAt)} · agreed ${rupees(req.agreedAmount)}. ` : ''}
          Accounts will confirm the payment and return this customer to Customer onboarding, or send them back here if they back off. The lead is locked until then.
        </p>
      ) : (
        <p className="mt-1 text-xs">
          {req?.resolutionNote ? <>“{req.resolutionNote}” — </> : ''}
          {req ? `returned by ${req.resolvedBy ?? 'Accounts'} on ${fmtDate(req.resolvedAt)}. ` : ''}
          Follow up with the customer, then send to Accounts again when they are ready.
        </p>
      )}
      {overview && overview.payments.length > 0 && (
        <div className="mt-3 bg-white/70 rounded-xl p-3 text-slate-800">
          {!pending && overview.verified > 0 && (
            <p className="text-xs font-semibold mb-2">{rupees(overview.verified)} was already received and verified. Accounts handles any refund or cancellation.</p>
          )}
          <PaymentHistory payments={overview.payments} />
        </div>
      )}
    </section>
  );
};

const SendToAccountsDialog: React.FC<{
  leadName: string;
  defaultAmount: number | null;
  hasServices: boolean;
  onClose: () => void;
  onConfirm: (amount: number, note: string | null) => Promise<boolean>;
}> = ({ leadName, defaultAmount, hasServices, onClose, onConfirm }) => {
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!hasServices) return setError('Select at least one service first.');
    if (!(n > 0)) return setError('Enter the agreed amount.');
    if (!Number.isInteger(n)) return setError('Enter whole rupees only (no paise), e.g. 15000.');
    setBusy(true);
    setError(null);
    try {
      if (!(await onConfirm(n, note.trim() || null))) setBusy(false);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Send to Accounts" description={`${leadName} goes to Accounts to confirm the payment. They return the customer to Customer onboarding once the payment is verified, or back here if the customer backs off.`} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Agreed amount (₹)" required htmlFor="accounts-amount">
          <input id="accounts-amount" type="number" min={1} step={1} inputMode="numeric" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} onKeyDown={blockDecimals} />
        </Field>
        <Field label="Note for Accounts (optional)" htmlFor="accounts-note">
          <textarea id="accounts-note" rows={2} maxLength={1000} className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Customer will pay half today by UPI" />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btn.green} disabled={busy}>
            {busy ? 'Sending…' : 'Send to Accounts'}
          </button>
        </div>
      </form>
    </Dialog>
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

export const ActivityCard: React.FC<{ activities: PipelineCustomerDetail['activities']; footer?: React.ReactNode; title?: string }> = ({ activities, footer, title = 'Activity' }) => (
  <Card className="p-5 h-fit">
    <h2 className="text-sm font-bold text-slate-900 mb-3">{title}</h2>
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
