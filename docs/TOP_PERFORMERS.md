# Top Performers & Rankings

Monthly scores, rankings, written evaluations and monthly recognition, built on the records the CRM already keeps. Nothing is typed in and nothing is copied:

| Source | Used for |
| --- | --- |
| `work_tasks`, `work_task_updates` | tasks assigned and completed, deadlines, completion time, priority, BLOCKED status |
| `work_reports` (status **APPROVED** only) | report coverage and report quality (the Team Lead's / Department Head's review outcome) |
| `profiles`, `teams` | who is in which department and team, designation, picture |

## Who sees what

| Role | Access |
| --- | --- |
| Team Member, Team Lead | nothing (no page, the API answers 403) |
| Department Head | the rankings of **their own department**; approves or rejects that department's recognition |
| Operations Head | the departments they manage: company view and every department, **read only** |
| Super Admin | every department, **read only** |

All of it is enforced by `security definer` functions (`performers_department`, `performers_company`, `performer_recognition_decide`); the tables have no direct access. A Department Head naming another department gets `FORBIDDEN`.

## The score (transparent, one source of truth: `private.rank_methodology()`)

Team Member: weighted completion 30, deadlines met 20, speed 10, approved report coverage 15, report quality 15, week-to-week consistency 10.
Team Lead: own completion 15, own deadlines 10, own report coverage 10, own report quality 10, team completion 15, team deadlines 10, team reports reviewed within 48 hours 10, task distribution 10, team improvement against last month 10.

A measure with no data is left out and the others are scaled. Fairness rules: tasks are weighted by priority (High 3, Medium 2, Low 1); a duplicate task (same title and deadline) counts once; a task completed within five minutes of creation is not credited; a task a Team Lead split among members belongs to the members; a BLOCKED task (external dependency) is neither missed nor late; open tasks not yet due are not counted; drafts, waiting, rejected and revision-required reports never count. Fewer than three judged tasks means **Insufficient Data**: no score and no rank.

Limits, stated on screen: the CRM records no task complexity or quality score, so priority stands in for complexity and the review of the reports stands in for quality; reassignment is not recorded except through a Team Lead splitting a task.

## Data

`performer_scores` (one row per person and month), `performer_score_history` (a version each time the figures change, for monthly and quarterly comparison), `performer_evaluations` (the written evaluation per version of the figures and the AI log: source, model, status, error, attempts), `performer_recognitions` and `performer_recognition_events` (recommendations, decisions, who and when). Scores are recalculated from the live records whenever a department page is opened (the company view reuses scores younger than five minutes) and once a day by the daily automation (`runTopPerformersAutomation`), which also writes missing evaluations.

## AI evaluation

Set `ANTHROPIC_API_KEY` (and optionally `PERFORMANCE_AI_MODEL`) on the server, as for the performance reports. The AI receives the figures of one person and month, the department average and the reviewers' short comments: no name, e-mail or contact data; it is told never to cite a rank. Without a key, or when the AI fails, the evaluation is written by rules from the same figures and labelled so; failures are logged and retried after six hours.

## Monthly recognition

For each department and closed month the system **recommends**: Employee of the Month, Top 3 Employees, Best Team Lead (needs two ranked Team Leads), Most Improved, Highest Task Completion Rate, Best Report Consistency (rank-based awards need two ranked employees). A recommendation is not an award. The Department Head approves or rejects (a reason is required to reject) **after the month has ended**; the scores are recalculated first and a changed recommendation is not approved blindly. Approved and rejected rows are never rewritten by later recalculation. The Department Head is told when the recommendations are ready; the winner is told when the award is official; the decision is audited.

## Screens

Department Head (both Department Head dashboards): *Top Performers & Rankings* with Top 3 / Top 5 cards, Employee of the Month, the complete ranking, individual cards (picture, designation, score, rank, completed tasks, productivity, measures, evaluation), Team Leads compared, monthly recognition, monthly and quarterly comparison, insights and the methodology. Operations Head (inside their department dashboard) and Super Admin: departments ranked by average score, top employees and Team Leads across departments, trends, recommendations and official awards.

## API

`GET /top-performers/department?month=YYYY-MM[&departmentId]`, `GET /top-performers/company?month=`, `POST /top-performers/evaluate`, `POST /top-performers/recognitions/:id/decision` `{ decision: APPROVE|REJECT, note? }`.

## Tests

`supabase/tests/top_performers_test.sql` (scoring rules, permissions, recalculation, history, recognition, evaluation storage), `api_integration.test.ts` ("Top performers"), `top_performers_narrative.test.ts` (evaluation writer and validation), `supabase/tests/e2e/run-top-performers.sh`.
