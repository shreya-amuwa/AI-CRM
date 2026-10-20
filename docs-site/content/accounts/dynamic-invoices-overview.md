---
title: Overview of Dynamic Two-Stage Invoices
description: Architecture of the CRM dynamic invoice engine, automated PDF generation, and two-stage lifecycle.
order: 30
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/DYNAMIC_INVOICES.md, shared/contracts.ts]
related: [accounts/issuing-an-invoice, accounts/confirming-payment-invoice]
updated: 2026-10-19
---

Amuwa AI CRM features a native, automated GST invoice engine that generates compliant tax invoices, renders optimized PDF documents, and emails them to clients in two distinct stages.

## Before you start

:::prereq
- Invoices are created exclusively by authorized Accounts Department staff or Super Admins.
- Ensure corporate company settings (GSTIN, State Code, registered address) are configured.
:::

## The two-stage lifecycle

```flow
1. Invoice Issued | Accounts Staff | Under Invoices > Generate & Send Invoice
2. Unpaid PDF Rendered | Invoice Engine | Lightweight PDF stored in private storage
3. Unpaid Email Dispatched | SMTP Service | Sent to customer email address
4. Payment Received | Accounts Staff | Confirmed in financial ledger
5. Invoice Stamped PAID | Invoice Engine | Same invoice stamped with green PAID seal
6. Paid PDF & Email Dispatched | System | Stamped PDF stored and emailed to client
```

### Stage 1: The ISSUED Stage (Unpaid)
1. Accounts uses the **Invoice Builder** to prefill customer data and line items.
2. The invoice is saved with status `ISSUED`.
3. The invoice engine compiles the document:
   - Line particulars, HSN/SAC codes, and tax rates.
   - CGST and SGST for Maharashtra clients; IGST for interstate clients.
   - Total amount written out in words (e.g. *Rupees One Lakh Eighteen Thousand Only*).
4. An unpaid PDF is rendered and stored securely in Cloudflare R2 / Supabase Storage.
5. An email with the unpaid invoice attached is dispatched to the client.
6. The client can view and download the unpaid invoice in their [Client Portal](/client/invoices-and-receipts).

### Stage 2: The PAID Stage (Stamped)
1. When Accounts confirms payment in the ledger:
2. The accountant clicks **Confirm Payment & Send Paid Invoice**.
3. The invoice record transitions to `PAID`.
4. The engine re-renders the identical invoice with the official **PAID** stamp, payment date, method, and transaction reference.
5. The paid PDF is stored alongside the unpaid copy.
6. A payment receipt email with the stamped invoice attached is dispatched to the client.
7. The client's dashboard updates from *Unpaid* to *Paid*, unlocking the stamped PDF.

## Document storage and performance rules

- **Strict File Size Cap**: Every invoice PDF is compiled to stay strictly under **500 KB** (500,000 bytes) to ensure lightning-fast mobile downloads.
- **Short-Lived Signed URLs**: To protect financial confidentiality, invoice PDFs are never exposed via public URLs. Viewing links expire after 120 seconds.
- **Independent Failure Recovery**: If an email bounces or a storage provider times out, the PDF and email statuses (`pdf_status`, `email_status`) record the exact error. You can click **Retry** without creating duplicate invoice numbers.

## What you should see

:::result
In the Invoices table, each invoice displays its stage (`ISSUED` or `PAID`), PDF status (`STORED`), and email status (`SENT`).
:::

## Good to know

:::important The Paid Stamp Belongs to the Invoice
The PAID stamp verifies that this specific invoice is settled. If a customer is paying across multiple part invoices, each invoice is stamped PAID only when its allocated balance reaches ₹0.
:::

## If something goes wrong

If an email fails to dispatch, check the email status badge on the invoice card and click **Retry Delivery**.
