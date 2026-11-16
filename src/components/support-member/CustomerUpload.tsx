import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS, importTemplate, parseCustomerSheet, type ImportParse } from '../../lib/customerImport';
import { customerApi, useServices } from '../../lib/support';
import { ErrorBanner } from './SupportParts';
import { parseExistingCustomers } from '../../lib/existingCustomerImport';
import { readXlsx } from '../../lib/xlsxReader';
import { importApi, Preview, Saved, type Step } from '../support/ExistingCustomerImport';

const MAX_FILE_BYTES = 1_000_000;
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
/** One row per customer: the Relationship Manager, the client dashboard login and up to 5 services (read by parseExistingCustomers). */
const XLSX_TEMPLATE = '/templates/Customer_Upload_Template.xlsx';

type Skipped = { line: number; name: string; reason: string };

/**
 * Upload many customers at once instead of adding them one by one.
 *  - The Excel template (.xlsx, "Download template"): one row per customer with its Relationship Manager, the client dashboard login and up to
 *    5 services. It goes through the existing-customer import (POST /customers/import-existing): checked first, then saved. The database decides
 *    who may import for whom, puts each customer with the RM named on its row, saves the services with their dates, and the API creates the
 *    client logins (a password typed in the sheet is hashed by Supabase Auth and e-mailed to the client once; it is never stored as text).
 *  - The older CSV (Name, Company, Phone ...): every row is checked like the Add Customer form and saved with the same database function;
 *    duplicates (same phone or e-mail) are refused and reported.
 */
export const CustomerUpload: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const { profile } = useAuth();
  const services = useServices();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ImportParse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ imported: number; skipped: Skipped[] } | null>(null);
  const [excel, setExcel] = useState<Step>({ kind: 'idle' });
  const [checked, setChecked] = useState<Extract<Step, { kind: 'checked' }> | null>(null);

  const ready = parsed?.rows.filter(r => r.input) ?? [];
  const problems = parsed?.rows.filter(r => !r.input) ?? [];

  const choose = async (file: File | undefined) => {
    setResult(null);
    setError(null);
    setParsed(null);
    setExcel({ kind: 'idle' });
    setChecked(null);
    if (!file) return;
    if (/\.xlsx$/i.test(file.name)) {
      if (fileRef.current) fileRef.current.value = '';
      if (file.size > MAX_XLSX_BYTES) return setError('The file is larger than 5 MB. Split it into two files.');
      setExcel({ kind: 'checking' });
      try {
        const sheet = parseExistingCustomers(await readXlsx(file));
        if (!Object.keys(sheet.data).length && !sheet.problems.length) throw new Error('No customers are filled in. Start on the row below the grey example.');
        const res = await importApi(sheet.data, false);
        const step: Extract<Step, { kind: 'checked' }> = { kind: 'checked', file: file.name, parsed: sheet, result: res };
        setChecked(step);
        setExcel(step);
      } catch (e) {
        setExcel({ kind: 'idle' });
        setError(e instanceof Error ? e.message : 'The file could not be read.');
      }
      return;
    }
    if (!/\.(csv|txt)$/i.test(file.name)) return setError('Upload the Excel template (.xlsx) or a .csv file. In Google Sheets choose File > Download > Microsoft Excel (.xlsx).');
    if (file.size > MAX_FILE_BYTES) return setError('The file is too large (up to 1 MB).');
    setFileName(file.name);
    setParsed(parseCustomerSheet(await file.text(), services, profile?.id));
  };

  const saveExcel = async () => {
    if (!checked) return;
    setError(null);
    setExcel({ kind: 'saving' });
    try {
      const res = await importApi(checked.parsed.data, true);
      if (!res.committed) {
        // something changed since the check (for example a colleague added the same customer): show what to fix
        const step = { ...checked, result: res };
        setChecked(step);
        setExcel(step);
        return;
      }
      setExcel({ kind: 'saved', result: res });
    } catch (e) {
      setExcel(checked);
      setError(e instanceof Error ? e.message : 'The customers could not be saved.');
    }
  };
  const resetExcel = () => {
    setExcel({ kind: 'idle' });
    setChecked(null);
    setError(null);
  };

  const downloadCsvTemplate = () => {
    const blob = new Blob(['﻿' + importTemplate(services)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customer-upload-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setProgress(0);
    let imported = 0;
    const skipped: Skipped[] = [];
    try {
      for (const [i, row] of ready.entries()) {
        try {
          await customerApi.create(row.input!);
          imported++;
        } catch (e) {
          skipped.push({ line: row.line, name: row.name, reason: e instanceof Error ? e.message : 'Could not be saved.' });
        }
        setProgress(i + 1);
      }
      setResult({ imported, skipped });
      setParsed(null);
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 space-y-4" aria-labelledby="upload-customers-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="upload-customers-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-blue-600" aria-hidden="true" /> Upload customer details
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
            Add many customers at once. Fill the Excel template: one row per customer (up to 500) with their Relationship Manager, the client dashboard login and
            up to 5 services. Everything is checked before anything is saved.
          </p>
        </div>
        <a
          href={XLSX_TEMPLATE}
          download="Customer_Upload_Template.xlsx"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download template
        </a>
      </div>

      <ul className="text-[11px] text-slate-500 list-disc pl-4 space-y-0.5">
        <li><span className="font-semibold text-slate-700">Required:</span> Relationship Manager (their name as in the CRM), Customer Name, Business Name and Mobile (10 digits). For each service: Service, Start Date and Status.</li>
        <li><span className="font-semibold text-slate-700">Client dashboard login:</span> Client Login E-mail (a different one for every client). Client Password is optional (10+ characters): with it the client is e-mailed their login and that password; without it they get a link to choose their own. The CRM never stores the password as text: delete the column from your sheet after the upload.</li>
        <li>Filled in Google Sheets: File &gt; Download &gt; Microsoft Excel (.xlsx). The older CSV ({IMPORT_COLUMNS.join(', ')}; up to {IMPORT_MAX_ROWS} rows, assigned to you) is still accepted: <button type="button" onClick={downloadCsvTemplate} className="underline font-semibold text-slate-600">CSV template</button>.</li>
      </ul>

      <label className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center cursor-pointer hover:border-blue-400">
        <FileSpreadsheet className="w-6 h-6 text-slate-400" aria-hidden="true" />
        <span className="text-sm font-semibold text-slate-700">{excel.kind === 'checking' ? 'Checking…' : fileName || 'Choose the filled template (.xlsx)'}</span>
        <span className="text-[11px] text-slate-500">.xlsx up to 5 MB, or .csv up to 1 MB</span>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,.txt" className="sr-only" aria-label="Customer sheet (Excel or CSV)" onChange={e => void choose(e.target.files?.[0])} disabled={busy || excel.kind === 'checking' || excel.kind === 'saving'} />
      </label>

      {error && <ErrorBanner message={error} />}
      {(excel.kind === 'checked' || (excel.kind === 'saving' && checked)) && (
        <Preview step={excel.kind === 'checked' ? excel : checked!} saving={excel.kind === 'saving'} onSave={() => void saveExcel()} onReset={resetExcel} />
      )}
      {excel.kind === 'saved' && <Saved result={excel.result} onReset={resetExcel} onDone={onDone} />}
      {parsed?.fileError && <ErrorBanner message={parsed.fileError} />}

      {parsed && !parsed.fileError && (
        <div className="space-y-3">
          <p className="text-sm text-slate-800" role="status">
            <span className="font-bold text-emerald-700">{ready.length} ready</span>
            {problems.length > 0 && <span className="font-bold text-rose-700"> · {problems.length} with problems (they will not be uploaded)</span>}
          </p>
          {problems.length > 0 && (
            <ul className="rounded-xl border border-rose-200 bg-rose-50 divide-y divide-rose-100 text-xs" aria-label="Rows with problems">
              {problems.slice(0, 20).map(r => (
                <li key={r.line} className="px-3 py-2 text-rose-900">
                  <strong>Row {r.line}</strong> ({r.name}): {r.errors.join(' ')}
                </li>
              ))}
              {problems.length > 20 && <li className="px-3 py-2 text-rose-900">… and {problems.length - 20} more rows with problems.</li>}
            </ul>
          )}
          {ready.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs">
                <caption className="sr-only">First rows that will be uploaded</caption>
                <thead className="bg-slate-50 text-slate-500 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Row</th>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Company</th>
                    <th className="px-3 py-2 font-semibold">Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ready.slice(0, 5).map(r => (
                    <tr key={r.line}>
                      <td className="px-3 py-1.5 text-slate-500">{r.line}</td>
                      <td className="px-3 py-1.5 font-semibold text-slate-900">{r.input!.name}</td>
                      <td className="px-3 py-1.5 text-slate-700">{r.input!.company || '-'}</td>
                      <td className="px-3 py-1.5 text-slate-700">{r.contact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ready.length > 5 && <p className="px-3 py-1.5 text-[11px] text-slate-500 border-t border-slate-100">… and {ready.length - 5} more.</p>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || ready.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? `Uploading ${progress} of ${ready.length}…` : `Upload ${ready.length} customer${ready.length === 1 ? '' : 's'}`}
            </button>
            {problems.length > 0 && !busy && <span className="text-[11px] text-slate-500">Fix the rows in your sheet and upload it again to add them.</span>}
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2" role="status">
          <p className="flex items-center gap-2 text-sm font-bold text-emerald-700">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {result.imported} customer{result.imported === 1 ? '' : 's'} added.
          </p>
          {result.skipped.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
              <p className="px-3 py-2 font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> {result.skipped.length} not added
              </p>
              <ul className="divide-y divide-amber-100 border-t border-amber-100">
                {result.skipped.slice(0, 30).map(s => (
                  <li key={s.line} className="px-3 py-1.5">
                    <strong>Row {s.line}</strong> ({s.name}): {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {onDone && (
            <button type="button" onClick={onDone} className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50">
              Go to the customer list
            </button>
          )}
        </div>
      )}
    </section>
  );
};
