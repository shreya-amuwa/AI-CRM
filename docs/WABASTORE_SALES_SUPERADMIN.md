# Wabastore Sales - Super Admin dashboard

Only the Super Admin sees this when entering Wabastore > Sales. The Department Head's Sales dashboard, Shreya's Sales Team Member dashboard and every other department are unchanged.

## Sidebar (in this order)
1. **Team Members** - the Wabastore Sales people (name, e-mail, role, status) from the database, with **Add Team Member** (the existing account-creation form).
2. **Access Control** - the existing member form (role, team) and access actions: suspend, revoke, restore, promote, remove. The API and database still enforce the hierarchy and approvals.
3. **Team Performance** - team members, leads added, open leads, moved on, follow-ups, lead status mix, and one row per member.
4. **Leads** - the Sales Team Member lead list (search, service / source / member / follow-up filters, status tabs, paging) for every lead the team added, plus **Added by / Owner**. Open a lead for read-only details and its activity history. Leads are still created and worked by the Sales Team Members; the Super Admin cannot add leads here.

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
