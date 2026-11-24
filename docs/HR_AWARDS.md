# HR Awards (Award Management > Awards)

Monthly employee recognition in the HR dashboard. Migration: `supabase/migrations/20270203000100_hr_awards.sql` (additive, safe to run twice).

## Where it is

HR dashboard > **Award Management** (the module card) > its menu: **Birthdays**, **Anniversaries**, **Awards**. Birthdays and Anniversaries are
the existing upcoming-celebration lists (unchanged; only split into their own menu entries). **Awards** is new.

## The seven awards

| Code | Award | Nominees |
| --- | --- | --- |
| `PROFESSIONALISM_EXCELLENCE` | Professionalism Excellence of the Month | employees |
| `RISING_STAR` | Rising Star of the Month | employees |
| `PLAYER` | Player of the Month | employees |
| `EMERGING_LEADER` | Emerging Leader of the Month | employees |
| `DEPARTMENT` | Department of the Month | departments |
| `TEAM` | Team of the Month | teams |
| `BUSINESS_ICON` | Business Icon of the Month | employees |

They are seeded in `hr_award_categories`; the kind of nominee each takes is its `nominee_type` (checked by the database).

## How it works

* **Month-wise.** HR picks a month and year (arrows, the month field, or the *Award history* chips of months that have records). Each award has
  its own record per month (`hr_award_periods`, one per award and month, created with the first nominee). A new month starts empty; earlier months
  are never overwritten.
* **Nominees.** *Add Nominee* opens a form: nominee type (fixed by the award), the employee / team / department **chosen from the CRM** (active
  employees except the Super Admin; teams; departments; never typed), department, team and designation filled in from the CRM, reason
  (required, 3-2000 characters), supporting remarks (optional) and the award month. Any number of nominees per award and month. *Save & add
  another* keeps the form open. The same employee / team / department cannot be nominated twice for the same award and month (`CONFLICT`); in
  another month, or for another award, they can. Editing changes the reason and remarks (to nominate someone else, remove and add). Removing keeps
  the row (`status = 'REMOVED'`, who, when, optional reason); a removed nominee can be nominated again.
* **Winners.** *Declare Winner* (or the trophy on a row) declares one or more nominees of that award and month winners, with optional remarks.
  There is no limit and no automatic winner: only the chosen nominees win, each stored as its own row in `hr_award_winners`. A winner's remarks can
  be edited; *Revoke* (after a confirmation, with a required reason) withdraws a declaration and keeps it on record (`revoked_at`, by whom, why).
  A declared winner cannot be removed as a nominee until the declaration is revoked. A revoked nominee can be declared again.
* **Award details page**: A. overview (award, month, totals, status: *No nominees yet* / *Nominations open* / *Winner declared*), B. nominees
  (name, department, designation / team, reason, date nominated, status *Nominated* / *Winner*, edit and remove), C. winners in a separate gold
  section (name, department / team, period, declaration date, remarks), plus the revoked declarations on request.

## Permissions

Only **HR staff** (the HR department, not HR Recruiters) and the **Super Admin** read or change awards: every function starts with
`private.award_require_hr()` (`private.is_hr_staff()`), and the tables have RLS on with no grants. Everyone else gets
`FORBIDDEN: Only HR staff manage awards.` Every change is written to the audit log (`HR_AWARD_NOMINATED`, `HR_AWARD_NOMINEE_UPDATED`,
`HR_AWARD_NOMINEE_REMOVED`, `HR_AWARD_WINNER_DECLARED`, `HR_AWARD_WINNER_UPDATED`, `HR_AWARD_WINNER_REVOKED`, with before / after where it applies).

## Database functions and API

| Function | Route |
| --- | --- |
| `hr_awards_overview(p_month)` | `GET /api/v1/hr/awards?month=YYYY-MM` |
| `hr_award_options()` | `GET /api/v1/hr/awards/options` |
| `hr_award_detail(p_category, p_month)` | `GET /api/v1/hr/awards/:code?month=YYYY-MM` |
| `hr_award_nominate(p_category, p_month, p_nominee_type, p_entity_id, p_reason, p_remarks)` | `POST /api/v1/hr/awards/:code/nominees` `{ month, nomineeType, entityId, reason, remarks? }` |
| `hr_award_update_nominee(p_nominee, p_reason, p_remarks)` | `POST /api/v1/hr/awards/nominees/:id/update` `{ reason, remarks? }` |
| `hr_award_remove_nominee(p_nominee, p_reason)` | `POST /api/v1/hr/awards/nominees/:id/remove` `{ reason? }` |
| `hr_award_declare_winners(p_nominees, p_remarks)` | `POST /api/v1/hr/awards/winners` `{ nomineeIds, remarks? }` |
| `hr_award_update_winner(p_winner, p_remarks)` | `POST /api/v1/hr/awards/winners/:id/update` `{ remarks }` |
| `hr_award_revoke_winner(p_winner, p_reason)` | `POST /api/v1/hr/awards/winners/:id/revoke` `{ reason }` |

Every change returns the award's detail as saved. Schemas: `shared/validation.ts` (HR Awards block); types: `shared/contracts.ts`.
Changes to one award and month are serialised with a row lock on its period, so two HR people adding the same nominee at once get one nomination.

## Tests

`supabase/tests/hr_awards_test.sql` (database rules and permissions), the *awards API* block in `supabase/tests/api_integration.test.ts`,
`supabase/tests/hr_awards.test.ts` (shared schemas) and `supabase/tests/ui_hr_awards.test.mjs` (browser: the menu order, the cards, the flows).

## Screen layout (HR UI redesign)

* **Award Management** opens under a breadcrumb (*Back to HR Dashboard / Award Management*) with one tab row: **Birthdays**, **Anniversaries**,
  **Awards**. **Nominate Star Award** sits at the right of that row (a secondary button): it opens Awards and the Add Nominee form with the
  award to choose. The KPI cards show only on the HR dashboard overview, so a workspace starts right under the header.
* **Awards** header: *Employee Recognition & Awards* with its subtitle, and one month control: previous month, the month shown (opens a
  month/year picker; months with award records carry a dot), next month, and *This month*. Under it, the month's totals and the award history.
* **Cards**: one per award, the same height whatever the title's length; 1 column on a phone, 2 on a tablet / narrow laptop, 3 from 1280px.
* **Manage Award**: Award overview, then Nominees (a table on wider screens, cards on a phone) and Winners (a quiet gold section; beside the
  nominees from 1536px).
* **Add Nominee** shows only what the nominee type needs: an employee's department, team and designation; a team's department and members; a
  department's members. All come from the CRM.
* **Declare Winner** is two steps: choose one or more nominees (and the remarks), then confirm the list before anything is saved.
