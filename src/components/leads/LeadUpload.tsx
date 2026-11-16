import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Download, FileSpreadsheet, History, RefreshCw, Upload, XCircle } from 'lucide-react';
import type { LeadUploadBatch, LeadUploadCheckResult, LeadUploadIssues, LeadUploadRawRow } from '../../../shared/contracts';
import { LEAD_UPLOAD_COLUMNS, matchLeadUploadHeadings, type LeadUploadField } from '../../../shared/leadUpload';
import { LEAD_UPLOAD_CHUNK_ROWS, LEAD_UPLOAD_MAX_ROWS } from '../../../shared/validation';
import { useAuth } from '../../context/AuthContext';
import { canUploadLeads } from '../../lib/auth/roleMapping';
import { errorMessage } from '../../lib/api/client';
import { leadUploadApi } from '../../lib/api/endpoints';
import { readCsv } from '../../lib/csvReader';
import { cellText, sha256Hex } from '../../lib/telecallerSheet';
import { readXlsx, type Cell } from '../../lib/xlsxReader';
import { saveBlob, toCsv, writeXlsx } from '../../lib/xlsxWriter';
import { btn, Dialog, ErrorBanner, selectCls, Spinner, useServiceCatalog } from '../team-member/pipeline/shared';

/**
 * Upload Leads (docs/LEAD_UPLOAD.md): the button that sits beside "Add Lead" in the Lead section of every Sales dashboard, and the upload window.
 * The file is read here; the API and the database check every row again (Add Lead rules, duplicates, who may own the lead) and create each lead
 * with the Add Lead function. Nothing is saved before "Import".
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TEMPLATE_HEADINGS = LEAD_UPLOAD_COLUMNS.map(c => c.label);
const TEMPLATE_EXAMPLE = LEAD_UPLOAD_COLUMNS.map(c => c.example);
const TEMPLATE_WIDTHS = [22, 20, 16, 26, 24, 18, 14, 24, 14, 32, 16, 28];
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0').slice(-12));

/** Visible to Sales employees only; the button keeps the size and shape of the Add Lead button beside it. */
export const UploadLeadsButton: React.FC<{ className?: string; onUploaded: () => void }> = ({ className, onUploaded }) => {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  if (!profile || !canUploadLeads(profile)) return null;
  return (
    <>
      <button type="button" className={className ?? uploadBtnCls} onClick={() => setOpen(true)}>
        <Upload className="w-4 h-4" aria-hidden="true" /> Upload Leads
      </button>
      {open && <LeadUploadDialog onClose={() => setOpen(false)} onUploaded={onUploaded} />}
    </>
  );
};
/** The outline twin of the Pipeline "Add lead" button (same padding, corners and text size). */
export const uploadBtnCls =
  'inline-flex items-center justify-center gap-1.5 px-4 py-[9px] rounded-xl border border-indigo-200 bg-white text-indigo-700 text-xs font-bold hover:bg-indigo-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 transition-colors';

type Mapping = Partial<Record<LeadUploadField, number>>;
interface ReadFile {
  name: string;
  type: 'XLSX' | 'CSV';
  hash: string;
  headings: string[];
  body: { row: number; cells: Cell[] }[];
  skippedExample: boolean;
}
type Step =
  | { kind: 'pick' }
  | { kind: 'reading' }
  | { kind: 'mapped'; file: ReadFile }
  | { kind: 'checking'; file: ReadFile }
  | { kind: 'checked'; file: ReadFile; rows: LeadUploadRawRow[]; check: LeadUploadCheckResult }
  | { kind: 'importing'; file: ReadFile; rows: LeadUploadRawRow[]; check: LeadUploadCheckResult; done: number; batch?: LeadUploadBatch }
  | { kind: 'done'; batch: LeadUploadBatch };

async function readFile(file: File): Promise<ReadFile> {
  const lower = file.name.toLowerCase();
  const type = lower.endsWith('.xlsx') ? 'XLSX' : lower.endsWith('.csv') ? 'CSV' : null;
  if (!type) throw new Error('Choose an Excel (.xlsx) or CSV (.csv) file. Older .xls files: open them in Excel and save as .xlsx.');
  if (file.size === 0) throw new Error('The file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error('The file is larger than 5 MB. Split it into smaller files.');
  const bytes = await file.arrayBuffer();
  const book = type === 'XLSX' ? await readXlsx(new Blob([bytes])) : readCsv(bytes);
  // the first sheet that has something in it
  const sheet = book.sheets.find(s => s.rows.some(r => r.some(c => cellText(c) !== '')));
  if (!sheet) throw new Error('The file is empty.');
  const headerIndex = sheet.rows.findIndex(r => r.some(c => cellText(c) !== ''));
  const headings = sheet.rows[headerIndex].map(c => cellText(c));
  let skippedExample = false;
  const body = sheet.rows
    .slice(headerIndex + 1)
    .map((cells, i) => ({ row: headerIndex + i + 2, cells: cells ?? [] }))
    .filter(r => r.cells.some(c => cellText(c) !== ''))
    .filter(r => {
      // the example row of our own template is never imported
      const isExample = TEMPLATE_EXAMPLE.every((v, i) => cellText(r.cells[i] ?? null) === v);
      if (isExample) skippedExample = true;
      return !isExample;
    });
  if (body.length === 0) throw new Error('The file has no lead rows below the headings.');
  if (body.length > LEAD_UPLOAD_MAX_ROWS) {
    throw new Error(`A file can have at most ${LEAD_UPLOAD_MAX_ROWS.toLocaleString('en-IN')} leads; this one has ${body.length.toLocaleString('en-IN')}. Split it into smaller files.`);
  }
  return { name: file.name, type, hash: await sha256Hex(bytes), headings, body, skippedExample };
}

function buildRows(file: ReadFile, mapping: Mapping): LeadUploadRawRow[] {
  const get = (cells: Cell[], k: LeadUploadField) => (mapping[k] === undefined ? '' : cellText(cells[mapping[k]!] ?? null));
  return file.body.map(({ row, cells }) => {
    const out = { row } as LeadUploadRawRow;
    for (const c of LEAD_UPLOAD_COLUMNS) out[c.key] = get(cells, c.key);
    return out;
  });
}

/** The rows that were not created, as a sheet that can be fixed and uploaded again (the template's columns first, then the reason). */
function problemSheet(rows: { row: number; outcome: string; message: string | null; data: Partial<LeadUploadRawRow> }[]): string[][] {
  return [
    [...TEMPLATE_HEADINGS, 'File Row', 'Upload Result', 'Problem'],
    ...rows.map(r => [...LEAD_UPLOAD_COLUMNS.map(c => String(r.data[c.key] ?? '')), String(r.row), OUTCOME_LABEL[r.outcome] ?? r.outcome, r.message ?? ''])
  ];
}
const OUTCOME_LABEL: Record<string, string> = { NEW: 'New lead', CREATED: 'Created', DUPLICATE: 'Duplicate', INVALID: 'Invalid', FAILED: 'Failed' };
const baseName = (name: string) => name.replace(/\.(xlsx|csv)$/i, '').slice(0, 80) || 'leads';

async function downloadProblems(fileName: string, rows: Parameters<typeof problemSheet>[0], format: 'XLSX' | 'CSV') {
  const sheet = problemSheet(rows);
  const name = `${baseName(fileName)} - rows to fix.${format === 'XLSX' ? 'xlsx' : 'csv'}`;
  saveBlob(format === 'XLSX' ? await writeXlsx('Rows to fix', sheet, [...TEMPLATE_WIDTHS, 10, 14, 60]) : toCsv(sheet), name);
}

export const LeadUploadDialog: React.FC<{ onClose: () => void; onUploaded: () => void }> = ({ onClose, onUploaded }) => {
  const { profile } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [mapping, setMapping] = useState<Mapping>({});
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // one id per chosen file: a double click or a retried request never starts a second upload of it
  const requestId = useRef(newRequestId());
  const busy = step.kind === 'reading' || step.kind === 'checking' || step.kind === 'importing';

  const pick = async (file: File | undefined) => {
    if (!file || busy) return;
    setError(null);
    setStep({ kind: 'reading' });
    try {
      const read = await readFile(file);
      requestId.current = newRequestId();
      const m = matchLeadUploadHeadings(read.headings);
      setMapping(m);
      setStep({ kind: 'mapped', file: read });
      if (missingRequired(m).length === 0) void check(read, m);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
      setStep({ kind: 'pick' });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const check = async (file: ReadFile, m: Mapping) => {
    setError(null);
    setStep({ kind: 'checking', file });
    const rows = buildRows(file, m);
    try {
      setStep({ kind: 'checked', file, rows, check: await leadUploadApi.check(rows) });
    } catch (e) {
      setError(errorMessage(e));
      setStep({ kind: 'mapped', file });
    }
  };

  const runImport = async (file: ReadFile, rows: LeadUploadRawRow[], checkResult: LeadUploadCheckResult) => {
    setError(null);
    let done = 0;
    setStep({ kind: 'importing', file, rows, check: checkResult, done });
    try {
      let batch = await leadUploadApi.start({ clientRequestId: requestId.current, fileName: file.name, fileType: file.type, fileHash: file.hash, totalRows: rows.length });
      for (let i = 0; i < rows.length; i += LEAD_UPLOAD_CHUNK_ROWS) {
        const chunk = rows.slice(i, i + LEAD_UPLOAD_CHUNK_ROWS);
        // a chunk that did not get through is sent again (the database creates nothing twice); after three tries the upload can be resumed
        let attempt = 0;
        for (;;) {
          try {
            batch = (await leadUploadApi.rows(batch.id, chunk)).batch;
            break;
          } catch (e) {
            if (++attempt >= 3) throw e;
            await new Promise(r => setTimeout(r, 800 * attempt));
          }
        }
        done = Math.min(rows.length, i + chunk.length);
        setStep({ kind: 'importing', file, rows, check: checkResult, done, batch });
      }
      batch = await leadUploadApi.finish(batch.id);
      setStep({ kind: 'done', batch });
      onUploaded();
    } catch (e) {
      setError(`${errorMessage(e)} ${done > 0 ? `${done.toLocaleString('en-IN')} rows were processed. Press Import again to continue: rows already done are not imported twice.` : ''}`.trim());
      setStep({ kind: 'checked', file, rows, check: checkResult });
      if (done > 0) onUploaded();
    }
  };

  const reset = () => {
    setError(null);
    setStep({ kind: 'pick' });
  };

  const isHead = profile?.role === 'TEAM_HEAD' || profile?.role === 'DEPARTMENT_HEAD';
  return (
    <Dialog
      title="Upload Leads"
      description="Add many leads at once from an Excel or CSV file. Each row is checked with the same rules as Add Lead; nothing is saved until you press Import."
      onClose={busy ? () => undefined : onClose}
      wide
      persistent
    >
      {error && <ErrorBanner message={error} />}

      {(step.kind === 'pick' || step.kind === 'reading') && (
        <>
          <Templates isHead={isHead} />
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); void pick(e.dataTransfer.files?.[0]); }}
            className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-slate-50/60'}`}
          >
            {step.kind === 'reading' ? (
              <Spinner label="Reading the file…" />
            ) : (
              <>
                <FileSpreadsheet className="w-8 h-8 mx-auto text-indigo-500" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-slate-800">Drag and drop your file here</p>
                <p className="text-xs text-slate-500 mt-1">Excel (.xlsx) or CSV (.csv), up to {LEAD_UPLOAD_MAX_ROWS.toLocaleString('en-IN')} leads and 5 MB</p>
                <button type="button" className={`${btn.primary} mt-3`} onClick={() => input.current?.click()}>
                  <Upload className="w-4 h-4" aria-hidden="true" /> Browse Files
                </button>
              </>
            )}
            <input ref={input} type="file" className="sr-only" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Lead file to upload" onChange={e => void pick(e.target.files?.[0])} />
          </div>
          <UploadHistory />
          <div className="flex justify-end"><button type="button" className={btn.secondary} onClick={onClose}>Close</button></div>
        </>
      )}

      {(step.kind === 'mapped' || step.kind === 'checking' || step.kind === 'checked' || step.kind === 'importing') && (
        <>
          <FileBar file={step.file} onChange={step.kind === 'importing' ? undefined : reset} />
          <ColumnMapping
            headings={step.file.headings}
            mapping={mapping}
            disabled={step.kind === 'checking' || step.kind === 'importing'}
            onChange={m => { setMapping(m); requestId.current = newRequestId(); setStep({ kind: 'mapped', file: step.file }); }}
          />
          {step.kind === 'mapped' && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {missingRequired(mapping).length > 0 && <p className="text-xs text-rose-700 mr-auto">Choose the column for: {missingRequired(mapping).join(', ')}.</p>}
              <button type="button" className={btn.secondary} onClick={reset}>Choose another file</button>
              <button type="button" className={btn.primary} disabled={missingRequired(mapping).length > 0} onClick={() => void check(step.file, mapping)}>
                Check {step.file.body.length.toLocaleString('en-IN')} rows
              </button>
            </div>
          )}
          {step.kind === 'checking' && <Spinner label={`Checking ${step.file.body.length.toLocaleString('en-IN')} rows…`} />}
          {(step.kind === 'checked' || step.kind === 'importing') && (
            <Preview
              file={step.file}
              rows={step.rows}
              check={step.check}
              importing={step.kind === 'importing' ? { done: step.done, total: step.rows.length } : null}
              onReupload={reset}
              onImport={() => void runImport(step.file, step.rows, step.check)}
            />
          )}
        </>
      )}

      {step.kind === 'done' && <Summary batch={step.batch} onAnother={reset} onClose={onClose} />}
    </Dialog>
  );
};

const missingRequired = (m: Mapping) => LEAD_UPLOAD_COLUMNS.filter(c => c.required && m[c.key] === undefined).map(c => c.label);

const Templates: React.FC<{ isHead: boolean }> = ({ isHead }) => {
  const { items: services } = useServiceCatalog();
  const [busy, setBusy] = useState(false);
  const xlsx = async () => {
    setBusy(true);
    try {
      saveBlob(await writeXlsx('Leads', [TEMPLATE_HEADINGS, TEMPLATE_EXAMPLE], TEMPLATE_WIDTHS), 'Lead upload template.xlsx');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">1. Download a sample template</div>
          <p className="text-xs text-slate-500 mt-0.5">One lead per row. The example row is ignored when you upload.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.secondary} onClick={() => void xlsx()} disabled={busy}>
            <Download className="w-4 h-4" aria-hidden="true" /> Sample Excel Template
          </button>
          <button type="button" className={btn.secondary} onClick={() => saveBlob(toCsv([TEMPLATE_HEADINGS, TEMPLATE_EXAMPLE]), 'Lead upload template.csv')}>
            <Download className="w-4 h-4" aria-hidden="true" /> Sample CSV Template
          </button>
        </div>
      </div>
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">The columns and what goes in them</summary>
        <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1">
          {LEAD_UPLOAD_COLUMNS.map(c => (
            <li key={c.key}>
              <strong className="text-slate-800">{c.label}</strong>
              {c.required && <span className="text-rose-600"> *</span>}
              {c.key === 'assignee'
                ? ` — ${isHead ? 'the e-mail of the employee the lead is for (only people you may already assign leads to); empty = you' : 'leave empty: the leads are yours'}`
                : c.hint && ` — ${c.hint}`}
            </li>
          ))}
        </ul>
        {services.length > 0 && <p className="mt-2"><strong className="text-slate-800">Services:</strong> {services.map(s => s.name).join(' · ')}</p>}
        <p className="mt-2">Duplicates (a mobile number or e-mail already in the CRM, or twice in the file) are shown separately and are never imported; the existing record is not changed.</p>
      </details>
    </div>
  );
};

const FileBar: React.FC<{ file: ReadFile; onChange?: () => void }> = ({ file, onChange }) => (
  <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
    <FileSpreadsheet className="w-5 h-5 text-indigo-600 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <div className="text-sm font-semibold text-slate-900 truncate">{file.name}</div>
      <div className="text-[11px] text-slate-500">
        {file.body.length.toLocaleString('en-IN')} record{file.body.length === 1 ? '' : 's'} detected{file.skippedExample ? ' (the template example row was skipped)' : ''}
      </div>
    </div>
    {onChange && <button type="button" className={btn.secondary} onClick={onChange}>Choose another file</button>}
  </div>
);

const ColumnMapping: React.FC<{ headings: string[]; mapping: Mapping; disabled: boolean; onChange: (m: Mapping) => void }> = ({ headings, mapping, disabled, onChange }) => (
  <details className="rounded-xl border border-slate-200 px-3 py-2" open={LEAD_UPLOAD_COLUMNS.some(c => c.required && mapping[c.key] === undefined)}>
    <summary className="cursor-pointer text-xs font-semibold text-slate-700">
      Columns: {LEAD_UPLOAD_COLUMNS.filter(c => mapping[c.key] !== undefined).length} of {LEAD_UPLOAD_COLUMNS.length} matched (change if a column was matched wrongly)
    </summary>
    <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {LEAD_UPLOAD_COLUMNS.map(c => (
        <label key={c.key} className="text-[11px] font-semibold text-slate-600 space-y-1 block">
          <span>{c.label}{c.required && <span className="text-rose-600"> *</span>}</span>
          <select
            className={`${selectCls} w-full`}
            value={mapping[c.key] ?? ''}
            disabled={disabled}
            onChange={e => {
              const next = { ...mapping };
              if (e.target.value === '') delete next[c.key];
              else next[c.key] = Number(e.target.value);
              onChange(next);
            }}
          >
            <option value="">Not in the file</option>
            {headings.map((h, i) => (h ? <option key={i} value={i}>{h}</option> : null))}
          </select>
        </label>
      ))}
    </div>
  </details>
);

type PreviewTab = 'ALL' | 'NEW' | 'DUPLICATE' | 'INVALID';
const TAB_LABEL: Record<PreviewTab, string> = { ALL: 'All records', NEW: 'New leads', DUPLICATE: 'Duplicate leads', INVALID: 'Invalid leads' };
const OUTCOME_TONE: Record<string, string> = {
  NEW: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DUPLICATE: 'bg-amber-50 text-amber-800 border-amber-200',
  INVALID: 'bg-rose-50 text-rose-700 border-rose-200'
};
const PAGE = 100;

const Preview: React.FC<{
  file: ReadFile;
  rows: LeadUploadRawRow[];
  check: LeadUploadCheckResult;
  importing: { done: number; total: number } | null;
  onReupload: () => void;
  onImport: () => void;
}> = ({ file, rows, check, importing, onReupload, onImport }) => {
  const [tab, setTab] = useState<PreviewTab>('ALL');
  const [shown, setShown] = useState(PAGE);
  const byRow = useMemo(() => new Map(check.rows.map(r => [r.row, r])), [check]);
  const list = useMemo(() => rows.filter(r => tab === 'ALL' || byRow.get(r.row)?.outcome === tab), [rows, byRow, tab]);
  useEffect(() => setShown(PAGE), [tab]);
  const counts: Record<PreviewTab, number> = { ALL: check.summary.total, NEW: check.summary.new, DUPLICATE: check.summary.duplicates, INVALID: check.summary.invalid };
  const problems = rows
    .filter(r => byRow.get(r.row)?.outcome !== 'NEW')
    .map(r => ({ row: r.row, outcome: byRow.get(r.row)?.outcome ?? 'INVALID', message: byRow.get(r.row)?.message ?? null, data: r }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Records detected" value={check.summary.total} />
        <Stat label="New leads" value={check.summary.new} tone="text-emerald-700" />
        <Stat label="Duplicates" value={check.summary.duplicates} tone="text-amber-700" />
        <Stat label="Invalid" value={check.summary.invalid} tone="text-rose-700" />
      </div>

      <div role="tablist" aria-label="Preview filter" className="flex flex-wrap gap-1.5">
        {(Object.keys(TAB_LABEL) as PreviewTab[]).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${tab === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
            {TAB_LABEL[t]} <span className="opacity-80">({counts[t].toLocaleString('en-IN')})</span>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="max-h-[40vh] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium w-14">Row</th>
                <th scope="col" className="px-3 py-2 font-medium">Customer</th>
                <th scope="col" className="px-3 py-2 font-medium hidden md:table-cell">Company</th>
                <th scope="col" className="px-3 py-2 font-medium hidden lg:table-cell">Service</th>
                <th scope="col" className="px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.slice(0, shown).map(r => {
                const res = byRow.get(r.row);
                return (
                  <tr key={r.row} className="align-top">
                    <td className="px-3 py-2 text-slate-500 tabular-nums">{r.row}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-800 break-words">{r.name || '—'}</div>
                      <div className="text-slate-500">{r.phone || 'no mobile'}{r.email ? ` · ${r.email}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-700 hidden md:table-cell break-words">{r.company || '—'}</td>
                    <td className="px-3 py-2 text-slate-700 hidden lg:table-cell break-words">{r.services || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${OUTCOME_TONE[res?.outcome ?? 'INVALID']}`}>
                        {OUTCOME_LABEL[res?.outcome ?? 'INVALID']}
                      </span>
                      {res?.outcome === 'NEW' && res.ownerName && <div className="text-[11px] text-slate-500 mt-1">Owner: {res.ownerName}</div>}
                      {res?.message && <div className={`text-[11px] mt-1 ${res.outcome === 'DUPLICATE' ? 'text-amber-800' : 'text-rose-700'}`}>{res.message}</div>}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No {TAB_LABEL[tab].toLowerCase()} in this file.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {list.length > shown && (
          <div className="border-t border-slate-100 p-2 text-center">
            <button type="button" className={btn.secondary} onClick={() => setShown(s => s + PAGE)}>Show more ({(list.length - shown).toLocaleString('en-IN')} left)</button>
          </div>
        )}
      </div>

      {importing && (
        <div role="status" aria-live="polite" className="space-y-1">
          <div className="flex justify-between text-xs text-slate-600"><span>Importing…</span><span className="tabular-nums">{importing.done.toLocaleString('en-IN')} / {importing.total.toLocaleString('en-IN')} rows</span></div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round((importing.done / importing.total) * 100)}%` }} /></div>
          <p className="text-[11px] text-slate-500">Keep this window open until the import finishes.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {problems.length > 0 && (
          <>
            <span className="text-xs text-slate-600 mr-auto">Fix the {problems.length.toLocaleString('en-IN')} row{problems.length === 1 ? '' : 's'} with problems in your file and upload it again, or import the new leads now.</span>
            <button type="button" className={btn.secondary} disabled={!!importing} onClick={() => void downloadProblems(file.name, problems, file.type)}>
              <Download className="w-4 h-4" aria-hidden="true" /> Download rows with problems
            </button>
          </>
        )}
        <button type="button" className={btn.secondary} disabled={!!importing} onClick={onReupload}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Upload a corrected file</button>
        <button type="button" className={btn.primary} disabled={!!importing || check.summary.new === 0} onClick={onImport}>
          {importing ? 'Importing…' : `Import ${check.summary.new.toLocaleString('en-IN')} new lead${check.summary.new === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; tone?: string }> = ({ label, value, tone = 'text-slate-900' }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className={`text-lg font-extrabold tabular-nums ${tone}`}>{value.toLocaleString('en-IN')}</div>
  </div>
);

const Summary: React.FC<{ batch: LeadUploadBatch; onAnother: () => void; onClose: () => void }> = ({ batch, onAnother, onClose }) => {
  const notCreated = batch.duplicates + batch.invalid + batch.failed;
  return (
    <div className="space-y-4">
      <div role="status" className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
        <div className="text-sm text-emerald-900">
          <strong>Upload finished.</strong> {batch.created.toLocaleString('en-IN')} lead{batch.created === 1 ? ' was' : 's were'} added to the Lead section.
          <div className="text-[11px] text-emerald-800 mt-0.5">Upload Batch ID: <span className="font-mono">{batch.id}</span></div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Total records uploaded" value={batch.totalRows} />
        <Stat label="Leads created" value={batch.created} tone="text-emerald-700" />
        <Stat label="Duplicate leads" value={batch.duplicates} tone="text-amber-700" />
        <Stat label="Failed records" value={batch.failed} tone="text-rose-700" />
        <Stat label="Invalid records" value={batch.invalid} tone="text-rose-700" />
      </div>
      {notCreated > 0 && <ProblemDownloads batch={batch} />}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onAnother}><Upload className="w-4 h-4" aria-hidden="true" /> Upload another file</button>
        <button type="button" className={btn.primary} onClick={onClose}>Done</button>
      </div>
    </div>
  );
};

/** Download the rows of an upload that were not created (duplicates, invalid, failed), with the reason, as Excel or CSV. */
const ProblemDownloads: React.FC<{ batch: LeadUploadBatch; compact?: boolean }> = ({ batch, compact }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const get = async (format: 'XLSX' | 'CSV') => {
    setBusy(true);
    setError(null);
    try {
      const issues: LeadUploadIssues = await leadUploadApi.issues(batch.id);
      await downloadProblems(batch.fileName, issues.rows, format);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'rounded-xl border border-slate-200 p-3 space-y-2'}>
      {!compact && <p className="text-xs text-slate-700">Download the {(batch.duplicates + batch.invalid + batch.failed).toLocaleString('en-IN')} records that were not created, with the reason for each. Fix them and upload the file again.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.secondary} disabled={busy} onClick={() => void get('XLSX')}><Download className="w-4 h-4" aria-hidden="true" /> {compact ? 'Excel' : 'Failed records (Excel)'}</button>
        <button type="button" className={btn.secondary} disabled={busy} onClick={() => void get('CSV')}><Download className="w-4 h-4" aria-hidden="true" /> {compact ? 'CSV' : 'Failed records (CSV)'}</button>
      </div>
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>
  );
};

const STATUS_LABEL: Record<LeadUploadBatch['status'], { label: string; icon: React.ReactNode }> = {
  COMPLETED: { label: 'Completed', icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" /> },
  PROCESSING: { label: 'Not finished', icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" /> },
  INTERRUPTED: { label: 'Interrupted', icon: <XCircle className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" /> }
};

const UploadHistory: React.FC = () => {
  const [items, setItems] = useState<LeadUploadBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    leadUploadApi.history().then(setItems, e => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!items || items.length === 0) return null;
  return (
    <details className="rounded-2xl border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-bold text-slate-900 inline-flex items-center gap-2"><History className="w-4 h-4" aria-hidden="true" /> Your previous uploads ({items.length})</summary>
      <ul className="mt-3 divide-y divide-slate-100">
        {items.map(b => (
          <li key={b.id} className="py-2 flex flex-col md:flex-row md:items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-800 truncate">{b.fileName}</div>
              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                <span>{new Date(b.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span className="inline-flex items-center gap-1">{STATUS_LABEL[b.status].icon} {STATUS_LABEL[b.status].label}</span>
                <span>{b.totalRows} rows · {b.created} created · {b.duplicates} duplicate · {b.invalid} invalid · {b.failed} failed</span>
                <button type="button" className="inline-flex items-center gap-1 text-indigo-700 hover:underline" onClick={() => void navigator.clipboard?.writeText(b.id)} title="Copy the Upload Batch ID">
                  <Copy className="w-3 h-3" aria-hidden="true" /> Batch ID
                </button>
              </div>
            </div>
            {b.duplicates + b.invalid + b.failed > 0 && <ProblemDownloads batch={b} compact />}
          </li>
        ))}
      </ul>
    </details>
  );
};
