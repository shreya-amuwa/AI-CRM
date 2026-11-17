# Attendance reminders, installable CRM app, 45-minute lunch: design

Date: 2026-11-17. Status: written from the conversation with the owner; awaiting approval.

## 1. Intent

Staff forget to **Punch In**, **Start Lunch** and **Punch Out** in the CRM, so attendance is incomplete and lunch overruns go
unnoticed. The CRM should remind each person at the right time, **on their phone and their laptop, even when the CRM is not
open**, so that they "never forget it". At the same time the lunch allowance becomes **45 minutes** (was 50).

Success: on a normal working day, an employee who has not punched in by their start time gets a notification on their phone and
laptop; tapping it opens the CRM on the Attendance card; once they have punched in, nothing more about Punch In arrives that day.

## 2. Decisions the owner made

- **Everyone's normal day:** start 10:00, lunch around 14:00, leave 19:00 (India time).
- **Staff may choose their own reminder times**, starting from a company default.
- **Delivery:** **browser / phone notifications plus the CRM bell**. Staff use both computers and phones.
- **Installable app on phones:** the CRM can be installed on the home screen (the browser's "Install app"), and phone notifications
  come through that installed app. On laptops: normal browser notifications (installing there is optional).
- **Approach chosen:** standard **web push built into the CRM** (installable web app: app manifest + service worker + VAPID-signed
  push). Not Firebase, not a store app.
- Confirmed as proposed:
  - company defaults set by **HR** (HR staff and the Super Admin), not only the Super Admin;
  - reminder **days Monday to Saturday**; Sundays and **approved leave** are skipped;
  - **skip** a reminder when the action is already done;
  - **one follow-up nudge 15 minutes later** if still not done, then nothing more for that action that day;
  - a **"Lunch ends in 5 minutes"** reminder at minute 40 of a running lunch;
  - every reminder **also appears in the CRM bell**;
  - **tapping** a notification opens the CRM on the Attendance card;
  - the "turn on reminders / install app" banner **keeps coming back** until reminders are on (no permanent dismiss);
  - lunch allowance **45 minutes**.

## 3. Goals, non-goals, anti-goals

**Goals**
1. Reminders for Punch In, Start Lunch, Punch Out and lunch ending, at each person's times, delivered by web push to every device
   they enabled, and to the CRM bell.
2. The CRM installable on Android and iPhone home screens (and optionally desktop Chrome / Edge).
3. Company default reminder times (HR) and personal reminder times (each employee), stored in the database.
4. Lunch allowance 45 minutes everywhere it is shown or computed.

**Non-goals**
- A Play Store / App Store app; offline use of the CRM; caching the CRM for offline (the service worker only handles notifications
  and installability).
- Company holidays: there is no holiday calendar in the CRM today. HR can switch reminders off for everyone for a day (section 5.4);
  a real holiday calendar is a later piece of work.
- WhatsApp, SMS or e-mail reminders.
- Changing the attendance rules themselves (late marks, payroll). Personal times change **when reminders arrive**, nothing else.
- Customers and candidates: reminders are for staff only.

**Anti-goals (would make it a failure even if it works)**
- Duplicate notifications (the same reminder twice on one device, or one per open tab).
- Reminders after the action is done, on Sundays, or on approved leave.
- Notifications that reveal anything personal on a lock screen beyond the reminder itself.
- Making the CRM slower to load, or breaking the existing site (the service worker must not cache or intercept app pages).
- Anyone changing another person's reminder times or subscriptions.

## 4. Constraints found in the project

- **Hosting (confirmed by the owner):** production is the Cloudflare Worker `ai-crm` on **`crm.amuwacorporation.com`** (the Vercel
  copy is no longer the live site). Reminders, installs and push subscriptions are for that address only; subscriptions made on any
  other address (workers.dev, vercel.app, preview) are not production. The sender runs on the Worker; the Node path matters only
  because tests and `npm run dev` run on Node. (`docs/CLOUDFLARE_AUDIT.md` still lists the cut-over as unconfirmed: rollout step 8.)
- **Worker internals:** the CRM runs as a Cloudflare Worker (`worker/`, `wrangler.jsonc`), serving the Vite build in `dist/` and the Hono API
  (`server/app.ts`). Its only scheduled runs today are two Cron Triggers (03:30 and 05:00 UTC = 09:00 and 10:30 IST) that call
  `/api/v1/internal/automations/dispatch`, and only when the Worker variable `SCHEDULED_ENABLED=true`.
- **No service worker or app manifest exists** (`public/` has none; `index.html` has no manifest link).
- **No work hours or holiday data exist.** Leave exists: `public.leave_requests` with status `APPROVED`, `leave_type` `FULL_DAY` or
  `HALF_DAY`, `half_day_shift` `MORNING` / `AFTERNOON`.
- **Attendance** (migrations `20261230000400`, `0600`, `0700`): `attendance_settings` (single row; `lunch_allowance_minutes` default
  50, check 10..180), `attendance_records` (one row per person and office day: `punch_in_at`, `punch_out_at`), `attendance_lunches`
  (`started_at`, `ended_at`), `private.attendance_status(profile, date)`, `private.office_today()` (Asia/Kolkata). Only people with
  an active staff profile can punch (`private.attendance_me()`; the Super Admin cannot).
- **Bell:** `public.notifications` (recipient, type, title, body, priority, entity, data, read_at), written through `private.notify(...)`,
  shown by the Notification Center with realtime.
- **CSP** (`worker/securityHeaders.ts`, `vercel.json`): `worker-src 'self' blob:` and `connect-src 'self' https:` already allow a
  same-origin service worker and the push service endpoints.
- **iPhone:** web push works only for a web app installed to the home screen (iOS / iPadOS 16.4+), and there is no install prompt
  API on iOS: the CRM can only show instructions (Share, then Add to Home Screen).
- **Android / desktop Chrome and Edge:** the `beforeinstallprompt` event allows an "Install app" button; push works while the browser
  process runs (on Android it is woken by the system).
- **Web push on Workers:** the sending code must use Web Crypto (VAPID ES256 signing and `aes128gcm` payload encryption), because the
  usual Node `web-push` package depends on Node APIs the Worker lacks. The Vercel / Node path must keep working too (tests run on Node).
- Repository rules (AGENTS.md): new migrations later than every migration on `main`, safe to run twice, pasteable in the Supabase SQL
  editor, security-definer functions with `set search_path = ''`, permissions checked in the database; one branch and PR per task.

## 5. The design

### 5.1 Installable app (phones, optional on laptops)
- `public/manifest.webmanifest`: name "Amuwa CRM", short name "Amuwa CRM", `start_url` `/`, `display` `standalone`, theme and
  background colours from the CRM, icons 192, 512 and a maskable 512 made from the existing Amuwa logo, plus an Apple touch icon.
  Linked from `index.html`.
- `public/sw.js`: a **minimal** service worker that handles `push` (show the notification), `notificationclick` (focus an open CRM
  window or open one, on the Attendance card) and `pushsubscriptionchange` (re-subscribe and tell the server). It has **no fetch
  handler and caches nothing**, so the site behaves exactly as today.
- Registered on CRM pages for signed-in staff only (not the client dashboard, booking pages or the public pages).

### 5.2 Turning reminders on, per device
- A banner on the staff dashboard (shared shell) when this device has no active push subscription for the signed-in person:
  - **Android / desktop with the install event:** "Turn on reminders" and "Install app" buttons.
  - **iPhone in Safari (not installed):** "Install the CRM app to get reminders: tap Share, then Add to Home Screen" with a small
    picture of the steps; once opened from the home screen, the banner offers "Turn on reminders".
  - **Permission blocked:** how to allow notifications for this site in that browser.
  - Not dismissible for good; "Not now" hides it for the rest of that day on that device.
- "Turn on reminders" asks the browser for permission, subscribes with the server's VAPID public key and stores the subscription
  (endpoint and keys) against the signed-in person, labelled with the device ("Chrome on Android"). A person can have several
  devices; each gets the reminders.
- Attendance → **Reminders** section: list of this person's devices (with "Remove"), "Send a test notification", and their reminder
  times.
- Signing out of the CRM removes **this device's** subscription, so a shared or handed-over phone stops getting someone else's reminders.

### 5.3 Reminder times
- **Company defaults** (HR, in the HR Attendance area): Punch In 10:00, Start Lunch 14:00, Punch Out 19:00, follow-up after 15
  minutes, lunch-ending warning 5 minutes before the allowance, days Monday to Saturday, and a master switch "Reminders on".
- **Personal times** (each employee, Attendance → Reminders): Punch In, Start Lunch, Punch Out, each optional ("use company time").
  Allowed ranges (builder may tune): Punch In 06:00 to 13:00, Start Lunch 11:00 to 17:00, Punch Out 14:00 to 23:30, Punch Out after
  Punch In. Personal times change only when reminders arrive.
- All times are India time (Asia/Kolkata), like the rest of attendance.

### 5.4 When a reminder is sent (rules)
For each active staff member who can punch (same population as `attendance_me()`), each office day, Monday to Saturday, when
reminders are on (company switch, and not switched off for today by HR):

| Reminder | Due at | Skipped when | Follow-up |
| --- | --- | --- | --- |
| Punch In | their Punch In time | already punched in today; full-day leave or morning half-day leave | once, 15 min later, if still not punched in |
| Start Lunch | their lunch time | not punched in; already started lunch today; punched out; full-day leave or afternoon half-day leave | once, 15 min later |
| Lunch ends soon | 5 min before the **day's remaining allowance** runs out during the current break (one break: minute 40) | that break already ended; the break started with 5 minutes or less of allowance left | none |
| Punch Out | their Punch Out time | not punched in; already punched out; full-day leave or afternoon half-day leave | once, 15 min later |

- Several lunch breaks a day share one allowance (as today). The lunch-ending warning is per **break** (key: person, break id): due at
  break start + (allowance - minutes already used in earlier breaks that day) - 5. *Builder's call, made in the design.*
- Each reminder (person, office day, kind, first or follow-up; for lunch-ending: break) is sent **at most once**, recorded in the database with a unique key, so
  a retry or overlapping run never sends it twice.
- A reminder that is more than 30 minutes late (for example the scheduler did not run) is not sent; its follow-up may still be.
- HR can switch reminders off for **today** for everyone (holiday or office closed).

### 5.5 Delivery
- Every 5 minutes a scheduled run picks the due reminders (a database function returns them and records them as sent in the same
  step), then:
  - writes the bell notification (`private.notify`, type `ATTENDANCE_REMINDER`, entity attendance), and
  - sends a web push to each of the person's active subscriptions, with a short payload: title (for example "Time to Punch In"),
    body ("You have not punched in yet today."), a tag per reminder kind and day (so a follow-up **replaces** the earlier one on the
    device instead of stacking), and the URL to open.
- A push service answer of 404 or 410 (subscription gone) deactivates that subscription. Other failures are logged and not retried
  beyond the follow-up.
- **Scheduler:** a new Cloudflare Cron Trigger `*/5 * * * *` on the Worker that calls a new internal endpoint for reminders only
  (same `CRON_SECRET` / dispatch-secret protection and the same `SCHEDULED_ENABLED` switch as the existing dispatch). The existing
  twice-daily dispatch stays as it is.
- Notification content contains nothing personal beyond the reminder (no names, no times of others).

### 5.6 Lunch allowance 45 minutes
- A new migration sets `attendance_settings.lunch_allowance_minutes` to 45 and its default to 45 (existing lunch records are not
  rewritten; their "exceeded" figures are computed with the current allowance, as today).
- The screen fallbacks (`allowanceMinutes ?? 50`) and docs say 45. Tests that assume 50 are updated.

### 5.7 Security and privacy
- Push subscriptions and reminder settings live in new tables with RLS on and no direct grants; access only through security-definer
  functions: a person manages only their own subscriptions and personal times; company defaults and "off today" only HR
  (`private.is_hr_staff()`); the sender reads due reminders and subscriptions with the service role only.
- The VAPID private key is a Worker secret (`VAPID_PRIVATE_KEY`), the public key a variable (`VAPID_PUBLIC_KEY`, also served to the
  browser by the API), plus `VAPID_SUBJECT` (mailto of a company address). Without them the feature stays off and says so.
- Turning reminders on / off, and HR changing defaults, are written to the audit log.

## 6. Approaches considered
1. **Web push built into the CRM (chosen).** Installable web app + service worker + VAPID-signed push from the Worker. No new vendor,
   no fees, works on Android and desktop, and on iPhone once installed to the home screen.
2. **Firebase Cloud Messaging.** Same underlying mechanism and the same iPhone rule, but adds a Google project and SDK for no benefit here.
3. **Notifications only while a CRM tab is open.** Simple, but misses exactly the case the owner cares about (CRM not open). Dropped.
4. **Native store apps.** Much more work and store reviews; not needed for reminders. Dropped.

## 7. Left to the builder
- Table and function names, the exact payload shape, icon generation from the existing logo, the device label text.
- How the HR and employee settings screens look, within the existing Attendance and HR screens' style.
- The exact allowed ranges for personal times (sensible values given in 5.3).
- Whether the reminder selection is one database function per run or several, as long as "sent at most once" holds.
- Splitting into several pull requests (suggested: 1) lunch 45 minutes; 2) database + sender + scheduler; 3) installable app,
  service worker, opt-in banner and settings screens).

## 8. Rollout notes for the owner
- Make sure production really is the Worker: `SCHEDULED_ENABLED=true` on the Worker and `VERCEL_CRON_PAUSED=true` on Vercel (see
  `docs/DEPLOYMENT_CLOUDFLARE.md`, step 4), so the 5-minute reminder run happens on Cloudflare and nothing runs twice.
- Generate the VAPID key pair once and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` on the Worker.
- Run the new migrations in the Supabase SQL editor.
- Deploy the Worker (the new Cron Trigger comes with `wrangler.jsonc`); `SCHEDULED_ENABLED=true` must already be on.
- Tell iPhone users to install the CRM to the home screen.
