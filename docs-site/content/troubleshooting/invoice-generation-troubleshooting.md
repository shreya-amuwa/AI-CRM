---
title: Troubleshooting Invoice Generation and PDF Downloads
summary: Diagnostic guide to resolving invoice ceiling errors, SAC code mismatches, GST tax split discrepancies, and browser PDF download failures.
audience: internal
roles:
  - Accounts Department
  - Super Admin
  - Sales Team Lead
related:
  - /accounts/dynamic-invoices-overview
  - /accounts/issuing-an-invoice
  - /accounts/confirming-payment-invoice
---

# Troubleshooting Invoice Generation and PDF Downloads

The Amuwa AI CRM dynamic invoice engine strictly enforces financial rules and Indian GST statutory standards. When encountering issues generating or downloading invoices, use the following guide.

---

## 1. Symptom: "Invoice total exceeds order ceiling"

### Likely Cause: Sum of Invoices Exceeds Total Payable
In Amuwa AI CRM, the total face value of all invoices issued for a customer order cannot exceed the order's gross payable ceiling:

$$\sum \text{Invoice Totals} \le \text{Order Gross Ceiling}$$

If previous invoices already account for the total payable figure, the Invoice Builder blocks the issuance of additional regular invoices.

### Resolution Steps
1. Review the customer's **Existing Invoices** list in the Invoice Builder.
2. Check the **Remaining Uninvoiced Balance** metric displayed at the top of the modal.
3. If the client agreed to an add-on or scope expansion, create the request through **Add-ons Services** (Add-ons Services) rather than issuing a standard invoice. Add-on invoices carry their own independent ceilings.

---

## 2. Symptom: "Invalid or Missing SAC Code"

### Likely Cause: Catalog Offering Lacks Tax Classification
Every billable service line item on an official GST tax invoice must reference a valid 6-digit Service Accounting Code (SAC).

### Resolution Steps
1. In the Invoice Builder, inspect line items where the SAC code field is highlighted red or blank.
2. For digital software, automation, and IT solutions, the standard compliant code is **`998314`** (Information technology services).
3. Contact **Super Admin** to update the permanent SAC code in the Service Catalog management panel so future invoices pre-fill automatically.

---

## 3. Symptom: "Unexpected GST Split (IGST vs CGST/SGST)"

### Likely Cause: State Location Alignment
GST rules govern tax splits based on place of supply:
- **Intra-State (Same State - Maharashtra):** The CRM charges **9% CGST + 9% SGST**.
- **Inter-State (Other States):** The CRM charges **18% IGST**.

### Resolution Steps
1. Verify the customer's state in their business address profile.
2. If the client is registered in Maharashtra, the invoice will automatically split into CGST and SGST. If registered outside Maharashtra, IGST applies.
3. If the customer's state was incorrectly recorded during intake, update the state in the customer profile before finalizing the invoice draft.

---

## 4. Symptom: "Clicking 'Download PDF' does nothing"

### Likely Causes
- Browser popup blocker is blocking the newly opened tab or automated download prompt.
- Corporate browser security policies restrict downloading client-side generated files.

### Resolution Steps
1. Look at the right side of your browser address bar for a **Popup Blocked** icon (in Chrome, Edge, or Firefox).
2. Click the icon and select **Always allow pop-ups and redirects from [CRM URL]**.
3. Re-click the **Download PDF** button.
4. Alternatively, use the **Print Invoice** button to trigger the browser's native print-to-PDF utility.
