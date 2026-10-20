---
title: Reviewing and Verifying Client-Uploaded Documents
description: Processing files and compliance details uploaded by clients via their self-service portal.
order: 50
roles: [Support Team Member, Support Team Lead, Technical Consultant]
audience: internal
status: verified
sources: [docs/CLIENT_DASHBOARD.md, shared/contracts.ts]
related: [support/logging-client-activity, client/uploading-client-documents]
updated: 2026-10-19
---

Clients can upload missing documents, updated compliance certificates, or replacement files directly through their portal dashboard. Support staff review and authenticate these uploads.

## Before you start

:::prereq
- You must have support permissions to review client documents (`private.can_serve_client`).
:::

## Steps

1. In the sidebar, navigate to **Client Documents**.
2. The queue displays all items uploaded or updated by clients, separated into two tabs:
   - **To verify**: Submissions awaiting staff inspection.
   - **Reviewed**: Historical authorized or rejected documents.
3. Click on a document row to open the review drawer.
4. Click **View Document** to inspect the file via a secure 120-second signed URL.
5. Inspect the file for clarity, authenticity, and compliance requirements.
6. Take action:
   - **To approve**: Click **Verify**. The item status updates to `VERIFIED` and locks against further client modifications.
   - **To reject**: Click **Send back**. Enter an explicit feedback note (e.g. *Signature is cropped; please upload complete full-page scan*) and confirm.

```flow
Client Uploads File | Client Dashboard | Customer uploads KYC or certificate
Queue Item Generated | System | Appears in Support "To verify" queue
Staff Reviews Document | Support Staff | Opens temporary signed view link
-> Rejected | Support Staff | Enters reason; status becomes REJECTED
-> Approved | Support Staff | Status becomes VERIFIED; item locks
Client Notified | Realtime | Bell notification sent with review result
```

## What you should see

:::result
When verified, the document moves to the **Reviewed** tab. The client's dashboard updates to display a green **Verified** badge. If rejected, the client receives an alert with your rejection note and a prompt to re-upload.
:::

## Good to know

:::important Post-Handover Verification
Unlike initial sales onboarding reviews that lock upon department handover, the **Client Documents** queue remains open throughout the customer's entire lifetime. When existing clients buy additional services or renew certificates, their documents are audited here.
:::

## If something goes wrong

If a document link fails to open, see [Document Upload Troubleshooting](/troubleshooting/document-upload-troubleshooting).
