import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, FileText, Loader2, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import type { HrDocPrefill, HrDocRequest, HrDocument, OfferTemplate, OfferTemplateField } from '../../../../shared/contracts';
import { checkOfferValues, OFFER_SOURCE_LABEL, offerStartingValues } from '../../../../shared/offerTemplates';
import { hrDocumentsApi, offerTemplatesApi } from '../../../lib/api/endpoints';
import { errorMessage } from '../../../lib/api/client';
import type { Employee } from '../../../types/amuwaHq';
import { ErrorBanner, inputCls, Spinner } from '../../team-member/pipeline/shared';
import { HrEmptyState, HrSectionTitle, hrBtn, hrCard } from '../hrUi';

/**
 * HR > Offer Letter Generation (migration 20270206000100). HR chooses the employee's designation: the matching template (its own fields,
 * wording and letterhead, from the sample HR supplied) loads. The fields start from the CRM record and the template's own values; HR corrects
 * them; the PDF on the right is the server's own rendering of exactly what will be stored, redrawn shortly after each change. Generate stores
 * the letter on the employee's record with the template version it was made from; issued letters never change.
 */

const employeeKeyOf = (e: Employee) => e.profileId ?? `HR:${e.id}`;
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function pdfUrl(base64: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

interface Props {
  employees: Employee[];
  onToast?: (message: string) => void;
}

export const OfferLetterGenerator: React.FC<Props> = ({ employees, onToast }) => {
  const [templates, setTemplates] = useState<OfferTemplate[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [employeeKey, setEmployeeKey] = useState('');
  const [prefill, setPrefill] = useState<HrDocPrefill | null>(null);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ sig: string; doc: HrDocument } | null>(null);
  const [history, setHistory] = useState<HrDocument[] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewSeq = useRef(0);

  const loadTemplates = useCallback(async () => {
    setListError(null);
    try { setTemplates((await offerTemplatesApi.list()).templates.filter(t => t.active)); } catch (e) { setListError(errorMessage(e)); }
  }, []);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const template = templates?.find(t => t.id === templateId) ?? null;
  const fields: OfferTemplateField[] = useMemo(() => template?.current.content.fields ?? [], [template]);
  const sorted = useMemo(() => [...employees].filter(e => e.status !== 'Left').sort((a, b) => a.name.localeCompare(b.name)), [employees]);

  // the employee's record (the database checks HR staff and resolves the employee)
  useEffect(() => {
    if (!employeeKey) { setPrefill(null); return; }
    let live = true;
    setPrefillError(null);
    hrDocumentsApi.prefill(employeeKey, 'OFFER').then(p => { if (live) setPrefill(p); }).catch(e => { if (live) { setPrefill(null); setPrefillError(errorMessage(e)); } });
    return () => { live = false; };
  }, [employeeKey]);

  // starting values: the template's own values, then what the CRM knows; what HR typed in a field the new template also has is kept
  const lastStart = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!template) { setValues({}); return; }
    const today = prefill?.today ?? new Date().toISOString().slice(0, 10);
    const e = prefill?.employee;
    const start = offerStartingValues(fields, {
      employeeName: e?.name, designation: e?.designation, department: e?.department, joiningDate: e?.joiningDate, monthlySalary: e?.monthlySalary, today
    });
    setValues(prev => {
      const next = { ...start };
      for (const k of Object.keys(start)) if (prev[k] && prev[k] !== lastStart.current[k]) next[k] = prev[k];
      lastStart.current = start;
      return next;
    });
  }, [template, fields, prefill]);

  const check = useMemo(() => checkOfferValues(fields, values), [fields, values]);
  const problems = Object.entries(check.errors);
  const request: HrDocRequest | null = template && employeeKey && prefill?.ready !== false
    ? { type: 'OFFER', employeeKey, fields: { offerTemplateId: template.id, templateVersion: template.current.version, values } } : null;
  const sig = request && !problems.length ? JSON.stringify(request) : null;
  const current = generated && generated.sig === sig ? generated.doc : null;

  // the live preview: the server's own PDF of these values, ~0.6 s after the last change
  useEffect(() => {
    if (!sig || !request) { setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return null; }); setPreviewError(null); return; }
    const mine = ++previewSeq.current;
    const timer = setTimeout(() => {
      setPreviewing(true);
      hrDocumentsApi.preview(request)
        .then(p => { if (mine === previewSeq.current) { setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return pdfUrl(p.pdfBase64); }); setPreviewError(null); } })
        .catch(e => { if (mine === previewSeq.current) setPreviewError(errorMessage(e)); })
        .finally(() => { if (mine === previewSeq.current) setPreviewing(false); });
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const loadHistory = useCallback(() => {
    if (!employeeKey) { setHistory(null); return; }
    hrDocumentsApi.list({ employeeKey, type: 'OFFER' }).then(setHistory).catch(() => setHistory([]));
  }, [employeeKey]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const generate = async (): Promise<HrDocument | null> => {
    setTouched(true);
    if (!request || !sig || saving) return null;
    setSaving(true);
    setSaveError(null);
    try {
      const d = await hrDocumentsApi.generate(request);
      setGenerated({ sig, doc: d });
      onToast?.(`Offer Letter (${template?.designation}) generated and stored for ${d.employeeName}.`);
      loadHistory();
      return d;
    } catch (e) {
      setSaveError(errorMessage(e));
      return null;
    } finally {
      setSaving(false);
    }
  };
  const download = async (id: string) => {
    try {
      const d = await hrDocumentsApi.download(id);
      const a = document.createElement('a');
      a.href = d.url; a.download = d.fileName; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { setSaveError(errorMessage(e)); }
  };
  const downloadCurrent = async () => {
    const d = current ?? (await generate());
    if (d) await download(d.id);
  };
  const editDetails = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    formRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  };
  const showPreview = () => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (listError) return <ErrorBanner message={listError} onRetry={() => void loadTemplates()} />;
  if (!templates) return <Spinner label="Loading the offer letter templates…" />;
  if (!templates.length) return <HrEmptyState icon={FileText} title="No offer letter templates yet" hint="The Super Admin or the HR Admin Head adds one template per designation under Templates." />;

  const field = (fd: OfferTemplateField) => {
    const id = `offer-field-${fd.key}`;
    const err = touched || values[fd.key] ? check.errors[fd.key] : undefined;
    const common = {
      id, value: values[fd.key] ?? '', 'aria-invalid': !!err, 'aria-describedby': err ? `${id}-error` : fd.help ? `${id}-help` : undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues(v => ({ ...v, [fd.key]: e.target.value }))
    };
    return (
      <div key={fd.key} className={fd.type === 'textarea' ? 'sm:col-span-2' : ''}>
        <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
          {fd.label}{fd.required && <span aria-hidden="true"> *</span>}
          {fd.source && fd.source !== 'today' && <span className="ml-1.5 text-[10px] font-semibold text-blue-700 bg-blue-50 rounded px-1 py-0.5">from the CRM</span>}
        </label>
        {fd.type === 'select' ? (
          <select className={inputCls} {...common}>
            <option value="">Choose…</option>
            {(fd.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : fd.type === 'textarea' ? (
          <textarea className={`${inputCls} min-h-[72px]`} maxLength={2000} {...common} />
        ) : (
          <input className={inputCls} type={fd.type === 'date' ? 'date' : 'text'} inputMode={fd.type === 'money' ? 'numeric' : undefined} maxLength={200} {...common} />
        )}
        {err ? <p id={`${id}-error`} className="mt-1 text-[11px] text-rose-600">{err}</p>
          : fd.help ? <p id={`${id}-help`} className="mt-1 text-[11px] text-slate-500">{fd.help}</p>
          : fd.source ? <p className="mt-1 text-[11px] text-slate-400">Starts with {OFFER_SOURCE_LABEL[fd.source]}.</p> : null}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        <section className={`${hrCard} p-4 sm:p-5 space-y-4`} aria-labelledby="offer-step-template">
          <HrSectionTitle id="offer-step-template" icon={FileText} title="1. Designation and employee" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="offer-template" className="block text-xs font-medium text-slate-600 mb-1">Select Employee Designation / Offer Letter Template *</label>
              <select id="offer-template" className={inputCls} value={templateId} onChange={e => { setTemplateId(e.target.value); setGenerated(null); setSaveError(null); }}>
                <option value="">Choose the designation…</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.designation}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="offer-employee" className="block text-xs font-medium text-slate-600 mb-1">Employee *</label>
              <select id="offer-employee" className={inputCls} value={employeeKey} onChange={e => { setEmployeeKey(e.target.value); setGenerated(null); setSaveError(null); }}>
                <option value="">Choose the employee…</option>
                {sorted.map(e => <option key={employeeKeyOf(e)} value={employeeKeyOf(e)}>{e.name}{e.designation ? ` – ${e.designation}` : ''}</option>)}
              </select>
            </div>
          </div>
          {template && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2" data-testid="offer-template-info">
              <span><strong className="text-slate-900">{template.designation}</strong> · template version {template.current.version} · {fields.length} fields{template.description ? ` · ${template.description}` : ''}</span>
              {template.current.sampleFile && <SampleLink fileId={template.current.sampleFile.id} name={template.current.sampleFile.fileName} />}
            </div>
          )}
          {prefillError && <ErrorBanner message={prefillError} />}
          {prefill && !prefill.ready && <ErrorBanner message={prefill.problems[0]?.message ?? 'An offer letter cannot be made for this employee.'} />}
        </section>

        {template && (
          <section className={`${hrCard} p-4 sm:p-5 space-y-4`} aria-labelledby="offer-step-details">
            <HrSectionTitle id="offer-step-details" icon={Pencil} title={`2. ${template.designation} – letter details`} />
            {!employeeKey && <p className="text-xs text-slate-500">Choose the employee to fill these from their record. You can change every value before generating.</p>}
            <form ref={formRef} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5" onSubmit={e => { e.preventDefault(); void generate(); }} noValidate data-testid="offer-fields">
              {fields.map(field)}
            </form>
            {saveError && <ErrorBanner message={saveError} />}
            {touched && problems.length > 0 && <p role="alert" className="text-xs text-rose-600">Check the highlighted fields ({problems.length}).</p>}
            <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-2">
              <button type="button" className={hrBtn.secondary} onClick={showPreview} disabled={!sig}><Eye className="w-4 h-4" aria-hidden="true" /> Preview Offer Letter</button>
              <button type="button" className={hrBtn.secondary} onClick={editDetails}><Pencil className="w-4 h-4" aria-hidden="true" /> Edit Details</button>
              <button type="button" className={hrBtn.primary} onClick={() => void generate()} disabled={saving || !employeeKey || !!current}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />} {current ? 'Generated' : 'Generate Offer Letter'}
              </button>
              <button type="button" className={hrBtn.secondary} onClick={() => void downloadCurrent()} disabled={saving || !employeeKey}><Download className="w-4 h-4" aria-hidden="true" /> Download as PDF</button>
              {current && (
                <button type="button" className={hrBtn.secondary} onClick={() => { setGenerated(null); void generate(); }} disabled={saving}
                  title="Store a new copy of this letter (the earlier one is kept)"><RefreshCw className="w-4 h-4" aria-hidden="true" /> Regenerate Document</button>
              )}
            </div>
            {current && <p role="status" className="text-xs text-emerald-700">Stored on {current.employeeName}&apos;s record as {current.fileName}. Changing any value makes a new letter when you generate again.</p>}
          </section>
        )}

        {employeeKey && history && (
          <section className={`${hrCard} p-4 sm:p-5 space-y-3`} aria-labelledby="offer-history">
            <HrSectionTitle id="offer-history" icon={FileText} title="Offer letters issued to this employee" count={history.length} />
            {!history.length ? <p className="text-xs text-slate-500">None yet.</p> : (
              <ul className="divide-y divide-slate-100">
                {history.map(d => {
                  const f = d.fields as { templateDesignation?: string; templateVersion?: number };
                  return (
                    <li key={d.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="min-w-0">
                        <span className="font-semibold text-slate-900">{f.templateDesignation ?? 'Offer Letter'}</span>
                        <span className="text-slate-500"> · template v{f.templateVersion ?? '–'} · {fmtDateTime(d.createdAt)}{d.generatedBy ? ` · by ${d.generatedBy}` : ''}</span>
                      </span>
                      <button type="button" className={hrBtn.ghost} onClick={() => void download(d.id)} aria-label={`Download ${d.fileName}`}><Download className="w-4 h-4" aria-hidden="true" /> Download</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      <section ref={previewRef} className={`${hrCard} p-3 sm:p-4 space-y-2 2xl:sticky 2xl:top-20`} aria-labelledby="offer-preview">
        <div className="flex items-center justify-between gap-2">
          <h3 id="offer-preview" className="text-[15px] font-bold text-slate-900 flex items-center gap-2"><Eye className="w-4 h-4 text-blue-600" aria-hidden="true" /> Live preview</h3>
          {previewing && <span className="text-[11px] text-slate-500 flex items-center gap-1" role="status"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Updating…</span>}
        </div>
        {previewError && <ErrorBanner message={previewError} />}
        {previewUrl ? (
          <iframe title="Offer letter preview" src={previewUrl} className="w-full h-[78vh] min-h-[520px] rounded-lg border border-slate-200 bg-slate-100" data-testid="offer-preview-frame" />
        ) : (
          <div className="h-[420px] rounded-lg border border-dashed border-slate-200 bg-slate-50/60 flex items-center justify-center text-center p-6">
            <p className="text-xs text-slate-500 max-w-xs">
              {!template ? 'Choose a designation to load its offer letter.' : !employeeKey ? 'Choose the employee.' : problems.length ? `Complete the details to see the letter (${problems[0][1]})` : 'Preparing the preview…'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

/** Opens the uploaded sample of a template (a short-lived private link). */
export const SampleLink: React.FC<{ fileId: string; name: string; label?: string }> = ({ fileId, name, label = 'View the sample' }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-xs font-semibold text-blue-700 hover:underline disabled:opacity-50" disabled={busy} title={name}
        onClick={async () => {
          setBusy(true); setError(null);
          try { const d = await offerTemplatesApi.fileUrl(fileId); window.open(d.url, '_blank', 'noopener'); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
        }}>
        {label}
      </button>
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </span>
  );
};

export default OfferLetterGenerator;
