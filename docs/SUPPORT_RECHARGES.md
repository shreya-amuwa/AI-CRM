# Recharges: Support, Relationship Manager credit and Accounts verification

Migrations: `supabase/migrations/20270228000200_support_recharges.sql` (the first version) and `20270308000100_recharge_accounts_workflow.sql` (this workflow). Both are safe to run twice; nothing is deleted or rewritten.
Tests: `supabase/tests/support_recharges_test.sql` (database), `support_recharges_validation.test.ts` (rules), `ui_recharges.test.mjs` (screens at desktop and phone width) and a "Support Recharges" block in `api_integration.test.ts`.

## The workflow

Support records a recharge for a **customer** → the CRM reads that customer's **Relationship Manager (RM)** from its own assignment and credits the recharge to them →
the recharge appears in the **Accounts → Recharge verification** queue (a persistent record, not just a notification) → an Accountant checks the money really arrived →
Payment received / Payment not received / Rejected. (Invoice generation and delivery come with the next change.)

* **Panel Recharge** and **Message Recharge** are two tabs over one table (`support_recharges.kind`): separate records, summaries, filters and performance figures.
* **The screenshot is only proof.** Uploading it never marks anything received; only an Accounts user (or the Super Admin) can.

## The Relationship Manager

* The RM is `private.support_member_of(customer)` (the onboarding team member, otherwise the Support owner), read from the database **when the recharge is created** and then **frozen**
  on the recharge (`rm_id`, `rm_team_id`). Nothing in a request names an RM, a department or an owner; the person recording is not the RM unless it is their own customer.
* A trigger refuses any later change of the customer, the RM, the recorder, the kind or the department. A later change of the customer's RM does not move recharges already made; new
  recharges go to the new RM.
* A customer with no Relationship Manager cannot take a recharge (`CONFLICT`, "ask your Team Lead to assign one").
* The customer's name, e-mail, phone, billing address and last known GST number are filled in from the record (Support does not type them); Accounts can correct them.

## Performance (RM tracking)

`recharge_rm_performance(from, to, rm)` (screen: Recharges → **RM performance**) returns, per RM: Panel amount and count, Message amount and count, total amount and count, and the pending amount
and count shown apart. **Only recharges whose payment Accounts confirmed are counted.** The figures are computed from the rows on every read, so verifying twice, editing or re-opening can never
count a recharge twice. Nothing in the incentive, Wallet or payout rules was changed: there is no recharge incentive rule in the CRM, so no incentive is created; attribution and reporting only.
Who sees whose figures: an RM their own, a Team Lead the team's, a Support Department Head the department's, Accounts and the Super Admin all.

## GST and Non-GST

`billing_type` is **GST** (amount before GST + GST amount + the customer's 15-character GST number) or **NON_GST** (the amount only, GST must be 0). The total is always amount + GST (calculated
in the database; a total sent by the browser must match; a table constraint enforces it). The tax rate is **not assumed**: the GST amount is what Support enters, and Accounts can correct it
(with a reason, until an invoice exists). Amounts: above zero, at most 2 decimals, never negative.

## Statuses

* Support status: **Submitted to Accounts** (there is no draft).
* Payment verification (`payment_status`): **Pending verification** → **Payment received**, **Payment not received** or **Rejected** (a note is required for the last two).
  Payment received can be taken back only while no invoice exists. Not received / rejected go back to Support, who correct and submit again (it becomes Pending verification again).
  Repeating a decision changes nothing (no second event, audit row or notification).
* Invoice status (`invoice_status`): Not generated, Generated, Sent, Email sent, WhatsApp sent, Partially sent, Failed. Kept apart from the payment status.

## Who can do what

| | Support Member | Team Lead | Department Head (Support side) | Accounts | Super Admin |
| --- | --- | --- | --- | --- | --- |
| see | their own recharges and those made for their customers | the team's | the department's | all | all |
| create | yes | yes | yes | no | no |
| edit | own, until Accounts have the money (or after it was sent back) | the team's pending ones, and their own | the department's pending ones, and their own | no | no |
| verify the payment | no | no | no | **yes** | **yes** |
| correct billing details | no | no | no | **yes** (reason required) | **yes** |
| open the screenshot | own and credited | team's | department's | all | all |

Sales, HR, other departments' heads, clients and anonymous callers have no access.

## The screenshot

PNG, JPEG, WebP or PDF, up to 5 MB, in the **private** bucket `support-recharge-files` (Cloudflare R2 or Supabase Storage, the same provider switch as every other file). The browser uploads with a
single-use signed upload; the API looks at the stored object (it exists, its size, its first bytes match its type) before the file counts. It opens only through a **2-minute signed link** issued
after the database confirmed the person may read that recharge; every view is audited. A replaced screenshot is kept.

## Notifications and audit

* Notified: Accounts when a recharge is submitted (and again when it is corrected and resubmitted); the recorder and the RM when Accounts confirm, do not receive, or reject.
  Types `RECHARGE_SUBMITTED`, `RECHARGE_PAYMENT_RECEIVED`, `RECHARGE_PAYMENT_NOT_RECEIVED`, `RECHARGE_REJECTED` (category Accounts).
* Timeline (`support_recharge_events`, append-only) and audit log: created, submitted, edited, resubmitted, billing corrected (before and after), payment verified / not received, rejected,
  screenshot viewed.

## Data and functions

`support_recharges`, `support_recharge_files` and `support_recharge_events` have row level security on and **no grants**; only SECURITY DEFINER functions (`search_path` empty) read or write them:
`recharge_list`, `recharge_get`, `recharge_create` (idempotent per request id), `recharge_update`, `recharge_customers`, `recharge_customer_context`, `recharge_verify_payment`,
`recharge_accounts_correct`, `recharge_rm_performance`, `recharge_begin_upload`, `recharge_pending_upload`, `recharge_complete_upload`, `recharge_abort_upload`, `recharge_attachment_download`.
`recharge_set_status` (the old Team Lead / Head status change) now refuses everyone.

API: `GET/POST /support/recharges`, `GET /support/recharges/:id`, `POST /support/recharges/:id/update`, `POST /support/recharges/:id/verify`, `POST /support/recharges/:id/correct`,
`GET /support/recharge-customers` (+ `/:id`), `GET /support/recharge-performance`, `POST /support/recharge-uploads` (+ `/:id/complete`, `/:id/abort`), `GET /support/recharge-files/:id/url`.

## Recharges made before this change

They keep their amounts and screenshot. They have no customer or RM recorded, so they appear in Accounts' queue as Pending verification (or Rejected, if a lead had rejected them) and **cannot be
confirmed** (nobody to credit); Accounts can reject them and Support records them again against the customer.
