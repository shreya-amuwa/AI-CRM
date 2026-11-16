# BolifyAI: AI calls from the CRM

The Google Sheet script (`sendDataToMyAppz`) read rows and posted `{ name, phone, email, service, location }` to a BolifyAI webhook. The CRM now posts the **same five fields to the same kind of webhook** straight from the database's own records, so no sheet sits in between and nobody copies rows by hand.

## Set it up (server environment only)

| Variable | |
|---|---|
| `BOLIFY_WEBHOOK_URL` | **Required.** The BolifyAI webhook that starts a call (the value that was `YOUR_MYAPPZ_WEBHOOK_URL` in the script). `https` only. |
| `BOLIFY_API_KEY` | Optional. Sent as `Authorization: Bearer <key>` if the webhook asks for one. |
| `BOLIFY_PHONE_FORMAT` | Optional: `e164` (default, `+919820000123`), `91` (`919820000123`) or `10` (`9820000123`). |
| `BOLIFY_INCLUDE_CONTEXT` | Optional, `true` adds `company`, `plan`, `expiry_date`, `days_left`, `reminder_stage` and `reference`. Off by default, so the request is exactly what the sheet sent. |
| `BOLIFY_TIMEOUT_MS` | Optional, default 10000. |
| `AUTOMATION_MODE_AI_CALL` | `off`, `dry_run` (default) or `live`. Calls are placed only in `live`. |
| `AUTOMATION_TEST_RECIPIENTS` | Staging safety: when set, only these numbers are ever called. |

Run `supabase/migrations/20261119000100_bolify_call_payload.sql` (one function, safe to run again): the reminder queue now hands the sender the customer's e-mail and city too.

Nothing is stored in the database or sent to a browser: the webhook address and key live in the server environment.

## What is sent, and when

1. **Subscription expiry reminders** (7, 5 and 1 day before a service's `renews_on`): the daily scheduler decides what is due and the dispatcher places the call. See `SUBSCRIPTION_REMINDERS.md` for consent, the 10:00 to 19:00 IST call window, retries (3 attempts), cancellation when a service is renewed, and the audit trail. Going `live` also places the reminders that were prepared in dry run, if they are still inside their window.
2. **On demand:** the Technical Consultant's *AI Calling* automation (`POST /pipeline/customers/:id/automations/AI_CALLING`) now goes to BolifyAI instead of a Google Sheet when `BOLIFY_WEBHOOK_URL` is set. This one is a person's deliberate action: it does not check call consent or the call window.

The request body (JSON):
```json
{ "name": "Meera Joshi", "phone": "+919820000123", "email": "meera@example.com", "service": "AI Calling", "location": "Pune" }
```
`name` is the customer's name, `service` the service the call is about (the services joined by commas for an on-demand call), `location` the customer's city. A missing e-mail or city is an empty string.

## What a reply means
* **2xx** = BolifyAI **accepted** the request. It does not mean the call happened or was answered. A call id is stored when the reply has one (`call_id`, `callId` or `id`).
* **408, 429, 5xx, a timeout or a network error** = tried again later (10 and 30 minutes apart, 3 attempts).
* **Any other 4xx** = the request was refused: the reminder is marked failed and not retried. Check the webhook address and key.
* The webhook's reply text is never copied into the CRM's records, and neither is the full phone number (reminders keep a masked number).
* A customer with no valid Indian mobile number is never sent.

## Try it safely
1. Set `BOLIFY_WEBHOOK_URL`, `AUTOMATION_TEST_RECIPIENTS=<your own mobile number>` and `AUTOMATION_MODE_AI_CALL=live`.
2. Give a test customer you own consent, a live service expiring in 7 days, and run the scheduler (or use the Technical Consultant's *AI Calling* button on that customer). Only your number can be called.
3. Remove `AUTOMATION_TEST_RECIPIENTS` to go live for everyone.

## Not built
Call-outcome callbacks (answered / interested) and BolifyAI's in-call lookups: the webhook as described in the sheet script has no reply with an outcome. Tell me the callback format BolifyAI offers and these can be added.

## Tests
`supabase/tests/bolify.test.ts` (`npm run test:unit`: the request, every kind of reply, time-outs, staging allow-list, bad numbers), the "BolifyAI" block of `api_integration.test.ts` (a mock webhook: live calls, retry, refusal, no consent, dry run, on-demand), and `subscription_reminders_test.sql`.

## Panel recharge reminder calls through the BolifyAI calling API (migration `20270103000100`)

**What it does.** Every morning the server decides, from the database, which customers' panels expire in exactly **7, 5 or 1** day(s) (Asia/Kolkata calendar dates) and asks BolifyAI to call them. Example: a panel expiring on **20 Nov 2026** is called on **13 Nov** (7 days), **15 Nov** (5 days) and **19 Nov** (1 day). Nothing comes from Google Sheets and nothing needs a browser open.

**The date used.** `customer_services.renews_on` of a **live** service. For a subscription that is the expiry the database calculated from the confirmed panel activation date (`SUBSCRIPTION_ACTIVATION.md`) and that a renewal moves forward; staff can also set it with `set_customer_service_term`. It is the panel's own expiry, not an invoice, payment or account date; `subscription_cycles.expires_on` keeps each cycle's history.

**The request** (`server/automations/bolify.ts`, `BolifyApiSender`):
```
POST https://api.bolifyai.com/api/v1/playground/call
x-api-key: <BOLIFY_API_KEY>            Idempotency-Key: <reminder id>
{ "first_name": "Meera", "last_name": "Joshi", "email": "meera@example.com", "phone_number": ["+919820000123"],
  "assistant_id": "567eaefd-bc8f-42c2-8bff-c1d1ac2f97ba", "dialer_id": "c19c9cff-d96d-48b7-b163-1c62be020e6d",
  "description": "Panel recharge reminder: AI Calling expires on 20 Nov 2026 (7 days left)." }
```

**Settings** (server only; on Cloudflare: Worker → Settings → Variables and Secrets):

| Name | Type | |
|---|---|---|
| `BOLIFY_API_KEY` | **Secret** (`npx wrangler secret put BOLIFY_API_KEY`) | Required for live calls. Sent only as `x-api-key`. Never a `VITE_` / public variable, never returned by any API, never logged, never stored, removed from any reply that echoes it. |
| `AUTOMATION_MODE_AI_CALL` | Variable | `dry_run` (default: decided and listed, nobody called), `live`, `off`. |
| `SCHEDULED_ENABLED` | Variable | Must be `true` on the production Worker, or the cron runs do nothing (`worker/index.ts`, `GO_LIVE_RUNBOOK.md`). |
| `CRON_SECRET` | Secret | Already used by the cron runs (16+ characters). |
| `BOLIFY_ASSISTANT_ID`, `BOLIFY_DIALER_ID` | Variable, optional | Default to the ids above. |
| `BOLIFY_API_URL` | Variable, optional | Default the playground endpoint above (https only). |
| `BOLIFY_CALLBACK_SECRET` | Secret, optional | Enables call results (below). |
| `AUTOMATION_TEST_RECIPIENTS` | Variable | **Safe test mode**: only these numbers are ever called; every other reminder is skipped with that reason. |

If `BOLIFY_WEBHOOK_URL` is also set, the older webhook is used instead (unchanged), so set only `BOLIFY_API_KEY` to use the calling API.

**When it runs.** The two existing Cloudflare Cron Triggers in `wrangler.jsonc` (03:30 and 05:00 UTC = 09:00 and 10:30 IST) call `/api/v1/internal/automations/dispatch`: the 09:00 run creates the day's reminders, the 10:30 run places the calls (call window 10:00 to 19:00 IST). No cron was added.

**Never twice, never the wrong person.**
* One row per customer + panel + expiry date + stage under a **unique key**: the job run twice on the same day, or by two servers at once, creates nothing twice. Rows are claimed with `FOR UPDATE SKIP LOCKED`.
* At the moment of calling the database checks again: live panel, still a customer, the same expiry date, a valid Indian mobile, **call consent recorded** (`DO_NOT_CALL` always wins, no record = not called), inside the window.
* **Submitted** (`ACCEPTED`) means BolifyAI took the request. 429 / 503 (BolifyAI said it did not take it) are tried again later. A **timeout, a lost connection or any other 5xx is FAILED and never retried automatically**: the call may already be on its way and a retry could call the customer twice. 4xx / `success: false` are FAILED with the code and message.
* **Renewal:** when the expiry date changes (renewal through the existing workflow), the panel is cancelled / paused, the pending reminders are **withdrawn at once** (trigger on `customer_services`), and the next daily run starts the cycle for the new date. Sent, failed and completed reminders stay as history.
* What is stored: status, attempts, HTTP code, BolifyAI's reply (only `httpStatus`, `success`, `message`, `callId`; long numbers and the key removed), the call id, masked phone (`+91XXXXXX1234`), the reason for a skip / failure, times in UTC. Audit log and customer timeline entries as before.

**Call results.** No public BolifyAI documentation of a call-status webhook or call-history API could be found, so **Completed** is set only from a callback: `POST /api/v1/internal/bolify/call-status` with `Authorization: Bearer <BOLIFY_CALLBACK_SECRET>` and `{ "call_id": "...", "status": "completed" | "no-answer" | "busy" | "failed", "duration": 42 }` (field names provisional; `bolifyCallResult` maps them). Until BolifyAI is set up to send it, calls stay **Submitted**: the CRM does not know whether they were answered.

**Screen.** HR dashboard → **Recharge Reminder Calls** (Super Admin and HR staff; the database refuses anyone else, HR Recruiters included): customer, masked phone, panel / service, expiry date, days left, reminder (7 / 5 / 1-day), scheduled date, submission time (IST), status, BolifyAI response, failure reason; filters 7-day, 5-day, 1-day, pending, submitted, failed, completed, skipped. Read only: nothing on the screen can place a call. API: `GET /api/v1/reminder-calls?filter=&page=` → `sub_reminder_calls()`.

**Turning it on (in this order).**
1. Run `supabase/migrations/20270103000100_bolify_recharge_reminder_calls.sql` in the Supabase SQL editor (safe to run twice). The code works before it is run (calls stay 7 / 3 / 1 and the reply is not stored; the screen shows an error until then). Do not re-run the older `20261210000200` after it.
2. `npx wrangler secret put BOLIFY_API_KEY`, then set `AUTOMATION_TEST_RECIPIENTS` to your own mobile and `AUTOMATION_MODE_AI_CALL=live`; give a test customer you own consent and an expiry 7 days away; watch the screen. Only your number can be called.
3. Remove `AUTOMATION_TEST_RECIPIENTS` to call customers. `AUTOMATION_MODE_AI_CALL=dry_run` or `off` stops it at once, without a deploy.

**Tests.** `bolify.test.ts` (request, headers, idempotency key, every reply, timeout not retried, key never echoed, safe test mode, call results), `bolify_recharge_reminders_test.sql` (7 / 5 / 1 and not 10 days, renewed, no phone, invalid phone, opted out, expiry changed, run twice, API error, timeout, results, who can read the list) and the "BolifyAI panel recharge reminder calls" block of `api_integration.test.ts` (a local mock of the API; the real service is never called).
