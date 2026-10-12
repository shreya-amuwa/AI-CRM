import React from 'react';
import { InvoiceBrowser } from '../invoices/InvoiceBrowser';

interface MemberInvoicesDashboardProps {
  currentUserId?: string;
}

/**
 * Sales: invoices of the salesperson's own customers. Read-only - invoices are created and
 * managed by the Accounts department only (the database refuses any change from Sales).
 */
export const MemberInvoicesDashboard: React.FC<MemberInvoicesDashboardProps> = () => (
  <InvoiceBrowser
    title="Invoices"
    subtitle="Invoices the Accounts department issued for your customers. To change an invoice, contact Accounts."
  />
);
