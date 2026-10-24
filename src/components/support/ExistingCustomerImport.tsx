import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Mail, RotateCcw, Upload } from 'lucide-react';
import type { CustomerDataImportLogin, CustomerDataImportResult } from '../../../shared/contracts';
import { api, errorMessage } from '../../lib/api/client';
import { IMPORT_SHEETS, ONE_SHEET_BLOCKS, SHEET_LABEL, parseExistingCustomers, type ParsedImport } from '../../lib/existingCustomerImport';
import { readXlsx } from '../../lib/xlsxReader';
import { useAuth } from '../../context/AuthContext';
import { btn, Card, ErrorBanner, Pill } from '../team-member/pipeline/shared';

/**
 * Import existing customers from the Excel template: their services and plans, WhatsApp / AI Calling / RCS usage,
 * campaigns and monthly deliverables. For Support Team Members (their own customers), Team Leads and
 * Department Heads (for a named member).
 *   1. Download the template, fill it in.
 *   2. Upload: everything is checked first and nothing is saved; problems are listed by sheet and row.
 *   3. Save: all rows at once (or none). Rows with a "Client Login E-mail" get a client login. With a "Client Password" the
 *      login uses the password the team chose (Supabase Auth keeps only its hash; the CRM never stores it) and the client is
 *      e-mailed the dashboard address, login e-mail and password; without one the client gets an e-mail to set their own.
 */
const ONE_SHEET_TEMPLATE = '/templates/Existing_Customers_One_Sheet.xlsx';
const TABS_TEMPLATE = '/templates/Existing_Customers_Services_Usage.xlsx';
const MAX_BYTES = 5 * 1024 * 1024;

type Step = { kind: 'idle' } | { kind: 'checking' } | { kind: 'checked'; file: string; parsed: ParsedImport; result: CustomerDataImportResult } | { kind: 'saving' } | { kind: 'saved'; result: CustomerDataImportResult };

const importApi = (data: ParsedImport['data'], commit: boolean) => api.post<CustomerDataImportResult>('/customers/import-existing', { commit, data });

export const ExistingCustomerImport: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const { profile } = useAuth();
  const isMember = profile?.role === 'TEAM_MEMBER';
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Extract<Step, { kind: 'checked' }> | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setError(null);
    if (!/\.xlsx$/i.test(file.name)) return setError('Choose the Excel file (.xlsx). If you filled it in Google Sheets, use File > Download > Microsoft Excel (.xlsx).');
    if (file.size > MAX_BYTES) return setError('The file is larger than 5 MB. Split it into two files.');
    setStep({ kind: 'checking' });
    try {
      const parsed = parseExistingCustomers(await readXlsx(file));
      if (!Object.keys(parsed.data).length && !parsed.problems.length) throw new Error('No rows are filled in. Fill the rows below the grey example rows.');
      const result = await importApi(parsed.data, false);
      const s: Extract<Step, { kind: 'checked' }> = { kind: 'checked', file: file.name, parsed, result };
      setChecked(s);
      setStep(s);
    } catch (e) {
      setStep({ kind: 'idle' });
      setError(errorMessage(e));
    }
  };

  const save = async () => {
    if (!checked) return;
    setError(null);
    setStep({ kind: 'saving' });
    try {
      const result = await importApi(checked.parsed.data, true);
      if (!result.committed) {
        // something changed since the check (e.g. a colleague added the same customer)
        const s = { ...checked, result };
        setChecked(s);
        setStep(s);
        return;
      }
      setStep({ kind: 'saved', result });
    } catch (e) {
      setStep(checked);
      setError(errorMessage(e));
    }
  };

  const reset = () => {
    setChecked(null);
    setStep({ kind: 'idle' });
    setError(null);
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">Import existing customers</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5 max-w-3xl">
          Add the customers you already look after from the Excel sheet: their services, plans, message and calling usage, campaigns and monthly work.
          Your clients then see all of it on their dashboard. {isMember ? 'The customers are added as yours.' : 'Write the Support Team Member on each Customer row.'}
        </p>
      </div>

      <Card className="p-5">
        <ol className="grid gap-4 md:grid-cols-3 text-xs text-slate-600">
          <li className="flex gap-3">
            <span className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-700 font-bold flex items-center justify-center shrink-0">1</span>
            <div>
              <div className="font-bold text-slate-900 text-sm">Download the template</div>
              <p className="mt-0.5">One sheet for the whole Support team: one row per customer and service they bought (more rows for campaigns and months). Keep the headings; the grey rows are examples and are skipped.</p>
              <a href={ONE_SHEET_TEMPLATE} download className={`${btn.secondary} mt-2`}>
                <Download className="w-4 h-4" aria-hidden="true" /> Excel template (one sheet)
              </a>
              <a href={TABS_TEMPLATE} download className="block mt-2 text-[11px] text-slate-500 underline">The older template with one tab per kind of data</a>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-700 font-bold flex items-center justify-center shrink-0">2</span>
            <div>
              <div className="font-bold text-slate-900 text-sm">Upload and check</div>
              <p className="mt-0.5">Every row is checked. Nothing is saved yet; any problem is shown with its sheet and row.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-700 font-bold flex items-center justify-center shrink-0">3</span>
            <div>
              <div className="font-bold text-slate-900 text-sm">Save</div>
              <p className="mt-0.5">All rows are saved together. A client with a "Client Password" gets an e-mail with the dashboard address, their login e-mail and that password. Without one, the client gets an e-mail to set their own.</p>
            </div>
          </li>
        </ol>

        {(step.kind === 'idle' || step.kind === 'checking') && (
          <label
            className={`mt-5 flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer ${step.kind === 'checking' ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}`}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              void pick(e.dataTransfer.files[0]);
            }}
          >
            <FileSpreadsheet className="w-8 h-8 text-indigo-500" aria-hidden="true" />
            <span className="text-sm font-bold text-slate-900">{step.kind === 'checking' ? 'Checking the file…' : 'Choose the filled Excel file'}</span>
            <span className="text-xs text-slate-500">or drop it here (.xlsx, up to 5 MB)</span>
            <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={step.kind === 'checking'} onChange={e => void pick(e.target.files?.[0])} aria-label="Excel file to import" />
          </label>
        )}
      </Card>

      {error && <ErrorBanner message={error} />}

      {(step.kind === 'checked' || step.kind === 'saving') && checked && <Preview step={checked} saving={step.kind === 'saving'} onSave={save} onReset={reset} />}
      {step.kind === 'saved' && <Saved result={step.result} onReset={reset} onDone={onDone} />}
    </div>
  );
};

const SUMMARY: [keyof CustomerDataImportResult['summary'], string][] = [
  ['added', 'New customers'],
  ['updated', 'Existing customers updated'],
  ['services', 'Services'],
  ['usage', 'Usage rows'],
  ['campaigns', 'Campaigns'],
  ['logins', 'Client logins']
];

const Summary: React.FC<{ s: CustomerDataImportResult['summary'] }> = ({ s }) => (
  <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
    {SUMMARY.map(([k, label]) => (
      <div key={k} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
        <dt className="text-[11px] text-slate-500">{label}</dt>
        <dd className="text-lg font-bold text-slate-900">{s[k]}</dd>
      </div>
    ))}
  </dl>
);

const Preview: React.FC<{ step: Extract<Step, { kind: 'checked' }>; saving: boolean; onSave: () => void; onReset: () => void }> = ({ step, saving, onSave, onReset }) => {
  const { result, parsed } = step;
  const oneSheet = parsed.format === 'one-sheet';
  // the sheet's own problems first (a row that cannot be read), then what the server found; in the one-sheet template the server's tab names are shown as Record types
  const errors = [
    ...parsed.problems.map(p => ({ sheet: 'Import', row: p.row, message: p.message })),
    ...result.errors.map(e => (oneSheet ? { ...e, sheet: SHEET_LABEL[e.sheet] ?? e.sheet } : e))
  ];
  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-900">{step.file}</div>
          <div className="text-xs text-slate-500">
            {oneSheet
              ? ONE_SHEET_BLOCKS.filter(t => parsed.counts[t.key]).map(t => `${t.label}: ${parsed.counts[t.key]}`).join(' · ')
              : IMPORT_SHEETS.filter(s => parsed.counts[s.key]).map(s => `${s.title}: ${parsed.counts[s.key]}`).join(' · ')}
          </div>
        </div>
        {errors.length ? <Pill tone="red">{errors.length} problem{errors.length === 1 ? '' : 's'} to fix</Pill> : <Pill tone="green">Ready to save</Pill>}
      </div>
      <Summary s={result.summary} />

      {errors.length > 0 ? (
        <div>
          <p className="text-xs text-slate-600 mb-2">Nothing is saved until every problem is fixed. Correct these rows in Excel and upload the file again.</p>
          <div className="overflow-x-auto border border-rose-100 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-rose-50 text-rose-900">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">{oneSheet ? 'Part of the row' : 'Sheet'}</th>
                  <th className="text-left font-semibold px-3 py-2">Row</th>
                  <th className="text-left font-semibold px-3 py-2">What to fix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rose-50">
                {errors.slice(0, 300).map((e, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 whitespace-nowrap">{e.sheet}</td>
                    <td className="px-3 py-2">{e.row}</td>
                    <td className="px-3 py-2 text-slate-800">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {errors.length > 300 && <p className="text-[11px] text-slate-500 mt-1">The first 300 problems are shown.</p>}
        </div>
      ) : (
        result.logins.length > 0 && (
          <p className="text-xs text-slate-600">
            <Mail className="w-4 h-4 inline -mt-0.5 mr-1 text-indigo-500" aria-hidden="true" />
            {(() => {
              const team = result.logins.filter(l => l.passwordBy === 'TEAM');
              const client = result.logins.filter(l => l.passwordBy !== 'TEAM');
              return (
                <>
                  {team.length > 0 && <>{team.length} client{team.length === 1 ? '' : 's'} will be e-mailed their sign-in details with the password you chose: {team.map(l => l.email).join(', ')}. </>}
                  {client.length > 0 && <>{client.length} client{client.length === 1 ? '' : 's'} will get an e-mail to set their own password: {client.map(l => l.email).join(', ')}.</>}
                </>
              );
            })()}
          </p>
        )
      )}
      {parsed.warnings.length > 0 && (
        <p className="text-[11px] text-orange-700">
          {parsed.warnings.slice(0, 5).join(' ')}{parsed.warnings.length > 5 ? ` (and ${parsed.warnings.length - 5} more)` : ''}
        </p>
      )}
      {parsed.ignored.length > 0 && <p className="text-[11px] text-slate-500">Columns not used by the import: {parsed.ignored.slice(0, 8).join('; ')}{parsed.ignored.length > 8 ? '…' : ''}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onReset} disabled={saving}>
          <RotateCcw className="w-4 h-4" aria-hidden="true" /> {errors.length ? 'Upload the corrected file' : 'Choose another file'}
        </button>
        {!errors.length && (
          <button type="button" className={btn.primary} onClick={onSave} disabled={saving}>
            <Upload className="w-4 h-4" aria-hidden="true" /> {saving ? 'Saving…' : 'Save to the CRM'}
          </button>
        )}
      </div>
    </Card>
  );
};

const Saved: React.FC<{ result: CustomerDataImportResult; onReset: () => void; onDone?: () => void }> = ({ result, onReset, onDone }) => {
  const [logins, setLogins] = useState<CustomerDataImportLogin[]>(result.logins);
  const [busy, setBusy] = useState<string | null>(null);
  const resend = async (l: CustomerDataImportLogin) => {
    setBusy(l.customerId);
    try {
      const r = await api.post<{ sent: boolean; detail?: string }>(`/customers/${l.customerId}/client-password-email`);
      setLogins(list => list.map(x => (x.customerId === l.customerId ? { ...x, mail: r.sent ? 'SENT' : 'NOT_SENT', detail: r.detail } : x)));
    } catch (e) {
      setLogins(list => list.map(x => (x.customerId === l.customerId ? { ...x, detail: errorMessage(e) } : x)));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="p-5 space-y-4">
      <div role="status" className="flex items-center gap-2 text-emerald-800 text-sm font-bold">
        <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> Saved to the CRM
      </div>
      <Summary s={result.summary} />
      {logins.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-900 mb-2">Client logins</h3>
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {logins.map(l => (
              <li key={l.customerId} className="p-3 flex flex-col md:flex-row md:items-center gap-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{l.businessName || l.name}</div>
                  <div className="text-slate-500">{l.email}</div>
                  {l.detail && <div className="text-[11px] text-orange-700 mt-0.5">{l.detail}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={l.login === 'CREATED' ? 'green' : 'red'}>{l.login === 'CREATED' ? 'Login created' : 'Login not created'}</Pill>
                  {l.login === 'CREATED' && (
                    <Pill tone={l.mail === 'SENT' ? 'green' : 'orange'}>
                      {l.passwordBy === 'TEAM' ? (l.mail === 'SENT' ? 'Sign-in details e-mailed' : 'E-mail not sent') : l.mail === 'SENT' ? 'Set-password e-mail sent' : 'E-mail not sent'}
                    </Pill>
                  )}
                  {/* the password is not kept, so it cannot be e-mailed again: after a team password only a set-password link can still be sent */}
                  {l.login === 'CREATED' && !(l.passwordBy === 'TEAM' && l.mail === 'SENT') && (
                    <button type="button" className={btn.secondary} disabled={busy === l.customerId} onClick={() => void resend(l)}>
                      <Mail className="w-4 h-4" aria-hidden="true" /> {busy === l.customerId ? 'Sending…' : l.passwordBy === 'TEAM' ? 'Send set-password link' : l.mail === 'SENT' ? 'Send again' : 'Send e-mail'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-500 mt-2">
            {logins.some(l => l.passwordBy === 'TEAM') && 'Each client with a password you chose gets an e-mail with the dashboard address, their login e-mail and that password. The CRM does not keep the password, so it cannot be shown or e-mailed again. Delete the "Client Password" column from your file now. '}
            {logins.some(l => l.passwordBy !== 'TEAM') && 'A client without a password opens the e-mail, chooses one and signs in at the client dashboard. If the link expires they can use "Forgot password?" on the sign-in page.'}
          </p>
        </div>
      )}
      {result.passwordsNotUsed && result.passwordsNotUsed.length > 0 && (
        <p className="text-[11px] text-orange-700">
          The password in the file was not used for {result.passwordsNotUsed.join(', ')}: that customer already had a login. They can use "Forgot password?" on the sign-in page.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onReset}>
          Import another file
        </button>
        {onDone && (
          <button type="button" className={btn.primary} onClick={onDone}>
            Done
          </button>
        )}
      </div>
    </Card>
  );
};
