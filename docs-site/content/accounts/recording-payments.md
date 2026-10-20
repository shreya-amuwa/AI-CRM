---
title: How to Record and Verify Payments in the Ledger
description: Adding transactions to the immutable customer payment ledger, verifying funds, and handling reversals.
order: 20
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts]
related: [accounts/payment-confirmation-queue, accounts/managing-part-payments-accounts]
updated: 2026-10-19
---

In Amuwa AI CRM, `customer_payments` is the single source of truth for all incoming customer funds. Accounting staff record deposits, attach bank references, and verify ledger rows.

## Before you start

:::prereq
- You must verify bank statements or UPI merchant portals before recording money.
- Only Accounts staff and Super Admins can verify, edit, or reverse ledger entries.
:::

## Steps to record a payment

1. Open the customer in **Accounts > Confirmation**, **Invoices**, or **Part Payment**.
2. Click the **Record Payment** button.
3. In the modal, fill in the transaction details:
   - **Payment Type**: Select **Full Payment** or **Part Payment**.
   - **Amount (₹)**: Enter the received amount in Rupees. Paise are permitted only when settling the exact outstanding balance.
   - **Payment Method**: Select `UPI`, `Bank Transfer`, `Card`, `Cash`, `Cheque`, or `Other`.
   - **Transaction Reference**: Enter the bank UTR, UPI transaction ID, or cheque number.
   - **Payment Date**: The date funds settled in the corporate bank account.
   - **Notes**: Any additional banking comments.
4. Click **Save Payment**.

```flow
Record Payment | Accounts Staff | Amount, method, reference, and date entered
Status: PENDING | Ledger Row | Created as pending verification
Verify Payment | Accounts Staff | Reviews reference and clicks "Verify"
Status: VERIFIED | Database RPC | Real income credited; balance reduced
-> Reversal (if error) | Accounts Lead | Manager reverses; status becomes REVERSED
```

## Verifying the payment

1. Once recorded, the transaction appears in the customer's payment history with status `PENDING`.
2. Click the checkmark icon: **Verify Payment**.
3. The transaction status updates to `VERIFIED`:
   - `amount_verified` increments by the payment amount.
   - The outstanding balance decreases automatically.
   - If the balance reaches zero, the payment status updates to `FULLY_PAID`.

## Reversing an erroneous entry

If a transaction was entered in error or a bank chargeback occurs:
1. Only an Accounts Team Lead, Department Head, or Super Admin can reverse verified entries.
2. Click the **Reverse Payment** button on the verified row.
3. Provide a mandatory reason.
4. The payment status changes to `REVERSED`. The money is immediately subtracted from company income, and the customer's balance is restored.

## What you should see

:::result
The verified transaction appears in green on the customer's payment tab and is included in the company's **Income Summary** report.
:::

## Good to know

:::important Duplicate Reference Guard
Transaction references are unique per customer. If you attempt to enter a reference number that has already been recorded for that customer, the database blocks the entry to prevent double-counting.
:::

:::note Paise Rules
Because GST percentages can yield fractional rupee amounts, paise are accepted only on the final payment that settles the customer's balance to exactly ₹0.00.
:::

## If something goes wrong

If an amount was recorded incorrectly, click **Edit Payment** on the pending row before verifying, or reverse and recreate the entry.
