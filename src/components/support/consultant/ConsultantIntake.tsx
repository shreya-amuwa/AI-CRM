import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Pencil, Plus, Search, Send, X } from 'lucide-react';
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

const PAGE_SIZE = 10;
const OTHER = '__OTHER__';

type Addon = { code?: string; name: string };

/**
 * Technical Consultant: "Customers" panel. Customers Accounts confirmed arrive
 * here as a table: business, services, Contract yes/no, add-ons, Edit and
 * "Send for onboarding". Sending moves the customer to Onboarding Customers.
 * Every change is saved straight to the database and re-checked there.
 */
export const ConsultantIntake: React.FC<{ onSent: () => void; onGoToOnboarding: () => void }> = ({ onSent, onGoToOnboarding }) => {
  const { items: catalog, byCode } = useServiceCatalog();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<PipelineCustomer | null>(null);
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

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Customers confirmed by Accounts. Note the contract and any add-ons, then send each one for onboarding.
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
          <span>{notice}</span>
          <button type="button" onClick={onGoToOnboarding} className="inline-flex items-center gap-1 font-bold text-emerald-900 hover:underline">
            Open Onboarding Customers <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
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
            <table className="w-full text-sm min-w-[56rem]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                  <th scope="col" className="px-5 py-3 font-semibold">Name &amp; business</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Services</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Contract</th>
                  <th scope="col" className="px-3 py-3 font-semibold w-72">Add-ons</th>
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
                    onEdit={() => setEditing(c)}
                    onSent={name => {
                      setNotice(`${name} was sent for onboarding.`);
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

      {editing && (
        <EditDialog
          customer={editing}
          onClose={() => setEditing(null)}
          onSaved={c => {
            patchRow(c);
            setEditing(null);
          }}
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
  onEdit: () => void;
  onSent: (name: string) => void;
}> = ({ customer: c, catalog, serviceName, onChanged, onEdit, onSent }) => {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const addons: Addon[] = c.onboarding?.addons || [];
  const label = c.company || c.name;

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

  const saveAddons = async (next: Addon[]) => {
    const fresh = await run(() => pipelineApi.consultantSetAddons(c.id, next.map(a => (a.code ? { code: a.code } : { name: a.name }))));
    if (fresh) onChanged(fresh);
  };
  const setContract = async (signed: boolean) => {
    const fresh = await run(() => pipelineApi.consultantSetContract(c.id, signed));
    if (fresh) onChanged(fresh);
  };

  const pick = (value: string) => {
    if (!value) return;
    if (value === OTHER) {
      setTyping(true);
      return;
    }
    void saveAddons([...addons, { code: value, name: serviceName(value) }]);
  };
  const addTyped = async () => {
    const name = typed.trim();
    if (name.length < 2) return setRowError('Type the add-on name (at least 2 characters).');
    await saveAddons([...addons, { name }]);
    setTyped('');
    setTyping(false);
  };

  const taken = new Set(addons.filter(a => a.code).map(a => a.code));
  const categories = [...new Set(catalog.map(s => s.category))];

  return (
    <tr className="border-b border-slate-50 last:border-0 align-top">
      <td className="px-5 py-4">
        <div className="font-bold text-slate-900">{c.name}</div>
        <div className="text-xs text-slate-500">{c.company || 'No business name'}</div>
        {(c.phone || c.email) && <div className="text-[11px] text-slate-400 mt-0.5">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>}
      </td>
      <td className="px-3 py-4">
        {c.services.length === 0 ? (
          <span className="text-xs text-slate-400">—</span>
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
          aria-label={`Contract for ${label}`}
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
        {addons.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 mb-2" aria-label={`Add-ons of ${label}`}>
            {addons.map((a, i) => (
              <li key={`${a.code || a.name}-${i}`} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[11px] font-semibold">
                {a.name}
                {!a.code && <span className="text-indigo-400 font-normal">(manual)</span>}
                <button
                  type="button"
                  onClick={() => void saveAddons(addons.filter((_, j) => j !== i))}
                  disabled={busy}
                  className="p-0.5 rounded hover:bg-indigo-100"
                  aria-label={`Remove add-on ${a.name} from ${label}`}
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {typing ? (
          <div className="flex items-center gap-1.5">
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void addTyped()}
              maxLength={120}
              placeholder="Type the add-on"
              aria-label={`Add-on name for ${label}`}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs"
              autoFocus
            />
            <button type="button" onClick={() => void addTyped()} disabled={busy} className={btn.green} aria-label={`Add typed add-on to ${label}`}>
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add
            </button>
            <button
              type="button"
              onClick={() => {
                setTyping(false);
                setTyped('');
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              aria-label="Cancel typing an add-on"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <select
            aria-label={`Add an add-on to ${label}`}
            value=""
            onChange={e => pick(e.target.value)}
            disabled={busy}
            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-600"
          >
            <option value="">Add a service…</option>
            {categories.map(cat => {
              const opts = catalog.filter(s => s.category === cat && !taken.has(s.code));
              return opts.length ? (
                <optgroup key={cat} label={cat}>
                  {opts.map(s => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
            <option value={OTHER}>Other — type manually…</option>
          </select>
        )}
        {rowError && (
          <p className="text-[11px] text-rose-700 mt-1.5" role="alert">
            {rowError}
          </p>
        )}
      </td>
      <td className="px-5 py-4 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-2">
          <button type="button" onClick={onEdit} className={btn.secondary} aria-label={`Edit ${label}`}>
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const done = await run(() => pipelineApi.consultantStartOnboarding(c.id));
              if (done) onSent(label);
            }}
            className={btn.primary}
            aria-label={`Send ${label} for onboarding`}
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" /> Send for onboarding
          </button>
        </div>
      </td>
    </tr>
  );
};

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------
const EditDialog: React.FC<{ customer: PipelineCustomer; onClose: () => void; onSaved: (c: PipelineCustomer) => void }> = ({ customer, onClose, onSaved }) => {
  const [name, setName] = useState(customer.name);
  const [company, setCompany] = useState(customer.company || '');
  const [phone, setPhone] = useState(customer.phone || '');
  const [email, setEmail] = useState(customer.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await pipelineApi.consultantUpdateCustomer(customer.id, { name, company: company || null, phone: phone || null, email: email || null }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Edit ${customer.company || customer.name}`} description="Correct the contact details before onboarding starts." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" aria-label="Edit customer">
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
        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btn.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btn.primary}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
