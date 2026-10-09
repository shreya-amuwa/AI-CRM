# Support Team Member dashboard

Opens for a **team member of a Support team** who is not a Technical Consultant. Sales team members, other departments and Technical Consultants keep their own dashboards.

| Who | Dashboard |
| --- | --- |
| Team member, Support team | Support Team Member dashboard (`/support-member/dashboard/:id`) |
| Team member, Support team, marked Technical Consultant | Technical Consultant dashboard |
| Team member, Sales team | Sales Team Member dashboard |
| Team member, any other team | Team Member dashboard |
| Team lead | Team Lead dashboard (Support leads also get **Support Customers** and **Support Tickets**) |
| Department head | Department Head dashboard (**Support Desk** page) |

The dashboard comes from the person's role and team (`profiles.role`, `teams.division`, `profiles.is_technical_consultant`) and is stored in `profiles.default_dashboard`, kept in step by a trigger. Moving someone to another team changes their dashboard; nobody is created twice.

## Pages (sidebar order)
1. **Dashboard — Existing Customers** — customers assigned to the member plus post-sale customers of the department; search, status filter, customer profile (details, communication, tickets, tasks, invoices).
2. **Assigned Tasks** — tasks from the Team Lead (`work_tasks`): Pending / In Progress / Blocked / Completed, history with who updated.
3. **Add Customer** — `create_support_customer()`; validates, refuses duplicate e-mail / phone, gives a customer ID (`CUS-00001`).
4. **Tickets** — `support_tickets` + `support_ticket_updates`; create, update, escalate; lead assigns / reassigns / closes.
5. **Invoices** — read-only list of invoices linked to the member's customers (`member_invoices.customer_id`).

## Security
Everything is enforced in the database (RLS + functions), not only in the UI:
- tickets and tasks are visible to the assignee, creator, the team lead of the team, the department head of the department and the Super Admin;
- Support team members cannot insert, update or delete invoices (restrictive policies);
- Support staff only read **post-sale** (`CUSTOMER` stage) customers of their own department, never leads or other departments.

Migration: `supabase/migrations/20261009000100_support_member_dashboard.sql` (idempotent; run the whole file).
