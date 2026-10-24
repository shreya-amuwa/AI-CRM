# Shared and combined Department Heads

Two kinds of Department Head exist beyond "one head, one department, one side":

| Kind | Who | What they get |
| --- | --- | --- |
| **Group A – shared head** | one Sales Department Head and one Support Department Head that serve several departments | a department picker after login and a **Department** drop-down in the header; every list, count, task, ticket, report and the sidebar follows the chosen department; Sales and Support permissions stay separate |
| **Group B – combined head** | one person handles both Sales and Support of one department | one dashboard with a **Dashboard View: Sales \| Support** selector; the department stays the same, the sidebar, navigation and content change with the view |

Nothing about *which* departments are in Group A or Group B is hard-coded. It is data, set by the Super Admin, and the database enforces it.

## 0. Wabatalk (D Talk's Support department)

**D Talk is the Sales department. Wabatalk is the Support department of D Talk.** D Talk's Support is looked after by the same Support Department Head who looks after Wabastore, Whatsbox and Wabastar (a shared Support head, Group A).

Migration `20261124000100_wabatalk_support_department.sql` (run it after `20261123000100_department_scopes.sql`; safe to run again):

* creates the department **Wabatalk** (slug `wabatalk`) if no department of that name exists – an existing one is linked, never renamed – and links it to the department with the slug `dtalk` as its **Support side** (`departments.facet_of` / `facet_division`). If no `dtalk` department exists, nothing is created.
* **People, teams, customers and tickets stay in D Talk.** The customer a D Talk salesperson sold is the same customer D Talk's Support looks after, and every access rule of the CRM is built around that one shared department; splitting it in two would hide each customer from the other half. Wabatalk therefore has no teams of its own.
* **Heads:** the Super Admin gives the shared Support head **Wabatalk** (Support) in *Departments & functions* – the same way as Wabastore, Whatsbox and Wabastar. The picker and the header show *Wabatalk* as a department; the database turns it into "D Talk, Support" for every access rule, so the head sees D Talk's Support team, customers, tickets and tasks and nothing of D Talk's Sales side. D Talk's Support cannot be granted under the name D Talk (the Super Admin is told to give Wabatalk), and Wabatalk can only be given for Support.
* **Revenue:** every order belongs to the department of the division that earns it. Support's orders (add-ons, renewals, monthly plans, Client Dashboard purchases the rule gives to Support, a first sale to a customer Support acquired) are recorded in **Wabatalk**; Sales' orders in **D Talk**. This is applied when an order is first recorded, in every ledger/order/income function, in the Accounts department income, the Super Admin dashboard, the business reports and the manual correction (`set_order_attribution`). A Sales head's income report is D Talk's; the shared Support head working in Wabatalk gets Wabatalk's.
* **History:** orders recorded before Wabatalk existed as *D Talk / Support* are moved to Wabatalk by the migration (a notice says how many); D Talk's Sales orders stay. Nothing else is moved, and a second run changes nothing.
* The sign-up page and the department hub list real departments only, not Wabatalk; Accounts' income and expense screens list it.
* Other departments (Wabastore, Whatsbox, Wabastar, Digitree, M Pillar, …) have no sides: their Sales and Support revenue both stay in the department, exactly as before.

Not changed: the Super Admin dashboard's head-count, customer and ticket columns for the D Talk row still count D Talk's Sales **and** Support people and customers (they live there); the Wabatalk row there shows Wabatalk's income and expenses. If Wabatalk already existed in your database with people or teams of its own, run the audit query below first – those are not moved.

## Add Team Member: one account, several departments (Super Admin)

Why a single department was not enough: `profiles.department_id` holds ONE department per person, and every access rule compares it with a row's department. A shared Department Head therefore needed a second table for the extra departments (`department_access`, migration `20261123000100`); the form only created the head for one department, so the Super Admin had to create the account and then open *Departments & functions*. The form now does it in one step.

* **Add Team Member > Role: Department Head** shows **Department Head of** (Sales Department Head / Support Department Head / Sales & Support - one person handles both) and **Departments this head manages**: checkboxes plus removable chips. The first chosen department is the **home** department (*make home* changes it). At least one is required; departments that have no team of the chosen function are disabled with the reason; D Talk's Support is offered as **Wabatalk**.
* The department list at the top of the window is now labelled **Show members of**: it only chooses whose members are listed, not what the new account manages.
* Saving creates **one** login. The API (`POST /users`) takes `departmentId` (home), `headDivision` and `additionalAccess: [{ departmentId, division }]` (Super Admin only). Every pair is checked by the database BEFORE the account exists (`public.department_access_check`, which uses the same rule as `department_access_set`), so a wrong pair creates nothing; the grants are then written as the Super Admin and audited. If a grant fails after all, the new account is deleted again.
* **Changing a head later:** *Departments & functions* in the member list (Super Admin). Removing a pair removes the access immediately (the next request is refused); no account is created or changed.
* **The list** (Whole department): heads who work in the department without being placed in it are listed too (*Shared head · home department …*), and a head with several departments shows *Works in: A (Sales), B (Support) …* (`public.department_heads_overview`, which only the Super Admin and a head who works in that department can read).
* One-per-side rule: the department a head is PLACED in still has one Sales and one Support head; extra departments are access, not placement.

## 1. Audit first (read-only)

Run this in the Supabase SQL editor to see the departments, their teams and their heads as they really are. Use the result to decide the Group A / Group B split – do not guess from the names.

```sql
select d.slug, d.name,
       count(*) filter (where t.division = 'SALES')   as sales_teams,
       count(*) filter (where t.division = 'SUPPORT') as support_teams,
       (select string_agg(p.full_name || ' (' || coalesce(p.head_division::text, 'no side') || ')', ', ')
          from public.profiles p
         where p.department_id = d.id and p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE') as heads
  from public.departments d
  left join public.teams t on t.department_id = d.id
 group by d.id, d.slug, d.name
 order by d.name;

-- grants already given
select p.full_name, d.name as department, a.division
  from public.department_access a
  join public.profiles p on p.id = a.profile_id
  join public.departments d on d.id = a.department_id
 order by p.full_name, d.name, a.division;
```

A department can only be granted for a function it has a team for (a Sales grant needs a SALES team, a Support grant a SUPPORT team). The seed data gives Sales and Support teams to Wabastore, Whatsbox, D Talk, Digitree and M Pillar; other departments only have a General team until Sales / Support teams are created.

## 2. Assigning (Super Admin only)

* Open **Team Members & Access**, find the Department Head, click **Departments & functions**, tick the (department, function) pairs. Each tick is one row in `department_access`; every change is written to the audit log (`DEPARTMENT_ACCESS_GRANTED` / `DEPARTMENT_ACCESS_REVOKED`).
* **Group A (Support head):** home department Wabastar (or any of the three), then tick **Support** for Whatsbox, Wabastore (if not home), and **Wabatalk**. The Sales head ticks **Sales** for the other two. (Wabastar needs a Support team before it can be ticked.)
* **Group A:** make a Department Head, set their side (Sales head / Support head), and tick the other departments for that same function. One Sales head and one Support head can be ticked into the same three departments.
* **Group B:** make a Department Head with *no side set* in that department, tick **Sales** and **Support** for the department. (A head with no side already sees the whole department; the ticks make both views selectable.)
* The head's own department is always available; revoking a pair removes it immediately.

The same can be done through the API: `GET /api/v1/users/:id/department-access`, `POST /api/v1/users/:id/department-access` with `{ departmentId, division, granted }`. Only the Super Admin may call these, and the target must be an active Department Head.

## 3. How a request is scoped

1. The browser remembers the choice (`localStorage`, per user) and sends it with each API and Supabase REST request as `X-Active-Department` / `X-Active-Division`.
2. The database reads those headers (`private.request_header`) and validates them against what the head is authorised for (home department plus `department_access` rows). Anything not authorised, malformed or missing **falls back to the head's own scope** – the headers never grant anything.
3. `private.my_department_id()`, `private.is_sales_head()`, `private.is_support_head()` and `private.sales_scope_team()` use the *active* scope, so RLS, the RPCs (assigning customers/tickets/tasks, announcements, SLA settings, creating staff…) and the Hono policies (`api_session` returns the active department) all act on the active department only.
4. Super Admin, HR, Accounts, Team Leads, Team Members and Clients are untouched: the scope applies to Department Heads only. A head with a single scope sends no headers and behaves exactly as before.

## 4. What the user sees

* **After login** a head with several departments sees department cards (name, icon, functions) and picks one. The pick is remembered for the browser session.
* **Header**: a *Department* drop-down (Group A) and/or *Dashboard View* Sales | Support control (Group B), under the top bar, responsive down to phone width. Switching remounts the dashboard so no data of the previous scope stays on screen; no polling is used.
* **Sidebar / routes**: derived from the active scope. If the open page does not exist in the new view, the dashboard opens that view's default page.
* **Unsaved forms**: switching asks for confirmation when a form has unsaved input.

## 5. Deploying

1. Apply `supabase/migrations/20261123000100_department_scopes.sql` in the Supabase SQL editor (safe to rerun; it ends with `notify pgrst, 'reload schema'`).
2. Deploy the app (API + frontend).
3. As Super Admin, grant the (department, function) pairs from §2.

## 6. Limitations

* **Realtime:** Supabase Realtime evaluates RLS without request headers, so live push updates only arrive for the head's home scope. Switching department/view refetches everything, so data is always correct after a switch; only live push for a non-home scope is missing.
* **Support heads** with a side now read Support-team rows only (previously a labelled Support head's database scope was unchanged); heads with no side keep whole-department access.
* A Group B head's first view is Sales unless they previously chose Support.
* The unsaved-form guard watches all form inputs (the app had no common form convention).
