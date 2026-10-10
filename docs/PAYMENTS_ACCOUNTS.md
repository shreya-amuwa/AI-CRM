# Conversations, Sales → Accounts payments, Part Payments

Migrations: `20261011000100_lead_conversations.sql`, `20261011000200_payments_accounts_workflow.sql`
(additive and safe to re-run). Tests: `supabase/tests/payments_test.sql`, the "conversations, Sales → Accounts"
block in `supabase/tests/api_integration.test.ts`.

## Lead conversations
* `lead_conversations`: one row per conversation. The newest is the **Last conversation**; nothing is overwritten
  when a new one is added, and an edit changes only that row. The note typed when a lead is created becomes the
  first conversation (`source = LEAD_NOTE`, one per customer, so re-runs never duplicate it).
* Why the note used to disappear: `create_lead` stored it in `customers.notes`, but the lead details page never read
  that column. `customers.notes` is untouched; existing notes were back-filled as the first conversation.
* Edit: the author, or a team head / department head / super admin who may work on the customer.

## Workflow
```
Sales: Leads ── Send to Accounts ──► customers.payment_workflow = PENDING_PAYMENT_CONFIRMATION (lead is locked)
Accounts: records the payment (part / full), verifies it
   ├─ Confirm Payment & Return to Sales ─► lifecycle_stage = ONBOARDING (same customer), PAYMENT_CONFIRMED
   └─ Customer Backed Off ───────────────► back to Leads, RETURNED_FROM_ACCOUNTS (reason kept)
```
Every transition is a database function that re-checks the caller's role and the current state, writes the
activity log + audit log and notifies the other side in one transaction. A second submission is refused (partial
unique index on open requests). Each submission is a row in `payment_requests` (history is kept).

## Money
* `customer_payments` is the only source of money: `PENDING → VERIFIED | REJECTED`, `VERIFIED → REVERSED`.
  Only Accounts can verify, reject, edit or (managers only) reverse. A transaction reference is unique per customer.
* `customers.amount_received` = pending + verified (what Sales has always seen); `customers.amount_verified` =
  verified only. `customers.payment_status` is generated: `NO_PAYMENT`, `PENDING_VERIFICATION`, `PARTIALLY_PAID`,
  `FULLY_PAID`. Outstanding balance = agreed amount − verified payments.
* Payments Sales records on the old Potential / Onboarding screens are written to the ledger as **pending** and are
  verified by Accounts (the existing "confirm the amount" also verifies them).

## Get Started
`customer_onboarding.get_started` is a generated column: all required checklist items **verified** AND a verified
part/full payment AND the customer came through Accounts AND not sent back by the consultant. It is recalculated by
the database whenever a document review, a payment or the hand-over changes, and the Onboarding "Get started" tab,
its count and the customer page all read it.

## Part Payments
`part_payments_list()`: customers with a verified part payment. Sales sees the customers it may work on (read-only,
no accountant notes); Accounts sees the same customers as balance follow-ups with the responsible accountant
(`customers.accounts_owner_id`), dated follow-up notes (`payment_followups`, never mixed into Sales conversations)
and follow-up status (follow-up required / contacted / awaiting payment / fully paid). A customer leaves the active
list when the balance reaches zero; the payments and notes stay under **Fully paid**.

## Account Dashboard: finance pages

The Account Dashboard (`/accounts/dashboard/:id`, Accounts staff) is separate from the Superadmin
**Account Department** panel (`/admin/dashboard/accounts`). The two share only the visual style of
the summary cards; no component, route, permission or data is shared.

Sidebar: Account Overview, Income, Confirmation, Part Payment, Department Income, Expenses,
Notification Center. Invoice and Quotation are not part of this dashboard.

- **Account Overview**: the three company-wide cards (Total Gross Income, Total Expenses, Total Net
  Earnings) and, below them, the company-wide trends that used to be on the separate Overall
  Analytics page: income this month vs last month, income vs expenses for the last 12 months and
  monthly net earnings. No department breakdown and no expenses-by-category ("where the money goes")
  section. With no records it shows zero values and an empty state.
- **Department Income**: one box per revenue department (generated from `departments`), with that
  department's earnings on the left and expenses on the right (`accounts_finance_by_department`).
  No margins, invoices or quotations. Company-wide expenses (no department) are counted only in
  Account Overview.
- Income and Department Income list only departments with `departments.generates_revenue`
  (Accounts, Education & Training and HR are set to false by
  `20261013000100_accounts_revenue_departments.sql`; the flag is data, so it can be changed later).

**Return to Leads** (`accounts_return_to_leads`) is refused once any payment of the customer is
VERIFIED. It is decided from the persisted payment rows; reversing the verified payment (team lead or
head) makes a return possible again. The button is disabled in the UI for the same reason.

### Where the figures come from

| Figure | Source |
| --- | --- |
| Income | `customer_payments` rows with status `VERIFIED` (the ledger), attributed to a department through `customers.department_id` |
| Expenses | `department_expenses` (new table), `department_id` is null for company-wide expenses |
| Net | income minus all recorded expenses (paid and pending; the pending part is shown next to the figure) |

The Superadmin panel's own numbers come from a browser-side demo store and are deliberately not used.

All reads and writes go through SECURITY DEFINER functions that require active Accounts staff
(or the Super Admin): `accounts_finance_summary`, `accounts_income_list`, `accounts_expenses_list`,
`accounts_add_expense`, `accounts_update_expense`, `accounts_delete_expense`,
`accounts_import_expenses`, `accounts_finance_trend`, `accounts_finance_by_department`. The table itself has no direct grants.
A staff member edits or deletes only the expenses they added; an Accounts team lead or head
can change any. Add, edit and delete are written to the audit log.

API: `GET /accounts/finance/{summary,departments,income,expenses,trend}`, `POST /accounts/finance/expenses`,
`PATCH` and `DELETE /accounts/finance/expenses/:id`, `POST /accounts/finance/expenses/import`.

### Google Sheets (not connected)

No sheet, credential or endpoint is configured. Expenses live in the database. Each expense has a
`source` (`MANUAL`, `GOOGLE_SHEET`, `IMPORT`) and an optional `external_id`; the manager-only
`accounts_import_expenses(rows, source)` upserts by `(source, external_id)` in one transaction, so a
future sheet sync can load rows repeatedly without duplicates. The sync itself still has to be built
once the sheet is shared.

Apply `supabase/migrations/20261012000100_accounts_finance.sql` (safe to re-run).
