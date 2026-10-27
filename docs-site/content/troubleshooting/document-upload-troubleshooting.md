---
title: Troubleshooting Document Upload and Verification Errors
description: Resolve file size rejections, unsupported file formats, pre-signed upload URL errors, and checklist verification blocks using the authoritative upload limits table.
order: 4
group: Documents & Onboarding
roles: [Technical Consultant, Sales Team Member, Support Team Member, Accounts, HR, Super Admin]
audience: internal
status: verified
sources: [shared/contracts.ts, src/client/Documents.tsx, src/client/Tickets.tsx, src/components/chat/ChatWorkspace.tsx, src/components/LeadAssign.tsx, src/components/ExistingCustomerImport.tsx]
related:
  - /sales/customer-onboarding-sales
  - /technical-consultant/verifying-checklist-items
  - /client/uploading-client-documents
updated: 2026-10-27
---

Amuwa AI CRM validates file sizes, extensions, and row limits before uploading files to encrypted Cloudflare R2 storage or processing spreadsheet imports. Use this guide and the authoritative limits table below whenever an upload or import is rejected.

## Before you start

:::prereq
- Check which upload screen the user is working in (Onboarding Checklist, Client Portal Documents, Invoice PDF Upload, Telecaller Lead Assign, Existing Customer Import, Chat, or Support Tickets).
- Compare the file's size and extension against the **Authoritative File Upload Limits Table** below.
:::

## Authoritative File Upload Limits Table

| Upload Surface / Feature | Source / Constant | Max File Size | Max Count / Rows | Accepted Formats & Special Rules |
| :--- | :--- | :--- | :--- | :--- |
| **Customer Onboarding & Client Portal Documents** | `CUSTOMER_DOCUMENT_MAX_BYTES` | **2 MB** standard checklist limit (up to **10 MB** max in upload endpoint) | 1 file per checklist item | `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.csv`, `.xlsx`, `.mp3`, `.wav`, `.m4a`. Note: checklist item **`2. All Important Documents`** requires a **single combined PDF up to 2 MB**. |
| **Uploaded Invoice PDF** | `INVOICE_PDF_MAX_BYTES` | **500 KB** | 1 file per invoice | `.pdf` only. |
| **Telecaller Lead Assign Sheet** | `LeadAssign.tsx` | **700 KB** | Max **2,000 rows** | `.xlsx` only (legacy `.xls` files must be re-saved as `.xlsx` in Excel before upload). |
| **Existing Customer Import Sheet** | `ExistingCustomerImport.tsx` | **5 MB** | Max **500 customers** | `.xlsx`, `.xls`, `.csv` (One-Sheet Customer Import format). |
| **Chat Attachments** | `ChatWorkspace.tsx` | **5 MB** per file | Up to **5 files** per message | Images (`.png`, `.jpg`, `.jpeg`, `.webp`), `.pdf`, `.txt`, `.csv`, Word, Excel. |
| **Support Ticket Attachments** | `TicketsPage.tsx` | **10 MB** per file | Up to **5 files** per message | Images, `.pdf`, `.txt`, `.csv`, Word, Excel. |

## 1. Symptom: "File exceeds maximum size limit"

### Likely causes

- High-resolution phone camera scans or uncompressed PDFs exceed the **2 MB** standard checklist limit (or **500 KB** for uploaded Invoice PDFs, **700 KB** for Lead Assign sheets).
- For **`2. All Important Documents`**, multiple uncompressed pages were merged without PDF compression.

### Step-by-step resolution

1. Check the exact size ceiling in the table above for the surface being used.
2. **For Onboarding Checklist PDFs (`2 MB` limit)**: Compress the PDF using a standard PDF optimizer at 150–200 DPI so the combined PDF is under **2 MB** while remaining completely legible.
3. **For Uploaded Invoice PDFs (`500 KB` limit)**: Export the invoice directly as a vector PDF rather than scanning a printed page as a bitmap image.
4. Re-upload the compressed file.

## 2. Symptom: "Unsupported file format" or Spreadsheet Import Rejected

### Likely causes

- Uploading an Apple `.heic` photo or `.zip` archive to a document checklist item.
- Uploading a `.xls` or `.csv` file to the **Telecaller Lead Assign** uploader, which strictly requires `.xlsx` (up to **700 KB** and **2,000 rows**).
- Exceeding **500 customers** on the **Existing Customer Import** sheet.

### Step-by-step resolution

1. **For Lead Assign (`.xlsx` only)**: Open the `.xls` or `.csv` file in Microsoft Excel or Google Sheets, choose **File > Save As > Excel Workbook (`.xlsx`)**, ensure it has at most **2,000 rows** and is under **700 KB**, and upload again.
2. **For Existing Customer Import**: Confirm the file is `.xlsx`, `.xls`, or `.csv`, is under **5 MB**, and contains at most **500 customer rows** per batch.
3. **For Checklist Documents**: Convert `.heic` camera photos to `.jpg` or `.png`, or combine multi-page KYC proofs into a single `.pdf` under **2 MB**.

## 3. Symptom: "Failed to upload file" or Expired Pre-Signed URL

### Likely causes

- The browser tab remained idle for an extended period before the file was selected, or a temporary network interruption blocked the Cloudflare R2 upload request.

### Step-by-step resolution

1. Refresh the browser page (`kbd:F5` or `kbd:Ctrl+R`) to ensure your session token is fresh.
2. Re-open the customer checklist, ticket, or chat thread and attach the file again.

## Expected result

:::result
- Files meeting the exact format, row count, and byte ceiling upload cleanly, store an encrypted object key in Cloudflare R2, and immediately transition checklist items to **Review pending** (internal) / **Waiting for our team to check** (Client Portal).
:::

## When to escalate

If a valid file within the size and format limits still fails to upload after refreshing the browser, escalate to a **Super Admin** with:

- The **upload surface** (Checklist item name, Invoice PDF, Lead Assign, Existing Customer Import, Chat, or Ticket).
- The exact **file extension**, **file size in KB/MB**, and (for spreadsheets) **row count**.
- Any error message shown in the red toast banner.
