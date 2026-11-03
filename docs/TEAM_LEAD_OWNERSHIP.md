# Team Lead -> Team Member ownership

`Super Admin -> Operations Head -> Department Head -> Team Lead -> Team Member`. For routine tasks and daily reports the reporting line is
**one Team Member -> their ONE Team Lead -> the Department Head**, decided by the database. Migration: `20261223000100_team_lead_ownership.sql` (additive, safe to run twice).

## Root causes (confirmed in the code, not guessed)

| Symptom | Cause |
| --- | --- |
| A Team Lead sees / assigns tasks to another Team Lead's members | A Team Member belonged to a **team** (`profiles.team_id`), and two active Team Leads (`role = TEAM_HEAD`) can share one team. `assign_team_task` / `assign_task_to_members` accepted any `TEAM_MEMBER` with the same `team_id`; the picker filtered the browser's profile list the same way. |
| Technical Consultants and Meta Verifiers in the picker | They are `TEAM_MEMBER`s with a flag (`is_technical_consultant`, `is_meta_verifier`); a role filter cannot tell them apart. |
| Report shows "Team Lead: Waiting (Mittal sumra)" but the history says "Opened for review (Team Lead) by Renuka Parche" | Three rules disagreed. `work_report_submit` stored the displayed lead as the **first Team Lead of the team by name** (`order by p.full_name, p.id limit 1`); the notification went to **every** Team Lead of the team; and `report_review_stage` / `is_report_reviewer` allowed **any** of them to open and decide. The second lead, who is not the first by name, opened and could decide the report. |
| A Team Lead's inbox / team box showed other leads' members | `work_reports_inbox`, `work_reports_team_box` and `team_lead_box` selected members and reports by `team_id`. |

## The model

* `profiles.manager_id` = the direct Team Lead of a Team Member. A guard trigger keeps it valid (a `TEAM_HEAD` of the member's own team); a team change clears it.
* A member added by a Team Lead is theirs at once (`provision_auth_user` sets it from the provisioning actor). A member of a team with **exactly one** active Team Lead
  belongs to that lead (backfill + resolver). A member of a team with several leads and nobody named is **unassigned**: no lead is picked for them.
* `private.direct_lead_of(member)` is the single resolver. A **named** lead who is no longer an active Team Lead of the team leaves the member unassigned (reassignment required,
  never an automatic replacement). `private.report_lead_of(report)` is the lead recorded when the report was submitted (so what is shown, notified and authorised is one person), else the author's direct lead.
* The Super Admin or the Department Head of the team (not a Team Lead) names or changes a lead with `assign_direct_lead(member, lead)`. The member's **pending** stage-1 reports move to
  the new lead (history step `REROUTED`, notification); approved or decided reports and all earlier history stay.

## What changed for users

| Place | Before | Now |
| --- | --- | --- |
| Task form "Team members" (`assign_team_task`) and delegating a task (`assign_task_to_members`) | everyone with the Team Lead's `team_id` | only the lead's own ordinary members (`my_team_members()`; no Technical Consultant, no Meta Verifier, nobody inactive). The database refuses any other id, so a crafted request fails too. The form shows loading, error and "nobody assigned yet" states. |
| Submitting a daily report | a Team Lead picked by name; all leads notified | goes to the member's own Team Lead, who alone is notified and may open, approve, reject or request a revision. A member with no resolvable lead gets the existing message "You are not assigned to a Team Lead yet". |
| Team Lead inbox / team box, Department Head and Operations Head boxes | all reports of the team | the reports and people of that lead |

## Existing data

`hierarchy_report(p_apply := false)` (Super Admin or Department Head of the team) is a **read-only impact report**: members with several leads and nobody named, and pending stage-1 reports whose recorded lead is not
the author's direct lead. `hierarchy_report(true)` corrects **only** the verifiable pending ones (a direct lead resolves) with a history step and a notification; ambiguous cases stay in the list for a head to decide with
`assign_direct_lead`. Approved, rejected and earlier reports are never changed. Nothing is moved on its own, except that members of single-lead teams get that lead as `manager_id`.

## Tests

`supabase/tests/team_lead_ownership_test.sql` (section 120): TL A / TL B on one team, members each lead added, a Technical Consultant, a Meta Verifier, a member nobody named, guessed ids, foreign and crafted requests, report routing and notifications,
inbox / team box isolation, the two-level approval, transfer, the impact report, suspension. It also caught that `head_may_manage` ignores the caller's role (a Team Lead could have called `assign_direct_lead`); the helper now checks the Department Head role itself.
