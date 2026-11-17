# Attendance Reminders, Installable CRM App and 45-Minute Lunch: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff get Punch In, Start Lunch, Lunch ends soon and Punch Out reminders on their phone and laptop and in the CRM bell. The CRM can be installed on a phone. The lunch allowance becomes 45 minutes.

**Architecture:**
- The database decides who is due a reminder. It records each reminder once and writes it to the bell.
- A 5-minute Worker cron calls an internal endpoint. That endpoint asks the database what is due and sends a Web Push to each registered device using VAPID with Web Crypto.
- The browser side is a web app manifest, plus a push-only service worker, an opt-in banner, and a Reminders section on the Attendance page.

**Tech Stack:** Supabase Postgres (security-definer RPCs), Hono API on a Cloudflare Worker, `@pushforge/builder` (Web Push with zero dependencies, runs on Workers), React/Vite/Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-17-attendance-reminders-installable-app-design.md`

## Global Constraints

**Branches and PRs**
- One branch and one PR per part, each cut from the latest `origin/main`:
  - `claude/attendance-lunch-45`
  - `claude/attendance-reminders-push`
  - `claude/attendance-installable-app`
- Merge `origin/main` before each push. Never push to `main`, never merge the PR, and never deploy.

**Migrations**
- New migrations are numbered after `20270108000100`. Use `20270109000100_attendance_lunch_45.sql` and `20270109000200_attendance_reminders.sql`. If `main` takes either number first, rename the file.
- Never edit a migration that is already on `main`.
- Every migration must be safe to run twice and pasteable into the Supabase SQL editor (no temp tables across statements).

**Database security**
- Functions are `security definer` with `set search_path = ''`.
- `revoke` execute from `public, anon`. Grant execute to `authenticated` only where staff call the function; otherwise grant it to `service_role` only.
- New tables have RLS enabled and no grants.
- Errors start with `NOT_FOUND:`, `VALIDATION_ERROR:`, `FORBIDDEN:` or `CONFLICT:`.

**Office time**
- "Office time" is Asia/Kolkata, and today's date is `private.office_today()`.
- Reminder days are Monday–Saturday (ISO day of week 1–6).

**Default reminder times (spec §5.3)**
- Company defaults:
  - Punch In 10:00
  - Lunch 14:00
  - Punch Out 19:00
  - Follow-up 15 minutes after the first reminder
  - Lunch warning 5 minutes before the allowance runs out
  - A master switch, on by default
- Personal time ranges (inclusive):
  - Punch In 06:00–13:00
  - Lunch 11:00–17:00
  - Punch Out 14:00–23:30
  - The personal Punch Out time must be later than the personal Punch In time.

**Reminder copy (exact text)**

| Kind | Title | Body |
|---|---|---|
| Punch In | `Time to Punch In` | `Your day starts at {HH:MM}. Open Attendance to punch in.` |
| Start Lunch | `Lunch time` | `Start your lunch break in Attendance when you go.` |
| Lunch ends soon | `Lunch ends in 5 minutes` | `End your lunch break in Attendance when you are back.` |
| Punch Out | `Time to Punch Out` | `Your day ends at {HH:MM}. Punch out before you leave.` |

- A follow-up reuses the same title with ` (reminder)` added.
- The `{HH:MM}` placeholders are the person's effective times. For Lunch ends soon, the "5" in the title is the configured warning minutes.

**Sending**
- Each reminder is sent at most once per person, day, kind and step. Step 0 is the first reminder and step 1 is the follow-up.
- A reminder more than 30 minutes past its due time is never sent.
- If the push service answers 404 or 410, the subscription is deactivated.
- Push payload JSON: `{ "title", "body", "tag": "att-{kind}-{YYYY-MM-DD}", "url": "/?open=attendance" }`. Kind is one of `punch_in`, `lunch`, `lunch_end`, `punch_out`.
- The bell notification uses type `ATTENDANCE_REMINDER` and entity type `attendance`.

**Secrets and data**
- Worker settings:
  - `VAPID_PUBLIC_KEY` (plain)
  - `VAPID_PRIVATE_KEY` (secret, a JWK string)
  - `VAPID_SUBJECT` (a `mailto:` or `https:` address the owner sets)
- Never commit key values. `.env.example` lists each setting as `# NAME=`.
- Tests use synthetic `@example.com` people only.

**PR description:** list the migrations to run and the checks that were run. End it with the attribution lines.

## Review Focus

1. **A person punched in at 09:55 and sets a personal Punch In time of 10:30.** No Punch In reminder should go out. The check is "already punched in", not "punched in after the reminder time". Test it in Task 4.
2. **A cron run is late or runs twice** (Cloudflare retries, or two runs overlap). Nobody gets a duplicate. A reminder delayed by more than 30 minutes (the Worker was down from 10:00 to 10:40) is dropped, not sent late. Test it in Task 4.
3. **The same phone is registered by two staff in turn on a shared device.** The subscription belongs to the last person who signed in, and signing out removes it. The previous owner must not get the next person's reminders. Test it in Task 3.
4. **The lunch warning when the break started with 5 minutes or less of allowance left**, or when it is the person's second break. The warning is keyed to that break and goes out at most once per break. When there is no time left to warn about, no warning goes out. Test it in Task 4.
5. **The browser has no Push support**, which includes iPhone Safari when the app is not installed. The banner shows the Add to Home Screen steps. It never shows a broken "Turn on" button, and it never throws. Test it in Task 8.

---

## PR 1: Lunch allowance 45 minutes (branch `claude/attendance-lunch-45`)

### Task 1: Set the allowance to 45 minutes

**Files:**
- Create: `supabase/migrations/20270109000100_attendance_lunch_45.sql`
- Modify:
  - `src/components/attendance/AttendancePage.tsx:99` (`?? 50` → `?? 45`)
  - `supabase/tests/attendance_punch_lunch_test.sql`
  - `supabase/tests/attendance_register_test.sql`
  - `supabase/tests/ui_attendance.test.mjs`
  - `supabase/tests/ui/attendance_stubs.ts`
  - `supabase/tests/run.sh`
  - `docs/ATTENDANCE_PUNCH.md`
  - the HR docs-site attendance page (find it with `grep -rln "50 min" public/docs src/docs 2>/dev/null`)

**Interfaces:**
- Produces: `attendance_settings.lunch_allowance_minutes = 45`, with a column default of 45. `private.lunch_allowance()` falls back to 45.

- [ ] **Step 1: Update the tests to 45.**
  - `attendance_punch_lunch_test.sql`: change the header comment and the assertions near lines 38–51. The allowance is now 45. 45 minutes used is "not exceeded". 46 minutes gives `exceeded = 1`.
  - `attendance_register_test.sql`, lines 69–88: 20 minutes used leaves `remaining = 25`. 55 minutes used is `exceeded = 10`.
  - The UI stubs use `allowanceMinutes: 45`. The 52-minute case is now flagged `"7 min extra"`.
  - In `run.sh`, add `\i` of the new migration to the line that loads the attendance migrations before `attendance_punch_lunch_test.sql`. Run it once more with `\i` to prove it is safe to run twice.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `bash supabase/tests/run.sh 2>&1 | grep -E "not ok|135\.|exceeded"`
  - Expected: FAIL on the 45-minute assertions.

- [ ] **Step 3: Write the migration.**
  - `alter table public.attendance_settings alter column lunch_allowance_minutes set default 45;`
  - `update public.attendance_settings set lunch_allowance_minutes = 45, updated_at = now() where id and lunch_allowance_minutes = 50;`
    - The update only changes a value that is still the old default, so an allowance HR has chosen is kept.
  - Recreate `private.lunch_allowance()`. Copy the body from `20261230000400` and change only `coalesce(..., 50)` to `45`.

- [ ] **Step 4: Update the UI fallback and the docs.**
  - The UI fallback in `AttendancePage.tsx:99` becomes `?? 45`.
  - Change "50 minutes" to "45 minutes" in both docs pages.

- [ ] **Step 5: Run the checks and confirm they pass.**
  - Run `bash supabase/tests/run.sh`. Expected: no `not ok`.
  - Run `bash supabase/tests/run-unit.sh`. Expected: `ui_attendance` passes.
  - Run `npm run typecheck`. Expected: clean.

- [ ] **Step 6: Commit, push and open the PR.**
  - Commit message: `feat(attendance): lunch allowance 45 minutes`.
  - The PR lists migration `20270109000100_attendance_lunch_45.sql`.

---

## PR 2: Reminders database, Web Push sender, 5-minute scheduler (branch `claude/attendance-reminders-push`)

### Task 2: Reminder settings, personal times, and the HR screen functions

**Files:**
- Create: `supabase/migrations/20270109000200_attendance_reminders.sql` (part 1 of 3: settings and preferences)
- Create: `supabase/tests/attendance_reminders_test.sql` (wired into `supabase/tests/run.sh` after `attendance_register_test.sql`; it loads the migration twice)

**Interfaces:**

*New columns on `attendance_settings`*

| Column | Type | Default | Check |
|---|---|---|---|
| `reminders_enabled` | boolean | `true` | |
| `reminder_punch_in` | time | `'10:00'` | |
| `reminder_lunch` | time | `'14:00'` | |
| `reminder_punch_out` | time | `'19:00'` | |
| `reminder_follow_up_minutes` | int | 15 | 5..60 |
| `reminder_lunch_warning_minutes` | int | 5 | 2..15 |
| `reminder_days` | int[] | `'{1,2,3,4,5,6}'` | |
| `reminders_paused_on` | date | null | |

*New table `public.attendance_reminder_prefs`*
- Columns:
  - `profile_id uuid primary key references profiles on delete cascade`
  - `enabled boolean not null default true`
  - `punch_in time`, `lunch time`, `punch_out time`
  - `updated_at timestamptz`
- A null time means "use the company default".
- Check constraints enforce the ranges from Global Constraints.

*Functions*
- `private.reminder_times(p_profile uuid) returns table(enabled boolean, punch_in time, lunch time, punch_out time)`: the person's effective settings. Their own preference is used where set, and the company default otherwise. `enabled` is the company switch AND the person's own switch.
- `public.attendance_reminder_settings() returns jsonb`, granted to `authenticated`:
  - It returns `{ company: {...all settings...}, mine: {enabled, punchIn, lunch, punchOut}, effective: {...}, pausedToday: bool, canManage: bool }`.
  - `mine` holds null where the person uses the default. `canManage` is `private.is_hr_staff()`.
  - Times are `"HH:MM"` strings.
- `public.attendance_reminder_save_mine(p_enabled boolean, p_punch_in time, p_lunch time, p_punch_out time) returns jsonb` (same shape), granted to `authenticated`:
  - A time out of range raises `VALIDATION_ERROR: Punch In reminder must be between 06:00 and 13:00` (with matching wording for Lunch and Punch Out).
  - A Punch Out at or before Punch In, after defaults are applied, raises `VALIDATION_ERROR: Punch Out must be after Punch In`.
  - The Super Admin raises `FORBIDDEN` (the check is shared with `private.attendance_me()`).
- `public.hr_attendance_reminder_defaults_save(p_enabled boolean, p_punch_in time, p_lunch time, p_punch_out time, p_follow_up integer, p_warning integer, p_days integer[]) returns jsonb`:
  - Anyone who is not `private.is_hr_staff()` gets `FORBIDDEN`.
  - Days must be a non-empty subset of 1..7, otherwise `VALIDATION_ERROR`.
  - It writes `audit_logs` with action `ATTENDANCE_REMINDERS_UPDATED` (same insert shape as `20261230000700`:94).
- `public.hr_attendance_reminders_pause_today(p_paused boolean) returns jsonb`:
  - HR only.
  - It sets or clears `reminders_paused_on = private.office_today()`.
  - It writes the audit action `ATTENDANCE_REMINDERS_PAUSED`.

- [ ] **Step 1: Write the failing SQL tests.** Use `test.login` / `test.check` / `test.must_fail` as in `attendance_punch_lunch_test.sql`. Test names:
  - `staff see company defaults 10:00 / 14:00 / 19:00`
  - `a personal Punch In 09:30 is saved and becomes effective`
  - `Punch In 05:30 is refused` (expects `between 06:00 and 13:00`)
  - `Punch Out 09:00 with Punch In 10:00 is refused` (expects `after Punch In`)
  - `clearing a personal time falls back to the company default`
  - `a team member cannot change company defaults` (expects `FORBIDDEN`)
  - `HR changes Punch Out default to 18:30; staff without a personal time now see 18:30` (also checks that one `ATTENDANCE_REMINDERS_UPDATED` audit row exists)
  - `HR pause today sets pausedToday`

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `bash supabase/tests/run.sh 2>&1 | grep -A2 "reminders"`
  - Expected: FAIL, because the function does not exist.

- [ ] **Step 3: Write migration part 1 so the tests pass.**
  - Use `add column if not exists` and `create table if not exists`.
  - Wrap each constraint in a `do $$ … if not exists (select 1 from pg_constraint …)` block, as `20261230000700`:25–30 does.

- [ ] **Step 4: Run the tests and confirm they pass,** with the migration loaded twice.

- [ ] **Step 5: Commit.** Message: `feat(attendance): reminder settings and personal reminder times`.

### Task 3: Device subscriptions

**Files:**
- Modify: `supabase/migrations/20270109000200_attendance_reminders.sql` (part 2: devices)
- Modify: `supabase/tests/attendance_reminders_test.sql`

**Interfaces:**

*New table `public.push_subscriptions`*
- Columns:
  - `id uuid pk`
  - `profile_id uuid not null references profiles on delete cascade`
  - `endpoint text not null unique` (check: starts with `https://` and length ≤ 1000)
  - `p256dh text not null` (check: length ≤ 200)
  - `auth text not null` (check: length ≤ 100)
  - `label text` (check: length ≤ 120)
  - `active boolean not null default true`
  - `created_at timestamptz`, `last_success_at timestamptz`, `last_failure_at timestamptz`

*Functions*
- `public.push_subscription_save(p_endpoint text, p_p256dh text, p_auth text, p_label text) returns uuid`, granted to `authenticated`, for active staff only:
  - It upserts on `endpoint`.
  - On conflict it sets `profile_id = auth.uid()`, `active = true` and new keys. The last person to sign in on a device owns it.
- `public.push_subscription_remove(p_endpoint text) returns void`, granted to `authenticated`:
  - It deletes the row only if the caller owns it.
  - It does nothing otherwise, so sign-out never fails.
- `public.push_subscription_remove_by_id(p_id uuid) returns void`, granted to `authenticated`:
  - It raises `NOT_FOUND` unless the caller owns the row.
- `public.my_push_devices() returns jsonb`, granted to `authenticated`:
  - It returns `[{ id, label, createdAt, lastSuccessAt, active }]`.
  - It never returns keys.
- `public.push_targets_for(p_profile uuid) returns jsonb`, granted to `service_role` only:
  - It returns `[{ id, endpoint, p256dh, auth }]` for the person's active rows.
- `public.push_subscriptions_report(p_ok uuid[], p_gone uuid[], p_failed uuid[]) returns void`, granted to `service_role` only:
  - It stamps `last_success_at` for `p_ok`.
  - It sets `active = false` and stamps `last_failure_at` for `p_gone`.
  - It stamps `last_failure_at` for `p_failed`.

- [ ] **Step 1: Write the failing tests.**
  - `a device is saved and listed without its keys`
  - `the same endpoint saved by a second person moves to them; the first person no longer lists it` (Review Focus 3)
  - `removing someone else's endpoint changes nothing`
  - `remove_by_id of someone else's device is NOT_FOUND`
  - `an http:// endpoint is refused` (expects `VALIDATION_ERROR`)
  - `staff cannot call push_targets_for` (expects permission denied)
  - `a gone report deactivates the device`

- [ ] **Step 2: Run the tests and confirm they fail.**

- [ ] **Step 3: Implement the device functions.**

- [ ] **Step 4: Run the tests and confirm they pass.**

- [ ] **Step 5: Commit.** Message: `feat(attendance): push device subscriptions`.

### Task 4: Deciding which reminders are due

**Files:**
- Modify: `supabase/migrations/20270109000200_attendance_reminders.sql` (part 3: due reminders)
- Modify: `supabase/tests/attendance_reminders_test.sql`

**Interfaces:**

*New table `public.attendance_reminder_log`*
- Columns:
  - `id bigint identity pk`
  - `profile_id uuid not null references profiles on delete cascade`
  - `attendance_date date not null`
  - `kind text not null`, checked to be one of `'PUNCH_IN','LUNCH','LUNCH_END','PUNCH_OUT'`
  - `step smallint not null`, checked to be 0 or 1
  - `lunch_id uuid` (only for `LUNCH_END`)
  - `sent_at timestamptz not null default now()`
- Unique index on `(profile_id, attendance_date, kind, step, coalesce(lunch_id, '00000000-0000-0000-0000-000000000000'))`.

*Functions*
- `private.attendance_reminders_compute(p_now timestamptz) returns table(profile_id uuid, kind text, step smallint, lunch_id uuid, due_at timestamptz, title text, body text)`:
  - This is pure. It writes nothing.
- `public.attendance_reminders_due(p_now timestamptz default now()) returns jsonb`, granted to `service_role` only:
  - For each row computed, it inserts into the log with `on conflict do nothing`. It keeps only the rows that were actually inserted, then calls `private.notify(profile_id, 'ATTENDANCE_REMINDER', title, body, 'attendance', null, jsonb_build_object('kind', kind, 'step', step), 'normal')`.
  - It returns `[{ profileId, kind, step, title, body, tag, url, targets: push_targets_for(profileId) }]`.

**Rules**

Which people and days count:
- Only active staff count (`profiles.status = 'ACTIVE'`). The Super Admin and clients are excluded (the same population as `private.attendance_me()`).
- The person's effective `enabled` must be true.
- `reminders_paused_on` must not be today.
- The ISO day of week of today in office time must be in `reminder_days`.
- Nobody with an `APPROVED` `FULL_DAY` leave today is reminded.

Due times are today in office time at the effective time. A follow-up is due at the effective time plus the follow-up minutes. A step is due when `due_at <= p_now` and `due_at > p_now - interval '30 minutes'`.

When each kind is skipped (spec §5.4):
- **PUNCH_IN:** skipped if `punch_in_at` is not null, or if the person has a `MORNING` half-day leave.
- **LUNCH:** skipped unless the person is punched in. Also skipped if a lunch exists today, if they have punched out, or if they have an `AFTERNOON` half-day leave.
- **LUNCH_END:**
  - It applies only to the open lunch row `L`.
  - Remaining time = allowance minus lunch minutes used today (closed breaks), minus `(p_now - L.started_at)`.
  - Warning time = `L.started_at` + (allowance minus closed minutes) − warning minutes.
  - Step 0 only, with `lunch_id = L.id`.
  - It is skipped if the allowance left when the break started was ≤ the warning minutes.
- **PUNCH_OUT:** skipped unless the person is punched in. Also skipped if they have punched out, or if they have an `AFTERNOON` half-day leave.

A follow-up (step 1) uses the same skip rules, checked again at its own due time. LUNCH_END has no follow-up.

- [ ] **Step 1: Write the failing tests.** Drive time through `p_now` with fixed office timestamps, for example `('2027-01-11 10:00 Asia/Kolkata')::timestamptz`, which is a Monday. Insert the attendance and leave rows directly as `reset role` (`leave_requests`: `employee_id`, `start_date`..`end_date`, `status = 'APPROVED'`).
  - `10:00 Monday, not punched in: one PUNCH_IN step 0 and one bell notification`
  - `the same call again returns nothing (once only)`
  - `10:15 still not punched in: step 1 follow-up with "(reminder)" title`
  - `punched in at 09:55 with personal Punch In 10:30: nothing at 10:30` (Review Focus 1)
  - `first run at 10:40 after a missed 10:00 and 10:15: step 0 is dropped (40 minutes late), step 1 due 10:15 is sent (25 minutes late)` (Review Focus 2)
  - `first run at 11:00: nothing at all (both steps more than 30 minutes late)`
  - `Sunday 10:00: nothing`
  - `approved full-day leave: nothing all day`
  - `morning half-day: no PUNCH_IN; afternoon half-day: no LUNCH, no PUNCH_OUT`
  - `HR paused today: nothing`
  - `personal switch off: nothing`
  - `lunch started 14:00, allowance 45, warning 5: LUNCH_END due 14:40, once`
  - `second break with 4 minutes left: no LUNCH_END` (Review Focus 4)
  - `already punched out: no PUNCH_OUT`
  - `the result carries targets for the person's active devices only`

- [ ] **Step 2: Run the tests and confirm they fail.**

- [ ] **Step 3: Implement the compute function and `attendance_reminders_due`.**
  - Use `private.lunch_allowance()` for the allowance. Take the closed minutes from `attendance_lunches` rows with `ended_at is not null` (`private.lunch_minutes(p_profile, p_date)` in `20261230000400`:88 also counts the open break, so do not use it here).
  - The tag is `'att-' || lower(kind) || '-' || attendance_date`.

- [ ] **Step 4: Run the tests and confirm they pass.** Also run the whole SQL suite (`bash supabase/tests/run.sh`) and check there is no `not ok`.

- [ ] **Step 5: Commit.** Message: `feat(attendance): decide due reminders once per person and day`.

### Task 5: Web Push sender and the internal reminders endpoint

**Files:**
- Modify: `package.json` (add `@pushforge/builder` pinned to `2.0.5`)
- Create: `server/automations/webPush.ts`
- Create: `server/automations/attendanceReminders.ts`
- Modify:
  - `server/app.ts`: extract the secret check at :212 into `function dispatchAuthorized(header: string | undefined): boolean`, used by both routes
  - `server/controllers/attendance.ts`
  - `server/routes.ts`
  - `.env.example` (`# VAPID_PUBLIC_KEY=`, `# VAPID_PRIVATE_KEY=`, `# VAPID_SUBJECT=`)
- Test: `supabase/tests/web_push.test.ts` (add `web_push` to the `run-unit.sh` list) and `supabase/tests/api_integration.test.ts`

**Interfaces:**

*Types*
- `export interface PushTarget { id: string; endpoint: string; p256dh: string; auth: string }`
- `export interface PushMessage { title: string; body: string; tag: string; url: string }`

*Functions*
- `export function vapidConfig(): { publicKey: string; privateJWK: JsonWebKey; subject: string } | null`
  - It returns null when any of the three settings is missing or the JWK does not parse.
- `export async function sendWebPush(target: PushTarget, message: PushMessage, vapid: NonNullable<ReturnType<typeof vapidConfig>>, fetchImpl = fetch): Promise<'ok' | 'gone' | 'failed'>`
  - It uses `buildPushHTTPRequest({ privateJWK, subscription: { endpoint, keys: { p256dh, auth } }, message: { payload: message, adminContact: subject, options: { ttl: 1800, topic: tag-without-dashes-truncated-to-32, urgency: 'high' } } })`.
  - A 2xx answer is `ok`. 404 or 410 is `gone`. Anything else, or a thrown error, is `failed`.
- `export async function runAttendanceReminders(now?: Date): Promise<{ due: number; pushed: number; gone: number; failed: number; push: 'on' | 'off' }>`
  - It calls the service-role RPC `attendance_reminders_due`.
  - It sends to every target, at most 6 at a time.
  - It reports with `push_subscriptions_report`.
  - With no VAPID config it still records the reminders and writes to the bell, and returns `push: 'off'`.

*Routes*
- `POST /api/v1/internal/attendance/reminders`:
  - It uses the same Bearer secret as the dispatch route and the same `isPausedVercelCron` stand-down.
  - It returns the `runAttendanceReminders` result.
  - Add it to `STATIC_LABELS`.
- `GET /api/v1/attendance/push-key` → `{ publicKey: string | null }`, for signed-in staff.
- `POST /api/v1/attendance/push-test`, signed-in staff, rate class as for `resolve-places`:
  - It uses the service client to call `push_targets_for(actor.id)`.
  - It sends `{ title: 'Test reminder', body: 'Reminders work on this device.', tag: 'att-test', url: '/?open=attendance' }`.
  - It returns `{ sent: number, gone: number, failed: number }`.

- [ ] **Step 1: Write the failing unit tests** in `web_push.test.ts`, using the `check()` style from `no_hardcoded_secrets.test.ts`:
  - `vapidConfig is null when a setting is missing`
  - `sendWebPush maps 201 to ok, 410 to gone, 404 to gone, 500 to failed, a thrown fetch to failed` (use a stub `fetchImpl`, a JWK generated in the test with `crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, true, ['sign'])`, and a synthetic subscription built from a generated P-256 key and 16 random auth bytes)
  - `the request goes to the subscription endpoint with an aes128gcm body and a vapid Authorization header`

- [ ] **Step 2: Write the failing API integration tests** in `api_integration.test.ts`:
  - `internal reminders: 401 without the secret`
  - `internal reminders: 200 with the secret and returns counts`
  - `push-key: 401 signed out`

- [ ] **Step 3: Run the tests and confirm they fail.**
  - Unit: `bash supabase/tests/run-unit.sh 2>&1 | grep -E "web_push|not ok"`
  - API: the `run-api.sh` command with `POSTGREST_BIN=...`
  - Expected: FAIL.

- [ ] **Step 4: Implement the sender, the runner, the routes and `dispatchAuthorized`.**

- [ ] **Step 5: Run the checks and confirm they pass.**
  - Unit and API suites.
  - `npm run typecheck`.
  - `no_hardcoded_secrets` still passes.
  - The env audit test passes with the three new `.env.example` lines.

- [ ] **Step 6: Commit.** Message: `feat(attendance): web push sender and internal reminders endpoint`.

### Task 6: 5-minute Worker cron

**Files:**
- Modify:
  - `wrangler.jsonc`: crons become `["30 3 * * *", "0 5 * * *", "*/5 * * * *"]`, with a comment
  - `worker/index.ts`
- Test: `supabase/tests/cloudflare_worker.test.ts`

**Interfaces:**
- `export async function runScheduledReminders(env: WorkerEnv): Promise<void>`:
  - It uses the same `SCHEDULED_ENABLED` gate and secret as `runScheduledDispatch`.
  - It POSTs to `/api/v1/internal/attendance/reminders` and throws when the answer is not ok.
- `scheduled: async (controller: { cron: string }, env)`:
  - It runs `runScheduledReminders` when `controller.cron === '*/5 * * * *'`, and `runScheduledDispatch` otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `wrangler has the 5-minute cron`
  - `the 5-minute cron calls the reminders endpoint, the daily crons call dispatch` (stub `app.fetch` through the existing pattern in this test file)
  - `reminders cron is skipped unless SCHEDULED_ENABLED=true`

- [ ] **Step 2: Run the tests and confirm they fail.** Then implement the cron. Then run them again and confirm they pass.

- [ ] **Step 3: Run the full verification:**
  - `bash supabase/tests/run.sh`
  - `bash supabase/tests/run-unit.sh`
  - the API suite
  - `npm run typecheck`
  - `npm run build`

- [ ] **Step 4: Commit, push and open the PR.** Message: `feat(attendance): run reminders every 5 minutes on the Worker`.
  - The PR lists migration `20270109000200_attendance_reminders.sql`.
  - It says the reminders reach the bell without VAPID keys, and that push starts once the keys are set.
  - It gives the rollout steps from spec §8: `npx @pushforge/builder vapid`; set the three Worker settings; `SCHEDULED_ENABLED=true` and `VERCEL_CRON_PAUSED=true`.

---

## PR 3: Installable app, opt-in banner and Reminders screens (branch `claude/attendance-installable-app`, cut after PR 2 merges)

### Task 7: Manifest, icons and the push-only service worker

**Files:**
- Create:
  - `public/manifest.webmanifest`
  - `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png` (generated from `public/amuwa-logo.png` with `sharp`, which is already used by the build or added as a dev dependency; the maskable icon has the logo at 80% on white)
  - `public/sw.js`
  - `src/lib/push/registerServiceWorker.ts`
- Modify:
  - `index.html` (`<link rel="manifest" href="/manifest.webmanifest">`, `<meta name="theme-color" content="#0f172a">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-title" content="Amuwa CRM">`)
  - `public/_headers` (a `/sw.js` block with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`)
- Test: `supabase/tests/pwa_assets.test.ts` (add it to the `run-unit.sh` list)

**Interfaces:**
- Manifest values:
  - `name: "Amuwa CRM"`
  - `short_name: "Amuwa CRM"`
  - `start_url: "/"`
  - `scope: "/"`
  - `display: "standalone"`
  - `background_color: "#ffffff"`
  - `theme_color: "#0f172a"`
  - the three icons, one of them with `purpose: "maskable"`
- `sw.js` handles exactly three events, has no `fetch` listener and does no caching:
  - `push`: shows `title` and `{ body, tag, renotify: true, icon: '/icons/icon-192.png', badge: '/favicon-192.png', data: { url } }`. A payload that is not JSON shows `Amuwa CRM` with the text.
  - `notificationclick`: focuses an open CRM window and posts `{ type: 'open-attendance' }` to it, or opens `data.url`.
  - `pushsubscriptionchange`: re-subscribes with `event.oldSubscription.options` and POSTs the new keys to `/api/v1/attendance/push-resubscribe`, which needs no session and matches on the old endpoint. **Add this route in this task:** a service-role RPC `push_subscription_replace(p_old_endpoint text, p_new_endpoint text, p_p256dh text, p_auth text) returns boolean`, which updates only an existing active row. Ship it as a new migration numbered after the latest on `main`.
- `export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null>`:
  - It returns null when `serviceWorker` is not in `navigator`.
  - It is called once from the signed-in staff shell (`src/components/layout/shell.tsx`), and never on the careers or client portals.

- [ ] **Step 1: Write the failing tests.**
  - `manifest parses and has standalone display, start_url "/", 192 and 512 icons that exist on disk, one maskable`
  - `index.html links the manifest`
  - `sw.js has push, notificationclick and pushsubscriptionchange handlers and no fetch handler` (a text check: `!/addEventListener\(\s*['"]fetch/`)
  - `_headers serves /sw.js with no-cache`
  - `the cloudflare_worker header-sync test still passes`

- [ ] **Step 2: Run the tests and confirm they fail.** Then implement. Then run them again and confirm they pass.

- [ ] **Step 3: Commit.** Message: `feat(app): installable CRM manifest and push-only service worker`.

### Task 8: Turning reminders on for a device (banner, iPhone steps, sign-out cleanup)

**Files:**
- Create:
  - `src/lib/push/pushSupport.ts`
  - `src/components/attendance/ReminderBanner.tsx`
- Modify:
  - `src/lib/attendance.ts` (`attendanceApi` gains the calls below)
  - `src/components/layout/shell.tsx` (renders `<ReminderBanner/>` for staff who are not the Super Admin)
  - `src/context/AuthContext.tsx` (before each `auth.signOut()` at :146, :219 and :274, `await unsubscribeThisDevice()` with a 2-second timeout, ignoring errors)
  - `src/components/issues/issueEvents.ts` (`entityType === 'attendance'` opens the Attendance page, "My attendance" tab)
- Test: `supabase/tests/ui_reminders.test.mjs` with stubs in `supabase/tests/ui/` (add it to the UI list in `run-unit.sh`)

**Interfaces:**
- `export type PushState = 'unsupported' | 'ios-needs-install' | 'blocked' | 'off' | 'on'`
- `export function detectPushState(env = { navigator, window, Notification: globalThis.Notification }): Promise<PushState>`:
  - On iOS (`/iPhone|iPad/` or Mac with touch), if not in standalone mode (`matchMedia('(display-mode: standalone)')` or `navigator.standalone`), the state is `ios-needs-install`.
  - With no `PushManager` or no `serviceWorker`, it is `unsupported`.
  - With `Notification.permission === 'denied'`, it is `blocked`.
  - With an existing subscription, it is `on`.
  - Otherwise it is `off`.
- `export async function subscribeThisDevice(): Promise<void>`:
  - It gets the public key with `attendanceApi.pushKey()`. If the key is null it throws `Reminders are not set up yet. Ask your administrator.`
  - It requests permission.
  - It calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, then `attendanceApi.saveDevice(sub, deviceLabel())`.
- `export async function unsubscribeThisDevice(): Promise<void>`
- New `attendanceApi` calls:
  - `pushKey()`
  - `saveDevice(sub: PushSubscriptionJSON, label: string)`: the RPC `push_subscription_save`
  - `removeDevice(endpoint)`
  - `removeDeviceById(id)`
  - `devices()`: `my_push_devices`
  - `testPush()`: `POST /attendance/push-test`
  - `reminderSettings()`
  - `saveMyReminders(...)`
  - `saveCompanyReminders(...)`
  - `pauseToday(paused)`
- Install prompt: keep the `beforeinstallprompt` event. An **Install app** button appears only when that event was captured.
- Banner copy and behaviour:

| State | Banner |
|---|---|
| `off` | "Get Punch In, lunch and Punch Out reminders on this device." Buttons: **Turn on reminders**, **Not now** |
| `ios-needs-install` | "To get reminders on iPhone: tap Share, then Add to Home Screen, then open Amuwa CRM from your Home Screen." Button: **Not now** |
| `blocked` | "Notifications are blocked for this site. Allow them in your browser's site settings, then reload." Button: **Not now** |
| `on` or `unsupported` | No banner |

- **Not now** stores `localStorage['att-reminder-banner-hidden'] = office date` and hides the banner until the next office day.

- [ ] **Step 1: Write the failing UI tests.** Use Playwright with stubs, following `ui_attendance.test.mjs`.
  - `off: banner shows Turn on reminders; clicking it requests permission and saves the device` (stub `PushManager` and the RPC)
  - `iPhone Safari not installed: shows the Add to Home Screen steps and no Turn on button` (Review Focus 5; use the iPhone user agent and no `PushManager`)
  - `blocked: shows the site-settings help`
  - `Not now hides it for today and it returns the next day`
  - `no VAPID key: shows "Reminders are not set up yet" and does not throw`
  - `sign-out calls push_subscription_remove for this device`
  - `clicking an ATTENDANCE_REMINDER bell item opens My attendance`

- [ ] **Step 2: Run the tests and confirm they fail.** Then implement. Then run them again and confirm they pass.

- [ ] **Step 3: Commit.** Message: `feat(attendance): reminders opt-in banner and sign-out device cleanup`.

### Task 9: The Reminders section (personal times, devices, HR defaults)

**Files:**
- Create: `src/components/attendance/RemindersPanel.tsx`
- Modify:
  - `src/components/attendance/AttendancePage.tsx`: add a tab `{ id: 'reminders', label: 'Reminders' }` for everyone except the Super Admin. HR, including the Super Admin, also gets the company defaults inside it, so the Super Admin sees a tab that shows only the defaults.
  - `docs/ATTENDANCE_PUNCH.md`, and the HR docs-site page: a "Reminders and the app" section with the iPhone steps
- Test: extend `supabase/tests/ui_reminders.test.mjs`

**Interfaces:**
- Consumes the `attendanceApi` calls from Task 8.
- The panel has three sections:
  1. **My reminder times:**
     - three `<input type="time">` fields with the company default as the placeholder and a "Use company time" reset;
     - an on/off switch;
     - **Save**;
     - server error text is shown inline.
  2. **This device and my devices:**
     - the `PushState` with the matching action (the same as the banner, without Not now);
     - a list of devices with the label, the date added and the last delivery;
     - **Remove** on each device;
     - **Send test notification**, which shows "Sent to N devices".
  3. **Company defaults**, shown only when `canManage`:
     - the three times, the follow-up minutes (5–60), the warning minutes (2–15), and Monday–Sunday checkboxes;
     - the master switch;
     - **Save**;
     - a "Turn off reminders for today" toggle.

- [ ] **Step 1: Write the failing UI tests.**
  - `staff see 10:00 / 14:00 / 19:00 placeholders and save a personal 09:30`
  - `an out-of-range time shows the server message inline`
  - `devices list shows two devices; Remove deletes one`
  - `Send test notification shows "Sent to 2 devices"`
  - `team member does not see Company defaults; HR does and can save`
  - `Super Admin sees only Company defaults`

- [ ] **Step 2: Run the tests and confirm they fail.** Then implement. Then run them again and confirm they pass.

- [ ] **Step 3: Run the full verification:**
  - the SQL, unit and UI suites, and the API suite (the resubscribe route)
  - `npm run typecheck`, `npm run build`, and the docs check
  - in a Playwright Chromium run against `vite preview`: the manifest is detected (`navigator.serviceWorker.ready` resolves and `getManifest` works)

- [ ] **Step 4: Commit, push and open the PR.** Message: `feat(attendance): Reminders section with personal times, devices and HR defaults`.
  - The PR lists the resubscribe migration from Task 7.
  - It includes the note on telling iPhone users to install.
