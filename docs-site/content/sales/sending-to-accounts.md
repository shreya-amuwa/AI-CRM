---
title: How to Send an Eligible Customer to Accounts
description: Submitting a customer deal for payment verification, selecting the tax basis, and entering sales notes.
order: 50
roles: [Sales Team Member, Sales Team Lead]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/PotentialView.tsx, docs/DYNAMIC_INVOICES.md, shared/contracts.ts]
related: [sales/moving-to-potential, accounts/payment-confirmation-queue]
updated: 2026-10-19
---

When a customer agrees to purchase and makes an initial payment or commits to payment terms, submit them to the Accounts Department to verify funds and trigger onboarding.

## Before you start

:::prereq
- The customer must have an agreed deal amount greater than ₹0.
- You must verify whether the agreed price **includes GST** or **excludes GST**.
:::

## Steps

1. In the sidebar, navigate to **My Leads > 2 Potential** (or **1 Leads**).
2. Locate the customer and click **Send to Accounts**.
3. In the submission modal, review the customer and deal summary.
4. Select the **Tax Basis**:
   - **Excluding GST (Exclusive)** *(Recommended / Standard)*: Select this if the agreed amount is before tax. For example, if you quoted ₹1,00,000, 18% GST (₹18,000) will be added, resulting in a total payable of ₹1,18,000.
   - **Including GST (Inclusive)**: Select this only if the quoted figure was explicitly inclusive of all taxes.
5. Specify the **Payment Due Date** for any initial or pending balances.
6. In the **Sales Note for Accounts** box, provide transaction details:
   - Payment method (UPI, Bank Transfer, Cheque, Cash).
   - Transaction reference number or screenshot details.
   - Any agreed installment schedules (e.g. *50% token received, 50% due upon Meta verification*).
7. Click **Confirm & Send to Accounts**.

```flow
Review Terms | Salesperson | Potential Queue > Send to Accounts
Select Tax Basis | Salesperson | Exclusive (before tax) or Inclusive
Enter Payment Notes | Salesperson | Method, transaction ref, installment terms
Submit to Accounts | System | Status: PENDING_PAYMENT_CONFIRMATION
Record Locked | System | Customer locks in Sales while Accounts verifies funds
Notification Sent | System | Accounts queue alerts financial team
```

## What you should see

:::result
The customer card displays a purple badge: **Waiting for payment confirmation**. The customer cannot be edited while in this state, preventing conflicting updates while Accounts audits the transaction.
:::

## Good to know

:::important Why Tax Basis Selection Matters
Choosing `EXCLUSIVE` ensures that invoice checks do not artificially cap your deal against a pre-tax amount. The system automatically calculates total payable as:
$$\text{Total Payable} = \text{Agreed Amount} + \text{Applicable GST}$$
:::

:::note A second submission is blocked
You cannot click **Send to Accounts** twice for the same customer while a request is pending.
:::

## If something goes wrong

If Accounts declines the submission, the customer returns to your leads list with status `RETURNED_FROM_ACCOUNTS`. See [Managing Returned Leads](/sales/managing-returned-leads).
