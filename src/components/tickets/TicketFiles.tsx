import React, { useCallback, useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, X } from 'lucide-react';
import type { ClientDocumentUrl, TicketAttachment, TicketUploadTicket } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { looksLike } from '../../lib/checklistUpload';
import { uploadToTicket } from '../../lib/uploadToTicket';
import './ticketFiles.css';

/** Same limits the database enforces (and chat uses): 5 files per message, 5 MB each, these types. */
export const TICKET_MAX_FILE = 5 * 1024 * 1024;
export const TICKET_MAX_FILES = 5;
const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
const SNIFFED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const ACCEPT = Object.keys(TYPES).map(e => `.${e}`).join(',');
export const TICKET_FILE_HINT = `Up to ${TICKET_MAX_FILES} files, 5 MB each: images, PDF, text, CSV, Word or Excel.`;

export const fileSizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** How files get to the server: the client dashboard and the staff screens use different endpoints, the steps are the same. */
export interface TicketFileTransport {
  begin(body: { ticketId?: string; customerId?: string; fileName: string; mimeType: string; sizeBytes: number }): Promise<TicketUploadTicket>;
  complete(id: string): Promise<TicketAttachment>;
  abort(id: string): Promise<unknown>;
  url(id: string, action: 'view' | 'download'): Promise<ClientDocumentUrl>;
}

/** Files chosen for the next message: each is checked here, uploaded, and finished on the server. The server checks all of it again. */
export function useTicketFiles(transport: TicketFileTransport, scope: { ticketId?: string; customerId?: string }) {
  const [staged, setStaged] = useState<TicketAttachment[]>([]);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState('');
  const count = useRef(0);
  count.current = staged.length + uploading.length;

  const add = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setError('');
    for (const file of Array.from(files)) {
      if (count.current >= TICKET_MAX_FILES) { setError(`You can attach up to ${TICKET_MAX_FILES} files at a time.`); break; }
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const mime = TYPES[ext];
      if (!mime) { setError(`${file.name}: this file type cannot be attached. Use an image, PDF, text, CSV, Word or Excel file.`); continue; }
      if (file.size === 0) { setError(`${file.name} is empty.`); continue; }
      if (file.size > TICKET_MAX_FILE) { setError(`${file.name} is larger than 5 MB.`); continue; }
      count.current += 1;
      setUploading(u => [...u, file.name]);
      let id: string | null = null;
      try {
        if (SNIFFED.has(mime) && !(await looksLike(file, mime))) throw new Error(`${file.name} is not a real ${ext.toUpperCase()} file.`);
        const ticket = await transport.begin({ ...scope, fileName: file.name, mimeType: mime, sizeBytes: file.size });
        id = ticket.attachment.id;
        await uploadToTicket(ticket, file, mime);
        const done = await transport.complete(id);
        id = null;
        setStaged(s => [...s, done]);
      } catch (e) {
        setError(errorMessage(e));
        if (id) void transport.abort(id).catch(() => undefined);
      } finally {
        setUploading(u => { const i = u.indexOf(file.name); return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)]; });
      }
    }
  }, [transport, scope.ticketId, scope.customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A finished upload that is taken out is simply not sent; it stays an unattached draft only its uploader can open.
  const remove = useCallback((id: string) => setStaged(s => s.filter(x => x.id !== id)), []);
  const clear = useCallback(() => { setStaged([]); setError(''); }, []);
  return { staged, uploading, error, add, remove, clear, setError, ids: staged.map(a => a.id), busy: uploading.length > 0 };
}
export type TicketFiles = ReturnType<typeof useTicketFiles>;

/** The paperclip: opens the file picker. */
export const TicketFileButton: React.FC<{ files: TicketFiles; disabled?: boolean; label?: boolean; className?: string }> = ({ files, disabled, label, className }) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={e => { void files.add(e.target.files); e.target.value = ''; }} />
      <button type="button" className={`tf-attach ${className ?? ''}`} onClick={() => input.current?.click()} disabled={disabled || files.staged.length + files.uploading.length >= TICKET_MAX_FILES}
        aria-label="Attach a file" title={TICKET_FILE_HINT}>
        <Paperclip size={16} aria-hidden />{label ? <span>Attach files</span> : null}
      </button>
    </>
  );
};

/** The files waiting to be sent, plus the limit hint and any problem. */
export const StagedFiles: React.FC<{ files: TicketFiles; hint?: boolean }> = ({ files, hint }) => (
  <div className="tf-staged-wrap">
    {(files.staged.length > 0 || files.uploading.length > 0) && (
      <ul className="tf-staged" aria-label="Attached files">
        {files.staged.map(a => (
          <li key={a.id}>
            <FileText size={14} aria-hidden /><span title={a.name}>{a.name}</span><small>{fileSizeLabel(a.size)}</small>
            <button type="button" onClick={() => files.remove(a.id)} aria-label={`Remove ${a.name}`}><X size={12} /></button>
          </li>
        ))}
        {files.uploading.map((n, i) => <li key={`u${i}`} className="busy"><Loader2 size={14} className="tf-spin" aria-hidden /><span>{n}</span></li>)}
      </ul>
    )}
    {hint && files.staged.length === 0 && files.uploading.length === 0 && <p className="tf-hint">{TICKET_FILE_HINT}</p>}
    {files.error && <p className="tf-error" role="alert">{files.error}</p>}
  </div>
);

/** The files of one message; clicking one opens it through a short-lived link the server issues after checking access. */
export const MessageFiles: React.FC<{ items: TicketAttachment[]; transport: TicketFileTransport }> = ({ items, transport }) => {
  const [opening, setOpening] = useState('');
  const [problem, setProblem] = useState('');
  if (items.length === 0) return null;
  const open = async (a: TicketAttachment) => {
    setOpening(a.id); setProblem('');
    // opened before the answer arrives, so the browser does not take it for a pop-up
    const win = window.open('', '_blank');
    try {
      const { url } = await transport.url(a.id, 'view');
      if (win) { win.opener = null; win.location.href = url; } else window.location.assign(url);
    } catch (e) {
      win?.close();
      setProblem(errorMessage(e));
    } finally {
      setOpening('');
    }
  };
  return (
    <>
      <ul className="tf-files">
        {items.map(a => (
          <li key={a.id}>
            <button type="button" onClick={() => void open(a)} disabled={opening === a.id} aria-label={`Open ${a.name}`}>
              {opening === a.id ? <Loader2 size={14} className="tf-spin" aria-hidden /> : <FileText size={14} aria-hidden />}
              <span className="tf-name">{a.name}</span><span className="tf-size">{fileSizeLabel(a.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      {problem && <p className="tf-error" role="alert">{problem}</p>}
    </>
  );
};
