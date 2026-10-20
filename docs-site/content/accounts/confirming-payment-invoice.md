---
title: How to Confirm Payment and Issue a Stamped Paid Invoice
description: Transitioning an issued invoice to paid status, stamping the official seal, and dispatching payment receipts.
order: 50
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/DYNAMIC_INVOICES.md, docs/SERVICE_JOURNEYS.md, shared/contracts.ts]
related: [accounts/issuing-an-invoice, accounts/recording-payments]
updated: 2026-10-19
---

When funds covering an issued invoice are received and verified, complete the transaction by generating the official **PAID** stamped tax invoice.

## Before you start

:::prereq
- The invoice must currently have status `ISSUED`.
- Payment must be verified on the bank statement.
:::

## Steps

1. In the sidebar, navigate to **Accounts > Invoices**.
2. Locate the invoice with status **Pending** / **Issued**.
3. Click the invoice row to open the details view.
4. Click the primary button: **Confirm Payment & Send Paid Invoice**.
5. In the confirmation dialog:
   - **Payment Method**: Select UPI, Bank Transfer, Card, Cash, or Cheque.
   - **Transaction Reference**: Enter the bank UTR or transaction confirmation ID.
   - **Payment Date**: The date the payment settled.
   - **Note**: Optional comments or bank account identifiers.
6. Click **Confirm & Send Paid Invoice**.

```flow
Open Issued Invoice | Accounts Staff | Under Accounts > Invoices
Click Confirm Payment | Accounts Staff | Opens payment reconciliation dialog
Enter Banking Details | Accounts Staff | Method, transaction ref, and settlement date
Reconciliation Run | Database RPC | Checks verified ledger payments against invoice total
-> If Balance Remaining | Status: PARTIALLY_PAID | Partial payment recorded; invoice stays open
-> If Balance Zero | Status: PAID | Re-renders document with green PAID stamp
Dispatch Stamped PDF | System | Stores paid PDF & emails payment receipt to client
```

## What you should see

:::result
The invoice status immediately flips to **Paid** with a green badge. The document viewer updates to display the official green **PAID** seal, along with the settlement date and transaction reference printed above the authorized signatory.
:::

## How the customer sees it

- On the [Client Portal Invoices](/client/invoices-and-receipts) page, the invoice tag changes from *Unpaid* to *Paid*.
- The **Download PDF** button switches to downloading the official stamped tax invoice.
- A confirmation email is delivered to the customer's billing inbox with the stamped PDF attached.

## Good to know

:::important What happens if only a partial payment is made?
If the money received does not cover the full invoice total:
- The transaction is recorded against the invoice.
- The invoice status updates to **Partially paid**.
- The invoice remains open and displays the remaining balance.
- The **PAID** stamp is applied only when the invoice balance reaches ₹0.
:::

## If something goes wrong

If the paid PDF generation times out, click **Retry Delivery** on the invoice action menu.
