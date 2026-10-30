import React, { useState } from 'react';
import { api, errorMessage } from '../../lib/api/client';
import { accountsCustomerDetailsSchema } from '../../../shared/validation';
import { ErrorBanner, FormField, inputClass, Modal } from '../support-member/SupportParts';

const fields = { company: 'Business / company', name: 'Customer / contact name', phone: 'Mobile number', whatsapp: 'WhatsApp number', email: 'Email address', address: 'Business address (including state)', city: 'City', businessCategory: 'Business category' };
type Details = Record<keyof typeof fields, string> & { hasClientLogin?: boolean };
export const AccountsCustomerDetails: React.FC<{ customerId: string; onSaved: () => void }> = ({ customerId, onSaved }) => {
  const [details, setDetails] = useState<Details | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/pipeline/customers/${customerId}/accounts/customer-details`;
  const open = async () => {
    setBusy(true); setError(null);
    try {
      const data = await api.get<Details>(path);
      setDetails(Object.fromEntries(Object.keys(fields).map(k => [k, data[k as keyof typeof fields] ?? ''])) as unknown as Details);
      setDetails(d => ({ ...d!, hasClientLogin: data.hasClientLogin }));
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!details) return;
    const { hasClientLogin, ...body } = details;
    const parsed = accountsCustomerDetailsSchema.safeParse(body);
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join(' ')); return; }
    setBusy(true); setError(null);
    try { await api.patch(path, parsed.data); onSaved(); setDetails(null); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <>
    <button type="button" disabled={busy} onClick={() => void open()} className="px-3 py-2 border rounded-xl text-xs font-bold">Edit Details</button>
    {error && !details && <ErrorBanner message={error} />}
    {details && <Modal title="Edit customer details" onClose={() => !busy && setDetails(null)}>
      <form onSubmit={save} className="space-y-3">
        {Object.entries(fields).map(([key, label]) => <FormField key={key} htmlFor={`customer-${key}`} label={label} required={['name','company','phone'].includes(key)}>
          <input id={`customer-${key}`} aria-label={label} className={inputClass} value={details[key as keyof typeof fields]} disabled={busy || (key === 'email' && details.hasClientLogin)}
            type={key === 'email' ? 'email' : 'text'} maxLength={key === 'address' ? 500 : ['city','businessCategory'].includes(key) ? 120 : 200}
            onChange={e => setDetails({ ...details, [key]: e.target.value })} />
        </FormField>)}
        {details.hasClientLogin && <p className="text-xs text-slate-600">This email is linked to a Client Dashboard login. Use the secure authentication email-update process to change it.</p>}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setDetails(null)}>Cancel</button><button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save details'}</button></div>
      </form>
    </Modal>}
  </>;
};
