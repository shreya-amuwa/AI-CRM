# Department-wise income attribution

Migration `20261114000100_revenue_attribution.sql` (safe to run again). Tests: `supabase/tests/attribution_test.sql`, the "department income" checks in `api_integration.test.ts`.

## What the audit found (before this change)
| Finding | Effect |
|---|---|
| A customer's department mirrors the CURRENT owner (`tg_customers_before_write`) and every income figure grouped payments by it. | Reassigning a customer moved all of its past income to another department. |
| The first sale was always Sales' (`customer_payments` hard-coded to Sales). Nothing recorded who acquired a customer. | A customer Support acquired (for example a referral) was credited to Sales. |
| Add-ons and monthly plans were always Support's, including those the client bought in the Client Dashboard. | The rule was implicit and could not be changed. |
| Three calculations of department income: Accounts' Department Income, the Super Admin dashboard (verified payments by the customer's current department) and the Sales / Support business reports (by division). | Figures could disagree, and the first two ignored the Sales / Support split. |
| Business reports are for Accounts and the Super Admin only. | A Department Head had no income view of their own department. |

What already worked and is unchanged: the cash basis (collected = verified payments only), the single ledger of every payment (`private.business_ledger()`), one ledger per invoice (`generated_invoices.payment_ledger`, so a payment can be counted in only one place), pending / rejected / reversed handling, the invoice and payment-confirmation workflows.

## The model
* `customers.acquisition_division / acquisition_department_id / acquired_by`: who acquired the customer, written when the customer is created from the owner's team and never changed by a change of owner (a plain update cannot change it). `NULL` = not recorded (customers from before this change).
* `revenue_attributions`: one row per order (the keys the ledger already uses: `SALE:<customer>`, `ADDON:<request>`, `INV:<invoice>`, `PLAN:<plan>`) with the division that earns it, the department it belongs to, the **source** (why), the referral source and a review flag. Written the first time money or an invoice appears for the order; never changed except by an audited correction.
* `revenue_attribution_settings`: the rule for Client Dashboard purchases.
* The department / division of every payment, in every report, now comes from that row. Accounts' Department Income, the Super Admin dashboard and the business reports read the same attribution (`private.verified_income_attributed()` / `private.business_ledger()`), so they agree.

| Case | Division | Source |
|---|---|---|
| Sales acquired the customer, first sale | Sales | `ACQUISITION` |
| Support acquired the customer (referral or other channel), first sale | Support | `ACQUISITION` (+ referral source stored) |
| Customer whose acquisition was not recorded, first sale | Sales (the rule before) | `DEFAULT_SALES` |
| Add-on sold to an existing customer through Support | Support | `SUPPORT_ADDON` (the original sale stays as it was) |
| Add-on or plan the client requested in the Client Dashboard | by the rule below | `CLIENT_DASHBOARD` |
| Additional invoice Accounts tags as renewal / add-on | Support | `SUPPORT_INVOICE` |
| An order from before this change | exactly as the old reports counted it | `LEGACY` |
| Corrected by Accounts / Super Admin | as chosen, with a reason | `MANUAL` |

An add-on order that contains at least one service the client asked for in the Client Dashboard is a Client Dashboard purchase (the consultant adding the requested service links them).

## Client Dashboard purchases: the rule (needs your approval)
The CRM had no explicit rule: add-ons and plans simply went to Support. The customer's owner is not a reliable answer (the owner is the Sales member who sold it; the account is looked after by Support). The proposed default, **now an explicit setting**, is:

* `SUPPORT` (default): the team that looks after the account. This matches what the system did, and every order records the rule that applied.
* `ACQUISITION`: the division that acquired the customer.
* `SALES`.

The Super Admin changes it (Department Income page). It applies to **new** orders only; existing orders keep what was recorded. Nothing assigns all Client Dashboard purchases to one division silently any more: they are reported on their own line.

## Separate concepts
Acquisition division / department, referral source (the lead source), revenue-attributed division and department (the order's row), and the responsible employee (derived from the order's own records, as before) are separate. The department that DELIVERS a service stays `crm_services.delivery_department_id` / `customer_services.delivery_department_id`.

## Collected, invoiced, GST, receivable (per order and in every total)
* **Collected**: verified payments only, gross receipts (GST included), each payment counted once. A generated invoice is never money received.
* **Pending**: recorded, not yet verified. **Refunded**: reversed. Rejected payments appear nowhere.
* **Billed**: the order value (agreed amount with GST / add-on total / invoice total). **Outstanding**: billed minus collected per order, never below zero; it is a receivable, shown apart from collected.
* **Taxable and GST**: shown wherever the order's tax split is known (`private.order_taxable_ratio`): an agreement that excludes GST (agreed / total payable), an invoice (subtotal / total), an add-on. Where it is not recorded (an agreement that includes GST with no invoice yet, a monthly plan) the amount is listed as "tax split not known" instead of being guessed. A part payment is split pro rata.

## Historical records
Orders that existed are frozen as `LEGACY` exactly as the old reports counted them (nothing is moved). A first sale of a customer that a Support member owns or created today is flagged **needs review** (it was counted as Sales and might belong to Support). Accounts / Super Admin decide each one on the Department Income page (`set_order_attribution`, with a reason, audited with before and after) and can record who acquired an older customer (`set_customer_acquisition`; this affects new orders only). Monthly plans carry no tax or employee data in the workflow.

## Who sees what
Super Admin and Accounts: every department and the reconciliation. A Department Head: only their own department (`department_income_report` refuses any other). Team Leads, members and clients: refused. Changes to attribution: Super Admin and Accounts; the rule: Super Admin. Every change is in the audit log (`ORDER_ATTRIBUTION_CHANGED`, `CUSTOMER_ACQUISITION_CHANGED`, `REVENUE_ATTRIBUTION_RULE_CHANGED`).

## Known limits
* The monthly-plan "payment" is Accounts confirming a plan as paid, not a payment record: it appears in the business reports (type Subscription) but not in the payment-based Accounts income, as before.
* Add-on payments have no reversal state in the existing workflow, so a reversed add-on payment cannot occur.
* The orders list shows the 200 most recent orders; totals cover all.


## Departments with a Support side (Wabatalk)
A department can be the Support side of another (`departments.facet_of`): Wabatalk is D Talk's. An order is recorded in the department of the division that earns it (`private.revenue_department`): Support's orders in Wabatalk, Sales' in D Talk. See [DEPARTMENT_SCOPES.md](DEPARTMENT_SCOPES.md#0-wabatalk-d-talks-support-department).
