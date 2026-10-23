import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import type { TelecallerAssignee, TelecallerSheet, TelecallerSheetCheck } from '../../../shared/contracts';
import { TELECALLER_SHEET_MAX_BYTES } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { telecallerApi } from '../../lib/api/endpoints';
import { parseContactSheet, sha256Hex, SHEET_COLUMNS, toBase64, type SheetRow } from '../../lib/telecallerSheet';
import { readXlsx } from '../../lib/xlsxReader';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { EmptyState, dateText, tcBtn, tcInput } from './ui';

const XLSX_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', ''];

interface Picked {
  fileName: string;
  hash: string;
  bytes: ArrayBuffer;
  sheetName: string;
  rows: SheetRow[];
  skipped: number;
  check: TelecallerSheetCheck;
}

/**
 * Department Head: assign an Excel contact sheet to a Telecaller. The file is read in the browser, every row is checked by the database
 * (nothing is saved while a row is wrong), the Department Head sees a preview and confirms, and only then are the contacts assigned and the
 * original file stored.
 */
export const ContactSheets: React.FC = () => {
  const [assignees, setAssignees] = useState<TelecallerAssignee[] | null>(null);
  const [sheets, setSheets] = useState<TelecallerSheet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([telecallerApi.assignable(), telecallerApi.lists()]).then(
      ([a, s]) => (setAssignees(a), setSheets(s)),
      err => (setError(errorMessage(err)), setAssignees(a => a ?? []))
    );
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (assignees && assignees.length === 1 && !assigneeId) setAssigneeId(assignees[0].id);
  }, [assignees, assigneeId]);

  const reset = () => {
    setPicked(null);
    setProblem(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const onFile = async (file: File | undefined) => {
    setDone(null);
    setProblem(null);
    setPicked(null);
    if (!file) return;
    if (!assigneeId) return setProblem('Choose the Telecaller first.');
    if (!/\.xlsx$/i.test(file.name) || !XLSX_TYPES.includes(file.type)) return setProblem('Choose an Excel (.xlsx) file.');
    if (file.size > TELECALLER_SHEET_MAX_BYTES) return setProblem(`The file is too large (${Math.round(TELECALLER_SHEET_MAX_BYTES / 1024)} KB at most).`);
    if (file.size === 0) return setProblem('The file is empty.');
    setReading(true);
    try {
      const bytes = await file.arrayBuffer();
      const book = await readXlsx(new Blob([bytes]));
      const sheet = book.sheets[0];
      if (!sheet) return setProblem('The workbook has no sheets.');
      const parsed = parseContactSheet(sheet.rows);
      if (parsed.problem) return setProblem(parsed.problem);
      const hash = await sha256Hex(bytes);
      const check = await telecallerApi.checkSheet({ assigneeId, fileName: file.name, note: note.trim() || null, hash, rows: parsed.rows, commit: false });
      setPicked({ fileName: file.name, hash, bytes, sheetName: sheet.name, rows: parsed.rows, skipped: parsed.skipped, check });
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setReading(false);
    }
  };

  const confirm = async () => {
    if (!picked || busy.current) return; // a double click must not assign the sheet twice
    busy.current = true;
    setAssigning(true);
    setProblem(null);
    try {
      const r = await telecallerApi.checkSheet({ assigneeId, fileName: picked.fileName, note: note.trim() || null, hash: picked.hash, rows: picked.rows, commit: true });
      if (!r.committed || !r.listId) {
        setPicked({ ...picked, check: r });
        return;
      }
      const who = assignees?.find(a => a.id === assigneeId)?.name || 'the Telecaller';
      let text = `${r.summary.valid} contacts from ${picked.fileName} were assigned to ${who}.`;
      try {
        await telecallerApi.storeSource(r.listId, toBase64(picked.bytes));
      } catch {
        text += ' The original file could not be stored; the contacts are assigned.';
      }
      setDone(text);
      setNote('');
      reset();
      load();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      busy.current = false;
      setAssigning(false);
    }
  };

  const check = picked?.check;
  const blocked = !check || check.errors.length > 0 || check.alreadyAssigned;

  return (
    <div className="space-y-5">
      <PageTitle title="Telecaller contact sheets" subtitle="Upload an Excel sheet of contacts and assign it to one of your Telecallers." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {done && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center gap-2"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />{done}</div>}

      {assignees === null ? (
        <Spinner />
      ) : assignees.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <EmptyState icon={FileSpreadsheet} title="No Telecaller in your department yet">
            Create a Sales team member with the Sales role <strong>Telecaller</strong> in <em>Team Members &amp; Access</em>, then assign a sheet here.
          </EmptyState>
        </div>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4" aria-label="Assign a contact sheet">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="cs-assignee" className="block text-xs font-medium text-slate-600 mb-1">Assign to <span aria-hidden="true">*</span></label>
              <select id="cs-assignee" className={tcInput} value={assigneeId} onChange={e => { setAssigneeId(e.target.value); reset(); }}>
                <option value="">Choose a Telecaller…</option>
                {assignees.map(a => <option key={a.id} value={a.id}>{a.name} · {a.team} ({a.openContacts} calls pending)</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cs-note" className="block text-xs font-medium text-slate-600 mb-1">Note (optional)</label>
              <input id="cs-note" className={tcInput} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Cold calls for November" />
            </div>
          </div>
          <div>
            <label htmlFor="cs-file" className="block text-xs font-medium text-slate-600 mb-1">Excel file (.xlsx, up to {Math.round(TELECALLER_SHEET_MAX_BYTES / 1024)} KB) <span aria-hidden="true">*</span></label>
            <input
              id="cs-file"
              ref={fileInput}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={reading || assigning}
              onChange={e => void onFile(e.target.files?.[0])}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-blue-50 file:px-4 file:py-2.5 file:text-sm file:font-bold file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="mt-1.5 text-xs text-slate-500">The first row must have the headings: {SHEET_COLUMNS.join(', ')}. Contact Name and Phone Number are required.</p>
          </div>

          {reading && <Spinner label="Reading and checking the sheet…" />}
          {problem && <ErrorBanner message={problem} />}

          {picked && check && (
            <div className="space-y-3" aria-label="Preview">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 font-bold text-slate-900"><Upload className="w-4 h-4 text-blue-600" aria-hidden="true" />{picked.fileName}</span>
                <span className="text-slate-500">Sheet “{picked.sheetName}”</span>
                <span data-testid="preview-rows" className="text-slate-700"><b>{check.summary.rows}</b> rows</span>
                <span className="text-emerald-700"><b>{check.summary.valid}</b> valid</span>
                <span className={check.summary.invalid ? 'text-rose-700' : 'text-slate-500'}><b>{check.summary.invalid}</b> with problems</span>
                {picked.skipped > 0 && <span className="text-slate-500">{picked.skipped} blank rows skipped</span>}
              </div>
              {check.alreadyAssigned && <ErrorBanner message="This same sheet has already been assigned to this Telecaller. Choose another sheet or another Telecaller." />}
              {check.errors.length > 0 && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  <p className="font-bold mb-1">Fix these rows in the Excel file and upload it again. Nothing has been assigned.</p>
                  <ul className="list-disc pl-5 space-y-0.5 max-h-48 overflow-y-auto">
                    {check.errors.map(e => <li key={`${e.row}-${e.message}`}>Row {e.row}: {e.message}</li>)}
                  </ul>
                </div>
              )}
              {check.preview.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Preview of the first {check.preview.length} valid contacts</caption>
                    <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">{['Row', 'Contact Name', 'Company', 'Phone', 'Email', 'Remarks'].map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {check.preview.map(p => (
                        <tr key={p.row}><td className="px-3 py-2 text-slate-500">{p.row}</td><td className="px-3 py-2 font-semibold text-slate-900">{p.name}</td><td className="px-3 py-2">{p.company || '-'}</td><td className="px-3 py-2">{p.phone}</td><td className="px-3 py-2">{p.email || '-'}</td><td className="px-3 py-2">{p.remarks || '-'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {check.summary.valid > check.preview.length && <p className="px-3 py-2 text-xs text-slate-500 bg-slate-50">Showing the first {check.preview.length} of {check.summary.valid} valid contacts.</p>}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className={tcBtn.secondary} onClick={reset} disabled={assigning}>Cancel</button>
                <button type="button" className={tcBtn.primary} onClick={() => void confirm()} disabled={blocked || assigning}>{assigning ? 'Assigning…' : `Confirm and assign ${check.summary.valid} contacts`}</button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Assigned sheets">
        <h2 className="px-5 py-4 border-b border-slate-100 text-base font-extrabold text-slate-900">Assigned sheets</h2>
        {sheets.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="Nothing assigned yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">{['Sheet', 'Assigned to', 'Assigned by', 'Date', 'Total', 'Pending', 'Completed', 'Original file'].map(h => <th key={h} scope="col" className="px-4 py-3 font-bold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {sheets.map(s => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{s.fileName}{s.note ? <span className="block text-xs font-normal text-slate-500">{s.note}</span> : null}</td>
                    <td className="px-4 py-3">{s.assignedTo || '-'}</td>
                    <td className="px-4 py-3">{s.assignedBy || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateText(s.assignedAt)}</td>
                    <td className="px-4 py-3">{s.total}</td>
                    <td className="px-4 py-3 text-amber-700">{s.pending}</td>
                    <td className="px-4 py-3 text-emerald-700">{s.called}</td>
                    <td className="px-4 py-3 text-slate-500">{s.hasSourceFile ? 'Stored' : '-'}</td>
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
