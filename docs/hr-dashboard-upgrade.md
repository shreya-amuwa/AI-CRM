# HR dashboard upgrade: confirmation reviews, attendance statement, Telecaller performance, internship reviews

Branch: `claude/hr-dashboard-upgrade`.

Every change extends the existing modules. No second employee, attendance, meeting, call or e-mail system is created.

## Phase 0: what exists today (audit)

| Area | What is there | Where |
| --- | --- | --- |
| Employees | CRM accounts in `profiles`, with role, department, team, `position`, `sales_sub_role` and `hr_sub_role`. HR records live in `hr_employees`, whose `status` is one of `Full-Time`, `Training / Probation`, `Intern` or `Left`. Add-Member details live in `employee_personal_details`, which holds the joining date and date of birth. The single merged view is `private.hr_mail_employees()`. | `20261006000000`, `20261107000100` |
| Probation / confirmation | `hr_probation_cycles` holds one cycle per (employee, joining date). The end date is 6 calendar months from joining. Statuses: PENDING → CONFIRMING (Confirm pressed, e-mail queued) → APPROVED (the confirmation e-mail was sent), plus DISMISSED. The approval page is **Probation Confirmations**. The deciders are the HR head or team head, the employee's Department Head, Department HR or the Super Admin. | `20261107000100`, `20270223000100` |
| Reminder e-mails | `hr_email_events` is the queue. It uses unique event keys, statuses, retries, leases and dry-run / test-recipient modes. `public.hr_schedule_emails()` is the daily planner, and `server/automations/hrDispatcher.ts` sends through the shared provider. Today's reminders: the employee and HR at T-7, then weekly overdue reminders to HR. | `20261115000100`, `server/automations/hrTemplates.ts` |
| Scheduler | `/api/v1/internal/automations/dispatch` runs from Vercel Cron at 09:00 IST (`30 3 * * *`), with a retry pass at 10:30 IST (`0 5 * * *`). pg_cron every 15 minutes is optional. | `vercel.json`, `AutomationService` |
| Paid leave | Credits 2 days a month after an **APPROVED** probation cycle (`effective_date`). It is switched off by policy until HR enables it. | `20261231000200` |
| Internships | No review workflow exists. Interns are `hr_employees.status = 'Intern'` and get no probation cycle. | — |
| Attendance | `attendance_records` holds one row per person and day, with the effective `punch_in_at` / `punch_out_at`. `attendance_events` holds the punch events, `attendance_lunches` the breaks (several per day) and `attendance_correction_requests` the corrections. `biometric_login_at` exists but is never filled. | `20261027000100`, `20261230000400…0700`, `20270205000200` |
| Status rules | `private.attendance_team_rows(date)` gives one status per person: SHIFT_COMPLETED, ON_BREAK, HALF_DAY, LATE (after 10:30), PRESENT, APPROVED_LEAVE, WEEKLY_OFF, HOLIDAY, SHIFT_NOT_STARTED, NOT_PUNCHED_IN or ABSENT. Working days come from `attendance_settings.reminder_days`. Start and end times come from `private.reminder_times`. | `20270212000100` |
| Leave | `leave_requests` holds FULL_DAY or HALF_DAY (MORNING/AFTERNOON) leave and goes through a Department Head → HR chain. Only APPROVED leave counts. | `20261027000100`, `20261225000200` |
| Holidays | **There is no holiday calendar.** The only switch is HR's single "off today" date (`attendance_settings.reminders_paused_on`). | — |
| Shifts | One office day in India time per person, with individual start and end times. **Overnight shifts are not supported** (as documented in ATTENDANCE_MANAGEMENT.md). | — |
| Attendance reports | HR's register and Team attendance cover a **single date** (`attendance_team_overview`). There are no range filters and no export. | `AttendancePage` |
| Excel / CSV | `src/lib/xlsxWriter.ts` writes a single sheet of text cells. `toCsv` and `saveBlob` exist. | — |
| Crocodial | `crocodial_ext_calls` is keyed by (connection, external id), so one provider call is one row. It holds `called_by_ext`, `call_type` (outgoing, incoming, missed, …), `duration_seconds`, `connected` and `call_at`. The caller at the time of the call is `private.croc_person_at` (approved mappings, never names). `crocodial_sync_state` tracks each resource's last complete read. Call dispositions are on leads, not calls, and calls have no campaign. | `20270115…`, `20270304000100` |
| Telecallers | `profiles.sales_sub_role = 'TELECALLER'` (TEAM_MEMBER in Sales). | `20261118000100` |
| Meetings | The `meetings` engine provides kinds, `source_type` / `source_id` mirrors (`private.mtg_mirror`), attendees, `mtg_next_free_slot` (host availability and conflicts), notifications (`mtg_notify_staff`, `notify_once`), Google sync and an e-mail outbox. | `20270101000500`, `20270116000400` |
| Notifications | `private.notify_once(profile, type, title, body, entity, id, data, priority)`, the in-app notification centre, and the AppFeedback toasts and confirmations. | — |
| Hierarchy | A CEO is a DEPARTMENT_HEAD with `is_operations_head`. Scopes use `private.scopes_of` and `private.scope_covers(profile, dept, division)`. Department Head = DEPARTMENT_HEAD of the department. HR staff = `private.is_hr_staff()`. Department HR = `private.department_hr_scope()`. | `DEPARTMENT_SCOPES.md` |

## Problems found

1. The confirmation process is a single "Confirm" click. There are no Department Head, CEO or HR evaluations, no extension, no on-hold and no "not confirmed" outcome.
2. The reminders go out at T-7 to HR only. The Department Head and CEO are never asked for anything.
3. Interns have no review at all.
4. Attendance can only be viewed one day at a time and cannot be exported, so reconciliation with the biometric machine is manual.
5. There are no Telecaller targets and no weekly performance record. Calls exist only as raw Crocodial rows.
6. There is no holiday calendar, so a public holiday shows as an absence.

## Architecture (decisions)

- **One review engine for probation and internship.** `hr_probation_cycles` gains:
  - `cycle_type` (PROBATION | INTERNSHIP);
  - `original_end`;
  - `review_round`;
  - the assigned reviewers (`dh_reviewer_id`, `ceo_reviewer_id`, `hr_reviewer_id`);
  - the decision fields;
  - new final statuses (EXTENDED is a round, not a status; ON_HOLD, NOT_CONFIRMED, COMPLETED, CONVERTED, NOT_CONTINUED).

  The existing unique key (employee, start date) stays, so no second cycle can be opened for the same period.
- **An extension moves the same cycle to the next round.** `review_round + 1` and a new end date. The original end date is kept, the history goes to `hr_review_extensions`, and obsolete queued reminders are marked SKIPPED.
- **Evaluations are stored separately.** `hr_review_evaluations` holds one row per (cycle, round, reviewer role: DH / CEO / HR). Its states are DRAFT, SUBMITTED and RETURNED. Each submission is copied to `hr_review_evaluation_versions`, so revision history is never lost. Assignment changes go to `hr_review_assignments`.
- **Confirming reuses the existing path** (CONFIRMING → e-mail → APPROVED), so paid-leave eligibility and the confirmation e-mails work as before and are never granted twice. Internship outcomes never use APPROVED, so they can never start paid leave.
- **Reminders go through the existing queue** (`hr_email_events`), with new kinds `REVIEW_FIRST` and `REVIEW_SECOND`. The key is `REVIEW_<stage>:<cycle>:<round>:<role>:<recipient>`, which makes duplicates impossible. In-app notifications use `notify_once`.
  - The stage is chosen from the current end date: 5–10 days left → first, 0–4 days left → second. After downtime only the current stage is sent, with the real number of days.
  - The send time is 10:00 IST by default (`crm_settings` key `hr.review_reminder_time`).
- **The attendance day engine** is `private.att_day_rows(from, to, profiles[])`. It is the existing per-day status rule, extended over a date range. It adds holidays, breaks summed per day, net hours and early departure, and it never fabricates a missing punch-out. The statement, summaries, register, export, review summaries and Telecaller working days all use it.
- **The holiday calendar** is `office_holidays`, managed by HR. `private.office_working_day` honours it.
- **Telecaller performance** is calculated from `crocodial_ext_calls`:
  - an eligible call = outgoing, has a provider id, is attributed by `croc_person_at`, and is not a missing-at-source copy;
  - the targets are `telecaller_targets`, with a department / team / employee scope, an effective date and history;
  - `telecaller_weekly_performance` holds one row per (employee, week), PRELIMINARY → FINAL, with an audited recalculation;
  - the review policy is `telecaller_review_policy`, and it is **disabled until management approves the thresholds**.
- **Review meetings** use `meetings` (kind HR_MEETING, `source_type = 'performance_review'`, through `private.mtg_mirror`).
  - When no free slot can be found, a **Pending scheduling** request goes to HR instead of a made-up time.
  - Reports and improvement plans are stored in `performance_review_reports` and `performance_improvement_plans`.

## Roles

| Role | Confirmation / internship reviews | Attendance statement | Telecaller performance |
| --- | --- | --- | --- |
| HR staff (not recruiters) | All cycles. Assign, return, decide (final decision: HR head / team head / Super Admin; Department HR for their department) | All employees, plus export | All, plus targets view, meetings and reports |
| Department Head | Their department's cycles. Submit the DH evaluation | — (existing team attendance) | Their department |
| CEO (Operations Head) | Cycles in their scope. Submit the CEO evaluation | — | Their scope |
| Team Lead | — | — | Their team |
| Telecaller | — | — | Their own figures and meeting invitations |
| Employee | Never sees management reports | — | — |

The database enforces all of this. The screens only follow it.

## Security

- Every function is `security definer` with `search_path=''`. Each table has RLS on and is revoked from anon and authenticated; access goes through the functions only.
- Exports are generated from the same scoped function.
- Each export is audited (who, filters, type, rows) in `attendance_export_log`. No file is stored on the server.
- CSV and Excel cells that start with `= + - @` or a tab are prefixed, to block formula injection.
- Review comments never appear in the employee's notifications.

## Testing

- DB tests: `hr_review_cycles_test.sql`, `attendance_statement_test.sql`, `telecaller_performance_test.sql`.
- API checks for each area.
- Unit tests for the date rules and the export writer.
- A browser test for the new HR pages at desktop and phone width.

## Acceptance criteria

These are the phase requirements of the task. Each is ticked in **Progress** only after it is implemented and tested.

## Risks and open points

- **Holiday calendar:** it is new, and it changes `office_working_day`. A configured holiday stops reminders and stops being counted as an absence.
- **Crocodial data:** call dispositions, campaigns, follow-up calls per Telecaller and quality data are not in the calls the CRM stores, so they are shown as *unavailable*. Calls carry no campaign, so the campaign filter is not offered.
- **Overnight shifts:** not supported by the existing attendance model, and that is unchanged.
- **Biometric reconciliation:** the biometric columns are left blank. `hr_employees.data.biometricId` is read if HR has entered one. Nothing is imported.
- **Automatic review meetings:** off until management approves the thresholds (policy `enabled = false`).

## Progress

(updated at the end of each phase below)
