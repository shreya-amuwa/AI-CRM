import React, { useId, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  HelpCircle,
  History,
  KeyRound,
  ListChecks,
  Loader2,
  PencilLine,
  RefreshCw,
  Trash2,
  Upload,
  XCircle
} from 'lucide-react';
import type { ChecklistItem, CustomerDocument, PipelineCustomerDetail, ServiceCatalogItem } from '../../../../shared/contracts';
import type { UploadMimeType } from '../../../../shared/validation';
import { errorMessage } from '../../../lib/api/client';
import { documentsApi, pipelineApi } from '../../../lib/api/endpoints';
import { requireSupabase } from '../../../services/supabaseClient';
import { btn, categoryDot, Dialog, ErrorBanner, inputCls, money, Pill, shortDate } from './shared';

export type ChecklistMode = 'sales' | 'review';

const KIND_LABEL: Record<ChecklistItem['kind'], string> = {
  DETAILS: 'DETAILS',
  FILE: 'FILE',
  YES_NO: 'YES / NO',
  APPROVAL: 'APPROVAL',
  ACCESS: 'ACCESS',
  AMOUNT: 'AMOUNT',
  CHOICE: 'CHOICE'
};
const ACTION_LABEL: Record<ChecklistItem['kind'], string> = {
  FILE: 'Upload',
  DETAILS: 'Add details',
  YES_NO: 'Answer',
  APPROVAL: 'Mark approved',
  ACCESS: 'Mark granted',
  AMOUNT: 'Add amount',
  CHOICE: 'Choose'
};
const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'text/csv': 'CSV',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'audio/mp4': 'M4A'
};
const EXT_MIME: Record<string, UploadMimeType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4'
};

export const isDone = (i: ChecklistItem) => i.entry?.status === 'SAVED' || i.entry?.status === 'VERIFIED';
/** Optional items (e.g. Website URL) only count towards progress once filled in. */
export const counts = (i: ChecklistItem) => !(i.optional && !i.entry);

function displayValue(item: ChecklistItem): string {
  const v = item.entry?.value || '';
  if (item.kind === 'YES_NO') return v === 'YES' ? 'Yes' : v === 'NO' ? 'No' : v;
  if (item.kind === 'AMOUNT') return money(Number(v));
  return v;
}

/** Sections in display order: Business basics, each sold service, Mandatory Documents last. */
function groupItems(items: ChecklistItem[], catalog: Map<string, ServiceCatalogItem>) {
  const groups: { key: string; title: string; dot: string; items: ChecklistItem[] }[] = [];
  const get = (key: string, title: string, dot: string) => {
    let g = groups.find(x => x.key === key);
    if (!g) groups.push((g = { key, title, dot, items: [] }));
    return g;
  };
  for (const i of items.filter(x => x.section === 'BUSINESS_BASICS')) get('BASICS', 'Business basics', 'bg-indigo-600').items.push(i);
  for (const i of items.filter(x => x.section === 'SERVICE')) {
    const s = i.serviceCode ? catalog.get(i.serviceCode) : undefined;
    get(i.serviceCode || 'OTHER', s?.name || 'Other', categoryDot(s?.category)).items.push(i);
  }
  for (const i of items.filter(x => x.section === 'MANDATORY_DOCUMENTS')) get('MANDATORY', 'Mandatory Documents', 'bg-indigo-600').items.push(i);
  return groups;
}

export const ChecklistPanel: React.FC<{
  customer: PipelineCustomerDetail;
  catalog: Map<string, ServiceCatalogItem>;
  mode: ChecklistMode;
  onChanged: () => void;
}> = ({ customer, catalog, mode, onChanged }) => {
  const [tab, setTab] = useState<'all' | 'pending' | 'saved'>('all');
  const items = customer.checklist;
  const groups = useMemo(() => groupItems(items, catalog), [items, catalog]);
  const forwarded = !!customer.onboarding?.forwardedToSupportAt;
  const counted = items.filter(counts);
  const doneCount = items.filter(isDone).length;
  const visible = (i: ChecklistItem) => (tab === 'all' ? true : tab === 'saved' ? isDone(i) : !isDone(i) && counts(i));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Documents &amp; details</h2>
          <p className="text-xs text-slate-500">
            {mode === 'review' ? 'Verify each item, or send it back with a note' : 'Checklist built from the services sold'}
          </p>
        </div>
        <div role="tablist" aria-label="Show items" className="flex p-1 rounded-xl bg-slate-100 text-xs font-semibold">
          {(
            [
              ['all', `All ${items.length}`],
              ['pending', `Pending ${counted.length - doneCount}`],
              ['saved', `Saved ${doneCount}`]
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg ${tab === k ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {groups.map(g => {
        const shown = g.items.filter(visible);
        if (!shown.length) return null;
        const mandatory = g.key === 'MANDATORY';
        const headingId = mandatory ? 'mandatory-docs-heading' : `section-${g.key}`;
        return (
          <section key={g.key} aria-labelledby={headingId} className="mt-6">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <span className={`w-2 h-2 rounded-full ${g.dot}`} aria-hidden="true" />
              <h3 id={headingId} className="text-sm font-bold text-slate-900">
                {g.title}
              </h3>
              <span className="text-xs text-slate-500">
                {g.items.filter(isDone).length} of {g.items.filter(counts).length} saved
              </span>
            </div>
            <ol className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {shown.map(item => (
                <ChecklistCard
                  key={item.code}
                  item={item}
                  // The two mandatory documents are numbered, as in the design.
                  title={mandatory ? `${g.items.indexOf(item) + 1}. ${item.label}` : item.label}
                  customer={customer}
                  mode={mode}
                  locked={forwarded}
                  onChanged={onChanged}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// One checklist card
// ---------------------------------------------------------------------------
async function looksLike(file: File, mime: string): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const ascii = (a: number, b: number) => String.fromCharCode(...head.subarray(a, b));
  switch (mime) {
    case 'application/pdf':
      return String.fromCharCode(...head).includes('%PDF-');
    case 'image/png':
      return head[0] === 0x89 && ascii(1, 4) === 'PNG';
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'audio/wav':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    case 'audio/mp4':
      return ascii(4, 8) === 'ftyp';
    case 'audio/mpeg':
      return ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
    case 'text/csv':
      return head.length > 0 && !head.includes(0);
    default:
      return false;
  }
}

const fmtSize = (n: number | null) =>
  n === null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;

const ChecklistCard: React.FC<{
  item: ChecklistItem;
  title: string;
  customer: PipelineCustomerDetail;
  mode: ChecklistMode;
  locked: boolean;
  onChanged: () => void;
}> = ({ item, title, customer, mode, locked, onChanged }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<null | 'checking' | 'uploading' | 'verifying'>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | 'edit' | 'reject' | 'view'>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomerDocument | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [dragging, setDragging] = useState(false);
  const entry = item.entry;
  const done = isDone(item);
  const isFile = item.kind === 'FILE';
  const currentDoc = isFile ? customer.documents.find(d => d.documentType === item.code && d.status === 'UPLOADED') || null : null;
  const history = isFile ? customer.documents.filter(d => d.documentType === item.code && d.status === 'SUPERSEDED') : [];
  const allowed = item.allowedMimeTypes || ['application/pdf'];
  const maxSize = fmtSize(item.maxSizeBytes || 512000);
  const typesText = allowed.map(m => MIME_LABEL[m] || m).join(', ');
  const accept = allowed.flatMap(m => [m, ...Object.entries(EXT_MIME).filter(([, v]) => v === m).map(([e]) => `.${e}`)]).join(',');

  const upload = async (file: File) => {
    setError(null);
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const mime = (allowed.includes(file.type) ? file.type : EXT_MIME[ext]) as UploadMimeType | undefined;
    if (!mime || !allowed.includes(mime)) return setError(`Accepted: ${typesText}. Upload a single file.`);
    if (file.size === 0) return setError('This file is empty.');
    if (file.size > (item.maxSizeBytes || 0)) return setError(`The file is larger than ${maxSize}. Please compress it and try again.`);
    setPhase('checking');
    if (!(await looksLike(file, mime))) {
      setPhase(null);
      return setError(
        mime === 'application/pdf'
          ? 'Only a single PDF file is accepted. Please combine the documents into one PDF.'
          : `This file is not a real ${MIME_LABEL[mime]} file.`
      );
    }
    let documentId: string | null = null;
    try {
      const ticket = await documentsApi.beginUpload(customer.id, { documentType: item.code, fileName: file.name, mimeType: mime, sizeBytes: file.size });
      documentId = ticket.document.id;
      setPhase('uploading');
      const { error: upErr } = await requireSupabase()
        .storage.from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, await file.arrayBuffer(), { contentType: mime, upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      setPhase('verifying');
      await documentsApi.complete(documentId);
      documentId = null;
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      if (documentId) await documentsApi.abort(documentId).catch(() => undefined);
    } finally {
      setPhase(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const open = async (doc: CustomerDocument, action: 'view' | 'download') => {
    setError(null);
    const win = action === 'view' ? window.open('', '_blank') : null;
    try {
      const { url } = await documentsApi.url(doc.id, action);
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
      setError(errorMessage(e));
    }
  };

  /** Clicking anywhere on the card (not on its own buttons) opens the item. */
  const openCard = () => {
    if (phase || busy) return;
    if (isFile) {
      if (currentDoc) void open(currentDoc, 'view');
      else if (mode === 'sales') inputRef.current?.click();
      return;
    }
    setDialog(mode === 'sales' ? 'edit' : 'view');
  };

  const review = async (decision: 'VERIFIED' | 'REJECTED', note?: string) => {
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.reviewChecklistItem(customer.id, item.code, { decision, note: note || null });
      setDialog(null);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const status = entry?.status;
  const pill =
    status === 'VERIFIED' ? (
      <Pill tone="green">Verified</Pill>
    ) : status === 'REJECTED' ? (
      <Pill tone="red">Needs fix</Pill>
    ) : status === 'SAVED' ? (
      <Pill tone={mode === 'review' ? 'indigo' : 'green'}>{mode === 'review' ? 'To review' : 'Saved'}</Pill>
    ) : (
      <Pill tone="orange">Pending</Pill>
    );
  const Icon = isFile ? (done ? FileText : Upload) : item.kind === 'ACCESS' ? KeyRound : item.kind === 'DETAILS' ? PencilLine : ListChecks;
  const phaseLabel = { checking: 'Checking file…', uploading: 'Uploading…', verifying: 'Verifying…' } as const;

  const subtitle = (() => {
    if (isFile && currentDoc) {
      return `${currentDoc.originalFileName} · ${fmtSize(currentDoc.sizeBytes)} · ${shortDate(currentDoc.uploadedAt)}${currentDoc.uploadedBy ? ` · ${currentDoc.uploadedBy.fullName}` : ''}`;
    }
    if (entry && !isFile) return displayValue(item);
    if (isFile) return mode === 'sales' ? `${typesText}, up to ${maxSize}. Drop the file here or upload.` : 'Not uploaded yet';
    return item.hint || 'Not filled yet';
  })();

  return (
    <li
      tabIndex={0}
      onClick={e => {
        if ((e.target as HTMLElement).closest('button, a, input, textarea, select, label, [role="dialog"], .fixed')) return;
        openCard();
      }}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openCard();
        }
      }}
      className={`cursor-pointer p-4 rounded-2xl border flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        status === 'REJECTED'
          ? 'border-rose-200 bg-rose-50/40'
          : done
            ? 'border-slate-200 bg-white'
            : 'border-dashed border-indigo-200 bg-indigo-50/30'
      } ${dragging ? 'ring-2 ring-indigo-400' : ''}`}
      onDragOver={e => {
        if (!isFile || mode !== 'sales' || phase) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        if (!isFile || mode !== 'sales') return;
        e.preventDefault();
        setDragging(false);
        const files = e.dataTransfer.files;
        if (phase || !files.length) return;
        if (files.length > 1) return setError('Drop a single file.');
        void upload(files[0]);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${done ? 'bg-indigo-50 text-indigo-600' : 'bg-indigo-100/70 text-indigo-600'}`} aria-hidden="true">
          <Icon className="w-4 h-4" />
        </span>
        {pill}
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <h4 className="text-sm font-bold text-slate-900">{title}</h4>
        {item.code === 'IMPORTANT_DOCUMENTS' && <InfoTip text={item.hint} />}
        {item.optional && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Optional</span>}
      </div>
      <p className="text-xs text-slate-500 mt-0.5 break-words whitespace-pre-line line-clamp-4">{subtitle}</p>
      {entry && !isFile && entry.savedBy && (
        <p className="text-[11px] text-slate-400 mt-0.5">
          {entry.savedBy} · {shortDate(entry.savedAt)}
        </p>
      )}
      {status === 'REJECTED' && entry?.reviewNote && (
        <p className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5" role="note">
          <b>Needs fixing:</b> {entry.reviewNote}
          {entry.reviewedBy ? ` — ${entry.reviewedBy}` : ''}
        </p>
      )}
      {status === 'VERIFIED' && entry?.reviewedBy && (
        <p className="mt-1 text-[11px] text-emerald-700 inline-flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" /> Verified by {entry.reviewedBy}
        </p>
      )}
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mt-auto pt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-wide text-slate-500">{KIND_LABEL[item.kind]}</span>
        <div className="flex flex-wrap gap-1.5">
          {isFile && (
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          )}
          {phase ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {phaseLabel[phase]}
            </span>
          ) : (
            <>
              {isFile && currentDoc && (
                <>
                  <button type="button" className={btn.secondary} onClick={() => open(currentDoc, 'view')} aria-label={`View ${item.label}`}>
                    <Eye className="w-3.5 h-3.5" /> View
                  </button>
                  <button type="button" className={btn.secondary} onClick={() => open(currentDoc, 'download')} aria-label={`Download ${item.label}`}>
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {mode === 'sales' && isFile && (
                <>
                  <button
                    type="button"
                    className={currentDoc ? btn.secondary : btn.primary}
                    onClick={() => inputRef.current?.click()}
                    aria-label={`${currentDoc ? 'Replace' : 'Upload'} ${item.label}`}
                  >
                    {currentDoc ? <RefreshCw className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />} {currentDoc ? 'Replace' : 'Upload'}
                  </button>
                  {currentDoc && !locked && (
                    <button type="button" className={btn.danger} onClick={() => setConfirmDelete(currentDoc)} aria-label={`Delete ${item.label}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
              {mode === 'sales' && !isFile && (
                <button type="button" className={entry ? btn.secondary : btn.primary} onClick={() => setDialog('edit')} aria-label={`${entry ? 'Edit' : ACTION_LABEL[item.kind]} — ${item.label}`}>
                  {entry ? 'Edit' : ACTION_LABEL[item.kind]}
                </button>
              )}
              {/* A sent-back item waits for sales to fix it before it can be verified. */}
              {mode === 'review' && entry && status === 'SAVED' && (
                <button type="button" className={btn.green} disabled={busy} onClick={() => review('VERIFIED')} aria-label={`Verify ${item.label}`}>
                  <Check className="w-3.5 h-3.5" /> Verify
                </button>
              )}
              {mode === 'review' && entry && status !== 'REJECTED' && (
                <button type="button" className={btn.danger} disabled={busy} onClick={() => setDialog('reject')} aria-label={`Send back ${item.label}`}>
                  <XCircle className="w-3.5 h-3.5" /> Send back
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900"
            aria-expanded={showHistory}
            onClick={() => setShowHistory(v => !v)}
          >
            <History className="w-3.5 h-3.5" /> Previous versions ({history.length})
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1.5">
              {history.map(d => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                  <span className="truncate">
                    v{d.version} · {d.originalFileName} · {shortDate(d.uploadedAt)}
                  </span>
                  <span className="flex gap-1 shrink-0">
                    <button type="button" className="underline" onClick={() => open(d, 'view')}>
                      View
                    </button>
                    {mode === 'sales' && (
                      <button type="button" className="underline text-rose-700" onClick={() => setConfirmDelete(d)}>
                        Delete
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialog === 'edit' && <EntryDialog item={item} customerId={customer.id} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged(); }} />}
      {dialog === 'view' && (
        <Dialog title={item.label} description={item.hint || undefined} onClose={() => setDialog(null)}>
          <p className="text-sm text-slate-800 whitespace-pre-line break-words">{entry ? displayValue(item) || '—' : 'Not filled yet.'}</p>
          {entry?.savedBy && (
            <p className="text-[11px] text-slate-500">
              {entry.savedBy} · {shortDate(entry.savedAt)}
            </p>
          )}
          <div className="flex justify-end pt-1">
            <button type="button" className={btn.secondary} onClick={() => setDialog(null)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
      {dialog === 'reject' && <RejectDialog label={item.label} busy={busy} error={error} onClose={() => setDialog(null)} onReject={note => review('REJECTED', note)} />}
      {confirmDelete && (
        <DeleteDialog
          doc={confirmDelete}
          label={item.label}
          onClose={() => setConfirmDelete(null)}
          onDeleted={() => {
            setConfirmDelete(null);
            onChanged();
          }}
        />
      )}
    </li>
  );
};

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
const EntryDialog: React.FC<{ item: ChecklistItem; customerId: string; onClose: () => void; onSaved: () => void }> = ({
  item,
  customerId,
  onClose,
  onSaved
}) => {
  const current = item.entry?.value || '';
  const [value, setValue] = useState(() => {
    if (item.kind === 'APPROVAL' || item.kind === 'ACCESS') return current;
    return current;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (v: string) => {
    if (!v.trim()) return setError('Enter a value.');
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.saveChecklistItem(customerId, item.code, { value: v.trim() });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const footer = (submitLabel: string, v: string) => (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
        Cancel
      </button>
      <button type="button" className={btn.primary} disabled={busy} onClick={() => save(v)}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </div>
  );

  return (
    <Dialog title={item.label} description={item.hint || undefined} onClose={onClose}>
      <div className="space-y-3">
        {item.kind === 'YES_NO' ? (
          <div className="flex gap-2" role="group" aria-label={item.label}>
            {(['YES', 'NO'] as const).map(v => (
              <button key={v} type="button" className={`${value === v ? btn.primary : btn.secondary} flex-1`} disabled={busy} onClick={() => save(v)}>
                {v === 'YES' ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
        ) : item.kind === 'CHOICE' ? (
          <>
            <label className="block text-xs font-medium text-slate-600" htmlFor="entry-choice">
              Choose one
            </label>
            <select id="entry-choice" className={inputCls} value={value} onChange={e => setValue(e.target.value)}>
              <option value="">Select…</option>
              {(item.options || []).map(o => (
                <option key={o}>{o}</option>
              ))}
            </select>
            {footer('Save', value)}
          </>
        ) : item.kind === 'AMOUNT' ? (
          <>
            <label className="block text-xs font-medium text-slate-600" htmlFor="entry-amount">
              Amount (₹)
            </label>
            <input id="entry-amount" type="number" min={0} step="0.01" inputMode="decimal" className={inputCls} value={value} onChange={e => setValue(e.target.value)} />
            {footer('Save', value)}
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-slate-600" htmlFor="entry-text">
              {item.kind === 'ACCESS' ? 'How was access given? (e.g. partner access, BM ID)' : item.kind === 'APPROVAL' ? 'Approval note (who approved, when)' : 'Details'}
            </label>
            <textarea id="entry-text" rows={item.kind === 'DETAILS' ? 5 : 3} maxLength={4000} className={inputCls} value={value} onChange={e => setValue(e.target.value)} />
            {footer(item.kind === 'ACCESS' ? 'Mark granted' : item.kind === 'APPROVAL' ? 'Mark approved' : 'Save', value)}
          </>
        )}
        {error && <ErrorBanner message={error} />}
      </div>
    </Dialog>
  );
};

const RejectDialog: React.FC<{ label: string; busy: boolean; error: string | null; onClose: () => void; onReject: (note: string) => void }> = ({
  label,
  busy,
  error,
  onClose,
  onReject
}) => {
  const [note, setNote] = useState('');
  return (
    <Dialog title={`Send back: ${label}`} description="The salesperson is notified and sees your note on this item." onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-600" htmlFor="reject-note">
          What needs fixing?
        </label>
        <textarea id="reject-note" rows={3} maxLength={1000} className={inputCls} value={note} onChange={e => setNote(e.target.value)} />
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={btn.danger} disabled={busy || !note.trim()} onClick={() => onReject(note.trim())}>
            {busy ? 'Sending…' : 'Send back'}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

const DeleteDialog: React.FC<{ doc: CustomerDocument; label: string; onClose: () => void; onDeleted: () => void }> = ({ doc, label, onClose, onDeleted }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog
      title={`Delete ${label}?`}
      description={`${doc.originalFileName}${doc.version ? ` (version ${doc.version})` : ''} will be removed from this customer's record. This is logged and cannot be undone.`}
      onClose={onClose}
    >
      {err && <ErrorBanner message={err} />}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await documentsApi.remove(doc.id);
              onDeleted();
            } catch (e) {
              setErr(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Dialog>
  );
};

/** Small "?" help button; tooltip shows on hover and keyboard focus, Escape hides it. */
export const InfoTip: React.FC<{ text: string }> = ({ text }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label="What should be in this PDF?"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => e.key === 'Escape' && setOpen(false)}
        className="w-5 h-5 rounded-full text-slate-500 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 inline-flex items-center justify-center"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 max-w-[80vw] p-2.5 rounded-lg bg-slate-900 text-white text-[11px] leading-snug font-normal shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
};
