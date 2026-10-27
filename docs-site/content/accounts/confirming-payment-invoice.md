---
title: Confirming Paid Invoices and Unlocking Onboarding Checklists
description: How Accounts actions satisfy onboarding items 4 (Payment Confirmation) and 5 (Invoice Confirmation), and how to issue PAID-stamped tax receipts.
order: 50
group: Invoicing & Tax
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/DYNAMIC_INVOICES.md, docs/SERVICE_JOURNEYS.md, shared/contracts.ts, src/components/invoices/GeneratedInvoicePanel.tsx]
related: [accounts/issuing-an-invoice, accounts/recording-payments, technical-consultant/verifying-checklist-items]
updated: 2026-10-27
---

Accounts plays a direct role in unlocking customer onboarding. Sales and Technical Consultants cannot manually toggle financial checklist items; instead, confirming payments and issuing invoices in the Accounts Dashboard automatically satisfies items **4. Payment Confirmation** and **5. Invoice Confirmation** on the customer's onboarding checklist.

## Before you start

:::prereq
- Sign in with an **Accounts Staff**, **Department Head**, or **Super Admin** account.
- To stamp an issued invoice as **PAID**, the customer's payment must first be recorded and verified on the corporate bank statement.
:::

## How Accounts actions unlock the onboarding checklist

Every customer in the `ONBOARDING` stage has a 6-item mandatory onboarding checklist. Two of those 6 items are controlled exclusively by Accounts database triggers:

| Checklist Item | Controlled By | Exact Accounts Action That Unlocks It |
| --- | --- | --- |
| **4. Payment Confirmation** | Accounts Ledger (`customer_onboarding.payment_verified`) | Recording and verifying at least one payment in `customer_payments` and clicking **Confirm Payment & Return to Sales** in **Accounts > Confirmation**. |
| **5. Invoice Confirmation** | Accounts Invoices (`customer_onboarding.invoice_confirmed`) | Generating a dynamic GST invoice (`Create invoice`) or uploading an external invoice PDF (`Upload invoice PDF` up to **500 KB**) in **Accounts > Invoices**. |

:::note Zero Manual Overhead for Consultants
As soon as you confirm a payment and issue or upload the customer's invoice, items **4. Payment Confirmation** and **5. Invoice Confirmation** automatically turn green (`Verified`) in the Sales and Technical Consultant workspaces via Supabase Realtime.
:::

## Steps to confirm payment on an issued invoice and send the PAID PDF

When funds covering an `ISSUED` invoice have been verified in the ledger:

1. In the sidebar, navigate to **Accounts > Invoices**.
2. Locate the invoice with status **Issued** (or **Partially paid**) and click the row to open its detail panel.
3. Click the primary action button: **Confirm Payment & Send Paid Invoice**.
4. In the confirmation dialog, verify or enter the banking settlement details:
   - **Payment Method**: Select `UPI`, `Bank Transfer`, `Card`, `Cash`, or `Cheque`.
   - **Transaction Reference**: Confirm the bank UTR or UPI transaction ID.
   - **Payment Date**: Confirm the settlement date.
   - **Note**: Optional banking remarks.
5. Click **Confirm & Send Paid Invoice**.

```flow
Verify Payment in Ledger | Accounts Staff | Unlocks item "4. Payment Confirmation" on onboarding checklist
Create or Upload Invoice | Accounts Staff | Unlocks item "5. Invoice Confirmation" on onboarding checklist
Click Confirm Payment on Invoice | Accounts Staff | Reconciles verified ledger funds against invoice total
-> If Partial Balance Remains | Status: PARTIALLY_PAID | Invoice stays open showing remaining balance
-> If Invoice Balance is ₹0 | Status: PAID | Re-renders PDF with green PAID stamp and emails client
```

## What you should see

:::result
The invoice status badge flips to **Paid** (`PAID`), the PDF viewer updates with the green **PAID** seal showing the transaction reference and settlement date, and both **4. Payment Confirmation** and **5. Invoice Confirmation** display as verified on the customer's onboarding checklist.
:::

## How the customer sees it in the Client Portal

- On the [Client Portal Invoices](/client/invoices-and-receipts) page, the invoice status badge changes from **Unpaid** to **Paid**.
- Clicking **Download PDF** downloads the newly rendered tax invoice bearing the green **PAID** seal.
- A payment receipt email with the stamped PDF attached is sent to the customer's billing email address.

## Good to know

:::important Partial Payments Against an Invoice
If the verified money received so far covers only part of an issued invoice:
- The payment is allocated against the invoice and its status becomes **Partially paid** (`PARTIALLY_PAID`).
- Onboarding item **4. Payment Confirmation** and item **5. Invoice Confirmation** are still satisfied so technical onboarding can proceed on part-payment terms.
- The green **PAID** stamp is applied to the invoice PDF only when that specific invoice's remaining balance reaches `₹0`.
:::

## If something goes wrong

- If the paid PDF generation or receipt email times out, open the invoice card in **Accounts > Invoices** and click **Retry Delivery** to re-run the PDF/email job without creating a duplicate invoice number.
- If a Technical Consultant reports that item 4 or 5 is still locked, check **Accounts > Confirmation** and **Accounts > Invoices** to ensure at least one payment is marked `VERIFIED` and at least one invoice has been created or uploaded for that customer.
