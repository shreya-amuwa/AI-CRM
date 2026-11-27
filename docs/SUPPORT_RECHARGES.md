# Support Recharges (Panel and Message)

Migration: `supabase/migrations/20270228000200_support_recharges.sql` (safe to run twice; nothing is deleted or rewritten; independent of the Wallet PIN migration).
Tests: `supabase/tests/support_recharges_test.sql` (database), `support_recharges_validation.test.ts` (rules), `ui_recharges.test.mjs` (screens at desktop and phone width),
and a "Support Recharges" block in `api_integration.test.ts`.

## What it is

A **Recharges** page in the Support Team Member, Support Team Lead and Support Department Head dashboards. Two tabs, **Panel Recharge** and **Message Recharge**, are the same
screen over one table (`support_recharges.kind`), but each tab has its own records, summary cards and filters; nothing is shared between them.

Fields: customer name, payment screenshot, GST amount and details, non-GST amount and details, total (always GST + non-GST, calculated, never trusted from the browser),
recharge date, status (Pending, Verified, Completed, Rejected) and remarks. Each record gets a reference (`PRC-00001` for Panel, `MRC-00001` for Message).

Screen: summary cards (Total recharges, Total amount, Total GST, Total non-GST, Pending, Completed), customer search, status / date / amount filters, pages of 10, 20 or 50,
loading, empty, error and success states, a table on desktop that becomes cards on a phone, the screenshot preview, create and edit forms.
The cards cover the same authorised records and filters as the table except the status filter, so they keep showing every status.

## Who can do what (decided in the database from the signed-in person)

| | Support Team Member | Support Team Lead | Support Department Head | Super Admin |
| --- | --- | --- | --- | --- |
| see | their own recharges | their team's | the department's | all |
| create | yes | yes | yes | no (reviews only) |
| edit | own, while Pending or Rejected (editing a Rejected one sends it back to Pending) | own (same rule) and the team's until Completed | own (same rule) and the department's until Completed | always |
| change the status | no | the team's, never their own | the department's, never their own | any, any time |
| open the screenshot | own | team's | department's | all |

Status moves for a Lead / Head: Pending → Verified, Completed or Rejected; Verified → Completed, Rejected or Pending; Rejected → Pending; Completed is final.
Rejecting needs a reason. Sales, HR, Accounts, other departments, clients and anonymous callers have no access at all.

## The screenshot

PNG, JPEG, WebP or PDF, up to 5 MB, in the **private** bucket `support-recharge-files` (Cloudflare R2 or Supabase Storage, the same provider switch as every other file).
The browser uploads straight to storage with a single-use signed upload; the API then looks at the stored object (it exists, its size, its first bytes match its type)
before the file counts. The browser checks the type, the size and the first bytes too. A screenshot opens only through a **2-minute signed link** that the API issues after the
database confirmed the person may read that recharge; there is no permanent public address, and every view is written to the audit log. A replaced screenshot is kept
(nothing is deleted), the newest one is shown.

## Data and functions

`support_recharges` and `support_recharge_files` have row level security on and **no grants**; only the SECURITY DEFINER functions (`search_path` empty) read or write them:
`recharge_list`, `recharge_get`, `recharge_create` (idempotent per request id: a double click saves once), `recharge_update`, `recharge_set_status`,
`recharge_begin_upload`, `recharge_pending_upload`, `recharge_complete_upload`, `recharge_abort_upload`, `recharge_attachment_download`.
Checks inside the database as well as in Zod: kind, date (not in the future), amounts (0 or more, 2 decimals, total above zero, total = GST + non-GST, table check constraint),
file type and size, ownership of the uploaded file (only your own, ready, not yet attached).

API: `GET/POST /support/recharges`, `GET /support/recharges/:id`, `POST /support/recharges/:id/update`, `POST /support/recharges/:id/status`,
`POST /support/recharge-uploads` (+ `/:id/complete`, `/:id/abort`), `GET /support/recharge-files/:id/url`.

## Notes

* The Support Department Head is a Department Head whose department has Support teams and who works its Support side (or the whole department); a head of another department sees none of these records.
* Notifications are not sent for recharges (not requested); creation, status changes and screenshot views are in the audit log.
