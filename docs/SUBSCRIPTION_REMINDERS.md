# Subscription expiry reminder calls (7, 3 and 1 day before expiry)

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
| `sub_reminder_schedule()` | Daily decider. Creates one reminder for each customer + service + expiry date + stage (7, 3, 1) where the expiry is exactly that many calendar days away (Asia/Kolkata). Unique key `SUBREM\|customer\|service\|expiry\|stage`: running it twice, or from two servers, creates nothing twice. A day that was missed is not made up. |
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

## Not built yet (waiting for answers)
* Call-outcome callbacks and the in-call lookup endpoint.
* Import fix so a blank "Renewal / Expiry Date" does not erase a stored date, and the `save_customer_services` deletion of rows that hold term data.
