---
title: Billing, Invoices, and Payments FAQ
summary: Frequently asked questions regarding GST calculations, order tax basis, part payments, invoice generation limits, and ledger reconciliations.
audience: internal
roles:
  - Accounts Department
  - Sales Team Lead
  - Sales Team Member
  - Super Admin
related:
  - /faq/general-crm-faq
  - /accounts/dynamic-invoices-overview
  - /accounts/recording-payments
  - /accounts/managing-part-payments-accounts
---

# Billing, Invoices, and Payments FAQ

Essential guidance for sales and accounting teams regarding payment confirmations, invoice ceilings, Indian Goods & Services Tax (GST) rules, and financial ledger policies.

---

### Q1: What is the difference between Deal Amount, Taxable Amount, and Invoice Total?
- **Deal Amount:** The commercial figure agreed upon with the client during sales negotiations.
- **Taxable Amount:** The net value of services rendered before statutory taxation.
- **GST (Goods & Services Tax):** The statutory 18% tax calculated based on customer location (IGST for another state, or CGST + SGST for a customer in Maharashtra; 18% on most lines, but each invoice line carries its own rate).
- **Invoice Total:** The gross payable amount of one invoice (taxable amount plus GST).
- **Total Payable:** What the customer pays for the whole order, GST included. If the agreement is before GST it is the agreed amount plus its GST (for ₹1,20,000 at 18%: ₹1,41,600). If the agreement includes GST it is the agreed amount.
- **Order Balance:** Total payable minus verified payments. This is different from the balance left on one invoice: with a ₹60,000 payment against two invoices of ₹70,800, the order balance is ₹81,600 while the first invoice has ₹10,800 left.

---

### Q2: Why hasn't a recorded payment reduced the customer's balance?
Recording a payment in Sales creates a transaction in status **`PENDING`**. By design, **only payments in status `VERIFIED` reduce customer ledger balances** and reflect in corporate revenue totals. Once Accounts audits the transaction reference and confirms receipt in the bank, they click **Verify Payment**, updating the balance immediately.

---

### Q3: Can a customer start onboarding with only a part payment?
**Yes.** If a customer pays an initial deposit or milestone tranche, Accounts confirms the received amount. The customer advances to **Customer Onboarding** while the remaining balance is followed up under **Part Payment** in the Accounts menu. Sales and Accounts continue following up on outstanding tranches as onboarding milestones progress.

---

### Q4: Why is Accounts unable to return a customer to Sales?
If any payment on the customer's account has already been verified (`status === 'VERIFIED'`), the database strictly blocks returning the record to Sales. This prevents accounting discrepancies. To return the customer, an authorized manager must first perform an official payment reversal with a documented reason.

---

### Q5: How are add-on service invoices handled?
Add-on services requested during technical onboarding are billed on separate, dedicated **ADDON Invoices**. Add-on invoices carry their own independent price ceilings and do not interfere with or block the primary onboarding contract or core service delivery.
