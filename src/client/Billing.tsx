import React from 'react';
import { Info, RefreshCw } from 'lucide-react';
import type { ClientBilling, ClientBillingOrder } from '../../shared/contracts';
import { Badge, Button, Card, Skeleton, inr, type Tone } from './ui';
import type { Loaded } from './hooks';

const STATE: Record<ClientBillingOrder['state'], { label: string; tone: Tone }> = {
  UNPAID: { label: 'Unpaid', tone: 'danger' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'attention' },
  FULLY_PAID: { label: 'Fully paid', tone: 'success' }
};

/** Everything below is the server's figure for the signed-in client; nothing is added up or defaulted here. */
export const BillingSummary: React.FC<{ q: Loaded<ClientBilling>; onOpenInvoice?: (invoiceId: string) => void }> = ({ q, onOpenInvoice }) => {
  if (q.loading && !q.data) return <Card><div className="cd-stack" style={{ gap: 12 }} role="status" aria-label="Loading your balance"><Skeleton h={18} w="40%" /><Skeleton h={16} w="70%" /></div></Card>;
  if (q.error && !q.data) return <Card><div className="cd-empty" role="alert"><p className="cd-small">{q.error}</p><Button variant="outline" small onClick={q.reload}><RefreshCw size={14} /> Try again</Button></div></Card>;
  const b = q.data;
  if (!b || b.orders.length === 0) return null;
  const { totals } = b;
  return (
    <div className="cd-stack" style={{ gap: 14, marginBottom: 18 }}>
      <Card>
        <div className="cd-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p className="cd-label">Outstanding balance</p>
            <p className="cd-big" aria-live="polite">{inr(totals.outstanding)}</p>
            <p className="cd-small cd-muted">Total payable incl. GST {inr(totals.payable)} - confirmed payments {inr(totals.confirmed)}</p>
          </div>
          {totals.pending > 0 ? <Badge tone="info">{inr(totals.pending)} awaiting verification</Badge> : null}
        </div>
      </Card>
      {b.orders.map(o => (
        <Card key={o.key}>
          <div className="cd-between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h2 className="cd-section-title" style={{ marginBottom: 0 }}>{o.title}</h2>
            {o.gstPending ? <Badge tone="info">Amount being confirmed</Badge> : <Badge tone={STATE[o.state].tone}>{STATE[o.state].label}</Badge>}
          </div>
          {o.gstPending ? (
            <div className="cd-banner info" style={{ marginTop: 12 }}><Info size={18} style={{ flexShrink: 0 }} /><span>Our Accounts team is still confirming the final amount payable for this order, including GST. Your balance will appear here as soon as it is confirmed.</span></div>
          ) : (
            <div className="cd-stack" style={{ gap: 6, marginTop: 12 }}>
              <div className="cd-between"><span className="cd-muted">Total payable (incl. GST{o.gstRate ? ` ${o.gstRate}%` : ''})</span><span>{inr(o.totalPayable)}</span></div>
              <div className="cd-between"><span className="cd-muted">Payments confirmed</span><span>{inr(o.confirmed)}</span></div>
              {o.pending > 0 ? <div className="cd-between"><span className="cd-muted">Awaiting verification (not yet counted)</span><span>{inr(o.pending)}</span></div> : null}
              <hr className="cd-divider" />
              <div className="cd-between"><b>Balance outstanding</b><b style={{ fontSize: 18 }}>{inr(o.balance)}</b></div>
              {o.notYetInvoiced > 0 ? <p className="cd-small cd-muted">{inr(o.notYetInvoiced)} of this order is not on an invoice yet. Accounts will issue it.</p> : null}
            </div>
          )}
          {o.invoices.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <p className="cd-label">Invoices</p>
              {o.invoices.map(i => (
                <div key={i.id} className="cd-between" style={{ padding: '4px 0', gap: 8, flexWrap: 'wrap' }}>
                  <span><b>{i.number ?? 'Invoice'}</b> <span className="cd-small cd-muted">{inr(i.total)}</span></span>
                  <span className="cd-row" style={{ gap: 8 }}>
                    <Badge tone={STATE[i.state].tone}>{STATE[i.state].label}</Badge>
                    {onOpenInvoice ? <Button variant="outline" small onClick={() => onOpenInvoice(i.id)} aria-label={`Open invoice ${i.number ?? ''}`}>View</Button> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
};
