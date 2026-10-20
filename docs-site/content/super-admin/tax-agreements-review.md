---
title: Tax Basis of an Agreement and Reconciling Older Agreements
summary: How the agreed amount, GST, total payable and order balance fit together, how Accounts corrects whether an agreement includes GST, and how older agreements are reconciled.
audience: internal
roles:
  - Super Admin
  - Accounts Department
related:
  - /accounts/dynamic-invoices-overview
  - /accounts/issuing-an-invoice
  - /super-admin/company-business-oversight
---

# Tax Basis of an Agreement and Reconciling Older Agreements

Sales agrees one amount with the customer for all the services. That amount either **includes GST** or is **before GST** (GST is added on top). The CRM records which, so the invoice checks, the payments and the balances all use the same figures.

| Figure | Meaning |
| --- | --- |
| **Agreed amount** | What Sales agreed, as agreed. |
| **Tax basis** | `INCLUSIVE` (the agreed amount already has GST in it) or `EXCLUSIVE` (GST is added on top). |
| **Total payable** | What the customer pays in total, GST included. This is the figure every payment, balance and status uses. |
| **Total confirmed payments** | Verified payments only. Pending and rejected payments are never counted. |
| **Order balance** | Total payable minus total confirmed payments. |

For example, an agreement of ₹1,20,000 before GST at 18% has a total payable of ₹1,41,600. Two invoices of ₹60,000 plus ₹10,800 GST (₹70,800 each) are both allowed. After a confirmed payment of ₹60,000 the order balance is ₹81,600. The first invoice has ₹10,800 left on it and the second ₹70,800; these invoice figures are kept apart from the order balance.

## How the tax basis is set

- In **Send to Accounts**, Sales answers *Does this amount include GST?*. The dialog starts on **No, GST is added on top (amount excluding GST)**. Sales can change it to *Yes, GST is already included*.
- Agreements made before this question existed have no recorded basis. They are **not** changed automatically: they stay `INCLUSIVE`, exactly as they always behaved.

## What each basis means for invoices

- **Excluding GST:** the invoices of the agreed services together may not be more than the agreed amount **before GST**. The GST is added on top. The total payable is the GST of the invoices already issued, plus the agreed amount not yet invoiced with GST added (at the rate of the invoices already issued, or 18% before the first one). Until every part is invoiced, the GST on the part not yet invoiced is an estimate.
- **Including GST:** the invoice totals (with GST) together may not be more than the agreed amount.

In both cases real overbilling is still refused.

## Correcting the basis of one agreement

Accounts staff and Super Admins can correct an agreement from the **Invoice Builder**:

1. In **Invoices**, start a new invoice for the customer. Above the service lines the builder shows what was agreed, whether it includes GST, what is already invoiced, the total payable and the order balance.
2. Click **The agreed amount is before GST** (or **The agreed amount already includes GST** if it is currently before GST).
3. Write the reason (at least 5 characters). It is recorded in the audit log.
4. Click **Treat it as before GST** (or **Treat it as including GST**).
5. The total payable and the balances update at once, and the amounts filled in on the lines are worked out again.

The correction is refused when it would not be consistent with what already exists. For example, you cannot treat an agreement as before GST if the invoices already issued total more than the agreed amount before GST, and you cannot treat it as including GST if the amount is below what was already invoiced or received. Issued invoice PDFs are never changed or regenerated.

## Reconciling older agreements

The CRM can list the older agreements (no recorded basis) that already have invoices, so Accounts can decide each one. The list shows, for each customer, the total payable on record, the invoiced amount before GST and with GST, the number of invoices, the confirmed payments and a note. This list is currently available through the CRM's API (`GET /accounts/agreement-review`); there is no separate screen for it yet. Ask your administrator to run it.

For each customer on the list:

1. Check the original quotation or agreement with Sales.
2. If the amount was quoted before GST, open the customer in the Invoice Builder and correct the basis as above.
3. If it was an all-inclusive price, leave it as it is.

> [!WARNING]
> **No bulk changes.** Every correction is made one customer at a time, with a reason, and stays in the audit history.
