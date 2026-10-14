import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS, importTemplate, parseCustomerSheet, type ImportParse } from '../../lib/customerImport';
import { customerApi, useServices } from '../../lib/support';
import { ErrorBanner } from './SupportParts';

const MAX_FILE_BYTES = 1_000_000;

type Skipped = { line: number; name: string; reason: string };

/**
 * Upload many customers at once (a CSV sheet) instead of adding them one by one. Every row is checked
 * with the same rules as the Add Customer form, then saved with the same database function, so
 * duplicates (same phone or e-mail) are refused and reported. The customers then appear in the list
 * and wherever the customer data is used (for example the client dashboard).
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

  const ready = parsed?.rows.filter(r => r.input) ?? [];
  const problems = parsed?.rows.filter(r => !r.input) ?? [];

  const choose = async (file: File | undefined) => {
    setResult(null);
    setError(null);
    setParsed(null);
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) return setError('Upload a .csv file. In Excel or Google Sheets choose File > Save as / Download > CSV.');
    if (file.size > MAX_FILE_BYTES) return setError('The file is too large (up to 1 MB).');
    setFileName(file.name);
    setParsed(parseCustomerSheet(await file.text(), services, profile?.id));
  };

  const downloadTemplate = () => {
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
            Add many customers at once instead of one by one. Fill the template (one customer per row, up to {IMPORT_MAX_ROWS}), save it as CSV and upload it. Each row is checked like the form above;
            a customer whose phone or e-mail already exists is skipped.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download template
        </button>
      </div>

      <p className="text-[11px] text-slate-500">
        Columns: <span className="font-semibold text-slate-700">{IMPORT_COLUMNS.join(', ')}</span>. Only Name and a phone or e-mail are required. Type: Retail, Wholesale, Corporate or Other. Status: Active, Inactive or
        Prospect. Service: a service name (several separated by ;).
      </p>

      <label className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center cursor-pointer hover:border-blue-400">
        <FileSpreadsheet className="w-6 h-6 text-slate-400" aria-hidden="true" />
        <span className="text-sm font-semibold text-slate-700">{fileName || 'Choose a CSV file'}</span>
        <span className="text-[11px] text-slate-500">.csv, up to 1 MB</span>
        <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" className="sr-only" aria-label="Customer sheet (CSV)" onChange={e => void choose(e.target.files?.[0])} disabled={busy} />
      </label>

      {error && <ErrorBanner message={error} />}
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
