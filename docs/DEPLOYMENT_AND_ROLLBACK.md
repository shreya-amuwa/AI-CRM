# Deployment and rollback

How a change reaches production at crm.amuwacorporation.com, and how to undo it. Platform details (the Cloudflare Worker, secrets,
e-mail providers) are in `DEPLOYMENT_CLOUDFLARE.md`. This page is the checklist for a release such as 1.1.0 (`RELEASE_PLAN.md`).

## 1. How production is updated

| Part | Where | How it changes |
| --- | --- | --- |
| Screens, API, scheduled runs | Cloudflare Worker (Workers Builds, connected to GitHub) | Every merge to `main` builds (`npm run build`) and deploys (`npx wrangler deploy`). A pull request gets a preview version (`wrangler versions upload`) that is not live. |
| Database | Supabase | **By hand:** a migration from `supabase/migrations/` pasted into the SQL editor. Nothing runs migrations automatically. |
| Scheduled jobs | Worker cron (`wrangler.jsonc`: 5-minute reminders, two daily dispatches) | Run only when the Worker variable `SCHEDULED_ENABLED` is `"true"`. |
| Backups | GitHub Action "Database backup", nightly (01:47 IST), encrypted to R2 | Automatic. Can also be run by hand from the Actions tab. |

**Rule:** a database migration must be run **before** (or together with) the code that needs it. Every screen of this release also works
before its migration exists: it falls back or hides the new part. So a merge that goes live first is safe, but the feature is missing
until the migration runs.

## 2. Release checklist

### Before

- [ ] All pull requests of the release are merged. CI on `main` is green (typecheck, build, RLS and API tests, Worker end-to-end).
- [ ] The last nightly backup succeeded (Actions → Database backup), or run it now.
- [ ] Which migrations have run? In the SQL editor, check whether each object below exists (each returns one row with `true` or `false`):

```sql
select to_regclass('public.attendance_correction_requests') is not null as m20270205000200,
       to_regclass('public.meeting_oversight_log') is not null        as m20270208000200,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notification_deliveries'
               and column_name = 'notification_id')                    as m20270208000100,
       (select not early_punch_out_reason_required from public.attendance_settings where id) as m20270209000100;
```

  If `m20270205000200` is false, the last query fails because the column does not exist yet. Run the migrations first, then check again.

### Run the migrations (Supabase → SQL editor)

Paste each file whole and run it, in this order. Each one is safe to run again.

1. `20270205000100_notice_board_delete.sql` (if not already run)
2. `20270205000200_team_attendance_corrections.sql`
3. `20270206000100_hr_offer_templates.sql` (if not already run)
4. `20270207000100_employee_wallet.sql` (if not already run)
5. `20270208000100_meeting_push.sql`
6. `20270208000200_meeting_oversight_notifications.sql`
7. `20270209000100_punch_out_no_reason.sql`

Each ends with `notify pgrst, 'reload schema'`, so the API sees new functions at once.

### Deploy

- Merging to `main` deploys. To deploy by hand from a checkout: `npm ci && npm run cf:deploy` (needs a Cloudflare API token).
- Check that `SCHEDULED_ENABLED` is `"true"` on the Worker. The meeting reminders ride on the 5-minute run.

### After (smoke test, about 15 minutes)

Use the steps in `TESTING_CHECKLIST.md` §2 with test accounts:

- Punch In and Out;
- Team attendance as a Department Head;
- a company notice on a phone;
- a meeting booked by two colleagues, with the Managing Director's awareness notice and push;
- the Client Portal → Client Manual on a phone.

Then watch, for 48 hours:

- **Sentry:** new errors;
- **Attendance → Notification Health:** the scheduled run is "Running";
- **The push outbox:**

```sql
select kind, status, count(*) from public.notification_deliveries where created_at > now() - interval '1 day' group by 1, 2 order by 1, 2;
```

## 3. Rollback

### Code (fast, no data change)

* **Cloudflare dashboard:** Workers & Pages → the CRM Worker → Deployments → choose the previous version → **Rollback**. Or run
  `npx wrangler rollback` from a checkout.
* **Undo a pull request:** revert the merge commit on GitHub, which opens a revert PR. Merging it deploys the previous code.
* **After a code rollback:** the database can stay as it is. The previous code does not use the new tables and functions, and every
  migration of this release is additive.

### Database (only if a migration itself causes harm)

Migrations of this release are additive. Prefer switching a feature off over dropping anything:

| Feature | Switch off (no data lost) |
| --- | --- |
| Participants' meeting pushes | `drop trigger if exists notifications_meeting_push on public.notifications;` (meetings go back to the bell only) |
| The Managing Director's meeting awareness | `update public.meeting_oversight_settings set enabled = false where id;`, or the Meeting notifications card in Attendance → Reminders |
| Phone alerts for that awareness only | `update public.meeting_oversight_settings set push_enabled = false where id;` |
| An early Punch Out reason (to bring the rule back) | `update public.attendance_settings set early_punch_out_reason_required = true where id;` (the screen still does not ask; use `attendance_punch_out_confirmed`) |
| Team attendance / corrections | Nothing to switch off. The screens stay read-only to those outside the scope. A code rollback hides them. |

**Restoring from a backup** is the last resort, because it loses everything written since the backup:

1. Download the latest dump from R2.
2. Decrypt it with the backup key (see the "Database backup" workflow).
3. Restore it into a **new** Supabase project first and check it.
4. Switch over only with the owner's approval.

### Who decides

The owner approves a release and any rollback that restores data. A code rollback (Cloudflare "Rollback") may be done by whoever is on
duty if production is broken, and must be reported to the owner at once.
