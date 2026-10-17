import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Eye, FileText, FolderUp, Info, PencilLine, Upload } from 'lucide-react';
import type { ClientDocumentItem } from '../../shared/contracts';
import { clientApi } from './api';
import { useClientLive, useLoad } from './hooks';
import { errorMessage } from '../lib/api/client';
import { uploadToTicket } from '../lib/uploadToTicket';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Query, fmtDate } from './ui';

const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WEBP', 'text/csv': 'CSV',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel', 'audio/mpeg': 'MP3', 'audio/wav': 'WAV', 'audio/mp4': 'M4A'
};
const STATUS: Record<ClientDocumentItem['status'], { label: string; tone: 'neutral' | 'attention' | 'success' | 'danger' | 'info' }> = {
  MISSING: { label: 'Not provided yet', tone: 'neutral' },
  SAVED: { label: 'Waiting for our team to check', tone: 'info' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Needs your attention', tone: 'danger' }
};
type Filter = 'ALL' | 'NEEDED' | 'REVIEW' | 'VERIFIED';

function sizeLabel(bytes: number | null): string {
  if (!bytes) return '';
  return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${Math.round(bytes / 1048576)} MB`;
}

export const Documents: React.FC = () => {
  const q = useLoad(() => clientApi.documents());
  // A verification (or a request to fix something) arrives as a notification: the page refreshes itself.
  useClientLive(q.reload);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<ClientDocumentItem | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pickFor = useRef<ClientDocumentItem | null>(null);

  const upload = async (item: ClientDocumentItem, file: File) => {
    setError(''); setNotice('');
    const accepted = item.allowedMimeTypes ?? [];
    if (accepted.length && !accepted.includes(file.type)) {
      setError(`${item.label}: this file type is not accepted. Use ${accepted.map(m => MIME_LABEL[m] ?? m).join(', ')}.`);
      return;
    }
    if (item.maxSizeBytes && file.size > item.maxSizeBytes) {
      setError(`${item.label}: the file is larger than ${sizeLabel(item.maxSizeBytes)}. Please upload a smaller file.`);
      return;
    }
    setBusy(item.code);
    let ticket;
    try {
      ticket = await clientApi.beginDocumentUpload({ itemCode: item.code, fileName: file.name, mimeType: file.type, sizeBytes: file.size });
    } catch (e) { setError(`${item.label}: ${errorMessage(e)}`); setBusy(''); return; }
    try {
      await uploadToTicket(ticket, file, file.type);
      await clientApi.completeDocumentUpload(ticket.document.id);
      setNotice(`${item.label} was uploaded. Our team will check it and let you know.`);
      q.reload();
    } catch (e) {
      await clientApi.abortDocumentUpload(ticket.document.id).catch(() => undefined);
      setError(`${item.label}: ${errorMessage(e)}`);
    } finally { setBusy(''); }
  };

  const view = async (item: ClientDocumentItem) => {
    if (!item.documentId) return;
    setError('');
    const tab = window.open('', '_blank');
    try {
      const r = await clientApi.documentUrl(item.documentId, 'view');
      if (tab) { tab.opener = null; tab.location.href = r.url; }
    } catch (e) { tab?.close(); setError(errorMessage(e)); }
  };

  return (
    <>
      <PageHeader title="Documents" subtitle="Upload any document or detail we are still waiting for, including the ones for services you buy later. Our team checks each one." />
      <input
        ref={picker} type="file" hidden
        onChange={e => { const f = e.target.files?.[0]; const item = pickFor.current; e.target.value = ''; if (f && item) void upload(item, f); }}
      />
      {error && <div className="cd-banner danger" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
      {notice && <div className="cd-banner success" role="status" style={{ marginBottom: 14 }}><CheckCircle2 size={18} style={{ flexShrink: 0 }} /><span>{notice}</span></div>}
      <Query
        q={q}
        errorTitle="We could not load your documents"
        empty={d => d.items.length === 0 ? <Card><EmptyState icon={<FolderUp size={24} />} title="Nothing to upload" text="When one of your services needs a document or a detail from you, it will be listed here." /></Card> : null}
      >
        {data => {
          const needed = data.items.filter(i => (i.status === 'MISSING' && !i.optional) || i.status === 'REJECTED');
          const shown = data.items.filter(i =>
            filter === 'ALL' ? true : filter === 'NEEDED' ? (i.status === 'MISSING' || i.status === 'REJECTED') : filter === 'REVIEW' ? i.status === 'SAVED' : i.status === 'VERIFIED');
          const pct = data.summary.total ? Math.round((data.summary.provided / data.summary.total) * 100) : 0;
          return (
            <div className="cd-stack" style={{ gap: 16 }}>
              <Card className="cd-doc-summary">
                <div className="cd-between" style={{ gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <p className="cd-label">Your progress</p>
                    <p className="cd-big">{data.summary.provided}<span style={{ fontSize: 18, fontWeight: 600 }} className="cd-muted"> of {data.summary.total} provided</span></p>
                    <p className="cd-small cd-muted">{data.summary.verified} verified by our team</p>
                  </div>
                  <div className="cd-doc-meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Documents provided">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </Card>
              {needed.length > 0 && (
                <div className="cd-banner attention"><AlertCircle size={18} style={{ flexShrink: 0 }} /><span><b>{needed.length} item{needed.length === 1 ? '' : 's'} still needed:</b> {needed.map(n => n.label).join(', ')}.</span></div>
              )}
              <div className="cd-chips" role="group" aria-label="Show">
                {([['ALL', 'All'], ['NEEDED', 'To provide'], ['REVIEW', 'In review'], ['VERIFIED', 'Verified']] as [Filter, string][]).map(([id, label]) =>
                  <button key={id} className="cd-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
              </div>
              <Groups items={shown} busy={busy} onUpload={i => { pickFor.current = i; if (picker.current) { picker.current.accept = (i.allowedMimeTypes ?? []).join(','); picker.current.click(); } }}
                onEdit={setEditing} onView={view} />
              {shown.length === 0 && <Card><EmptyState icon={<FileText size={24} />} title="Nothing here" text="No item matches this filter." /></Card>}
            </div>
          );
        }}
      </Query>
      {editing && <DetailDialog item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice(`${editing.label} was saved. Our team will check it and let you know.`); q.reload(); }} />}
    </>
  );
};

/** Items grouped the way the client thinks: about the business, then each service, then the important documents. */
const Groups: React.FC<{ items: ClientDocumentItem[]; busy: string; onUpload: (i: ClientDocumentItem) => void; onEdit: (i: ClientDocumentItem) => void; onView: (i: ClientDocumentItem) => void }> = ({ items, busy, onUpload, onEdit, onView }) => {
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; order: number; items: ClientDocumentItem[] }>();
    const add = (key: string, title: string, order: number, i: ClientDocumentItem) => {
      const g = m.get(key) ?? { title, order, items: [] };
      g.items.push(i); m.set(key, g);
    };
    for (const i of items) {
      if (i.section === 'BUSINESS_BASICS') add('basics', 'About your business', 0, i);
      else if (i.section === 'MANDATORY_DOCUMENTS') add('mandatory', 'Important documents', 9999, i);
      else if (i.services.length) add(i.services[0].code, i.services[0].name, 10 + i.sortOrder, i);
      else add('other', 'Other details', 5000, i);
    }
    return [...m.values()].sort((a, b) => a.order - b.order);
  }, [items]);
  return (
    <>
      {groups.map(g => (
        <section key={g.title} aria-label={g.title}>
          <h2 className="cd-section-title" style={{ marginBottom: 10 }}>{g.title}</h2>
          <Card style={{ padding: 6 }}>
            <ul className="cd-doc-list">
              {g.items.map(i => <Row key={i.code} item={i} busy={busy === i.code} onUpload={onUpload} onEdit={onEdit} onView={onView} />)}
            </ul>
          </Card>
        </section>
      ))}
    </>
  );
};

const Row: React.FC<{ item: ClientDocumentItem; busy: boolean; onUpload: (i: ClientDocumentItem) => void; onEdit: (i: ClientDocumentItem) => void; onView: (i: ClientDocumentItem) => void }> = ({ item, busy, onUpload, onEdit, onView }) => {
  const st = STATUS[item.status];
  const isFile = item.kind === 'FILE';
  const Icon = item.status === 'VERIFIED' ? CheckCircle2 : item.status === 'SAVED' ? Clock3 : item.status === 'REJECTED' ? AlertCircle : isFile ? Upload : PencilLine;
  return (
    <li className={`cd-doc ${item.status.toLowerCase()}`}>
      <span className="cd-doc-ic" aria-hidden><Icon size={20} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="cd-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <p style={{ fontWeight: 700 }}>{item.label}{item.optional ? <span className="cd-small cd-muted" style={{ fontWeight: 500 }}> (optional)</span> : null}</p>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        {item.hint && <p className="cd-small cd-muted">{item.hint}</p>}
        {item.status !== 'MISSING' && item.value && (
          <p className="cd-small" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>{isFile ? <><FileText size={13} style={{ verticalAlign: '-2px' }} /> {item.value}</> : item.value}{item.savedAt ? <span className="cd-muted"> · {fmtDate(item.savedAt)}</span> : null}</p>
        )}
        {item.status === 'REJECTED' && item.reviewNote && (
          <div className="cd-banner attention" style={{ marginTop: 8, padding: 10 }}><Info size={16} style={{ flexShrink: 0 }} /><span><b>Our team says:</b> {item.reviewNote}</span></div>
        )}
        {isFile && item.status === 'MISSING' && item.allowedMimeTypes && (
          <p className="cd-small cd-muted" style={{ marginTop: 4 }}>{item.allowedMimeTypes.map(m => MIME_LABEL[m] ?? m).join(', ')} · up to {sizeLabel(item.maxSizeBytes)}</p>
        )}
      </div>
      <div className="cd-doc-actions">
        {isFile && item.documentId && item.status !== 'MISSING' && <Button variant="outline" small onClick={() => onView(item)} aria-label={`View ${item.label}`}><Eye size={14} /> View</Button>}
        {item.canEdit && (isFile
          ? <Button variant={item.status === 'MISSING' || item.status === 'REJECTED' ? 'primary' : 'outline'} small loading={busy} onClick={() => onUpload(item)} aria-label={`${item.status === 'MISSING' ? 'Upload' : 'Replace'} ${item.label}`}><Upload size={14} /> {item.status === 'MISSING' ? 'Upload' : item.status === 'REJECTED' ? 'Upload again' : 'Replace'}</Button>
          : <Button variant={item.status === 'MISSING' || item.status === 'REJECTED' ? 'primary' : 'outline'} small onClick={() => onEdit(item)} aria-label={`${item.status === 'MISSING' ? 'Add' : 'Edit'} ${item.label}`}><PencilLine size={14} /> {item.status === 'MISSING' ? 'Add' : 'Edit'}</Button>)}
      </div>
    </li>
  );
};

const DetailDialog: React.FC<{ item: ClientDocumentItem; onClose: () => void; onSaved: () => void }> = ({ item, onClose, onSaved }) => {
  const [value, setValue] = useState(item.value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!value.trim()) { setError('Enter a value.'); return; }
    setSaving(true); setError('');
    try { await clientApi.saveDetail(item.code, value.trim()); onSaved(); }
    catch (e) { setError(errorMessage(e)); setSaving(false); }
  };
  return (
    <Modal title={item.label} onClose={onClose}>
      <div className="cd-stack">
        {item.hint && <p className="cd-small cd-muted">{item.hint}</p>}
        <Field label="Your answer" htmlFor="doc-detail">
          {item.kind === 'CHOICE' && item.options
            ? <select id="doc-detail" className="cd-input" value={value} onChange={e => setValue(e.target.value)}><option value="">Choose...</option>{item.options.map(o => <option key={o}>{o}</option>)}</select>
            : <textarea id="doc-detail" className="cd-textarea" rows={4} maxLength={4000} value={value} onChange={e => setValue(e.target.value)} autoFocus />}
        </Field>
        {error && <div className="cd-banner danger" role="alert">{error}</div>}
        <div className="cd-row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save</Button>
        </div>
      </div>
    </Modal>
  );
};
