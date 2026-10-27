# Weekly summary e-mail to clients: plan (nothing is built yet)

**Goal.** Every week each client gets one e-mail that says, in plain words: which campaigns went out, what happened with them (sent, delivered, read, replied, failed), what else the
team did for them that week, how their package is doing and what is coming up (renewal, open tickets, invoices). It should read like a short report from a person who looks after them,
not like a system notification.

**Status:** plan only, for your decision. No code or migration exists for this. The expiry-reminder channels (e-mail + WhatsApp, `docs/SUBSCRIPTION_REMINDERS.md`) are separate and already built.

---

## 1. What the summary can contain, and where each part comes from today

| Section | Source in the CRM (exists now) | Quality of the data | Comment |
|---|---|---|---|
| **Campaigns sent this week** (name, date, audience, sent / delivered / read / replied / failed) | `service_campaigns` (one row per campaign; filled by the staff import or by hand) | **Only as good as what staff type or import.** | If your Wabastore platform sends the campaigns, the real numbers live there, not here (see section 2). |
| **Delivery rate, read rate, reply rate** | calculated from the same rows | exact if the counts are | e.g. "Delivered 96 %, read 61 %, replied 7 %". |
| **Package usage** (WhatsApp messages used / left, AI calling credits, valid-until) | `service_usage` (`metrics`, `as_of`, `valid_until`) | as of the date staff last updated it | Shown with "as of <date>" so an old figure is never presented as today's. |
| **Other work done for the client** (calls campaigns, posts, ads, set-ups, reports, meetings, with insights) | `client_calendar_events` (`kind`, `title`, `summary`, `metrics`) | written by the team | Already shown on the client dashboard calendar, so the summary just repeats what they can see there. |
| **Support** (tickets opened / resolved / still open) | tickets tables | exact | Short line, link to the portal. |
| **Invoices and payments** (new, paid, due) | `generated_invoices` | exact | Optional; many clients prefer money in a separate e-mail. Decision below. |
| **Coming up** (renewal in N days, plan, status) | `customer_services.renews_on`, `plan_name`, `service_status` | exact | Reuses the same dates the expiry reminders use. |
| **A personal note from their account manager** | new optional text field | manual | Optional, turns a report into a relationship touch. |

A week with nothing to report should **not** produce an empty report (see "quiet weeks" below).

## 2. The one real question: where do campaign results come from?

The CRM stores campaign numbers only when someone enters or imports them. If campaigns are actually fired from **Wabastore** (your product), the accurate, current numbers are in Wabastore.
Three ways, in order of effort and quality:

1. **Use what the CRM already has (no integration).** Staff import or enter campaign results (`service_campaigns`). Cheapest, ready now, but the weekly e-mail is only as fresh as the last
   import, and someone must remember to do it. Risk: a summary that says "no campaigns" when there were some.
2. **Wabastore pushes results to the CRM (recommended).** Wabastore calls a CRM endpoint (or writes a daily export) with, per client account and campaign: name, template, sent date, audience,
   sent / delivered / read / replied / failed. The CRM stores them in `service_campaigns` (the table already fits) and everything else works unchanged. Needs: a Wabastore account id on the
   CRM customer (`customer_services.panel_account` is the natural place), an authenticated endpoint on the CRM side, and Wabastore to send the data (a nightly job is enough).
3. **CRM pulls from Wabastore on a schedule.** Same result; needs a Wabastore read API and keys held by the CRM. Better if Wabastore already exposes campaign reports.

Whichever you choose, the weekly e-mail reads only `service_campaigns`, so the choice does not change the e-mail design. **Question for you: how do campaign results leave Wabastore today (API,
webhook, CSV export, nothing)?** The answer decides the effort more than anything else.

Other platforms (AI calling, RCS, voice, GBP, ads) have the same question each; the plan starts with WhatsApp campaigns and the team's calendar entries, which already exist, and adds others later.

## 3. How it would run

* **Schedule.** Once a week, e.g. **Monday 10:00 IST**, covering the previous Monday to Sunday (a fixed, reproducible period). Triggered by the existing daily dispatch (`/api/v1/internal/automations/dispatch`);
  on Mondays it prepares and sends. No new cron is needed (Vercel Hobby allows two).
* **One row per client per week** (`client_weekly_summaries`: client, week start, status, content snapshot, sent time, provider reference) with a **unique key** `(customer, week_start)`: running it twice, or
  from two servers, can never send two. Same lease / claim / retry pattern as the expiry reminders (3 attempts, never sent twice, a missed window is not made up the next day in a burst).
* **Snapshot.** The numbers shown are frozen in the row when it is built, so what was sent can be shown later ("what did we tell this client on 3 Nov?") and re-sending reproduces the same mail.
* **Quiet weeks.** If a client had no campaigns, no calendar entries, no ticket activity and no renewal within 30 days, nothing is sent (no empty report). Configurable: "always send" or "skip quiet weeks".
* **Modes, same as the reminders.** `AUTOMATION_MODE_CLIENT_SUMMARY` = `off` / `dry_run` (default: built and logged, plus a preview, nothing sent) / `live`. Live also needs the wording/layout **approved** by a Super Admin and the e-mail provider connected.
* **Preview.** A staff-only "preview this client's summary" (HTML) before anything goes live, and "send me a test" to the staff member's own address. The first live week should go to a short allow-list (`AUTOMATION_TEST_RECIPIENTS`) before everyone.
* **Recipient.** The client's e-mail on the customer record (or the client login e-mail), **one e-mail per client** even if they have several services (sections per service). An optional CC to the account manager.
* **Who may be told what.** Only that client's own data, built from that customer's rows (never aggregate or other clients). Internal notes, staff names beyond the account manager, prices and payments to other people never appear.
* **Opt-out / consent.** Weekly reports are not a service-critical notice, so they should be **opt-out friendly**: an unsubscribe link in the footer that sets a per-client flag (same idea as `customer_message_optout`, with channel `WEEKLY_SUMMARY`), and staff can set it too. India's DPDP and e-mail norms favour an easy opt-out; marketing-style content (offers, upsells) should be left out of this mail or clearly separated. (This is not legal advice.)
* **Language and look.** English first; the layout reuses the existing e-mail wrapper with the company name and colours. A Hindi or regional version is possible later with a per-client language field.

## 4. Proposed e-mail layout (draft, wording not final)

```
Subject: Your weekly report: 3 – 9 Nov (Joshi Sweets)

Hi Meera,
Here is what we did for you last week.

CAMPAIGNS                                           (WhatsApp)
  Diwali offer      5 Nov   Sent 4,200  Delivered 96%  Read 61%  Replied 7%  Failed 3%
  Festive reminder  7 Nov   Sent 1,100  Delivered 98%  Read 70%  Replied 4%  Failed 1%
  Week total        Sent 5,300 ... best: "Festive reminder" (read rate)

OTHER WORK
  6 Nov  Call campaign - 320 calls, 41 interested
  8 Nov  Monthly report shared

YOUR PACKAGE
  WhatsApp messages: 31,000 of 50,000 used (as of 9 Nov), valid until 17 Mar 2027
  Support: 2 tickets resolved, 0 open

COMING UP
  AI Calling renews on 17 Mar 2027 (in 129 days)

[Open your dashboard]            Reply to this e-mail to reach your account manager.
Unsubscribe from weekly reports
```

Things to decide: the title tone, whether to show failure counts (some clients prefer a "needs attention" line), whether the invoices block is in or out.

## 5. Build plan (when you approve), in the order I would do it

1. **Data and rules (migration + SQL tests).** `client_weekly_summaries`, `private.build_client_week(customer, week_start)` (returns the JSON content), `client_summary_schedule()`,
   `client_summary_claim/finish()`, the opt-out channel, settings (on/off, quiet-week rule, send hour), Super Admin approval of the layout/wording, audit entries. Tests: idempotency, quiet weeks, opt-out,
   one client's data never in another's mail, week boundaries (IST), retries, nothing sent in dry run.
2. **Rendering and sending (server + unit tests).** HTML + plain-text renderer with escaping, the same provider layer as the other e-mails, dry run / live, staging allow-list, dispatch wiring.
3. **Preview and test send (UI).** A small Super Admin / Department Head screen: preview a client's week, send a test to myself, switch quiet-week behaviour, see what was sent.
4. **Wabastore results into `service_campaigns`** (section 2, option 2 or 3), once you tell me how Wabastore exposes them.
5. **Dry-run for two weeks**, compare the previews with what Wabastore shows for a few clients, then go live to an allow-list, then everyone.

**Effort (rough):** steps 1 to 3 about 3 to 4 days with tests; step 4 depends on the Wabastore side (about 1 to 2 days for the CRM part once its API/export is known).
**Volume and cost:** one e-mail per client per week. 1,000 clients is about 4,300 e-mails a month: inside the free or lowest tier of most e-mail providers, and a few seconds of work per client for the database. Building each summary is a handful of small indexed queries per client, run in batches of a few at a time, so it fits inside the daily dispatch's time budget; if the client count grows into the thousands the sending would simply continue over the next dispatch runs.

## 6. Risks and how the plan handles them

| Risk | Handling |
|---|---|
| Wrong or stale numbers reach the client | "as of" dates on every usage figure; the snapshot is stored; dry run + preview first; the campaign source is one table. |
| A client gets two e-mails | unique `(customer, week_start)` plus the claim lease; same proven pattern as the reminders. |
| One client's data in another's e-mail | the content builder takes a single customer id and only reads that customer's rows; a SQL test checks it with two clients. |
| A bad week of data (import mistake) is mailed to everyone | dry run, preview, the allow-list stage, and a Super Admin "pause all" (the mode switch / `set_reminder_channels`-style switch). |
| Spam complaints | opt-out link, a real reply-to, quiet weeks skipped, no promotion in the mail. |
| Empty report because nobody imported campaigns | "quiet week" rule, and a staff-side list "clients with campaigns not recorded this week" so the team sees the gap before Monday. |

## 7. What I need from you to finalise

1. **Where do campaign results live today, and how can the CRM get them from Wabastore?** (API, webhook, CSV export, only inside the Wabastore dashboard.)
2. Which day and time (suggested Monday 10:00 IST) and which period (previous Mon to Sun).
3. Include **invoices / payments** in this mail, or keep them out?
4. Include **support tickets**? Include **renewal** information? (Suggested: yes to both.)
5. Quiet weeks: skip the e-mail, or always send ("no campaigns this week")?
6. Which e-mail address sends it (the existing `meta@amuwa.com` or a dedicated `reports@`), and who should be CC'd (the account manager)?
7. One summary per client across all services (suggested), or one per service?
8. Language: English only for now?
9. Who approves the final layout and wording (the Super Admin, like the reminder wording)?
10. Should every client get it, or only clients with a campaign service (WhatsApp API, RCS, voice, AI calling, ads), at first?
