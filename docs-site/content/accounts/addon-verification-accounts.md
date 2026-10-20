---
title: How to Verify Add-on Requests from Technical Consultants
description: Auditing supplemental service requests, reviewing pricing margins, and approving add-on invoices.
order: 70
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/ADDONS_INVOICES.md, shared/contracts.ts]
related: [customer-journeys/addon-services-journey, accounts/issuing-an-invoice]
updated: 2026-10-19
---

When an onboarding customer requires additional services or extra capacity, the Technical Consultant submits a priced add-on request for financial auditing.

## Before you start

:::prereq
- Open **Accounts > Business Verification** and switch to the **Add-on Verification** tab.
- Submissions appear with status `PENDING_VERIFICATION`.
:::

## Review procedure

```flow
Add-on Submitted | Technical Consultant | Appears under Business Verification
Audit Pricing | Accounts Staff | Checks item rates, quantities, and discounts
-> Request Revisions | Accounts Staff | Clicks "Request Changes" with note
-> Approved | Accounts Staff | Clicks "Approve Request"
Generate Add-on Invoice | Accounts Staff | Issues invoice for add-on total
Confirm Add-on Payment | Accounts Staff | Records funds under addon_payments
```

## Steps

1. In **Business Verification**, locate the pending add-on request and click **Review Request**.
2. Examine the proposal details:
   - **Customer & Department**: Confirms customer identity and originating business unit.
   - **Technical Consultant**: Identifies the consultant who drafted the request.
   - **Line Items**: Review service descriptions, quantities, unit prices, discounts, and applicable GST rates.
   - **Financial Calculations**: Check the calculated subtotal, tax amount, and final total.
3. Choose an action:
   - **To approve**: Click **Approve Request**. The request advances to `APPROVED`.
   - **To ask for adjustments**: Click **Request Changes**. Provide a revision note (for example: *Minimum unit price for WhatsApp credits is ₹0.35/msg; please adjust rate*). The request returns to the consultant with status `CHANGES_REQUESTED`.
   - **To decline**: Click **Reject Request** and provide a justification.

## Invoicing and payment confirmation

1. After approval, click **Generate Add-on Invoice**.
2. The invoice engine compiles an official invoice marked with `kind: 'ADDON'`.
3. When the customer pays, Accounts records the transaction under the add-on's payment tab (`addon_payments`).
4. Once verified, click **Confirm Payment**.
5. The request status updates to `PAYMENT_CONFIRMED`. The Technical Consultant is immediately notified to collect any technical requirements.

## What you should see

:::result
The approved add-on transitions to active execution. The revenue is tracked in the business reporting engine and credited to the department.
:::

## Good to know

:::important Original Contract Isolation
An add-on request is managed in its own isolated sub-ledger. Approving or delaying an add-on request never interrupts or blocks the customer's original contract delivery.
:::

## If something goes wrong

If an add-on was approved with incorrect pricing, contact the Technical Consultant to issue a revision or reject the generated draft invoice before sending it to the client.
