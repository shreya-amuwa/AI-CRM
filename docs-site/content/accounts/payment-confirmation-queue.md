---
title: Managing the Payment Confirmation Queue
description: How the Accounts Department audits Sales and Support submissions, reviews contract terms, and confirms onboarding.
order: 10
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, shared/contracts.ts, src/components/accounts/AccountsDashboard.tsx]
related: [accounts/recording-payments, sales/sending-to-accounts]
updated: 2026-10-19
---

The Payment Confirmation Queue is the primary financial checkpoint in Amuwa AI CRM. Every sale originated by Sales or Support must be audited here before funds are recognized and onboarding begins.

## Before you start

:::prereq
- Sign in with an Accounts Department Staff or Accounts Head account.
- In the sidebar, open **Accounts > Confirmation**.
:::

## Submission card overview

Each pending submission displays essential audit details:
- **Origin Division Badge**: Marked as **SALES** or **SUPPORT** with the submitting employee's name.
- **Agreed Amount & Payable Amount**: Displays whether the deal was agreed `EXCLUSIVE` of GST (where 18% tax is added) or `INCLUSIVE` of GST.
- **Purchased Services**: Badges indicating all products included in the order.
- **Salesperson's Notes**: Transaction references, payment slips, or installment schedules typed by the submitting representative.
- **Last Conversation**: The most recent dialogue logged with the customer.

## Workflow procedure

```flow
Submission Arrives | Sales or Support | Appears in Accounts Confirmation Queue
Auditor Reviews Slip | Accounts Staff | Compares bank statement with transaction ref
Record Payment | Accounts Staff | Enters received amount, method, and ref
Verify Payment in Ledger | Accounts Staff | Status becomes VERIFIED; real income counted
-> If Client Refused | Accounts Staff | Clicks "Customer Backed Off" (if no money verified)
Confirm & Advance | Accounts Staff | Clicks "Confirm Payment & Return to Sales"
Onboarding Starts | System | Customer transitions to ONBOARDING stage
```

## Steps to confirm a customer

1. Open **Accounts > Confirmation**.
2. Locate the customer submission and click **Review Details**.
3. Verify that funds have cleared on the corporate bank statement or gateway:
   - Match the transaction reference number.
   - Confirm the credited amount matches the deposit.
4. Record the received funds using **Record Payment** (see [Recording Payments in the Ledger](/accounts/recording-payments)).
5. Verify the payment entry.
6. Once at least one verified payment exists:
   - Click the green button: **Confirm Payment & Return to Sales**.
7. The customer is automatically transitioned to `ONBOARDING` status, and the submitting salesperson is alerted via the notification bell.

## What you should see

:::result
The customer leaves the Confirmation queue. The transaction is immediately reflected in the company's **Verified Income** ledger and credited to the originating department in business reports.
:::

## Good to know

:::important When can a customer be returned?
If the deal fell through or payment failed, click **Customer Backed Off**. This button is only active while **zero verified payments** exist in the ledger.
:::

:::note Client Login for Direct Journeys
If the customer purchased direct delivery services (such as Design Studio), the accountant must click **Create client login** before confirming the customer back to Sales.
:::

## If something goes wrong

If an amount on the bank statement does not match the sales submission, contact the salesperson or reject the submission with an explanatory note.
