# Subscription duration, activation and expiry

**Sales selects the duration → the Meta Verifier verifies the documents → the Technical Team creates and activates the panel → an authorized
activation confirmation sets the subscription start date → the system calculates the expiry date → the customer sees it in the Client Dashboard →
the renewal reminders follow that expiry date.**

This replaces the earlier way of typing dates by hand for a new subscription. Migration: `supabase/migrations/20261210000200_subscription_activation.sql`
(also in `supabase/run_these_1_migration_subscription_activation.sql`). It is built into the existing model; nothing is duplicated.

## What is stored where

| Need | Where |
| --- | --- |
| Plan, amount, panel | `customer_services.plan_name`, `price`, `platform` (existing columns) |
| Duration (chosen by Sales) | `customer_services.duration_code` (`1M` `2M` `3M` `6M` `1Y` `2Y` `CUSTOM`), `duration_months` **or** `duration_days` (custom) |
| Message credits (Sales) | `customer_services.message_credits` |
| Activation date (the start) | `customer_services.started_on` - empty until the activation is confirmed |
| Expiry date | `customer_services.renews_on` - **calculated by the database**, never typed; empty until activation |
| Panel creation date, activated by, confirmed at | `panel_created_on`, `activated_by`, `activation_confirmed_at` |
| Every cycle (first activation and renewals) | `subscription_cycles` (the old cycle is kept, `ENDED`) |
| What changed, by whom, old and new values | `subscription_history` (append-only) and the audit log |
| E-mail state | the e-mail outbox (`automation_jobs`, stage `SUBSCRIPTION_ACTIVATED`) |
| Usage alert thresholds and what was announced | `usage_alert_settings`, `usage_alert_log` |

The expiry is read by everything that already follows `renews_on`: the client dashboard, the AI-call / e-mail / WhatsApp reminders and the services list.

## The rules (all enforced in the database; the API and screens repeat them)

1. **Sales** (the record's owner, their Team Head, the Department Head, the Super Admin) sets plan, duration, amount, message credits and panel with
   `set_subscription_terms` - until the subscription has started. A request that contains a start / expiry / activation date is refused. Another salesperson
   cannot touch it.
2. **Activation** - `confirm_subscription_activation(customer, service, activation date, panel creation date, note)`. Allowed to the team that works on the
   service (Meta Verifier / Technical Consultant of the customer's department, the hand-over team, the delivery department of that service, the Department Head,
   the Super Admin) - never Sales. It needs what "service ready" needs: payment confirmed, Meta verification completed, Relationship Manager assigned (where the
   journey applies), a client login, every document of the service authorized, **and** the duration set. The activation date cannot be in the future; the panel creation
   date cannot be after it; "activated by" is the signed-in person.
   Marking a service "ready" no longer starts a service that has a duration: it is refused and points to the activation.
3. **Expiry** = activation date + the stored duration, in calendar months / years (31 Jan + 1 month = 28/29 Feb; 29 Feb + 1 year = 28 Feb) or plain days for a custom
   number of days. Examples: 6 months from 10 Nov 2026 is 10 May 2027; 1 year is 10 Nov 2027.
4. **A repeated activation changes nothing** (same dates, same person, no second cycle, history line or e-mail), whoever repeats it and whatever date they send.
5. **Correcting a date** - `correct_subscription_dates` - Super Admin, Department Head, support Team Head; a reason is required; the expiry is recalculated; the old and new
   dates and the reason stay in the history and the audit log.
6. **Nobody writes these columns directly.** A trigger refuses a signed-in user's own insert / update of the dates, duration or credits and the removal of a started service;
   only the functions above (security definer) write them. `set_customer_service_term` refuses to type dates over a service that has terms.
7. **Renewal** - `confirm_subscription_renewal(customer, service, verified payment, [start], [new terms], note)`. Needs a payment of **this customer** that Accounts has
   VERIFIED, not already used for a renewal (a repeated request returns "already renewed"). Policy: while the subscription is still running the renewal **continues from the
   old expiry date**; once it has lapsed it starts on the confirmed activation date. The old cycle is kept (ENDED), a new cycle starts, the new expiry is calculated, and because
   reminders are keyed by expiry date the notification tracking is new for the cycle. Nothing extends a subscription without a verified payment and an authorized employee.
8. **Clients** read their subscription (`client_subscriptions()`, "My Subscription" - always open) and cannot change anything.

## The panel activation e-mail

Queued by the database in the same transaction as the activation (one per cycle) - never before. The API sends it right after the request. It carries the plan, duration,
the confirmed start date, the calculated expiry date, the message limit, the panel details and a secure way in: a one-time set-password link while the client has not chosen a
password, otherwise the sign-in address. Never a password. Its figures are read when it is sent, so a corrected date is what the client gets.
The outcome (queued / sent / failed / dry run) is shown on the subscription; **Retry sending** / **Send again** (`POST .../activation-email/resend`) re-queues it (a failed one is
retried as the same job, a delivered one is repeated at most every 10 minutes). In dry-run mode nothing leaves the server and the job is recorded as skipped.

## Reminders and usage alerts

* **Expiry reminders** (e-mail and WhatsApp): 15, 7, 3 and 1 day before and on the expiry date (stages 15, 7, 3, 1, 0), one row per customer, service, expiry date, stage and channel,
  so each is sent once per cycle. The AI-call reminders are 7, 5 and 1 (`20270103000100`, see `BOLIFY_AI.md`). The wording of stages 15 and 0 is seeded as an unapproved draft: a live send waits for the Super Admin's approval
  (Super Admin > reminder wording), like the other stages.
* **Message usage alerts** at 70 / 80 / 90 / 100 % of the package, from the usage data the service holds (`service_usage`, the figures the team imports or the provider reports):
  one alert per cycle and threshold (a jump over several thresholds is one alert, for the highest). Thresholds: `GET/POST /workflow/usage-alerts` (Super Admin changes them).
  Alerts go to the client's notifications and to the record's owner and Relationship Manager. They start only after the subscription has started. There was no usage-threshold alert before this change,
  so this is new; it does not call a provider itself.

## API

Staff: `GET /pipeline/customers/:id/subscriptions` (overview, history, cycles, verified payments),
`POST .../subscriptions/:service/terms`, `.../activation`, `.../dates`, `.../renewal`, `.../activation-email/resend`.
Client: `GET /client/subscription`. Settings: `GET|POST /workflow/usage-alerts`.
A lead can carry `subscriptions: [{ service, plan, durationCode, customMonths|customDays, amount, messageCredits, panel }]` on create / update.

## Screens

* Sales: **Add lead** asks for the plan, duration (1, 2, 3, 6 months, 1, 2 years, custom), amount and message credits of each selected service - no dates. The lead page shows the same under **Subscription**.
* Team: **Subscription** card next to the onboarding journey (Meta Verifier / consultant view, Department Head and Support member customer pages): terms, the panel creation date, activation date, activated by,
  the calculated expiry, **Confirm panel activation**, **Correct dates**, **Confirm renewal**, e-mail status with retry, and the history.
* Client: **My Subscription**: plan, duration, status, panel creation status and date, start and expiry dates, days left, total / used / remaining messages and the percentage.
  Before activation it says **Subscription Not Started** with the agreed wording; after it, **Subscription Active**.

## Existing customers

A service with no duration behaves exactly as before (imports, older customers, the manual term function). Nothing is backfilled and no existing date is changed.
