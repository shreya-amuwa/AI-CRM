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
1. Open the **Accounts Department Panel** (`/accounts`).
2. Navigate to **Payment Confirmation Queue** (`/accounts/payments/verify`).
3. Locate the customer's payment row.
4. Verify the bank transaction reference number against corporate bank statements.
5. Click **Confirm & Verify Payment**.
6. The status transitions to `VERIFIED`, and the customer's outstanding balance recalculates immediately.

---

## 2. Symptom: "Invoice total is 18% higher than the agreed deal amount"

### Likely Cause: Order Tax Basis is EXCLUSIVE
Deals in the CRM track an explicit tax basis:

- **EXCLUSIVE (Standard Default):** The recorded deal amount is considered the net taxable service cost. Standard 18% GST is added on top. (e.g., ₹1,00,000 deal + ₹18,000 GST = ₹1,18,000 total invoice ceiling).
- **INCLUSIVE:** The deal amount represents the gross payable figure including GST. (e.g., ₹1,00,000 total = ₹84,745.76 taxable + ₹15,254.24 GST).

### Resolution Steps
1. Check the customer's sales agreement notes to confirm whether the quotation explicitly included or excluded GST.
2. If the deal was intended to be all-inclusive, an Accounts staff member or Super Admin can adjust the basis:
   - In the Invoice Builder, click *"The agreed amount is before GST"*.
   - Adjust the agreement basis to INCLUSIVE with a documented justification reason.
3. The invoice ceiling recalculates to match the gross figure.

---

## 3. Symptom: "Cannot return customer to Sales: Payment Verified"

### Likely Cause: Return Blocked by Verified Funds
The CRM database enforces a strict audit constraint: **Accounts cannot return a customer to Sales if any payment is already in status `VERIFIED`**.

### Resolution Steps
1. If the customer backed off or requested a refund:
2. A managerial role (`SUPER_ADMIN` or `DEPARTMENT_HEAD`) must execute an official payment reversal in the payment ledger with a documented justification.
3. Once all payments are reversed (`REVERSED`), the customer card can be safely returned through the standard cancellation workflow.
