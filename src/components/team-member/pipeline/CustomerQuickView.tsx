import React, { useEffect, useState } from 'react';
import type { PaymentOverview, PipelineCustomerDetail } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { fmtDate, fmtDateTime, MoneyTiles, PaymentHistory, PaymentStatusBadge, WorkflowBadge } from '../../payments/PaymentBits';
import { ErrorBanner, Loading, Modal } from '../../support-member/SupportParts';
import { ActivityCard } from './LeadForms';
import { ServiceChips, useServiceCatalog } from './shared';

/** A customer's details in a pop-up (opened by clicking a row). Read-only. */
export const CustomerQuickView: React.FC<{ id: string; title?: string; onClose: () => void }> = ({ id, title, onClose }) => {
  const { byCode } = useServiceCatalog();
  const [c, setC] = useState<PipelineCustomerDetail | null>(null);
  const [pay, setPay] = useState<PaymentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pipelineApi.get(id).then(setC, e => setError(errorMessage(e)));
    pipelineApi.paymentOverview(id).then(setPay, () => setPay(null));
  }, [id]);

  return (
    <Modal title={title || c?.company || c?.name || 'Customer'} wide onClose={onClose}>
      {error ? (
        <ErrorBanner message={error} />
      ) : !c ? (
        <Loading label="Loading customer..." />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <PaymentStatusBadge status={c.paymentStatus} />
            <WorkflowBadge workflow={c.paymentWorkflow} />
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {(
              [
                ['Business', c.company],
                ['Contact person', c.name],
                ['Phone', c.phone],
                ['WhatsApp', c.whatsapp],
                ['E-mail', c.email],
                ['City', c.city],
                ['Lead source', c.leadSource],
                ['Salesperson', c.owner?.fullName],
                ['Next follow-up', c.nextFollowUpAt ? fmtDateTime(c.nextFollowUpAt) : null],
                ['Payment due', c.paymentDueDate ? fmtDate(c.paymentDueDate) : null]
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] text-slate-400">{k}</dt>
                <dd className="font-semibold text-slate-900 break-words">{v || '-'}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="text-xs font-bold text-slate-800 mb-2">Services</h3>
            <ServiceChips codes={c.services} catalog={byCode} max={12} />
          </div>
          {pay && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-800">Payments</h3>
              <MoneyTiles deal={pay.dealAmount} verified={pay.verified} pending={pay.pending} balance={pay.balance} />
              <PaymentHistory payments={pay.payments} />
            </div>
          )}
          {c.conversations.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-800 mb-2">Last conversation</h3>
              <p className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-900 whitespace-pre-line break-words">{c.conversations[0].note}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {c.conversations[0].author ? `${c.conversations[0].author.fullName} · ` : ''}
                {fmtDateTime(c.conversations[0].occurredAt)}
              </p>
            </div>
          )}
          <ActivityCard activities={c.activities} title="Last activities" />
        </div>
      )}
    </Modal>
  );
};
