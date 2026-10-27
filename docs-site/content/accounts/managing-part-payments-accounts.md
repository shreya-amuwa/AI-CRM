---
title: Managing Part Payments and Balance Collections
description: Tracking multi-tranche part payments, computing Total Payable and Remaining Balance, applying per-installment GST, and logging collection follow-ups.
order: 60
group: Payments
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts, src/components/payments/PartPaymentsView.tsx, supabase/migrations/20261114000200_payment_gst.sql]
related: [customer-journeys/part-payment-journey, accounts/recording-payments, accounts/issuing-an-invoice]
updated: 2026-10-27
---

When customers onboard with an advance installment (`PART` payment), the Accounts Department oversees the collection of remaining milestone tranches in **Accounts > Part Payment** until the full contract value is settled.

## Before you start

:::prereq
- Sign in as **Accounts Staff**, **Department Head**, or **Super Admin** and open **Accounts > Part Payment** in the sidebar.
- The active queue lists all customers with verified advance payments who still carry a positive remaining balance.
:::

## Part-payment balance formulas and interface tabs

For every multi-tranche customer, the CRM computes balance tiles in real time using verified ledger entries:

```
Remaining Balance = Total Payable - Total Verified Payments
```

- **Total Payable (`deal_amount`)**: For `INCLUSIVE` agreements, this equals the gross agreed deal amount. For `EXCLUSIVE` agreements (where GST is added on top of the agreed net amount), `Total Payable` equals the agreed net amount plus the larger of the GST on issued invoices and the GST recorded on payments.
- **Total Verified (`amount_verified`)**: Cumulative sum of all `VERIFIED` installments in `customer_payments` (`PENDING` and `REVERSED` rows are excluded from verified totals).
- **Remaining Balance**: The unpaid amount still owed (`Remaining Balance > ₹0` keeps the customer in the **Active** tab; `Remaining Balance = ₹0` moves the customer to **Fully Paid**).
- **Taxable Balance Left (for `EXCLUSIVE` deals)**: Tracks how much of the net agreed amount before GST remains unpaid (`Agreed Before GST - Verified Taxable Amounts`).

The **Accounts > Part Payment** workspace provides three primary controls:

- **Active Tab**: Displays all customers who have paid at least one verified installment and have a remaining balance (`Remaining Balance > ₹0`).
- **Fully Paid Tab**: Historical archive of customers whose installments have brought their remaining balance to `₹0`.
- **Accountant Assignment (`accounts_owner_id`)**: Assigns a specific accountant as the collections owner and enables the **My Accounts** filter for daily call lists.

## How GST applies per installment on GST-exclusive deals

When a customer's agreement is **GST Exclusive (`EXCLUSIVE`)**, GST is calculated per installment as each tranche arrives:

1. In the **Record payment** modal, enter the **Amount before GST (₹)** for the current installment and select the **GST** rate (`0%`, `5%`, `12%`, `18%`, or `28%`).
2. The modal calculates the installment's GST (`gst_amount`) and the **Final amount received** (`taxable_amount + gst_amount`).
3. When verified, the installment's taxable portion reduces the customer's remaining taxable balance before GST, while the full amount received (`taxable_amount + gst_amount`) is credited to verified collections.

## Steps to follow up on an outstanding balance

1. Open **Accounts > Part Payment** and select the **Active** tab.
2. Locate the customer row and click **Follow-up** (or open the customer drawer).
3. Review the customer's financial summary tiles:
   - **Total Payable**, **Total Verified**, **Remaining Balance**, and the chronological payment and follow-up timeline.
4. Click **Log follow-up note** and fill in the call outcome:
   - **Outcome**: Select `Contacted the customer` (`CONTACTED`), `Awaiting payment` (`AWAITING_PAYMENT`), `No response` (`NO_RESPONSE`), or `Other` (`OTHER`).
   - **Next Follow-up Date**: Pick the scheduled reminder date for the next collection call.
   - **Note**: Summarize the customer's commitment (for example, *"Client confirmed NEFT transfer of remaining ₹50,000 + 18% GST scheduled for Friday"*).
5. Click **Save Follow-up**.

```flow
Review Active Balances | Accounts Staff | Under Accounts > Part Payment (Remaining Balance > ₹0)
Assign Accounts Owner | Accounts Staff | Sets designated collections lead (accounts_owner_id)
Contact Customer & Log Note | Accounts Staff | Records outcome and next follow-up reminder date
Record Next Installment | Accounts Staff | Enters installment amount (and GST rate if EXCLUSIVE) and verifies
Remaining Balance Reaches ₹0 | Database RPC | Stamps customer FULLY_PAID and moves to Fully Paid tab
```

## Recording a subsequent or final installment

When the customer transfers the next tranche:

1. Open the customer drawer in **Accounts > Part Payment** and click **Record payment**.
2. Choose **Part payment** (if another tranche will follow) or **Full payment** (if this payment settles the entire remaining balance).
3. Enter the amount (and select the GST rate if the agreement is `EXCLUSIVE`), choose the payment method, and enter the bank UTR / reference number.
4. Tick **I have received this money and verified it** and click **Record & verify**.
5. If `Remaining Balance` reaches `₹0`, the customer's payment status automatically updates to `FULLY_PAID` and the card moves to the **Fully Paid** tab.

## What you should see

:::result
Every logged collection call appears in the customer's Accounts follow-up history with author and timestamp badges, and each verified installment reduces the **Remaining Balance** immediately.
:::

## Good to know

:::tip Separate Accounts Follow-up Log
Follow-up notes logged in **Accounts > Part Payment** are stored separately from Sales pipeline notes so accounting collection discussions remain clean and auditable.
:::

## If something goes wrong

- If an installment was recorded under the wrong customer or with the wrong GST rate after verification, ask an Accounts Team Lead, Department Head, or Super Admin to click **Reverse** on the payment row and re-record the correct entry.
