import { rowOpen } from '../../../lib/rowClick';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PackagePlus, Pencil, Search, Send } from 'lucide-react';
import type { Paginated, PipelineCustomer } from '../../../../shared/contracts';
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
import { ADDON_STATUS_LABEL, AddonStatusPill } from '../../invoices/invoiceShared';
import { AddonRequestDialog, AddonRequestEditor } from './AddonRequestPanel';
import { ConsultationNotes } from './ConsultationNotes';
import { toast } from '../../feedback/AppFeedback';
import { userMessage } from '../../../lib/feedback/errors';

const PAGE_SIZE = 10;

/**
 * Technical Consultant: "Customers" panel. Customers Accounts confirmed arrive here as a table:
 * business, services, Contacted yes/no, the add-ons question and the send button. A customer opens
 * read-only; details change only after an explicit Edit. When the customer wants additional services the
 * consultant prices them and submits them for Accounts Verification (they continue in Add-ons Services);
 * "Send for onboarding" moves the customer's original services on and is never blocked by the add-ons.
 * Every change is saved straight to the database and re-checked there.
 */
export const ConsultantIntake: React.FC<{ onSent: () => void; onGoToOnboarding: () => void; onGoToAddons: () => void; mode?: 'consultant' | 'verifier' }> = ({ onSent, onGoToOnboarding, onGoToAddons, mode = 'consultant' }) => {
  const verifier = mode === 'verifier';
  const { byCode } = useServiceCatalog();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // the success toast keeps the shortcut the old banner had: open the page the customer moved to
  const go = (to: 'onboarding' | 'addons') => ({ label: to === 'addons' ? 'Open Add-ons Services' : 'Open Onboarding Customers', onClick: to === 'addons' ? onGoToAddons : onGoToOnboarding });
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
        e => n === seq.current && setError(userMessage(e))
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
            {verifier
              ? 'WhatsApp customers confirmed by Accounts. Start the verification of each one: review the documents, record your notes and hand over to the Department Head.'
              : 'Customers confirmed by Accounts. Note whether you contacted them and whether they need add-ons, then send each one on.'}
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
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm min-w-[60rem]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                  <th scope="col" className="px-5 py-3 font-semibold">Name &amp; business</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Services</th>
                  {!verifier && <th scope="col" className="px-3 py-3 font-semibold">Contacted</th>}
                  {!verifier && <th scope="col" className="px-3 py-3 font-semibold w-80">Add-ons</th>}
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
                    verifier={verifier}
                    serviceName={code => byCode.get(code)?.name || code}
                    onChanged={patchRow}
                    onOpen={edit => setOpen({ id: c.id, edit })}
                    onAddonsSubmitted={name => {
                      toast.success(`The add-ons for ${name} were submitted for Accounts Verification. Follow them in Add-ons Services.`, { action: go('addons'), durationMs: 8000 });
                      notifyPipelineChanged();
                      onSent();
                      load();
                    }}
                    onSent={(name, to) => {
                      toast.success(verifier ? `${name}: verification started.` : `${name} was sent for onboarding successfully.`, { action: go(to), durationMs: 8000 });
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
          startEditing={open.edit && !verifier}
          canEdit={!verifier}
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
  serviceName: (code: string) => string;
  onChanged: (c: PipelineCustomer) => void;
  onOpen: (edit: boolean) => void;
  onAddonsSubmitted: (name: string) => void;
  onSent: (name: string, to: 'onboarding' | 'addons') => void;
  /** The Meta Verifier does not take part in add-ons or the "contacted" step (the Technical Consultant's later work). */
  verifier?: boolean;
}> = ({ customer: c, serviceName, onChanged, onOpen, onAddonsSubmitted, onSent, verifier = false }) => {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmNo, setConfirmNo] = useState(false);
  const [editAddons, setEditAddons] = useState(false);
  const addonStatus = c.onboarding?.addonRequestStatus ?? null;
  // The radio moves at once; if the database refuses, it goes back (the saved answer is the truth).
  const [shown, setShown] = useState<boolean | null | undefined>(undefined);
  const required = shown !== undefined ? shown : (c.onboarding?.addonsRequired ?? null);
  const label = c.company || c.name;
  const hasDraft = addonStatus === 'DRAFT' || addonStatus === 'CHANGES_REQUESTED';

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setRowError(null);
    try {
      return await fn();
    } catch (e) {
      setRowError(userMessage(e));
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
    // Answering No keeps a saved draft (it is only ignored); say so before changing it.
    if (!value && hasDraft) return setConfirmNo(true);
    void setRequired(value);
  };
  const send = async () => {
    const done = await run(() => pipelineApi.consultantStartOnboarding(c.id));
    if (done) onSent(label, 'onboarding');
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
      {!verifier && (
        <>
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
          <legend className="text-[11px] font-semibold text-slate-600 mb-1.5">Is the customer interested in add-on services?</legend>
          <div className="flex items-center gap-5 mb-2">
            {([true, false] as const).map(v => (
              <label key={String(v)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name={`addons-required-${c.id}`}
                  checked={required === v}
                  onChange={() => answer(v)}
                  className="w-3.5 h-3.5 accent-indigo-600"
                  aria-label={`${v ? 'Yes' : 'No'}: add-on services for ${label}`}
                />
                {v ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
          {required === true && (
            <div className="flex flex-wrap items-center gap-2">
              {addonStatus && <AddonStatusPill status={addonStatus} />}
              <button type="button" className={btn.secondary} onClick={() => setEditAddons(true)} aria-label={`Add-on services and prices for ${label}`}>
                <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                {!addonStatus || addonStatus === 'REJECTED' ? 'Select add-ons and prices' : hasDraft ? (addonStatus === 'DRAFT' ? 'Continue draft' : 'Correct and resubmit') : 'View add-ons'}
              </button>
            </div>
          )}
          {required === false && hasDraft && <p className="text-[11px] text-slate-500">A saved add-on draft is kept but not used while No is selected.</p>}
        </fieldset>
        {rowError && (
          <p className="text-[11px] text-rose-700 mt-1.5" role="alert">
            {rowError}
          </p>
        )}
      </td>
        </>
      )}
      <td className="px-5 py-4 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-2">
          {!verifier && (
            <button type="button" onClick={() => onOpen(true)} className={btn.secondary} aria-label={`Edit ${label}`}>
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void send()} className={btn.primary} aria-label={`${verifier ? 'Start verification of' : 'Send'} ${label}${verifier ? '' : ' for onboarding'}`}>
            <Send className="w-3.5 h-3.5" aria-hidden="true" /> {verifier ? 'Start verification' : 'Send for onboarding'}
          </button>
        </div>
      </td>
      {(confirmNo || editAddons) && (
        <td className="p-0" data-no-row-click>
          {confirmNo && (
            <Dialog
              title="Switch to No?"
              description={`${label} has an add-on draft. It stays saved, but is not sent to Accounts while the answer is No. You can switch back to Yes any time.`}
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
          )}
          {editAddons && (
            <AddonRequestDialog
              customerId={c.id}
              label={label}
              originalServices={c.services}
              onClose={() => setEditAddons(false)}
              onChanged={r => {
                if (r.status === 'PENDING_VERIFICATION') onAddonsSubmitted(label);
                else onChanged({ ...c, onboarding: c.onboarding ? { ...c.onboarding, addonRequestStatus: r.status, addonsRequired: true } : c.onboarding });
              }}
            />
          )}
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
  canEdit?: boolean;
}> = ({ customer, startEditing, serviceName, onChanged, onClose, canEdit = true }) => {
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
  const required = customer.onboarding?.addonsRequired ?? null;
  const addonStatus = customer.onboarding?.addonRequestStatus ?? null;

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
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={label} description="Customer details" onClose={onClose} wide>
      <section aria-label="Customer details" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Details</h3>
          {!editing && canEdit && (
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
              v={required === null ? 'Not answered yet' : required ? `Yes${addonStatus ? ` - ${ADDON_STATUS_LABEL[addonStatus]}` : ''}` : 'No'}
            />
          </dl>
        )}
      </section>
      {required && <AddonRequestEditor customerId={customer.id} originalServices={customer.services} />}
      <ConsultationNotes customerId={customer.id} canWrite services={customer.services} />
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className={btn.secondary}>
          Close
        </button>
      </div>
    </Dialog>
  );
};
