---
title: Tax & Agreements Review and Reconciling Customer Balances
description: Audit EXCLUSIVE, INCLUSIVE, and NA customer agreements in the Tax & Agreements tab, verify confirmed payments and order balances, and correct agreement tax basis.
order: 4
group: Commercial Configuration
roles: [Super Admin, Accounts Department]
audience: internal
status: verified
sources: [src/components/Workspaces/SuperAdminDashboard.tsx, src/components/accounts/InvoiceBuilder.tsx, server/accountsRoutes.ts]
related: [accounts/dynamic-invoices-overview, accounts/issuing-an-invoice, super-admin/company-business-oversight]
updated: 2026-10-27
---

When Sales moves a lead to **Send to Accounts**, they record the agreed commercial deal amount and its tax basis. Super Admins and Accounts staff use the **Tax & Agreements** tab in `SuperAdminDashboard.tsx` and the **Invoice Builder** to audit every customer agreement across `EXCLUSIVE`, `INCLUSIVE`, and `NA` (non-GST / not applicable) tax modes, reconcile verified payments, and inspect remaining order balances.

## Before you start

:::prereq
- Sign in as a **Super Admin** at `/super-admin/dashboard` and select the **Tax & Agreements** tab in the left sidebar (or sign in as **Accounts** staff and open the customer in the **Invoice Builder**).
:::

## Key figures in the Tax & Agreements ledger

Every customer agreement row in **Tax & Agreements** tracks five core financial figures:

| Figure | Meaning |
| --- | --- |
| **Agreed Amount** | The commercial deal amount recorded when Sales submitted the order to Accounts. |
| **Tax Basis** | `EXCLUSIVE` (GST is added on top of the agreed amount), `INCLUSIVE` (the agreed amount already includes GST), or `NA` (non-taxable / GST not applicable). |
| **Total Payable** | The total amount payable by the customer (including applicable GST). Every payment check, invoice cap, and balance calculation uses this figure. |
| **Verified Payments** | Sum of payments confirmed (`status = 'VERIFIED'`) by Accounts. Pending or rejected payment entries are never counted toward verified collections. |
| **Order Balance** | `Total Payable − Verified Payments`. Tracks the exact remaining receivable on the customer's agreement. |

For example, an agreement of ₹1,20,000 with tax basis `EXCLUSIVE` at 18% GST has a **Total Payable** of ₹1,41,600. Two split invoices of ₹60,000 base + ₹10,800 GST (₹70,800 each) are permitted. After a verified payment of ₹60,000, the **Order Balance** is ₹81,600.

## Agreement tax basis modes (`EXCLUSIVE`, `INCLUSIVE`, `NA`)

```flow
Sales Submits Deal to Accounts | Sales Team Member | Selects EXCLUSIVE, INCLUSIVE, or NA tax basis
Audit in Tax & Agreements Tab | Super Admin / Accounts | Inspects Agreed Amount, Total Payable, Verified Payments & Balance
Issue Compliant Invoices | Accounts Department | Enforces ceiling so invoiced total never exceeds agreement
-> Tax basis needs correction | Super Admin / Accounts | Update basis in Invoice Builder with mandatory audit reason
```

- **`EXCLUSIVE` (GST added on top)**: The pre-tax base amounts across all invoices for the agreed services cannot exceed the **Agreed Amount**. Applicable GST is calculated and added on top to form the **Total Payable**.
- **`INCLUSIVE` (GST included in agreed amount)**: The grand totals (base + GST) across all invoices for the agreed services cannot exceed the **Agreed Amount**.
- **`NA` (No GST / Not Applicable)**: Used for exempt or non-GST agreements where **Total Payable** equals the **Agreed Amount** with `0%` tax applied.

## Steps: Auditing and correcting an agreement's tax basis

1. In the **Super Admin Dashboard**, click **Tax & Agreements** in the left sidebar to review all customer agreements, filter by tax basis (`EXCLUSIVE`, `INCLUSIVE`, `NA`), and compare **Verified Payments** against **Order Balance**.
2. To correct the tax basis on an individual customer agreement, open the customer in **Invoices > Invoice Builder**:
   - Above the service line items, inspect the agreement summary bar showing **Agreed Amount**, current **Tax Basis**, **Already Invoiced**, **Total Payable**, and **Order Balance**.
3. Click the tax basis switch action (**Treat as before GST (`EXCLUSIVE`)** or **Treat as including GST (`INCLUSIVE`)**).
4. Enter a mandatory audit **Reason** (minimum 5 characters) explaining why the basis is being updated (for example, *"Per signed quotation #QT-204, ₹1,20,000 was quoted exclusive of 18% GST"*).
5. Confirm the change. The CRM recalculates **Total Payable** and **Order Balance** immediately and writes an immutable entry to **Security & Audit Logs**.

## Reconciling older agreements

Older agreements created before explicit tax-basis selection was enforced can be reviewed in **Tax & Agreements** (or queried via `GET /accounts/agreement-review`):

1. Check the customer's original quotation or payment confirmation record with Sales and Accounts.
2. If the deal was quoted before GST, switch the agreement to `EXCLUSIVE` with an audit reason so remaining split invoices can add GST cleanly.
3. If the deal was quoted all-inclusive, keep it as `INCLUSIVE`.

:::warning No Bulk Overrides
Every tax-basis correction is validated against existing issued invoices and confirmed payments one customer at a time, requires a written justification reason, and is permanently recorded in the audit log. Already-issued invoice PDFs are never altered retroactively.
:::

## What you should see

:::result
The **Tax & Agreements** table and the **Invoice Builder** header immediately reflect the updated **Total Payable** and **Order Balance**, preventing both under-billing and accidental over-invoicing.
:::

## If something goes wrong

- **Tax basis correction is refused**: The CRM blocks a basis change if already-issued invoices would exceed the new ceiling. See [Invoice Generation Troubleshooting](/troubleshooting/invoice-generation-troubleshooting).
