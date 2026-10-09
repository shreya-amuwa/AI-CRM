# Team Leader dashboard

The first page a Team Lead sees (sidebar **Dashboard**). Everything comes from the database
through functions in `20261009100000_team_leader_dashboard.sql`; nothing is mocked.

## Scope (who the lead manages)
- **Team customers** — `customers.team_id` = the lead's team (the owner is the lead or one of
  their members; `team_id` follows the owner, existing rule).
- **Customers passed by the Department Head** — `customer_onboarding.team_lead_id` = the lead
  (the hand-over from `20261008000900_client_handover.sql`).

Each customer appears once. Its **assignee** is `owner_id` for team customers and
`team_member_id` for handed-over customers (the sales owner stays). A handed-over customer
still at stage `TEAM_LEAD` **needs a decision**. No new ownership fields were added.

## Sections
- **Header** — greeting, team, **Add Customer**; the bell is the layout's notifications.
- **KPIs** — Total, My customers, Team customers, Open tickets (+ high priority / escalated).
  Clicking a card filters the table below.
- **Customer assignment** — handled by me / by members / needs decision.
- **Team workload** — per active member: customers, open tickets, high priority; links filter
  customers or tickets by that member.
- **Needs attention** — decisions to make and open high-priority / escalated tickets.
- **Recent activity** — the latest `customer_activities` of the scope.
- **Customers** — server-side search (name, company, e-mail, phone, customer ID), status,
  assignment, member, sort, paging; **Change / Assign** (keep with me or a member of my team);
  click a name for the existing customer profile.
- **Tickets** — tickets of every customer in scope plus the team's own; status, priority,
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
