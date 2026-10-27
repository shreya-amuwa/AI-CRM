---
title: Troubleshooting Invoice Generation and PDF Downloads
description: Resolve invoice ceiling blocks, missing SAC codes, intra-state vs inter-state GST tax splits, and PDF download or upload issues.
order: 5
group: Billing & Invoices
roles: [Accounts, Super Admin, Sales Team Lead]
audience: internal
status: verified
sources: [src/components/InvoiceBuilderModal.tsx, src/components/AccountsPanel.tsx, shared/contracts.ts]
related:
  - /accounts/dynamic-invoices-overview
  - /accounts/issuing-an-invoice
  - /accounts/confirming-payment-invoice
  - /troubleshooting/payment-and-balance-discrepancies
updated: 2026-10-27
---

The Amuwa AI CRM invoice engine enforces order ceiling rules, Indian GST place-of-supply tax splits, and multi-service line item validation. Use the steps below to resolve issues when creating, uploading, or downloading invoices.

## Before you start

:::prereq
- You must be signed in as **Accounts** staff or **Super Admin** to issue invoices or adjust tax basis settings in the **Invoice Builder**.
:::

## 1. Symptom: "Invoice total exceeds order ceiling"

### Likely causes

- In Amuwa AI CRM, the sum of all active invoices issued for an order cannot exceed the order's gross payable ceiling:
  - `Sum of Invoice Totals <= Order Gross Ceiling`
- Either prior invoices already cover the agreed order amount, or the agreement's tax basis (`INCLUSIVE` vs `EXCLUSIVE`) was set to `INCLUSIVE` when the commercial quote was actually before GST (`EXCLUSIVE`).

### Step-by-step resolution

1. Open the customer in the **Invoice Builder** and review the **Existing Invoices** list and the remaining uninvoiced balance.
2. Verify whether the commercial deal was agreed **before GST (`EXCLUSIVE`)** or **including GST (`INCLUSIVE`)** (see [Payment and Balance Discrepancies](/troubleshooting/payment-and-balance-discrepancies)).
3. If the customer purchased an additional service after onboarding started, bill it through **Add-on Services** so it carries its own independent add-on ceiling rather than consuming the primary order ceiling.

## 2. Symptom: "Missing or Invalid SAC Code" on Multi-Service Line Items

### Likely causes

- Every billable service line item on a GST tax invoice requires a valid 6-digit Service Accounting Code (SAC) and line-item rate.

### Step-by-step resolution

1. Inspect each service line item in the **Invoice Builder** for blank or invalid SAC fields.
2. Enter the applicable 6-digit SAC code (for example, `998314` for IT design, automation, and software services).
3. Ask a **Super Admin** to update the default SAC code on the service in the **Service Catalog** so future multi-service invoices pre-fill automatically.

## 3. Symptom: Unexpected GST Split (`IGST` vs `CGST + SGST`)

### Likely causes

- The invoice engine determines the GST split from the customer's registered state:
  - **Intra-State (Maharashtra)**: Splits GST equally into **9% CGST + 9% SGST**.
  - **Inter-State (Outside Maharashtra)**: Applies **18% IGST**.

### Step-by-step resolution

1. Check the customer's state and GSTIN in their billing details before issuing the invoice.
2. Update the state field if it was left blank or set to the wrong state during lead creation, then regenerate the invoice preview.

## 4. Symptom: Uploaded Invoice PDF rejected or "View / Print PDF" blocked

### Likely causes

- When uploading an external invoice PDF file, the file exceeds the strict **500 KB** (`INVOICE_PDF_MAX_BYTES`) limit or is not a `.pdf` file.
- When clicking **Download PDF** or **View / Print PDF**, the browser's pop-up blocker prevented the print/PDF tab from opening.

### Step-by-step resolution

1. **For Uploaded Invoice PDFs**: Ensure the file is a `.pdf` under **500 KB**.
2. **For Viewing / Printing PDFs**: Allow pop-ups for the CRM domain in your browser address bar and click **View / Print PDF** again.

## Expected result

:::result
- The invoice passes ceiling and SAC validation, calculates the proper `CGST + SGST` or `IGST` breakdown across all service line items, and publishes the PDF immediately to both the **Accounts** ledger and the Client Dashboard **Invoices & Payments** page.
:::

## When to escalate

Escalate to a **Super Admin** if a catalog item is missing its default SAC configuration or if an issued invoice requires administrative cancellation. Include:

- The **Customer Name**, **Invoice Number**, and **Order Gross Ceiling**.
- A screenshot of the **Invoice Builder** line items and validation message.
