import { rowOpen } from '../../../lib/rowClick';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Pencil, Search, Send } from 'lucide-react';
import type { Paginated, PipelineCustomer } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import {
  btn,
  Dialog,
  ErrorBanner,
  Field,
  inputCls,
  notifyPipelineChanged,
  Pager,
  Spinner,
  useDebounced,
  usePipelineRealtime,
  useServiceCatalog
} from '../../team-member/pipeline/shared';
import { AddonSelector, type Addon } from './AddonSelector';
import { ConsultationNotes } from './ConsultationNotes';

const PAGE_SIZE = 10;

/**
 * Technical Consultant: "Customers" panel. Customers Accounts confirmed arrive here as a table:
 * business, services, Contacted yes/no, the add-ons question and the send button. A customer opens
 * read-only; details change only after an explicit Edit. "Send for onboarding" moves the customer to
 * Onboarding Customers; when add-ons are needed the button is "Send to Add-ons" and moves the customer
 * to Add-ons Services instead. Every change is saved straight to the database and re-checked there.
 */
export const ConsultantIntake: React.FC<{ onSent: () => void; onGoToOnboarding: () => void; onGoToAddons: () => void }> = ({ onSent, onGoToOnboarding, onGoToAddons }) => {
  const { items: catalog, byCode } = useServiceCatalog();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; to: 'onboarding' | 'addons' } | null>(null);
  const [open, setOpen] = useState<{ id: string; edit: boolean } | null>(null);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    setError(null);
    pipelineApi
      .list({ stage: 'ONBOARDING', intake: true, search: debounced || undefined, page, pageSize: PAGE_SIZE, sort: 'oldest' })
      .then(
        r => n === seq.current && setData(r),
        e => n === seq.current && setError(errorMessage(e))
      )
      .finally(() => n === seq.current && setLoading(false));
  }, [debounced, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [debounced]);
  usePipelineRealtime(load);

  /** Replace one row with the server's fresh copy. */
  const patchRow = (c: PipelineCustomer) => setData(d => (d ? { ...d, items: d.items.map(i => (i.id === c.id ? c : i)) } : d));
  const openCustomer = open && data?.items.find(i => i.id === open.id);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Customers confirmed by Accounts. Note whether you contacted them and whether they need add-ons, then send each one on.
          </p>
        </div>
        <label className="relative w-full md:w-72 shrink-0">
          <span className="sr-only">Search customer or business</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customer or business"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
      </div>

      {notice && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2" role="status">
          <span>{notice.text}</span>
          <button type="button" onClick={notice.to === 'addons' ? onGoToAddons : onGoToOnboarding} className="inline-flex items-center gap-1 font-bold text-emerald-900 hover:underline">
            {notice.to === 'addons' ? 'Open Add-ons Services' : 'Open Onboarding Customers'} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !data ? (
        <Spinner label="Loading customers…" />
      ) : data && data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="text-sm font-bold text-slate-800">{debounced ? 'No customer matches your search' : 'No customers waiting'}</div>
          <p className="text-xs text-slate-500 mt-1">
            {debounced ? 'Try a different name or business.' : 'When Accounts confirms a customer it appears here, ready to be sent for onboarding.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[60rem]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                  <th scope="col" className="px-5 py-3 font-semibold">Name &amp; business</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Services</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Contacted</th>
                  <th scope="col" className="px-3 py-3 font-semibold w-80">Add-ons</th>
                  <th scope="col" className="px-5 py-3 font-semibold text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-60' : ''}>
                {data?.items.map(c => (
                  <IntakeRow
                    key={c.id}
                    customer={c}
                    catalog={catalog}
                    serviceName={code => byCode.get(code)?.name || code}
                    onChanged={patchRow}
                    onOpen={edit => setOpen({ id: c.id, edit })}
                    onSent={(name, to) => {
                      setNotice({ text: to === 'addons' ? `${name} was sent to Add-ons Services.` : `${name} was sent for onboarding.`, to });
                      notifyPipelineChanged();
                      onSent();
                      load();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {data && data.total > PAGE_SIZE && (
            <div className="border-t border-slate-100">
              <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="customers" onPage={setPage} />
            </div>
          )}
        </div>
      )}

      {open && openCustomer && (
        <CustomerDetailsDialog
          key={open.id}
          customer={openCustomer}
          startEditing={open.edit}
          serviceName={code => byCode.get(code)?.name || code}
          onChanged={patchRow}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------
const IntakeRow: React.FC<{
  customer: PipelineCustomer;
  catalog: { code: string; name: string; category: string }[];
  serviceName: (code: string) => string;
  onChanged: (c: PipelineCustomer) => void;
  onOpen: (edit: boolean) => void;
  onSent: (name: string, to: 'onboarding' | 'addons') => void;
}> = ({ customer: c, catalog, serviceName, onChanged, onOpen, onSent }) => {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmNo, setConfirmNo] = useState(false);
  const addons: Addon[] = c.onboarding?.addons || [];
  // The radio moves at once; if the database refuses, it goes back (the saved answer is the truth).
  const [shown, setShown] = useState<boolean | null | undefined>(undefined);
  const required = shown !== undefined ? shown : (c.onboarding?.addonsRequired ?? null);
  const label = c.company || c.name;
  const toAddons = required === true;

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setRowError(null);
    try {
      return await fn();
    } catch (e) {
      setRowError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const setContract = async (signed: boolean) => {
    const fresh = await run(() => pipelineApi.consultantSetContract(c.id, signed));
    if (fresh) onChanged(fresh);
  };
  const setRequired = async (value: boolean) => {
    setShown(value);
    const fresh = await run(() => pipelineApi.consultantSetAddonsRequired(c.id, value));
    if (fresh) onChanged(fresh);
    setShown(undefined);
  };
  const answer = (value: boolean) => {
    if (value === required) return;
    // Answering No keeps the saved selection (it is only ignored); say so before changing it.
    if (!value && addons.length > 0) return setConfirmNo(true);
    void setRequired(value);
  };
  const send = async () => {
    const done = await run(() => (toAddons ? pipelineApi.consultantSendToAddons(c.id) : pipelineApi.consultantStartOnboarding(c.id)));
    if (done) onSent(label, toAddons ? 'addons' : 'onboarding');
  };

  return (
    <tr {...rowOpen(() => onOpen(false))} className="border-b border-slate-50 last:border-0 align-top hover:bg-slate-50/50 focus-visible:bg-blue-50/50 focus-visible:outline-none">
      <td className="px-5 py-4">
        <div className="font-bold text-slate-900">{c.name}</div>
        <div className="text-xs text-slate-500">{c.company || 'No business name'}</div>
        {(c.phone || c.email) && <div className="text-[11px] text-slate-400 mt-0.5">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>}
      </td>
      <td className="px-3 py-4">
        {c.services.length === 0 ? (
          <span className="text-xs text-slate-400">-</span>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Services of ${label}`}>
            {c.services.map(code => (
              <li key={code} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold">
                {serviceName(code)}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-4">
        <select
          aria-label={`Contacted: ${label}`}
          value={c.onboarding?.contractSigned ? 'yes' : 'no'}
          onChange={e => void setContract(e.target.value === 'yes')}
          disabled={busy}
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold ${
            c.onboarding?.contractSigned ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'
          }`}
        >
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </td>
      <td className="px-3 py-4">
        <fieldset disabled={busy} className="min-w-0">
          <legend className="text-[11px] font-semibold text-slate-600 mb-1.5">Does the customer require any additional services?</legend>
          <div className="flex items-center gap-5 mb-2">
            {([true, false] as const).map(v => (
              <label key={String(v)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name={`addons-required-${c.id}`}
                  checked={required === v}
                  onChange={() => answer(v)}
                  className="w-3.5 h-3.5 accent-indigo-600"
                  aria-label={`${v ? 'Yes' : 'No'}: additional services for ${label}`}
                />
                {v ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
          {required === true && <AddonSelector customerId={c.id} label={label} addons={addons} catalog={catalog} disabled={busy} onChanged={onChanged} />}
          {required === false && addons.length > 0 && (
            <p className="text-[11px] text-slate-500">
              {addons.length} saved add-on{addons.length === 1 ? ' is' : 's are'} kept but not used while No is selected.
            </p>
          )}
        </fieldset>
        {rowError && (
          <p className="text-[11px] text-rose-700 mt-1.5" role="alert">
            {rowError}
          </p>
        )}
      </td>
      <td className="px-5 py-4 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-2">
          <button type="button" onClick={() => onOpen(true)} className={btn.secondary} aria-label={`Edit ${label}`}>
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
          </button>
          <button
            type="button"
            disabled={busy || (toAddons && addons.length === 0)}
            title={toAddons && addons.length === 0 ? 'Select at least one add-on service first' : undefined}
            onClick={() => void send()}
            className={btn.primary}
            aria-label={toAddons ? `Send ${label} to Add-ons` : `Send ${label} for onboarding`}
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" /> {toAddons ? 'Send to Add-ons' : 'Send for onboarding'}
          </button>
        </div>
      </td>
      {confirmNo && (
        <td className="p-0" data-no-row-click>
          <Dialog
            title="Switch to No?"
            description={`${label} has ${addons.length} add-on${addons.length === 1 ? '' : 's'} selected. They stay saved, but are not used or sent anywhere while the answer is No. You can switch back to Yes any time before sending to Add-ons.`}
            onClose={() => setConfirmNo(false)}
          >
            <div className="flex justify-end gap-2">
              <button type="button" className={btn.secondary} onClick={() => setConfirmNo(false)}>
                Keep Yes
              </button>
              <button
                type="button"
                className={btn.primary}
                onClick={() => {
                  setConfirmNo(false);
                  void setRequired(false);
                }}
              >
                Switch to No
              </button>
            </div>
          </Dialog>
        </td>
      )}
    </tr>
  );
};

// ---------------------------------------------------------------------------
// Customer details: read-only until Edit is clicked
// ---------------------------------------------------------------------------
const Row: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div>
    <dt className="text-[11px] font-medium text-slate-500">{k}</dt>
    <dd className="text-sm text-slate-900 break-words">{v || <span className="text-slate-400">-</span>}</dd>
  </div>
);

const CustomerDetailsDialog: React.FC<{
  customer: PipelineCustomer;
  startEditing: boolean;
  serviceName: (code: string) => string;
  onChanged: (c: PipelineCustomer) => void;
  onClose: () => void;
}> = ({ customer, startEditing, serviceName, onChanged, onClose }) => {
  const [editing, setEditing] = useState(startEditing);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(customer.name);
  const [company, setCompany] = useState(customer.company || '');
  const [phone, setPhone] = useState(customer.phone || '');
  const [email, setEmail] = useState(customer.email || '');
  // The version the form was opened on: a save from a stale form is refused by the database.
  const [loadedAt, setLoadedAt] = useState(customer.updatedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = customer.company || customer.name;
  const addons = customer.onboarding?.addons || [];
  const required = customer.onboarding?.addonsRequired ?? null;

  const resetForm = () => {
    setName(customer.name);
    setCompany(customer.company || '');
    setPhone(customer.phone || '');
    setEmail(customer.email || '');
    setLoadedAt(customer.updatedAt);
    setError(null);
  };
  const beginEdit = () => {
    resetForm();
    setSaved(false);
    setEditing(true);
  };
  const cancel = () => {
    resetForm();
    setEditing(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fresh = await pipelineApi.consultantUpdateCustomer(customer.id, {
        name,
        company: company || null,
        phone: phone || null,
        email: email || null,
        expectedUpdatedAt: loadedAt
      });
      onChanged(fresh);
      setLoadedAt(fresh.updatedAt);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={label} description="Customer details" onClose={onClose} wide>
      <section aria-label="Customer details" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Details</h3>
          {!editing && (
            <button type="button" onClick={beginEdit} className={btn.secondary} aria-label={`Edit ${label}`}>
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
            </button>
          )}
        </div>
        {saved && !editing && (
          <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            Details saved.
          </p>
        )}
        {editing ? (
          <form onSubmit={submit} className="space-y-3" aria-label="Edit customer">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Customer name" htmlFor="ci-name" required>
                <input id="ci-name" value={name} onChange={e => setName(e.target.value)} className={inputCls} maxLength={200} />
              </Field>
              <Field label="Business name" htmlFor="ci-company">
                <input id="ci-company" value={company} onChange={e => setCompany(e.target.value)} className={inputCls} maxLength={200} />
              </Field>
              <Field label="Phone" htmlFor="ci-phone">
                <input id="ci-phone" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} maxLength={25} />
              </Field>
              <Field label="E-mail" htmlFor="ci-email">
                <input id="ci-email" type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} maxLength={254} />
              </Field>
            </div>
            {error && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancel} className={btn.secondary} disabled={busy}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={btn.primary}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 p-4 rounded-xl bg-slate-50/70 border border-slate-100">
            <Row k="Customer name" v={customer.name} />
            <Row k="Business name" v={customer.company} />
            <Row k="Phone" v={customer.phone} />
            <Row k="E-mail" v={customer.email} />
            <Row k="Services" v={customer.services.length ? customer.services.map(serviceName).join(', ') : null} />
            <Row k="Contacted" v={customer.onboarding?.contractSigned ? 'Yes' : 'No'} />
            <Row
              k="Additional services"
              v={required === null ? 'Not answered yet' : required ? `Yes${addons.length ? `: ${addons.map(a => a.name).join(', ')}` : ''}` : 'No'}
            />
          </dl>
        )}
      </section>
      <ConsultationNotes customerId={customer.id} canWrite services={customer.services} />
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className={btn.secondary}>
          Close
        </button>
      </div>
    </Dialog>
  );
};
