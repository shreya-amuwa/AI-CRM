# Sales and Support Department Heads

A department can have **one Department Head for each side**: a Sales head and a Support head. The Support head keeps the Department Head
dashboard. The Sales head opens their own [Sales Department Head dashboard](SALES_DEPARTMENT_HEAD.md) and sees the Sales teams only.
The side is a label stored on the person and shown in the member list.

## Creating one
Super Admin → **Add Team Member** → pick the department → Role **Department Head** → **Department Head of** → *Sales* or *Support*.
The choice is required for a Department Head and is not shown for other roles. A side that already has a head is greyed out with the
holder's name.

## Rules
- One head per department **and side** (suspended heads count; revoked / rejected do not). A SALES head can sit next to a SUPPORT head.
- Heads created before this change have no side. They keep working, still block a second *unlabelled* head, and the Super Admin can set
  their side in the member list (**No side set** → Sales / Support). The database refuses a side that is already taken.
- Only the Super Admin sets a side. Moving someone out of the Department Head role clears it.

## Technical
- Migration `20261120000100_department_head_division.sql` (single paste: `supabase/run_this_department_head_division.sql`): `profiles.head_division`,
  per-side `private.department_head_of`, the one-head trigger, `assert_can_create_user(..., p_head_division)`, `set_head_division(profile, side)`, and
  `provisioned_head_division` read by `private.provision_auth_user`.
- API: `POST /users` accepts `headDivision` (Department Head only); `POST /users/:id/head-division` `{ division: 'SALES' | 'SUPPORT' | null }`.
- Tests: `supabase/tests/department_head_division_test.sql`, the API block in `api_integration.test.ts`, `e2e/department-head-division.e2e.mjs`.
