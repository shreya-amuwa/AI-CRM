# Daily reports: three fields, every department

Migration `supabase/migrations/20270308000100_daily_report_three_fields.sql` (safe to run again).

Every daily report on assigned work has the same three fields. All three are optional, and each has a word limit:

| Field | Max words | Stored in |
| --- | ---: | --- |
| Work Completed | 150 | `work_completed` |
| Work Pending | 100 | `pending_work` |
| Additional Note | 50 | `remarks` |

* **Words, not characters.** A word is a whitespace-separated piece that contains a letter or a digit (`countWords` in `shared/validation.ts`,
  `private.word_count` in the database).
* **Live counters.** Each field shows a live counter, for example `0/150 words`. When a field is over its limit, the counter turns red and says by
  how much, and Submit is disabled.
* **Checked three times.** The shared schema (form and API, 422), the database function (`private.report_word_limits`) and, for AI Studio, a trigger
  on every submission and every Team Lead correction.
* **One component.** `src/components/common/ReportWordFields.tsx` is used by every form below and by the Team Lead's edit form.
* **Workflows unchanged.** Submission, Team Lead approval, Department Head review, notifications and AI Studio's Sent to HR all work as before. The
  reviewer sees the same three fields.
* **Older reports.** Reports made before this migration keep their other fields (progress, reason for delay, challenges, tomorrow's plan, links,
  description). These are shown only when they have text. The word limits apply to them only when they are submitted again.

## The forms

| Form | Who | What changed |
| --- | --- | --- |
| **Task Daily Report** (`TaskReports.tsx`) | Sales, Support, International, Reseller and every department with work tasks | **Removed:** Progress (%) and Reason for delay. **Required:** at least one of the three fields; the 10-character minimum is gone. **Kept:** the task and the date. **Progress:** the report stores the task's own progress, so Performance Management figures still work. The "pending work below 100%" and "reason past the deadline" rules are gone, and an older client that still sends progress is accepted. |
| **AI Studio daily report** (`DailyReportForm.tsx`) | AI Studio Team Members and Team Leads | **Kept:** the picked tasks, whose recorded work is still shown read-only. **Removed:** the *Additional information* section (additional work, challenges, tomorrow's plan, general remarks) and the Daily Work Description (`description_required` now defaults to false). **Still required:** some work: a picked task with work recorded that day, or Work Completed. |
| **AI Design Studio daily report** (`AdsReports.tsx`) | AI Design Studio members and leads | **Removed:** challenges and links. **Required:** at least one of the three fields; Work Completed may now be empty. **Kept:** the client and assignment pickers. |
| **AI Studio one-task report** (`ReportForm`, used only to correct older reports made with it) | AI Studio | Shows the same three fields. The word limits are checked by the API. |

## Database

| Table | Change |
| --- | --- |
| `task_daily_reports` | `work_completed` may be empty (null). New `field_word_limits` column: false for older rows, true from now on. |
| `ai_studio_daily_reports` | New `field_word_limits` column. `description_required` defaults to false. |
| `ads_reports` | `work_completed` may be empty. |

Functions changed: `task_report_submit`, `task_report_reviewer_edit`, `ai_studio_daily_report_save`, the AI Studio report trigger and
`ads_report_submit`. Each is a copy of its latest version, with every change marked `(20270308000100)`.

## Deploying

Run the migration, then deploy the app; the order does not matter much:

* The new app only sends what the old functions also accept, apart from an empty Work Completed.
* Old clients keep working against the new functions.

## Tests

* `supabase/tests/daily_report_fields_test.sql`: the limits; the Task Daily Report (empty refused, one field enough, the task's progress kept, no
  reason for delay, the Team Lead's correction within the limits, approval unchanged); AI Studio (no description needed, limits, a correction
  over a limit refused, approval and Sent to HR unchanged); AI Design Studio.
* `supabase/tests/daily_report_fields.test.ts` (unit).
* The API checks in `api_integration.test.ts`.
* The browser tests `ui_task_reports_performance`, `ui_ai_studio_daily_report` and `ui_ai_studio_hr`.

## One Daily Report form, Work Completed required (migration `20270312000100_daily_report_form.sql`)

This section replaces what the sections above say about the fields being optional.

| Field | Rule | Stored in |
| --- | --- | --- |
| Work Completed | **required**, 10 to 150 words | `work_completed` (the work report: `content.workCompleted`) |
| Work Pending | optional, at most 100 words | `pending_work` (`content.pendingWork`) |
| Additional Note | optional, at most 50 words | `remarks` (`content.remarks`) |

* **Every daily report** uses the same component (`ReportWordFields`), in the same order and with the same rules and messages:
  * the Task Daily Report;
  * the AI Studio daily report (and its older one-task form);
  * the AI Design Studio daily report;
  * **the work report of the Reports menu** (`reports/DailyReportForm.tsx`), which keeps its task lists and replaces the 500-character *Remarks / Work
    Summary* with the three fields.
* **The form**
  * A *Daily Report* heading and a one-line purpose.
  * Each field says whether it is required or optional, with its limit.
  * Field sizes:
    * Work Completed is full width and taller.
    * Work Pending and the Additional Note sit side by side on wide screens and stack on phones.
    * Each grows while you type, up to a limit, then scrolls.
  * Counters under each field (`0 / 150 words`):
    * An over-limit field turns red and says by how much; Submit is disabled.
    * Below the minimum, Work Completed says how many words are still needed, once the field was left or Submit was pressed.
  * Actions sit at the bottom right (Cancel, Save draft where drafts exist, Submit Daily Report); on a phone they stack, with Submit on top.
* **Drafts may be short.** The minimum is checked on submission; the maximums on every save of a work report draft.
* **Checked three times:**
  * the shared schema: `dailyReportProblems`, `reportSubmitProblems` in `shared/validation.ts` (422);
  * the database: `private.report_word_limits` (minimum and maximums) and `private.report_word_max` (maximums);
  * for AI Studio, the report trigger.
  * `private.report_word_limits` is already called by every submission and every reviewer correction, so those functions were not copied again.
  * `private.clean_task_report` and `work_report_submit` (the work report) are copies with the change marked `20270312000100`.
* **Older reports** are unchanged. When one is submitted again, or a reviewer corrects its text, it must follow the rules (for example, add Work
  Completed).
* **Reviewers** see the same three labels: the work report's `ReportContentView` shows Work Completed, Work Pending and Additional Note for reports with
  task lists.

### Deploying

Run `20270312000100_daily_report_form.sql`, then deploy the app.
* Before the migration, the new app still works: the old functions accept what it sends. A work report's Work Completed and Work Pending are then not
  stored.
* After the migration, an old app can no longer submit a report without Work Completed: deploy together.

### Tests

* `supabase/tests/daily_report_form_test.sql`:
  * the rules;
  * the Task Daily Report, including the Team Lead's correction;
  * AI Studio: a short draft, submission, and the trigger;
  * AI Design Studio;
  * the work report: a short draft, submission refused below 10 words, the three fields stored.
* `daily_report_fields.test.ts` (unit).
* The API checks in `api_integration.test.ts`.
* The browser tests:
  * `ui_task_reports_performance`, including the work report form, desktop and phone layout, and growing fields;
  * `ui_ai_studio_daily_report`;
  * `ui_ai_studio_hr`.
