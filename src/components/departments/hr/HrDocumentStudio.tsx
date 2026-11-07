import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { hrDocumentsApi } from '../../../lib/api/endpoints';
import { ApiError } from '../../../lib/api/client';
import { employmentDuration } from '../../../lib/employmentDuration';
import { Employee } from '../../../types/amuwaHq';
import type { HrDocExperienceFields, HrDocNdaFields, HrDocPrefill, HrDocRequest, HrDocTitle, HrDocType, HrDocument } from '../../../../shared/contracts';
import { HR_DOC_TITLES, hrExperienceFieldsSchema, hrNdaFieldsSchema } from '../../../../shared/validation';

/**
 * NDA and Experience Letter for HR. Pick an employee, check the details the HR record gives, edit what may be edited, see the PDF the server
 * draws on the official template, generate it (it is stored against that employee) and download it. The server re-checks everything: the employee,
 * the joining date and the code come from the HR record, never from this form.
 */
interface Props {
  type: HrDocType;
  employees: Employee[];
  onSuccessToast?: (msg: string) => void;
}

/** The key the database uses: the CRM account (profile id), or 'HR:' + the HR record id for a record without a login. */
const employeeKeyOf = (e: Employee) => e.profileId ?? `HR:${e.id}`;
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const inputCls = 'w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500 disabled:bg-slate-100 disabled:text-slate-500';
const labelCls = 'block text-slate-700 font-bold mb-1';

const fmt = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('-') : '–');

function pdfUrl(base64: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

export const HrDocumentStudio: React.FC<Props> = ({ type, employees, onSuccessToast }) => {
  const isNda = type === 'NDA';
  const [employeeKey, setEmployeeKey] = useState('');
  const [prefill, setPrefill] = useState<HrDocPrefill | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nda, setNda] = useState<HrDocNdaFields>({ letterDate: '', employeeName: '' });
  const [exp, setExp] = useState<Omit<HrDocExperienceFields, 'title'> & { title: HrDocTitle | '' }>({
    letterDate: '', title: '', employeeName: '', designation: '', lastWorkingDate: '', signatoryName: '', signatoryTitle: ''
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<HrDocument | null>(null);
  const [history, setHistory] = useState<HrDocument[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const prefillSeq = useRef(0);
  const previewSeq = useRef(0);

  const sorted = useMemo(() => [...employees].sort((a, b) => a.name.localeCompare(b.name)), [employees]);
  const left = sorted.filter(e => e.status === 'Left');
  const working = sorted.filter(e => e.status !== 'Left');

  // ---- the HR record of the chosen employee
  useEffect(() => {
    setGenerated(null); setSaveError(null); setPrefill(null); setLoadError(null);
    if (!employeeKey) return;
    const mine = ++prefillSeq.current;
    setLoading(true);
    hrDocumentsApi.prefill(employeeKey, type).then(
      p => {
        if (mine !== prefillSeq.current) return;
        setPrefill(p);
        if (isNda) setNda({ letterDate: p.today, employeeName: p.employee.name });
        else setExp({
          letterDate: p.today, title: '', employeeName: p.employee.name, designation: p.employee.designation ?? '',
          lastWorkingDate: p.employee.lastWorkingDate ?? '', signatoryName: p.signatory.name, signatoryTitle: p.signatory.title
        });
      },
      e => { if (mine === prefillSeq.current) setLoadError(errText(e, 'Could not read the employee record.')); }
    ).finally(() => { if (mine === prefillSeq.current) setLoading(false); });
  }, [employeeKey, type, isNda]);

  // ---- the stored documents (of this employee, or the latest of this type)
  const loadHistory = useCallback(() => {
    setHistoryError(null);
    return hrDocumentsApi.list({ employeeKey: employeeKey || undefined, type: employeeKey ? undefined : type }).then(setHistory, e => { setHistory([]); setHistoryError(errText(e, 'Could not load the generated documents.')); });
  }, [employeeKey, type]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // ---- what would be sent, and what is wrong with it (the same rules as the server)
  const request = useMemo<{ body: HrDocRequest | null; problem: string | null }>(() => {
    if (!prefill?.ready) return { body: null, problem: null };
    if (isNda) {
      const r = hrNdaFieldsSchema.safeParse(nda);
      return r.success ? { body: { type: 'NDA', employeeKey, fields: r.data }, problem: null } : { body: null, problem: r.error.issues[0]?.message ?? 'Check the details.' };
    }
    if (!exp.title) return { body: null, problem: 'Choose Mr., Miss, Mrs. or Ms. (it decides he / she in the letter).' };
    const r = hrExperienceFieldsSchema.safeParse(exp);
    if (!r.success) return { body: null, problem: r.error.issues[0]?.message ?? 'Check the details.' };
    const joined = prefill.employee.joiningDate;
    if (joined && r.data.lastWorkingDate < joined) return { body: null, problem: 'The last working date is before the joining date on record.' };
    if (r.data.letterDate < r.data.lastWorkingDate) return { body: null, problem: 'The letter date cannot be before the last working date.' };
    return { body: { type: 'EXPERIENCE', employeeKey, fields: r.data }, problem: null };
  }, [prefill, isNda, nda, exp, employeeKey]);

  // ---- the preview: the server's own PDF, redrawn shortly after the last edit
  useEffect(() => {
    setPreviewError(null);
    if (!request.body) { setPreviewUrl(old => { if (old) URL.revokeObjectURL(old); return null; }); return; }
    const mine = ++previewSeq.current;
    const timer = setTimeout(() => {
      setPreviewing(true);
      hrDocumentsApi.preview(request.body!).then(
        p => { if (mine !== previewSeq.current) return; setPreviewUrl(old => { if (old) URL.revokeObjectURL(old); return pdfUrl(p.pdfBase64); }); },
        e => { if (mine === previewSeq.current) setPreviewError(errText(e, 'The preview could not be made.')); }
      ).finally(() => { if (mine === previewSeq.current) setPreviewing(false); });
    }, 700);
    return () => clearTimeout(timer);
  }, [request.body]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const download = async (id: string) => {
    setDownloading(id);
    try {
      const d = await hrDocumentsApi.download(id);
      const a = document.createElement('a');
      a.href = d.url; a.download = d.fileName; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      setSaveError(errText(e, 'The document could not be downloaded.'));
    } finally {
      setDownloading(null);
    }
  };

  const generate = async () => {
    if (!request.body || saving) return;
    setSaving(true); setSaveError(null);
    try {
      const d = await hrDocumentsApi.generate(request.body);
      setGenerated(d);
      onSuccessToast?.(`✅ ${isNda ? 'NDA' : 'Experience Letter'} for ${d.employeeName} generated and saved to their record.`);
      await loadHistory();
    } catch (e) {
      setSaveError(errText(e, 'The document could not be generated. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const emp = prefill?.employee;
  const duration = emp && !isNda ? employmentDuration(emp.joiningDate, exp.lastWorkingDate || emp.lastWorkingDate) : null;
  const title = isNda ? 'Non-Disclosure Agreement (NDA)' : 'Experience Letter';
  const docLabel = (d: HrDocument) => (d.type === 'NDA' ? 'NDA' : 'Experience Letter');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start font-sans" data-testid={`hr-doc-studio-${type}`}>
      {/* ======================= form ======================= */}
      <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200/90 shadow-sm p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2"><Sparkles className="w-4 h-4 text-blue-600" /> <span>{isNda ? 'Generate NDA' : 'Generate Experience Letter'}</span></h3>
          <span className="text-[11px] font-mono text-slate-400">Official template</span>
        </div>

        <div className="space-y-4 text-xs font-mono">
          <div>
            <label htmlFor={`hrdoc-emp-${type}`} className={labelCls}>Employee *</label>
            <select id={`hrdoc-emp-${type}`} value={employeeKey} onChange={e => setEmployeeKey(e.target.value)} className={inputCls}>
              <option value="">Choose an employee…</option>
              {!isNda && left.length > 0 && <optgroup label="Left the company">{left.map(e => <option key={employeeKeyOf(e)} value={employeeKeyOf(e)}>{e.name} ({e.designation || 'no designation'})</option>)}</optgroup>}
              {(isNda ? sorted : working).length > 0 && <optgroup label={isNda ? 'All employees' : 'Still working'}>{(isNda ? sorted : working).map(e => <option key={employeeKeyOf(e)} value={employeeKeyOf(e)}>{e.name} ({e.designation || 'no designation'})</option>)}</optgroup>}
            </select>
            {employees.length === 0 && <p className="mt-1 text-[11px] text-slate-500 font-sans">No employees are loaded yet.</p>}
          </div>

          {loading && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Reading the HR record…</div>}
          {loadError && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-sans text-[11px] flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {loadError}</div>}

          {emp && (
            <>
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 grid grid-cols-2 gap-x-4 gap-y-1.5" aria-label="From the HR record">
                <div className="col-span-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold">From the HR record</div>
                <div><span className="text-slate-400">Employee ID</span><div className="font-bold text-slate-800">{emp.code}</div></div>
                <div><span className="text-slate-400">Status</span><div className="font-bold text-slate-800">{emp.status}</div></div>
                <div><span className="text-slate-400">Department</span><div className="font-bold text-slate-800">{emp.department || '–'}</div></div>
                <div><span className="text-slate-400">Date of joining</span><div className="font-bold text-slate-800">{fmt(emp.joiningDate)}</div></div>
                {!isNda && (
                  <>
                    <div><span className="text-slate-400">Last working date</span><div className="font-bold text-slate-800">{fmt(emp.lastWorkingDate)}</div></div>
                    <div><span className="text-slate-400">Employment duration</span><div className="font-bold text-slate-800">{duration ?? '–'}</div></div>
                  </>
                )}
              </div>

              {prefill && prefill.problems.length > 0 && (
                <div role="alert" className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 font-sans text-[11px] space-y-1">
                  <div className="font-bold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> This letter cannot be made yet</div>
                  <ul className="list-disc pl-5">{prefill.problems.map(p => <li key={p.code}>{p.message}</li>)}</ul>
                </div>
              )}

              {prefill?.ready && isNda && (
                <>
                  <div>
                    <label htmlFor="hrdoc-nda-name" className={labelCls}>Employee name (as printed) *</label>
                    <input id="hrdoc-nda-name" className={inputCls} value={nda.employeeName} maxLength={100} onChange={e => setNda({ ...nda, employeeName: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="hrdoc-nda-date" className={labelCls}>Agreement date *</label>
                    <input id="hrdoc-nda-date" type="date" className={inputCls} value={nda.letterDate} onChange={e => setNda({ ...nda, letterDate: e.target.value })} />
                  </div>
                  <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-sans leading-relaxed">
                    🛡️ <strong>Fixed legal text:</strong> every clause is the official template word for word. Only the agreement date and the employee's name (Employee Acceptance, last page) are filled in; the signature and date lines stay blank to be signed.
                  </div>
                </>
              )}

              {prefill?.ready && !isNda && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label htmlFor="hrdoc-exp-title" className={labelCls}>Title *</label>
                      <select id="hrdoc-exp-title" className={inputCls} value={exp.title} onChange={e => setExp({ ...exp, title: e.target.value as HrDocTitle })}>
                        <option value="">Choose…</option>
                        {HR_DOC_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label htmlFor="hrdoc-exp-name" className={labelCls}>Employee name *</label>
                      <input id="hrdoc-exp-name" className={inputCls} value={exp.employeeName} maxLength={100} onChange={e => setExp({ ...exp, employeeName: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="hrdoc-exp-designation" className={labelCls}>Designation *</label>
                    <input id="hrdoc-exp-designation" className={inputCls} value={exp.designation} maxLength={80} onChange={e => setExp({ ...exp, designation: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="hrdoc-exp-join" className={labelCls}>Date of joining</label>
                      <input id="hrdoc-exp-join" className={inputCls} value={fmt(emp.joiningDate)} disabled readOnly />
                    </div>
                    <div>
                      <label htmlFor="hrdoc-exp-last" className={labelCls}>Last working date *</label>
                      <input id="hrdoc-exp-last" type="date" className={inputCls} min={emp.joiningDate ?? undefined} value={exp.lastWorkingDate} onChange={e => setExp({ ...exp, lastWorkingDate: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="hrdoc-exp-date" className={labelCls}>Letter date *</label>
                    <input id="hrdoc-exp-date" type="date" className={inputCls} min={exp.lastWorkingDate || undefined} value={exp.letterDate} onChange={e => setExp({ ...exp, letterDate: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="hrdoc-exp-sig" className={labelCls}>Signed by *</label>
                      <input id="hrdoc-exp-sig" className={inputCls} value={exp.signatoryName} maxLength={100} onChange={e => setExp({ ...exp, signatoryName: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor="hrdoc-exp-sigtitle" className={labelCls}>Signatory title *</label>
                      <input id="hrdoc-exp-sigtitle" className={inputCls} value={exp.signatoryTitle} maxLength={60} onChange={e => setExp({ ...exp, signatoryTitle: e.target.value })} />
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 text-[11px] font-sans leading-relaxed">
                    📜 The wording is the official letter. The joining date is the HR record's; correct it there if it is wrong. He / she in the letter follows the title you choose.
                  </div>
                </>
              )}

              {request.problem && <div role="status" className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-sans text-[11px]">{request.problem}</div>}
            </>
          )}
        </div>

        {saveError && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {saveError}</div>}

        <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
          <button type="button" onClick={() => void generate()} disabled={!request.body || saving}
            className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>{saving ? 'Generating…' : 'Generate PDF'}</span>
          </button>
          <button type="button" onClick={() => generated && void download(generated.id)} disabled={!generated || downloading === generated?.id}
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-xs shadow-xs transition-colors flex items-center gap-2 cursor-pointer">
            <Download className="w-4 h-4" /> <span>Download PDF</span>
          </button>
        </div>
        {generated && (
          <p role="status" className="text-[11px] text-emerald-700 font-sans flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Saved to {generated.employeeName}'s record as {generated.fileName}. Download it, or find it again below.</p>
        )}
      </div>

      {/* ======================= preview + generated documents ======================= */}
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-md overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${previewing ? 'bg-amber-400 animate-pulse' : previewUrl ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className="text-xs font-mono font-bold text-slate-700">Preview &bull; {title}</span>
            </div>
            {previewing && <span className="text-[11px] text-slate-500 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Updating…</span>}
          </div>
          {previewError && <div role="alert" className="m-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {previewError}</div>}
          {previewUrl ? (
            <iframe title={`${title} preview`} src={previewUrl} className="w-full h-[78vh] min-h-[520px] bg-slate-100" />
          ) : (
            <div className="p-10 text-center text-xs text-slate-500">
              <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              {!employeeKey ? 'Choose an employee to see the document.' : loading ? 'Reading the HR record…' : prefill && !prefill.ready ? 'The document cannot be previewed until the details above are fixed.' : 'Complete the details to see the document.'}
            </div>
          )}
        </div>

        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-5 sm:p-6">
          <h4 className="font-bold text-sm text-slate-900 mb-1">{employeeKey && emp ? `Documents generated for ${emp.name}` : `Latest ${isNda ? 'NDAs' : 'Experience Letters'}`}</h4>
          <p className="text-[11px] text-slate-500 mb-3">Every generated PDF is kept against the employee's record and can be downloaded again.</p>
          {historyError && <div role="alert" className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">{historyError}</div>}
          {!history ? (
            <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : history.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing generated yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {history.slice(0, 30).map(d => (
                <li key={d.id} className="py-2.5 flex flex-wrap items-center gap-3 text-xs">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${d.type === 'NDA' ? 'bg-emerald-50 text-emerald-700' : 'bg-purple-50 text-purple-700'}`}>{docLabel(d)}</span>
                  <span className="min-w-[10rem] flex-1"><span className="font-bold text-slate-800">{d.employeeName}</span> <span className="text-slate-400">· {d.employeeCode}</span></span>
                  <span className="text-slate-500">{new Date(d.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{d.generatedBy ? ` · ${d.generatedBy}` : ''}</span>
                  <button type="button" onClick={() => void download(d.id)} disabled={downloading === d.id}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50" aria-label={`Download ${docLabel(d)} of ${d.employeeName}`}>
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
