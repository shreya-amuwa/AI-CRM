import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mail, Plus, Search, Trash2 } from 'lucide-react';
import { INVOICE_PURPOSES, type InvoiceCustomer, type InvoicePrefill, type InvoicePurpose, type InvoiceRunResult } from '../../../shared/contracts';
import { defaultTaxTreatment, GST_STATES, inferStateFromAddress, isValidGstinFormat, normalizeGstin, reviewCustomerTax, stateName, type TaxTreatment } from '../../../shared/gst';
import { calculateInvoice, inr, rateText, rs, toPaise, toRateBp } from '../../../shared/invoiceCalc';
import { errorMessage } from '../../lib/api/client';
import { generatedInvoicesApi, invoicesApi } from '../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, Field, inputCls, notifyPipelineChanged, selectCls, Spinner, todayIso, useDebounced } from '../team-member/pipeline/shared';
import { StepList } from './GeneratedInvoicePanel';

const PURPOSE_LABEL: Record<InvoicePurpose, string> = {
  SERVICES: 'Services the customer bought',
  ADDON: 'An approved add-on request',
  ADDITIONAL: 'An additional invoice'
};
const SOURCE_LABEL: Record<string, string> = { ONBOARDING: 'from onboarding', CUSTOMER: 'from the customer record', ADDRESS: 'from the address', GSTIN: 'from the GSTIN', PREVIOUS_INVOICE: 'from the last invoice', NONE: '' };

interface LineForm {
  key: number;
  serviceCode: string;
  particulars: string;
  hsnSac: string;
  taxRate: string;
  quantity: string;
  baseAmount: string;
}
let lineKey = 0;
const blankLine = (): LineForm => ({ key: ++lineKey, serviceCode: '', particulars: '', hsnSac: '998313', taxRate: '18', quantity: '1 Nos', baseAmount: '' });

interface FormState {
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  name: string;
  businessName: string;
  address: string;
  contactPerson: string;
  contactNumber: string;
  gstin: string;
  stateCode: string;
  treatment: TaxTreatment | '';
  overrideReason: string;
  acknowledge: boolean;
  terms: string;
  lines: LineForm[];
}

function fromPrefill(p: InvoicePrefill): FormState {
  return {
    invoiceNumber: '',
    invoiceDate: p.invoiceDate || todayIso(),
    orderNumber: p.orderNumber || 'Verbal',
    name: p.customer.name || '',
    businessName: p.customer.businessName || '',
    address: p.customer.address || '',
    contactPerson: p.customer.contactPerson || '',
    contactNumber: p.customer.contactNumber || '',
    gstin: p.customer.gstin || '',
    stateCode: p.customer.stateCode || '',
    treatment: p.taxTreatment || '',
    overrideReason: '',
    acknowledge: false,
    terms: p.terms || '100% Payment Against supply.',
    lines: p.lines.length
      ? p.lines.map(l => ({ key: ++lineKey, serviceCode: l.serviceCode || '', particulars: l.particulars, hsnSac: l.hsnSac, taxRate: String(l.taxRate), quantity: l.quantity, baseAmount: l.baseAmount === null ? '' : String(l.baseAmount) }))
      : [blankLine()]
  };
}

/**
 * Accounts: builds one invoice. Customer and purchase details come pre-filled (every value stays editable),
 * the totals shown here are only a preview: the database recomputes them and Accounts never types a total or a GST amount.
 * "Generate & Send Invoice" saves the invoice, creates its PDF, stores it privately and e-mails it to the customer;
 * the result lists each step so a failed PDF or e-mail can be retried from the invoice.
 */
export const InvoiceBuilder: React.FC<{
  customer?: { id: string; label: string } | null;
  addon?: { requestId: string; customerId: string; label: string } | null;
  onClose: () => void;
  onDone: (r: InvoiceRunResult) => void;
}> = ({ customer: presetCustomer, addon, onClose, onDone }) => {
  const preset = addon ? { id: addon.customerId, label: addon.label } : presetCustomer ?? null;
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(preset);
  const [purpose, setPurpose] = useState<InvoicePurpose>(addon ? 'ADDON' : 'SERVICES');
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<InvoiceCustomer[] | null>(null);
  const [prefill, setPrefill] = useState<InvoicePrefill | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InvoiceRunResult | null>(null);
  // One id per builder session: pressing the button twice, or retrying after a timeout, never creates a second invoice.
  const requestId = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const debounced = useDebounced(search.trim());

  useEffect(() => {
    if (picked) return;
    let live = true;
    invoicesApi.customers(debounced || undefined).then(
      c => live && setCustomers(c),
      e => live && setError(errorMessage(e))
    );
    return () => {
      live = false;
    };
  }, [debounced, picked]);

  useEffect(() => {
    if (!picked) return;
    let live = true;
    setLoading(true);
    setError(null);
    generatedInvoicesApi.prefill(picked.id, { purpose, addonRequestId: addon?.requestId ?? null }).then(
      p => {
        if (!live) return;
        setPrefill(p);
        setForm(fromPrefill(p));
        setLoading(false);
      },
      e => {
        if (!live) return;
        setError(errorMessage(e));
        setLoading(false);
      }
    );
    return () => {
      live = false;
    };
  }, [picked, purpose, addon?.requestId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => (f ? { ...f, [k]: v } : f));
  const setLine = (key: number, patch: Partial<LineForm>) => setForm(f => (f ? { ...f, lines: f.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) } : f));

  const defaultTreatment = defaultTaxTreatment(form?.stateCode);
  const treatment: TaxTreatment | null = (form?.treatment || defaultTreatment) as TaxTreatment | null;
  const overridden = !!treatment && !!defaultTreatment && treatment !== defaultTreatment;
  const review = useMemo(() => (form ? reviewCustomerTax({ stateCode: form.stateCode, gstin: form.gstin, address: form.address }) : null), [form]);
  const calc = useMemo(() => (form && treatment ? calculateInvoice(form.lines, treatment) : null), [form, treatment]);

  const onAddressBlur = () => {
    if (!form || form.stateCode) return;
    const s = inferStateFromAddress(form.address);
    if (s) setForm(f => (f && !f.stateCode ? { ...f, stateCode: s.code } : f));
  };

  const problems: string[] = [];
  if (form) {
    if (!form.name.trim() && !form.businessName.trim()) problems.push('Enter the customer or business name.');
    if (!form.address.trim()) problems.push('Enter the business address.');
    if (!form.stateCode) problems.push('Choose the customer state.');
    if (form.gstin.trim() && !isValidGstinFormat(form.gstin)) problems.push('The GSTIN is not valid.');
    if (overridden && form.overrideReason.trim().length < 5) problems.push('Say why the tax treatment differs from the customer state.');
    if (review?.stateMismatch && !form.acknowledge) problems.push('The GSTIN belongs to another state. Verify it, or confirm it below.');
    form.lines.forEach((l, i) => {
      if (l.particulars.trim().length < 2) problems.push(`Line ${i + 1}: enter the particulars.`);
      if (!l.quantity.trim()) problems.push(`Line ${i + 1}: enter the quantity.`);
      if (!/^[0-9]{4,8}$/.test(l.hsnSac.trim())) problems.push(`Line ${i + 1}: the HSN/SAC code is 4 to 8 digits.`);
    });
    if (calc && !calc.ok) calc.problems.forEach(p => problems.push(p.message));
    // The payments of the agreed services are recorded against the agreed amount: an invoice for more could never be paid in full
    // (the database refuses it too).
    const dealPaise = prefill?.dealAmount ? toPaise(prefill.dealAmount) : null;
    if (calc && calc.ok && purpose === 'SERVICES' && dealPaise !== null && dealPaise > 0 && calc.totalPaise > dealPaise) {
      problems.push(`The invoice total (${rs(calc.totalPaise)}) is more than the amount agreed with Sales (${rs(dealPaise)}). Correct the invoice, or ask Sales to correct the agreed amount first.`);
    }
    if (treatment === null && form.stateCode === '') problems.push('Choose the tax treatment.');
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || !form || !picked || !treatment) return;
    setError(null);
    if (problems.length) return setError(problems[0]);
    submitting.current = true;
    setBusy(true);
    try {
      const r = await generatedInvoicesApi.issue({
        requestId: requestId.current,
        customerId: picked.id,
        purpose,
        addonRequestId: purpose === 'ADDON' ? addon?.requestId ?? prefill?.addonRequestId ?? null : null,
        invoiceNumber: form.invoiceNumber.trim() || null,
        invoiceDate: form.invoiceDate,
        orderNumber: form.orderNumber.trim() || 'Verbal',
        customer: {
          name: form.name.trim(),
          businessName: form.businessName.trim() || null,
          address: form.address.trim(),
          contactPerson: form.contactPerson.trim() || null,
          contactNumber: form.contactNumber.trim() || null,
          gstin: normalizeGstin(form.gstin) || null,
          stateCode: form.stateCode
        },
        taxTreatment: treatment,
        taxOverrideReason: overridden ? form.overrideReason.trim() : null,
        acknowledgeStateMismatch: form.acknowledge,
        terms: form.terms.trim(),
        lines: form.lines.map(l => ({
          serviceCode: l.serviceCode || null,
          particulars: l.particulars.trim(),
          hsnSac: l.hsnSac.trim(),
          taxRate: l.taxRate.trim(),
          quantity: l.quantity.trim(),
          baseAmount: l.baseAmount.trim()
        }))
      });
      setResult(r);
      notifyPipelineChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------ result
  if (result) {
    return (
      <Dialog title={`Invoice ${result.invoice.number}`} description="The invoice is saved. This is what happened to its PDF and e-mail." onClose={() => onDone(result)} wide>
        <StepList steps={result.steps} />
        <p className="text-xs text-slate-600">If a step did not finish, open the invoice and use Retry. Nothing is created twice.</p>
        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button type="button" className={btn.primary} onClick={() => onDone(result)}>
            Open the invoice
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Generate invoice" description="Customer and purchase details are filled in for you. Check them, add the amounts, and send." onClose={onClose} wide persistent>
      {!picked ? (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Search customer</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the customer, business or customer ID" className={`${inputCls} pl-9`} />
          </label>
          {error && <ErrorBanner message={error} />}
          {!customers ? (
            <Spinner label="Loading customers…" />
          ) : customers.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">No customer found. An invoice is always made for an existing customer.</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-72 overflow-y-auto" aria-label="Customers">
              {customers.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => setPicked({ id: c.id, label: c.company || c.name })} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-xs hover:bg-slate-50">
                    <span className="font-semibold text-slate-800">{c.company || c.name}</span>
                    <span className="text-slate-500">{[c.customerCode, c.department].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" className={btn.secondary} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : loading || !form || !prefill ? (
        <div className="space-y-3">
          {error ? <ErrorBanner message={error} /> : <Spinner label="Loading the customer and purchase details…" />}
          <div className="flex justify-end gap-2">
            {!preset && (
              <button type="button" className={btn.secondary} onClick={() => { setPicked(null); setError(null); }}>
                Change customer
              </button>
            )}
            <button type="button" className={btn.secondary} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5" aria-label="Generate invoice" noValidate>
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs">
            <div>
              <div className="font-bold text-slate-900">{picked.label}</div>
              <div className="text-slate-500">{[prefill.customerCode, prefill.recipientEmail ? `E-mail to ${prefill.recipientEmail}` : 'No e-mail address on file'].filter(Boolean).join(' · ')}</div>
            </div>
            {!preset && (
              <button type="button" className={btn.secondary} disabled={busy} onClick={() => setPicked(null)}>
                Change customer
              </button>
            )}
          </div>
          {prefill.warnings.length > 0 && (
            <ul className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-1" aria-label="Please note">
              {prefill.warnings.map(w => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          {!addon && (
            <Field label="This invoice is for" htmlFor="inv-purpose">
              <select id="inv-purpose" className={selectCls} value={purpose} disabled={busy} onChange={e => setPurpose(e.target.value as InvoicePurpose)}>
                {INVOICE_PURPOSES.map(p => (
                  <option key={p} value={p} disabled={p === 'ADDON'}>
                    {PURPOSE_LABEL[p]}
                    {p === 'ADDON' ? ' (start it from Business Verification)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <fieldset className="grid sm:grid-cols-3 gap-3">
            <legend className="text-xs font-bold text-slate-800 mb-2">Invoice</legend>
            <Field label="Invoice number" htmlFor="inv-number">
              <input id="inv-number" className={inputCls} value={form.invoiceNumber} maxLength={16} placeholder={prefill.suggestedInvoiceNumber ? `Automatic (next: ${prefill.suggestedInvoiceNumber})` : 'Automatic'} onChange={e => set('invoiceNumber', e.target.value)} />
            </Field>
            <Field label="Invoice date" htmlFor="inv-date" required>
              <input id="inv-date" type="date" className={inputCls} value={form.invoiceDate} onChange={e => set('invoiceDate', e.target.value)} />
            </Field>
            <Field label="Order number" htmlFor="inv-order">
              <input id="inv-order" className={inputCls} value={form.orderNumber} maxLength={60} onChange={e => set('orderNumber', e.target.value)} />
            </Field>
          </fieldset>

          <fieldset className="grid sm:grid-cols-2 gap-3">
            <legend className="text-xs font-bold text-slate-800 mb-2">Billed to</legend>
            <Field label="Business name" htmlFor="inv-business">
              <input id="inv-business" className={inputCls} value={form.businessName} maxLength={200} onChange={e => set('businessName', e.target.value)} />
              {SOURCE_LABEL[prefill.sources.businessName] && form.businessName && <span className="text-[11px] text-slate-500">{SOURCE_LABEL[prefill.sources.businessName]}</span>}
            </Field>
            <Field label="Customer name" htmlFor="inv-name">
              <input id="inv-name" className={inputCls} value={form.name} maxLength={200} onChange={e => set('name', e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Business address" htmlFor="inv-address" required>
                <textarea id="inv-address" className={inputCls} rows={2} maxLength={500} value={form.address} onChange={e => set('address', e.target.value)} onBlur={onAddressBlur} />
                {SOURCE_LABEL[prefill.sources.address] && form.address && <span className="text-[11px] text-slate-500">{SOURCE_LABEL[prefill.sources.address]}</span>}
              </Field>
            </div>
            <Field label="Contact person" htmlFor="inv-person">
              <input id="inv-person" className={inputCls} value={form.contactPerson} maxLength={200} onChange={e => set('contactPerson', e.target.value)} />
            </Field>
            <Field label="Contact number" htmlFor="inv-phone">
              <input id="inv-phone" className={inputCls} value={form.contactNumber} inputMode="tel" onChange={e => set('contactNumber', e.target.value)} />
            </Field>
            <Field label="GST number (if the customer has one)" htmlFor="inv-gstin">
              <input id="inv-gstin" className={`${inputCls} uppercase`} value={form.gstin} maxLength={20} onChange={e => set('gstin', e.target.value)} />
              {SOURCE_LABEL[prefill.sources.gstin] && form.gstin && <span className="text-[11px] text-slate-500">{SOURCE_LABEL[prefill.sources.gstin]}</span>}
            </Field>
            <Field label="State" htmlFor="inv-state" required>
              <select id="inv-state" className={`${selectCls} w-full`} value={form.stateCode} onChange={e => set('stateCode', e.target.value)}>
                <option value="">Choose the state</option>
                {GST_STATES.map(s => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </Field>
          </fieldset>

          {review && review.warnings.length > 0 && (
            <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-1">
              {review.warnings.map(w => (
                <p key={w}>{w}</p>
              ))}
              {review.stateMismatch && (
                <label className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" checked={form.acknowledge} onChange={e => set('acknowledge', e.target.checked)} /> I have checked the state and the GSTIN
                </label>
              )}
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-slate-800 mb-2">Tax</legend>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Tax treatment" htmlFor="inv-treatment">
                <select id="inv-treatment" className={`${selectCls} w-full`} value={treatment ?? ''} onChange={e => set('treatment', e.target.value as TaxTreatment)}>
                  <option value="" disabled>
                    Choose the state first
                  </option>
                  <option value="INTRA_STATE">CGST + SGST (same state as Amuwa, {stateName('27')})</option>
                  <option value="INTER_STATE">IGST (another state)</option>
                </select>
              </Field>
              {overridden && (
                <Field label="Why does the tax differ from the customer state?" htmlFor="inv-reason" required>
                  <input id="inv-reason" className={inputCls} value={form.overrideReason} maxLength={300} onChange={e => set('overrideReason', e.target.value)} />
                </Field>
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-slate-800 mb-1">Services</legend>
            {prefill.dealAmount !== null && purpose === 'SERVICES' && (
              <p className="text-[11px] text-slate-500">Sales agreed {rs(toPaise(prefill.dealAmount) ?? 0)} for all the services together (the invoice total, with tax, cannot be more than this). Enter each service amount below, before tax.</p>
            )}
            <div className="space-y-3">
              {form.lines.map((l, i) => (
                <div key={l.key} className="grid grid-cols-2 sm:grid-cols-12 gap-2 p-3 rounded-xl border border-slate-200 bg-white">
                  <div className="col-span-2 sm:col-span-12">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1" htmlFor={`ln-p-${l.key}`}>
                      Particulars (line {i + 1})
                    </label>
                    <input id={`ln-p-${l.key}`} className={inputCls} value={l.particulars} maxLength={500} onChange={e => setLine(l.key, { particulars: e.target.value })} />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1" htmlFor={`ln-h-${l.key}`}>HSN/SAC</label>
                    <input id={`ln-h-${l.key}`} className={inputCls} inputMode="numeric" value={l.hsnSac} onChange={e => setLine(l.key, { hsnSac: e.target.value })} />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1" htmlFor={`ln-q-${l.key}`}>Quantity</label>
                    <input id={`ln-q-${l.key}`} className={inputCls} value={l.quantity} maxLength={30} onChange={e => setLine(l.key, { quantity: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1" htmlFor={`ln-t-${l.key}`}>Tax rate %</label>
                    <input id={`ln-t-${l.key}`} className={inputCls} inputMode="decimal" value={l.taxRate} onChange={e => setLine(l.key, { taxRate: e.target.value })} />
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1" htmlFor={`ln-a-${l.key}`}>Invoice amount (Rs., before tax)</label>
                    <div className="flex gap-2">
                      <input id={`ln-a-${l.key}`} className={inputCls} inputMode="decimal" value={l.baseAmount} onChange={e => setLine(l.key, { baseAmount: e.target.value })} />
                      {form.lines.length > 1 && (
                        <button type="button" className={btn.secondary} aria-label={`Remove line ${i + 1}`} onClick={() => setForm(f => (f ? { ...f, lines: f.lines.filter(x => x.key !== l.key) } : f))}>
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {calc && calc.ok && calc.lines[i] && toPaise(l.baseAmount) !== null && toRateBp(l.taxRate) !== null && (
                      <span className="text-[11px] text-slate-500">
                        GST Rs.{inr(calc.lines[i].gstPaise)} · total Rs.{inr(calc.lines[i].totalPaise)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className={btn.secondary} onClick={() => setForm(f => (f ? { ...f, lines: [...f.lines, blankLine()] } : f))}>
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a service line
            </button>
          </fieldset>

          {calc && calc.ok && (
            <dl className="ml-auto w-full sm:w-80 text-xs space-y-1" aria-label="Invoice totals (preview)">
              <div className="flex justify-between text-slate-600"><dt>Total amount before tax</dt><dd>{rs(calc.subtotalPaise)}</dd></div>
              {calc.groups.map(g =>
                treatment === 'INTRA_STATE' ? (
                  <React.Fragment key={g.rateBp}>
                    <div className="flex justify-between text-slate-600"><dt>CGST @ {rateText(g.rateBp / 2)}%</dt><dd>{rs(g.cgstPaise)}</dd></div>
                    <div className="flex justify-between text-slate-600"><dt>SGST @ {rateText(g.rateBp / 2)}%</dt><dd>{rs(g.sgstPaise)}</dd></div>
                  </React.Fragment>
                ) : (
                  <div key={g.rateBp} className="flex justify-between text-slate-600"><dt>IGST @ {rateText(g.rateBp)}%</dt><dd>{rs(g.igstPaise)}</dd></div>
                )
              )}
              <div className="flex justify-between text-slate-600"><dt>Tax amount GST</dt><dd>{rs(calc.totalGstPaise)}</dd></div>
              <div className="flex justify-between pt-1 border-t border-slate-200 text-sm font-bold text-slate-900"><dt>Final amount after tax</dt><dd>{rs(calc.totalPaise)}</dd></div>
              <div className="text-[11px] text-slate-500 text-right">{calc.words}</div>
              <div className="text-[11px] text-slate-400 text-right">A preview. The final amounts are calculated again when the invoice is saved.</div>
            </dl>
          )}

          <Field label="Terms" htmlFor="inv-terms">
            <textarea id="inv-terms" className={inputCls} rows={2} maxLength={2000} value={form.terms} onChange={e => set('terms', e.target.value)} />
          </Field>

          {error && <ErrorBanner message={error} />}
          {!error && problems.length > 0 && (
            <p className="text-[11px] text-slate-500" role="status">
              Before you send: {problems[0]}
              {problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" className={btn.secondary} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={btn.primary} disabled={busy || problems.length > 0}>
              <Mail className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Generating…' : 'Generate & Send Invoice'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
};
