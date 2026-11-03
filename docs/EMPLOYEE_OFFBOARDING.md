# Employee offboarding and work reassignment

Migration `20261223000400_employee_offboarding.sql` (additive, safe to run twice). Before this, `set_user_status` only changed the status: customers, verifications, tasks and a Team Lead's people stayed
attached to someone who had left and nothing listed them.

## The flow (Staff management -> *Offboard* on a person; Super Admin, Operations Head, Department Head - the same rule as a status change)

1. **Impact summary** (`GET /users/:id/offboarding-impact`, read-only): the person's role, department and team, and what is attached - clients they look after as Team Member / Team Lead, unfinished Meta verifications, customers they own, open
   tasks, people who report to them, reports waiting for their review, ongoing client conversations - plus the **active colleagues who could take it** (a Team Member -> a Team Member under the same Team Lead; a Team Lead -> another
   Team Lead of the team; a Meta Verifier -> a verifier who covers the department; a Technical Consultant -> a consultant of the department). Nothing is chosen for you.
2. **Offboard** (`POST /users/:id/offboard { replacementId?, status: SUSPENDED | REVOKED, reason }`) - ONE database transaction: the work moves to the chosen colleague (an item the replacement cannot take, such as a verification of a department they do not cover,
   or all of it when nobody is chosen, goes to the **Reassignment Required queue**), then the account is closed and the offboarding is audited (what moved, what was queued). A failure moves nothing and leaves the account as it was. The API then blocks sign-in as for any status change.
3. **Reassignment Required queue** (`GET /reassignment-queue`, `POST /reassignment-queue/:id/resolve { toId }`): visible to the Super Admin, the Department Head of the department and the Operations Head who owns it; each item is assigned to an eligible colleague
   (a Support Team Member / Team Lead of the customer's department, a verifier who covers it, a Team Lead for a member, anybody of the department for a task) and the assignment is audited.

## What moves, by role

| Leaves | With a replacement | Without / not eligible |
| --- | --- | --- |
| Team Member | their clients (hand-over member), open tasks, owned customers of the same team | client / task items in the queue |
| Team Lead | their people (`manager_id`) with their **pending** reports, the clients they supervise, their own open tasks | clients, people (`MEMBER_LEAD`), tasks in the queue |
| Meta Verifier | the unfinished verifications the replacement may verify | those verifications become unassigned and are queued |
| Technical Consultant | open tasks (the consultant checklist stays with the customer) | queued |
| Department Head | nothing is moved to an arbitrary person | the department is queued (`DEPARTMENT_HEAD`) and the Operations Head / Super Admin are notified that it needs an interim or new head |

## Guarantees

* Access ends at once (a suspended or revoked account is not an active profile: chats, customers, reports and the scope functions refuse it); **nothing is deleted** - customers, chat history, reports, evidence and audit stay.
* Approvals are never made on anybody's behalf: pending reports **move** to the new lead and wait for a decision; decided and approved reports and their history are untouched (the earlier reviewer stays on the record).
* Historical ownership is in the audit log (`from -> to`); a replacement has to be an active, eligible colleague and is checked by the database, not only by the screen.

## Tests

`supabase/tests/employee_offboarding_test.sql` (section 123): the impact summary and its candidates, who may ask, refused offboardings change nothing, Team Member / Team Lead / verifier / Department Head leaving, the queue (visibility, resolving, wrong kind of colleague, audit), revoked access.
Also the offboarding checks in `api_integration.test.ts`.
