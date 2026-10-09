import React, { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { Person } from '../../lib/workTasks';
import {
  CHANNELS,
  CUSTOMER_STATUS_LABELS,
  isWhatsAppService,
  messagesRemaining,
  SEGMENT_LABELS,
  useServices,
  type CustomerInput,
  type CustomerSegmentValue,
  type CustomerStatusValue,
  type SupportCustomer,
  type WhatsAppDetails
} from '../../lib/support';
import { FormField, inputClass } from './SupportParts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const emptyCustomerInput = (assigneeId?: string): CustomerInput => ({
  name: '',
  company: '',
  phone: '',
  email: '',
  segment: 'RETAIL',
  status: 'ACTIVE',
  serviceCode: '',
  serviceDetails: {},
  requirement: '',
  channel: 'Phone',
  notes: '',
  assigneeId
});

export const customerToInput = (c: SupportCustomer): CustomerInput => ({
  name: c.name,
  company: c.company || '',
  phone: c.phone || '',
  email: c.email || '',
  segment: c.segment,
  status: c.status,
  serviceCode: c.serviceCode || '',
  serviceDetails: c.serviceDetails || {},
  requirement: c.requirement || '',
  channel: c.channel || 'Phone',
  notes: c.notes || '',
  assigneeId: c.ownerId
});

type Errors = Partial<Record<'name' | 'contact' | 'email' | 'phone' | 'whatsapp', string>>;

function validate(f: CustomerInput): Errors {
  const e: Errors = {};
  if (f.name.trim().length < 2) e.name = 'Enter the customer’s full name.';
  if (!f.phone.trim() && !f.email.trim()) e.contact = 'Enter a phone number or an e-mail address.';
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid e-mail address.';
  if (f.phone.trim() && (!/^[0-9+()\-\s.]{5,25}$/.test(f.phone.trim()) || f.phone.replace(/\D/g, '').length < 7))
    e.phone = 'Enter a valid phone number (at least 7 digits).';
  if (isWhatsAppService(f.serviceCode)) {
    const d = f.serviceDetails;
    if ([d.campaignsSent, d.packageMessages, d.messagesSent].some(n => n !== undefined && (n < 0 || !Number.isInteger(n))))
      e.whatsapp = 'Use whole numbers of 0 or more.';
    else if ((d.messagesSent || 0) > (d.packageMessages || 0)) e.whatsapp = 'Messages sent cannot be more than the message package.';
  }
  return e;
}

interface CustomerFormProps {
  initial: CustomerInput;
  people: Person[];
  submitLabel: string;
  /** Throws an Error with a readable message when the database refuses. */
  onSubmit: (input: CustomerInput) => Promise<void>;
  onCancel: () => void;
  idPrefix?: string;
  /** Wording of the assignee field (defaults to the Support wording). */
  assigneeLabel?: string;
  assigneeHint?: string;
}

/** The customer fields, validated here and again by the database. */
export const CustomerForm: React.FC<CustomerFormProps> = ({ initial, people, submitLabel, onSubmit, onCancel, idPrefix = 'cf', assigneeLabel, assigneeHint }) => {
  const { profile } = useAuth();
  const services = useServices();
  const isLead = profile?.role === 'TEAM_HEAD' || profile?.role === 'DEPARTMENT_HEAD' || profile?.role === 'SUPER_ADMIN';
  const team = people.filter(
    p => (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.status === 'ACTIVE' && (profile?.role === 'TEAM_HEAD' ? p.teamId === profile?.teamId : true)
  );
  const [form, setForm] = useState<CustomerInput>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const set = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K]) => setForm(f => ({ ...f, [k]: v }));
  const setWa = (k: keyof WhatsAppDetails, v: string) => {
    setErrors(e => ({ ...e, whatsapp: undefined }));
    setForm(f => ({
      ...f,
      serviceDetails: { ...f.serviceDetails, [k]: k === 'campaignNotes' ? v : v === '' ? undefined : Number(v) }
    }));
  };
  const id = (k: string) => `${idPrefix}-${k}`;
  const categories = [...new Set(services.map(s => s.category))];
  const wa = form.serviceDetails;
  const assigneeOptions = isLead ? team : [{ id: profile?.id || '', fullName: profile?.fullName || 'Me' }];
  // When editing someone else's customer, keep the current owner selectable.
  if (form.assigneeId && !assigneeOptions.some(p => p.id === form.assigneeId)) {
    const owner = people.find(p => p.id === form.assigneeId);
    assigneeOptions.unshift({ id: form.assigneeId, fullName: owner?.fullName || 'Current owner' } as Person);
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save the customer.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-label={submitLabel}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Customer full name" htmlFor={id('name')} required error={errors.name}>
          <input id={id('name')} value={form.name} onChange={e => set('name', e.target.value)} maxLength={200} className={inputClass} autoComplete="off" />
        </FormField>
        <FormField label="Company or organization" htmlFor={id('company')}>
          <input id={id('company')} value={form.company} onChange={e => set('company', e.target.value)} maxLength={200} className={inputClass} />
        </FormField>
        <FormField label="Phone number" htmlFor={id('phone')} error={errors.phone || errors.contact} hint="Phone or e-mail is required.">
          <input id={id('phone')} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={inputClass} placeholder="+91 98765 43210" />
        </FormField>
        <FormField label="Email address" htmlFor={id('email')} error={errors.email}>
          <input id={id('email')} type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputClass} placeholder="name@company.com" />
        </FormField>
        <FormField label="Customer type" htmlFor={id('type')}>
          <select id={id('type')} value={form.segment} onChange={e => set('segment', e.target.value as CustomerSegmentValue)} className={inputClass}>
            {(Object.keys(SEGMENT_LABELS) as CustomerSegmentValue[]).map(s => (
              <option key={s} value={s}>
                {SEGMENT_LABELS[s]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Customer status" htmlFor={id('status')}>
          <select id={id('status')} value={form.status} onChange={e => set('status', e.target.value as CustomerStatusValue)} className={inputClass}>
            {(Object.keys(CUSTOMER_STATUS_LABELS) as CustomerStatusValue[]).map(s => (
              <option key={s} value={s}>
                {CUSTOMER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Service or product" htmlFor={id('service')}>
          <select id={id('service')} value={form.serviceCode} onChange={e => set('serviceCode', e.target.value)} className={inputClass}>
            <option value="">Choose a service</option>
            {categories.map(cat => (
              <optgroup key={cat} label={cat}>
                {services
                  .filter(s => s.category === cat)
                  .map(s => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </FormField>
        <FormField label="Communication channel" htmlFor={id('channel')}>
          <select id={id('channel')} value={form.channel} onChange={e => set('channel', e.target.value)} className={inputClass}>
            {CHANNELS.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {isWhatsAppService(form.serviceCode) && (
        <fieldset className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-4" aria-label="WhatsApp API details">
          <legend className="px-1 text-xs font-bold text-emerald-800 flex items-center gap-1.5">
            <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" /> WhatsApp API details
          </legend>
          <div>
            <div className="text-xs font-bold text-slate-800 mb-2">Campaigns</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="Campaigns sent" htmlFor={id('wa-campaigns')}>
                <input id={id('wa-campaigns')} type="number" min={0} step={1} inputMode="numeric" value={wa.campaignsSent ?? ''} onChange={e => setWa('campaignsSent', e.target.value)} className={inputClass} />
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Campaign details (optional)" htmlFor={id('wa-notes')}>
                  <input id={id('wa-notes')} value={wa.campaignNotes ?? ''} onChange={e => setWa('campaignNotes', e.target.value)} maxLength={1000} className={inputClass} placeholder="e.g. Diwali offer, re-engagement" />
                </FormField>
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-800 mb-2">Message package</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="Messages bought (package)" htmlFor={id('wa-package')}>
                <input id={id('wa-package')} type="number" min={0} step={1} inputMode="numeric" value={wa.packageMessages ?? ''} onChange={e => setWa('packageMessages', e.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Messages sent" htmlFor={id('wa-sent')}>
                <input id={id('wa-sent')} type="number" min={0} step={1} inputMode="numeric" value={wa.messagesSent ?? ''} onChange={e => setWa('messagesSent', e.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Messages remaining" htmlFor={id('wa-remaining')} hint="Package minus sent.">
                <input id={id('wa-remaining')} readOnly value={messagesRemaining(wa).toLocaleString('en-IN')} className={`${inputClass} bg-slate-50 font-semibold`} />
              </FormField>
            </div>
          </div>
          {errors.whatsapp && (
            <p className="text-[11px] text-rose-600" role="alert">
              {errors.whatsapp}
            </p>
          )}
        </fieldset>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          label={assigneeLabel || 'Assigned support team member'}
          htmlFor={id('assignee')}
          hint={assigneeHint || (isLead ? 'Choose who will look after this customer.' : 'Your customers are assigned to you.')}
        >
          <select id={id('assignee')} value={form.assigneeId || ''} onChange={e => set('assigneeId', e.target.value)} disabled={!isLead} className={inputClass}>
            {assigneeOptions.map(p => (
              <option key={p.id} value={p.id}>
                {p.fullName}
                {p.id === profile?.id ? ' (me)' : ''}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField label="Customer query or requirement" htmlFor={id('req')}>
        <textarea id={id('req')} rows={3} value={form.requirement} onChange={e => set('requirement', e.target.value)} maxLength={3000} className={inputClass} />
      </FormField>
      <FormField label="Notes" htmlFor={id('notes')}>
        <textarea id={id('notes')} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} maxLength={5000} className={inputClass} />
      </FormField>
      {serverError && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
          {serverError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
};
