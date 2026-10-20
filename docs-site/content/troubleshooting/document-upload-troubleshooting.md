---
title: Troubleshooting Document Uploads and Storage Issues
summary: Diagnostic guide to resolving file size rejections (2 MB limit), unsupported formats, Cloudflare R2 signed URL expirations, and preview failures.
audience: internal
roles:
  - Technical Consultant
  - Sales Team Member
  - Support Team Member
related:
  - /sales/customer-onboarding-sales
  - /technical-consultant/verifying-checklist-items
  - /client/uploading-client-documents
---

# Troubleshooting Document Uploads and Storage Issues

Amuwa AI CRM utilizes Cloudflare R2 object storage to maintain encrypted, compliant storage for customer KYC documents, registrations, and contracts.

When an employee or client encounters file upload errors, use the following verified troubleshooting steps.

---

## 1. Symptom: "File exceeds 2 MB limit"

### Likely Cause: High-Resolution Camera Scan
Modern smartphone cameras frequently generate raw images and multi-page PDFs exceeding 5 MB to 15 MB. The CRM enforces a strict **2 MB ceiling per file** to guarantee fast loading speeds and prevent network bottlenecks.

### Resolution Steps
1. **For PDF Files:** Use a standard PDF compressor (or Adobe Acrobat "Reduce File Size") to compress the document to under 2 MB. Setting resolution to 150–200 DPI retains complete legibility while reducing size by 80%.
2. **For Image Files:** Export as JPEG or PNG with standard 1080p resolution rather than raw 4K.
3. Once the file is under 2 MB, the upload dropzone will accept and process the file immediately.

---

## 2. Symptom: "Unsupported File Format"

### Likely Cause: Unrecognized File Extension
The document vault only accepts verified MIME types:
- Portable Document Format (`.pdf`)
- JPEG Images (`.jpg`, `.jpeg`)
- PNG Images (`.png`)

Files formatted as `.heic` (Apple iPhone default), `.webp`, `.tiff`, `.docx`, or `.zip` will be rejected by the file validator.

### Resolution Steps
1. Convert `.heic` photos to standard `.jpeg` before uploading.
2. If the client sent a Word document (`.docx`), open the file and click **File -> Save As -> PDF**.

---

## 3. Symptom: "Failed to generate upload URL / Network Error"

### Likely Cause: Expired Pre-Signed Token
To ensure zero-trust security, the CRM requests a short-lived pre-signed upload URL from Cloudflare R2. If a browser tab remains open for hours before dropping a file, the authentication token may expire.

### Resolution Steps
1. Refresh the browser page (`F5` or `Ctrl + R`).
2. Re-open the customer onboarding checklist.
3. Drop the file again. A fresh upload token will be generated and the transfer will succeed.

---

## 4. Symptom: "Preview cannot be displayed"

### Likely Cause: Corrupted PDF or Ad-Blocker Restriction
1. Check if a browser extension or ad-blocker is preventing embedded PDF viewer frames (`iframe` or `object`).
2. Alternatively, click the **Download Original File** button to inspect the document directly in your local desktop viewer.
