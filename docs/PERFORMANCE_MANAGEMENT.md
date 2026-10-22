# Performance Management (Team Lead and Department Head dashboards)

Migration: `supabase/migrations/20261116000100_performance_management.sql` (safe to run again; nothing is deleted).
Tests: `npm run test:db` (`performance_test.sql`), `npm run test:api` (the "performance API" checks), `npm run test:unit` (`performance_narrative.test.ts`),
browser: `supabase/tests/e2e/run-workspaces.sh`.

## What it does
A new **Performance Management** page in the Team Lead dashboards (Sales and Support) and the Department Head dashboard.

* The **figures** are calculated by the database from the real task records (`work_tasks`, `work_task_updates`): assigned, completed, pending, overdue,
  on time / late, time taken against the planned window (assignment to deadline), priority mix, the most tasks open at once, weekly series, the status
  history, the reasons people wrote when a task was not completed or blocked, and the trend. A figure that cannot be worked out (no deadline, a task
  completed without a completion time, nobody finished anything) is `null` and shown as **Insufficient data**: nothing is estimated.
* The CRM has **no expected duration, complexity or dependency field and no working-hours data**. The report says so in its data limitations, uses the
  deadline as the planned window, and never treats longer hours as better performance.
* A **report** = those figures (stored as the evidence) + a written analysis (summary, observations, areas of improvement, recommendations, limitations).
  Weekly (Monday to Sunday), monthly and custom ranges (up to a year) are supported; the list also shows Teams and the Department for a Department Head.
* Every report keeps its generated time, the time the data was last checked, the version, and what triggered it (scheduled or by whom). A new version is
  kept only when the task figures changed; a refresh that changes nothing creates nothing (one report per subject and period, enforced by a unique key).

## Who can see what (enforced by the database, not only by the screens)
Team Member -> Team Lead -> Department Head.

| Role | Can open |
| --- | --- |
| Team Lead | the members of their own team and their own team's report |
| Department Head | the Team Leads and members of their own department, each team, and the department |
| Super Admin | everything (existing permissions) |
| Team Member, other roles, signed-out | nothing (functions refuse; row-level security returns no rows) |

## The AI analysis (decision needed: the project had no AI service)
There was no AI provider in the project, so none could be reused. The analysis uses the **Anthropic Messages API** and is **off until
`ANTHROPIC_API_KEY` is set on the server** (Vercel / API environment; never in the browser or the database). `PERFORMANCE_AI_MODEL` (default
`claude-sonnet-5-5`) and `PERFORMANCE_AI_TIMEOUT_MS` are optional. Without a key, or when the AI service fails, a **rule-based analysis** of the same
figures is stored and the report says which one it is ("AI-generated" / "Rule-based analysis ..."); failed AI analyses are retried after six hours and on the
next manual refresh. What leaves the server when a key is set: the figures of one report, short titles of the delayed or open tasks and the shortened
reasons people wrote. No e-mail addresses, phone numbers or customer details. The model is told to use only these figures, to write "Insufficient data"
for a missing one, and to ignore hours.

## Scheduling
The existing daily dispatch (`/api/v1/internal/automations/dispatch`, Vercel Cron) now also runs `performance_schedule()`: it refreshes the weekly and monthly
reports of every active Team Lead / member, team and department that has tasks in the period (only when their figures changed), then writes any missing
analysis. It is idempotent and guarded against two runs at once. Authorized users can also press **Generate report / Refresh report**.

## Deployment
1. Run the migration in the Supabase SQL editor.
2. Optional: set `ANTHROPIC_API_KEY` (and `PERFORMANCE_AI_MODEL`) on the server and redeploy.
