# Company Workflow (Super Admin)

**Super Admin -> Company Workflow** draws the whole company as one diagram: every department, its teams (sub-departments), its Department Head, Team Leads and members, and the hand-offs that already exist between them. It is read from the live records every time it opens, so a new department, team or person, or a changed assignment, appears on the next read. Nothing in the picture is typed in.

Migration: `20261112000300_company_workflow.sql` (adds one read-only function, safe to run again). Run it after `20261112000200_paid_only_invoices.sql`.

> The Wabastore Support Head's "Support Flow & Lifecycle" page (a fixed description of the six support stages) is a different screen and is unchanged.

## What is drawn

| Box | Comes from |
| --- | --- |
| Department | every row of `departments` (name, colour, locked, staff and customer counts) |
| Department Head | active `profiles` with role Department Head |
| Team (sub-department) | every row of `teams`, with its division (Sales / Support / General), Team Lead(s), member count |
| Technical Consultants | active members of a Support team with `is_technical_consultant` (the box exists only when there are consultants) |

Grey solid lines are **reporting** (Super Admin -> department -> head -> team -> consultants). Coloured dashed arrows are **hand-offs**, each with the number of records that have passed through that step:

| Kind | Hand-off (already in the CRM) | Counted from |
| --- | --- | --- |
| Payment confirmation | Sales / Support team -> Accounts (**Send to Accounts**), Accounts -> back to the team (**Confirm payment and return**) | `payment_requests`, `customers.payment_workflow` |
| Add-on services | Technical Consultants -> Accounts (price and payment of an extra service) | `service_requests` in the add-on workflow |
| Onboarding hand-over | team -> Technical Consultants -> Department Head -> Team Lead (-> member) | `customer_onboarding` (`with_consultant`, `handover_stage`, `team_lead_id`, `team_member_id`) |
| Service delivery | team -> the department that delivers a service that needs no consultant | `crm_services.delivery_department_id`, `customer_services.sent_to_delivery_at` |
| Ticket escalation | Support team -> Department Head (member -> Team Lead -> Department Head) | `support_tickets.escalation_level` |
| Work tasks | Department Head -> Team Lead | `work_tasks` (top-level tasks) |
| Leave approval | Department Head -> HR | `leave_requests` |

An arrow is drawn only when both ends exist: a department with no Technical Consultant gets no consultant arrow, an empty department shows as empty with nothing invented inside it, and Accounts / HR are found by their slug (`accounts`, `hr`) exactly as the rest of the CRM finds them.

## Using it

* **Overview** (default): all departments, collapsed. Open or close a department with its arrow, or **Expand all / Collapse all**.
* **Department** filter: one department, expanded, plus the departments it exchanges work with. **Sub-department** narrows to one team.
* **Hand-offs** chips turn kinds of arrow on or off; **Hide steps with no records** (on by default) removes arrows with a count of 0.
* Click a department, team, role box or arrow for the people and the connected processes. Arrows between collapsed departments merge into one (a neutral colour when several kinds share it).
* Zoom with the buttons, pinch, or Ctrl + scroll; drag to pan; **Fit to screen** shows everything. On a phone it opens fitted to the width and is moved up and down.

## Who can see it and what it returns

`GET /dashboard/company-workflow` -> `company_workflow()`: **Super Admin only** (everyone else gets 403, a signed-out visitor 401). Department Heads, Team Leads and members have their own scoped overviews; they are not given this one. The function returns department, team and person **names, roles and job titles only**: no e-mail, phone, password, token or credential.

## Tests

* `supabase/tests/workflow_test.sql` (section 56): every department, team, lead, member and head is in the result once; every hand-off ends on a real department, team or consultant group; the counts equal the real records (Send to Accounts, Confirm payment, Pass to Team Lead); nothing sensitive is returned; a department created in the test shows up with no change to anything; a department without a consultant gets no consultant arrow; who may read it.
* `supabase/tests/workflow_layout.test.ts` (`npm run test:unit`): the diagram builder (collapse/expand, merging, department and team filters, empty company, removed teams, fit to screen).
* `supabase/tests/api_integration.test.ts`: the endpoint's access rules and shape.
