import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet } from 'lucide-react';
import type { SalesLeadAssignee, SalesSheet, SalesSheetCheck } from '../../../shared/contracts';
import { TELECALLER_SHEET_MAX_BYTES } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { salesHeadApi } from '../../lib/api/endpoints';
import { buildLeadRows, LEAD_FIELDS, missingFields, readLeadSheet, type LeadMapping, type LeadSheetRead } from '../../lib/salesLeadSheet';
import { sha256Hex, toBase64 } from '../../lib/telecallerSheet';
import { readXlsx } from '../../lib/xlsxReader';
import { PageTitle } from '../layout/shell';
import { Card } from '../tasks/head/headParts';
import { Dialog, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { EmptyState, TemperatureBadge, dateText, tcBtn, tcInput } from '../telecaller/ui';

const XLSX_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', ''];

interface Picked {
  fileName: string;
  hash: string;
  bytes: ArrayBuffer;
  sheetName: string;
  read: LeadSheetRead;
}

/**
 * Lead Assign: the Sales Department Head uploads an Excel sheet of leads and assigns it to one Sales team member. The file is read in the browser,
 * the columns are matched (and can be corrected), every row is checked by the database - nothing is saved on a preview - and only after the head
 * confirms are the leads assigned and the original file stored. Rows with a problem are listed, never dropped silently.
 */
export const LeadAssign: React.FC = () => {
  const [people, setPeople] = useState<SalesLeadAssignee[] | null>(null);
  const [sheets, setSheets] = useState<SalesSheet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [mapping, setMapping] = useState<LeadMapping>({});
  const [check, setCheck] = useState<SalesSheetCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([salesHeadApi.assignees(), salesHeadApi.sheets()]).then(
      ([a, s]) => (setPeople(a), setSheets(s)),
      e => (setError(errorMessage(e)), setPeople(p => p ?? []))
    );
  }, []);
  useEffect(load, [load]);

  const assignee = people?.find(p => p.id === assigneeId) ?? null;
  const missing = picked ? missingFields(mapping) : [];

  const reset = () => {
    setPicked(null);
    setCheck(null);
    setProblem(null);
    setMapping({});
    setConfirming(false);
    if (fileInput.current) fileInput.current.value = '';
  };

  const onFile = async (file: File | undefined) => {
    setDone(null);
    setProblem(null);
    setPicked(null);
    setCheck(null);
    if (!file) return;
    if (/\.xls$/i.test(file.name)) return setProblem('This is an old .xls file. Open it in Excel and save it as .xlsx, then upload it again.');
    if (!/\.xlsx$/i.test(file.name) || !XLSX_TYPES.includes(file.type)) return setProblem('Choose an Excel (.xlsx) file.');
    if (file.size > TELECALLER_SHEET_MAX_BYTES) return setProblem(`The file is too large (${Math.round(TELECALLER_SHEET_MAX_BYTES / 1024)} KB at most).`);
    if (file.size === 0) return setProblem('The file is empty.');
    setReading(true);
    try {
      const bytes = await file.arrayBuffer();
      const book = await readXlsx(new Blob([bytes]));
      const sheet = book.sheets[0];
      if (!sheet) return setProblem('The workbook has no sheets.');
      const read = readLeadSheet(sheet.rows);
      if (read.problem) return setProblem(read.problem);
      const hash = await sha256Hex(bytes);
      setMapping(read.mapping);
      setPicked({ fileName: file.name, hash, bytes, sheetName: sheet.name, read });
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setReading(false);
    }
  };

  // Check the sheet (a preview: nothing is saved) whenever the file, the person or the column mapping changes.
  useEffect(() => {
    if (!picked || !assigneeId || missingFields(mapping).length > 0) {
      setCheck(null);
      return;
    }
    let live = true;
    setChecking(true);
    setProblem(null);
    const rows = buildLeadRows(picked.read, mapping);
    salesHeadApi.checkSheet({ assigneeId, fileName: picked.fileName, note: note.trim() || null, hash: picked.hash, rows, commit: false }).then(
      r => live && (setCheck(r), setChecking(false)),
      e => live && (setProblem(errorMessage(e)), setCheck(null), setChecking(false))
    );
    return () => { live = false; };
  }, [picked, assigneeId, mapping]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    if (!picked || !assignee || busy.current) return; // a double click must not assign the sheet twice
    busy.current = true;
    setAssigning(true);
    setProblem(null);
    try {
      const rows = buildLeadRows(picked.read, mapping);
      const r = await salesHeadApi.checkSheet({ assigneeId, fileName: picked.fileName, note: note.trim() || null, hash: picked.hash, rows, commit: true });
      if (!r.committed || !r.sheetId) {
        setCheck(r);
        setConfirming(false);
        return;
      }
      let text = r.mode === 'TELECALLER'
        ? `${r.summary.valid} contacts from ${picked.fileName} were assigned to ${assignee.name} as a Telecaller contact sheet.`
        : `${r.summary.valid} leads from ${picked.fileName} were assigned to ${assignee.name}.`;
      if (r.summary.invalid + r.summary.duplicates > 0) text += ` ${r.summary.invalid + r.summary.duplicates} rows were left out (see the history).`;
      try {
        await salesHeadApi.storeSource(r.sheetId, toBase64(picked.bytes));
      } catch {
        text += ' The original file could not be stored; the leads are assigned.';
      }
      setDone(text);
      setNote('');
      setConfirming(false);
      reset();
      load();
    } catch (err) {
      setProblem(errorMessage(err));
      setConfirming(false);
    } finally {
      busy.current = false;
      setAssigning(false);
    }
  };

  const blocked = !check || check.summary.valid === 0 || check.alreadyAssigned || checking;

  return (
    <div className="space-y-5">
      <PageTitle title="Lead Assign" subtitle="Upload an Excel sheet of leads and assign it to one of your Sales team members." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {done && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center gap-2"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />{done}</div>}

      {people === null ? <Spinner /> : people.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <EmptyState title="No Sales team member to assign leads to">Add a Sales Team Lead or Team Member in <em>Team Members &amp; Access</em>, then upload a sheet here.</EmptyState>
        </div>
      ) : (
        <Card className="p-5 space-y-4" label="Upload and assign a lead sheet">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="la-assignee" className="block text-xs font-medium text-slate-600 mb-1">Assign to <span aria-hidden="true">*</span></label>
              <select id="la-assignee" className={tcInput} value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                <option value="">Choose a Sales team member…</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role} · {p.team}{p.mode === 'TELECALLER' ? ' · Telecaller' : ` (${p.openLeads} open leads)`}</option>)}
              </select>
              {assignee && (
                <p className="mt-1.5 text-xs text-slate-500" data-testid="assign-mode">
                  {assignee.mode === 'TELECALLER' ? 'A Telecaller receives the sheet as contacts to call; the interested ones become leads.' : 'The leads go straight into this person\'s lead pipeline.'}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="la-note" className="block text-xs font-medium text-slate-600 mb-1">Note (optional)</label>
              <input id="la-note" className={tcInput} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Trade fair leads, November" />
            </div>
          </div>
          <div>
            <label htmlFor="la-file" className="block text-xs font-medium text-slate-600 mb-1">Excel file (.xlsx, up to {Math.round(TELECALLER_SHEET_MAX_BYTES / 1024)} KB) <span aria-hidden="true">*</span></label>
            <input
              id="la-file"
              ref={fileInput}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={reading || assigning}
              onChange={e => void onFile(e.target.files?.[0])}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-blue-50 file:px-4 file:py-2.5 file:text-sm file:font-bold file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="mt-1.5 text-xs text-slate-500">Columns: Customer Name and Phone Number are required; Company / Business Name, Email, Lead Source, Lead Temperature (Hot, Warm or Cold) and Remarks are optional. Other headings can be matched below. Only .xlsx files are read.</p>
          </div>

          {reading && <Spinner label="Reading the sheet…" />}
          {problem && <ErrorBanner message={problem} />}
          {picked && !assigneeId && <p className="text-sm text-amber-700 font-medium">Choose who the leads go to to check the sheet.</p>}

          {picked && (
            <div className="space-y-3">
              <details open={missing.length > 0} className="rounded-xl border border-slate-200">
                <summary className="px-3 py-2 text-sm font-bold text-slate-800 cursor-pointer">Column mapping {missing.length > 0 && <span className="text-rose-700 font-semibold">· choose a column for {missing.join(' and ')}</span>}</summary>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {LEAD_FIELDS.map(f => (
                    <label key={f.key} className="block text-xs font-medium text-slate-600">
                      {f.label}{f.required && <span aria-hidden="true"> *</span>}
                      <select
                        className={`${tcInput} mt-1`}
                        value={mapping[f.key] ?? ''}
                        aria-label={`Column for ${f.label}`}
                        onChange={e => setMapping(m => { const next = { ...m }; if (e.target.value === '') delete next[f.key]; else next[f.key] = Number(e.target.value); return next; })}
                      >
                        <option value="">{f.required ? 'Choose a column…' : 'Not in the sheet'}</option>
                        {picked.read.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
              {checking && <Spinner label="Checking the sheet…" />}
            </div>
          )}

          {picked && check && !checking && (
            <div className="space-y-3" aria-label="Preview">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 font-bold text-slate-900"><FileSpreadsheet className="w-4 h-4 text-blue-600" aria-hidden="true" />{picked.fileName}</span>
                <span className="text-slate-500">Sheet “{picked.sheetName}”</span>
                <span data-testid="preview-rows" className="text-slate-700"><b>{check.summary.rows}</b> rows</span>
                <span className="text-emerald-700"><b data-testid="preview-valid">{check.summary.valid}</b> valid</span>
                <span className={check.summary.invalid ? 'text-rose-700' : 'text-slate-500'}><b data-testid="preview-invalid">{check.summary.invalid}</b> invalid</span>
                <span className={check.summary.duplicates ? 'text-amber-700' : 'text-slate-500'}><b data-testid="preview-duplicates">{check.summary.duplicates}</b> duplicates</span>
              </div>
              {check.alreadyAssigned && <ErrorBanner message="This same sheet has already been uploaded and assigned. Choose another sheet." />}
              {check.issues.length > 0 && (
                <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-bold mb-1">These rows will be left out. Fix them in the Excel file and upload it again if you need them.</p>
                  <ul className="list-disc pl-5 space-y-0.5 max-h-48 overflow-y-auto">
                    {check.issues.map(e => <li key={`${e.row}-${e.message}`}>Row {e.row} ({e.kind === 'DUPLICATE' ? 'duplicate' : 'invalid'}): {e.message}</li>)}
                  </ul>
                </div>
              )}
              {check.preview.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm min-w-[900px]">
                    <caption className="sr-only">Preview of the first {check.preview.length} valid leads</caption>
                    <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">{['Row', 'Customer Name', 'Company', 'Phone', 'Email', 'Source', 'Temperature', 'Remarks'].map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {check.preview.map(p => (
                        <tr key={p.row}><td className="px-3 py-2 text-slate-500">{p.row}</td><td className="px-3 py-2 font-semibold text-slate-900">{p.name}</td><td className="px-3 py-2">{p.company || '-'}</td><td className="px-3 py-2">{p.phone}</td><td className="px-3 py-2">{p.email || '-'}</td><td className="px-3 py-2">{p.source || '-'}</td><td className="px-3 py-2"><TemperatureBadge value={p.temperature} /></td><td className="px-3 py-2">{p.remarks || '-'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {check.summary.valid > check.preview.length && <p className="px-3 py-2 text-xs text-slate-500 bg-slate-50">Showing the first {check.preview.length} of {check.summary.valid} valid leads.</p>}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className={tcBtn.secondary} onClick={reset} disabled={assigning}>Cancel</button>
                <button type="button" className={tcBtn.primary} onClick={() => setConfirming(true)} disabled={blocked || assigning}>Review and assign {check.summary.valid} {check.mode === 'TELECALLER' ? 'contacts' : 'leads'}</button>
              </div>
            </div>
          )}
        </Card>
      )}

      {confirming && check && assignee && picked && (
        <Dialog title="Assign these leads?" description="Please check who receives them." onClose={() => !assigning && setConfirming(false)} persistent={assigning}>
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-[11px] font-semibold text-slate-500">Assign to</dt><dd className="font-bold text-slate-900" data-testid="confirm-name">{assignee.name}</dd></div>
              <div><dt className="text-[11px] font-semibold text-slate-500">Role</dt><dd className="text-slate-900" data-testid="confirm-role">{assignee.role}{assignee.mode === 'TELECALLER' ? ' · Telecaller' : ''} · {assignee.team}</dd></div>
              <div><dt className="text-[11px] font-semibold text-slate-500">Sheet</dt><dd className="text-slate-900 break-all">{picked.fileName}</dd></div>
              <div><dt className="text-[11px] font-semibold text-slate-500">{check.mode === 'TELECALLER' ? 'Contacts' : 'Leads'}</dt><dd className="text-slate-900">{check.summary.valid} valid · {check.summary.invalid + check.summary.duplicates} left out</dd></div>
            </dl>
            <div className="flex justify-end gap-2">
              <button type="button" className={tcBtn.secondary} onClick={() => setConfirming(false)} disabled={assigning}>Back</button>
              <button type="button" className={tcBtn.primary} onClick={() => void commit()} disabled={assigning}>{assigning ? 'Assigning…' : 'Confirm and assign'}</button>
            </div>
          </div>
        </Dialog>
      )}

      <Card label="Uploaded sheets">
        <h2 className="px-5 pt-5 pb-3 text-base font-extrabold text-slate-900">Uploaded sheets</h2>
        {sheets.length === 0 ? <EmptyState title="Nothing uploaded yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[1000px]">
              <thead><tr className="text-left text-[11px] text-slate-500 bg-slate-50/60">{['Sheet', 'Assigned to', 'Uploaded by', 'Uploaded', 'Assigned', 'Rows', 'Valid', 'Invalid', 'Duplicates', 'Where it stands', 'Original file'].map(h => <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {sheets.map(s => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{s.fileName}{s.note ? <span className="block text-xs font-normal text-slate-500">{s.note}</span> : null}</td>
                    <td className="px-4 py-3">{s.assignedTo}<span className="block text-xs text-slate-500">{s.mode === 'TELECALLER' ? 'Telecaller contact sheet' : 'Leads'}</span></td>
                    <td className="px-4 py-3">{s.uploadedBy || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateText(s.uploadedAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateText(s.assignedAt)}</td>
                    <td className="px-4 py-3">{s.rows}</td>
                    <td className="px-4 py-3 text-emerald-700">{s.valid}</td>
                    <td className="px-4 py-3 text-rose-700">{s.invalid}</td>
                    <td className="px-4 py-3 text-amber-700">{s.duplicates}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">Assigned</span>
                      <span className="block text-xs mt-1">{s.mode === 'TELECALLER' ? `${s.contactsPending ?? 0} to call · ${s.contactsCalled ?? 0} called` : `${s.leadsNow ?? 0} in pipeline · ${s.converted ?? 0} converted`}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{s.hasSourceFile ? 'Stored' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
