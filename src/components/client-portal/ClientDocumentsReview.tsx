import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, FileText, RefreshCw, XCircle } from 'lucide-react';
import type { ClientDocumentQueueItem } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { Empty, ErrorBanner, Loading, PageHeader, inputClass } from '../support-member/SupportParts';
import { btn } from '../team-member/pipeline/shared';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '-');

/**
 * Support / Technical Consultant: the documents and details clients uploaded from their own dashboard (for example
 * something they missed during onboarding, or the documents of a service bought later). Verify each one or send it
 * back with a note; the client is told either way.
 */
export const ClientDocumentsReview: React.FC = () => {
  const [tab, setTab] = useState<'PENDING' | 'REVIEWED'>('PENDING');
  const [items, setItems] = useState<ClientDocumentQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    pipelineApi.clientDocumentQueue(tab).then(
      r => { setItems(r); setError(null); },
      e => setError(errorMessage(e))
    );
  }, [tab]);
  useEffect(() => { setItems(null); load(); }, [load]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; contact: string; rows: ClientDocumentQueueItem[] }>();
    for (const i of items ?? []) {
      const g = m.get(i.customerId) ?? { name: i.customer, contact: i.contact, rows: [] };
      g.rows.push(i);
      m.set(i.customerId, g);
    }
    return [...m.entries()];
  }, [items]);

  const key = (i: ClientDocumentQueueItem) => `${i.customerId}|${i.itemCode}`;
  const decide = async (i: ClientDocumentQueueItem, decision: 'VERIFIED' | 'REJECTED') => {
    if (decision === 'REJECTED' && !note.trim()) { setError('Tell the client what needs fixing.'); return; }
    setBusy(key(i)); setError(null);
    try {
      await pipelineApi.reviewClientDocument(i.customerId, i.itemCode, decision, decision === 'REJECTED' ? note.trim() : undefined);
      setRejecting(null); setNote('');
      load();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(''); }
  };
  const open = async (i: ClientDocumentQueueItem) => {
    if (!i.documentId) return;
    const tabWin = window.open('', '_blank');
    try {
      const r = await pipelineApi.clientUploadUrl(i.documentId, 'view');
      if (tabWin) { tabWin.opener = null; tabWin.location.href = r.url; }
    } catch (e) { tabWin?.close(); setError(errorMessage(e)); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Client documents"
        subtitle="Documents and details your clients uploaded from their own dashboard. Verify each one, or send it back with a note: the client is told either way."
        action={<button type="button" className={btn.secondary} onClick={load}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>}
      />
      <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold" role="tablist" aria-label="Show">
        {([['PENDING', 'To verify'], ['REVIEWED', 'Reviewed (30 days)']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-lg ${tab === id ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>
        ))}
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!items && !error ? <Loading label="Loading client documents..." /> : null}
      {items && items.length === 0 && (
        <Empty title={tab === 'PENDING' ? 'Nothing is waiting' : 'Nothing reviewed lately'} hint={tab === 'PENDING' ? 'When a client uploads a document or fills in a detail, it appears here.' : undefined} />
      )}
      {groups.map(([customerId, g]) => (
        <section key={customerId} className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden" aria-label={g.name}>
          <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 truncate">{g.name}</h2>
              <p className="text-[11px] text-slate-500 truncate">{g.contact}</p>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">{g.rows.length} item{g.rows.length === 1 ? '' : 's'}</span>
          </header>
          <ul className="divide-y divide-slate-100">
            {g.rows.map(i => (
              <li key={key(i)} className="px-5 py-3.5">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                      <span className="text-sm font-semibold text-slate-900">{i.label}</span>
                      {i.services.length > 0 && <span className="text-[11px] text-slate-500">{i.services.join(', ')}</span>}
                      {i.status === 'VERIFIED' && <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold">Verified</span>}
                      {i.status === 'REJECTED' && <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 text-[11px] font-semibold">Sent back</span>}
                    </div>
                    <p className="text-xs text-slate-600 mt-1 break-words">{i.kind === 'FILE' ? i.fileName || i.value : i.value}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Provided {when(i.savedAt)}
                      {i.reviewedAt ? ` · reviewed ${when(i.reviewedAt)}${i.reviewedBy ? ` by ${i.reviewedBy}` : ''}` : ''}
                    </p>
                    {i.status === 'REJECTED' && i.reviewNote && <p className="text-[11px] text-rose-700 mt-0.5">Note to the client: {i.reviewNote}</p>}
                  </div>
                  {i.status === 'SAVED' && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {i.kind === 'FILE' && i.documentId && <button type="button" className={btn.secondary} onClick={() => open(i)}><Eye className="w-3.5 h-3.5" /> Open</button>}
                      <button type="button" className={btn.green} disabled={busy === key(i)} onClick={() => decide(i, 'VERIFIED')}><CheckCircle2 className="w-3.5 h-3.5" /> Verify</button>
                      <button type="button" className={btn.danger} disabled={busy === key(i)} onClick={() => { setRejecting(rejecting === key(i) ? null : key(i)); setNote(''); setError(null); }}><XCircle className="w-3.5 h-3.5" /> Send back</button>
                    </div>
                  )}
                </div>
                {rejecting === key(i) && (
                  <div className="mt-3 flex flex-col sm:flex-row gap-2">
                    <input className={inputClass} placeholder="What does the client need to fix?" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} aria-label={`Note to the client for ${i.label}`} autoFocus />
                    <button type="button" className={btn.danger} disabled={busy === key(i)} onClick={() => decide(i, 'REJECTED')}>Send back to the client</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
