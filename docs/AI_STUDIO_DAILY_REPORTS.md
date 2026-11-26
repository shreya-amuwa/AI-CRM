# AI Studio: one daily report built from the tasks

Migration `20270219000100_ai_studio_consolidated_reports.sql`. Screens: `src/components/ai-studio/DailyReportForm.tsx`, `ReportWork.tsx`,
`TaskReportsPanel.tsx`, `AiStudioReports.tsx`.

An employee writes **one report per day**. They pick the tasks they worked on, from any of their projects. The report then shows what is
already recorded on those tasks for that date: completion details, work updates, progress and links. The employee only types what is not in
the tasks.

## What was there before (audit)

| Area | Before | Now |
|---|---|---|
| Task history `ai_studio_task_updates` | One row per assignment, progress update or edit. Never changed in practice, but nothing enforced it. | Write-once: a trigger refuses any `UPDATE`. A submitted report points at these rows. |
| Completion details | `tasks.completion_note`, and the same text as the note of the COMPLETED history entry. | Read from the history entry (once). Never copied. |
| "Attachments" | Up to 5 **web links** on the task (`tasks.attachments`). Each update replaced the list. No files are uploaded anywhere in AI Studio. | The task's list is recorded on a history entry **when it changes** (`task_updates.links`). A report shows the links of its day. |
| Daily report | One per person, date, **project and task**. "Work completed" was typed and required. | One per person and day, any number of tasks (max 30). The typed text is optional when the tasks carry the work. |
| Department Head | List by project, task, status, date and person. | Adds counts (projects, tasks, completed, cross-team), a blockers flag, and filters for blockers and cross-team. The report opens project by project. |

There are no stored files in AI Studio, so there is no file object to duplicate, sign or retain. The link rules below apply instead. If file
uploads are added later, they belong on the task update (one stored object), and a report keeps referencing the update.

## Data (references only)

```
ai_studio_daily_reports        report_date, status, review, revision; the person's ADDITIONAL text only:
                               work_completed, pending_work, blockers, tomorrow_plan, remarks
                               (project_id and task_id are null for these reports)
  └ ai_studio_report_tasks          (report_id, task_id, position)      the tasks picked
      └ ai_studio_report_task_updates  (report_id, task_id, update_id)  the history entries, fixed on submit
            └ ai_studio_task_updates   note, status, progress, links, created_at   (write-once: single source of truth)
```

* **Foreign keys.** `(report_id, task_id)` must be one of the report's tasks. `(update_id, task_id)` must be an entry of **that** task (a
  composite key on the history), so the database itself refuses a reference to another task's entry.
* **Uniqueness.** One consolidated report per person and day. A task appears once per report, and a history entry once per report.
* **Kind.** A report cannot change between one-task and consolidated (trigger).
* **What a report adds:**
  * 1 report row, holding only the typed text;
  * 1 small row per task;
  * 1 small row per referenced entry (3 uuids).
  It adds no history entry, changes no task, and copies no text or link. A link list is stored only when it changes on the task.

## How a report is built (`private.ai_studio_report_work`, one query for all tasks)

**For a draft or a returned report:** the author's own progress entries on each picked task whose date in India time (`Asia/Kolkata`) is the
report date, up to now, in order (`seq`).

**For a submitted report:** exactly the entries in `ai_studio_report_task_updates`.

**For each task it returns:**
* the day's entries;
* the state the day ended with (status, progress);
* progress before the day;
* the completion time, if completed that day;
* the links in effect at the day's last entry;
* "cross-team" (given by a Team Lead who is not the person's own);
* the task's current state (so a reviewer can see "Now 100% (after this report)").

A task with no entry that day returns `noUpdate`. The form then says *"No work update has been recorded for this task on the selected
reporting date."* and offers **Open task**. Nothing older is shown as new work.

**Tasks offered for a date** (`ai_studio_daily_report_options`): my tasks that were given by that date and not completed before it. This covers
open tasks, tasks worked on that day, and tasks completed that day. A task completed at 12:13 can still be picked at 18:30.

## Submitting (`ai_studio_daily_report_save`)

**1. Checks the database makes**
* the role: an AI Studio Team Member or Team Lead;
* the date: not in the future, at most 60 days back;
* every task: mine, and open on that date;
* at most 30 tasks;
* text: at most 4000 characters per part;
* to submit: a recorded entry that day, **or** "additional work" text.

**2. What the form sends**
* The form sends `expectedUpdateIds`, the entries the person saw.
* If the tasks changed since then, nothing is submitted (`409`). The form refreshes the preview, keeps what was typed, and the person
  confirms again.

**3. One transaction**
* save the report and its tasks;
* fix the entries;
* route it as before: Team Member → their Team Lead → Department Head, or straight to the Department Head when there is no Team Lead or it
  is a Team Lead's own report;
* record the history event and the audit entry (with the task and update ids);
* notify.

**4. Repeated clicks**
* A second "new report" for the day is refused (`409`, and a unique index).
* Submitting a submitted report is refused, so a double click sends one report and one notification.

**5. Returned reports**
* Edit and resubmit as before (`revision + 1`). The entries are fixed again at resubmission.
* The approval history keeps every round, and the audit log keeps the ids of each submission.

**6. The confirmation**
The in-app dialog shows, for example: "Submit Daily Report? 3 projects · 5 tasks · 4 recorded work updates · 3 submitted links". Its buttons
are **Review report** and **Confirm submission**. No browser `confirm()` is used.

## Historical accuracy

A submitted report references history entries. History entries cannot be changed, so the report keeps showing the progress, notes and links
of its day even after the task moves on. For example, a report submitted at 60% still shows 60% after the task reaches 100%; the reviewer
also sees "Now 100% (after this report)".

The task's **title, description and deadline** are read live. A later rename shows the new title in old reports. These are task metadata,
not work done that day.

## Who sees what (unchanged rules, enforced by the database)

| Person | Sees |
|---|---|
| The author | their own reports, drafts included; only their own tasks can be picked or previewed |
| Their Team Lead | their Team Members' submitted reports, in full, and reviews them; may correct the typed text (`ai_studio_report_lead_edit`). For a consolidated report "work completed" may stay empty. |
| A Team Lead who gave a cross-team task | **only that task's part** of a report, in the task window ("Reported in daily reports", `ai_studio_task_reports`). The full report is `NOT_FOUND` for them. |
| Department Head / Super Admin | every submitted report |
| Anyone else | nothing (`NOT_FOUND` / `FORBIDDEN`) |

* A reviewer reads the task work **through the report**: the report function is security definer and checks the report's own rules. A report
  reference does not open any other data of the task or project.
* Links are http(s) only: the database checks them when they are saved, and the screen checks again before a link becomes clickable. They
  open in a new tab with `rel="noopener noreferrer nofollow"`. Nothing is fetched from them.

## API (`/api/v1/ai-studio/...`)

| Method and path | Body / query | Function |
|---|---|---|
| `GET daily-reports/options` | `?date=YYYY-MM-DD` | `ai_studio_daily_report_options` |
| `POST daily-reports/preview` | `{ reportDate, taskIds }` | `ai_studio_daily_report_preview` |
| `POST daily-reports` | `{ reportDate, taskIds, workCompleted?, pendingWork?, blockers?, tomorrowPlan?, remarks?, submit, expectedUpdateIds? }` (strict: no task text, links or files) | `ai_studio_daily_report_save` |
| `PATCH daily-reports/:id` | same | `ai_studio_daily_report_save` |
| `GET tasks/:id/reports` | | `ai_studio_task_reports` |
| `GET reports` | adds `blockers=true\|false` and `crossTeam=true\|false` | `ai_studio_reports_page` |

The older `ai_studio_reports_list` and `/reports` (one-task) endpoints still work.

## Performance

* One query builds the work of all the tasks in a report, with no per-task requests.
* Lookups use these indexes:
  * history by task and time (existing);
  * history by author and time for progress entries (new);
  * report tasks by task;
  * report entries by entry.
* The preview is debounced (250 ms), and an older answer never replaces a newer one.
* Nothing is downloaded: links are only shown.

## Tests

* `supabase/tests/ai_studio_daily_reports_test.sql` (50 checks) covers:
  * which tasks are offered for a date;
  * completion details exactly as written;
  * multiple projects in one report;
  * updates of a date only (later work excluded);
  * several updates in one day, in order;
  * a task with no update that day;
  * draft and submit;
  * the "tasks changed" refusal;
  * duplicate submission;
  * references only (no history entry added, no task changed, no text copied);
  * the composite key refusing another task's entry;
  * historical stability after the task reaches 100%;
  * link snapshots;
  * the reviewer, the other Team Lead (task part only), another member;
  * Department Head filters (blockers, cross-team, project through tasks);
  * the two-step approval;
  * no specific task;
  * returned and resubmitted.
* The API integration tests (in `api_integration.test.ts`) cover:
  * the endpoints;
  * the strict body, which refuses task text;
  * the 409 cases;
  * access.
* `supabase/tests/ui_ai_studio_daily_report.test.mjs` (78 browser checks, at 1280, 390 and 320 px) covers:
  * grouping and search;
  * read-only fetched work;
  * exact completion details;
  * safe links;
  * "Open task";
  * only new remarks typed;
  * the in-app confirmation and "Review report";
  * the refresh on a 409;
  * the request carrying ids only;
  * the Department Head's view;
  * no sideways scrolling;
  * no browser dialogs.

## Deploying and rolling back

**Deploying**
1. Run `20270219000100_ai_studio_consolidated_reports.sql` in the Supabase SQL editor. It is additive and safe to run twice.
2. Deploy the app. The Submit Daily Report tab uses the new form. Older reports open in the old form.

**Rolling back the app**
* Redeploy the previous build.
* The old one-task form still works on the new database.
* Consolidated reports already made remain in the database, but the old screens cannot open them.

**Rolling back the database** (only if no consolidated report needs to be kept):

```sql
drop function if exists public.ai_studio_task_reports(uuid), public.ai_studio_daily_report_save(uuid, date, uuid[], text, text, text, text, text, boolean, uuid[]),
  public.ai_studio_daily_report_preview(date, uuid[]), public.ai_studio_daily_report_options(date),
  public.ai_studio_reports_page(text, uuid, text, uuid, uuid, date, date, integer, integer, boolean, boolean);
delete from public.ai_studio_daily_reports where project_id is null;
drop table if exists public.ai_studio_report_task_updates, public.ai_studio_report_tasks;
drop trigger if exists ai_studio_task_updates_immutable on public.ai_studio_task_updates;
drop trigger if exists ai_studio_task_updates_links on public.ai_studio_task_updates;
drop trigger if exists ai_studio_daily_reports_kind on public.ai_studio_daily_reports;
```

Then re-run the earlier versions of the redefined functions:
* `ai_studio_reports_list`, `ai_studio_report_row` and `ai_studio_report_detail`, from `20270105000100` and `20270214000100`;
* `ai_studio_report_lead_edit`, from `20270214000100`.

The `links` and `tomorrow_plan` columns can stay; they are unused by the old code.

## Known limits

* **Performance Management** counts an employee's reports per task through the older reports' `task_id`
  (`performance_member_work`). Consolidated reports are not counted there yet.
* **Older history entries** have no link list. Only each task's latest entry was filled with the task's current links, which were true at
  that entry. Earlier link lists were never recorded, so they cannot be shown.
* **Working hours** are not recorded anywhere in AI Studio, so the report shows none. Progress or task counts are not hours.
* **Task metadata** (title, description, deadline) is read live, not as it was on the day.
