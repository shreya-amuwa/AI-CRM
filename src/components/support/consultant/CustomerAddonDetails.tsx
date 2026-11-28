import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Download, Eye, FileText, XCircle } from 'lucide-react';
import type { AddonRequest, ChecklistItem, CustomerDocument } from '../../../../shared/contracts';
import { addonsApi, documentsApi, pipelineApi } from '../../../lib/api/endpoints';
import { ErrorBanner, money, usePipelineRealtime } from '../../team-member/pipeline/shared';
import { userMessage } from '../../../lib/feedback/errors';

/**
 * One customer's add-on services (what the Technical Consultant priced and Accounts approved) and the
 * add-on documents / details collected for them, with their review status and a way to open each file.
 */
const STATUS = {
  VERIFIED: { label: 'Authorized', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  SAVED: { label: 'Pending review', cls: 'bg-amber-50 text-amber-700 border-amber-200', Icon: Clock },
  REJECTED: { label: 'Not authorized', cls: 'bg-rose-50 text-rose-700 border-rose-200', Icon: XCircle },
  MISSING: { label: 'Not uploaded yet', cls: 'bg-slate-100 text-slate-500 border-slate-200', Icon: Clock }
} as const;

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '';

export const CustomerAddonDetails: React.FC<{ customerId: string; documents: CustomerDocument[] }> = ({ customerId, documents }) => {
  const [request, setRequest] = useState<AddonRequest | null | undefined>(undefined);
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([addonsApi.request(customerId), pipelineApi.addonChecklist(customerId)]).then(
      ([r, c]) => {
        setRequest(r);
        setItems(c);
        setError(null);
      },
      e => setError(userMessage(e))
    );
  }, [customerId]);
  useEffect(load, [load]);
  usePipelineRealtime(load);

  const open = async (documentId: string, action: 'view' | 'download') => {
    setError(null);
    const win = action === 'view' ? window.open('', '_blank') : null;
    try {
      const { url } = await documentsApi.url(documentId, action);
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (e) {
      win?.close();
      setError(userMessage(e));
    }
  };

  if (error && request === undefined) return <ErrorBanner message={error} onRetry={load} />;
  if (request === undefined || !items) return null;
  // The documents Accounts' approval unlocked; an item with nothing saved yet is still listed so the consultant sees what is missing.
  const docs = items;

  return (
    <div className="space-y-4">
      {request && request.items.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-900">Add-on services requested</h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Add-on services">
            {request.items.map((l, i) => (
              <li key={l.id ?? i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                <span className="font-semibold text-slate-900">{l.name}</span>
                <span className="text-xs text-slate-500">
                  {l.quantity} × {money(l.unitPrice)}
                  {l.discount ? ` − ${money(l.discount)} discount` : ''}
                  {l.taxPercent ? ` + ${l.taxPercent}% tax` : ''}
                </span>
                <span className="ml-auto font-bold text-slate-900">{money(l.lineTotal ?? l.quantity * l.unitPrice)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between px-3 py-2.5 text-sm bg-slate-50/70 rounded-b-xl">
              <span className="font-semibold text-slate-700">Total</span>
              <span className="font-bold text-slate-900">{money(request.total)}</span>
            </li>
          </ul>
        </div>
      )}

      {docs.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-900">Add-on documents &amp; details</h3>
          <ul className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-3 items-start" aria-label="Add-on documents">
            {docs.map(item => {
              const e = item.entry;
              const S = STATUS[e?.status ?? 'MISSING'];
              const doc = e?.documentId ? documents.find(d => d.id === e.documentId) : undefined;
              const detail = item.kind === 'FILE' ? doc?.originalFileName ?? e?.value : e?.value;
              return (
                <li key={item.code} className="p-3 rounded-xl border border-slate-200 bg-slate-50/40">
                  <div className="flex items-start gap-2.5">
                    <FileText className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{item.label}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${S.cls}`}>
                          <S.Icon className="w-3 h-3" aria-hidden="true" /> {S.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 break-words">
                        {detail ? `${detail}${e ? ` · ${when(e.savedAt)}` : ''}` : item.kind === 'FILE' ? 'Not uploaded yet' : 'Not filled in yet'}
                      </p>
                      {e?.status === 'VERIFIED' && e.reviewedAt && <p className="text-[11px] text-emerald-700 mt-0.5">Authorized {when(e.reviewedAt)}</p>}
                      {e?.status === 'REJECTED' && e.reviewNote && <p className="text-[11px] text-rose-700 mt-0.5">{e.reviewNote}</p>}
                      {doc && (
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={() => void open(doc.id, 'view')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold hover:bg-slate-50">
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" /> View
                          </button>
                          <button type="button" onClick={() => void open(doc.id, 'download')} aria-label={`Download ${item.label}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold hover:bg-slate-50">
                            <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && <ErrorBanner message={error} />}
    </div>
  );
};
