# Wabastore Sales - Super Admin dashboard

Only the Super Admin sees this when entering Wabastore > Sales. The Department Head's Sales dashboard, Shreya's Sales Team Member dashboard and every other department are unchanged.

## Sidebar (in this order)
1. **Team Members** - the Wabastore Sales people (name, e-mail, role, status) from the database, with **Add Team Member** (the existing account-creation form).
2. **Access Control** - the existing member form (role, team) and access actions: suspend, revoke, restore, promote, remove. The API and database still enforce the hierarchy and approvals.
3. **Team Performance** - team members, leads added, open leads, moved on, follow-ups, lead status mix, and one row per member.
4. **Leads** - with the four numbered steps the Sales Team Member dashboard shows under My Leads: **1 Leads**, **2 Potential**, **3 Customer onboarding** and **4 Part payments**, each with its real count. Leads is the Sales Team Member lead list (search, service / source / member / follow-up filters, status tabs, paging) for every lead the team added, plus **Added by / Owner**. Open a lead for read-only details and its activity history. Leads are still created and worked by the Sales Team Members; the Super Admin cannot add leads here.

Notification Center stays last in the sidebar.

## What "Wabastore Sales" means in the data
The sub-department is a **department id + team division SALES** - never a name. A department can have several Sales-division teams; all of them count. Support teams and other departments are excluded.

## Metrics (all counts of real rows)
- Team members: active Team Leads / Team Members of those teams.
- Leads added: customers of those teams (per member: `customers.created_by`).
- Open leads and status mix: `lifecycle_stage = LEAD` and `lead_status`.
- Moved on: customers now at Potential, Onboarding or Customer (there is no "converted" lead status).
- Follow-ups: `next_follow_up_at` overdue / today / not set.
- Not tracked in the data yet: lead re-assignment history and completed follow-ups.

## Technical
- `public.division_leads_overview(department_id, division)` - Super Admin, or the Department Head of that department.
- `GET /api/v1/pipeline/division-overview?departmentId&division`
- `GET /api/v1/pipeline/customers` takes `departmentId`, `division`, `ownerId`; `GET /api/v1/users` takes `division`; leads now carry `createdBy`.
- Deploy: run `supabase/migrations/20261014000100_division_leads_overview.sql`.

## Customer onboarding and Part payments
- **3 Customer onboarding** is the Sales Team Member's onboarding list (status tabs, search, service / member filters, document-progress cards) for the sub-department's ONBOARDING customers, view only, with who added each. Collecting documents and running the onboarding stay with the Sales Team Members.
- **4 Part payments** is the Sales Team Member's part-payments list (Balance due / Fully paid / Returned to leads / All, search, salesperson and date filters), read only, limited to the sub-department with `part_payments_list(..., p_department, p_division)`.
- Counts come from `division_leads_overview` (`onboarding`, `partPayments`). Deploy: `supabase/migrations/20261017000100_division_pipeline_counts.sql`.

## Potential
**2 Potential** is the Sales Team Member's Potential screen (payment cards, search, service / member filters, sort), view only, for the sub-department's POTENTIAL customers with **Added by / Owner**. Confirming payments and starting onboarding stay with the Sales Team Members.

# Wabastore Support - Super Admin dashboard

Same structure as Sales, with the Support workflow instead of leads. Only the Super Admin sees it; the Support Team Member and Support Team Lead dashboards are unchanged.

Sidebar: **Team Members**, **Access Control**, **Team Performance**, **Customers**, **Tickets** (Notification Center last).
- Team Members / Access Control: the same member management, listing the Support-division teams (Technical Consultant is offered here).
- Team Performance: team members, customers, open / completed tickets, escalated, ticket status mix, tasks, and one row per member (customers added / owned, tickets by status, tasks) from `division_support_overview()`.
- Customers and Tickets: the existing Support supervisor screens, limited to the Support teams (`team_id` of the Support division). No Add customer for the Super Admin.
- The Support sub-department is department id + team division SUPPORT. No Sales member, lead or customer appears.
- Not tracked: ticket response / resolution times (no service-level targets are stored).

Deploy: run `supabase/migrations/20261015000100_division_overviews.sql` (after `20261014000100_division_leads_overview.sql`).

## Removed from every dashboard
The "CRM Network / ONLINE" card at the bottom of the sidebar and the "CLOUD: ACTIVE / LOCAL" badge in the header (both shared layout components).
