import React, { useCallback, useEffect, useState } from 'react';
import { Tag } from 'lucide-react';
import type { InvoiceBusinessInfo, InvoiceBusinessKind } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessReportApi } from '../../lib/api/endpoints';
import { btn, ErrorBanner, Field, inputCls, selectCls, useServiceCatalog } from '../team-member/pipeline/shared';

const KIND_LABEL: Record<InvoiceBusinessKind, string> = {
  RENEWAL: 'A renewal of a subscription or service (credited to Support)',
  ADDON: 'An add-on service bought outside the add-on workflow (credited to Support)',
  OTHER: 'Something else (credited to neither department)'
};
const monthLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

/**
 * Accounts: say what an additional invoice is. The business reports credit a renewal or an add-on to the Support Department;
 * an additional invoice nobody has classified is credited to neither, so the figures never guess.
 * Linking the Support member's invoice request credits that member.
 */
export const InvoiceBusinessCard: React.FC<{ invoiceId: string }> = ({ invoiceId }) => {
  const [info, setInfo] = useState<InvoiceBusinessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<InvoiceBusinessKind | ''>('');
  const [service, setService] = useState('');
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const { items: services } = useServiceCatalog();

  const load = useCallback(() => {
    businessReportApi.invoiceBusiness(invoiceId).then(
      i => {
        setInfo(i);
        setKind(i.tag?.kind ?? '');
        setService(i.tag?.serviceCode ?? '');
        setRequest(i.tag?.invoiceRequestId ?? '');
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [invoiceId]);
  useEffect(load, [load]);

  if (!info && !error) return null;
  if (info && info.purpose !== 'ADDITIONAL') return null;

  const save = async () => {
    if (!kind) return;
    setBusy(true);
    setSaved(false);
    try {
      await businessReportApi.tagInvoice(invoiceId, { kind, serviceCode: service || null, invoiceRequestId: request || null });
      setSaved(true);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3" aria-label="What this invoice is">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
        <Tag className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" /> What is this additional invoice?
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {info && (
        <>
          {!info.tag && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Not classified yet: payments on this invoice are credited to neither Sales nor Support until you choose.</p>}
          {info.locked && <p className="text-[11px] text-slate-600">Payments are verified, so only the Super Admin can change this now.</p>}
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Kind" htmlFor={`ib-kind-${invoiceId}`}>
              <select id={`ib-kind-${invoiceId}`} className={selectCls} value={kind} disabled={info.locked} onChange={e => setKind(e.target.value as InvoiceBusinessKind | '')}>
                <option value="">Choose…</option>
                {(Object.keys(KIND_LABEL) as InvoiceBusinessKind[]).map(k => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="Service (optional)" htmlFor={`ib-service-${invoiceId}`}>
              <select id={`ib-service-${invoiceId}`} className={selectCls} value={service} disabled={info.locked} onChange={e => setService(e.target.value)}>
                <option value="">Not specified</option>
                {services.map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Support member's invoice request" htmlFor={`ib-req-${invoiceId}`}>
              <select id={`ib-req-${invoiceId}`} className={selectCls} value={request} disabled={info.locked} onChange={e => setRequest(e.target.value)}>
                <option value="">None (no employee recorded)</option>
                {info.requests.map(r => (
                  <option key={r.id} value={r.id}>{r.requestedByName || 'Support member'} · {monthLabel(r.fromMonth)}{r.toMonth !== r.fromMonth ? ` – ${monthLabel(r.toMonth)}` : ''}</option>
                ))}
                {info.tag?.invoiceRequestId && !info.requests.some(r => r.id === info.tag?.invoiceRequestId) && <option value={info.tag.invoiceRequestId}>{info.tag.responsible || 'Linked request'}</option>}
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className={btn.primary} disabled={busy || !kind || info.locked} onClick={() => void save()}>
              {busy ? 'Saving…' : info.tag ? 'Update' : 'Save'}
            </button>
            {saved && <span role="status" className="text-xs font-semibold text-emerald-700">Saved.</span>}
            {info.tag?.responsible && <span className="text-xs text-slate-600">Responsible: <b>{info.tag.responsible}</b></span>}
          </div>
        </>
      )}
    </section>
  );
};
