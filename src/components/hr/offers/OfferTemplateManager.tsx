import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, FilePlus2, FileText, History, Loader2, Plus, Save, Trash2, Upload } from 'lucide-react';
import type { OfferLetterhead, OfferLetterheadOption, OfferTemplate, OfferTemplateContent, OfferTemplateField, OfferTemplateFile, OfferTemplateHistory } from '../../../../shared/contracts';
import { blocksToMarkup, markupToBlocks, OFFER_FIELD_KEY, OFFER_FIELD_SOURCES, OFFER_FIELD_TYPES, OFFER_MARKUP_HELP, OFFER_SOURCE_LABEL, offerTemplateProblems } from '../../../../shared/offerTemplates';
import { OFFER_UPLOAD_MAX_BYTES, OFFER_UPLOAD_MIME } from '../../../../shared/validation';
import { offerTemplatesApi } from '../../../lib/api/endpoints';
import { errorMessage } from '../../../lib/api/client';
import { ErrorBanner, inputCls, Spinner } from '../../team-member/pipeline/shared';
import { HrEmptyState, HrSectionTitle, hrBtn, hrCard } from '../hrUi';
import { SampleLink } from './OfferLetterGenerator';

/**
 * HR > Offer Letter Generation > Templates (migration 20270206000100). One template per designation, each with its own letterhead, sample
 * document, wording and fields. Every HR staff member sees them; only the Super Admin and the HR Admin Head add a designation or replace a
 * template (the database checks). Saving always makes a new version: new letters use it, letters already issued keep theirs.
 */

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function pdfUrl(base64: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}
const readBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(new Error('The file could not be read.'));
  r.readAsDataURL(file);
});

interface Draft {
  templateId: string | null;
  baseVersion: number;
  designation: string;
  description: string;
  letterhead: OfferLetterhead;
  letterheadFile: OfferTemplateFile | null;
  sampleFile: OfferTemplateFile | null;
  dateLeft: string;
  dateRight: string;
  markup: string;
  fields: OfferTemplateField[];
  note: string;
}

const draftOf = (t: OfferTemplate | null, from?: OfferTemplate): Draft => {
  const src = t ?? from;
  const c: OfferTemplateContent | undefined = src?.current.content;
  return {
    templateId: t?.id ?? null,
    baseVersion: t?.current.version ?? 0,
    designation: t?.designation ?? '',
    description: t?.description ?? '',
    letterhead: src?.current.letterhead ?? { builtin: 'technical-support' },
    letterheadFile: src?.current.letterheadFile ?? null,
    sampleFile: t?.current.sampleFile ?? null,
    dateLeft: c?.dateLine.left ?? '',
    dateRight: c?.dateLine.right ?? 'Date: {letterDate}',
    markup: c ? blocksToMarkup(c.blocks) : '= OFFER LETTER\n\nDear {employeeName},',
    fields: c ? c.fields.map(f => ({ ...f })) : [
      { key: 'letterDate', label: 'Offer date', type: 'date', required: true, source: 'today' },
      { key: 'employeeName', label: 'Employee name', type: 'text', required: true, source: 'employeeName' }
    ],
    note: ''
  };
};
const contentOf = (d: Draft): OfferTemplateContent => ({
  dateLine: { ...(d.dateLeft.trim() ? { left: d.dateLeft.trim() } : {}), right: d.dateRight.trim() },
  blocks: markupToBlocks(d.markup),
  fields: d.fields.map(f => {
    const out: OfferTemplateField = { key: f.key.trim(), label: f.label.trim(), type: f.type, required: f.required };
    if (f.default?.trim()) out.default = f.default.trim();
    if (f.type === 'select') out.options = (f.options ?? []).map(o => o.trim()).filter(Boolean);
    if (f.source) out.source = f.source;
    if (f.help?.trim()) out.help = f.help.trim();
    return out;
  })
});

interface Props { onToast?: (message: string) => void }

export const OfferTemplateManager: React.FC<Props> = ({ onToast }) => {
  const [list, setList] = useState<{ canManage: boolean; templates: OfferTemplate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [letterheads, setLetterheads] = useState<OfferLetterheadOption[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<OfferTemplateHistory | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setList(await offerTemplatesApi.list()); } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); offerTemplatesApi.letterheads().then(setLetterheads).catch(() => setLetterheads([])); }, [load]);

  const open = async (t: OfferTemplate) => {
    setDraft(draftOf(t));
    setHistory(null);
    try { setHistory(await offerTemplatesApi.history(t.id)); } catch { /* the history is optional */ }
  };

  if (error) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!list) return <Spinner label="Loading the templates…" />;

  if (draft) {
    return (
      <TemplateEditor
        key={`${draft.templateId ?? 'new'}-${draft.baseVersion}`}
        initial={draft}
        canManage={list.canManage}
        letterheads={letterheads}
        history={history}
        templates={list.templates}
        onClose={() => { setDraft(null); setHistory(null); }}
        onSaved={async (t, created) => {
          onToast?.(created ? `The ${t.designation} template was added.` : `${t.designation}: version ${t.current.version} saved. New letters use it; issued letters are unchanged.`);
          await load();
          setDraft(draftOf(t));
          try { setHistory(await offerTemplatesApi.history(t.id)); } catch { /* optional */ }
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-slate-600 max-w-3xl">
          One template per designation, made from the sample HR supplied: its letterhead, wording and fields. Saving a change makes a new version; letters already issued never change.
          {!list.canManage && ' Only the Super Admin and the HR Admin Head can add or replace templates.'}
        </p>
        {list.canManage && (
          <button type="button" className={hrBtn.primary} onClick={() => { setDraft(draftOf(null, list.templates[0])); setHistory(null); }}>
            <FilePlus2 className="w-4 h-4" aria-hidden="true" /> Add designation template
          </button>
        )}
      </div>
      {!list.templates.length ? <HrEmptyState icon={FileText} title="No templates yet" /> : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-label="Offer letter templates">
          {list.templates.map(t => (
            <li key={t.id} className={`${hrCard} p-4 flex flex-col`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[15px] font-semibold text-slate-900">{t.designation}</h3>
                <span className="shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-blue-50 text-blue-700">v{t.current.version}</span>
              </div>
              {t.description && <p className="mt-1 text-xs text-slate-500">{t.description}</p>}
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-500">Letterhead</dt>
                <dd className="text-slate-800 truncate">{'builtin' in t.current.letterhead ? letterheads.find(l => l.key === (t.current.letterhead as { builtin: string }).builtin)?.label ?? 'Supplied sample' : t.current.letterheadFile?.fileName ?? 'Uploaded PDF'}</dd>
                <dt className="text-slate-500">Sample</dt>
                <dd className="text-slate-800">{t.current.sampleFile ? <SampleLink fileId={t.current.sampleFile.id} name={t.current.sampleFile.fileName} label={t.current.sampleFile.fileName} /> : <span className="text-slate-400">The supplied sample (built in)</span>}</dd>
                <dt className="text-slate-500">Fields</dt>
                <dd className="text-slate-800">{t.current.content.fields.length}</dd>
                <dt className="text-slate-500">Issued</dt>
                <dd className="text-slate-800">{t.issued} letter{t.issued === 1 ? '' : 's'}</dd>
              </dl>
              <div className="mt-auto pt-3">
                <button type="button" className={`${hrBtn.secondary} w-full`} onClick={() => void open(t)} aria-label={`${list.canManage ? 'Manage' : 'View'} the ${t.designation} template`}>
                  {list.canManage ? 'Manage template' : 'View template'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const TemplateEditor: React.FC<{
  initial: Draft; canManage: boolean; letterheads: OfferLetterheadOption[]; history: OfferTemplateHistory | null; templates: OfferTemplate[];
  onClose: () => void; onSaved: (t: OfferTemplate, created: boolean) => Promise<void>;
}> = ({ initial, canManage, letterheads, history, templates, onClose, onSaved }) => {
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'SAMPLE' | 'LETTERHEAD' | null>(null);
  const [preview, setPreview] = useState<{ url: string | null; busy: boolean; error: string | null }>({ url: null, busy: false, error: null });
  const readOnly = !canManage;
  const isNew = d.templateId === null;
  const content = useMemo(() => contentOf(d), [d]);
  const problems = useMemo(() => offerTemplateProblems(content), [content]);
  const set = (patch: Partial<Draft>) => setD(prev => ({ ...prev, ...patch }));
  const setField = (i: number, patch: Partial<OfferTemplateField>) => setD(prev => ({ ...prev, fields: prev.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  useEffect(() => () => { if (preview.url) URL.revokeObjectURL(preview.url); }, [preview.url]);

  const upload = async (kind: 'SAMPLE' | 'LETTERHEAD', file: File | undefined) => {
    if (!file) return;
    setError(null);
    const isPdf = file.type === OFFER_UPLOAD_MIME.pdf || /\.pdf$/i.test(file.name);
    const isDocx = file.type === OFFER_UPLOAD_MIME.docx || /\.docx$/i.test(file.name);
    if (kind === 'LETTERHEAD' && !isPdf) { setError('A letterhead must be a PDF.'); return; }
    if (!isPdf && !isDocx) { setError('Upload a PDF or a Word (.docx) file.'); return; }
    if (file.size > OFFER_UPLOAD_MAX_BYTES) { setError('The file must be at most 2.5 MB.'); return; }
    setUploading(kind);
    try {
      const f = await offerTemplatesApi.upload({ kind, fileName: file.name, mimeType: isPdf ? OFFER_UPLOAD_MIME.pdf : OFFER_UPLOAD_MIME.docx, dataBase64: await readBase64(file) });
      if (kind === 'SAMPLE') set({ sampleFile: f });
      else set({ letterheadFile: f, letterhead: { fileId: f.id } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(null);
    }
  };
  const showPreview = async () => {
    setPreview(p => ({ ...p, busy: true, error: null }));
    try {
      const r = await offerTemplatesApi.preview({ designation: d.designation || 'Template', content, letterhead: d.letterhead });
      setPreview(p => { if (p.url) URL.revokeObjectURL(p.url); return { url: pdfUrl(r.pdfBase64), busy: false, error: null }; });
    } catch (e) {
      setPreview(p => ({ ...p, busy: false, error: errorMessage(e) }));
    }
  };
  const save = async () => {
    if (saving || problems.length) return;
    setSaving(true);
    setError(null);
    try {
      const body = { designation: d.designation, description: d.description || null, content, letterhead: d.letterhead, sampleFileId: d.sampleFile?.id ?? null, baseVersion: d.baseVersion, note: d.note || null };
      const t = isNew ? await offerTemplatesApi.create(body) : await offerTemplatesApi.save(d.templateId!, body);
      await onSaved(t, isNew);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const loadVersion = async (version: number) => {
    if (!d.templateId) return;
    try {
      const v = await offerTemplatesApi.version(d.templateId, version);
      if (!v.content) return;
      setD(prev => ({
        ...prev, letterhead: v.letterhead, letterheadFile: v.letterheadFile, sampleFile: v.sampleFile, dateLeft: v.content!.dateLine.left ?? '', dateRight: v.content!.dateLine.right,
        markup: blocksToMarkup(v.content!.blocks), fields: v.content!.fields.map(f => ({ ...f })), note: `Restored from version ${version}`
      }));
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={hrBtn.secondary} onClick={onClose}>← All templates</button>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={hrBtn.secondary} onClick={() => void showPreview()} disabled={preview.busy || problems.length > 0}>
            {preview.busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />} Preview template
          </button>
          {canManage && (
            <button type="button" className={hrBtn.primary} onClick={() => void save()} disabled={saving || problems.length > 0}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />} {isNew ? 'Create template' : `Save as version ${d.baseVersion + 1}`}
            </button>
          )}
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {problems.length > 0 && (
        <div role="alert" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          <p className="font-semibold mb-1">Correct these before saving:</p>
          <ul className="list-disc pl-5 space-y-0.5">{problems.map(p => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <section className={`${hrCard} p-4 space-y-3`} aria-labelledby="tpl-basics">
            <HrSectionTitle id="tpl-basics" icon={FileText} title={isNew ? 'New designation template' : `${d.designation} – version ${d.baseVersion}`} />
            {isNew && templates.length > 0 && (
              <div>
                <label htmlFor="tpl-copy" className="block text-xs font-medium text-slate-600 mb-1">Start from</label>
                <select id="tpl-copy" className={inputCls} disabled={readOnly}
                  onChange={e => { const from = templates.find(t => t.id === e.target.value); if (from) setD({ ...draftOf(null, from), designation: d.designation, description: d.description }); }}>
                  <option value="">The first template</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.designation}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">Copies its wording, fields and letterhead. Then change them to follow the new designation's sample.</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="tpl-designation" className="block text-xs font-medium text-slate-600 mb-1">Designation *</label>
                <input id="tpl-designation" className={inputCls} value={d.designation} maxLength={80} disabled={readOnly} onChange={e => set({ designation: e.target.value })} />
              </div>
              <div>
                <label htmlFor="tpl-description" className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input id="tpl-description" className={inputCls} value={d.description} maxLength={300} disabled={readOnly} onChange={e => set({ description: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="tpl-letterhead" className="block text-xs font-medium text-slate-600 mb-1">Letterhead</label>
                <select id="tpl-letterhead" className={inputCls} disabled={readOnly}
                  value={'builtin' in d.letterhead ? d.letterhead.builtin : '__file'}
                  onChange={e => set({ letterhead: e.target.value === '__file' ? (d.letterheadFile ? { fileId: d.letterheadFile.id } : d.letterhead) : { builtin: e.target.value } })}>
                  {letterheads.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                  {d.letterheadFile && <option value="__file">Uploaded: {d.letterheadFile.fileName}</option>}
                </select>
                {canManage && (
                  <label className={`${hrBtn.ghost} mt-1.5 cursor-pointer`}>
                    {uploading === 'LETTERHEAD' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />} Upload a letterhead PDF
                    <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => { void upload('LETTERHEAD', e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                )}
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-600 mb-1">Sample document (the reference for this designation)</span>
                <p className="text-xs text-slate-700 min-h-[36px] flex items-center gap-2">
                  {d.sampleFile ? <><span className="truncate">{d.sampleFile.fileName} ({kb(d.sampleFile.sizeBytes)})</span> <SampleLink fileId={d.sampleFile.id} name={d.sampleFile.fileName} label="View" /></>
                    : <span className="text-slate-400">{isNew ? 'None uploaded yet' : 'The supplied sample (built in)'}</span>}
                </p>
                {canManage && (
                  <label className={`${hrBtn.ghost} mt-1.5 cursor-pointer`}>
                    {uploading === 'SAMPLE' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />} {d.sampleFile ? 'Replace the sample' : 'Upload the sample (PDF or Word)'}
                    <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only"
                      onChange={e => { void upload('SAMPLE', e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-500">An uploaded letterhead is used as the background of every page (its first page); the letter is written between its header and footer.</p>
          </section>

          <section className={`${hrCard} p-4 space-y-3`} aria-labelledby="tpl-fields">
            <HrSectionTitle id="tpl-fields" title="Fields" count={d.fields.length}
              actions={canManage && <button type="button" className={hrBtn.ghost} onClick={() => set({ fields: [...d.fields, { key: `field${d.fields.length + 1}`, label: 'New field', type: 'text', required: true }] })}><Plus className="w-4 h-4" aria-hidden="true" /> Add field</button>} />
            <p className="text-[11px] text-slate-500">Each field is a value HR fills in for each letter. Use it in the wording as {'{key}'}; an amount also gives {'{keyWords}'} (in words).</p>
            <div className="space-y-2">
              {d.fields.map((f, i) => (
                <fieldset key={i} className="rounded-lg border border-slate-200 p-2.5 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end" disabled={readOnly}>
                  <legend className="sr-only">Field {i + 1}</legend>
                  <label className="text-[11px] text-slate-500 sm:col-span-1">Key
                    <input className={`${inputCls} !py-1.5 font-mono text-xs ${OFFER_FIELD_KEY.test(f.key) ? '' : '!border-rose-300'}`} value={f.key} onChange={e => setField(i, { key: e.target.value })} aria-label={`Field ${i + 1} key`} />
                  </label>
                  <label className="text-[11px] text-slate-500 sm:col-span-2">Label
                    <input className={`${inputCls} !py-1.5 text-xs`} value={f.label} onChange={e => setField(i, { label: e.target.value })} aria-label={`Field ${i + 1} label`} />
                  </label>
                  <label className="text-[11px] text-slate-500">Type
                    <select className={`${inputCls} !py-1.5 text-xs`} value={f.type} onChange={e => setField(i, { type: e.target.value as OfferTemplateField['type'] })} aria-label={`Field ${i + 1} type`}>
                      {OFFER_FIELD_TYPES.map(t => <option key={t} value={t}>{t === 'money' ? 'amount (₹)' : t}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] text-slate-500">From the CRM
                    <select className={`${inputCls} !py-1.5 text-xs`} value={f.source ?? ''} onChange={e => setField(i, { source: (e.target.value || undefined) as OfferTemplateField['source'] })} aria-label={`Field ${i + 1} source`}>
                      <option value="">–</option>
                      {OFFER_FIELD_SOURCES.map(s => <option key={s} value={s}>{OFFER_SOURCE_LABEL[s]}</option>)}
                    </select>
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-600 flex items-center gap-1"><input type="checkbox" checked={f.required} onChange={e => setField(i, { required: e.target.checked })} /> Required</label>
                    {canManage && <button type="button" className={`${hrBtn.icon} ml-auto`} onClick={() => set({ fields: d.fields.filter((_, j) => j !== i) })} aria-label={`Remove field ${f.label}`}><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                  <label className="text-[11px] text-slate-500 col-span-2 sm:col-span-3">Starting value (from the sample)
                    <input className={`${inputCls} !py-1.5 text-xs`} value={f.default ?? ''} onChange={e => setField(i, { default: e.target.value })} aria-label={`Field ${i + 1} starting value`} />
                  </label>
                  {f.type === 'select' ? (
                    <label className="text-[11px] text-slate-500 col-span-2 sm:col-span-3">Choices (separated by commas)
                      <input className={`${inputCls} !py-1.5 text-xs`} value={(f.options ?? []).join(', ')} onChange={e => setField(i, { options: e.target.value.split(',') })} aria-label={`Field ${i + 1} choices`} />
                    </label>
                  ) : (
                    <label className="text-[11px] text-slate-500 col-span-2 sm:col-span-3">Help text
                      <input className={`${inputCls} !py-1.5 text-xs`} value={f.help ?? ''} onChange={e => setField(i, { help: e.target.value })} aria-label={`Field ${i + 1} help`} />
                    </label>
                  )}
                </fieldset>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          <section className={`${hrCard} p-4 space-y-3`} aria-labelledby="tpl-wording">
            <HrSectionTitle id="tpl-wording" title="Wording" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600">Top line, left (optional, e.g. a reference)
                <input className={`${inputCls} mt-1`} value={d.dateLeft} disabled={readOnly} onChange={e => set({ dateLeft: e.target.value })} />
              </label>
              <label className="text-xs font-medium text-slate-600">Top line, right
                <input className={`${inputCls} mt-1`} value={d.dateRight} disabled={readOnly} onChange={e => set({ dateRight: e.target.value })} />
              </label>
            </div>
            <label htmlFor="tpl-markup" className="block text-xs font-medium text-slate-600">The letter (as in the sample)</label>
            <textarea id="tpl-markup" className={`${inputCls} font-mono text-xs leading-relaxed min-h-[420px]`} value={d.markup} disabled={readOnly} spellCheck onChange={e => set({ markup: e.target.value })} />
            <details className="text-[11px] text-slate-600">
              <summary className="cursor-pointer font-semibold">How to write the wording</summary>
              <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                {OFFER_MARKUP_HELP.map(([code, what]) => <li key={code}><code className="bg-slate-100 rounded px-1">{code}</code> {what}</li>)}
                <li className="sm:col-span-2">A line right below another one (no empty line between) continues the section without extra space; an empty line starts a new section.</li>
              </ul>
            </details>
            {canManage && (
              <label className="block text-xs font-medium text-slate-600">What changed (kept with the version)
                <input className={`${inputCls} mt-1`} value={d.note} maxLength={200} onChange={e => set({ note: e.target.value })} placeholder="For example: new salary clause from the HR manual" />
              </label>
            )}
          </section>

          {(preview.url || preview.error) && (
            <section className={`${hrCard} p-3 space-y-2`} aria-labelledby="tpl-preview">
              <h3 id="tpl-preview" className="text-[15px] font-bold text-slate-900 flex items-center gap-2"><Eye className="w-4 h-4 text-blue-600" aria-hidden="true" /> Template preview <span className="text-xs font-normal text-slate-500">(each field shows its [label])</span></h3>
              {preview.error && <ErrorBanner message={preview.error} />}
              {preview.url && <iframe title="Template preview" src={preview.url} className="w-full h-[70vh] rounded-lg border border-slate-200" />}
            </section>
          )}

          {history && history.versions.length > 0 && (
            <section className={`${hrCard} p-4 space-y-2`} aria-labelledby="tpl-history">
              <HrSectionTitle id="tpl-history" icon={History} title="Versions" count={history.versions.length} />
              <ul className="divide-y divide-slate-100 text-xs">
                {history.versions.map(v => (
                  <li key={v.version} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <span><strong className="text-slate-900">v{v.version}</strong> · {fmt(v.createdAt)}{v.createdBy ? ` · ${v.createdBy}` : ''}{v.note ? ` · ${v.note}` : ''} · {v.issued ?? 0} issued</span>
                    {canManage && v.version !== d.baseVersion && <button type="button" className={hrBtn.ghost} onClick={() => void loadVersion(v.version)}>Load into the editor</button>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default OfferTemplateManager;
