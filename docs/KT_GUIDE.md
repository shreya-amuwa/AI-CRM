# Knowledge transfer guide

For a developer (or an AI coding agent) taking over the CRM: where things are, how a request flows, how to change something safely, and
where the 1.1.0 features live. Read `AGENTS.md` first: it has the rules every change follows.

## 1. The system in one page

| Layer | Where | Notes |
| --- | --- | --- |
| Screens | `src/` (React + Vite + Tailwind) | Staff dashboards in `src/components/*`. The Client Portal in `src/client/*` (own CSS, `.cd-*` classes) |
| API | `server/` (Hono) | `server/routes.ts` → `server/controllers/index.ts` → `server/services/*` (Zod validation from `shared/validation.ts`) → `server/repositories/*` → a database function |
| Shared shapes | `shared/contracts.ts`, `shared/validation.ts` | One type and one Zod schema per payload, used by the form and the server |
| Database | `supabase/migrations/*.sql` (Supabase Postgres) | RLS on. Access through `security definer` functions with `set search_path = ''` that check the caller (`private.*` helpers). Errors start with `FORBIDDEN:`, `VALIDATION_ERROR:`, `NOT_FOUND:` or `CONFLICT:` |
| Hosting | Cloudflare Worker (`worker/`, `wrangler.jsonc`) | Serves the built app and the API, and runs the cron jobs |
| Push | `public/sw.js`, `server/automations/notificationDelivery.ts`, `notification_deliveries` | VAPID Web Push through an outbox (`NOTIFICATION_ARCHITECTURE.md`) |
| Tests | `supabase/tests/` | `run.sh` (SQL), `run-unit.sh` (unit and browser), `run-api.sh` (HTTP end to end) |

Some screens (attendance, notices) call Supabase functions directly from the browser (`src/lib/attendance.ts`, `rpc()`). The database
function is still the security check.

## 2. How to make a change

1. Branch from the latest `main`: `claude/<name>` or `codex/<name>`. Never commit to `main`.
2. Read the area first:
   * the screen, the route, the service, the repository;
   * the database function (`grep` it in `supabase/migrations/`; the latest definition wins);
   * its tests and its `docs/*.md`.
3. Database change: write a **new** migration named with a timestamp after the latest on `main`. It must be safe to run twice and must
   not use temporary tables. Never edit a migration that is on `main`.
4. Add tests: SQL for permissions and rules, a browser test for a screen.
5. Run every check (`TESTING_CHECKLIST.md` §1), merge `origin/main` (a merge, not a rebase), then push and open a PR that lists the
   migrations to run.

**Common traps:**

* **Two branches pick the same migration timestamp.** Rename yours to a later one before merging; this happened twice in 1.1.0.
* **Merge conflicts in shared files** (`run.sh`, `run-unit.sh`, `shared/*.ts`): keep both sides.
* **A stale build:** browser tests read `dist/assets`, so run `npm run build` first.
* **A frontend label change:** every browser test that reads that text must be updated.

## 3. Where the 1.1.0 features live

### Role names (Task 06)

- **Mapping:** `shared/roleNames.ts`:
  - `ROLE_DISPLAY_NAMES`;
  - `relabelRoles()`, a one-pass text relabel of legacy wording;
  - `designationLabel()`.
- **Relabel points:** `AppError.toBody` (`server/http/errors.ts`), `errorMessage` (`src/lib/api/client.ts`), notification titles and
  bodies (`NotificationContext`), meeting labels.
- **Keys unchanged:** `SUPER_ADMIN` and `is_operations_head` are not changed anywhere. SQL text still says "Super Admin" and is
  relabelled on the way out.
- More: `ROLE_AND_PERMISSION_MATRIX.md`.

### Attendance (Tasks 01, 02)

- **Database** (`20270205000200_team_attendance_corrections.sql`):
  - `attendance_team_overview`;
  - `attendance_punch_out_preview`;
  - the correction functions;
  - the `private.attendance_*` helpers (scope, status, approver).
- **Screens:**
  - `src/components/attendance/AttendancePage.tsx` (My attendance, the punch dialogs, tabs);
  - `TeamAttendance.tsx`;
  - `AttendanceCorrections.tsx`;
  - `src/components/common/BottomSheet.tsx`.
- **Punch Out** asks for no reason (`20270210000100`). The screen calls `attendance_punch_out`.
- More: `ATTENDANCE_MANAGEMENT.md`.

### Notifications (Task 05)

- **Participants:** `20270208000100_meeting_push.sql`. A trigger on `notifications` queues meeting pushes, and reminders are created by
  `mtg_enqueue_reminders`, called through `runMeetingsDispatch({ remindersOnly: true })` on the 5-minute run (`server/app.ts`).
- **Managing Director awareness:** `20270208000200_meeting_oversight_notifications.sql`:
  - a deferred trigger on `meetings`;
  - `mtg_oversight_run` on the 5-minute run (`server/automations/attendanceReminders.ts`, `runScheduledNotifications`);
  - settings through `mtg_oversight_settings_get` / `_set`.
- **On the device:** `public/sw.js` opens `/?open=meeting&id=…` (participants) or `/?open=meeting-report&id=…` (the Managing Director's
  read-only report). The app side is in `src/components/meetings/meetingEvents.ts` and `src/components/attendance/StaffReminders.tsx`.
- More: `NOTIFICATION_ARCHITECTURE.md` and `NOTIFICATION_RELIABILITY.md`.

### Notices and mobile (Tasks 03, 04)

- **Popup:** `src/components/notices/NoticePopupViewer.tsx` (the sheet) and `NoticePopupHost.tsx` (the queue, and waiting while
  another dialog is open).
- **Mobile audit:** `scripts/mobile-audit/` (`hook.mjs`, `run.mjs`).
- **Rules:** `MOBILE_UI_GUIDELINES.md`.

### The "Something went wrong" flash

- **Code:** `src/lib/chunkReload.ts` and `src/components/common/ErrorBoundary.tsx`.
- More: `ERROR_MONITORING.md`, "The Something went wrong flash after a deployment".

## 4. Running it locally

```bash
npm ci
npm run dev                      # Vite with the API inside it, http://localhost:3000
npm run build && npx wrangler dev   # the real Worker, http://localhost:8787 (local secrets in .dev.vars, never committed)
```

- **Database tests** need a local PostgreSQL: `PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=… npm run test:db`.
- **API tests** also need PostgREST (`POSTGREST_BIN`, see `supabase/tests/run-api.sh`).

## 5. Operations

| Task | Where |
| --- | --- |
| Run a migration | Supabase → SQL editor (`DEPLOYMENT_AND_ROLLBACK.md`) |
| Roll back the code | Cloudflare → Deployments → Rollback |
| Turn scheduled jobs on or off | Worker variable `SCHEDULED_ENABLED` |
| Push health | Attendance → Notification Health. The `notification_deliveries` table |
| Errors | Sentry (`ERROR_MONITORING.md`) |
| Backups | GitHub Actions → Database backup (nightly, encrypted, R2) |
| Company settings (attendance) | `public.attendance_settings` (one row) |
| The Managing Director's meeting notices | Attendance → Reminders → Meeting notifications, or `public.meeting_oversight_settings` |

## 6. Documents to read next

`ARCHITECTURE.md`, `BACKEND.md`, `ROLE_AND_PERMISSION_MATRIX.md`, `ATTENDANCE_MANAGEMENT.md`, `NOTIFICATION_ARCHITECTURE.md`,
`MOBILE_UI_GUIDELINES.md`, `RELEASE_PLAN.md`, `DEPLOYMENT_AND_ROLLBACK.md`, `TESTING_CHECKLIST.md`, `CHANGELOG.md`.
