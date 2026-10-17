import React, { useState } from 'react';
import { FilePlus2, UploadCloud } from 'lucide-react';
import { btn } from '../team-member/pipeline/shared';
import { InvoiceBuilder } from './InvoiceBuilder';
import { UploadInvoiceDialog } from './invoiceFiles';
import { CustomerInvoices } from './invoiceShared';

/**
 * Accounts: the invoices of one customer, inside the customer pop-up where the accountant already
 * works on payments. "Upload Invoice PDF" has the customer preset; the list opens each invoice to
 * preview, download or (Accounts only) replace its PDF.
 */
export const AccountsCustomerInvoices: React.FC<{ customerId: string; customerLabel: string; canUpload?: boolean }> = ({ customerId, customerLabel, canUpload = true }) => {
  const [uploading, setUploading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  return (
    <section aria-labelledby={`cust-inv-${customerId}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`cust-inv-${customerId}`} className="text-xs font-bold text-slate-800">
          Invoices
        </h3>
        {canUpload && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} onClick={() => setBuilding(true)}>
              <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" /> Generate Invoice
            </button>
            <button type="button" className={btn.secondary} onClick={() => setUploading(true)}>
              <UploadCloud className="w-3.5 h-3.5" aria-hidden="true" /> Upload Invoice PDF
            </button>
          </div>
        )}
      </div>
      {notice && (
        <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}
      <CustomerInvoices customerId={customerId} compact canManage key={reload} />
      {building && (
        <InvoiceBuilder
          customer={{ id: customerId, label: customerLabel }}
          onClose={() => setBuilding(false)}
          onDone={r => {
            setBuilding(false);
            setNotice(`Invoice ${r.invoice.number} was saved. Open it from the list to see the PDF and e-mail status.`);
            window.dispatchEvent(new CustomEvent('crm:pipeline-changed'));
            setReload(n => n + 1);
          }}
        />
      )}
      {uploading && (
        <UploadInvoiceDialog
          customer={{ id: customerId, label: customerLabel }}
          onClose={() => setUploading(false)}
          onUploaded={inv => {
            setUploading(false);
            setNotice(`Invoice ${inv.number} was uploaded. Everyone who may see this customer can now open it.`);
            window.dispatchEvent(new CustomEvent('crm:pipeline-changed'));
            setReload(n => n + 1);
          }}
        />
      )}
    </section>
  );
};
