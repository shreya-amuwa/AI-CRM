# Business attribution and the Accounts Sales / Support reports

Migration: `supabase/migrations/20261104000100_business_attribution_reports.sql`
Tests: `supabase/tests/business_test.sql` (database) and the "Business reports" block of `supabase/tests/api_integration.test.ts` (API).

## What was already there (audit)

| Requirement | Before this change |
|---|---|
| Department-wise business | Partly. `accounts_finance_by_department()` totals the verified payments of each business unit (Wabastore, Whatsbox, ...), grouped by the customer's department. There was no Sales / Support split. |
| Salesperson-wise reporting | None. |
| Support member-wise reporting | None. |
| Add-on purchases credited to Support | None. Add-on payments (`addon_payments`) were counted in the customer's business unit like any other payment. |
| Renewals credited to Support | None, and **there was no renewal transaction at all**: the system holds renewal *dates* (`customer_services.renews_on`, `customer_plans.renews_on`) but no record that a renewal was billed or paid. |
| Accounts / management visibility of Sales / Support business | None. Accounts' Income and Department Income pages show payments, not who brought them in. |
| Paid / pending / outstanding / refunded | The payment tables already hold the statuses (`VERIFIED`, `PENDING`, `REVERSED`, `REJECTED`) and each invoice has its own balance. No department-level view existed. |

The accounting basis already in use is **cash**: Accounts' income is the sum of verified payments from the three ledgers (`private.verified_income()`). That rule is kept unchanged.

## Attribution rules (applied per transaction)

| Transaction | Source record | Department | Responsible employee |
|---|---|---|---|
| Initial customer sale | `customer_payments`; `invoice_payments` of a *services* invoice | **Sales** | The Sales member who submitted the sale for payment confirmation (`payment_requests.requested_by`, unless Accounts sent it back). A payment Sales recorded itself falls back to whoever recorded it. The customer's *current* owner is never used. |
| Add-on purchase | `addon_payments`; `invoice_payments` of an *add-on* invoice | **Support** (whichever department onboarded the customer) | Who submitted the add-on request, else its creator, else its Technical Consultant. |
| Renewal | `invoice_payments` of an *additional* invoice that Accounts marked **Renewal** | **Support** | The Support member whose invoice request Accounts linked when marking the invoice. |
| Add-on bought outside the add-on workflow | an *additional* invoice marked **Add-on** | **Support** | Same as renewal. |
| Monthly plan activated as paid | `customer_plans` (paid, price > 0) | **Support** (shown as *Subscription*) | Not recorded by the workflow, so shown as "Not recorded". |
| Additional invoice nobody has classified | `invoice_payments` | **Neither** (listed as *needs review*) | n/a |
| Support ticket without a payment | n/a | no revenue | n/a |
| Rejected payment | any ledger | not money, in no figure | n/a |
| Refund / reversal | `REVERSED` payments | taken out of *collected*, shown as *refunded*; the order becomes *outstanding* again | unchanged |

A customer's initial sale, later add-on and later renewal are three separate transactions, each credited by its own type. Nothing is copied: each payment row is read once, so it cannot be counted in both departments.

### The one extension: classifying additional invoices

Accounts can mark an *additional* invoice (Invoice → "What is this additional invoice?") as a renewal or an add-on, optionally naming the service and linking the Support member's open invoice request. Linking the request credits that member and marks the request *Raised*. Once payments are verified only the Super Admin can change the classification (`invoice_business_tags`, written by `accounts_tag_invoice_business`, audited as `INVOICE_BUSINESS_TAGGED`).

## Metric definitions

| Metric | Definition |
|---|---|
| Collected | Verified payments. |
| Pending | Payments recorded but not yet verified by Accounts. Never counted as revenue. |
| Refunded | Payments reversed. |
| Payments | Number of collected payments. |
| Billed | The agreed amount of a sale (`customers.deal_amount` once a sale was submitted), the total of an invoiced add-on request, or the total of an invoice classified as renewal / add-on; for orders dated in the period. |
| Outstanding | `max(billed - collected, 0)` for those orders **as of now**. Pending and reversed money does not reduce it. |

Amounts are as invoiced and received (GST included) and dates are India time. All figures come from `private.business_ledger()` and `private.business_orders()`; `business_report()` (summary and employee tables) and `business_report_transactions()` (history) read the same filtered ledger, so they always agree. Filters: date range (Today / Last 7 / Last 30 / This month / All / Custom), department (business unit), division, employee, transaction type, payment status.

## How Accounts sees it

Accounts dashboard → sidebar → **Business Reports** (every Accounts member and the Accounts head, and the Super Admin, in the Accounts panel). Tabs: **Overview**, **Sales**, **Support**.

- Overview: totals, **income by customer department** (each business unit's collected income split between Sales and Support) and a Sales / Support summary.
- Sales: total, pending, outstanding, refunded, salesperson-wise table, transaction history with the salesperson on each row.
- Support: add-on revenue, renewal revenue, subscription revenue and the combined amount, Support member-wise table, transaction history with customer, service, type, amount, date, status and employee.
- Access is enforced in the database (`private.require_business_reports()` = the Accounts department or the Super Admin), not only in the UI; everyone else, HR included, gets `FORBIDDEN`.

API: `GET /api/v1/accounts/business-report`, `/accounts/business-report/transactions`, `/accounts/business-report/people`; Accounts: `GET|POST /api/v1/accounts/invoices/:id/business`.

## Upgrading a database that ran the first release

The first release of `20261104000100` gave the reports to HR and returned no department table. If your database ran that version, run **`20261105000100_department_business_orders.sql`**: it re-asserts the final access rule (Accounts department and Super Admin) and the final `business_report()` (with the per-department rows), and adds the orders list. It is safe to run again. Symptom of the old version: Accounts sees "Only HR managers and the Super Admin can see the business reports."

## Running the migration manually

Open the Supabase SQL editor and run the file once. It is safe to run again (`create ... if not exists`, `create or replace`). It must run after `20261103000100_order_tax_basis.sql`. It creates one table (`invoice_business_tags`, no direct access for any signed-in user), no money tables, and changes no existing record.

## After deploying: review and backfill

Nothing is guessed, so history needs a short review. In the SQL editor (as the database owner):

```sql
-- 1. Additional invoices with payments that nobody has classified (credited to neither department yet).
--    Open each in Accounts and choose Renewal / Add-on / Other.
select g.invoice_number, g.invoice_date, c.name, g.total_amount
  from public.generated_invoices g
  join public.customers c on c.id = g.customer_id
 where g.purpose = 'ADDITIONAL'
   and not exists (select 1 from public.invoice_business_tags t where t.invoice_id = g.invoice_id)
   and exists (select 1 from public.invoice_payments p where p.invoice_id = g.invoice_id)
 order by g.invoice_date;

-- 2. Sales / Support transactions that do not say who was responsible ("Not recorded" in the report).
select tx_key, tx_type, amount, occurred_at, customer_id
  from private.business_ledger()
 where division is not null and employee_id is null and status = 'COLLECTED'
 order by occurred_at;
```

For (2) the usual causes are payments recorded before the Sales-to-Accounts workflow existed (`source = 'LEGACY'`) and plans. Do **not** fill the gap from the customer's current owner: it does not prove who made the sale. If a verified source exists (an email, a signed order), the sale's submission can be recorded in `payment_requests` by a developer; otherwise leave it as "Not recorded".

## Known limits

- Renewals appear only when the renewal is billed through an additional invoice and Accounts classifies it; until then they are in the review list, not in any department.
- A monthly plan activated by Accounts and also billed on an additional invoice could be counted twice. Mark the invoice "Other" if the plan already covers it.
- Plans have no payment ledger: the activation date and price are taken as collected, and they are not part of Accounts' income figures today.
