# Field Visit (Sales Telecaller, Business Associate, Sales Team Member)

Field Visit is a sidebar group **inside** the existing Telecaller, Business Associate and Sales Team Member dashboards (no separate dashboard):
Field Visit Overview, Department Head Assigned Leads, Add Lead, All Leads, My Leads, Department Leads, To Accounts, Returned by Accounts,
My Field Visits, Visit History. The Sales Department Head assigns a lead for a visit from **Leads > Lead List > Field visit**.

Run `supabase/run_this_sales_field_visits.sql` (the migration `20261203000100_sales_field_visits.sql`) once in the Supabase SQL editor.
It is additive and safe to run again. It needs the lead-filter migrations (`run_this_lead_scope_filters.sql`,
`run_this_lead_scope_sales_members.sql`) to have been run.

## Data
| Table | What |
|---|---|
| `lead_visit_assignments` | A Department Head hands a lead to an employee for a visit (priority, instructions). At most one ACTIVE assignment per lead. The lead **keeps its owner**. |
| `lead_visits` | One row per visit (never overwritten): date, planned time, address, purpose, status SCHEDULED / IN_PROGRESS / COMPLETED / FOLLOW_UP_REQUIRED / CANCELLED, outcome, notes, requirements, next steps, follow-up date, cancel reason, check-in position. Unique `(employee_id, client_request_id)` so a retry or double click returns the same visit. |

The live trip tracker (`public.field_visits`) is untouched. Both tables have row level security that allows `select` only (the employee sees their
own visits, the owner sees visits of their lead, the head sees their department's); every write goes through a `security definer` function.
`gps_captured` is true only when valid coordinates were sent at start; the UI says "captured by the device", never "verified".

## Functions (all `security definer`, `search_path = ''`, executable by `authenticated` only)
Employee (active Telecaller, Business Associate or Sales member with no Sales role, via `private.require_field_visit_user()`): `field_visit_overview`,
`field_visit_leads_list`, `field_visit_assigned_list`, `field_visit_list`, `field_visit_schedule`, `field_visit_update`, `field_visit_start`,
`field_visit_complete`, `field_visit_cancel`. Sales Department Head (`private.require_sales_head()`): `sales_visit_assignees`, `sales_visit_assign`,
`sales_visit_assignment_cancel`.

Rules enforced in the database: a visit can be planned only for the person's own lead or a lead actively assigned to them (still a LEAD of their
department); past dates are refused; a started visit cannot be rescheduled; starting twice changes nothing; finishing a visit sets the lead's next
follow-up only when the person owns the lead; no function changes `owner_id`, `payment_workflow` or any Accounts row.

## API (`/api/v1/field-visits`)
`GET /overview`, `GET /leads?filter&search&sort&page&pageSize`, `GET /assigned`, `GET /` (`scope=OPEN|HISTORY|ALL`, `status`, `leadId`),
`POST /`, `PATCH /:id`, `POST /:id/start|complete|cancel`; head only: `GET /assignees`, `POST /assignments`, `DELETE /assignments/:leadId`.
Validation is in `shared/validation.ts` (strict schemas: unknown fields are refused, so a visit cannot be made "for" somebody else).

## Filters
`ALL`, `MINE`, `DEPARTMENT`, `TO_ACCOUNTS`, `RETURNED` reuse `private.lead_scope_ids`. `DH_ASSIGNED`: an ACTIVE assignment to me. `VISIT_PENDING`: an ACTIVE
assignment with no non-cancelled visit since it was made. `VISIT_SCHEDULED`: my SCHEDULED / IN_PROGRESS visit. `VISIT_COMPLETED`: a COMPLETED visit of mine.
`FOLLOW_UP`: my latest finished visit of the lead is FOLLOW_UP_REQUIRED. Every number beside a filter counts the same function the table reads.

## Tests
`supabase/tests/field_visit_test.sql` (database), the "Field Visit" block of `supabase/tests/api_integration.test.ts` (API), and the browser test
`supabase/tests/e2e/field-visit.e2e.mjs` (`run-field-visit.sh`): the three dashboards, the Department Head assignment, GPS granted / refused, history,
permissions, the Accounts workflow, tablet and phone widths.

## Not included / notes
* A visit's optional `taskId` (link to a work task) is accepted by the API but the screens do not offer it yet.
* Assigning a lead sends the employee a notification (`FIELD_VISIT_ASSIGNED`); visits themselves are not shown on the calendar pages and send no reminders yet.
* GPS is the browser's position at start; there is no route tracking for these visits (the older trip tracker is separate).
