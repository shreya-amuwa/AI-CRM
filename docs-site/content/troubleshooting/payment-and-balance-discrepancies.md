---
title: Troubleshooting Payment Confirmations and Balance Discrepancies
description: Reconcile customer balances, verify pending payments, resolve GST tax basis mismatches, and handle blocked returns when payments are already verified.
order: 3
group: Billing & Invoices
roles: [Accounts, Super Admin, Department Head, Sales Team Lead, Sales Team Member]
audience: internal
status: verified
sources: [src/components/AccountsPanel.tsx, src/components/InvoiceBuilderModal.tsx, shared/contracts.ts]
related:
  - /accounts/recording-payments
  - /accounts/managing-part-payments-accounts
  - /super-admin/tax-agreements-review
  - /troubleshooting/invoice-generation-troubleshooting
updated: 2026-10-27
---

When a customer's outstanding balance does not match expectations or an invoice is blocked by the order ceiling, the cause is almost always an unverified (`PENDING`) payment or a mismatch in the order's GST tax basis (`INCLUSIVE` vs `EXCLUSIVE`).

## Before you start

:::prereq
- Open the customer's record in the **Accounts** dashboard or inspect their payment history and tax basis in the **Invoice Builder**.
:::

## 1. Symptom: "The customer paid, but their balance has not decreased"

### Likely causes

- Recording a payment in Sales or logging a new tranche creates a transaction with status **`PENDING`** (shown to the client as **Being verified**).

:::important The Strict Ledger Rule
Only payments in status **`VERIFIED`** reduce the customer's outstanding order balance and count toward confirmed department income. Payments in **`PENDING`** or **`REJECTED`** status never alter ledger balances.
:::

### Step-by-step resolution

1. Sign in to the **Accounts** dashboard and open the **Confirmation** queue (or **Part Payment** queue for follow-up tranches).
2. Locate the customer's pending payment entry.
3. Check the bank/UTR transaction reference and whether GST applies to that payment.
4. Click **Confirm & Verify Payment**.
5. Once marked **`VERIFIED`**, the customer's outstanding balance and invoice status update immediately.

## 2. Symptom: "Balance is higher than the agreed deal amount" or "Invoice exceeds agreed ceiling"

### Likely causes

- Each order stores an explicit tax basis (`orderTaxBasis`):
  - **Excluding GST (`EXCLUSIVE`)**: The agreed deal amount is before GST, and GST is added on top, at the rate Accounts chose for the order, to compute the **Total Payable** (no GST is assumed before it is chosen).
  - **Including GST (`INCLUSIVE`)**: The agreed deal amount already includes GST, so **Total Payable** equals the agreed deal amount.
- A payment is only the money received (GST included). The GST belongs to the order and is chosen once; recording a payment never changes it. Older orders whose GST was recorded on payments are left as they are and listed for review (`GET /pipeline/accounts/gst-reconciliation`).

### Step-by-step resolution

1. Confirm with the **Sales** representative whether the commercial quote agreed with the client was **before GST (`EXCLUSIVE`)** or **all-inclusive (`INCLUSIVE`)**.
2. Open the customer in the **Invoice Builder** (Accounts or Super Admin).
3. If the agreement was quoted before GST but recorded as `INCLUSIVE`, use the tax basis reconciliation control in the **Invoice Builder**, enter the mandatory audit reason, and apply the change.
4. If the agreement was genuinely all-inclusive (`INCLUSIVE`), adjust the invoice line items so the gross invoice total (including GST) stays within the agreed ceiling.

## 3. Symptom: "Cannot return customer to Sales — payment is already verified"

### Likely causes

- To protect financial audit integrity, the database prevents returning a customer card to Sales when any payment on the account is already in **`VERIFIED`** status.

### Step-by-step resolution

1. Verify whether the customer genuinely cancelled or requires a refund/reversal.
2. Ask a **Super Admin** or **Department Head** to record an audited payment reversal (`REVERSED`) with a written reason in the payment ledger.
3. Once no active `VERIFIED` payments remain on the order, Accounts can return the record to Sales.

## Expected result

:::result
- Confirming a **`PENDING`** payment immediately transitions it to **`VERIFIED`**, deducts the amount from the customer's **Order Balance**, and updates the Client Dashboard **Payment history** badge from **Being verified** to **Confirmed**.
- Aligning the order tax basis (`EXCLUSIVE` vs `INCLUSIVE`) immediately recalculates **Total Payable** and **Order Balance** across Accounts, Sales, and the Client Portal.
:::

## When to escalate

Escalate to the **Accounts Department Head** or **Super Admin** if a verified payment amount was entered incorrectly or requires a formal reversal. Include:

- The **Customer Name**, **Order / Deal Amount**, and **Tax Basis** (`INCLUSIVE` or `EXCLUSIVE`).
- The **Payment ID / UTR reference**, recorded amount, and whether GST was toggled on the payment.
- The written business justification for the adjustment or reversal.
