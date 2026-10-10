# Team Leader dashboard (Support)

The first page a **Support** Team Lead sees (sidebar **Dashboard**, route `/support-lead/dashboard/:id`). Everything comes from the database
through functions in `20261009100000_team_leader_dashboard.sql` (made Support-only by
`20261009200000_support_team_lead_only.sql`); nothing is mocked.

## Sales and Support Team Leads are separate

The generic database role stays `TEAM_HEAD`; the **team's division** decides the dashboard and
the data. The database stores the result in `profiles.default_dashboard`
(`20261009300000_separate_sales_support_team_leads.sql`), recomputed whenever the role or team
changes (or the team's division changes), so moving a lead from Sales to Support moves their
dashboard and their access with them.

| Department + role | `default_dashboard` | Route | Component |
|---|---|---|---|
| Sales + Team Lead | `sales-lead` | `/team-lead/dashboard/:id` | `TeamLeadDashboard` (Sales sidebar, unchanged) |
| Support + Team Lead | `support-lead` | `/support-lead/dashboard/:id[/:page]` | `SupportLeadDashboard` (this page + its own sidebar) |
| Sales + Team Member | `sales-member` | `/team-member/dashboard/:id` | `TeamMemberDashboard` (unchanged) |
| Support + Team Member | `support-member` | `/support-member/dashboard/:id[/:page]` | `SupportMemberDashboard` (unchanged) |

Support Team Lead sidebar (its own list, nothing shared with Sales): **Dashboard**, Customers,
Assigned Tasks, Tickets, Invoices, Client Hand-overs, Team Members & Access.

Route guards send each user back to their own dashboard when they open another department's
route (or another lead's id). The database enforces the same separation:

* `team_lead_*` functions answer only for a Support Team Lead (`FORBIDDEN` for Sales).
* Tasks are team-scoped (`work_tasks.team_id`); a lead can only assign members of their own team.
* Support tickets belong to a SUPPORT team only, can only be raised by Support staff (or a
  Department Head / Super Admin), and Sales staff cannot read tickets or their history.
* Support customers (`create_support_customer`) can only be added by Support staff, for Support staff.
* Invoice requests are raised by Support only; the customer's owner still reads them (they raise the invoice).

The client hand-over chain is Support only:

**Technical Consultant → Department Head → Support Team Lead → Support Team Member**

* `pass_to_team_lead` accepts only an active Team Lead of a **SUPPORT** team of the department
  (the Department Head's dialog lists only those).
* The Support Team Lead keeps the client or assigns it to a member of their own Support team
  (`assign_to_team_member` / `team_lead_assign_customer`).
* The Support Team Member sees the client under **My Clients** in the Support dashboard.

## Scope (who the lead manages)
- **Team customers** - `customers.team_id` = the lead's team (the owner is the lead or one of
  their members; `team_id` follows the owner, existing rule).
- **Customers passed by the Department Head** - `customer_onboarding.team_lead_id` = the lead
  (the hand-over from `20261008000900_client_handover.sql`).

Each customer appears once. Its **assignee** is `owner_id` for team customers and
`team_member_id` for handed-over customers (the sales owner stays). A handed-over customer
still at stage `TEAM_LEAD` **needs a decision**. No new ownership fields were added.

## Sections
- **Header** - greeting, team, **Add Customer**; the bell is the layout's notifications.
- **KPIs** - Total, My customers, Team customers, Open tickets (+ high priority / escalated).
  Clicking a card filters the table below.
- **Customer assignment** - handled by me / by members / needs decision.
- **Team workload** - per active member: customers, open tickets, high priority; links filter
  customers or tickets by that member.
- **Needs attention** - decisions to make and open high-priority / escalated tickets.
- **Recent activity** - the latest `customer_activities` of the scope.
- **Customers** - server-side search (name, company, e-mail, phone, customer ID), status,
  assignment, member, sort, paging; **Change / Assign** (keep with me or a member of my team);
  click a name for the existing customer profile.
- **Tickets** - tickets of every customer in scope plus the team's own; status, priority,
  assignee, search, paging; rows open the existing ticket detail. Tickets of another team on a
  customer in scope are **view only** (editing still follows `update_support_ticket`).

## Functions (caller always = `auth.uid()`)
| Function | Purpose |
| --- | --- |
| `team_lead_dashboard()` | KPIs, members' workload, decisions, alerts, recent activity |
| `team_lead_customers(search, status, assignment, member, sort, page, size)` | the customer table |
| `team_lead_tickets(search, status, priority, customer, assignee, sort, page, size)` | the ticket table |
| `team_lead_assign_customer(customer, assignee)` | keep with me / assign to a member of my team |
| `assign_to_team_member()` (updated) | a handed-over customer may also be kept by the lead |
| `create_support_customer()` (existing) | Add Customer, with validation and duplicate checks |

RLS adds read-only policies so a lead can open tickets (and their history) of customers in
scope. A Team Member calling these functions gets `FORBIDDEN`; another team's lead gets nothing.
Tests: `supabase/tests/rls_test.sql` section 21.
