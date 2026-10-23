import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Eye, FilePlus2, FileText, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import type { BaContactDetail, BaQuotation, BaQuotationRow, ServicePrice } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi, type BaQuotationBody } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, Field, Spinner } from '../team-member/pipeline/shared';
import { EmptyState, dateText, tcBtn, tcInput, tcSelect } from '../telecaller/ui';
import type { BaNavigate } from './BusinessAssociateDashboard';
import { DocBadge, inr, notifyBaChanged, openFile, useContactOptions } from './ui';

interface Line { serviceCode: string; description: string; quantity: string; unitPrice: string; discountPct: string; gstRate: string }
interface Form {
  lines: Line[];
  gstApplicable: boolean;
  validityDays: string;
  paymentTerms: string;
  timeline: string;
  notes: string;
  introduction: string;
  understanding: string;
  recommendedServices: string;
  scopeSummary: string;
  commercialTerms: string;
  implementationTimeline: string;
  exclusions: string;
  extraNotes: string;
  serviceDescriptions: Record<string, string>;
}
const TEXT_FIELDS: { key: keyof Form; label: string; rows?: number }[] = [
  { key: 'introduction', label: 'Quotation introduction' },
  { key: 'understanding', label: 'Understanding of the client\'s requirements' },
  { key: 'recommendedServices', label: 'Recommended services' },
  { key: 'scopeSummary', label: 'Scope summary' },
  { key: 'commercialTerms', label: 'Commercial terms (restating the terms entered above)' },
  { key: 'implementationTimeline', label: 'Implementation timeline (restating the timeline entered above)' }
];
const emptyForm = (): Form => ({
  lines: [], gstApplicable: false, validityDays: '', paymentTerms: '', timeline: '', notes: '', introduction: '', understanding: '', recommendedServices: '', scopeSummary: '',
  commercialTerms: '', implementationTimeline: '', exclusions: '', extraNotes: '', serviceDescriptions: {}
});
const toForm = (q: BaQuotation): Form => ({
  lines: q.items.map(i => ({ serviceCode: i.serviceCode, description: i.description || '', quantity: String(i.quantity), unitPrice: String(i.unitPrice), discountPct: String(i.discountPct), gstRate: String(i.gstRate) })),
  gstApplicable: q.gstApplicable, validityDays: q.validityDays ? String(q.validityDays) : '', paymentTerms: q.paymentTerms || '', timeline: q.timeline || '', notes: q.notes || '',
  introduction: q.content.introduction || '', understanding: q.content.understanding || '', recommendedServices: q.content.recommendedServices || '', scopeSummary: q.content.scopeSummary || '',
  commercialTerms: q.content.commercialTerms || '', implementationTimeline: q.content.implementationTimeline || '', exclusions: (q.content.exclusions || []).join('\n'), extraNotes: (q.content.notes || []).join('\n'),
  serviceDescriptions: q.content.serviceDescriptions || {}
});
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
const toBody = (f: Form): BaQuotationBody => ({
  items: f.lines.map(l => ({ serviceCode: l.serviceCode, description: l.description.trim() || null, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct || 0), gstRate: Number(l.gstRate || 0) })),
  gstApplicable: f.gstApplicable,
  validityDays: f.validityDays ? Number(f.validityDays) : null,
  paymentTerms: f.paymentTerms.trim() || null,
  timeline: f.timeline.trim() || null,
  notes: f.notes.trim() || null,
  content: {
    introduction: f.introduction, understanding: f.understanding, recommendedServices: f.recommendedServices, scopeSummary: f.scopeSummary, commercialTerms: f.commercialTerms,
    implementationTimeline: f.implementationTimeline, exclusions: lines(f.exclusions), notes: lines(f.extraNotes), serviceDescriptions: f.serviceDescriptions
  }
});

/** The same arithmetic the database does (whole paise per line), only to show the figures while typing; the saved figures are the database's. */
function estimate(f: Form) {
  let sub = 0, disc = 0, taxable = 0, tax = 0;
  const per = f.lines.map(l => {
    const gross = Math.round((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * 100);
    const d = Math.round((gross * (Number(l.discountPct) || 0)) / 100);
    const base = gross - d;
    const g = f.gstApplicable ? Math.round((base * (Number(l.gstRate) || 0)) / 100) : 0;
    sub += gross; disc += d; taxable += base; tax += g;
    return (base + g) / 100;
  });
  return { per, subtotal: sub / 100, discount: disc / 100, taxable: taxable / 100, tax: tax / 100, total: (taxable + tax) / 100 };
}

export const QuotationPage: React.FC<{ go: BaNavigate; initialContactId?: string; initialQuotationId?: string }> = ({ initialContactId, initialQuotationId }) => {
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'edit'; id: string | null; contactId: string | null }>(
    initialQuotationId ? { kind: 'edit', id: initialQuotationId, contactId: null } : initialContactId ? { kind: 'edit', id: null, contactId: initialContactId } : { kind: 'list' }
  );
  if (view.kind === 'edit') return <QuotationEditor id={view.id} contactId={view.contactId} onClose={() => setView({ kind: 'list' })} onOpen={id => setView({ kind: 'edit', id, contactId: null })} />;
  return <QuotationList onNew={() => setView({ kind: 'edit', id: null, contactId: null })} onOpen={id => setView({ kind: 'edit', id, contactId: null })} />;
};

const QuotationList: React.FC<{ onNew: () => void; onOpen: (id: string) => void }> = ({ onNew, onOpen }) => {
  const [rows, setRows] = useState<BaQuotationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); businessAssociateApi.quotations().then(setRows, err => (setError(errorMessage(err)), setRows([]))); }, []);
  useEffect(load, [load]);
  const download = async (id: string) => { const m = await openFile(() => businessAssociateApi.quotationFile(id, 'download')); if (m) setError(m); };
  return (
    <div className="space-y-5">
      <PageTitle title="Quotation" subtitle="Draft client quotations with AI, check them, and save them as PDFs against the client." actions={<button type="button" className={tcBtn.primary} onClick={onNew}><Plus className="w-4 h-4" aria-hidden="true" /> New quotation</button>} />
      {error && <ErrorBanner message={error} onRetry={load} />}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {rows === null ? <Spinner label="Loading quotations…" /> : rows.length === 0 ? (
          <EmptyState icon={FileText} title="No quotation yet">Open one of your contacts and create the first quotation.<div className="mt-4"><button type="button" className={tcBtn.primary} onClick={onNew}><Plus className="w-4 h-4" aria-hidden="true" /> New quotation</button></div></EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">{['Quotation', 'Client', 'Company', 'Status', 'Total', 'Valid until', 'Updated', 'Actions'].map(h => <th key={h} scope="col" className="px-4 py-3 font-bold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(q => (
                  <tr key={q.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">{q.number} · r{q.revision}</td>
                    <td className="px-4 py-3">{q.client}</td>
                    <td className="px-4 py-3 text-slate-600">{q.company || '-'}</td>
                    <td className="px-4 py-3"><DocBadge status={q.status} aiGenerated={q.aiGenerated} reviewed={q.reviewed} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">{inr(q.total)}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateText(q.validUntil)}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateText(q.updatedAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button type="button" className={tcBtn.link} onClick={() => onOpen(q.id)} aria-label={`Open ${q.number} revision ${q.revision}`}>{q.status === 'DRAFT' ? 'Edit' : 'View'}</button>
                      {q.hasPdf && <button type="button" className={`${tcBtn.link} ml-3`} onClick={() => void download(q.id)} aria-label={`Download ${q.number}`}>PDF</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

const Card: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="px-5 py-3.5 border-b border-slate-100"><h2 className="text-base font-extrabold text-slate-900">{title}</h2>{hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}</div>
    <div className="p-5">{children}</div>
  </section>
);

const QuotationEditor: React.FC<{ id: string | null; contactId: string | null; onClose: () => void; onOpen: (id: string) => void }> = ({ id, contactId: startContact, onClose, onOpen }) => {
  const contacts = useContactOptions();
  const [prices, setPrices] = useState<ServicePrice[]>([]);
  const [q, setQ] = useState<BaQuotation | null>(null);
  const [contactId, setContactId] = useState(startContact || '');
  const [contact, setContact] = useState<BaContactDetail | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const lock = useRef(false);

  const final = q?.status === 'FINAL';
  const priceOf = useMemo(() => new Map(prices.map(p => [p.serviceCode, p])), [prices]);
  const est = useMemo(() => estimate(form), [form]);

  useEffect(() => { businessAssociateApi.prices().then(setPrices, err => setError(errorMessage(err))); }, []);
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    businessAssociateApi.quotation(id).then(d => { setQ(d); setForm(toForm(d)); setContactId(d.contactId); setLoading(false); }, err => { setError(errorMessage(err)); setLoading(false); });
  }, [id]);
  useEffect(() => {
    if (!contactId) { setContact(null); return; }
    businessAssociateApi.contact(contactId).then(setContact, () => setContact(null));
  }, [contactId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<Line>) => setForm(f => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const addLine = (code?: string) => {
    const p = code ? priceOf.get(code) : undefined;
    setForm(f => ({ ...f, lines: [...f.lines, { serviceCode: code || '', description: '', quantity: '1', unitPrice: p?.priced ? String(p.unitPrice) : '', discountPct: '0', gstRate: p?.priced ? String(p.gstRate) : '0' }] }));
  };
  const chooseService = (i: number, code: string) => {
    const p = priceOf.get(code);
    setLine(i, { serviceCode: code, unitPrice: p?.priced ? String(p.unitPrice) : '', gstRate: p?.priced ? String(p.gstRate) : '0', discountPct: '0' });
  };
  const addInterested = () => {
    const have = new Set(form.lines.map(l => l.serviceCode));
    (contact?.services ?? []).filter(s => !have.has(s.code)).forEach(s => addLine(s.code));
  };

  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 4500); };
  /** Runs one action at a time (a double click must not save twice or call the AI twice). */
  const act = async (name: string, fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    setError(null);
    try { await fn(); } catch (err) { setError(errorMessage(err)); } finally { lock.current = false; setBusy(null); }
  };
  const apply = (d: BaQuotation) => { setQ(d); setForm(toForm(d)); notifyBaChanged(); };
  const validate = () => {
    if (!contactId) return 'Select the client first.';
    if (form.lines.length === 0) return 'Add at least one service.';
    if (form.lines.some(l => !l.serviceCode)) return 'Choose a service on every line.';
    if (form.lines.some(l => !(Number(l.quantity) > 0))) return 'Enter a quantity above 0 on every line.';
    if (form.lines.some(l => l.unitPrice === '' || Number(l.unitPrice) < 0)) return 'Enter the unit price on every line.';
    return null;
  };
  const save = async (): Promise<BaQuotation | null> => {
    const problem = validate();
    if (problem) { setError(problem); return null; }
    const saved = q ? await businessAssociateApi.saveQuotation(q.id, toBody(form)) : await businessAssociateApi.createQuotation(contactId, toBody(form));
    apply(saved);
    return saved;
  };

  const onSave = () => act('save', async () => { const s = await save(); if (s) { say('Draft saved.'); if (!q) onOpen(s.id); } });
  const onAi = () => act('ai', async () => {
    const s = await save();
    if (!s) return;
    apply(await businessAssociateApi.aiQuotation(s.id, instructions.trim() || undefined));
    say('The AI drafted the text. Read it, edit it and mark it as reviewed. The prices and totals are unchanged.');
  });
  const onReview = () => act('review', async () => { const s = await save(); if (s) { apply(await businessAssociateApi.reviewQuotation(s.id)); say('Marked as reviewed.'); } });
  const onFinalize = () => act('final', async () => {
    const s = await save();
    if (!s) return;
    apply(await businessAssociateApi.finalizeQuotation(s.id));
    say('The quotation is final and its PDF is saved against the client.');
  });
  const onRevise = () => act('revise', async () => { if (q) { const d = await businessAssociateApi.reviseQuotation(q.id); apply(d); onOpen(d.id); say(`Revision ${d.revision} started.`); } });
  const onFile = (action: 'view' | 'download') => act(action, async () => { if (q) { const m = await openFile(() => businessAssociateApi.quotationFile(q.id, action)); if (m) setError(m); } });

  const client = contact ?? (q ? { name: q.client.name, company: q.client.company, requirements: q.requirements } : null);
  const flags = q?.priceFlags ?? [];
  const reviewed = !!q?.reviewed;
  const needsReview = !!q?.aiGenerated && !reviewed;
  const ro = !!final || busy !== null;

  if (loading) return <Spinner label="Loading the quotation…" />;
  return (
    <div className="space-y-5">
      <button type="button" className={tcBtn.secondary} onClick={onClose}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> View previous quotations</button>
      <PageTitle
        title={q ? `${q.number} · revision ${q.revision}` : 'New quotation'}
        subtitle={q ? undefined : 'Choose the client, confirm the services and prices, then let the AI draft the text.'}
        actions={q && <DocBadge status={q.status} aiGenerated={q.aiGenerated} reviewed={q.reviewed} />}
      />
      {error && <ErrorBanner message={error} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">{notice}</div>}
      {final && <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-sm">This quotation is final and cannot be changed. To change it, create a new revision; this one is kept.</div>}

      <Card title="Client">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Select client" htmlFor="qt-client" required>
            <select id="qt-client" className={tcInput} value={contactId} disabled={!!q || contacts.items === null} onChange={e => setContactId(e.target.value)}>
              <option value="">{contacts.items === null ? 'Loading…' : 'Choose one of your contacts…'}</option>
              {(contacts.items ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}
            </select>
          </Field>
          {contact && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-[11px] font-bold uppercase text-slate-500">Company</dt><dd>{contact.company || '-'}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase text-slate-500">Contact</dt><dd>{contact.phone || '-'}{contact.email ? ` · ${contact.email}` : ''}</dd></div>
              <div className="col-span-2"><dt className="text-[11px] font-bold uppercase text-slate-500">Business details</dt><dd className="whitespace-pre-wrap">{[contact.address, contact.profile.industry, contact.profile.productsServices].filter(Boolean).join(' · ') || '-'}</dd></div>
              <div className="col-span-2"><dt className="text-[11px] font-bold uppercase text-slate-500">Requirements</dt><dd className="whitespace-pre-wrap">{client && 'requirements' in client && client.requirements ? client.requirements : 'Not written yet. Add them in Tasks so the AI can use them.'}</dd></div>
            </dl>
          )}
        </div>
        {contactId && contacts.items?.length === 0 && <p className="text-sm text-amber-700 mt-2">You have no contacts yet.</p>}
      </Card>

      <Card title="Services and pricing" hint="Prices start from the approved price list. A price that differs, or a service with no approved price, is flagged for review.">
        {prices.length > 0 && prices.every(p => !p.priced) && <p className="mb-3 text-sm text-amber-700">No approved prices have been set up yet. Ask your Department Head to add them; prices you type are flagged.</p>}
        <div className="space-y-3">
          {form.lines.map((l, i) => {
            const p = priceOf.get(l.serviceCode);
            return (
              <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="grid grid-cols-2 lg:grid-cols-12 gap-2 items-end">
                  <div className="col-span-2 lg:col-span-4"><label className="text-[11px] font-bold uppercase text-slate-500" htmlFor={`qt-svc-${i}`}>Service</label>
                    <select id={`qt-svc-${i}`} className={tcInput} disabled={ro} value={l.serviceCode} onChange={e => chooseService(i, e.target.value)}>
                      <option value="">Choose a service…</option>
                      {prices.map(s => <option key={s.serviceCode} value={s.serviceCode}>{s.name}{s.priced ? '' : ' (no approved price)'}</option>)}
                    </select></div>
                  <div className="lg:col-span-1"><label className="text-[11px] font-bold uppercase text-slate-500" htmlFor={`qt-qty-${i}`}>Qty</label><input id={`qt-qty-${i}`} type="number" min="0" step="any" className={tcInput} disabled={ro} value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></div>
                  <div className="lg:col-span-2"><label className="text-[11px] font-bold uppercase text-slate-500" htmlFor={`qt-price-${i}`}>Unit price</label><input id={`qt-price-${i}`} type="number" min="0" step="0.01" className={tcInput} disabled={ro} value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} /></div>
                  <div className="lg:col-span-1"><label className="text-[11px] font-bold uppercase text-slate-500" htmlFor={`qt-disc-${i}`}>Disc. %</label><input id={`qt-disc-${i}`} type="number" min="0" max="100" step="0.01" className={tcInput} disabled={ro || !p?.priced || !(p.maxDiscountPct ?? 0)} value={l.discountPct} onChange={e => setLine(i, { discountPct: e.target.value })} title={p?.priced ? (p.maxDiscountPct ? `Up to ${p.maxDiscountPct}% is allowed` : 'No discount is allowed on this service') : 'Discounts need an approved price'} /></div>
                  <div className="lg:col-span-1"><label className="text-[11px] font-bold uppercase text-slate-500" htmlFor={`qt-gst-${i}`}>GST %</label><input id={`qt-gst-${i}`} type="number" min="0" max="100" step="0.01" className={tcInput} disabled={ro || !form.gstApplicable} value={form.gstApplicable ? l.gstRate : '0'} onChange={e => setLine(i, { gstRate: e.target.value })} /></div>
                  <div className="lg:col-span-2 text-right"><div className="text-[11px] font-bold uppercase text-slate-500">Line total</div><div className="text-sm font-bold text-slate-900 py-2.5">{inr(est.per[i])}</div></div>
                  <div className="lg:col-span-1 text-right">{!ro && <button type="button" className={`${tcBtn.link} text-rose-600`} onClick={() => set('lines', form.lines.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}><Trash2 className="w-4 h-4 inline" aria-hidden="true" /></button>}</div>
                </div>
                {p && <p className="text-[11px] text-slate-500">{p.priced ? `Approved price: ${inr(p.unitPrice)} ${p.unitLabel || ''}${p.gstRate !== null ? ` · GST ${p.gstRate}%` : ''}` : 'This service has no approved price: the price you type will be flagged.'}</p>}
                <input className={tcInput} disabled={ro} value={l.description} maxLength={1500} onChange={e => setLine(i, { description: e.target.value })} placeholder="Service description for this client (optional)" aria-label={`Description of line ${i + 1}`} />
              </div>
            );
          })}
          {!ro && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={tcBtn.secondary} onClick={() => addLine()}><Plus className="w-4 h-4" aria-hidden="true" /> Add service</button>
              {contact && contact.services.length > 0 && <button type="button" className={tcBtn.secondary} onClick={addInterested}>Add the services the client asked for</button>}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700 pt-1"><input type="checkbox" className="rounded border-slate-300" disabled={ro} checked={form.gstApplicable} onChange={e => set('gstApplicable', e.target.checked)} /> GST applies to this quotation (no tax is added unless you tick this)</label>
        </div>
        {flags.length > 0 && <ul className="mt-3 space-y-1" aria-label="Price review">{flags.map((f, i) => <li key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">{f.message}</li>)}</ul>}
        <dl className="mt-4 ml-auto max-w-xs space-y-1 text-sm" data-testid="quote-totals">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{inr(q && !busy ? q.subtotal : est.subtotal)}</dd></div>
          {(q ? q.discountTotal : est.discount) > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd>- {inr(q ? q.discountTotal : est.discount)}</dd></div>}
          {form.gstApplicable && <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd>{inr(q ? q.taxTotal : est.tax)}</dd></div>}
          <div className="flex justify-between border-t border-slate-200 pt-1.5 font-extrabold text-slate-900"><dt>Total quotation value</dt><dd data-testid="quote-total">{inr(q ? q.total : est.total)}</dd></div>
          <p className="text-[11px] text-slate-400 text-right">{q ? 'Calculated by the system when you save.' : 'Estimate; the system calculates the real figures when you save.'}</p>
        </dl>
      </Card>

      <Card title="Commercial terms">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Validity period (days)" htmlFor="qt-valid" required><input id="qt-valid" type="number" min="1" max="365" className={tcInput} disabled={ro} value={form.validityDays} onChange={e => set('validityDays', e.target.value)} /></Field>
          <div className="md:col-span-2"><Field label="Payment terms" htmlFor="qt-pay" required><input id="qt-pay" className={tcInput} disabled={ro} maxLength={2000} value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} placeholder="Type the agreed terms. The AI will not make them up." /></Field></div>
          <div className="md:col-span-3"><Field label="Delivery / implementation timeline" htmlFor="qt-time"><input id="qt-time" className={tcInput} disabled={ro} maxLength={1000} value={form.timeline} onChange={e => set('timeline', e.target.value)} /></Field></div>
          <div className="md:col-span-3"><Field label="Additional notes" htmlFor="qt-notes"><textarea id="qt-notes" className={`${tcInput} min-h-[70px]`} disabled={ro} maxLength={3000} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field></div>
        </div>
      </Card>

      {!final && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5 flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1"><label htmlFor="qt-ai-notes" className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-blue-600" aria-hidden="true" /> Generate with AI</label>
            <p className="text-xs text-slate-600 mb-2">The AI writes the introduction, the requirements, the service descriptions and the terms text from this client's data. It cannot change prices, tax or totals, and it does not invent terms.</p>
            <input id="qt-ai-notes" className={tcInput} value={instructions} maxLength={600} onChange={e => setInstructions(e.target.value)} placeholder="Anything to emphasise? (optional)" /></div>
          <button type="button" className={`${tcBtn.primary} shrink-0`} disabled={busy !== null} onClick={() => void onAi()}>{busy === 'ai' ? 'Drafting…' : <><Sparkles className="w-4 h-4" aria-hidden="true" /> {q?.aiGenerated ? 'Regenerate with AI' : 'Generate with AI'}</>}</button>
        </div>
      )}

      <Card title="Quotation text" hint="Review and edit everything the AI wrote. It is a draft until you finalise it.">
        {(q?.content.missingInformation?.length ?? 0) > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold mb-1">The AI needs you to confirm</p><ul className="list-disc pl-5">{q!.content.missingInformation!.map(m => <li key={m}>{m}</li>)}</ul></div>
        )}
        <div className="space-y-4">
          {TEXT_FIELDS.map(f => (
            <Field key={f.key} label={f.label} htmlFor={`qt-${f.key}`}><textarea id={`qt-${f.key}`} className={`${tcInput} min-h-[84px]`} disabled={ro} maxLength={3000} value={form[f.key] as string} onChange={e => set(f.key, e.target.value as never)} /></Field>
          ))}
          {form.lines.some(l => l.serviceCode) && (
            <div>
              <span className={`${'block text-xs font-medium text-slate-600 mb-1'}`}>Service descriptions</span>
              <div className="space-y-2">{form.lines.filter(l => l.serviceCode).map(l => (
                <div key={l.serviceCode}><label className="text-[11px] font-bold uppercase text-slate-500" htmlFor={`qt-sd-${l.serviceCode}`}>{priceOf.get(l.serviceCode)?.name || l.serviceCode}</label>
                  <textarea id={`qt-sd-${l.serviceCode}`} className={`${tcInput} min-h-[60px]`} disabled={ro} maxLength={1500} value={form.serviceDescriptions[l.serviceCode] || ''} onChange={e => set('serviceDescriptions', { ...form.serviceDescriptions, [l.serviceCode]: e.target.value })} /></div>
              ))}</div>
            </div>
          )}
          <Field label="Exclusions (one per line)" htmlFor="qt-excl"><textarea id="qt-excl" className={`${tcInput} min-h-[70px]`} disabled={ro} value={form.exclusions} onChange={e => set('exclusions', e.target.value)} /></Field>
          <Field label="Other notes for the client (one per line)" htmlFor="qt-xnotes"><textarea id="qt-xnotes" className={`${tcInput} min-h-[70px]`} disabled={ro} value={form.extraNotes} onChange={e => set('extraNotes', e.target.value)} /></Field>
        </div>
      </Card>

      {preview && <QuotationPreview form={form} q={q} est={est} names={Object.fromEntries(prices.map(p => [p.serviceCode, p.name]))} client={client ? { name: client.name, company: client.company ?? null } : null} />}

      <div className="sticky bottom-0 z-10 -mx-4 sm:mx-0 border-t sm:border sm:rounded-2xl border-slate-200 bg-white/95 backdrop-blur p-3 flex flex-wrap items-center gap-2 shadow-sm">
        {!final ? (
          <>
            <button type="button" className={tcBtn.secondary} onClick={() => void onSave()} disabled={busy !== null}><Save className="w-4 h-4" aria-hidden="true" /> {busy === 'save' ? 'Saving…' : 'Save Draft'}</button>
            <button type="button" className={tcBtn.secondary} onClick={() => setPreview(p => !p)}><Eye className="w-4 h-4" aria-hidden="true" /> {preview ? 'Hide preview' : 'Preview'}</button>
            {q && <button type="button" className={tcBtn.secondary} onClick={() => void onReview()} disabled={busy !== null || reviewed}>{reviewed ? 'Reviewed ✓' : 'I have reviewed this draft'}</button>}
            <span className="flex-1" />
            {needsReview && <span className="text-xs text-amber-700">Review the AI draft before generating the PDF.</span>}
            <button type="button" className={tcBtn.primary} onClick={() => void onFinalize()} disabled={busy !== null || needsReview || !q}><FileText className="w-4 h-4" aria-hidden="true" /> {busy === 'final' ? 'Generating…' : 'Generate PDF'}</button>
          </>
        ) : (
          <>
            <button type="button" className={tcBtn.primary} onClick={() => void onFile('download')} disabled={busy !== null}><Download className="w-4 h-4" aria-hidden="true" /> Download PDF</button>
            <button type="button" className={tcBtn.secondary} onClick={() => void onFile('view')} disabled={busy !== null}><Eye className="w-4 h-4" aria-hidden="true" /> View PDF</button>
            <button type="button" className={tcBtn.secondary} onClick={() => void onRevise()} disabled={busy !== null}><FilePlus2 className="w-4 h-4" aria-hidden="true" /> Create revision</button>
          </>
        )}
      </div>
    </div>
  );
};

const QuotationPreview: React.FC<{ form: Form; q: BaQuotation | null; est: ReturnType<typeof estimate>; names: Record<string, string>; client: { name: string; company: string | null } | null }> = ({ form, q, est, names, client }) => (
  <section className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-6 space-y-3" aria-label="Quotation preview">
    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Preview (draft; the PDF is made when you generate it)</p>
    <h2 className="text-xl font-extrabold text-slate-900">Quotation {q ? q.number : ''}</h2>
    {client && <p className="text-sm text-slate-600">Prepared for {client.company || client.name}</p>}
    {form.introduction && <p className="text-sm whitespace-pre-wrap">{form.introduction}</p>}
    {form.understanding && <><h3 className="font-bold text-sm">Understanding of your requirements</h3><p className="text-sm whitespace-pre-wrap">{form.understanding}</p></>}
    <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th>Service</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Total</th></tr></thead>
      <tbody>{form.lines.map((l, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1.5">{names[l.serviceCode] || l.serviceCode}{form.serviceDescriptions[l.serviceCode] ? <div className="text-xs text-slate-500">{form.serviceDescriptions[l.serviceCode]}</div> : null}</td><td className="text-right">{l.quantity}</td><td className="text-right">{inr(Number(l.unitPrice))}</td><td className="text-right">{inr(est.per[i])}</td></tr>)}</tbody></table>
    <p className="text-right font-bold">Total {inr(q ? q.total : est.total)}{form.gstApplicable ? ' (including GST)' : ' (GST not applied)'}</p>
    {form.paymentTerms && <p className="text-sm"><b>Payment terms:</b> {form.paymentTerms}</p>}
    {form.validityDays && <p className="text-sm"><b>Valid for:</b> {form.validityDays} days</p>}
    {form.timeline && <p className="text-sm"><b>Timeline:</b> {form.timeline}</p>}
  </section>
);
