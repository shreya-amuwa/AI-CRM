# Meta Verifier: several departments

One Meta Verifier account can verify Meta customers for **several departments**: the **home department** (always) plus the **extra departments** an Operations Head or the Super Admin adds.
Migration: `20261223000300_meta_verifier_departments.sql` (additive, safe to run twice).

## What it is - and is not

* It is a **verification scope**: the Meta-route customers of those departments that are in the verification stage, exactly what a verifier already had for the home department.
* It is **not** Operations Head ownership. The person stays a Team Member with the verifier flag: no Department Head approvals, no employee management, no finance, no broad customer access
  (a customer of another route, or one that is not in verification, stays invisible; payments stay unreadable).

## How it works

* Table `meta_verifier_departments (profile_id, department_id, granted_by, granted_at)` (RLS on, no grants). `private.verifier_departments_of` = the home department (a Support Meta Verifier or Team Lead, as before)
  plus the extras of an **active** Meta Verifier; `private.verifier_covers(profile, dept)` and `private.in_verifier_scope(dept)` answer from it **live**, so changes apply at once.
* Every check that compared a customer's department with the one value `my_verifier_department_id()` now uses the scope: `can_review_onboarding`, `can_view_onboarding_review`, the `customers_select_review` policy,
  `can_correct_onboarding_item`, `wf_can_meta`, `panel_details_list`, `is_verifier_for` (who may be assigned), `pick_meta_verifier` (automatic assignment: only eligible active verifiers with the department in scope, none -> unassigned)
  and the META half of `chat_my_clients`.
* `verifier_departments_get(profile)` / `verifier_departments_set(profile, extra departments)`: the Super Admin, or the **Operations Head who owns the verifier's department and every department added** (a Department Head
  who is not an Operations Head, a Sales member or the verifier themselves cannot). Only an active Meta Verifier can have extras; the home department is implicit and cannot be listed or removed. Every change is audited
  (`META_VERIFIER_SCOPE_CHANGED`, from / to).
* **Taking a department away:** the access ends immediately, and the verifier's unfinished verifications in that department are re-picked among the eligible verifiers (audited `META_VERIFIER_REASSIGNED`, the new verifier and the old one
  are notified) or are left unassigned for a head to assign; nothing is deleted and the verification history stays.
* API: `GET|POST /users/:id/verifier-departments` (`{ departmentIds }`, extras only). UI: *Verification departments* on a Meta Verifier row (Super Admin, Operations Head), the multi-select reuses the Operations Head department picker.

## Choosing the departments when the verifier is created, and Sales of those departments

Migration: `20261227000100_meta_verifier_cross_department_routing.sql` (safe to run twice).

* **Add Team Member:** the *Department* field is a drop-down of the departments (the same list as the selector at the top right) for the Super Admin. When the role is **Meta Verifier**, the Super Admin or an Operations Head
  also gets *Other departments this Meta Verifier verifies for*: the chosen department is the home department, every department ticked there is added in the same step (`POST /users` with `verifierDepartmentIds`;
  refused for anybody who is not a Meta Verifier, and the account is removed again if the departments cannot be saved).
* **Sales sending a customer on:** `private.forward_to_consultant` and `onboarding_handoff_info` now look for an active Meta Verifier who **verifies for** the customer's department (`private.verifier_covers`),
  wherever the verifier is placed. Before, Sales of a department whose verifier sits in another department was refused with "This department has no active Meta Verifier". Every verifier covering the
  department is notified, plus the department's Support Team Leads, as before. The Technical Consultant route is unchanged.
* Tests: `supabase/tests/meta_verifier_routing_test.sql`, and the "verifier creation" block of `api_integration.test.ts`.

## Tests

`supabase/tests/meta_verifier_departments_test.sql` (section 122): home-only before; who may change it (verifier, Sales, a plain Department Head, an Operations Head who does not own a department, a non-verifier); access after (Meta customers of
the three departments, not the technical-route customer, not an unscoped department); no management or finance rights; automatic assignment; removal; suspension; the audit trail. Also the "verifier departments" and chat blocks of `api_integration.test.ts`.
