import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ConsultantOpenServiceRequest, ConsultantServiceRequest, ServiceRequestStatus } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { clientWorkApi } from '../../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, notifyPipelineChanged, Pill, inputCls, usePipelineRealtime, type Tone } from '../../team-member/pipeline/shared';

const STATUS: Record<ServiceRequestStatus, { label: string; tone: Tone }> = {
  REQUESTED: { label: 'New request', tone: 'orange' },
  IN_REVIEW: { label: 'In review', tone: 'indigo' },
  IN_ADDON_WORKFLOW: { label: 'With Accounts', tone: 'indigo' },
  ACTIVATED: { label: 'Activated', tone: 'green' },
  REJECTED: { label: 'Declined', tone: 'red' },
  CANCELLED: { label: 'Withdrawn', tone: 'slate' }
};

/** The services the customer asked for from their own dashboard. `undefined` while loading. */
export function useClientServiceRequests(customerId: string) {
  const [items, setItems] = useState<ConsultantServiceRequest[] | undefined>(undefined);
  const load = useCallback(() => {
    clientWorkApi.serviceRequests(customerId).then(setItems, () => setItems([]));
  }, [customerId]);
  useEffect(load, [load]);
  usePipelineRealtime(load);
  return { items, reload: load };
}

/**
 * Technical Consultant: what the customer asked for in their dashboard. Asking does not buy anything: the consultant takes
 * the request into review (then prices it in the add-on request below, which goes to Accounts for verification and payment)
 * or declines it with a reason the customer will read.
 */
export const ClientServiceRequestsCard: React.FC<{ customerId: string }> = ({ customerId }) => {
  const { items, reload } = useClientServiceRequests(customerId);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<ConsultantServiceRequest | null>(null);
  const [reason, setReason] = useState('');

  if (!items || items.length === 0) return null;

  const decide = async (r: ConsultantServiceRequest, decision: 'IN_REVIEW' | 'REJECTED', note?: string) => {
    setBusy(r.id); setError(null);
    try {
      await clientWorkApi.decideServiceRequest(r.id, { decision, note: note || null });
      setDeclining(null); setReason('');
      reload(); notifyPipelineChanged();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(''); }
  };

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4" aria-label="Services the customer asked for">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Sparkles className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Asked for in the customer dashboard</h3>
      <p className="text-xs text-slate-500 mt-0.5">The customer has not bought these yet. Take a request into review, then add the service with its price in the add-on request below: it goes to Accounts to verify and collect payment before anything is activated.</p>
      {error && <div className="mt-2"><ErrorBanner message={error} /></div>}
      <ul className="mt-3 divide-y divide-indigo-100">
        {items.map(r => (
          <li key={r.id} className="py-2.5 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm font-semibold text-slate-900">{r.serviceName}</p>
              {r.note && <p className="text-xs text-slate-600">"{r.note}"</p>}
              {r.decisionNote && <p className="text-xs text-slate-500">Note shared with the customer: {r.decisionNote}</p>}
            </div>
            <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
            {r.status === 'REQUESTED' && <button type="button" className={btn.primary} disabled={busy === r.id} onClick={() => decide(r, 'IN_REVIEW')}>Start review</button>}
            {(r.status === 'REQUESTED' || r.status === 'IN_REVIEW') && <button type="button" className={btn.danger} disabled={busy === r.id} onClick={() => { setDeclining(r); setReason(''); }}>Decline</button>}
          </li>
        ))}
      </ul>
      {declining && (
        <Dialog title={`Decline ${declining.serviceName}`} description="The customer will see this reason in their dashboard." onClose={() => setDeclining(null)}>
          <div className="space-y-3">
            <textarea className={inputCls} rows={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why can this not go ahead?" aria-label="Reason" />
            <div className="flex justify-end gap-2">
              <button type="button" className={btn.secondary} onClick={() => setDeclining(null)}>Cancel</button>
              <button type="button" className={btn.danger} disabled={!reason.trim() || busy === declining.id} onClick={() => decide(declining, 'REJECTED', reason.trim())}>Decline request</button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
};

/**
 * Add-ons Services page: every open request from customers' dashboards in one list, so a request is found even when the
 * customer is already past the consultant's onboarding step.
 */
export const OpenClientRequests: React.FC<{ onOpenCustomer: (customerId: string) => void }> = ({ onOpenCustomer }) => {
  const [items, setItems] = useState<ConsultantOpenServiceRequest[] | undefined>(undefined);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<ConsultantOpenServiceRequest | null>(null);
  const [reason, setReason] = useState('');
  const load = useCallback(() => {
    clientWorkApi.openServiceRequests().then(r => { setItems(r); setError(null); }, e => { setItems([]); setError(errorMessage(e)); });
  }, []);
  useEffect(load, [load]);
  usePipelineRealtime(load);

  const decide = async (r: ConsultantOpenServiceRequest, decision: 'IN_REVIEW' | 'REJECTED', note?: string) => {
    setBusy(r.id); setError(null);
    try { await clientWorkApi.decideServiceRequest(r.id, { decision, note: note || null }); setDeclining(null); setReason(''); load(); notifyPipelineChanged(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  };

  if (!items || (items.length === 0 && !error)) return null;
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4" aria-label="Services customers asked for">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Sparkles className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Asked for by customers ({items.length})</h2>
      <p className="text-xs text-slate-500 mt-0.5">Customers asked for these in their dashboard. Nothing is bought yet: review the request, then price it and send it to Accounts for verification and payment.</p>
      {error && <div className="mt-2"><ErrorBanner message={error} /></div>}
      <ul className="mt-3 divide-y divide-indigo-100">
        {items.map(r => (
          <li key={r.id} className="py-2.5 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-semibold text-slate-900">{r.serviceName} <span className="font-normal text-slate-500">for {r.customer}</span></p>
              {r.note && <p className="text-xs text-slate-600">"{r.note}"</p>}
            </div>
            <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
            {r.status === 'REQUESTED' && <button type="button" className={btn.secondary} disabled={busy === r.id} onClick={() => decide(r, 'IN_REVIEW')}>Start review</button>}
            <button type="button" className={btn.primary} onClick={() => onOpenCustomer(r.customerId)}>Price and send to Accounts</button>
            <button type="button" className={btn.danger} disabled={busy === r.id} onClick={() => { setDeclining(r); setReason(''); }}>Decline</button>
          </li>
        ))}
      </ul>
      {declining && (
        <Dialog title={`Decline ${declining.serviceName}`} description="The customer will see this reason in their dashboard." onClose={() => setDeclining(null)}>
          <div className="space-y-3">
            <textarea className={inputCls} rows={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why can this not go ahead?" aria-label="Reason" />
            <div className="flex justify-end gap-2">
              <button type="button" className={btn.secondary} onClick={() => setDeclining(null)}>Cancel</button>
              <button type="button" className={btn.danger} disabled={!reason.trim() || busy === declining.id} onClick={() => decide(declining, 'REJECTED', reason.trim())}>Decline request</button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
};
