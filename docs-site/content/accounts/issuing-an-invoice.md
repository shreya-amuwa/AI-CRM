---
title: How to Build and Issue a Dynamic GST Invoice
description: Step-by-step instructions for prefilling customer details, configuring line items, and issuing an unpaid invoice.
order: 40
roles: [Accounts Staff, Department Head, Super Admin]
audience: internal
status: verified
sources: [docs/DYNAMIC_INVOICES.md, shared/contracts.ts]
related: [accounts/dynamic-invoices-overview, accounts/confirming-payment-invoice]
updated: 2026-10-19
---

The Accounts Invoice Builder automatically compiles customer records, tax treatments, and purchased services into compliant GST invoices.

## Before you start

:::prereq
- You must verify the customer's billing address, state, and optional GSTIN.
- Invoices for agreed services cannot exceed the customer's agreed contract ceiling.
:::

## Steps

1. In the sidebar, navigate to **Accounts > Invoices**.
2. Click **Generate Invoice** (or select a customer awaiting invoice creation).
3. The **Invoice Builder** opens with prefilled data:
   - **Customer & Business Information**: Customer Name, Trade Name, Registered Address, Contact Person, Phone, and Recipient Email.
   - **GSTIN**: If provided, the system validates the format and state code prefix.
   - **State & Tax Treatment**:
     - **Intra-State (Maharashtra)**: Automatically applies 9% CGST + 9% SGST.
     - **Inter-State (Outside Maharashtra)**: Automatically applies 18% IGST.
     - If you override the calculated tax treatment, enter a mandatory reason in the text box.
4. Configure the **Invoice Details**:
   - **Invoice Date** and **Payment Due Date**.
   - **Invoice Number**: Prefilled with the sequential counter (e.g. `AMW-2627-0042`).
   - **Terms & Notes**: Payment terms, bank account details, and UPI ID.
5. Review and edit the **Line Items**:
   - **Particulars**: Service description (e.g. *WhatsApp Business API Setup & Meta Verification*).
   - **HSN/SAC**: The statutory service accounting code (prefilled for software/marketing services).
   - **Quantity**: E.g. `1 Year`, `1 Setup`, or `30,000 Messages`.
   - **Base Amount (₹)**: The rate before tax.
   - Click **+ Add Item** to add additional services or milestone lines.
6. Check the **Calculated Totals**:
   - The system displays Subtotal, CGST/SGST/IGST breakdown, Total Amount, and the generated Amount in Words.
7. Click **Generate & Send Invoice**.

```flow
Prefill Customer Data | Invoice Builder | Name, address, GSTIN, and state code loaded
Determine Tax Treatment | System | Maharashtra -> CGST+SGST; Other -> IGST
Configure Line Items | Accounts Staff | Particulars, HSN/SAC, base rates, quantities
Validate Against Ceiling | Database RPC | Checks deal amount limits
Generate & Send | System | Saves as ISSUED; renders PDF; dispatches email
```

## The agreed amount and the order balance

At the top of the services section the builder shows what Sales agreed for all the services together, whether that amount includes GST, what is already invoiced, the total payable and the order balance. When the agreement is **before GST**, enter each service amount before GST: the invoices together may not exceed the agreed amount before GST, and the GST is added on top. Each part payment can have its own invoice. The balance shown on an invoice is what is left on that invoice; the **order balance** is what the customer still owes in total. If the agreement is recorded wrongly, correct it with *The agreed amount is before GST* (or *already includes GST*) and a reason. See [Tax Basis of an Agreement](/super-admin/tax-agreements-review).

## What you should see

:::result
The invoice appears in the Invoices list with status `ISSUED`. A green checkmark appears on the PDF and Email status chips within seconds. The customer can immediately view the invoice on their portal.
:::

## Good to know

:::important Ceiling Enforcement
If you attempt to issue an invoice whose base amount exceeds the customer's agreed deal amount, the database refuses generation with:
`"Invoiced total cannot exceed agreed contract value."`
:::

:::tip Multiple Invoices for Part Payments
You can issue separate invoices for each milestone payment. The verified payments apply automatically to invoices in chronological order of issuance.
:::

## If something goes wrong

- **"Tax treatment conflict"**: If the customer's state is outside Maharashtra but a local tax treatment is selected, verify the client's state code.
- For other errors, see [Invoice Generation Troubleshooting](/troubleshooting/invoice-generation-troubleshooting).
