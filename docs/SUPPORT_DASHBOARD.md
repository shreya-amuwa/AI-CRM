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
1. **Dashboard - Existing Customers** - customers assigned to the member plus post-sale customers of the department; search, status filter, customer profile (details, communication, tickets, tasks, invoices).
2. **Assigned Tasks** - tasks from the Team Lead (`work_tasks`): Pending / In Progress / Blocked / Completed, history with who updated.
3. **Add Customer** - `create_support_customer()`; service / product from the services catalog (`crm_services`); choosing WhatsApp API shows campaigns sent and the message package (bought / sent / remaining). Validates, refuses duplicate e-mail / phone, gives a customer ID (`CUS-00001`), then returns to Existing Customers. Each row has **Edit** (`update_support_customer()`) for the assigned member, their team lead and the department head.
4. **Tickets** - members see three columns: Pending, Waiting for customer reply, Complete. Tickets are opened from a customer's profile; team leads can also create them from Support Tickets, and assign / reassign / close them.
5. **Invoices** - read-only list of invoices linked to the member's customers (`member_invoices.customer_id`), plus **Invoice requests**: customer, from month, to month and an optional note (`request_invoice()`); the team lead, department head and the customer's owner are notified.

## Security
Everything is enforced in the database (RLS + functions), not only in the UI:
- tickets and tasks are visible to the assignee, creator, the team lead of the team, the department head of the department and the Super Admin;
- Support team members cannot insert, update or delete invoices (restrictive policies);
- Support staff only read **post-sale** (`CUSTOMER` stage) customers of their own department, never leads or other departments.

Migrations (idempotent; run each whole file, in order): `20261009000100_support_member_dashboard.sql`, `20261009000200_support_customer_services_invoice_requests.sql`.
