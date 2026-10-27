---
title: How to Record and Verify Payments in the Ledger
description: Choosing the GST rate of an order, recording full and part payments, verifying funds, and reversing erroneous entries.
order: 20
group: Payments
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts, src/components/accounts/AccountsPaymentPanel.tsx, supabase/migrations/20261201000100_order_level_gst.sql, docs/PAYMENT_GST.md]
related: [accounts/payment-confirmation-queue, accounts/managing-part-payments-accounts, accounts/dynamic-invoices-overview]
updated: 2026-10-27
---

In Amuwa AI CRM, `customer_payments` is the single source of truth for all incoming customer funds. Accounting staff choose the GST rate of the order, record deposits, attach bank references, and verify ledger rows.

## Before you start

:::prereq
- Verify the incoming transaction on your corporate bank statement or UPI merchant dashboard before recording funds.
- Only Accounts staff, Department Heads, and Super Admins can record, verify, edit, or reverse ledger entries.
:::

## How GST works on an order

GST belongs to the **order**, not to each payment. Sales agrees an amount **before GST** and nothing is added when the order reaches Accounts. In the customer's **Payments** panel, the **GST for this order** card asks you to choose the rate (`No GST (0%)`, `5%`, `12%`, `18%`, `28%`). No rate is pre-selected.

| Step | What you see |
| --- | --- |
| Before you choose | *"Final payable amount not calculated yet"*. **Record payment** is switched off and no invoice can be made. |
| After you choose (for example 18% on ₹1,20,000) | Agreed amount (before GST) ₹1,20,000 · GST (18%) ₹21,600 · **Total payable (including GST) ₹1,41,600**. The rate is saved in the database. |
| Whole rupees | The total payable is rounded to whole rupees and the round-off is shown (for example ₹14 + 18% = ₹16.52, payable **₹17**). |
| After a payment or invoice exists | The rate is locked. To change it, reject or reverse the payments first. |

:::tip A payment is only money received
The **Record payment** form has no GST field. You enter the amount that actually arrived (whole rupees, GST included). It is checked against what is still payable including GST. Recording a payment never changes the GST.
:::

## Steps to record a payment

1. Open the customer in **Accounts > Confirmation**, **Part Payment**, or **Invoices**.
2. If the **GST for this order** card asks for a rate, choose it first.
3. Click the **Record payment** button. The top of the form shows the agreed amount, the GST, the **Total payable (including GST)** and **Still to receive**.
4. Complete the form:
   - **Payment type**: **Part payment** or **Full payment**. **Full payment** fills the whole outstanding amount including GST and cannot be typed over.
   - **Amount received (₹)**: whole rupees, GST included, and not more than *Still to receive*. A part payment must be less than the outstanding amount.
   - **Payment method**: `UPI`, `Bank transfer`, `Card`, `Cash`, `Cheque`, or `Other`.
   - **Transaction / reference no.**: the bank UTR, UPI transaction ID, card auth code or cheque number (required for `UPI`, `Bank transfer`, `Card` and `Cheque`; optional for `Cash` and `Other`).
   - **Payment date & time**: when the funds settled (not in the future).
   - **Note (optional)**.
5. Optional: tick **I have received this money and verified it** to record and verify in one step; otherwise the payment is saved as `PENDING`.
6. Click **Record & verify** (or **Record payment**).

```flow
Choose GST Rate | Accounts Staff | Once per order; saved in the database; locks after the first payment or invoice
Open Record Payment | Accounts Staff | Shows agreed amount, GST, total payable and still to receive
Enter Amount Received | Accounts Staff | Whole rupees including GST; Full payment fills the whole outstanding amount
Save Entry | Database RPC | Checks the amount against what is still payable; saves as PENDING or VERIFIED
Verify Payment | Accounts Staff | Only verified money reduces the outstanding balance
-> Reversal (if error) | Accounts Lead / Super Admin | Marks row REVERSED with reason and restores balance
```

## Invoices and balances

Every invoice line uses the order's GST rate (it is shown read-only in the invoice builder). You can issue one invoice for the whole order or several partial invoices; each is taxed on its own part, and together they cannot pass the agreed amount. Two balances are shown apart, on screen and on the PDF: the **invoice balance** (this invoice's total less the confirmed money applied to it) and the **order balance** (the order's total payable less all confirmed payments).

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

- **Editing a pending payment**: While a payment row is still `PENDING`, click **Edit** to adjust the amount, payment method, or reference number.
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
