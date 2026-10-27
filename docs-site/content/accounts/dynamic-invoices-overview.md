---
title: Overview of Dynamic Two-Stage Invoices and GST Handling
description: Architecture of the native GST invoice engine, EXCLUSIVE vs INCLUSIVE tax modes, CGST/SGST vs IGST rules, HSN/SAC codes, and the two-stage PDF lifecycle.
order: 30
group: Invoicing & Tax
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/DYNAMIC_INVOICES.md, shared/contracts.ts, shared/gst.ts, shared/invoiceCalc.ts, supabase/migrations/20261114000200_payment_gst.sql]
related: [accounts/issuing-an-invoice, accounts/confirming-payment-invoice, super-admin/tax-agreements-review]
updated: 2026-10-27
---

Amuwa AI CRM includes a native GST calculation and invoicing engine that enforces statutory tax rules, tracks agreement tax modes, and renders compliant tax invoices in two distinct stages (`ISSUED` and `PAID`).

## Before you start

:::prereq
- Invoices are created and managed exclusively by authorized **Accounts Staff**, **Department Heads**, or **Super Admins**.
- Ensure the customer's state code, billing address, and optional 15-character GSTIN are available before generating a tax invoice.
:::

## Tax modes: EXCLUSIVE, INCLUSIVE, and No-GST (0%)

Every customer order carries an explicit tax basis (`agreed_tax_basis`) that governs how payments and invoices are calculated:

| Tax Mode | Meaning | How Invoices & Payments Work |
| --- | --- | --- |
| **GST Exclusive (`EXCLUSIVE`)** | Sales agreed a net contract amount **before GST**. | Accounts chooses the GST rate (`0%`, `5%`, `12%`, `18%`, or `28%`) **once for the order**, on the payment page; every invoice line then uses it and the invoice amounts, before GST, are entered up to the agreed net budget. A payment is only the money received (GST included): it carries no GST of its own. |
| **GST Inclusive (`INCLUSIVE`)** | Sales agreed a gross contract ceiling that **already includes GST**. | Total invoiced amounts (base + GST combined) cannot exceed the agreed gross ceiling. A payment is the gross amount received. |
| **No GST / Exempt (`0%` / `NA`)** | Zero-rated, export, or non-GST supply. | Accounts chooses `No GST (0%)` for the order (the invoice lines then carry 0%). |

## CGST + SGST vs IGST determination

The GST helper engine (`shared/gst.ts` and `shared/invoiceCalc.ts`) determines the statutory tax split from the customer's place of supply relative to the company's home state (**Maharashtra, state code `27`**):

- **Intra-State Supply (Customer in Maharashtra - State Code `27`)**: Splits the line-item GST rate equally into **CGST** and **SGST** (for example, an `18%` GST rate becomes **9% CGST + 9% SGST**).
- **Inter-State Supply (Customer outside Maharashtra)**: Applies the full GST rate as **IGST** (for example, **18% IGST**).
- **GSTIN Validation & State Inference**: When a 15-character GSTIN is entered, `normalizeGstin` and `isValidGstinFormat` validate the checksum/pattern and extract the first two digits to verify consistency with the selected state code. If Accounts overrides the default tax treatment, a mandatory audit reason (`overrideReason`) must be recorded.
- **HSN / SAC Codes**: Every service line item carries a statutory Service Accounting Code (defaulting to `998313` for IT consulting and software support services, or populated from the service catalog).

## The two-stage invoice lifecycle

```flow
1. Create or Upload Invoice | Accounts Staff | Under Accounts > Invoices (status: ISSUED)
2. Unpaid PDF Stored | Invoice Engine | Compiled under 500 KB; unlocks checklist item 5. Invoice Confirmation
3. Payment Verified | Accounts Staff | Verified in customer_payments ledger
4. Confirm & Stamp PAID | Accounts Staff | Clicks "Confirm Payment & Send Paid Invoice" (status: PAID)
5. Paid PDF & Email Sent | System | Re-renders invoice with green PAID seal and emails receipt to client
```

### Stage 1: The ISSUED stage (Unpaid)

1. Accounts uses the **Invoice Builder** to configure customer billing details, HSN/SAC codes, line-item base amounts, and tax rates, or uploads an external invoice PDF.
2. Saving the invoice creates an `ISSUED` record and renders an unpaid tax invoice PDF stored in private bucket storage.
3. Creating or uploading the customer's invoice automatically satisfies onboarding checklist item **5. Invoice Confirmation** (`invoice_confirmed`).
4. The client can view the issued invoice in their [Client Portal](/client/invoices-and-receipts).

### Stage 2: The PAID stage (Stamped)

1. Once verified payments in `customer_payments` cover the invoice total, Accounts clicks **Confirm Payment & Send Paid Invoice**.
2. The invoice status transitions from `ISSUED` to `PAID`.
3. The engine re-renders the identical invoice with the official green **PAID** seal, settlement date, payment method, and transaction reference, and dispatches the stamped PDF to the customer's billing email.

## Document storage and file size rules

- **Strict 500 KB File Size Limit (`INVOICE_PDF_MAX_BYTES`)**: Both generated and manually uploaded invoice PDFs must be **500 KB (500,000 bytes) or smaller** to guarantee fast loading across mobile connections.
- **Short-Lived Signed URLs**: Invoice PDFs are never exposed on public URLs; viewing or downloading generates a temporary signed link that expires after 120 seconds.
- **Independent Delivery Tracking**: PDF storage (`pdf_status`) and email delivery (`email_status`) are tracked independently so failed email deliveries can be retried without duplicating invoice numbers.

## What you should see

:::result
In **Accounts > Invoices**, every invoice displays its tax breakdown (Taxable Subtotal, CGST/SGST or IGST, and Grand Total), lifecycle badge (`ISSUED`, `PARTIALLY_PAID`, or `PAID`), and delivery status pills.
:::

## Good to know

:::important Per-Payment GST vs Invoice GST Reconciliation
When a customer pays in installments on an `EXCLUSIVE` agreement, Accounts records GST on each payment (`customer_payments.gst_amount`) and also specifies GST on each generated invoice (`generated_invoices.total_gst`). The database function `sync_order_payable` automatically reconciles both so the same installment is never taxed twice.
:::

## If something goes wrong

- If a GSTIN fails validation or conflicts with the selected state, check the first two digits of the GSTIN against the Indian GST state code list or see [Invoice Generation Troubleshooting](/troubleshooting/invoice-generation-troubleshooting).
