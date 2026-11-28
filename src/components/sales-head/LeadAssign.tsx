import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet } from 'lucide-react';
import type { SalesForwardAssignee, SalesLeadAssignee, SalesReceivedSheet, SalesSheet, SalesSheetCheck, SalesSheetIssues } from '../../../shared/contracts';
import { TELECALLER_SHEET_MAX_BYTES } from '../../../shared/validation';
import { errorMessage } from '../../lib/api/client';
import { salesHeadApi } from '../../lib/api/endpoints';
import { buildLeadRows, LEAD_FIELDS, missingFields, readLeadSheet, type LeadMapping, type LeadSheetRead } from '../../lib/salesLeadSheet';
import { downloadContactSample } from '../../lib/sampleSheetDownload';
import { sha256Hex, toBase64 } from '../../lib/telecallerSheet';
import { readCsv } from '../../lib/csvReader';
import { isXlsFile, readXls } from '../../lib/xlsReader';
import { readXlsx, type Workbook } from '../../lib/xlsxReader';
import { SampleSheetDownload } from '../common/SampleSheetDownload';
import { PageTitle } from '../layout/shell';
import { Card } from '../tasks/head/headParts';
import { Dialog, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { EmptyState, dateText, tcBtn, tcInput } from '../telecaller/ui';

const ACCEPT = '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv';
const isZip = (b: ArrayBuffer) => { const h = new Uint8Array(b, 0, Math.min(4, b.byteLength)); return h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04; };

/** Reads the workbook by what the file really is (its first bytes), not by its name: .xlsx (zip), .xls (Excel 97-2003) or .csv (text). */
async function readSheetFile(name: string, bytes: ArrayBuffer): Promise<Workbook> {
  if (isZip(bytes)) return readXlsx(new Blob([bytes]));
  if (isXlsFile(bytes)) return readXls(new Blob([bytes]));
  if (/\.csv$/i.test(name)) return readCsv(bytes);
  throw new Error('Choose an Excel (.xlsx, .xls) or CSV file.');
}

/** Who receives a sheet and what happens to it. */
const roleOf = (p: Pick<SalesLeadAssignee, 'mode' | 'role'>) => (p.mode === 'TELECALLER' ? 'Telecaller' : p.role);
const ROLE_GROUPS = ['Department Head', 'Team Lead', 'Team Member', 'Telecaller'] as const;

interface Picked {
  fileName: string;
  hash: string;
  bytes: ArrayBuffer;
  sheetName: string;
  read: LeadSheetRead;
}

/**
 * Sheet Upload / Lead Assign (one page, two menu entries): the Sales Department Head uploads a sheet of contacts (.xlsx, .xls or .csv) and gives
 * it to a Sales person of their department - a Team Lead or Team Member gets the rows as leads in their own pipeline, a Telecaller as a call
 * list. The file is read in the browser, the columns are matched (and can be corrected), every row is checked by the database - nothing is saved
 * on a preview - and only after the head confirms is the sheet given and the original file stored. Rows with a problem are listed, never dropped
 * silently, and are kept with the sheet for the upload history.
 */
export const LeadAssign: React.FC<{ title?: string }> = ({ title = 'Lead Assign' }) => {
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
  const [failed, setFailed] = useState<{ sheet: SalesSheet; data: SalesSheetIssues | null; error: string | null } | null>(null);
  const [deptFilter, setDeptFilter] = useState('');
  const [received, setReceived] = useState<SalesReceivedSheet[]>([]);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([salesHeadApi.assignees(), salesHeadApi.sheets()]).then(
      ([a, s]) => (setPeople(a), setSheets(s)),
      e => (setError(errorMessage(e)), setPeople(p => p ?? []))
    );
    // the sheets a CEO gave to this Department Head (none for anybody else)
    salesHeadApi.receivedSheets().then(setReceived, () => setReceived([]));
  }, []);
  useEffect(load, [load]);
  // with a single Telecaller there is nothing to choose
  useEffect(() => {
    if (people && people.length === 1 && !assigneeId) setAssigneeId(people[0].id);
  }, [people, assigneeId]);

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
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return setProblem('Choose an Excel (.xlsx, .xls) or CSV file.');
    if (file.size > TELECALLER_SHEET_MAX_BYTES) return setProblem(`The file is too large (${Math.round(TELECALLER_SHEET_MAX_BYTES / 1024)} KB at most).`);
    if (file.size === 0) return setProblem('The file is empty.');
    setReading(true);
    try {
      const bytes = await file.arrayBuffer();
      const book = await readSheetFile(file.name, bytes);
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
      let text = r.mode === 'LEADS'
        ? `${r.summary.valid} leads from ${picked.fileName} are now in ${assignee.name}'s pipeline (My Leads).`
        : `${r.summary.valid} contacts from ${picked.fileName} were given to ${assignee.name}, who will call them.`;
      if (r.summary.invalid + r.summary.duplicates > 0) text += ` ${r.summary.invalid + r.summary.duplicates} rows were left out (see the history).`;
      try {
        await salesHeadApi.storeSource(r.sheetId, toBase64(picked.bytes));
      } catch {
        text += ' The original file could not be stored; the contacts are assigned.';
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
  // a Sales CEO covers several departments: the list can be narrowed to one (the department is always the recipient's, decided by the server)
  const departments = people ? [...new Map(people.filter(p => p.departmentId).map(p => [p.departmentId as string, p.department ?? 'Department'])).entries()] : [];
  const shown = people ? people.filter(p => !deptFilter || p.departmentId === deptFilter) : [];
  const groupsOfPeople = ROLE_GROUPS.map(r => ({ role: r, list: shown.filter(p => roleOf(p) === r) })).filter(g => g.list.length);
  const multiDept = departments.length > 1;
  const sheetDepts = new Set(sheets.map(s => s.department).filter(Boolean));
  const openFailed = (sheet: SalesSheet) => {
    setFailed({ sheet, data: null, error: null });
    salesHeadApi.sheetIssues(sheet.id).then(d => setFailed(f => (f && f.sheet.id === sheet.id ? { ...f, data: d } : f)), e => setFailed(f => (f && f.sheet.id === sheet.id ? { ...f, error: errorMessage(e) } : f)));
  };

  return (
    <div className="space-y-5">
      <PageTitle title={title} subtitle="Upload an Excel (.xlsx, .xls) or CSV sheet of contacts and give it to a Sales person of your department: a Team Lead or Team Member gets them as leads in their pipeline, a Telecaller as contacts to call." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {done && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center gap-2"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />{done}</div>}

      {people === null ? <Spinner /> : people.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <EmptyState title="No Sales team member in your department yet">Add a Sales Team Lead, Team Member or Telecaller in <em>Team Members &amp; Access</em>, then give a sheet to them here.</EmptyState>
        </div>
      ) : (
        <Card className="p-5 space-y-4" label="Upload and assign a lead sheet">
          {multiDept && (
            <div className="max-w-sm">
              <label htmlFor="la-dept" className="block text-xs font-medium text-slate-600 mb-1">Department</label>
              <select id="la-dept" className={tcInput} value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setAssigneeId(''); }}>
                <option value="">All my Sales departments</option>
                {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="la-assignee" className="block text-xs font-medium text-slate-600 mb-1">Give the sheet to <span aria-hidden="true">*</span></label>
              <select id="la-assignee" className={tcInput} value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                <option value="">Choose a Sales person…</option>
                {groupsOfPeople.map(g => (
                  <optgroup key={g.role} label={`${g.role}s`}>
                    {g.list.map(p => <option key={p.id} value={p.id}>{p.name} · {roleOf(p)} · {p.role === 'Department Head' ? p.department : p.team}{multiDept && p.role !== 'Department Head' && p.department ? ` (${p.department})` : ''} ({p.mode === 'TELECALLER' ? `${p.openContacts} calls pending` : `${p.openLeads ?? 0} open leads`})</option>)}
                  </optgroup>
                ))}
              </select>
              {assignee && (
                <p className="mt-1.5 text-xs text-slate-500" data-testid="assign-mode">
                  {assignee.mode === 'TELECALLER'
                    ? 'The Telecaller sees these contacts in their Tasks, calls them, and turns the interested ones into leads.'
                    : assignee.role === 'Department Head'
                    ? `${assignee.name} is the Sales Department Head of ${assignee.department ?? 'the department'} (${assignee.openLeads ?? 0} open leads now). The valid rows become leads in their pipeline; they are notified, see that you assigned them, and forward them to their Team Leads and Team Members.`
                    : `The valid rows become new leads in ${assignee.name}'s own pipeline (My Leads). ${assignee.role === 'Team Lead' ? 'They' : 'They, their Team Lead'} and you see them.`}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="la-note" className="block text-xs font-medium text-slate-600 mb-1">Note (optional)</label>
              <input id="la-note" className={tcInput} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Trade fair leads, November" />
            </div>
          </div>
          <SampleSheetDownload formats={['xlsx', 'csv']} onDownload={downloadContactSample} what="sheet" />
          <div>
            <label htmlFor="la-file" className="block text-xs font-medium text-slate-600 mb-1">Sheet file (.xlsx, .xls or .csv, up to {Math.round(TELECALLER_SHEET_MAX_BYTES / 1024)} KB) <span aria-hidden="true">*</span></label>
            <input
              id="la-file"
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              disabled={reading || assigning}
              onChange={e => void onFile(e.target.files?.[0])}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-blue-50 file:px-4 file:py-2.5 file:text-sm file:font-bold file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="mt-1.5 text-xs text-slate-500">Columns: Contact Name and Phone Number are required; Company Name, Email and Remarks are optional. Other headings can be matched below. The first sheet of a workbook is read.</p>
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
                {picked.read.sampleSkipped && <span className="text-slate-500" data-testid="sample-skipped">the sample row was skipped</span>}
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
                <button type="button" className={tcBtn.primary} onClick={() => setConfirming(true)} disabled={blocked || assigning}>Review and give {check.summary.valid} {assignee?.mode === 'LEADS' ? 'leads' : 'contacts'} to {assignee?.name ?? 'the Sales person'}</button>
              </div>
            </div>
          )}
        </Card>
      )}

      {confirming && check && assignee && picked && (
         <Dialog title={`Give this sheet to ${assignee.name}?`} description="Please check who receives it." onClose={() => !assigning && setConfirming(false)} persistent={assigning}>
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-[11px] font-semibold text-slate-500">Give to</dt><dd className="font-bold text-slate-900" data-testid="confirm-name">{assignee.name}</dd></div>
              <div><dt className="text-[11px] font-semibold text-slate-500">Role</dt><dd className="text-slate-900" data-testid="confirm-role">{roleOf(assignee)} · {assignee.role === 'Department Head' ? assignee.department : assignee.team}</dd></div>
              {assignee.department && <div><dt className="text-[11px] font-semibold text-slate-500">Department</dt><dd className="text-slate-900" data-testid="confirm-department">{assignee.department}</dd></div>}
              <div><dt className="text-[11px] font-semibold text-slate-500">Note</dt><dd className="text-slate-900 break-words">{note.trim() || '-'}</dd></div>
              <div><dt className="text-[11px] font-semibold text-slate-500">Sheet</dt><dd className="text-slate-900 break-all">{picked.fileName}</dd></div>
              <div><dt className="text-[11px] font-semibold text-slate-500">{assignee.mode === 'LEADS' ? 'New leads' : 'Contacts'}</dt><dd className="text-slate-900">{check.summary.valid} valid · {check.summary.invalid + check.summary.duplicates} left out</dd></div>
            </dl>
            <div className="flex justify-end gap-2">
              <button type="button" className={tcBtn.secondary} onClick={() => setConfirming(false)} disabled={assigning}>Back</button>
              <button type="button" className={tcBtn.primary} onClick={() => void commit()} disabled={assigning}>{assigning ? 'Assigning…' : 'Confirm and assign'}</button>
            </div>
          </div>
        </Dialog>
      )}

      {failed && (
        <Dialog title={`Rows left out of ${failed.sheet.fileName}`} description="Fix these rows in the file and upload them again if you need them." onClose={() => setFailed(null)}>
          {failed.error ? <ErrorBanner message={failed.error} /> : !failed.data ? <Spinner /> : (
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200" data-testid="failed-rows">
              <table className="w-full text-left text-sm">
                <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">{['Row', 'Problem', 'What the row had'].map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {failed.data.issues.map(i => (
                    <tr key={`${i.row}-${i.message}`}>
                      <td className="px-3 py-2 text-slate-500">{i.row}</td>
                      <td className={`px-3 py-2 ${i.kind === 'DUPLICATE' ? 'text-amber-800' : 'text-rose-700'}`}>{i.kind === 'DUPLICATE' ? 'Duplicate' : 'Invalid'}: {i.message}</td>
                      <td className="px-3 py-2 break-words text-slate-800">
                        <span className="block font-semibold">{i.name || 'No name'}</span>
                        <span className="block text-xs text-slate-600">{[i.phone || 'no phone', i.email, i.company].filter(Boolean).join(' · ')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Dialog>
      )}

      {received.length > 0 && <ReceivedSheets sheets={received} onChanged={load} />}

      <Card label="Uploaded sheets">
        <h2 className="px-5 pt-5 pb-3 text-base font-extrabold text-slate-900">Uploaded sheets</h2>
        {sheets.length === 0 ? <EmptyState title="Nothing uploaded yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[1000px]">
              <thead><tr className="text-left text-[11px] text-slate-500 bg-slate-50/60">{['Sheet', ...(sheetDepts.size > 1 ? ['Department'] : []), 'Assigned to', 'Uploaded by', 'Uploaded', 'Assigned', 'Rows', 'Valid', 'Invalid', 'Duplicates', 'Status', 'Failed rows', 'Original file'].map(h => <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {sheets.map(s => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{s.fileName}{s.note ? <span className="block text-xs font-normal text-slate-500">{s.note}</span> : null}</td>
                    {sheetDepts.size > 1 && <td className="px-4 py-3">{s.department ?? '-'}</td>}
                    <td className="px-4 py-3">{s.assignedTo}<span className="block text-xs text-slate-500">{s.mode === 'TELECALLER' ? 'Telecaller · contacts to call' : `${s.assigneeRole ?? 'Sales'} · leads in their pipeline`}</span></td>
                    <td className="px-4 py-3">{s.uploadedBy || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateText(s.uploadedAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateText(s.assignedAt)}</td>
                    <td className="px-4 py-3">{s.rows}</td>
                    <td className="px-4 py-3 text-emerald-700">{s.valid}</td>
                    <td className="px-4 py-3 text-rose-700">{s.invalid}</td>
                    <td className="px-4 py-3 text-amber-700">{s.duplicates}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">{s.mode === 'LEADS' ? 'Imported' : 'Assigned'}</span>
                      <span className="block text-xs mt-1">{s.mode === 'TELECALLER' ? `${s.contactsPending ?? 0} to call · ${s.contactsCalled ?? 0} called` : `${s.leadsNow ?? 0} in pipeline · ${s.converted ?? 0} converted`}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.invalid + s.duplicates === 0 ? <span className="text-slate-400">None</span>
                        : s.issuesKept ? <button type="button" className="text-blue-700 font-bold hover:underline" onClick={() => openFailed(s)} aria-label={`View the ${s.invalid + s.duplicates} rows left out of ${s.fileName}`}>View {s.invalid + s.duplicates}</button>
                        : <span className="text-xs text-slate-500" title="Uploaded before the left-out rows were kept">{s.invalid + s.duplicates} (not kept)</span>}
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

/**
 * A Department Head's sheets from the CEO: who assigned them and when, how many leads are still with them, and forwarding the open ones to a
 * Sales Team Lead or Team Member of that department (the same lead records change owner; nothing is copied).
 */
const ReceivedSheets: React.FC<{ sheets: SalesReceivedSheet[]; onChanged: () => void }> = ({ sheets, onChanged }) => {
  const [open, setOpen] = useState<SalesReceivedSheet | null>(null);
  const [people, setPeople] = useState<SalesForwardAssignee[] | null>(null);
  const [to, setTo] = useState('');
  const [count, setCount] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const busy = useRef(false);
  const start = (s: SalesReceivedSheet) => {
    setOpen(s); setPeople(null); setTo(''); setCount(''); setProblem(null);
    salesHeadApi.forwardAssignees(s.id).then(setPeople, e => (setPeople([]), setProblem(errorMessage(e))));
  };
  const n = count.trim() === '' ? undefined : Number(count);
  const badCount = n !== undefined && (!Number.isInteger(n) || n < 1 || (open ? n > open.openWithMe : false));
  const forward = async () => {
    if (!open || !to || badCount || busy.current) return;
    busy.current = true; setSaving(true); setProblem(null);
    try {
      const r = await salesHeadApi.forwardSheet(open.id, to, n);
      setDone(`${r.moved} lead${r.moved === 1 ? '' : 's'} of ${open.fileName} forwarded to ${r.assignee.name}.`);
      setOpen(null);
      onChanged();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      busy.current = false; setSaving(false);
    }
  };
  return (
    <Card label="Sheets assigned to you">
      <h2 className="px-5 pt-5 pb-1 text-base font-extrabold text-slate-900">Sheets assigned to you</h2>
      <p className="px-5 pb-3 text-xs text-slate-500">Leads the CEO gave you. They are in your pipeline; forward them to your Team Leads and Team Members.</p>
      {done && <p role="status" className="mx-5 mb-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">{done}</p>}
      <ul className="divide-y divide-slate-100" data-testid="received-sheets">
        {sheets.map(s => (
          <li key={s.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 break-words">{s.fileName}{s.department ? <span className="font-normal text-slate-500"> · {s.department}</span> : null}</p>
              <p className="text-xs text-slate-500">Assigned by {s.assignedBy ?? 'unknown'}{s.assignedByRole ? ` (${s.assignedByRole})` : ''} · {dateText(s.assignedAt)}{s.note ? ` · ${s.note}` : ''}</p>
              <p className="text-xs text-slate-600 mt-0.5"><b>{s.openWithMe}</b> open with you · {s.forwarded} forwarded · {s.converted} converted · {s.valid} in the sheet</p>
            </div>
            <button type="button" className={tcBtn.secondary} disabled={s.openWithMe === 0} onClick={() => start(s)}>Forward leads</button>
          </li>
        ))}
      </ul>
      {open && (
        <Dialog title={`Forward leads of ${open.fileName}`} description={`${open.openWithMe} open lead${open.openWithMe === 1 ? '' : 's'} are with you. The oldest rows go first.`} onClose={() => !saving && setOpen(null)} persistent={saving}>
          <div className="space-y-3">
            {problem && <ErrorBanner message={problem} />}
            {people === null ? <Spinner /> : people.length === 0 ? <p className="text-sm text-slate-600">No active Sales Team Lead or Team Member in {open.department ?? 'this department'}.</p> : (
              <>
                <label className="block text-xs font-medium text-slate-600">Forward to
                  <select className={`${tcInput} mt-1`} value={to} onChange={e => setTo(e.target.value)}>
                    <option value="">Choose a Team Lead or Team Member…</option>
                    {people.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role} · {p.team} ({p.openLeads} open leads)</option>)}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-600">How many (leave empty for all {open.openWithMe})
                  <input className={`${tcInput} mt-1`} inputMode="numeric" value={count} onChange={e => setCount(e.target.value.replace(/[^0-9]/g, ''))} aria-invalid={badCount} />
                </label>
                {badCount && <p className="text-xs text-rose-700">Enter a number from 1 to {open.openWithMe}.</p>}
              </>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={tcBtn.secondary} onClick={() => setOpen(null)} disabled={saving}>Cancel</button>
              <button type="button" className={tcBtn.primary} onClick={() => void forward()} disabled={saving || !to || badCount}>{saving ? 'Forwarding…' : 'Forward'}</button>
            </div>
          </div>
        </Dialog>
      )}
    </Card>
  );
};
