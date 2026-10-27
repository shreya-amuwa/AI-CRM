---
title: How to Record and Verify Payments in the Ledger
description: Recording full and part payments, applying per-payment GST on GST-exclusive agreements, verifying funds, and reversing erroneous entries.
order: 20
group: Payments
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts, src/components/accounts/AccountsPaymentPanel.tsx, supabase/migrations/20261114000200_payment_gst.sql]
related: [accounts/payment-confirmation-queue, accounts/managing-part-payments-accounts, accounts/dynamic-invoices-overview]
updated: 2026-10-27
---

In Amuwa AI CRM, `customer_payments` is the single source of truth for all incoming customer funds. Accounting staff record deposits, specify per-payment GST when the customer's agreement is GST-exclusive, attach bank references, and verify ledger rows.

## Before you start

:::prereq
- Verify the incoming transaction on your corporate bank statement or UPI merchant dashboard before recording funds.
- Only Accounts staff, Department Heads, and Super Admins can record, verify, edit, or reverse ledger entries.
:::

## How GST on individual payments works

The **Record payment** modal (`AccountsPaymentPanel.tsx` backed by `supabase/migrations/20261114000200_payment_gst.sql`) adapts automatically to the customer agreement's tax basis:

| Agreement Tax Basis | Fields Shown in Record Payment Modal | Ledger Calculation & Sync Behavior |
| --- | --- | --- |
| **GST Exclusive (`EXCLUSIVE`)** | **Amount before GST (₹)** (`taxable_amount`) + **GST** rate selector (`No GST (0%)`, `5% GST`, `12% GST`, `18% GST`, `28% GST`) | Live-calculates **Amount before GST**, **GST (%)** (`gst_amount`), and **Final amount received** (`amount = taxable_amount + gst_amount`). Synchronizes the order's total payable (`sync_order_payable`) with the recorded GST. |
| **GST Inclusive (`INCLUSIVE`)** or **Not Applicable (`NA`)** | Single **Amount (₹)** field | The amount entered is the final amount received (`gst_rate = null` / `0`, `gst_amount = 0`). No extra tax is added on top of the agreed deal ceiling. |

:::tip Live GST Preview Card
When recording a payment on a GST-exclusive (`EXCLUSIVE`) agreement, selecting a rate (such as **18% GST**) displays a blue summary box showing **Amount before GST**, **GST (18%)**, and **Final amount received** before you save.
:::

## Steps to record a payment

1. Open the customer in **Accounts > Confirmation**, **Part Payment**, or **Invoices**.
2. Click the **Record payment** button.
3. In the **Record payment** modal, complete the transaction fields:
   - **Payment type**: Choose **Part payment** (`PART`) or **Full payment** (`FULL`). Selecting **Full payment** automatically prefills the remaining open balance (or remaining taxable balance before GST when `EXCLUSIVE`).
   - **Amount before GST (₹)** *(for `EXCLUSIVE` agreements)* or **Amount (₹)** *(for `INCLUSIVE` agreements)*: Enter the rupee amount.
   - **GST** *(for `EXCLUSIVE` agreements only)*: Select the applicable GST slab from the dropdown: `No GST (0%)`, `5% GST`, `12% GST`, `18% GST` (standard default for software and digital services), or `28% GST`.
   - **Payment method**: Select `UPI`, `Bank transfer`, `Card`, `Cash`, `Cheque`, or `Other`.
   - **Transaction / reference no.**: Enter the bank UTR, UPI transaction ID, card auth code, or cheque number (mandatory for `UPI`, `BANK_TRANSFER`, `CARD`, and `CHEQUE`; optional for `CASH` and `OTHER`).
   - **Payment date & time**: Confirm when the funds settled (cannot be set in the future).
   - **Note (optional)**: Add banking remarks (for example, *"Seen in the HDFC account"*).
4. Optional: Tick **I have received this money and verified it** to record and verify the payment in a single step, or leave it unticked to save the row as `PENDING`.
5. Click **Record & verify** (or **Record payment**).

```flow
Open Record Payment Modal | Accounts Staff | Checks whether agreement is EXCLUSIVE or INCLUSIVE
Enter Amount & GST Rate | Accounts Staff | Base amount + GST slab (0%, 5%, 12%, 18%, 28%) or inclusive amount
Save Entry | Database RPC | Validates ceiling and unique reference; saves as PENDING or VERIFIED
Verify Payment | Accounts Staff | Updates amount_verified, syncs total payable, and unlocks payment confirmation
-> Reversal (if error) | Accounts Lead / Super Admin | Marks row REVERSED with reason and restores balance
```

## Verifying a pending payment

If a payment was recorded without ticking immediate verification:

1. Locate the `PENDING` row in the customer's **Payment history** list.
2. Cross-check the transaction reference against your bank statement.
3. Click **Verify** on the payment row.
4. The database trigger `sync_payment_totals` runs automatically:
   - Transitions the payment status to `VERIFIED`.
   - Increments `customers.amount_verified` by the final payment amount.
   - Sets `customer_onboarding.payment_verified = true` so onboarding item **4. Payment Confirmation** is satisfied.
   - Updates the customer's payment status to `PARTIALLY_PAID` or `FULLY_PAID`.

## Editing or reversing an entry

- **Editing a pending payment**: While a payment row is still `PENDING`, click **Edit** to adjust the amount, GST rate, payment method, or reference number.
- **Reversing a verified payment**: Verified payments are immutable and cannot be edited directly. If a verified entry was recorded in error or a bank chargeback occurs:
  1. Sign in as an Accounts Team Lead, Department Head, or Super Admin.
  2. Click **Reverse** on the verified payment row.
  3. Enter a mandatory audit reason.
  4. The row status changes to `REVERSED`, the amount is subtracted from verified company income, and the customer's outstanding balance is restored.

## What you should see

:::result
The verified transaction displays a green **Verified** badge in the customer's payment history, displays the exact taxable amount and GST breakdown (when applicable), and updates the company's **Account Overview** and **Income** ledgers in real time.
:::

## Good to know

:::important Duplicate Reference Protection
Transaction reference numbers are enforced as unique per customer. Attempting to submit the same UTR or UPI reference twice for a customer is blocked by the database to prevent accidental double-counting.
:::

:::note No Double Taxation Between Payments and Invoices
On GST-exclusive (`EXCLUSIVE`) orders, `sync_order_payable` computes the order's total payable using the larger of the GST on issued invoices and the GST recorded on payments (`greatest(v_pay_gst - v_inv_gst, 0)`). Issuing a tax invoice for a payment never double-counts the GST on the customer's balance.
:::

## If something goes wrong

- **"The agreed amount of this order already includes GST, so GST cannot be added on top"**: The agreement is marked `INCLUSIVE`. If Sales recorded the wrong tax basis, correct the agreement tax basis in the Invoice Builder or ask a Super Admin to review it under [Tax Basis of an Agreement](/super-admin/tax-agreements-review).
- For balance mismatch questions, see [Payment and Balance Discrepancies](/troubleshooting/payment-and-balance-discrepancies).
