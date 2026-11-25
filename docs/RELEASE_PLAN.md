# Release plan: 1.1.0 (management, attendance, notifications, mobile)

The plan for the "AI-CRM Management, Attendance, Notifications & Mobile-First UI Upgrade" (Tasks 01-08): what was audited, how the work
was split, how it is released, and what is still open. Changes per item are in `CHANGELOG.md`.

## 1. Repository audit (summary)

| Area | What exists | Finding that shaped the plan |
| --- | --- | --- |
| Stack | React + Vite + Tailwind (`src/`). Hono API (route → controller → service → repository → database function). Supabase Postgres with RLS and `security definer` functions. Hosted on Cloudflare Workers. | Business rules and permission checks belong in database functions; the screens only call them. |
| Roles | Keys `SUPER_ADMIN`, `DEPARTMENT_HEAD` + `is_operations_head`, `TEAM_HEAD`, `TEAM_MEMBER`, HR, Accounts, clients. Labels were spread over many screens. | Renaming the role keys would touch every permission. One display mapping (`shared/roleNames.ts`) instead. |
| Attendance | Punch In / Out, lunch, location rules, reminders, `attendance_settings`, approved leave from `leave_requests`. No shift model, no holiday table. | Day start and end come from `private.reminder_times`. A paused reminder day counts as the holiday. Overnight shifts are not supported (documented). |
| Notifications | `private.notify` → the bell. A push outbox (`notification_deliveries`) for attendance and company notices only. VAPID push and `public/sw.js`. | Meeting notices never reached a phone. The Managing Director's dashboard hid the "Turn on notifications" banner. |
| Notices | `NoticePopupHost`: a queue of unacknowledged notices, shown in a regular modal. | On phones the modal took almost the whole screen. |
| Mobile | 49 browser tests (Playwright) with real screens and stand-in data. | The tests could be reused to measure every screen at 9 widths. |
| Portals | Client Portal in `src/client`. The Candidate Portal is no longer in this repository (`/candidate` and `/careers` redirect). | The Candidate Portal is audited in its own repository. |
| Releases | `package.json` 1.0.0, no tags, no changelog. Cloudflare Workers Builds deploy `main`. | Every merge to `main` reaches production, so migrations must be run first and code must work before they are. |

## 2. How the work was split

One task, one branch, one pull request (`AGENTS.md`). Each one is small enough to review and works on its own.

| Task | Pull request | Status |
| --- | --- | --- |
| 06: Role names (Managing Director, CEO) | #288 | Completed (merged) |
| 01 + 02: Team attendance, safe punch, corrections | #290 | Completed (merged) |
| 05: Meeting notifications, push, Managing Director awareness | #292 | Completed (merged) |
| 03 + 04: Notice popup redesign, mobile audit and fixes | #294 | Completed (merged) |
| Owner feedback: Punch Out without a reason; the "Something went wrong" flash | #296 | In Review |
| 07 + 08: Release documentation | #295 | In Review |

"Completed" means implemented, tested by the automated suites, merged, and documented. **Testing on real devices by the owner is still
open for every task** (`TESTING_CHECKLIST.md`).

## 3. Versioning

* **Recommendation: 1.1.0** (minor). Everything is additive:
  * no role key, API contract or column meaning changed;
  * nothing was removed;
  * every migration can be run on the live database without manual steps.
* At release (after approval):
  1. set `package.json` to `1.1.0`;
  2. move `[Unreleased]` in `CHANGELOG.md` to `[1.1.0] - <date>`;
  3. tag the merge commit `v1.1.0`.
* Later fixes are 1.1.1, 1.1.2, …; the next feature set is 1.2.0.
* **No release is published and no tag is created without the owner's approval.**

## 4. Release steps

See `DEPLOYMENT_AND_ROLLBACK.md` for the commands.

1. **Freeze:** no new merges to `main` except fixes for this release.
2. **Backup:** check that the nightly database backup (GitHub Action "Database backup") succeeded in the last 24 hours, or run it by hand.
3. **Migrations:** run the migrations that have not been run, in timestamp order, in the Supabase SQL editor. Each one is safe to run twice.
4. **Deploy:**
   * Cloudflare deploys `main` automatically after the merge.
   * If the code was merged before the migrations were run, it still works: every screen falls back until its migration exists.
5. **Smoke test** in production with test accounts (`TESTING_CHECKLIST.md` §2):
   * Punch In / Out;
   * Team attendance;
   * a notice;
   * a meeting booking and its push;
   * the Client Portal on a phone.
6. **Announce** to staff:
   * the new role names;
   * the Punch Out confirmation;
   * "turn on notifications" for the Managing Director and managers.
7. **Watch for 48 hours:**
   * error reporting (Sentry);
   * Notification Health;
   * the push outbox (`notification_deliveries` with status `FAILED`).
8. **After approval:** tag `v1.1.0` and update the version.

## 5. Open items (not in 1.1.0)

| Item | Why open | Next step |
| --- | --- | --- |
| Real-device push testing (Android Chrome, iPhone Home Screen app) | Cannot be automated here | Owner checklist in `TESTING_CHECKLIST.md` §3 |
| Visual style debt: ~112 gradients, 83 `backdrop-blur`, 198 `rounded-3xl`, mostly in `src/components/departments/*` | One large PR would conflict with every open branch | One small PR per department area |
| Older department panels and finance screens have no browser tests, so the mobile audit cannot reach them | No test harness | Check by hand at 320 / 390 / 768. Add harnesses over time |
| Candidate Portal mobile audit | Not in this repository | Audit in the careers repository |
| Shifts and holidays | No shift model (one company day per person) and no holiday calendar | A shift / holiday feature if the business needs overnight shifts |
| `ui_hr_awards` browser test is occasionally flaky (a strict-mode race in the test itself) | Not part of these tasks | A small test fix in the HR awards area |
| The CEO availability API test failed between about 05:20 and 06:20 UTC (a booking clash with fixed 06:00 UTC slots) | Found while testing | Fixed in #296 |
