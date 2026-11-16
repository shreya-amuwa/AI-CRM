# Subscription expiry reminder calls (7, 5 and 1 day before expiry)

**Status: the decision, tracking and BolifyAI sender are built.** By default the system runs in *dry run*: it decides which reminders are due
and records "would call", and nothing leaves the server. With `BOLIFY_WEBHOOK_URL` set and `AUTOMATION_MODE_AI_CALL=live` the calls are placed
through BolifyAI (see `BOLIFY_AI.md`). `live` without a webhook is refused (it behaves like `off` and says so in the run summary).

## What decides "expiry"
`customer_services.renews_on` together with `customer_services.service_status` (LIVE services only; a service with no activation and no status is not called).
Invoice, payment and activation dates are never used. Set them with the Excel import or with `set_customer_service_term(customer, service, started_on, renews_on, status)`
(Support team; audited). Services with no expiry date are never reminded: they cannot be.

## How it works
| Piece | What it does |
|---|---|
| `sub_reminder_schedule()` | Daily decider. Creates one reminder for each customer + service + expiry date + stage (7, 5, 1 since `20270103000100`; 7, 3, 1 before) where the expiry is exactly that many calendar days away (Asia/Kolkata). Unique key `SUBREM\|customer\|service\|expiry\|stage`: running it twice, or from two servers, creates nothing twice. A day that was missed is not made up. |
| `sub_reminder_claim()` | Takes due reminders (SKIP LOCKED + lease). Re-checks at that moment: expiry date changed or service renewed / cancelled / paused / expired → **cancelled**; consent missing or "do not call", or no valid Indian mobile → **skipped** with the reason; call window closed → **skipped** (never sent late, never in a burst the next day). |
| `sub_reminder_finish()` | Records DRY_RUN / ACCEPTED / RETRY / FAILED / SKIPPED. **ACCEPTED means the provider took the request, not that a call happened.** At most 3 attempts (10 then 30 minutes apart), then FAILED. A live attempt whose result was never recorded (server stopped) is failed, not repeated, so a customer is not called twice. |
| `subscription_reminder_events` | Append-only log of every step. Audit log entries: `SUBSCRIPTION_REMINDER_ACCEPTED / _FAILED`, `CUSTOMER_CALL_CONSENT_CHANGED`, `CUSTOMER_SERVICE_TERM_CHANGED`, `REMINDER_CALL_SETTINGS_CHANGED`. |
| Customer timeline | `AUTOMATION_AI_CALL_ACCEPTED / _FAILED` entries. Phone numbers are stored masked (`+91XXXXXX1234`). |

## Consent and settings (decisions, defaults are conservative)
* A customer is called only if staff recorded consent: `set_customer_reminder_consent(customer, 'ALLOWED', 'how they agreed')` (a note is required).
  `DO_NOT_CALL` always wins. No record = unknown = **not called**, unless the Super Admin turns on `allow_unknown_consent` in `set_reminder_call_settings`.
* Call window: 10:00 to 19:00 Asia/Kolkata (changeable by the Super Admin, between 08:00 and 21:00).
* **This is not legal advice.** Whether these calls are "service" or "promotional" calls, and how DND / TRAI rules apply, is for you to decide.
* `sub_reminder_overview()` (Super Admin) shows the settings, the last scheduler run, counts and the latest reminders.

## Running it
`/api/v1/internal/automations/dispatch` (Bearer `CRON_SECRET` or `AUTOMATION_DISPATCH_SECRET`) runs it with the other automations. `vercel.json` calls it at
03:30 UTC (09:00 IST, creates the day's reminders) and 05:00 UTC (10:30 IST, inside the call window, so reminders can be processed). Vercel Hobby allows two daily crons.

| Variable | Meaning |
|---|---|
| `AUTOMATION_MODE_AI_CALL` | `off`, `dry_run` (default) or `live` (needs `BOLIFY_WEBHOOK_URL`). |
| `CRON_SECRET` / `AUTOMATION_DISPATCH_SECRET` | Authenticate the scheduler endpoint (16+ characters). |

## The same reminders by e-mail and WhatsApp (Wabastore)
E-mail and WhatsApp keep their own stages (15, 7, 3 and 1 day before the expiry date and on it, see `SUBSCRIPTION_ACTIVATION.md`) and are sent as an **e-mail** and a **WhatsApp message**. They reuse the call reminders' table,
schedule, window (10:00 to 19:00 IST), retry rules (3 attempts, 10 then 30 minutes apart), audit trail and customer timeline; a row now has a `channel`
(`CALL`, `EMAIL`, `WHATSAPP`). The unique key includes the channel, so one customer + service + expiry + stage + channel is created once.

**Nothing leaves the server until you decide.** Both channels start in `dry_run` (decided and logged as "would send", masked contact, nothing sent), and the wording is a
**draft that is not approved**. Live sending needs all three: the channel switched to `live`, the provider connected, and the wording approved.

| Variable | Meaning |
|---|---|
| `AUTOMATION_MODE_SUB_EMAIL` | `off`, `dry_run` (default) or `live`. Live uses the existing e-mail provider (`EMAIL_PROVIDER` + keys, `EMAIL_FROM`; SMTP, Resend or Brevo). |
| `AUTOMATION_MODE_SUB_WHATSAPP` | `off`, `dry_run` (default) or `live`. Live needs `WABASTORE_WEBHOOK_URL` (https) and optionally `WABASTORE_API_KEY` (sent as `Authorization: Bearer`, `WABASTORE_TIMEOUT_MS` optional). |
| `AUTOMATION_TEST_RECIPIENTS` | Staging safety net: when set, only these e-mails / numbers are ever sent to. |

Live without a provider behaves like `off` and says why in the dispatch answer (`subscriptionMessages.<channel>.note`). The calls keep their own switch (`AUTOMATION_MODE_AI_CALL`); the
three are independent, and each runner schedules only its own channel.

**Wording (`reminder_message_templates`, one per channel and stage, six in all).** Placeholders: `{{name}} {{service}} {{expiryDate}} {{daysLeft}} {{company}}`
(anything else is refused when saved). Values are HTML-escaped in e-mails and cannot add headers. A row is `approved = false` until a Super Admin approves it; **live never
sends unapproved wording** (the reminder waits and is skipped if the day's window passes; it is not sent late). `provider_template` is for a WhatsApp template name once
Wabastore needs one. Saving or approving wording needs the Super Admin (`set_reminder_message_template(channel, stage, subject, body, provider_template, approved)`) and is audited without
the text (`REMINDER_TEMPLATE_CHANGED`). The six drafts seeded by the migration are placeholders, not final text. There is no screen for this yet; when you have chosen the wording, in the
Supabase SQL editor: `update public.reminder_message_templates set subject = '…', body = '…', approved = true where channel = 'EMAIL' and stage = 7;` (repeat per stage), or ask for a small settings screen.

**Who is skipped (with the reason on the reminder).** Renewed / cancelled / paused / date changed (cancelled), an **opt-out** for that channel, no valid e-mail address, no valid Indian
mobile (WhatsApp uses the WhatsApp number, else the mobile). Unlike calls, e-mail and WhatsApp reminders are **sent unless the customer is opted out** (they are service notices to an existing
customer). Staff record an opt-out with `set_customer_message_optout(customer, 'EMAIL' | 'WHATSAPP', true, note)`; `customer_message_optout_get(customer)` reads it. If you want these
to need positive consent like calls, say so and the claim can be switched to that rule.

**What the provider receives.** E-mail: the filled subject and body only. WhatsApp (`wabastorePayload`): `reference` (`subscription-reminder:<id>`), `to` (+91 and the number), `template`,
`variables`, `text`, `language`. **The exact fields are provisional until Wabastore's send API is settled** (one function in `server/automations/subscriptionMessages.ts`). Nothing else about the
customer (address, payments, GSTIN) is sent. A refused request's reply is not stored (it can echo the message), only its status.

**Turning it on.** 1) run `supabase/run_this_expiry_email_whatsapp_reminders.sql` once; 2) agree and approve the wording; 3) connect the provider; 4) set the channel to `live`, ideally first with
`AUTOMATION_TEST_RECIPIENTS` set to your own address and number; 5) watch `sub_reminder_overview()` (now with `countsByChannel` and `approvedWording`). Switch a channel off for everyone without a deploy with
`set_reminder_channels(email, whatsapp)` (Super Admin).

## Not built yet (waiting for answers)
* Call-outcome callbacks and the in-call lookup endpoint.
* A settings screen for the reminder wording, channel switches and opt-outs (today: the RPCs / SQL above).
* Delivery and read receipts for e-mail and WhatsApp (ACCEPTED only means the provider took the request).
* Import fix so a blank "Renewal / Expiry Date" does not erase a stored date, and the `save_customer_services` deletion of rows that hold term data.
