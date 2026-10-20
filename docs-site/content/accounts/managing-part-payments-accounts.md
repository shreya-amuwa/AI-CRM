---
title: Managing Part Payments and Balance Collections
description: Following up on outstanding balances, assigning accounts owners, and logging collection calls.
order: 60
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts]
related: [customer-journeys/part-payment-journey, accounts/recording-payments]
updated: 2026-10-19
---

When customers onboard with an advance payment, the Accounts Department oversees the collection of remaining milestone balances.

## Before you start

:::prereq
- Open **Accounts > Part Payment** in the Accounts Dashboard.
- The queue displays customers carrying active balances.
:::

## Interface features

- **Active Tab**: Displays all customers with verified advance payments and an unpaid balance ($$\text{Balance} > ₹0$$).
- **Fully Paid Tab**: Historical record of customers whose balances have been completely settled.
- **Accountant Assignment**: Assign an accountant as the designated collections lead (`accounts_owner_id`).

## Steps to follow up on an outstanding balance

1. Open **Accounts > Part Payment**.
2. Locate the customer and click **Follow-up**.
3. In the collection drawer, review:
   - Total Deal Value.
   - Total Amount Verified to date.
   - Outstanding Balance Due.
   - Historical follow-up timeline.
4. Click **Log follow-up note**:
   - **Outcome**: Select `Contacted`, `Awaiting Payment`, `No Response`, or `Other`.
   - **Next Follow-up Date**: Set a future reminder date.
   - **Note**: Detail the customer's response (e.g. *Client confirmed wire transfer of remaining ₹50,000 scheduled for Wednesday*).
5. Click **Save Follow-up**.

```flow
Review Active Balances | Accounts Staff | Under Accounts > Part Payment
Assign Accounts Lead | Accounts Staff | Designates owner for collections
Contact Customer | Accounts Staff | Phones or messages customer for balance
Log Follow-up Note | Accounts Staff | Records outcome and next scheduled reminder
Record Second Payment | Accounts Staff | Once funds clear, records new installment
Balance Becomes ₹0 | Database RPC | Moves customer to "Fully Paid" tab
```

## Recording an installment payment

When the client settles the second or final installment:
1. In the customer drawer, click **Record Payment**.
2. Enter the received amount, payment method, bank reference, and date.
3. Click **Verify Payment**.
4. The outstanding balance updates in real time:
   - If a balance remains, the updated balance is displayed.
   - If the balance reaches ₹0, the customer is stamped `FULLY_PAID` and moves to the **Fully paid** tab.

## What you should see

:::result
Follow-up records appear in the customer's collection history with author timestamps. Follow-up notes in Accounts are kept separate from Sales conversations, ensuring accounting records remain confidential.
:::

## Good to know

:::tip Assigning Ownership
Filtering the Part Payments queue by **My Accounts** shows only the customers specifically assigned to you, streamlining daily collection calls.
:::

## If something goes wrong

If a payment was recorded against the wrong customer, have your department head reverse the entry to restore the proper balance.
