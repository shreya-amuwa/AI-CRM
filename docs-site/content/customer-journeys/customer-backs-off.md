---
title: Handling Customers Who Back Off or Return
description: Procedures and business rules when a customer cancels, postpones payment, or is returned for revisions.
order: 60
roles: [Sales Team Member, Accounts Staff, Technical Consultant]
audience: internal
status: verified
sources: [docs/PAYMENTS_ACCOUNTS.md, docs/TECHNICAL_CONSULTANT.md, shared/contracts.ts]
related: [sales/managing-returned-leads, accounts/payment-confirmation-queue]
updated: 2026-10-19
---

When a deal stalls, payment fails, or a customer decides not to proceed, the CRM provides safe mechanisms to return the record without corrupting accounting ledgers or losing historical notes.

## Before you start

:::prereq
- Only the department currently holding the customer record can initiate a return.
- If money has already been verified in the ledger, strict financial rules apply.
:::

## Return pathways

```flow
Customer with Accounts | Accounts Staff | In Confirmation Queue
Customer Cancels / Declines | Accounts Staff | Clicks "Customer Backed Off"
-> Payment Already Verified | Return Refused | Must reverse payment first
Returned to Sales | System | Status: RETURNED_FROM_ACCOUNTS; reason preserved
Sales Follow-up | Sales Team Member | Re-engages lead or marks LOST
```

### Scenario A: Customer backs off in Accounts
If a customer refuses to pay or requests contract adjustments while awaiting confirmation:
1. The accountant opens the customer in **Accounts > Confirmation**.
2. Click **Customer Backed Off**.
3. Select or enter the cancellation reason (e.g. *Client requested pricing revision* or *Client unresponsive*).
4. Confirm the return.
5. The customer returns to the salesperson's **My Leads** under the **Returned from Accounts** tab with payment workflow `RETURNED_FROM_ACCOUNTS`.

### Scenario B: Payment was already verified
:::warning Strict Ledger Safeguard
If any payment record has already been marked `VERIFIED`, the **Customer Backed Off** button is disabled. The system strictly forbids returning a customer with active verified income.
:::
To return a customer with verified payments:
1. An Accounts Team Lead or Department Head must open the customer's ledger.
2. Review the payment and click **Reverse Payment** (with a documented justification).
3. Once the payment status is `REVERSED` and verified income is zero, the customer can be returned.

### Scenario C: Technical Consultant returns for corrections
If onboarding documents are invalid, blurry, or fail Meta compliance:
1. The Technical Consultant marks items as **Not authorized** with explicit feedback notes.
2. The consultant clicks **Send back for re-verification**.
3. The customer appears in Sales under **Returned by consultant**.
4. The salesperson collects corrected files and clicks **Send again to Technical Consultant**.

### Scenario D: Final cancellation (Lost deal)
If a returned lead definitively refuses to purchase after follow-ups:
1. The salesperson opens the lead form.
2. Change stage/status to `Lost`.
3. Document the final outcome in **Conversations**.

## What you should see

:::result
Returned records retain complete conversation history and rejection notes. The salesperson receives a notification bell alert identifying why the customer was returned.
:::

## Good to know

:::note Lead Retention
Returned records are never deleted. They remain searchable in historical filters for future re-engagement campaigns.
:::

## If something goes wrong

If an Accounts return button is grayed out, check if a verified payment exists in the customer's payment tab.
