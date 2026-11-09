# Technical Consultant and Meta Verifier: two independent workflows

Migration: `supabase/migrations/20261215000100_consultant_meta_workflows.sql` (re-runnable; nothing is deleted or rewritten).

**Technical Consultant** = technical verification + add-on services + add-on purchase tracking + technical processing.
**Meta Verifier** = normal customer onboarding only (documents, verification, hand-over). It has no part in add-ons.

Both work on the **same customer record** (`customers`, `customer_onboarding`). Nothing is copied: each role has its own status field in `customer_workflow_status` (one row per customer), and its own history in `customer_workflow_events`.

## What changed in behaviour

* The Technical Consultant sees every customer Sales sends **from the start**, including customers on the Meta route (before: hidden until the Meta Verifier handed it over).
* The Technical Consultant keeps the customer **after** any hand-over: add-on requests, the purchase and the technical processing stay theirs (`private.can_consult_customer` no longer ends at the hand-over). Verification itself is unchanged: the Meta Verifier for a Meta customer, the Technical Consultant for the other route, closed at the hand-over.
* Completing Meta onboarding never changes or closes the Technical Consultant status.

## Statuses

| Technical Consultant | Set by |
| --- | --- |
| New Lead | the system (customer created) |
| Verification Pending / In Progress | the system from the onboarding records; the Technical Consultant may also choose them |
| Add-on Services Recommended | the system after the first verification is closed (or the add-on request is only a draft); also by hand |
| Waiting for Customer Purchase | the system: proposal with Accounts / invoice issued, nothing paid, a rejected payment, or the customer needs no add-ons; also by hand |
| Payment Confirmation Pending | the system: a payment is recorded and waits for Accounts |
| Add-on Purchased | the system: **Accounts confirmed the payment** (only confirmed purchases count) |
| Technical Processing | the system when the add-on documents are being processed; by hand only after Accounts confirmed |
| Completed | **only a person**, and only when the first verification is closed and no add-on request is open |
| On Hold | a person (reason required); never changed by the system |

| Meta Verifier | Source |
| --- | --- |
| Onboarding Pending / In Progress / Documents Pending / Verification Pending / Onboarding Completed / Rejected | **the existing Meta verification state** (`customer_onboarding.meta_status`, `set_meta_verification`) plus the onboarding records. Changing them goes through that function, so the client's journey and the hand-over rule stay as they were |
| On Hold | kept in `customer_workflow_status` (a person, reason required; never changed by the system) |

A Meta status exists only for a customer on the Meta route that Sales has sent. Every manual change is stored with who, when and why, and audited (`CUSTOMER_TC_STATUS_SET`, `CUSTOMER_META_STATUS_SET`). A status a person chose stays until the underlying records change again (then the system follows them), except On Hold.

Cancelled or rejected add-on requests and rejected payments move the Technical Consultant status back (Add-on Services Recommended / Waiting for Customer Purchase); a new add-on request re-opens a Completed customer. Several add-on services in one request, or several requests one after another, are handled by the same rules (the latest request decides).

## Who may do what (enforced in the database)

| Role | Reads | Changes |
| --- | --- | --- |
| Sales | both statuses of its own customer | nothing |
| Technical Consultant | both | the Technical Consultant status |
| Meta Verifier | both of the Meta customers of the department | the Meta status |
| Accounts | both (read) | nothing here; payment confirmation is Accounts' existing function |
| Department Head | both of the department | either |
| Super Admin | everything | either |

Tables have no direct access; `customer_workflow_get`, `customer_workflow_statuses`, `customer_workflow_set_tc` and `customer_workflow_set_meta` check the caller. Accounts' add-on request, invoice and payment functions are unchanged: this migration only reads them.

## API and screens

`GET /pipeline/customers/:id/workflow`, `GET /pipeline/workflow-statuses?ids=…`, `POST /pipeline/customers/:id/workflow/technical-consultant` and `/meta-verifier` (`{ status, note? }`). A *Workflow status* panel (both statuses, history, and a control only for the role allowed to change each) is on the Technical Consultant and Meta Verifier customer pages and on Sales' onboarding page (read only); the lists show the status chip of the dashboard's own role.

## Tests

`supabase/tests/consultant_meta_workflow_test.sql` (the eight scenarios, rejected payments, cancelled add-ons, incomplete onboarding, several add-ons, permissions, repeat runs), `api_integration.test.ts` ("Technical Consultant and Meta Verifier"), `supabase/tests/e2e/run-consultant-meta.sh`.

## Messaging services: the Meta Verifier owns the initial onboarding (migration 20261231000100)

The flow does not change: Sales -> Accounts -> Sales (documents) -> Meta Verifier + Technical Consultant, on one customer record.

**Root cause of a Messaging customer landing with the Technical Consultant.** The route is pinned when Sales first sends the customer
(`customer_onboarding.verification_route = private.computed_route`). `computed_route` read only `crm_services.requires_meta_verification`,
and that flag was seeded only inside "add the column if it is missing". So on a database where the column already existed, or where the flag
was switched later, a WhatsApp API customer was pinned to TECHNICAL. RCS Registration could not reach the Meta Verifier at all.
Separately, `mark_meta_verification_completed` accepted any Technical Consultant.

**Now:**
- **Who onboards (new flag).** `crm_services.meta_verifier_onboarding` ("the Meta Verifier onboards it") is set for WHATSAPP_API_BLUE_TICK,
  WHATSAPP_API, BLUE_TICK and RCS_REGISTRATION. It is kept apart from `requires_meta_verification` ("Meta approves it").
- **Meta approval.** The three WhatsApp services also need Meta approval. RCS does not: its client journey keeps "Verification by our team"
  and its own RCS milestones, with no false Meta step.
- **Route.** `computed_route` returns META when any service needs either flag. Everything that follows the route follows it: document review,
  Verify All, return to Sales, panel details (now including RCS: platform, account ID, panel URL), and the hand-over to the Department Head.
- **Customers already in verification.** Messaging customers already with the Technical Consultant and still in verification move to the
  META route, when their department has an active Meta Verifier. Documents keep their review state, and every move is in the activity log and
  the audit log, with the previous route. A department without a Meta Verifier stays as it was; `verification_route_review()` lists those
  customers for the Department Head or Super Admin.
- **What the Technical Consultant can no longer do for these customers.** Authorize or reject the initial documents (`FORBIDDEN`), use
  Verify All, return documents to Sales, hand over (`NOT_FOUND`, as before for the route owner's actions), record "Meta verification
  completed" (`FORBIDDEN`), change panel details, or set their own status to Verification Pending / In Progress (`FORBIDDEN`).
- **The Technical Consultant's status and screen.** Their status on this route reads New lead, shown as **Consultation**. The screen shows who
  owns the initial onboarding and hides those actions.
- **Mixed customers** (a Messaging service plus a separately bought TECHNICAL-track service). The Technical Consultant still authorizes the
  items that only those other services ask for (`private.tc_owns_onboarding_item`). The screen gets this list from
  `GET /pipeline/customers/:id/review-scope`. Each service keeps its own progress.
- **Unchanged.** The Technical Consultant keeps consultation, contact, follow-ups, notes, add-on proposals, the Accounts add-on hand-off,
  invoices and payments, add-on documents and technical processing. Department Head and Super Admin oversight is unchanged. Accounts still
  provisions the Client Dashboard login.

**Audit query for production (read only, run before and after the migration):**
```sql
select c.id, c.company, o.verification_route, o.handover_stage, array_agg(cs.service_code) as services
  from customers c join customer_onboarding o on o.customer_id = c.id join customer_services cs on cs.customer_id = c.id
 where c.lifecycle_stage = 'ONBOARDING' and o.forwarded_to_support_at is not null and o.handover_stage = 'CONSULTANT'
   and cs.service_code in ('WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK', 'RCS_REGISTRATION')
 group by 1, 2, 3, 4 order by 3, 2;
```
Tests: `supabase/tests/messaging_onboarding_test.sql`.
