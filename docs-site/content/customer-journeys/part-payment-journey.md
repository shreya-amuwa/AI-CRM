---
title: The Part-Payment Journey
description: Rules and workflows for onboarding customers with partial deposits and collecting remaining balances.
order: 50
roles: [Sales Team Member, Accounts Staff, Technical Consultant]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, docs/DYNAMIC_INVOICES.md, shared/contracts.ts]
related: [accounts/managing-part-payments-accounts, sales/tracking-part-payments-sales]
updated: 2026-10-19
---

Amuwa AI CRM allows customers who pay an initial advance or token amount to progress into onboarding while maintaining strict ledger tracking for remaining balances.

## Before you start

:::prereq
- The customer must have an agreed deal amount (total contract value including or excluding GST).
- An initial payment installment must be received and verified by Accounts.
:::

## Part-payment lifecycle

```flow
Agreed Deal Amount | Sales Team Member | Example: ₹1,00,000 deal value
Send to Accounts | Sales Team Member | Submits deal with payment due date
Advance Payment Received | Accounts Staff | Records ₹40,000 payment in ledger
Payment Verified | Accounts Staff | Status becomes PARTIALLY_PAID; Balance: ₹60,000
Customer Moves to Onboarding | System | Initial deposit unlocks technical onboarding
Part-Payment Invoice Issued | Accounts Staff | Issues invoice for ₹40,000 collected advance
Balance Follow-ups | Accounts Staff | Tracks reminder dates under Part Payments queue
Final Balance Settled | Accounts Staff | Records remaining ₹60,000; status: FULLY_PAID
```

## Financial rules

### 1. Ledger tracking
- `deal_amount`: Total contract value payable.
- `amount_verified`: Money Accounts has verified in the ledger.
- `balance`: `deal_amount` minus `amount_verified`.
- `payment_status`:
  - `PARTIALLY_PAID`: `amount_verified > 0` and `balance > 0`.
  - `FULLY_PAID`: `balance == 0`.

### 2. Can part-payment customers onboard?
**Yes.** Once Accounts confirms the initial verified payment, the customer moves to `ONBOARDING`. The Technical Consultant can review documents, verify Meta assets, and provision client access.

### 3. Invoicing per part payment
Accounts can issue a dedicated GST invoice for each part payment installment as it is collected:
- Invoices together may not exceed the agreed contract amount.
- Verified ledger payments pay invoices in the order they were issued (first invoice receives first money).

### 4. Separate follow-up channels
To prevent confusion:
- **Accounts Follow-up Notes**: Accountants record collection calls and reminder dates in `payment_followups` under **Accounts > Part Payment**.
- **Sales Conversations**: Sales conversations remain clean and focused on relationship management.

## What you should see

:::result
In both Sales and Accounts dashboards, the customer badge clearly shows **Partially paid** with the verified amount and remaining balance displayed in bold.
:::

## Good to know

:::important Zero Balance Milestone
When the final balance payment is verified, the customer automatically moves from the **Active Part Payments** queue to the **Fully Paid** tab.
:::

## If something goes wrong

If an invoice total does not match the ledger balance, see [Payment and Balance Discrepancies](/troubleshooting/payment-and-balance-discrepancies).
