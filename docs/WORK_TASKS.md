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
- **Assign** — new task form + every task given to team leads, with each member's status,
  progress and the team lead's updates.
- **Reports** — assigned / completed / in progress / not started / not completed / overdue and
  completion %, by team lead and by team member (all time, last 30 days, last 7 days).
- **Daily Tasks** — tasks due on a chosen day, how many are completed, and the updates sent that day.
- **Department Hub** — the existing department panel (a button brings you back).

## Creating a Department Head
Super Admin Dashboard → **Add Team Member** → choose the department → Role **Department Head**.
The same form creates Team Leads, Team Members and Technical Consultants.

## Database
Migration `20261008000600_work_tasks.sql`: `work_tasks` (parent_id links a member's task to the
team lead's task), `work_task_updates`, and the functions `assign_task_to_team_lead`,
`assign_task_to_members`, `submit_task_update`. Writes only go through these functions, which
check the hierarchy; reads follow it (RLS). Tests: `supabase/tests/rls_test.sql` section 17.
