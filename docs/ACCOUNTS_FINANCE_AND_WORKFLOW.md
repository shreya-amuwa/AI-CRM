# Accounts finance, department e-mails, panel URL, WhatsApp mappings and the hand-over queue

Migrations `20261209000100` to `20261209000600`. Every migration is safe to run again and changes no existing invoice, payment, expense or audit row.
Nothing is sent by running them. Tests: `supabase/tests/{invoice_series,customer_revenue,finance_notifications,panel_url,department_head_handover}_test.sql`,
`panel_url.test.ts`, `ui_accounts_finance.test.mjs` and the API suite (`api_integration.test.ts`).

## 1. Root causes found

| Problem | Root cause (evidence) | Fix |
|---|---|---|
| Invoice numbers `INV-...` typed by Accounts, no GST / non-GST separation | the number was a free text field; uniqueness was only a unique index on `lower(invoice_number)` | server-assigned numbers from `invoice_number_series` (migration `...0100`) |
| Department Head "Client hand-overs" empty ("No verified customers yet") | The hand-over worked (`send_to_department_head` sets `handover_stage = 'DEPARTMENT_HEAD'`, notifies the head, schedules the consultant's follow-up). But the only policy that lets a Department Head read customers (`customers_select`) requires the customer's OWNING team to be of the head's own division (`sales_scope_team(team_id)`). Customers are owned by Sales teams, so a Support-side head read 0 of 2 handed-over customers (reproduced in SQL before the fix). The page text was also from the old workflow. | policy `customers_select_dh_handover` + corrected text (migration `...0600`) |
| Mini Website Ready WhatsApp missing while the e-mail works | The CRM queues the e-mail and the WhatsApp job together (`private.queue_website_ready`, job key `ONBOARD|<customer>|<channel>|WEBSITE_READY`) and posts `status = "Website Ready"`, `stage_code = "WEBSITE_READY"` with the saved website (tests: `onboarding_status_map.test.ts`, API suite "the Website Ready WhatsApp carries the website address" and "WEBSITE_READY ... status = SENT"). The job shows *accepted by webhook (HTTP 200)*. The external Automation Builder has **no route for `Website Ready`** (documented in `ONBOARDING_AUTOMATIONS.md`). | **manual**: add the route (section 9). Not fixable in this repository |
| Meta Verification "pending" sent as "completed" on WhatsApp | The CRM posts `status = "Meta Verification"` / `stage_code = "META_VERIFICATION"` for Authorize All and `Status Completed` only for the verifier's completion; a pending event can never produce the completed wording (unit + API tests). A completed template can only come from the builder route conditions. | **manual**: make every route condition `equals`, check each template box (section 9) |
| Invoice WhatsApp | The payload carries the persisted number and total of the invoice (unit tests for `GST/26-27/001`, `Amuwa/26-27/001`). It follows the existing switch; with `AUTOMATION_MODE` not `live`, or no `WHATSAPP_WEBHOOK_URL`, nothing is sent and the screen says why. The builder needs a route for `stage_code = INVOICE_PAID` (`INVOICE_WHATSAPP.md`). | **manual**: section 9 |
| A paid add-on / invoice payment could miss its Department Head e-mail | my trigger read `new.source` (a column only `customer_payments` has) and the failure was swallowed by design; found by the API suite warning, fixed with `to_jsonb(new)` and covered by SQL tests for all three payment tables | migration `...0300` |

## 2. Schema

| Migration | Adds |
|---|---|
| `...0100_invoice_series` | `invoice_number_series (series, fy, last_number)`, `private.fy_label`, `private.take_invoice_number`, `private.peek_invoice_number`, `private.invoice_type_of`; `accounts_issue_invoice` / `accounts_invoice_prefill` / `generated_json` now take / show the system number and the type |
| `...0200_customer_revenue_report` | `accounts_customer_revenue(...)` (read only) |
| `...0300_finance_department_mail` | `finance_mail_events` (the outbox), recipients (`private.department_head_recipients`), queue + triggers on `customer_payments`, `addon_payments`, `invoice_payments`, `finance_mail_claim/finish`, `accounts_finance_mail_list/retry` |
| `...0400_expense_allocations` | `expense_allocations`, `department_expenses.request_id`, deferred total checks, `accounts_add_expense_split` / `accounts_update_expense_split`, redefined expense list / summaries |
| `...0500_client_panel_url` | `customer_services.panel_url` (+ check constraint), `service_panel_links`, stage `PANEL_LINK`, `private.clean_panel_url`, `panel_url_set`, `panel_link_send`, `panel_details_list` (+ url and link state), `automation_claim_jobs` (+ `panelUrl`) |
| `...0600_department_head_handover_queue` | policy `customers_select_dh_handover`, `private.handover_head_recipients`, `send_to_department_head` (recipients), `schedule_tc_followup` (notifies the consultant once), `customer_handover_info` (+ route, follow-up), `handover_reconciliation_report`, `handover_reconcile_followups` |

## 3. Invoice numbering

`<prefix>/<FY>/<serial>`: GST `GST/26-27/001`; non-GST `Amuwa/26-27/001`. FY = 1 April to 31 March (`26-27`), serial padded to 3 digits and plain from 1000 (`GST/26-27/1000`), at most 16 characters (CGST Rule 46: consecutive, unique per financial year, letters / digits / `-` / `/`).
Examples (from the tests): the 1st GST invoice of 2026-27 is `GST/26-27/001`, the 2nd `GST/26-27/002`; the 1st non-GST invoice is `Amuwa/26-27/001`; an invoice dated 31 March 2027 belongs to `26-27`, one dated 1 April 2027 starts `GST/27-28/001`; the 1000th is `GST/26-27/1000`.
The type follows the tax on the lines (`total_gst > 0` is GST). The number is taken inside the issuing transaction after the figures are validated, by an `insert ... on conflict do update` that locks the series row: eight parallel API requests get eight different numbers, a failed validation does not burn a number. Existing numbers are never renumbered; the series skips a number already used. A typed number is refused (422). Uploaded external PDFs keep the number typed (they are outside the two series).
Open question for the tax adviser: whether a GST-registered supplier may issue "non-GST" invoices (CGST Rule 49 covers bills of supply for exempt supplies).

## 4. Customer-wise revenue

`Accounts > Customer Revenue` (Accounts staff and the Super Admin; the database function checks it). Per customer: **purchased** (orders), **invoiced** (non-cancelled invoices, with GST), **collected** (verified money, counted once on its order via `private.business_ledger()`), **pending**, **refunded**, **outstanding** (per order, purchased minus collected, never below zero) and **receipts without an order** (shown apart, never added to an order). Filters: search, date range, service, department; sort: purchased, invoiced, collected, pending, outstanding, orders, name; paginated (1-100). Purchased and invoiced are never income.

## 5. Expenses and Department Head e-mails

One expense row plus allocation rows (`expense_allocations`), checked in paise by the form, the API and deferred constraint triggers. No rows = company-wide. A department can appear once. The department reports use the allocation; the company total counts the expense once. A request id makes a repeated click return the same expense.
E-mails (`finance_mail_events`, one row per recipient): payment recorded (pending), payment verified, expense allocated. Recipients are resolved at queue time from active Department Heads (Sales / Support side honoured, plus heads authorised through `department_access`), with a valid address. Payload: customer, reference, services, department, amount, status - never a payment reference, phone or customer e-mail; an expense carries only that department's part. Duplicate events are impossible (`dedupe_key`). Failures retry after 1, 5, 15, 60 minutes; no active head = a `NO_RECIPIENT` row, a notification to the Super Admins and *Retry* once a head exists. The payment is never undone by a mail failure.

## 6. Client Panel URL

Per customer and service (`customer_services.panel_url`). HTTPS only, public host (no IP, localhost, internal names), no user:password, no spaces, 500 characters, nothing that looks like a password / key / token. The page (`shared/panelUrl.ts`), the API (zod) and the database (`private.clean_panel_url` + check constraint) apply the same rules. Roles: the Meta Verifier of the customer's route, the Department Head of the department, the Super Admin. Every change is audited (service + host, never the full link). Saving sends nothing.
**Re-notification rule:** the link is e-mailed only on request, through the existing automation job queue (stage `PANEL_LINK`, e-mail only); the same link to the same customer and service is sent once (job key includes a hash of the URL); a changed URL is a new link and is sendable again (the page says "URL changed since it was sent"); "Send again" re-sends on purpose, once per click; a failed or skipped e-mail can be retried. The *Status Completed* e-mail and WhatsApp (`panel_url` field) use the customer's own URL, else the department's.

## 7. The hand-over

Sales -> Accounts -> Meta Verifier (route `META`) or Technical Consultant (other route) -> **Send to Department Head** -> Support Team Lead -> Team Member. At the send: `handover_stage = 'DEPARTMENT_HEAD'`, the heads of the customer's own department (Support side first, any active head as the fallback) are notified, the Sales owner is told, and - in the same transaction - one consultation follow-up is created for the Technical Consultant (`tc_followups`, unique open follow-up per customer, assigned to the consultant with the fewest open ones, due after the Super Admin's delay, or waiting if no delay is set; the consultant is notified once). The "Meta verification first" rule of the client onboarding journey (migration `20261209000100`) is kept: a Meta-route customer cannot be sent before Meta verification is complete. The department comes from the customer record, never from the request; `can_review_onboarding` limits who can send. The follow-up never gates the head's queue.
**Existing records:** nothing is changed by the migration; the new policy makes every already-handed-over customer visible. `handover_reconciliation_report()` lists (a) META customers whose documents are authorized and whose Meta verification is complete but nobody has sent yet (they wait in the verifier's queue - the verifier, Department Head or Super Admin sends them), and (b) handed-over META customers without any follow-up. `handover_reconcile_followups()` (Super Admin, audited, idempotent) creates only the missing follow-ups.

## 8. Tests run (this branch)

SQL suite (59 files), API suite (2,614 checks), unit suite incl. browser tests, `tsc` for both configs, `npm run build`, `node docs-site/build.mjs --check`. The project has no linter. All external integrations are mocked (local SMTP / Resend / WhatsApp stand-ins); nothing real was sent.

## 9. Manual configuration still required (outside this repository)

1. **WhatsApp Automation Builder:** add the route `status = "Website Ready"` (or `stage_code = WEBSITE_READY`) with the mini-website template; make the `Meta Verification` route use the in-progress template and the `Status Completed` route the completed one - every condition `equals`, never `contains`; add the route `stage_code = INVOICE_PAID` with the invoice template and the document from `invoice_pdf_url`. Optionally use `panel_url` in the completed template. Test with your own number and a new `event_key` each time.
2. **Server environment:** `AUTOMATION_MODE=live`, `WHATSAPP_WEBHOOK_URL`, the e-mail provider settings, `AUTOMATION_SECRET_KEY`; the invoice WhatsApp switch is *Settings -> Allow sending paid invoices by WhatsApp* on the paid-invoice panel (Super Admin or Accounts Department Head; it starts switched on, see `INVOICE_WHATSAPP.md`).
3. **Super Admin:** set the Technical Consultant follow-up delay (Workflow settings) so waiting follow-ups get their date.
4. **After the migrations:** open the hand-over reconciliation report and decide: send the "verified, not sent" customers from the verifier's queue; run the follow-up action if "handed over without follow-up" is not empty.
5. Ask the tax adviser about non-GST invoices for a registered supplier.

## Invoice numbers: GST and Non-GST series, and continuing from the real last number (migration 20270313000100)

Every invoice the CRM generates (Accounts invoices, part payments, recharge invoices) gets its number from the database, never from the browser:

| Type | Format | Example |
| --- | --- | --- |
| GST | `GST/YY-YY/NNN` | `GST/26-27/616` |
| Non-GST | `Amuwa/YY-YY/NNN` | `Amuwa/26-27/251` |

* Each type has its own counter per financial year (`invoice_number_series`), so GST and Non-GST numbers move independently.
* The year is the Indian financial year (1 April to 31 March) of the **invoice date**: 31 March 2027 is `26-27`, 1 April 2027 is `27-28`, and the new series starts again at `001`.
* `private.take_invoice_number` is the only way a number is made. It runs inside the transaction that saves the invoice, under a lock on the counter row, so simultaneous
  requests never share a number and an invoice that is not saved leaves no gap. A draft or a preview (`peek_invoice_number`) takes nothing: the number is final when the
  invoice is officially generated. A counter never goes down and a deleted or cancelled invoice never gives its number back.
* Older invoices (`INV-2026-00022` and uploaded numbers) are untouched; a new series continues after the highest number of its shape that already exists.

**Continuing from the real last number.** A series that starts in the CRM starts at `001`. If your real numbers are already higher (for example GST 615 and Non-GST 250 in 26-27),
the Super Admin sets the next number once per series and year. It can only raise the next number: a number at or below the highest already used is refused.

```bash
# API (Super Admin only; Accounts and everyone else get 403)
POST /api/v1/accounts/invoice-series   { "type": "GST", "fy": "26-27", "next": 616 }
POST /api/v1/accounts/invoice-series   { "type": "NON_GST", "fy": "26-27", "next": 251 }
GET  /api/v1/accounts/invoice-series   # the counters and the next number of each (nothing is taken)
```

```sql
-- or, as the owner in the Supabase SQL editor
select private.invoice_series_set_next('GST', '26-27', 616);
select private.invoice_series_set_next('NON_GST', '26-27', 251);
```

Every change is written to the audit log (`INVOICE_SERIES_SET_NEXT`, with the number before and after). Tests: `supabase/tests/invoice_numbering_requirements_test.sql` (52 checks),
`invoice_series_test.sql` and `part_payment_invoice_number_test.sql` (existing), `invoice_series_validation.test.ts` (and `recharge_invoice_service.test.ts`, now also run by `npm run test:unit`), and the "Invoice numbering" block of `api_integration.test.ts`
(25 connections taking numbers at the same moment, a rolled-back invoice, busy GST and Non-GST series).
