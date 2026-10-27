---
title: How to Build and Issue a Dynamic GST Invoice
description: Creating dynamic GST invoices or uploading invoice PDFs up to 500 KB, pricing multi-service orders manually, and unlocking onboarding invoice confirmation.
order: 40
group: Invoicing & Tax
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/DYNAMIC_INVOICES.md, shared/contracts.ts, src/components/invoices/InvoiceBuilder.tsx, supabase/migrations/20261113000200_manual_invoice_pricing.sql]
related: [accounts/dynamic-invoices-overview, accounts/confirming-payment-invoice, accounts/recording-payments]
updated: 2026-10-27
---

The **Accounts > Invoices** workspace allows Accounts staff to either build a dynamic GST tax invoice using the native **Invoice Builder** (`Create invoice`) or attach an external PDF invoice (`Upload invoice PDF` up to **500 KB**). Issuing or uploading an invoice automatically unlocks item **5. Invoice Confirmation** on the customer's onboarding checklist.

## Before you start

:::prereq
- Sign in as **Accounts Staff**, **Department Head**, or **Super Admin** and open **Accounts > Invoices**.
- Verify the customer's billing address, state code, and optional GSTIN.
- Know the individual service price breakdown if the customer purchased 2 or more services in the same order.
:::

![Accounts Dynamic GST Invoice Builder showing customer prefill, tax treatment, budget meter, and multi-service line items](shot:accounts-invoice-builder.png)

## Multi-service invoice line-item pricing rule

When opening the **Invoice Builder** for a customer's purchased services (`supabase/migrations/20261113000200_manual_invoice_pricing.sql` and `src/components/invoices/InvoiceBuilder.tsx`), the system follows a strict manual-pricing rule for multi-service deals:

- **Single-Service Orders (1 service)**: The single line item is prefilled with the remaining balance to be invoiced so you can issue the invoice immediately or adjust the amount for a part-payment milestone.
- **Multi-Service Orders (2 or more services)**: All line-item **Base Amount (₹)** fields start **empty (`null`)**. The CRM never divides or guesses how the agreed budget is split across multiple services. Accounts must manually enter the individual price before GST for each service line item before generating the invoice.
- **Budget Meter Enforcement**: A live **Budget agreed by Sales** progress bar sits above the line items, showing the agreed budget (before GST for `EXCLUSIVE` deals, or with GST for `INCLUSIVE` deals), how much has already been invoiced, and how much budget remains. Neither an individual invoice nor the sum of all service invoices can exceed the agreed budget ceiling.

## Steps to create a dynamic invoice

1. In the sidebar, navigate to **Accounts > Invoices** and click **Create invoice** (or open a customer card and select **Create invoice**).
2. Choose the **Invoice purpose**:
   - **Services the customer bought (also an invoice for a part payment)** (`SERVICES`)
   - **An approved add-on request** (`ADDON`)
   - **An additional invoice** (`ADDITIONAL`)
3. Review the prefilled **Customer & Business Information**:
   - **Customer Name**, **Business Name**, **Billing Address**, **Contact Person**, and **Contact Number**.
   - **GSTIN** and **State**: The system automatically selects **CGST + SGST** for Maharashtra (`27`) or **IGST** for interstate supplies. If you change the calculated tax treatment, enter a mandatory **Override reason**.
4. Review the **Budget agreed by Sales** banner:
   - Check whether the agreement is **before GST (`EXCLUSIVE`)** or **already includes GST (`INCLUSIVE`)**.
   - If Sales recorded the wrong tax basis, click the correction link (*The agreed amount is before GST* or *already includes GST*) and provide an audit reason.
5. Configure each row under **Line Items**:
   - **Particulars**: Service name and description (prefilled from the customer's purchased services).
   - **HSN/SAC**: Statutory service code (defaults to `998313`).
   - **Quantity**: Unit descriptor (such as `1 Nos`, `1 Year`, or `1 Setup`).
   - **Base Amount (₹)**: Enter the rate before tax for each service. Remember that when an order contains **2 or more services**, every line starts blank and you must enter each service's price manually.
   - **GST Rate (%)**: Select the applicable tax rate for the line item.
   - Use **+ Add line** or the trash icon to add or remove milestone lines.
6. Check the live **Calculated Totals** preview (Taxable Subtotal, CGST + SGST or IGST, and Grand Total in rupees and words).
7. Click **Save Invoice** (or **Generate & Send Invoice**).

```flow
Select Customer & Purpose | Accounts Staff | Loads prefilled customer details and purchased service lines
Check Multi-Service Lines | Invoice Builder | 1 service -> prefilled balance; 2+ services -> empty base amounts
Enter Service Prices & Tax | Accounts Staff | Types individual service rates within the Budget Meter ceiling
Validate Against Ceiling | Database RPC | Ensures cumulative service invoices do not pass agreed budget
Save / Upload Invoice | System | Stores PDF (<= 500 KB) and unlocks item "5. Invoice Confirmation"
```

## Uploading an external invoice PDF (up to 500 KB)

If an invoice was prepared in an external accounting tool (such as Tally or Zoho Books):

1. Open the customer's invoice panel in **Accounts > Invoices** or **Confirmation**.
2. Click **Upload invoice PDF**.
3. Select the PDF file from your computer:
   - The file must be a valid `.pdf` document and strictly **500 KB (`INVOICE_PDF_MAX_BYTES = 500,000` bytes) or smaller**.
4. Enter the invoice number and invoice amount, then click **Upload**.
5. Uploading the PDF immediately marks onboarding checklist item **5. Invoice Confirmation** as completed.

## What you should see

:::result
The invoice is saved with status `ISSUED`, its PDF is stored securely under the 500 KB limit, and the customer's onboarding checklist item **5. Invoice Confirmation** immediately turns green (`Verified`).
:::

## Good to know

:::important Budget Ceiling Validation
If the sum of your line-item prices pushes the order over the **Budget agreed by Sales**, the budget meter turns red (`over the budget: lower a price`) and the database refuses generation until the line amounts fit within the agreed contract value.
:::

:::tip Multiple Invoices for Part Payments
When a customer pays in tranches, you can issue a separate dynamic invoice for each installment. Verified payments automatically reconcile against open invoices in chronological order.
:::

## If something goes wrong

- **"File exceeds 500 KB limit"**: Compress or optimize the external PDF below 500 KB before uploading, or use the built-in **Create invoice** builder which automatically renders lightweight PDFs under 500 KB.
- For tax state mismatches or override errors, see [Invoice Generation Troubleshooting](/troubleshooting/invoice-generation-troubleshooting).
