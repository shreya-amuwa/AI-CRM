import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { Person } from '../../lib/workTasks';
import {
  CHANNELS,
  CUSTOMER_STATUS_LABELS,
  customerApi,
  SEGMENT_LABELS,
  type CustomerSegmentValue,
  type CustomerStatusValue
} from '../../lib/support';
import { FormField, inputClass, PageHeader } from './SupportParts';

interface AddCustomerPageProps {
  people: Person[];
  /** After a customer is saved: open it. */
  onCreated: (customerId: string) => void;
  onCancel: () => void;
}

interface Errors {
  name?: string;
  contact?: string;
  email?: string;
  phone?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Validated form; saved straight to the CRM database (duplicates are refused there). */
export const AddCustomerPage: React.FC<AddCustomerPageProps> = ({ people, onCreated, onCancel }) => {
  const { profile } = useAuth();
  const isLead = profile?.role === 'TEAM_HEAD';
  const team = people.filter(p => (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.status === 'ACTIVE' && p.teamId === profile?.teamId);

  const [form, setForm] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    segment: 'RETAIL' as CustomerSegmentValue,
    status: 'ACTIVE' as CustomerStatusValue,
    service: '',
    requirement: '',
    channel: 'Phone',
    notes: '',
    assigneeId: profile?.id || ''
  });
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));

  const validate = (): Errors => {
    const e: Errors = {};
    if (form.name.trim().length < 2) e.name = 'Enter the customer’s full name.';
    if (!form.phone.trim() && !form.email.trim()) e.contact = 'Enter a phone number or an e-mail address.';
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid e-mail address.';
    if (form.phone.trim() && (!/^[0-9+()\-\s.]{5,25}$/.test(form.phone.trim()) || form.phone.replace(/\D/g, '').length < 7))
      e.phone = 'Enter a valid phone number (at least 7 digits).';
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const id = await customerApi.create({ ...form, assigneeId: isLead ? form.assigneeId : undefined });
      setSaved({ id, name: form.name.trim() });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save the customer.');
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="max-w-xl bg-white rounded-2xl border border-emerald-200 p-8 text-center space-y-3">
        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" aria-hidden="true" />
        <h1 className="text-lg font-bold text-slate-900" role="status">
          {saved.name} was added
        </h1>
        <p className="text-sm text-slate-500">The customer is saved in the CRM and visible to your team lead and department head.</p>
        <div className="flex justify-center gap-2 pt-2">
          <button type="button" onClick={() => onCreated(saved.id)} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold">
            Open customer
          </button>
          <button
            type="button"
            onClick={() => {
              setSaved(null);
              setForm(f => ({ ...f, name: '', company: '', phone: '', email: '', service: '', requirement: '', notes: '' }));
            }}
            className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600"
          >
            Add another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="Add Customer" subtitle="Register a new customer. Phone and e-mail are checked against existing customers so nobody is added twice." />
      <form onSubmit={submit} noValidate className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 space-y-5" aria-label="Add customer">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Customer full name" htmlFor="ac-name" required error={errors.name}>
            <input id="ac-name" value={form.name} onChange={e => set('name', e.target.value)} maxLength={200} className={inputClass} autoComplete="off" />
          </FormField>
          <FormField label="Company or organization" htmlFor="ac-company">
            <input id="ac-company" value={form.company} onChange={e => set('company', e.target.value)} maxLength={200} className={inputClass} />
          </FormField>
          <FormField label="Phone number" htmlFor="ac-phone" error={errors.phone || errors.contact} hint="Phone or e-mail is required.">
            <input id="ac-phone" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={inputClass} placeholder="+91 98765 43210" />
          </FormField>
          <FormField label="Email address" htmlFor="ac-email" error={errors.email}>
            <input id="ac-email" type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputClass} placeholder="name@company.com" />
          </FormField>
          <FormField label="Customer type" htmlFor="ac-type">
            <select id="ac-type" value={form.segment} onChange={e => set('segment', e.target.value as CustomerSegmentValue)} className={inputClass}>
              {(Object.keys(SEGMENT_LABELS) as CustomerSegmentValue[]).map(s => (
                <option key={s} value={s}>
                  {SEGMENT_LABELS[s]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Customer status" htmlFor="ac-status">
            <select id="ac-status" value={form.status} onChange={e => set('status', e.target.value as CustomerStatusValue)} className={inputClass}>
              {(Object.keys(CUSTOMER_STATUS_LABELS) as CustomerStatusValue[]).map(s => (
                <option key={s} value={s}>
                  {CUSTOMER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Service or product" htmlFor="ac-service">
            <input id="ac-service" value={form.service} onChange={e => set('service', e.target.value)} maxLength={200} className={inputClass} placeholder="e.g. WhatsApp Business API" />
          </FormField>
          <FormField label="Communication channel" htmlFor="ac-channel">
            <select id="ac-channel" value={form.channel} onChange={e => set('channel', e.target.value)} className={inputClass}>
              {CHANNELS.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Assigned support team member" htmlFor="ac-assignee" hint={isLead ? 'Choose who will look after this customer.' : 'New customers are assigned to you.'}>
            <select id="ac-assignee" value={form.assigneeId} onChange={e => set('assigneeId', e.target.value)} disabled={!isLead} className={inputClass}>
              {(isLead ? team : [{ id: profile?.id || '', fullName: profile?.fullName || 'Me' }]).map(p => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                  {p.id === profile?.id ? ' (me)' : ''}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField label="Customer query or requirement" htmlFor="ac-req">
          <textarea id="ac-req" rows={3} value={form.requirement} onChange={e => set('requirement', e.target.value)} maxLength={3000} className={inputClass} />
        </FormField>
        <FormField label="Notes" htmlFor="ac-notes">
          <textarea id="ac-notes" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} maxLength={5000} className={inputClass} />
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
            {saving ? 'Saving…' : 'Save customer'}
          </button>
        </div>
      </form>
    </div>
  );
};
