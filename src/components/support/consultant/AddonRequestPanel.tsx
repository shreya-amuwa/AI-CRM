import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, History, Save, Send } from 'lucide-react';
import type { AddonRequest } from '../../../../shared/contracts';
import { addonsApi } from '../../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, inputCls, longDate, notifyPipelineChanged, Pill, Spinner, usePipelineRealtime, useServiceCatalog } from '../../team-member/pipeline/shared';
import {
  addonPaymentState,
  AddonStatusPill,
  InvoiceDetail,
  type LineDraft,
  linesFrom,
  newLine,
  PricedLinesEditor,
  rupees,
  toInput,
  Totals,
  validateLines
} from '../../invoices/invoiceShared';
import { ClientServiceRequestsCard, useClientServiceRequests } from './ClientServiceRequests';
import { userMessage } from '../../../lib/feedback/errors';

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Draft created',
  SAVED: 'Draft saved',
  SUBMITTED: 'Submitted for Accounts Verification',
  CHANGES_REQUESTED: 'Accounts asked for changes',
  REJECTED: 'Rejected by Accounts',
  APPROVED: 'Approved by Accounts',
  INVOICE_GENERATED: 'Invoice uploaded',
  PAYMENT_RECORDED: 'Payment recorded',
  PAYMENT_VERIFIED: 'Payment verified',
  PAYMENT_REJECTED: 'Payment rejected',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  DOCUMENTS_STARTED: 'Add-on document collection started',
  COMPLETED: 'Add-ons completed'
};

/** The request's history, newest first. */
export const AddonEvents: React.FC<{ events: AddonRequest['events'] }> = ({ events }) =>
  events && events.length > 0 ? (
    <details className="rounded-xl border border-slate-200 p-3 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-700 inline-flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" aria-hidden="true" /> History ({events.length})
      </summary>
      <ol className="mt-2 space-y-1.5">
        {[...events].reverse().map((e, i) => (
          <li key={i} className="flex flex-wrap gap-x-2 text-slate-600">
            <span className="font-semibold text-slate-800">{EVENT_LABEL[e.action] || e.action}</span>
            {e.note && <span>· {e.note}</span>}
            <span className="text-slate-400">
              · {e.by || 'System'} · {longDate(e.at)}
            </span>
          </li>
        ))}
      </ol>
    </details>
  ) : null;

/**
 * Technical Consultant: the add-on services a customer agreed to, with the agreed prices.
 * Editable as a draft or after Accounts asks for changes; "Submit for Accounts Verification" locks
 * it until Accounts decides. Shows the decision, the invoice and the payment once they exist.
 */
export const AddonRequestEditor: React.FC<{
  customerId: string;
  originalServices: string[];
  onChanged?: (r: AddonRequest) => void;
}> = ({ customerId, originalServices, onChanged }) => {
  const { items: catalog, byCode } = useServiceCatalog();
  const [request, setRequest] = useState<AddonRequest | null | undefined>(undefined);
  const [lines, setLines] = useState<LineDraft[] | null>(null);
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const clientRequests = useClientServiceRequests(customerId).items;

  const load = useCallback(() => {
    addonsApi.request(customerId).then(
      r => {
        setRequest(r);
        setError(null);
      },
      e => setError(userMessage(e))
    );
  }, [customerId]);
  useEffect(load, [load]);
  // Accounts decides in another dashboard: pick the decision up without a reload (not while typing).
  usePipelineRealtime(() => !editing && load());

  // A rejected or completed request is closed: the next save starts a new request.
  const closed = !request || request.status === 'REJECTED' || request.status === 'COMPLETED';
  const canEdit = !request || !!request.canEdit || closed;

  const startEditing = () => {
    const fromRequest = request && request.items.length ? linesFrom(request.items) : null;
    // Suggest what the customer asked for in their dashboard, else a catalogue service they do not already have.
    const asked = clientRequests?.find(r => (r.status === 'REQUESTED' || r.status === 'IN_REVIEW') && !originalServices.includes(r.serviceCode))?.serviceCode;
    const first = asked || catalog.find(s => !originalServices.includes(s.code))?.code || catalog[0]?.code || '';
    setLines(fromRequest || [newLine(first)]);
    setNotes(request && !closed ? request.notes || '' : '');
    setSaved(null);
    setError(null);
    setEditing(true);
  };
  useEffect(() => {
    // Open straight in edit mode while it is still a draft / changes are asked (or nothing yet).
    if (request !== undefined && clientRequests !== undefined && catalog.length && !editing && lines === null && (!request || request.canEdit)) startEditing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, catalog.length, clientRequests]);

  const save = async (submit: boolean) => {
    if (!lines) return;
    const problem = validateLines(lines);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const r = await addonsApi.save(customerId, {
        items: toInput(lines),
        notes: notes.trim() || null,
        submit,
        expectedVersion: request && !closed ? request.version : undefined
      });
      setRequest(r);
      setSaved(submit ? 'Submitted for Accounts Verification. Accounts has been notified.' : 'Draft saved.');
      if (submit) {
        setEditing(false);
        setLines(null);
      } else setLines(linesFrom(r.items));
      notifyPipelineChanged();
      onChanged?.(r);
    } catch (e) {
      setError(userMessage(e));
      load();
    } finally {
      setBusy(false);
      setConfirmSubmit(false);
    }
  };

  if (request === undefined) return error ? <ErrorBanner message={error} onRetry={load} /> : <Spinner label="Loading add-on request…" />;
  const pay = request ? addonPaymentState(request) : null;

  return (
    <section aria-label="Add-on services request" className="space-y-3">
      <ClientServiceRequestsCard customerId={customerId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-slate-900">Add-on services and prices</h3>
          {request && <AddonStatusPill status={request.status} />}
          {request?.invoice && pay && <Pill tone={pay.tone}>{pay.label}</Pill>}
        </div>
        {!editing && canEdit && (
          <button type="button" className={btn.secondary} onClick={startEditing}>
            {closed && request ? 'Start a new request' : 'Edit'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Original services: {originalServices.length ? originalServices.map(c => byCode.get(c)?.name || c).join(', ') : '-'}. Add-ons are separate: they start only after Accounts approves them,
        uploads the invoice and confirms the payment.
      </p>

      {request && (request.status === 'CHANGES_REQUESTED' || request.status === 'REJECTED') && request.decisionNote && (
        <div role="note" className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2 border ${request.status === 'REJECTED' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <b>{request.status === 'REJECTED' ? 'Rejected' : 'Changes requested'} by {request.decidedBy || 'Accounts'}:</b> {request.decisionNote}
          </span>
        </div>
      )}
      {saved && (
        <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {saved}
        </p>
      )}
      {error && <ErrorBanner message={error} />}

      {editing && lines ? (
        <div className="space-y-3">
          <PricedLinesEditor lines={lines} onChange={setLines} catalog={catalog} disabled={busy} idPrefix={`ar-${customerId}`} />
          <div>
            <label htmlFor={`ar-notes-${customerId}`} className="block text-xs font-medium text-slate-600 mb-1">
              Notes for Accounts
            </label>
            <textarea id={`ar-notes-${customerId}`} rows={2} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} placeholder="e.g. Customer agreed to this price on the call of 12 Oct." />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {request && !closed && !request.canEdit ? null : (
              <>
                {request && !closed && (
                  <button
                    type="button"
                    className={btn.secondary}
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setLines(null);
                      setError(null);
                    }}
                  >
                    Cancel
                  </button>
                )}
                <button type="button" className={btn.secondary} disabled={busy} onClick={() => void save(false)}>
                  <Save className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Saving…' : 'Save draft'}
                </button>
                <button type="button" className={btn.primary} disabled={busy} onClick={() => (validateLines(lines) ? setError(validateLines(lines)) : setConfirmSubmit(true))}>
                  <Send className="w-3.5 h-3.5" aria-hidden="true" /> Submit for Accounts Verification
                </button>
              </>
            )}
          </div>
        </div>
      ) : request ? (
        <div className="space-y-3">
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Add-on</th>
                  <th className="text-right font-semibold px-3 py-2">Qty</th>
                  <th className="text-right font-semibold px-3 py-2">Unit price</th>
                  <th className="text-right font-semibold px-3 py-2">Discount</th>
                  <th className="text-right font-semibold px-3 py-2">Tax</th>
                  <th className="text-right font-semibold px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {request.items.map(i => (
                  <tr key={i.id || i.name}>
                    <td className="px-3 py-2 text-slate-800">{i.name}</td>
                    <td className="px-3 py-2 text-right">{i.quantity}</td>
                    <td className="px-3 py-2 text-right">{rupees(i.unitPrice)}</td>
                    <td className="px-3 py-2 text-right">{i.discount ? rupees(i.discount) : '-'}</td>
                    <td className="px-3 py-2 text-right">{i.taxPercent}%</td>
                    <td className="px-3 py-2 text-right font-semibold">{rupees(i.lineTotal ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Totals subtotal={request.subtotal} discount={request.discount} tax={request.tax} total={request.total} />
          {request.notes && <p className="text-xs text-slate-600">Notes: {request.notes}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            {request.submittedAt && <span>Submitted {longDate(request.submittedAt)}</span>}
            {request.decidedAt && (
              <span>
                Decided {longDate(request.decidedAt)} by {request.decidedBy || 'Accounts'}
              </span>
            )}
            {request.paymentConfirmedAt && (
              <span>
                Payment confirmed {longDate(request.paymentConfirmedAt)} by {request.paymentConfirmedBy || 'Accounts'}
              </span>
            )}
          </div>
          {request.invoice && (
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs">
              <span className="font-semibold text-slate-800">Invoice {request.invoice.number}</span>
              <span className="text-slate-500">{rupees(request.invoice.total)}</span>
              {pay && <Pill tone={pay.tone}>{pay.label}</Pill>}
              <button type="button" className={`${btn.secondary} ml-auto`} onClick={() => setShowInvoice(true)}>
                View invoice
              </button>
            </div>
          )}
          {request.status === 'PENDING_VERIFICATION' && <p className="text-xs text-slate-500">Waiting for Accounts. Prices cannot be changed while Accounts checks them.</p>}
          {request.status === 'APPROVED' && <p className="text-xs text-slate-500">Approved. Accounts will now upload the add-on invoice.</p>}
          {request.status === 'INVOICE_GENERATED' && <p className="text-xs text-slate-500">Waiting for the customer's payment. Add-on documents can be collected once Accounts confirms it.</p>}
          <AddonEvents events={request.events} />
        </div>
      ) : (
        <p className="text-xs text-slate-500">No add-on services yet.</p>
      )}

      {confirmSubmit && lines && (
        <Dialog title="Submit for Accounts Verification?" description="Accounts checks the services and prices. You cannot change them while Accounts is checking." onClose={() => setConfirmSubmit(false)}>
          <ul className="text-xs text-slate-700 space-y-1">
            {lines.map(l => (
              <li key={l.key}>
                {l.serviceCode ? byCode.get(l.serviceCode)?.name || l.serviceCode : l.name} × {l.quantity} at {rupees(Number(l.unitPrice))}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => setConfirmSubmit(false)}>
              Back
            </button>
            <button type="button" className={btn.primary} disabled={busy} onClick={() => void save(true)}>
              {busy ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </Dialog>
      )}
      {showInvoice && request?.invoice && <InvoiceDetail invoice={request.invoice} onClose={() => setShowInvoice(false)} />}
    </section>
  );
};

/** The editor in a pop-up (from the Customers panel). */
export const AddonRequestDialog: React.FC<{ customerId: string; label: string; originalServices: string[]; onClose: () => void; onChanged?: (r: AddonRequest) => void }> = ({
  customerId,
  label,
  originalServices,
  onClose,
  onChanged
}) => (
  <Dialog title={`Add-on services: ${label}`} description="Select the add-ons the customer agreed to and the agreed prices, then submit them to Accounts." onClose={onClose} wide>
    <AddonRequestEditor customerId={customerId} originalServices={originalServices} onChanged={onChanged} />
    <div className="flex justify-end pt-2 border-t border-slate-100">
      <button type="button" className={btn.secondary} onClick={onClose}>
        Close
      </button>
    </div>
  </Dialog>
);
