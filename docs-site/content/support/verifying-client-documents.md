---
title: Reviewing and Verifying Client Documents in Support
description: Inspecting, verifying, or returning compliance and KYC files uploaded by clients through their self-service portal.
order: 5
group: Support Operations
roles: [Support Team Member, Support Team Lead, Technical Consultant]
audience: internal
status: verified
sources: [src/components/client-portal/ClientDocumentsReview.tsx, src/components/support-member/SupportMemberDashboard.tsx, shared/contracts.ts]
related: [support/logging-client-activity, client/uploading-client-documents, troubleshooting/document-upload-troubleshooting]
updated: 2026-10-27
---

Active clients can upload updated KYC certificates, brand assets, or compliance documents at any time through their self-service Client Portal. Support staff inspect and verify these submissions from the **Client documents** queue in the Support Dashboard.

## Before you start

:::prereq
- Sign in to the Support Dashboard and open **Client documents** from the sidebar (`Overview`, `My Leads`, `Team Leads`, `Import Customers`, `Client tickets`, `Client calendar`, `Client documents`, `My Tasks` / `Assigned Tasks`, `Leave Request`, `Chat`, `My Profile`).
:::

## Steps to review and verify a client document

1. In the Support Dashboard sidebar, click **Client documents** (`ClientDocumentsReview.tsx`).
2. Browse the two queue tabs:
   - **To verify**: New or replacement files uploaded by clients awaiting staff inspection.
   - **Reviewed**: Previously verified (`VERIFIED`) or returned (`REJECTED`) submissions.
3. Click a submission row in **To verify** to open the review drawer.
4. Click **View Document** to open the file in a secure, short-lived signed viewer link.
5. Check that the document is legible, complete, and matches the customer's business details.
6. Choose your review decision:
   - **Verify (Approve)**: Click **Verify**. The document status changes to `VERIFIED`, locks against accidental edits, and displays a green **Verified** badge on the client's portal.
   - **Send back (Reject)**: Click **Send back**, enter a clear reason explaining what the client needs to fix (for example, *GST certificate scan is cropped at the bottom; please upload the full PDF page*), and confirm.

```flow
Client Uploads Document | Client Portal | File submitted from Client Portal > Documents
Appears in To Verify Tab | System | Listed under Support Dashboard > Client documents
Staff Inspects Signed Link | Support Staff | Reviews clarity and compliance accuracy
-> Approved (Verify) | Support Staff | Status set to VERIFIED and item locked
-> Returned (Send back) | Support Staff | Status set to REJECTED with feedback note sent to client
```

## What you should see

:::result
Once verified or returned, the submission moves from **To verify** to **Reviewed**, and the client receives an immediate portal notification with the outcome.
:::

## Good to know

:::important Ongoing Post-Handover Document Audits
While initial onboarding documents (`2. All Important Documents` and `3. Requirement Document`) are collected during Sales onboarding, the **Client documents** queue remains active throughout the customer's lifetime for renewals, additional service activations, and updated KYC filings.
:::

## If something goes wrong

- **Signed document link expires or fails to open**: Close and reopen the document row to generate a fresh 120-second signed viewing URL, or see [Document Upload Troubleshooting](/troubleshooting/document-upload-troubleshooting).
