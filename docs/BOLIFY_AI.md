# BolifyAI: AI calls from the CRM

## Update: the real API, and transferring a call to the right department's Technical Consultant

Two things were added on top of everything below (which still applies).

### 1. Calls go to the BolifyAI API (the call your Google Sheet script already makes)
`onBolifySheetEdit` posts to `https://api.bolifyai.com/api/v1/playground/call` with the key in the **`x-api-key`** header and
`{ first_name, last_name, email, phone_number: ["..."], assistant_id, dialer_id, description }`. The CRM now makes the same call, from the database's own
records, for the subscription expiry reminders (7, 3 and 1 day before) and for the Technical Consultant's *AI Calling* button. Nothing about the sheet changes:
leave it as it is.

| Variable (server only) | |
|---|---|
| `BOLIFY_API_KEY` | The same key as the script property `Bolify_API_KEY`. |
| `BOLIFY_ASSISTANT_ID` | `567eaefd-bc8f-42c2-8bff-c1d1ac2f97ba` (the agent in the script). |
| `BOLIFY_DIALER_ID` | `c19c9cff-d96d-48b7-b163-1c62be020e6d` (the dialer in the script). |
| `BOLIFY_API_URL` | Optional. Default `https://api.bolifyai.com/api/v1/playground/call`. |
| `BOLIFY_PHONE_FORMAT` | `e164` (default, `+919820000123`), `91` (`919820000123`) or `10` (`9820000123`). **Set it to however you type the number in the sheet's column C**: the script sends it as typed and I could not see which form your dialer expects. |
| `BOLIFY_INCLUDE_CONTEXT` | `true` fills `description` with what the call is about (for a reminder: "Reminder: AI Calling (Gold plan) for Joshi Sweets expires on 2026-11-09, in 7 days. Reference ..."; for the button: "Services: ..."). Off by default: `description` is empty, as the sheet sends it. Turn it on if the agent's prompt should speak about the expiry. |
| `AUTOMATION_MODE_AI_CALL` | `off`, `dry_run` (default) or `live`. **Calls are placed only in `live`.** |
| `AUTOMATION_TEST_RECIPIENTS` | Staging safety: when set, only these numbers are ever called. |

The API is used when the key, the assistant id and the dialer id are all set; the older webhook (`BOLIFY_WEBHOOK_URL`) is still there for anyone who set it and is used only
when the API is not configured. A customer with one name is sent `-` as the last name (the sheet required one). The request, the meaning of replies (2xx = accepted, not
"answered"), the 3 attempts, consent, the call window and the audit trail are unchanged; a call id is read from the reply when it has one.

**Try it without calling anyone you do not mean to.** Keep `AUTOMATION_MODE_AI_CALL=dry_run` (nothing leaves the server) until you want a real call. For a first real call set
`AUTOMATION_TEST_RECIPIENTS=<your own mobile>`, `AUTOMATION_MODE_AI_CALL=live`, give a customer you own call consent and a live service expiring in 7 days, and run the scheduler or press
*AI Calling* on that customer. Do not use the shared spreadsheet for these tests: editing it places real calls.

### 2. Transfer to the Technical Consultant of the customer's department
The agent used to transfer to one number typed into its settings. With several departments, each with its own Technical Consultants, the number has to depend on **who is being
called**. So the agent asks the CRM during the call and the CRM answers from its records:

`GET` or `POST` **`https://<your CRM address>/api/v1/integrations/bolify/transfer-target`**, header `x-api-key: <BOLIFY_TOOL_SECRET>` (or `Authorization: Bearer ...`)
Send the customer's number (`phone`, `phone_number`, `customer_phone`, ... also inside `variables` / `data`), and if the agent has it the call's `call_id` or the reminder `reference`.

```json
{ "found": true, "transfer_to": "+919820000123", "consultant_name": "Meera Joshi", "consultant_first_name": "Meera",
  "department": "Wabastore", "assigned_by": "ROTATION", "say": "Please hold on, I am connecting you to Meera from the Wabastore team." }
{ "found": false, "reason": "NO_CONSULTANT", "say": "Our technical consultants are not available right now. I will arrange for one of them to call you back shortly." }
```

**How the CRM chooses** (`ai_call_transfer_target`, in the database):
1. The customer: the reminder this call was placed for (its reference, or BolifyAI's call id), else the customer with that phone or WhatsApp number.
2. The department: the customer's own (a Support side counts as its department). **A customer of Wabastore is never sent to another department's consultant.**
3. The consultant, in this order: the customer's own Technical Consultant (who started their onboarding); else the department's Technical Consultants **in turn** (the one who was sent a call longest ago);
   else the department's Support Team Lead. Only people who are **active, have a valid Indian mobile number on their profile, and are not on approved full-day leave today** are chosen.
4. Nobody reachable: the answer says so (the agent promises a call back), the department's consultants and Support Team Lead get a notification once an hour per customer, and the customer's timeline records it.
5. A number that is no customer at all (for example a test lead): not routed, unless `BOLIFY_DEFAULT_TRANSFER_NUMBER` is set, which is then used **only** for that case, never for a known customer.

The same call asking twice gets the same person. Every answer is logged (`ai_call_transfers`, numbers masked; the Super Admin and a Department Head can read it with `ai_call_transfers_recent`) and
a transfer shows on the customer's timeline. **Consultants must have their mobile number in their profile**: this is where the number comes from.

| Variable | |
|---|---|
| `BOLIFY_TOOL_SECRET` | **Required** for the endpoint (16+ characters; several, comma separated, while one is replaced). Without it the endpoint answers 503. Put the same value in BolifyAI. |
| `BOLIFY_DEFAULT_TRANSFER_NUMBER` | Optional. A mobile number for numbers that are no customer (tests). |

**What to set in BolifyAI (I could not open BolifyAI's documentation or your assistant from the build environment, so please check this against what your assistant offers).**
The CRM side is finished and tested; the agent has to be able to *ask* and then *use the answer*:
* If the assistant's *Transfer call* tool can take its number **from a custom tool / function / webhook call** (often called "dynamic number" or "custom function"): create a tool that calls the address above with the secret
  and the customer's number, and use `transfer_to` as the number to transfer to; say `say` first.
* If the assistant only allows a number typed in its settings, **BolifyAI cannot choose per call**, and the CRM cannot change that from outside. Options then: ask BolifyAI to enable dynamic transfer numbers, or create one assistant
  per department (each with its department's number; the CRM would then choose the assistant by department: tell me and it is a small change).
Send me a screenshot of the assistant's *Tools / Transfer* settings (or BolifyAI's docs link) and I will match the field names exactly.

---

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
