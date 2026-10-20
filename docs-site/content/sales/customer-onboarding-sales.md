---
title: Managing Customer Onboarding and Document Collection
description: Collecting required business documentation, filling service checklists, and submitting to the Technical Consultant.
order: 60
roles: [Sales Team Member, Sales Team Lead]
audience: internal
status: verified
sources: [src/components/team-member/pipeline/OnboardingViews.tsx, src/components/team-member/pipeline/ChecklistPanel.tsx, docs/LEADS_ONBOARDING.md]
related: [sales/sending-to-accounts, technical-consultant/onboarding-queue]
updated: 2026-10-19
---

Once the Accounts Department confirms payment, the customer transitions to **Customer onboarding**. The salesperson's responsibility is to collect all necessary business information and upload mandatory compliance documents.

## Before you start

:::prereq
- Accounts must have verified at least one payment.
- Customer must be in **Sales dashboard > My Leads > 3 Customer onboarding**.
:::

## The onboarding checklist sections

When opening a customer in onboarding, the system renders a customized checklist determined by the exact services purchased:

1. **Business Basics**:
   - Registered Business Name and Trading Address.
   - Primary Business Contact (Name, Phone, Email).
   - GST Certificate and Udyam Registration (mandatory when required by service compliance).

2. **Service Specifics**:
   - Meta Business Manager ID, Brand Logo, Website URL, Catalog files, or Call Scripts depending on the selected product.

3. **Mandatory Documents**:
   - **1. Invoice**: Automatically satisfied when Accounts issues the system tax invoice.
   - **2. All Important Documents**: Customer identification, partnership deed, certificate of incorporation, or signed authorization letter.

## Steps to fulfill the checklist

1. In **My Leads**, click **3 Customer onboarding**.
2. Click on the customer to open the onboarding workspace.
3. Review each checklist item:
   - For **Details / Text** items: Click **Fill in**, type the value, and click **Save**.
   - For **File Upload** items: Click **Upload File**. Choose a valid PDF or image file (maximum 2 MB). The system validates the file structure and uploads directly to private storage.
   - For **Yes / No** items: Select the appropriate toggle.
   - For **Account Access** items: Note that access is granted as manager or partner access; passwords must never be collected.
4. As items are completed, their status updates to `SAVED` and the progress bar increments.
5. When all checklist items are saved, the primary action button unlocks:
   **Send to Technical Consultant**.
6. Click **Send to Technical Consultant**.

```flow
Payment Confirmed | Accounts Staff | Customer moves to 3 Customer onboarding
Collect Requirements | Salesperson | Fills Business Basics & Service Specifics
Upload Mandatory Files | Salesperson | Max 2 MB PDFs uploaded to private storage
All Items Saved | System | Checklist counter reaches 100%
Send to Technical Consultant | Salesperson | Unlocks & forwards to TC queue
Technical Review | Technical Consultant | Customer now with TC for compliance audit
```

## What you should see

:::result
The customer card displays status: **Review pending with Technical Consultant**. The Technical Consultant receives an alert and can now inspect, authorize, or return the files.
:::

## Good to know

:::important File Size Limit
Customer documents must strictly remain under **2 MB**. Large scans must be compressed prior to upload.
:::

:::note Optional Items
Optional checklist items are marked with an *Optional* badge and do not block the **Send to Technical Consultant** button.
:::

## If something goes wrong

- **"File upload failed: file too large"**: Ensure the document is under 2 MB and saved as a PDF or standard image.
- **"Button disabled"**: Look for any red asterisks indicating unsaved mandatory checklist items.
