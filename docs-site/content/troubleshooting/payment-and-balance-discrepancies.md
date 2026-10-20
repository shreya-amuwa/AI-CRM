---
title: Troubleshooting Payment Confirmations and Balance Discrepancies
summary: Diagnostic guide to reconciling customer ledger balances, understanding pending vs verified payments, and resolving tax basis calculation variances.
audience: internal
roles:
  - Accounts Department
  - Sales Team Member
  - Team Lead
related:
  - /accounts/recording-payments
  - /accounts/managing-part-payments-accounts
  - /super-admin/tax-agreements-review
---

# Troubleshooting Payment Confirmations and Balance Discrepancies

Financial accuracy is paramount. When a customer balance appears inconsistent or a payment has not updated an order balance, use the following verified diagnostic procedures.

---

## 1. Symptom: "The customer paid, but their balance has not decreased"

### Likely Cause: Payment Status is PENDING
In Amuwa AI CRM, recording a payment draft in Sales or entering an unverified gateway reference creates a transaction in status `PENDING`. 

> [!IMPORTANT]
> **The Strict Ledger Rule:**
> Only payments in status **`VERIFIED`** reduce the customer's outstanding balance and count toward corporate income. Draft or pending transactions do not alter ledger balances.

### Resolution Steps
1. Open your **Accounts** dashboard.
2. Open **Confirmation** (the payment confirmation queue).
3. Locate the customer's payment row.
4. Verify the bank transaction reference number against corporate bank statements.
5. Click **Confirm & Verify Payment**.
6. The status transitions to `VERIFIED`, and the customer's outstanding balance recalculates immediately.

---

## 2. Symptom: "An invoice is refused as above the agreed amount" or "the balance is higher than the agreed amount"

### Likely Cause: The agreement is before GST but is recorded as including GST
Each agreement records whether the agreed amount includes GST:

- **Excluding GST:** the agreed amount is before GST and GST is added on top. (For example, ₹1,00,000 plus ₹18,000 GST is a total payable of ₹1,18,000.) The invoices are checked on the amount before GST.
- **Including GST:** the agreed amount is the total payable. The invoices (with GST) are checked against it.

Agreements made before this was recorded stay on **Including GST** until Accounts corrects them. A customer quoted ₹1,20,000 plus GST can therefore see an invoice refused with a message such as "would total ... but only ... was agreed with Sales, including GST".

### Resolution Steps
1. Confirm with Sales whether the quotation included or excluded GST.
2. If it was before GST, open the customer in the **Invoice Builder**, click *The agreed amount is before GST*, write the reason and apply. (Accounts staff and Super Admins can do this.) The total payable and the balances update at once.
3. If it was an all-inclusive price, nothing needs changing: lower the invoice to fit.
4. Do not edit issued invoices. Their PDFs are not changed.

The payment screen shows the agreed amount, the total payable and the order balance. See [Tax Basis of an Agreement](/super-admin/tax-agreements-review).

---

## 3. Symptom: "Cannot return customer to Sales: Payment Verified"

### Likely Cause: Return Blocked by Verified Funds
The CRM database enforces a strict audit constraint: **Accounts cannot return a customer to Sales if any payment is already in status `VERIFIED`**.

### Resolution Steps
1. If the customer backed off or requested a refund:
2. A managerial role (`SUPER_ADMIN` or `DEPARTMENT_HEAD`) must execute an official payment reversal in the payment ledger with a documented justification.
3. Once all payments are reversed (`REVERSED`), the customer card can be safely returned through the standard cancellation workflow.
