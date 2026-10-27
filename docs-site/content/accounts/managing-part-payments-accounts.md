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

- **Total Payable (`deal_amount`)**: For `INCLUSIVE` agreements, this equals the gross agreed deal amount. For `EXCLUSIVE` agreements (where GST is added on top of the agreed net amount), `Total Payable` is worked out from the GST rate Accounts chose for the order (rounded to whole rupees, with the round-off shown); until the rate is chosen it is not calculated and no payment can be recorded.
- **Total Verified (`amount_verified`)**: Cumulative sum of all `VERIFIED` installments in `customer_payments` (`PENDING` and `REVERSED` rows are excluded from verified totals).
- **Remaining Balance**: The unpaid amount still owed (`Remaining Balance > ₹0` keeps the customer in the **Active** tab; `Remaining Balance = ₹0` moves the customer to **Fully Paid**).

The **Accounts > Part Payment** workspace provides three primary controls:

- **Active Tab**: Displays all customers who have paid at least one verified installment and have a remaining balance (`Remaining Balance > ₹0`).
- **Fully Paid Tab**: Historical archive of customers whose installments have brought their remaining balance to `₹0`.
- **Accountant Assignment (`accounts_owner_id`)**: Assigns a specific accountant as the collections owner and enables the **My Accounts** filter for daily call lists.

## How GST applies on GST-exclusive deals

GST is chosen **once for the order** (the **GST for this order** card on the payment panel), not per installment:

1. Choose the GST rate. The total payable (agreed amount + GST, in whole rupees) is saved, and the order balance is that total less the verified payments.
2. In the **Record payment** modal enter the **Amount received (₹)** for the installment: whole rupees, GST included. **Full payment** fills the whole outstanding amount and cannot be typed over.
3. An installment never changes the GST or the total payable. Only verified installments reduce the outstanding balance; pending and rejected ones do not.
4. With several partial invoices, each invoice shows its own balance and the **order** balance is shown separately (for example, two invoices of ₹70,800 on a ₹1,41,600 order with ₹60,000 paid: invoice 1 balance ₹10,800, invoice 2 ₹70,800, order outstanding ₹81,600).

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
