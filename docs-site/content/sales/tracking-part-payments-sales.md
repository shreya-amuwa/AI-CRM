---
title: Tracking Part-Payment Customers in Sales
description: Monitoring customer payment installments, Total Payable, Paid (Verified), and Balance Pending from the Sales Panel.
order: 7
group: Sales Pipeline
roles: [Sales Team Member, Sales Team Lead, Business Associate]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/PipelineWorkspace.tsx, docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts]
related: [customer-journeys/part-payment-journey, sales/customer-onboarding-sales, accounts/managing-part-payments-accounts]
updated: 2026-10-27
---

The Sales Panel provides a dedicated **Part payments** view so sales representatives and Team Leads can monitor customers who have paid an initial advance and still carry an outstanding balance.

## Before you start

:::prereq
- The customer must have at least one payment verified by the Accounts Department (`paymentStatus: 'PARTIAL'`) and a remaining balance greater than ₹0.
:::

## Viewing part-payment balances in Sales

1. In the sidebar, navigate to **My Leads > Part payments** (or filter by **Get started** inside **3 Customer onboarding**).
2. The table lists every customer in your assigned scope currently carrying an active balance.
3. Click any customer row to inspect the payment ledger breakdown (`PaymentOverview`), installment history, and current onboarding progress.

## How Sales tracks Total Payable, Paid (Verified), and Balance Pending

Every part-payment record calculates balances strictly from Accounts-verified ledger entries:

```text
Balance Pending = Total Payable − Total Verified Payments
```

:::note How GST Affects Total Payable
- **Excluding GST deals**: `Total Payable` equals the agreed Deal Amount plus 18% GST.
- **Including GST deals**: `Total Payable` equals the agreed Deal Amount (with 18% GST already inside the total).
- Unverified payment claims remain in `PENDING` state and do **not** reduce `Balance Pending` until Accounts marks them `VERIFIED`.
:::

## Table columns explained

| Column | Description |
| --- | --- |
| **Customer / Business** | Customer contact name, company name, and 10-digit mobile number. |
| **Services** | Service chips showing all purchased catalog services. |
| **Total Payable (Deal Value)** | The total payable contract amount (accounting for the selected GST basis). |
| **Paid (Verified)** | Real funds received and verified by the Accounts Department in the ledger. |
| **Balance Pending** | Remaining balance calculated as `Balance Pending = Total Payable − Total Verified Payments`. |
| **Last Payment** | Date, payment mode, and amount of the most recent verified installment. |
| **Salesperson** | The team member or Business Associate who owns the deal. |

## What you should see

:::result
Opening a customer from **Part payments** displays their full payment summary (`Total Payable`, `Paid (Verified)`, and `Balance Pending`), verified installment receipts, and current onboarding checklist status.
:::

## Good to know

:::important Read-Only Ledger Boundary in Sales
In the Sales Panel, the **Part payments** ledger is **read-only**. Salespersons cannot manually mark installments as verified; all balance collections and bank statement verifications are executed by the Accounts Department in their **Part payments** workspace.
:::

:::tip Automatic Balance Clearing
As soon as Accounts verifies the final installment and `Balance Pending` reaches `₹0`, the customer's payment status updates to `FULL` and they automatically leave the **Part payments** queue.
:::

## If something goes wrong

- **Customer paid an installment but `Paid (Verified)` has not updated**: Share the UTR / transaction reference with Accounts or submit the installment details so Accounts can verify the payment against the bank statement. See [Payment and Balance Discrepancies](/troubleshooting/payment-and-balance-discrepancies).
