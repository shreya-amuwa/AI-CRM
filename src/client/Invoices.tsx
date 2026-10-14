import React, { useState } from 'react';
import { Download, Eye, FileText, Info } from 'lucide-react';
import type { ClientInvoice } from '../../shared/contracts';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { errorMessage } from '../lib/api/client';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Query, fmtDate, inr } from './ui';

const statusOf = (i: ClientInvoice) => i.status === 'Paid' ? { label: 'Paid', tone: 'success' as const } : i.overdue ? { label: 'Overdue', tone: 'danger' as const } : { label: 'Pending', tone: 'attention' as const };

export const Invoices: React.FC = () => {
  const q = useLoad(() => clientApi.invoices());
  const [open, setOpen] = useState<ClientInvoice | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const file = async (inv: ClientInvoice, action: 'view' | 'download') => {
    setError(''); setBusyId(inv.id + action);
    // open the tab first (inside the click) so pop-up blockers allow it, then point it at the signed link
    const tab = action === 'view' ? window.open('', '_blank') : null;
    try {
      const r = await clientApi.invoiceUrl(inv.id, action);
      if (tab) { tab.opener = null; tab.location.href = r.url; }
      else { const a = document.createElement('a'); a.href = r.url; a.download = r.fileName; document.body.appendChild(a); a.click(); a.remove(); }
    } catch (e) { tab?.close(); setError(errorMessage(e)); }
    finally { setBusyId(''); }
  };

  return (
    <>
      <PageHeader title="Invoices" subtitle="Invoices issued to you by Amuwa Accounts." />
      <div className="cd-banner info" style={{ marginBottom: 14 }}><Info size={18} style={{ flexShrink: 0 }} /><span>Invoices are issued and updated only by our Accounts team. You can view and download them here.</span></div>
      {error && <div className="cd-banner danger" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
      <Query q={q} empty={d => d.length === 0 ? <Card><EmptyState icon={<FileText size={24} />} title="No invoices yet" text="When our Accounts team issues an invoice for you, it will appear here." /></Card> : null}>
        {list => (
          <Card style={{ padding: 6 }}>
            <table className="cd-table stack">
              <thead><tr><th>Invoice</th><th>Date</th><th>For</th><th>Amount</th><th>Due</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
              <tbody>
                {list.map(i => {
                  const st = statusOf(i);
                  return (
                    <tr key={i.id}>
                      <td data-label="Invoice" style={{ fontWeight: 700 }}>{i.number}</td>
                      <td data-label="Date">{fmtDate(i.issueDate ?? i.issuedAt)}</td>
                      <td data-label="For" style={{ maxWidth: 220 }} className="cd-ellipsis">{i.related}</td>
                      <td data-label="Amount"><b>{inr(i.amount)}</b>{i.tax ? <span className="cd-small cd-muted"> incl. GST {inr(i.tax)}</span> : null}</td>
                      <td data-label="Due">{i.status === 'Paid' ? '-' : fmtDate(i.dueDate)}</td>
                      <td data-label="Status"><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td data-label="" style={{ textAlign: 'right' }}>
                        <div className="cd-row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <Button variant="outline" small onClick={() => setOpen(i)}>Details</Button>
                          {i.hasFile ? <>
                            <Button variant="outline" small loading={busyId === i.id + 'view'} onClick={() => file(i, 'view')} aria-label={`View invoice ${i.number}`}><Eye size={14} /> View</Button>
                            <Button variant="outline" small loading={busyId === i.id + 'download'} onClick={() => file(i, 'download')} aria-label={`Download invoice ${i.number}`}><Download size={14} /> PDF</Button>
                          </> : <span className="cd-small cd-muted">PDF not uploaded yet</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </Query>
      {open && (
        <Modal title={`Invoice ${open.number}`} onClose={() => setOpen(null)}>
          <div className="cd-stack">
            <div className="cd-between"><Badge tone={statusOf(open).tone}>{statusOf(open).label}</Badge><span className="cd-small cd-muted">Issued {fmtDate(open.issueDate ?? open.issuedAt)}</span></div>
            <p><b>For:</b> {open.related}</p>
            {open.items.length > 0 && (
              <table className="cd-table"><thead><tr><th>Item</th><th>Qty</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>{open.items.map((it, k) => <tr key={k}><td>{it.name ?? 'Item'}</td><td>{it.quantity ?? 1}</td><td style={{ textAlign: 'right' }}>{inr(it.lineTotal ?? it.unitPrice ?? null)}</td></tr>)}</tbody></table>
            )}
            <div className="cd-card sm" style={{ background: 'var(--surface)' }}>
              {open.subtotal !== null && <div className="cd-between"><span className="cd-muted">Subtotal</span><span>{inr(open.subtotal)}</span></div>}
              {open.discount ? <div className="cd-between"><span className="cd-muted">Discount</span><span>- {inr(open.discount)}</span></div> : null}
              <div className="cd-between"><span className="cd-muted">GST</span><span>{open.tax !== null ? inr(open.tax) : '-'}</span></div>
              <hr className="cd-divider" />
              <div className="cd-between"><b>Total</b><b style={{ fontSize: 18 }}>{inr(open.amount)}</b></div>
            </div>
            <div className="cd-grid c2"><div><p className="cd-label">Due date</p><p style={{ fontWeight: 600 }}>{open.status === 'Paid' ? 'Paid' : fmtDate(open.dueDate)}</p></div>
              <div><p className="cd-label">Paid on</p><p style={{ fontWeight: 600 }}>{open.paidAt ? fmtDate(open.paidAt) : '-'}</p></div></div>
            {open.hasFile && <div className="cd-row" style={{ justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => file(open, 'view')}><Eye size={16} /> View</Button><Button onClick={() => file(open, 'download')}><Download size={16} /> Download PDF</Button></div>}
          </div>
        </Modal>
      )}
    </>
  );
};
