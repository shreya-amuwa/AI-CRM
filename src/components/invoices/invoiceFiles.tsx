import React, { useEffect, useRef, useState } from 'react';
import { Download, Eye, FileText, RefreshCw, Search, UploadCloud } from 'lucide-react';
import { INVOICE_PDF_MAX_BYTES, INVOICE_PDF_MAX_LABEL, type DocumentUploadTicket, type Invoice, type InvoiceCustomer, type InvoiceFile } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { addonsApi, documentsApi, invoicesApi } from '../../lib/api/endpoints';
import { requireSupabase } from '../../services/supabaseClient';
import { btn, Dialog, ErrorBanner, inputCls, longDate, money, Spinner, useDebounced } from '../team-member/pipeline/shared';

// ---------------------------------------------------------------------------
// Checks the browser can make before anything is sent (the API, the database and the storage bucket
// repeat every one of them: the browser is never the only line of defence).
// ---------------------------------------------------------------------------
export const fmtBytes = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;

const stamp = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '-';

/** Why this file cannot be uploaded as an invoice, or null when it can. */
export async function invoicePdfProblem(file: File): Promise<string | null> {
  if (!/\.pdf$/i.test(file.name)) return 'Only PDF files are accepted. Please choose a file ending in .pdf.';
  if (file.type && file.type !== 'application/pdf') return 'Only PDF files are accepted for invoices.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > INVOICE_PDF_MAX_BYTES) return `File size exceeds the ${INVOICE_PDF_MAX_LABEL} limit. Please upload a smaller PDF.`;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (!String.fromCharCode(...head).includes('%PDF-')) return 'This file is not a real PDF (it was probably renamed). Please upload the original invoice PDF.';
  return null;
}

/** Begin -> upload to the single signed path -> complete. The record exists only after the file is stored. */
async function uploadInvoicePdf(file: File, begin: () => Promise<DocumentUploadTicket>, phase: (p: 'uploading' | 'saving') => void): Promise<Invoice> {
  const ticket = await begin();
  let finished = false;
  try {
    phase('uploading');
    const { error } = await requireSupabase()
      .storage.from(ticket.bucket)
      .uploadToSignedUrl(ticket.path, ticket.token, await file.arrayBuffer(), { contentType: 'application/pdf', upsert: false });
    if (error) {
      throw new Error(/exceed|too large|size/i.test(error.message) ? `File size exceeds the ${INVOICE_PDF_MAX_LABEL} limit. Please upload a smaller PDF.` : `Upload failed: ${error.message}`);
    }
    phase('saving');
    const invoice = await invoicesApi.completeUpload(ticket.document.id);
    finished = true;
    return invoice;
  } finally {
    // A failed upload is closed so nothing half-finished is left behind (the server also cleans up).
    if (!finished) await documentsApi.abort(ticket.document.id).catch(() => undefined);
  }
}

/** Preview opens the browser's own PDF viewer in a new tab; download keeps the original file name. */
export async function openStoredFile(documentId: string, action: 'view' | 'download'): Promise<void> {
  const win = action === 'view' ? window.open('', '_blank') : null;
  try {
    const { url } = await documentsApi.url(documentId, action);
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      a.click();
    }
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** Preview / Download buttons for the PDF of an uploaded invoice. Errors show next to the buttons. */
export const InvoiceFileButtons: React.FC<{ file: InvoiceFile; number: string; compact?: boolean }> = ({ file, number, compact }) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'view' | 'download' | null>(null);
  const run = async (action: 'view' | 'download') => {
    setBusy(action);
    setError(null);
    try {
      await openStoredFile(file.documentId, action);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <span className="inline-flex flex-col items-end gap-1" onClick={e => e.stopPropagation()}>
      <span className="inline-flex gap-1.5">
        <button type="button" className={btn.secondary} disabled={!!busy} onClick={() => void run('view')} aria-label={`Preview the PDF of invoice ${number}`}>
          <Eye className="w-3.5 h-3.5" aria-hidden="true" /> {compact ? '' : 'Preview'}
        </button>
        <button type="button" className={btn.secondary} disabled={!!busy} onClick={() => void run('download')} aria-label={`Download the PDF of invoice ${number}`}>
          <Download className="w-3.5 h-3.5" aria-hidden="true" /> {compact ? '' : 'Download'}
        </button>
      </span>
      {error && (
        <span role="alert" className="text-[11px] text-rose-700 max-w-[16rem] text-right">
          {error}
        </span>
      )}
    </span>
  );
};

/** The PDF file picker with its limits shown next to it. */
const PdfPicker: React.FC<{ id: string; file: File | null; onFile: (f: File | null) => void; disabled?: boolean; error?: string | null }> = ({ id, file, onFile, disabled, error }) => (
  <div>
    <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
      Invoice PDF <span aria-hidden="true">*</span>
    </label>
    <input
      id={id}
      type="file"
      accept=".pdf,application/pdf"
      disabled={disabled}
      onChange={e => onFile(e.target.files?.[0] ?? null)}
      aria-describedby={`${id}-hint`}
      className="block w-full text-xs text-slate-700 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-semibold file:text-xs hover:file:bg-indigo-100"
    />
    <p id={`${id}-hint`} className="mt-1 text-[11px] text-slate-500">
      PDF only. Maximum file size: {INVOICE_PDF_MAX_LABEL}.{file && !error ? ` Selected: ${file.name} (${fmtBytes(file.size)}).` : ''}
    </p>
    {error && (
      <p role="alert" className="mt-1 text-[11px] text-rose-700">
        {error}
      </p>
    )}
  </div>
);

const phaseLabel = { checking: 'Checking the file…', uploading: 'Uploading…', saving: 'Saving the invoice…' } as const;

// ---------------------------------------------------------------------------
// Upload Invoice PDF (Accounts): a new invoice for a customer
// ---------------------------------------------------------------------------
export const UploadInvoiceDialog: React.FC<{
  /** Set when opened from a customer: the customer is not asked for again. */
  customer?: { id: string; label: string } | null;
  /** Set for the invoice of an approved add-on request: its customer and total come from the request. */
  addon?: { requestId: string; customerId: string; label: string; total: number } | null;
  onClose: () => void;
  onUploaded: (invoice: Invoice) => void;
}> = ({ customer: presetCustomer, addon, onClose, onUploaded }) => {
  const preset = addon ? { id: addon.customerId, label: addon.label } : presetCustomer;
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<InvoiceCustomer[] | null>(null);
  const [picked, setPicked] = useState<{ id: string; label: string; sub?: string } | null>(preset ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<null | keyof typeof phaseLabel>(null);
  const debounced = useDebounced(search.trim());
  const submitting = useRef(false);

  useEffect(() => {
    if (picked) return;
    let live = true;
    invoicesApi.customers(debounced || undefined).then(
      c => live && setCustomers(c),
      e => live && setError(errorMessage(e))
    );
    return () => {
      live = false;
    };
  }, [debounced, picked]);

  const chooseFile = async (f: File | null) => {
    setFile(f);
    setFileError(f ? await invoicePdfProblem(f) : null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || !picked) return;
    setError(null);
    if (!file) return setError('Choose the invoice PDF.');
    submitting.current = true;
    setPhase('checking');
    try {
      const problem = await invoicePdfProblem(file);
      if (problem) {
        setFileError(problem);
        return;
      }
      const invoice = await uploadInvoicePdf(
        file,
        () =>
          addon
            ? addonsApi.beginInvoiceUpload(addon.requestId, { fileName: file.name, mimeType: 'application/pdf', sizeBytes: file.size })
            : invoicesApi.beginUpload({ customerId: picked.id, fileName: file.name, mimeType: 'application/pdf', sizeBytes: file.size }),
        p => setPhase(p)
      );
      onUploaded(invoice);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setPhase(null);
    }
  };

  const busy = phase !== null;
  return (
    <Dialog
      title={addon ? 'Upload the add-on invoice' : 'Upload Invoice PDF'}
      description={
        addon
          ? 'Choose the invoice PDF for the approved add-on services. It is stored privately and shown to the consultant and everyone who may see this customer.'
          : 'Choose the invoice PDF. It is stored privately and shown to everyone who may see this customer.'
      }
      onClose={onClose}
      wide
      persistent
    >
      {!picked ? (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Search customer</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the customer, business or customer ID" className={`${inputCls} pl-9`} />
          </label>
          {error && <ErrorBanner message={error} />}
          {!customers ? (
            <Spinner label="Loading customers…" />
          ) : customers.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">No customer found. An invoice is always uploaded for an existing customer.</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-72 overflow-y-auto" aria-label="Customers">
              {customers.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setPicked({ id: c.id, label: c.company || c.name, sub: [c.customerCode, c.department].filter(Boolean).join(' · ') })}
                    className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-xs hover:bg-slate-50"
                  >
                    <span className="font-semibold text-slate-800">{c.company || c.name}</span>
                    <span className="text-slate-500">{[c.customerCode, c.department].filter(Boolean).join(' · ')}</span>
                    <span className="ml-auto text-slate-500">Deal {money(c.dealAmount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" className={btn.secondary} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" aria-label="Upload invoice PDF">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs">
            <div>
              <div className="font-bold text-slate-900">{picked.label}</div>
              {picked.sub && <div className="text-slate-500">{picked.sub}</div>}
            </div>
            {!preset && (
              <button type="button" className={btn.secondary} disabled={busy} onClick={() => setPicked(null)}>
                Change customer
              </button>
            )}
          </div>
          <PdfPicker id="ui-file" file={file} onFile={f => void chooseFile(f)} disabled={busy} error={fileError} />
          {error && <ErrorBanner message={error} />}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {busy && (
              <span role="status" className="mr-auto text-xs font-semibold text-indigo-700">
                {phaseLabel[phase!]}
              </span>
            )}
            <button type="button" className={btn.secondary} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={btn.primary} disabled={busy || !file || !!fileError}>
              <UploadCloud className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Uploading…' : 'Upload invoice'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// Replace the PDF of an uploaded invoice (confirmation first; the current file stays if it fails)
// ---------------------------------------------------------------------------
export const ReplaceInvoiceDialog: React.FC<{ invoice: Invoice; onClose: () => void; onReplaced: (invoice: Invoice) => void }> = ({ invoice, onClose, onReplaced }) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<null | keyof typeof phaseLabel>(null);
  const submitting = useRef(false);

  const chooseFile = async (f: File | null) => {
    setFile(f);
    setFileError(f ? await invoicePdfProblem(f) : null);
  };
  const submit = async () => {
    if (submitting.current || !file) return;
    submitting.current = true;
    setError(null);
    setPhase('checking');
    try {
      const problem = await invoicePdfProblem(file);
      if (problem) {
        setFileError(problem);
        return;
      }
      onReplaced(await uploadInvoicePdf(file, () => invoicesApi.beginReplacement(invoice.id, { fileName: file.name, mimeType: 'application/pdf', sizeBytes: file.size }), p => setPhase(p)));
    } catch (err) {
      setError(`${errorMessage(err)} The current invoice PDF is unchanged.`);
    } finally {
      submitting.current = false;
      setPhase(null);
    }
  };
  const busy = phase !== null;
  return (
    <Dialog
      title={`Replace the PDF of invoice ${invoice.number}?`}
      description={`The current file${invoice.file ? ` (${invoice.file.fileName})` : ''} is kept as an earlier version that only Accounts can open. Everyone sees the new file once it is saved.`}
      onClose={onClose}
      persistent
    >
      <PdfPicker id="ri-file" file={file} onFile={f => void chooseFile(f)} disabled={busy} error={fileError} />
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {busy && (
          <span role="status" className="mr-auto text-xs font-semibold text-indigo-700">
            {phaseLabel[phase!]}
          </span>
        )}
        <button type="button" className={btn.secondary} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btn.primary} disabled={busy || !file || !!fileError} onClick={() => void submit()}>
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Replacing…' : 'Replace PDF'}
        </button>
      </div>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// The PDF section of an uploaded invoice's detail view
// ---------------------------------------------------------------------------
export const InvoiceFilePanel: React.FC<{ invoice: Invoice; canManage?: boolean; onChanged?: (invoice: Invoice) => void }> = ({ invoice, canManage, onChanged }) => {
  const f = invoice.file;
  const [replacing, setReplacing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!f) return <p className="text-xs text-slate-500">The PDF of this invoice is not available.</p>;
  return (
    <section aria-label="Invoice PDF" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/60">
        <span className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0" aria-hidden="true">
          <FileText className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900 break-all">{f.fileName}</div>
          <div className="text-[11px] text-slate-500">
            {fmtBytes(f.sizeBytes)} · uploaded {stamp(f.uploadedAt)} by {f.uploadedBy || 'Accounts'}
            {f.versionCount > 1 ? ` · version ${f.version} of ${f.versionCount}` : ''}
          </div>
        </div>
        <InvoiceFileButtons file={f} number={invoice.number} />
      </div>
      {notice && (
        <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.secondary} onClick={() => setReplacing(true)}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Replace PDF
          </button>
        </div>
      )}
      {canManage && f.versions.length > 0 && (
        <details className="rounded-xl border border-slate-200 p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-700">Earlier versions ({f.versions.length})</summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {f.versions.map(v => (
              <li key={v.documentId} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-semibold text-slate-800 break-all">{v.fileName}</span>
                <span className="text-slate-500">
                  version {v.version} · {fmtBytes(v.sizeBytes)} · {longDate(v.uploadedAt)} by {v.uploadedBy || 'Accounts'}
                </span>
                <span className="ml-auto">
                  <InvoiceFileButtons file={{ ...f, ...v }} number={invoice.number} compact />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {replacing && (
        <ReplaceInvoiceDialog
          invoice={invoice}
          onClose={() => setReplacing(false)}
          onReplaced={inv => {
            setReplacing(false);
            setNotice('The PDF was replaced. The earlier file is kept as an older version.');
            onChanged?.(inv);
          }}
        />
      )}
    </section>
  );
};
