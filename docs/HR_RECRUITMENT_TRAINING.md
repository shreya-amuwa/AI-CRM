# HR Recruitment Management and Training workspace

Migrations (run in the Supabase SQL editor, safe to run again): `20261116000200_hr_recruitment.sql`, `20261116000300_hr_training.sql`.
Tests: `npm run test:db` (`recruitment_test.sql`, `training_test.sql`), `npm run test:api`, browser `supabase/tests/e2e/run-workspaces.sh`.
Both pages are in the HR dashboard sidebar. HR staff and the Super Admin can use them; the database refuses everyone else (row-level security on the
tables and a check inside every function); the tables cannot be written directly.

## Recruitment Management
The CRM had no candidate tables (the old card showed a hard-coded "2 Active Candidates" and offer letters kept in the browser), so these are new:
`hr_positions`, `hr_candidates`, `hr_candidate_actions`, `hr_candidate_calls`, `hr_candidate_events`. The old card now shows the real number of candidates.

The table has the columns **Candidate Name, Email, Position, Pending, Call, Confirmation**. The last three are separate things, each from its own records:

* **Pending**: open items (interview, documents, assessment, checks ...) with a due date and the responsible HR employee; open / overdue counts.
* **Call**: the next scheduled call, the last outcome and the follow-up date; a follow-up is overdue until a later call is scheduled or made.
* **Confirmation**: not started / offer pending / offered / confirmed / declined / on hold, with its date.

HR can add and edit candidates, assign a position and a responsible HR employee (notified), add and close pending items (the assignee is notified), schedule and
record calls, set the confirmation, search by name or e-mail, filter by position / pending / call / confirmation / responsible person, see the agenda
(upcoming calls, planned calls not recorded, overdue follow-ups, overdue items) and each candidate's full history. The same e-mail can apply for different
positions but not twice for the same one.

## Training
Programs are three days on consecutive dates from the start date (change the start date and the schedule follows): **Day 1 Initial Training, Day 2 Practical
Training, Day 3 Final Training and Assessment**. HR configures the topics, the trainer (a name, and optionally a CRM login who may record that day) and the
assessment criteria / pass mark of each day; nothing is hard-coded.

For every enrolled employee and day: attendance, topics done, tasks, assessment scores (checked against the criteria), feedback, trainer remarks and a day
report; plus strengths, areas to improve and remarks overall. **A day is complete only when the employee attended (present or late) and something was
recorded** (a topic, a done task or a score; Day 3 also needs its assessment). A day cannot be reported before it takes place, and the calendar completes
nothing. Status: Completed when all three days are complete; Incomplete when the program is over and they are not; In progress once attendance is recorded;
otherwise Not started. The same employee can attend any number of programs: every enrollment stays as history (Employee records tab).

Automation: the daily dispatch runs `hr_training_tick()`: programs that are over become Incomplete where the work was not done, the consolidated report is
made once a training is finished (and says what is missing instead of inventing it), and the responsible HR employee gets one reminder per program and day
for day reports still missing (in-app notification, no e-mail).

Known limit: a trainer who has a CRM login but is not in the HR department can record their day through the API; the HR dashboard screen is HR-only.
