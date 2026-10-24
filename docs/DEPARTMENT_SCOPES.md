# Shared and combined Department Heads

Two kinds of Department Head exist beyond "one head, one department, one side":

| Kind | Who | What they get |
| --- | --- | --- |
| **Group A – shared head** | one Sales Department Head and one Support Department Head that serve several departments | a department picker after login and a **Department** drop-down in the header; every list, count, task, ticket, report and the sidebar follows the chosen department; Sales and Support permissions stay separate |
| **Group B – combined head** | one person handles both Sales and Support of one department | one dashboard with a **Dashboard View: Sales \| Support** selector; the department stays the same, the sidebar, navigation and content change with the view |

Nothing about *which* departments are in Group A or Group B is hard-coded. It is data, set by the Super Admin, and the database enforces it.

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
