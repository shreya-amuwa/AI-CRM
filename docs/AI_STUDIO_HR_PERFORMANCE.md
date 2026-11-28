# AI Studio: daily report approval to HR, and HR's AI Studio Performance

Migration `supabase/migrations/20270302000100_ai_studio_hr_performance.sql` (additive, safe to run twice).

This builds on the existing AI Studio daily report (`docs/AI_STUDIO_DAILY_REPORTS.md`): one report per person and day, built from the tasks,
reviewed Team Member → their Team Lead → Department Head. Nothing was duplicated: the same tables, review function, history and Performance
Management are used.

## The flow

1. **The Team Member submits** (AI Studio > Daily Report > Submit Daily Report).
   * They pick the tasks they worked on. Each task carries its project and title, and the work recorded on it that day.
   * They write the **Daily work description**.
   * Work completed, pending work, challenges / blockers and remarks are optional extras.
   * The status becomes **Pending Approval** (waiting for their own Team Lead).
   * They are told "Daily report submitted successfully", and their Team Lead is told a report waits.
2. **The Team Lead decides** (Daily Report > Team Member Reports). The Team Lead can filter by status, employee, project and date, and open the
   full report. There are three decisions:
   * **Approve**:
     * The approver and the time are recorded.
     * The report is **Sent to HR** at once (`hr_sent_at`), with a "Sent to HR" history entry.
     * The named HR employees are notified.
     * The Department Head's step that follows is unchanged.
   * **Return for correction** (remarks required): the member corrects and resubmits it.
   * **Reject** (reason required): final; it cannot be edited or resubmitted.
   * A Team Lead only ever sees and decides their own Team Members' reports. Another Team Lead gets *not found*.
3. **A Team Member without a Team Lead**: their report goes straight to the Department Head, as before. It is sent to HR when the Department Head
   approves it.
4. **The Team Lead's own report** is their team report. It goes to the Department Head as before, and it is sent to HR when it is submitted
   ("New AI Studio Team Lead report").

| Status (shown) | Stored |
| --- | --- |
| Pending Approval | `PENDING_TL_APPROVAL` |
| Approved · Sent to HR | `PENDING_DH_APPROVAL` or `APPROVED`, with `hr_sent_at` |
| Returned for Correction | `RETURNED_BY_TL` (or `RETURNED_BY_DH`) |
| Rejected | `REJECTED_BY_TL` (new) |

* **Only approved reports reach HR.** A report that the Department Head later returns stops showing as approved to HR (`hr_sent_at` stays as history).
  When it is corrected and approved again, it is sent once more (once per revision).
* **No duplicates.** Each decision locks the report row, and a second Approve is refused (409). Sending to HR is done by a database trigger.
  It is recorded in `ai_studio_report_hr_sends`, whose primary key (report, revision) makes it once per revision; the report's history shows it
  as "Sent to HR". Each notification is written once per event.
* **History actions are unchanged.** A rejection is the Team Lead's RETURNED step whose result is `REJECTED_BY_TL`. That way an older
  migration that is run again (it re-adds its own list of actions) still works.

## The Daily Work Description: 10 to 150 words

> **Superseded by `20270308000100`** ([DAILY_REPORT_FIELDS.md](DAILY_REPORT_FIELDS.md)): the form no longer asks for the description. The
> daily report has three optional fields (Work Completed 150 words, Work Pending 100, Additional Note 50). Reports already made keep their
> description, and HR still sees it. The rule below still applies to reports made between the two migrations.

* **Words, not characters.** A word is a whitespace-separated piece that contains a letter or a digit, so "-" or "..." alone is not a word.
  * Shared rule: `countWords` / `dailyDescriptionProblem` in `shared/validation.ts`.
  * The database uses the same rule: `private.word_count`.
* **The form**
  * It shows a live counter: "23 / 150 words · 127 words remaining", or "4 more needed", or "12 over the limit".
  * Submit is disabled outside 10–150 words.
  * A draft may hold fewer words.
* **The API**
  * The Zod schema refuses a submission outside 10–150 words (422).
* **The database**
  * The save function checks the words.
  * A trigger also checks them on every submission of a daily report, whichever function submits it.
  * Not held to the rule:
    * reports made before this migration (`description_required = false`);
    * the older one-task report (its own form, kept for the reports made with it), which has no description field.

## HR > AI Studio Performance

**Who:** only the HR employees the Super Admin names (for example Simran Kumari), and the Super Admin.
* No name is written in the code. The Super Admin names people in HR > AI Studio Performance > *HR access*. They are kept in
  `ai_studio_hr_viewers`, and every change is audited.
* A named person must be an active HR employee; someone who leaves HR loses access automatically.
* Other HR employees, Team Leads, Team Members and the AI Studio Department Head are refused (403) by the database. The menu entry is only
  shown to people the database allows, and the data is checked on every call.

**What:** one period, up to 93 days (default: the last 30 days), in four views.

**A. Team Lead Reports**
* team, Team Lead, date, projects
* team members
* completed and pending tasks of the day, counted from the **approved** member reports only
* "x of y member reports approved"
* the Team Lead's own report and remarks

**B. Team Member Reports:** Team → Team Member → Project → daily report, each with:
* the member, team and Team Lead
* the project and the tasks (with that day's notes)
* the description, work completed, pending work, challenges and remarks
* the date, the approval and the approval date / time

**C. Team-wise:** choose a team to see:
* every member, with their assigned projects, approved reports, and completed and pending tasks
* the members' reports
* the Team Lead's daily reports
* the team summary

**D. Project-wise:** choose a project to see:
* the assigned team(s), the Team Lead(s) and the members
* each employee's approved reports and their completed and pending work on that project
* the project's history

A team in AI Studio is a Team Lead and the members who report to them (`private.direct_lead_of`). Members without a Team Lead form their own
group.

## Notifications

| Who | When |
| --- | --- |
| Team Member | report submitted successfully; approved by the Team Lead; returned; rejected |
| Team Lead | new report from a member; the confirmation of their own approve / return / reject |
| Named HR employee(s) | a new approved AI Studio daily report; a new Team Lead report; access given |

A click on an HR notification opens HR > AI Studio Performance.

## API

| Method and path | What | Who |
| --- | --- | --- |
| `POST /ai-studio/daily-reports` / `PATCH .../:id` | adds `workDescription` | the author |
| `POST /ai-studio/reports/:id/review` | `decision: APPROVE \| RETURN \| REJECT`, `comment` (required to return or reject) | the reviewer at that step |
| `GET /ai-studio/hr-performance/access` | `{ allowed, canManage, viewers, candidates }` (names for the Super Admin only) | anyone (answers for themselves) |
| `POST /ai-studio/hr-performance/viewers` | `{ profileId, allowed }` | Super Admin |
| `GET /ai-studio/hr-performance?from&to` | teams, projects, approved member reports, Team Lead reports | named HR employees, Super Admin |

## Deploying

1. Run `20270302000100_ai_studio_hr_performance.sql` in the Supabase SQL editor.
2. Deploy the app. Deploy it together with the migration: after the migration, a daily report can only be submitted with a description, which
   only the new form sends.
3. As the Super Admin, open HR > **AI Studio Performance** > *HR access* and give access to Simran Kumari.

## Tests

* `supabase/tests/ai_studio_hr_performance_test.sql` covers:
  * the word rule;
  * who may open it (a named viewer, another HR employee, Team Lead, member, Department Head, removal);
  * 9 / 151 / no words;
  * the own Team Lead only;
  * Approve → Sent to HR once, with notifications;
  * a second approval refused;
  * Return and Reject never reaching HR;
  * Reject being final and not counted as approved by Performance Management;
  * the Team Lead report and its approved-only summary;
  * teams and projects;
  * a later Department Head return leaving HR's approved list;
  * a corrected revision sent once more.
* The API section in `api_integration.test.ts` and the unit test `ai_studio_hr_performance.test.ts` cover the same rules over HTTP and in the
  shared schema.
