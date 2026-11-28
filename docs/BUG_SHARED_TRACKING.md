# Bugs: shared tracking by the three developers

Migration: `supabase/migrations/20270312000400_bug_shared_tracking.sql` (run after the migrations already on main; safe to run twice,
nothing is deleted or changed in the existing bugs, events, files or assignments).

## What changed

Before (`20270122000400`): the Team Lead assigned every bug to one developer, the other developer did not even see it, and only the assigned
developer (or the lead) could change its status. A bug waited for its single assignee.

Now a bug has **no mandatory assignee**. The three developers (the Team Lead, Ashish Sinha, Siddhesh Shinde, as listed in the Super Admin's
developers list) all see every bug and all work on it together. Employees still report bugs from *Raise an Issue* exactly as before; the
Super Admin still keeps the developers list; nobody else sees a bug except the person who reported it.

The Team Lead can still name a **primary contact** (the old "assign"): it is optional, is kept in the assignment history and the audit log,
notifies that developer, and **never hides a bug or blocks anybody**.

## Who may do what (enforced in the database functions and the row level security policies)

| | Reporter | Developer (any of the three) | Team Lead | Super Admin / others |
| --- | --- | --- | --- | --- |
| See the bug | own bugs | every bug | every bug | none |
| Add a progress update, change status / progress | no | yes, any bug | yes | no |
| Reply to the reporter / ask for information | follow-up only | yes | yes | no |
| Internal comment | no | yes | yes | no |
| Name a primary contact | no | no | yes | no |

`private.bug_visible` / `private.bug_team_visible` are the one rule (used by the functions and the policies): the reporter, or a developer.

## Add Progress Update

`POST /api/v1/bugs/:id/updates` → `BugService.addUpdate` (Zod `bugProgressUpdateSchema`) → `BugRepository.addUpdate` → `public.bug_dev_add_update`.

Body: `work` (what was worked on, required), `status`, `progress` (0-100), `notes`, `expectedVersion`, `clientRequestId`.
The person is **never** in the request: the database takes it from the login.

* Every update is a new `PROGRESS` entry in `dev_bug_events` (append-only: a trigger refuses update and delete): the text, the notes, the status and
  progress **before and after**, the author and the time. Nobody's entry is ever replaced.
* Status and progress are saved on the bug (`dev_bugs.status`, `progress`, `version`, `last_update_at`, `last_update_by`).
* A resolved bug is 100% done and needs its resolution text (the notes, else what was worked on): the reporter reads it. Resolving, rejecting,
  closing, reopening and "waiting for information" keep their existing effects (reporter notification, escalation update on the employee's issue).
* **Duplicates:** the same `clientRequestId` from the same person on the same bug is stored once (a double click or a retry returns the first update).
* **Conflicts:** when `expectedVersion` is sent and the bug was changed by somebody else since (version moved), a change of status or progress is
  refused with `CONFLICT` ("Another developer updated this bug while you were writing…") instead of overwriting it. A note that changes neither
  is still added. The row is locked while it is updated, so simultaneous saves queue; the screen offers "Load the latest version" and keeps what was typed.
* The other two developers are notified of each update (`DEV_BUG_PROGRESS`); every update is audited (`DEV_BUG_PROGRESS_UPDATED`).
* The quick status change (`POST /bugs/:id/status`) is the same update written as one line, so it is attributed and counted too.
* The work log (the `PROGRESS` entries) is internal: the reporter sees the status, the progress and the resolution, not who did what.

## Status, progress, contributors

* Statuses: the existing ones (`PENDING` = Open, `UNDER_REVIEW`, `IN_PROGRESS`, `NEEDS_INFO`, `RESOLVED`, `REJECTED`, `CLOSED`) plus **`TESTING`**.
  The existing "Pending" wording is kept for `PENDING`. No other status was added.
* `dev_bugs.progress` (0-100, table check) is the overall progress; the list, the bug and the reporter's own view show it.
* **Contributors** are derived from the history (progress updates, comments, replies, status changes), never stored, so they cannot drift:
  `private.dev_bug_contributors`. Each shows the number of updates. The list shows their names; the bug shows names, counts and the latest update.
* The Bugs page: filters Open / I worked on / Pending / Under Review / In Progress / Testing / Pending Information / Resolved / Rejected / Closed / All,
  a table with Priority, Progress and "Worked on by", a team panel (each developer's number of updates), and for each bug the title, description,
  priority, status, progress, created date, latest update, contributors, the progress and activity history and the **Add Progress Update** form.

## Tests

* `supabase/tests/bug_shared_tracking_test.sql` (79 checks): no assignee needed; all three see and open the same bug; three people update it and none overwrites
  another; contributors and latest update; conflict and duplicate handling; validation; reporter / outsider / Super Admin blocked; history cannot be
  rewritten; the primary contact hides nothing; follow-ups reach the whole team; constraints.
* `supabase/tests/bug_progress_validation.test.ts` (20 checks): the Zod rules.
* `supabase/tests/api_integration.test.ts` "Bugs for the Developers team": the HTTP routes, permissions, three updates by three people, a conflict and **three
  simultaneous saves** (one wins, two get a conflict; simultaneous notes are all kept).
* `supabase/tests/ui_bugs.test.mjs` (browser): all three developers see every bug, the progress form, contributors, the conflict message and a double click.
* `developer_bugs_test.sql` and `issue_routing_test.sql` keep testing the earlier migrations they apply themselves (they re-apply their own migration first).
