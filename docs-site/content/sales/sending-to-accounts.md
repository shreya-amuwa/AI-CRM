---
title: Requesting Payment Confirmation from Accounts
description: Submitting a customer deal from Potential to the Accounts Confirmation queue, choosing the GST basis, and handling confirmed vs rejected requests.
order: 5
group: Sales Pipeline
roles: [Sales Team Member, Sales Team Lead, Business Associate]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/PotentialView.tsx, docs/DYNAMIC_INVOICES.md, shared/contracts.ts]
related: [sales/moving-to-potential, accounts/payment-confirmation-queue, sales/managing-returned-leads]
updated: 2026-10-27
---

When a customer in **2 Potential** makes an initial payment (full or part payment) or agrees to invoice terms, submit a **Confirm Payment** (`Send to Accounts`) request so the Accounts Department can verify the funds in the bank statement and issue a tax invoice.

## Before you start

:::prereq
- The customer must be in **My Leads > 2 Potential** (or **1 Leads**) with an agreed deal amount greater than ₹0 and at least one selected service.
- Confirm whether the agreed commercial price **excludes GST** (tax added on top) or **includes GST**.
:::

## Steps to submit a payment confirmation request

1. In the sidebar, navigate to **My Leads > 2 Potential**.
2. Locate the customer and click **Confirm Payment** (or **Send to Accounts**).
3. In the **Payment Confirmation** modal (`PaymentDialog`), verify the customer details and selected services.
4. Confirm or enter the **Agreed amount (₹)** in whole Rupees (no paise).
5. Select the **GST Basis** under **Does this amount include GST?**:
   - **No, GST is added on top (amount excluding GST)** *(default)*: Choose this when the quoted price is before tax. For example, on a ₹1,00,000 deal, 18% GST (₹18,000) is added on top for a total payable of ₹1,18,000.
   - **Yes, GST is already included in this amount**: Choose this only when the agreed total explicitly includes 18% GST.
6. Enter the payment details collected from the customer (payment mode such as `UPI`, `NEFT`, `IMPS`, `RTGS`, `Cheque`, or `Cash`, amount paid, and UTR / transaction reference if available).
7. In **Note for Accounts** (optional), add installment terms or billing notes (for example, *50% advance paid via UPI ref 428910293812; remaining 50% due after WABA green tick submission*).
8. Click **Send to Accounts** / **Confirm Payment**.

```flow
Open Potential Deal | Salesperson | My Leads > 2 Potential > Confirm Payment
Select GST Basis & Terms | Salesperson | Choose Excluding GST or Including GST + add payment note
Submit Request | System | Sets paymentWorkflow to CONFIRMATION_PENDING
Appears in Accounts Queue | Accounts Staff | Listed under Accounts > Confirmation tab
-> Confirmed by Accounts | Accounts Staff | Payment verified; customer advances to 3 Customer onboarding
-> Rejected / Returned | Accounts Staff | Returns to Sales with resolution note (RETURNED_FROM_ACCOUNTS)
```

## What happens after submission: Confirm vs Reject

- **While Pending (`paymentWorkflow: 'CONFIRMATION_PENDING'`)**:
  - The customer card displays a purple **Waiting for payment confirmation** badge.
  - Commercial fields are locked in Sales while Accounts reviews the item in their **Confirmation** tab.
- **When Accounts Confirms the Payment**:
  - Accounts verifies the transaction reference, records the verified amount in the payment ledger, and issues the system invoice.
  - For **Direct Delivery** services (such as `Amuwa Design Studio`), Accounts also provisions the Client Portal login automatically.
  - The customer transitions to **3 Customer onboarding** (`stage: 'ONBOARDING'`) so you can complete the onboarding checklist.
- **When Accounts Rejects / Returns the Request**:
  - If the UTR/reference cannot be located on the bank statement or the GST details are mismatched, Accounts returns the request with a mandatory reason.
  - The customer appears under the **Returned from Accounts** filter in **1 Leads** / **2 Potential** with the Accounts resolution banner so you can follow up with the client and resubmit.

## What you should see

:::result
Immediately after clicking **Send to Accounts**, the customer card shows **Waiting for payment confirmation** (`CONFIRMATION_PENDING`) and an instant notification is delivered to the Accounts Department queue.
:::

## Good to know

:::important Choosing the Correct GST Basis
If a pre-tax price is mistakenly submitted as **Including GST**, the total payable and invoice tax split will be short by 18%. Always verify whether GST is extra before submitting. If a mistake occurs, Accounts can override the tax basis with an audited reason during confirmation.
:::

:::note Duplicate Submissions Blocked
You cannot submit a second payment confirmation request for the same customer while a request is already in `CONFIRMATION_PENDING` status.
:::

## If something goes wrong

- **Request returned by Accounts**: Open the customer record, read the **Resolution Note from Accounts** banner at the top, verify the corrected UTR or amount with the client, and click **Send to Accounts** again. See [Managing Returned Leads](/sales/managing-returned-leads).
