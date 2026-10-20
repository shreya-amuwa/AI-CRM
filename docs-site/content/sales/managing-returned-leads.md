---
title: How to Handle Leads Returned from Accounts or Technical Consultant
description: Investigating return reasons, correcting rejected documents, and resubmitting leads to the appropriate department.
order: 70
roles: [Sales Team Member, Sales Team Lead]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/LeadsView.tsx, src/components/team-member/pipeline/OnboardingViews.tsx, docs/TECHNICAL_CONSULTANT.md]
related: [sales/my-leads-overview, sales/customer-onboarding-sales]
updated: 2026-10-19
---

When a deal cannot be confirmed by Accounts or compliance items fail technical inspection, the CRM returns the customer to Sales with explicit feedback notes so you can resolve the issue with the client.

## Before you start

:::prereq
- You will receive a notification bell alert when a lead is returned.
- Check whether the return originated from **Accounts** or from the **Technical Consultant**.
:::

## Scenario 1: Returned from Accounts

### Symptoms
The customer appears in **My Leads > 1 Leads** under the **Returned from Accounts** tab with a red warning badge.

### Resolution Steps
1. Click on the customer card to open the record.
2. Review the **Resolution Note from Accounts** at the top of the details panel. Common reasons include:
   - *Payment reference could not be verified on the bank statement.*
   - *Customer claims price difference; please align on quotation.*
   - *Invalid GSTIN supplied for corporate invoice.*
3. Contact the customer to clarify the payment reference or adjust terms.
4. If the deal is salvaged, update the deal amount or notes and click **Send to Accounts** again.
5. If the customer declines to proceed, change the status to `LOST` and document the outcome in **Conversations**.

## Scenario 2: Returned by Technical Consultant

### Symptoms
The customer appears in **My Leads > 3 Customer onboarding** under the **Returned by consultant** filter.

### Resolution Steps
1. Open the customer in the onboarding view.
2. Read the **Re-verification Note** banner written by the consultant.
3. Review the checklist items below. Any rejected item displays a red **Not authorized** badge and the consultant's specific reason (for example: *Electricity bill is older than 3 months; please provide current utility bill for Meta verification*).
4. For each rejected item:
   - Obtain the corrected document or detail from the client.
   - Click **Replace File** or **Edit Details**.
   - Upload the compliant file. The item status changes to `SAVED`.
5. Once all rejected items are resolved, the button changes to:
   **Send again to Technical Consultant**.
6. Click **Send again to Technical Consultant**.

```flow
Item Rejected | Technical Consultant | Marks item "Not authorized" with reason
Sent Back to Sales | Technical Consultant | Customer moves to "Returned by consultant"
Sales Resolves Issue | Salesperson | Collects compliant document & re-uploads
All Items Fixed | System | Item status returns to SAVED
Send Again to TC | Salesperson | Unlocked; forwards record back to TC queue
```

## What you should see

:::result
The customer moves out of the returned queue and re-enters the Technical Consultant's active review list. The consultant is notified that corrections have been submitted.
:::

## Good to know

:::note Consultant Visibility While With Sales
While you are fixing returned items, the customer remains visible in the Technical Consultant's dashboard in a read-only state labeled **Waiting for sales team**. As soon as you upload a fix, the consultant sees the item update to *Pending review*.
:::

## If something goes wrong

If you cannot fulfill a required item, contact your Technical Consultant directly or leave a note in Conversations before resubmitting.
