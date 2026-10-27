---
title: How to Verify Add-on Requests from Technical Consultants
description: Auditing supplemental service requests in Business Verification, reviewing pricing margins, issuing ADDON invoices, and confirming add-on payments.
order: 70
group: Payments
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/ADDONS_INVOICES.md, shared/contracts.ts, src/components/accounts/BusinessVerification.tsx]
related: [customer-journeys/addon-services-journey, accounts/issuing-an-invoice, technical-consultant/submitting-addon-requests]
updated: 2026-10-27
---

When an onboarding or active customer requests supplemental services or extra capacity, the Technical Consultant submits a priced add-on proposal (`POST /api/v1/onboarding/:customerId/addon-requests`) for financial review in **Accounts > Business Verification**.

## Before you start

:::prereq
- Sign in as **Accounts Staff**, **Department Head**, or **Super Admin**.
- In the left sidebar, open **Accounts > Business Verification**. Pending submissions display the `PENDING_VERIFICATION` badge.
:::

## Review and invoicing workflow

```flow
Add-on Submitted | Technical Consultant | Appears in Accounts > Business Verification (PENDING_VERIFICATION)
Audit Scope & Pricing | Accounts Staff | Reviews line items, quantities, negotiated rates, and GST
-> Request Revisions | Accounts Staff | Clicks "Request Changes" with note (status: CHANGES_REQUESTED)
-> Approve Proposal | Accounts Staff | Clicks "Approve Request" (status: APPROVED)
Issue Add-on Invoice | Accounts Staff | Generates invoice with purpose ADDON (status: INVOICED)
Confirm Add-on Payment | Accounts Staff | Verifies payment in addon_payments (status: PAYMENT_CONFIRMED)
```

## Steps to audit and approve an add-on request

1. In **Accounts > Business Verification**, locate the pending add-on card and click **Review Request**.
2. Inspect the proposal details:
   - **Customer & Department**: Confirms the customer identity, customer code, and originating business unit.
   - **Submitted By**: Shows the Technical Consultant or Support member who drafted the proposal.
   - **Line Items**: Check each requested service, quantity, unit price before GST, discount, and applicable GST rate.
   - **Consultant Notes**: Review the scope justification and payment terms noted by the consultant.
3. Take the appropriate review action:
   - **Approve**: Click **Approve Request** if pricing and margins comply with company policy. The request status advances to `APPROVED`.
   - **Request Changes**: Click **Request Changes** and enter a specific revision note (for example, *"Minimum unit rate for additional WhatsApp flows is ₹5,000; please revise line 2"*). The proposal returns to the Technical Consultant with status `CHANGES_REQUESTED`.
   - **Reject**: Click **Reject Request** and provide an audit reason if the request was submitted in error or cancelled by the client.

## Issuing the add-on invoice and confirming payment

1. Once an add-on request is `APPROVED`, click **Create Invoice** on the add-on card (or open **Accounts > Invoices > Create invoice** and select purpose **An approved add-on request**).
2. The Invoice Builder loads the approved add-on line items and generates a tax invoice tagged with `kind: 'ADDON'`.
3. When the customer pays for the add-on:
   - Open the add-on request's payment panel (`addon_payments`).
   - Record and verify the incoming transaction with the bank UTR / reference number.
   - Click **Confirm Payment**.
4. The add-on status updates to `PAYMENT_CONFIRMED` (or `PAID`), and the Technical Consultant is notified to collect any add-on documents and fulfill the supplemental service.

## What you should see

:::result
The verified add-on payment is recorded in the `addon_payments` sub-ledger, the add-on invoice can be stamped **PAID**, and the revenue is automatically attributed to the **Support** division (`SUPPORT_ADDON`) in **Income by Division** and **Business Reports**.
:::

## Good to know

:::important Core Onboarding Isolation
Add-on proposals, invoices, and payments live in an isolated sub-ledger (`addon_requests` and `addon_payments`). Reviewing, returning, or awaiting payment on an add-on request never blocks the customer's primary onboarding checklist or handover to the Department Head.
:::

## If something goes wrong

- If an add-on request was approved with an incorrect unit price before an invoice was issued, open the request in **Accounts > Business Verification** and return it to the consultant for correction before generating the invoice.
