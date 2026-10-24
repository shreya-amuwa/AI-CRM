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

1. **Subscription expiry reminders** (7, 3 and 1 day before a service's `renews_on`): the daily scheduler decides what is due and the dispatcher places the call. See `SUBSCRIPTION_REMINDERS.md` for consent, the 10:00 to 19:00 IST call window, retries (3 attempts), cancellation when a service is renewed, and the audit trail. Going `live` also places the reminders that were prepared in dry run, if they are still inside their window.
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
