---
title: Authorizing and Rejecting Onboarding Requirements
description: How Technical Consultants inspect documents, authorize checklist items, and reject non-compliant files.
order: 20
roles: [Technical Consultant, Support Team Lead, Department Head]
audience: internal
status: verified
sources: [docs/TECHNICAL_CONSULTANT.md, shared/contracts.ts]
related: [technical-consultant/onboarding-queue, technical-consultant/returning-to-sales]
updated: 2026-10-19
---

Technical Consultants are responsible for verifying customer legal identities, validating Meta Business Manager IDs, and ensuring all assets comply with partner platform policies.

## Before you start

:::prereq
- Open a customer from the **Onboarding Customers** queue.
- Items saved by Sales display status **Saved** with a blue dot.
:::

## Review controls

Each checklist item provides actionable audit controls:

| Control | Action Performed |
| --- | --- |
| **View document** | Generates a secure, temporary 120-second link to inspect the PDF or image file. |
| **Authorize** | Approves the file or detail. Status updates to `VERIFIED` with a green checkmark. |
| **Not authorized** | Rejects the submission. Opens a dialog requiring an explicit reason. Status updates to `REJECTED`. |
| **Authorize all** | Bulk-approves all currently saved items if pre-inspected. |

## Step-by-step verification procedure

1. In the customer checklist, scroll to the item to review (e.g. *GST Certificate* or *Facebook Business Manager Access*).
2. For file items:
   - Click **View document**.
   - Verify that the business legal name matches the contract.
   - Verify that the GSTIN matches the state of operation.
   - Check that the document scan is clear and legible.
3. If compliant:
   - Click **Authorize**.
4. If non-compliant:
   - Click **Not authorized**.
   - In the modal, provide an actionable explanation (for example: *GST certificate is blurred; cannot read the legal entity name or state code*).
   - Click **Confirm Rejection**. The item displays a red tag and your feedback note.

```flow
Inspect Checklist Item | Technical Consultant | Clicks "View document"
Review Document Details | Technical Consultant | Verifies legal entity & compliance
-> Compliant | Technical Consultant | Clicks "Authorize" -> Status: VERIFIED
-> Non-compliant | Technical Consultant | Clicks "Not authorized" with reason -> REJECTED
Progress Updates | System | Progress counter updates towards 100%
```

## Items filled by the Technical Consultant

Certain technical identifiers (such as **WhatsApp Business Account (WABA) ID** or **App ID**) must be generated and filled by the consultant:
1. Locate items tagged with **Filled by Consultant**.
2. Click **Fill in**.
3. Paste the generated platform ID.
4. Click **Save**.

## What you should see

:::result
Authorized items render with a green checkmark and cannot be altered by Sales. When all items reach `VERIFIED` status, the customer's onboarding state updates to **Authorized**.
:::

## Good to know

:::important Rejection Reasons are Mandatory
When clicking **Not authorized**, you must type a reason. This reason is displayed verbatim to the salesperson so they can collect the correct replacement file without delay.
:::

## If something goes wrong

If an item was marked **Not authorized** by mistake, you can click **Authorize** at any time to override the status.
