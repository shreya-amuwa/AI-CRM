# HR Recruiter dashboard, candidate portal integration and automatic decision e-mails

The HR department has two designations: **HR Assistant** (the existing HR dashboard, unchanged) and **HR Recruiter** (the recruiter dashboard below). There is no new
department. The recruiter works on the records the CRM already has (career postings, candidate applications, HR candidate records, calls, tests, interviews); nothing is copied.

Migrations to run, in this order, in the Supabase SQL editor (each is safe to run twice):

1. `20261222000100_hr_recruiter_role.sql` - the HR designation and who counts as HR staff
2. `20261222000200_recruitment_decision_email.sql` - decisions and the backend e-mail outbox
3. `20261222000300_recruiter_workspace.sql` - vacancy fields, history, notes and every recruiter function

## 1. Roles and login

* Creating an HR employee (Add Member, or an employee request) shows the **Role / Designation** dropdown with *HR Assistant*, *HR Recruiter* and *HR Admin Head* (see below). The designation is saved with the
  employee's details (`employee_personal_details.designation`); a database trigger turns it into `profiles.hr_sub_role` and the stored `default_dashboard`
  (`hr-recruiter`). The Super Admin or the Department Head of HR can change it later with `set_hr_sub_role` (audited). The HR designations are refused for any other department or for a role they do not fit.
* Sign-in routes a Recruiter to `/hr-recruiter/dashboard/:userId`. Navigation is convenience only: every function checks the caller itself.
* A Recruiter is **not** HR staff in the database (`private.is_hr_staff()` is false for them): the HR Assistant's pages (directory, leave review, issues, e-mail automation, recruitment
  management) answer FORBIDDEN, and an HR Assistant is refused the recruiter functions. The Super Admin and the Department Head of HR ("HR leadership") use both.

### HR department designations (migration `20261222000500_hr_department_designations.sql`)

The HR department has exactly three designations for new employees, shown as the **Role / Designation** dropdown whenever the HR department is selected in *Add Team Member*
(and in HR's *New employee request* form): **HR Assistant**, **HR Recruiter**, **HR Admin Head**. Team Member, Team Lead, Department Head and Operations Head are not offered for HR.

| Designation | Existing role it maps to | Dashboard | Notes |
| --- | --- | --- | --- |
| HR Assistant | Team Member of HR | existing HR dashboard | all existing HR Assistant permissions, unchanged |
| HR Recruiter | Team Member of HR | HR Recruiter dashboard | recruitment modules only |
| HR Admin Head | Department Head of HR (no new role) | existing HR Department Head dashboard (`hr-head`) | HR-wide oversight (`private.is_hr_leadership`); one per department; created directly only by the Super Admin; through an employee request it still needs the usual approver; no Super Admin or Operations Head permission |

Enforcement is in the database, not the dropdown: `private.designation_problem` is the single rule. It is used by the trigger on `employee_personal_details` (so any way of saving a designation is
checked), by a trigger on `profiles` (a role or department change cannot leave an HR designation on someone it no longer fits), and by `public.assert_designation_allowed`, which the server calls before
any account or employee request is made (so a wrong combination leaves nothing behind, and an HR employee cannot be made without a designation). A designation that does not belong to the department
(for example HR Recruiter in Sales) or does not match the role (HR Assistant as a Team Lead) is refused. Existing employee records are not changed, and saving an older record without changing its
designation is not blocked. Operations Heads keep their company-wide designation wherever they are homed.

Other departments are unchanged: their Role dropdown, Sales roles (Telecaller, Business Associate, ...) and designations work as before. Existing HR Team Leads and HR employees with an older generic
designation keep working; only new HR employees follow the three-designation rule.

## 2. Sidebar (exactly this)

Dashboard - Available Vacancies - Candidate Applications - Candidate Pipeline - Call Management - Interview Management - Assessment & Test Results - Selection & Rejection -
Recruitment Reports - Settings. There is no e-mail page, e-mail setting, template, preview, manual send, retry or log anywhere in the recruiter dashboard.

## 3. Data

| Need | Where it lives |
| --- | --- |
| Vacancy | `career_postings` (+ `hr_positions` for title/department). New columns: `openings` (1-500), `vacancy_status` (Draft / Pending Approval / Open / On Hold / Closed / Filled), `responsible_id`, `qualifications`, `skills`, `experience`, `required_steps`, `approved_at`, `status_note`. `published` and `vacancy_status` always agree (trigger): only an **Open** vacancy accepts portal applications. There is no separate "Requirement Management" module in this codebase, so the vacancy is the career posting. |
| Application | `career_applications` (one per candidate and vacancy). The candidate's own answers stay in its `snapshot` and are never edited. |
| Calls | `hr_candidate_calls` (+ `application_id`, so two applications of one candidate have separate calls). A call is completed only with an outcome. |
| Tests | `career_attempts` / `career_tests` (the recruiter can invite with `recruiter_assessment_invite`; the candidate takes it in the portal). |
| Interviews | `career_interviews` (+ interviewer, mode, `booked_by`, `confirmed_at`, `rescheduled_from`). A reschedule cancels the old row and creates a new one that points back. |
| Recruiter's own records | `recruiter_notes` (notes / evaluations), `recruiter_stage_history` (before, after, who, when, why), `recruiter_applications` ("ready for selection decision"), `recruiter_decisions`. |

The 12 pipeline stages (New Application, Initial Screening, Call Scheduled, Call Completed, Test Pending, Test Completed, Interview Scheduled, Interview Completed, Selection Review, Selected,
Rejected, On Hold) are **derived** from the real records by `private.recruiter_stage_of`, so a candidate cannot sit in "Interview Completed" without a completed interview. Every change a recruiter makes writes a history row.

## 4. Who sees what

* **Recruiter**: the vacancies allocated to them, the unallocated ones as a waiting queue (counts only, no candidates), and the applications of their own vacancies (or candidates HR assigned to
  them). Another recruiter's application answers "not found". Recruiter reports cover their own work.
* **HR leadership**: everything, allocates vacancies (`recruiter_vacancy_assign`, also the *Responsible recruiter* field of the job form), changes any vacancy status, and is the only one who can
  **correct a final decision** (`recruiter_decision_correct`).
* A recruiter can send a draft for approval, hold or resume an approved vacancy, and close a filled one. Opening or closing anything else is leadership's decision. A vacancy is never closed automatically:
  when the last opening is taken it becomes **Filled** ("ready for closure") and leadership is told.
* Tables have no grants for browser roles; every access is a `security definer` function with `set search_path = ''`.

## 5. Selection and rejection

`recruiter_decide(application, decision, category, reason)`:

* one **current** decision per application (partial unique index); a repeated identical request returns the recorded one; a different one needs a correction by HR leadership
* the decision belongs to the **application**, so a candidate who applied to two vacancies has two independent decisions
* selection is refused when every opening is already taken, or when a step the vacancy requires (call / assessment / interview) is missing
* a correction keeps the old decision (`is_current = false`), points the new one at it, needs a reason, is audited, and gets its own e-mail event; an unsent e-mail of the replaced decision is cancelled

## 6. Candidate e-mails: automatic, backend only

```
Recruiter marks Selected / Rejected  ->  database function checks the caller, the application and the vacancy
  -> saves the decision AND, in the same transaction, one outbox row (recruitment_decision_emails, decision_id UNIQUE)
  -> the server (right after the request, and every scheduler run) claims due rows with `for update skip locked` and a lease
  -> builds the message from the live application record with the server-side template (server/recruitment/emailTemplates.ts)
  -> sends through the CRM's existing mail setup (SMTP / Resend / Brevo, AUTOMATION_MODE) -> records the result
  -> temporary failures are retried after 5, 15, 60, 240 minutes; after 5 attempts the row is FAILED and HR leadership is notified
```

* The two e-mails have fixed subjects (*Congratulations! You Have Been Selected – Amuwa Corporation*, *Update on Your Job Application – Amuwa Corporation*) and the wording of the recruitment
  process; only candidate name, position, department and decision date are filled in. The rejection e-mail never carries the internal reason.
* **Idempotent**: refreshing a page, reopening a profile, repeating the API request or retrying a failed send cannot create a second e-mail (unique key, claim lease, `SENT` is final). A failed
  e-mail never undoes the decision.
* **Records** (`recruitment_decision_emails`, `recruitment_decision_email_attempts`): candidate id, application id, recipient, type, trigger event, recruiter id, created/processed/sent times,
  provider acceptance, delivery status (reserved, see below), attempts, short error text. No credentials, tokens or message bodies are stored.
* **Visibility**: the tables are unreadable to browser roles. The only readers are the server (service key) and two Super Admin functions, exposed as technical API routes with **no screen**:
  `GET /recruitment-emails` and `POST /recruitment-emails/:id/requeue` (a FAILED e-mail only).
* **Configuration** (server environment, never in the frontend): `AUTOMATION_MODE` (`off` / `dry_run` default / `live`), `EMAIL_PROVIDER` + its credentials, `EMAIL_FROM`, `HR_REPLY_TO`,
  `HR_EMAIL_FROM_NAME`, `APP_URL`; `AUTOMATION_TEST_RECIPIENTS` limits live sending to test addresses; `RECRUITMENT_EMAIL=off` is an operator kill switch for this e-mail only (the queue keeps filling).

## 7. API (all under `/api/v1/recruiter`, validated with the shared Zod schemas)

`GET context | directory | filter-options | overview | vacancies | vacancies/:id | applications | applications/:id | pipeline | calls | interviews | decisions | reports | tests | resumes/:id/url`,
`POST vacancies/:id/recruiter | vacancies/:id/status | applications/:id/notes | stage | calls | interviews | assessments | decision | decision/correction`.

## 8. Tests

* `supabase/tests/recruiter_workflow_test.sql` (database: roles, scoping, allocation, pipeline, calls, interviews, decisions, corrections, outbox, regression of the HR Assistant)
* `supabase/tests/recruiter_decision_email.test.ts` (templates, dispatcher with a fake provider, schemas)
* the "HR Recruiter workspace" block of `supabase/tests/api_integration.test.ts`

## 9. Known limits

* The candidate portal has no slot-booking screen today (HR schedules; candidates view). The recruiter workspace already shows a booking made by a candidate (`booked_by = 'CANDIDATE'`) and notifies the
  recruiter when one is inserted, so the portal feature can plug in without changes here.
* `DELIVERED` is reserved: SMTP / Resend / Brevo calls used here report acceptance, not final delivery.
* If the server dies between the provider accepting a message and the result being recorded, the lease expires and the row is retried (at-least-once for that rare case).
* Calls HR logged before this feature (no `application_id`) show on every application of that candidate.
* The recruiter sidebar is exactly the ten items specified, so the company daily-report page (COMPANY_REPORTING.md) is not in it. If recruiters must also submit daily reports, a Reports entry needs to be added to the sidebar (a one-line change); this was left out because the sidebar was specified exactly.
