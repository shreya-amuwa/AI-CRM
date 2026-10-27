---
title: Customer Onboarding Checklist and Document Collection
description: Completing the 6-item onboarding checklist, uploading combined compliance PDFs, using the Get Started toggle, and handing over to the Technical Consultant or Department Head.
order: 6
group: Sales Pipeline
roles: [Sales Team Member, Sales Team Lead, Business Associate]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/OnboardingViews.tsx, src/components/team-member/pipeline/ChecklistPanel.tsx, docs/LEADS_ONBOARDING.md]
related: [sales/sending-to-accounts, technical-consultant/onboarding-queue, sales/managing-returned-leads]
updated: 2026-10-27
---

Once the Accounts Department confirms a customer's payment, the record moves to **My Leads > 3 Customer onboarding**. In this stage, the salesperson completes the standardized 6-item onboarding checklist and uploads the required documents so the order can proceed to technical verification or direct department handover.

## Before you start

:::prereq
- Accounts must have confirmed at least one payment (`paymentStatus: 'PARTIAL'` or `'FULL'`).
- The customer must appear in **My Leads > 3 Customer onboarding**.
:::

## The 6-item onboarding checklist

Every customer in **3 Customer onboarding** uses a structured 6-item checklist (`ChecklistPanel.tsx` / `SalesOnboardingWorkspace`) combining sales-uploaded files with auto-linked Accounts confirmations:

1. **`1. Basic Information`**:
   - Core business profile including Registered Business Name, Trading Address, City, Primary Contact Name, Mobile Number, WhatsApp Number, and Email Address.
2. **`2. All Important Documents`**:
   - **Single combined mandatory PDF upload (maximum 2 MB)**.
   - **Important:** All statutory and KYC proofs—including **GST Certificate, Udyam Registration, PAN Card, and shop registration / incorporation proofs**—are combined and uploaded together inside this single mandatory PDF item (`2. All Important Documents`). They are **not** separate checklist rows under Business Basics.
3. **`3. Requirement Document`**:
   - Detailed service scope, campaign brief, bot flow requirements, or product catalog specification uploaded as a PDF or structured document (up to 2 MB).
4. **`4. Payment Confirmation`** *(Auto-linked from Accounts)*:
   - Automatically marked complete and linked once the Accounts Department verifies the customer's payment in the ledger.
5. **`5. Invoice Confirmation`** *(Auto-linked from Accounts)*:
   - Automatically marked complete and linked once Accounts generates and confirms the tax or proforma invoice.
6. **`6. Quotation Shared`**:
   - Confirmation and copy of the commercial quotation shared with and approved by the customer.

:::important Combined KYC & Compliance PDF (`2. All Important Documents`)
Do not look for separate upload fields for GST Certificate, Udyam Registration, or PAN under `1. Basic Information`. Combine the customer's GST Certificate, Udyam Registration, PAN, and business registration proof into a single PDF file (up to **2 MB**) and upload it to **`2. All Important Documents`**.
:::

## Using the `Get Started` filter and toggle

For customers who have paid an initial part-payment (`PARTIAL`) and want onboarding kickstarted while the remaining balance is still scheduled:
- Use the **Get started** filter tab (`GET_STARTED`) in **3 Customer onboarding** to view part-paid customers actively undergoing onboarding.
- Check the **Get Started** readiness indicator on the customer workspace (`getStartedBlockers` in `shared/contracts.ts`), which verifies that `1. Basic Information`, `2. All Important Documents`, `3. Requirement Document`, and initial `4. Payment Confirmation` are in place before forwarding the dossier.

## Steps to complete onboarding and hand over the customer

1. In the sidebar, navigate to **My Leads > 3 Customer onboarding**.
2. Click on the customer row to open the onboarding workspace.
3. Complete each sales-owned item in the 6-item checklist:
   - Confirm **`1. Basic Information`** fields are complete and click **Save**.
   - Under **`2. All Important Documents`**, click **Upload File** and select the combined PDF containing the customer's GST Certificate, Udyam Registration, PAN, and shop registration proofs (max **2 MB**).
   - Under **`3. Requirement Document`**, click **Upload File** and attach the scoped requirement PDF (max **2 MB**).
   - Verify that **`4. Payment Confirmation`** and **`5. Invoice Confirmation`** show green auto-linked badges from Accounts.
   - Upload or confirm **`6. Quotation Shared`**.
4. Once all required checklist items reach `SAVED` / `VERIFIED` (100% progress), click the primary handover button at the top right:
   - **Send to Technical Consultant**: Shown for technical services (such as `Wabastore`, `Whatsbox`, `AI Studio`) that require Technical Consultant verification before Department Head handover.
   - **Send to Department Head**: Shown for direct-delivery journeys (such as `Amuwa Design Studio`) or once technical verification is complete, routing the customer directly to the service Department Head's handover queue.

```flow
Customer Enters 3 Customer onboarding | Accounts | Payment & Invoice confirmations auto-linked (Items 4 & 5)
Verify 1. Basic Information | Salesperson | Confirm business name, address, and contact details
Upload 2. All Important Documents | Salesperson | Upload combined GST, Udyam, PAN & registration PDF (<= 2 MB)
Upload 3. Requirement Document & 6. Quotation Shared | Salesperson | Attach scope brief & commercial quotation
Hand Over Customer | Salesperson | Click "Send to Technical Consultant" or "Send to Department Head"
```

## What you should see

:::result
As each item is saved, the checklist progress counter updates (for example, `6 / 6 completed`) and the customer state badge changes from `Collecting` to `Ready for handover`. After clicking **Send to Technical Consultant** or **Send to Department Head**, the record locks in Sales and notifies the receiving reviewer.
:::

## Good to know

:::important Strict 2 MB File Size Limit
Every uploaded PDF or image in the onboarding checklist must be **2 MB or smaller**. Compress high-resolution phone scans before uploading to avoid validation errors.
:::

## If something goes wrong

- **"File upload failed: file too large"**: Compress the combined PDF so its size is under 2 MB and re-upload.
- **Handover button is disabled**: Check `getStartedBlockers`—ensure `2. All Important Documents` and `3. Requirement Document` are uploaded and `4. Payment Confirmation` is verified by Accounts. See [Document Upload Troubleshooting](/troubleshooting/document-upload-troubleshooting).
