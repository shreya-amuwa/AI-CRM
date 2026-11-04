# Work tasks: Department Head → Team Lead → Team Member

## Flow
1. **Department Head** (sign-in lands on the Department Head dashboard) → **Assign**: pick a
   team lead of the department, task, details, priority, due date.
2. **Team Lead** → **Assigned Tasks**: assigns the same task to one or more team members.
3. **Team Member** → **My Tasks**: sends updates (In progress with %, Completed, or Not
   completed with a reason) to the Team Lead.
4. **Team Lead** sees every member update and sends their own update to the Department Head.

Everyone is notified (bell) when a task is assigned to them or an update comes back.

## Department Head dashboard
- **Assign** - new task form + every task given to team leads, with each member's status,
  progress and the team lead's updates.
- **Reports** - assigned / completed / in progress / not started / not completed / overdue and
  completion %, by team lead and by team member (all time, last 30 days, last 7 days).
- **Daily Tasks** - tasks due on a chosen day, how many are completed, and the updates sent that day.
- **Department Hub** - the existing department panel (a button brings you back).

## Creating a Department Head
Super Admin Dashboard → **Add Team Member** → choose the department → Role **Department Head**.
The same form creates Team Leads, Team Members and Technical Consultants.

## Database
Migration `20261008000600_work_tasks.sql`: `work_tasks` (parent_id links a member's task to the
team lead's task), `work_task_updates`, and the functions `assign_task_to_team_lead`,
`assign_task_to_members`, `submit_task_update`. Writes only go through these functions, which
check the hierarchy; reads follow it (RLS). Tests: `supabase/tests/rls_test.sql` section 17.

## Who got which part (migration 20261224000300)

* The Team Lead's *Assign to team members* can give each member their own part of the work ("Follow up with 40 customers"), optional. It is
  stored on the member's own task (`work_tasks.assignment_note`, max 500 characters) by `delegate_task_to_members` (same rules as before:
  only the lead's own ordinary, active members; a retry never makes a second copy). On a database without the migration the button falls back
  to the plain delegation.
* The Department Head's *Assign* page shows under every Team Lead task an always-visible **Assigned to Team Members** list: name, their part,
  assigned by, assignment date, due date, priority, status, progress, latest update, completion date - or "Not yet assigned to Team Members".
  It is read from the stored member tasks (`parent_id`); nothing is generated for display. The update history is behind *Show update history*.
* Visibility is the existing row-level rule: the Department Head of that department **and function** (a Support head does not see a Sales
  team's tasks), the Team Lead, the member (their own part only), the Super Admin.
* A member's update never completes the Team Lead's task; the Daily view counts a Team Lead task and its member parts once.
* The Department Head is notified when a task is shared out (`TASK_DELEGATED`). Tests: `supabase/tests/task_delegation_detail_test.sql`.
