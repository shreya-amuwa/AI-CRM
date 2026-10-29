# Client onboarding journey

A paying customer is no longer dropped into a fully open dashboard. After Accounts confirms the payment they sign in and
see a five-stage journey; each dashboard section opens only when the stage behind it is done. Everything below is decided
and enforced by the database and the API. The browser only shows what the server says, so a typed address, a hidden
route or a direct API call to a closed section is refused too.

```
Payment confirmed -> Client login -> Onboarding journey -> Meta verification -> Relationship Manager -> Service setup -> Completed
```

## What is reused (nothing is duplicated)

| Need | Where it lives |
| --- | --- |
| Journey state | `customer_onboarding` (`accounts_confirmed_at`, `meta_status`, `meta_feedback`, `meta_verifier_id`, `meta_started_at`, `meta_updated_at`, `meta_completed_at`, `onboarding_completed_at`) |
| Per-service setup | `customer_services.setup_status` (`PENDING` / `IN_PROGRESS` / `READY`) per purchased service |
| Meta documents | the existing customer documents and the existing consultant checklist (`WABA_ID`, ...) |
| Chat | the existing `chat_*` tables; a conversation is one row per `(customer_id, channel)` with `channel` = `META` or `RM` |
| Assignment | Meta Verifier = the customer's assigned **Technical Consultant** (least-busy of the department, overridable); Relationship Manager = the hand-over **Team Member**, with the **Team Lead** beside them |
| Audit | the existing audit log; every state change goes through a `SECURITY DEFINER` function that writes it |

Migrations: `20261205000100_client_onboarding_journey.sql` (state, rules, gating) and `20261205000200_client_stage_chat.sql`
(channel-aware chat).

## The five stages

1. **Account & payment confirmation** - completed when Accounts confirms the payment. The login is created at the same moment.
2. **Meta verification** - `PENDING`, `IN_PROGRESS`, `DOCUMENTS_REQUIRED`, `REJECTED`, `COMPLETED`. Shows instructions, the documents still
   needed (with the verifier's note per item), the verifier's feedback and a Message button. Only a Meta Verifier or an admin can move it, and
   `COMPLETED` is refused while a required item is missing. Uploading a document or paying never completes it.
3. **Relationship Manager** - opens when Meta verification is `COMPLETED` and a Team Member is assigned. The client sees the name and position only.
4. **Service setup & integration** - every purchased service has its own status. A service is `READY` only when the responsible team marks it
   (and, for Meta-dependent services, only after Meta verification).
5. **Onboarding completed** - set by the database the moment all of the above are true (and the date is kept). It opens the sections the client's services entitle them to.

Customers outside the journey (imported or existing customers, and anyone whose onboarding was already completed) are treated as completed:
every section stays open for them. A migration backfill applies this to existing data.

## Sign-in at payment confirmation

When Accounts confirms a payment the API creates the Supabase Auth user for the customer (a random password nobody knows) and e-mails a
set-password link; the client chooses their own password. Failures never undo the confirmation: the manual "Create client login" card and a
"Send set-password e-mail" button remain. The existing authentication is unchanged. Set `AUTO_CLIENT_LOGIN=off` to disable automatic creation.
No password is stored or sent in the automation outbox. The "account created" status e-mail/WhatsApp now follows Meta verification completing.

## Section access

| Section | Opens when |
| --- | --- |
| Overview, Onboarding Journey, Documents, Invoices, Chat, Notifications, Docs | always |
| My Services, Explore Services, Monthly Plans, Calendar, Campaigns, Tickets | onboarding completed (a section may still need an eligible service) |

Locked items stay visible and disabled with a reason ("Available after Meta verification"). The same rule is a database check
(`private.require_client_section`) inside every gated client function (a test asserts each gated function contains it), so a direct API
call returns 403 with that message. Staff calls to the same functions are not affected.

## Stage chat

* Before Meta verification completes the client talks to the assigned **Meta Verifier** (and can keep doing so while pending/rejected).
* Afterwards the client talks to the **Relationship Manager** (+ Team Lead). The Meta conversation stays, read-only and closed.
* The client only names a channel (`?channel=META|RM`). The server decides whether it is open, who answers, and who may write; it refuses
  any other combination. Histories are never merged, deleted or overwritten.

## API

Client: `GET /client/journey`, `GET/POST /client/chat?channel=...` (existing chat endpoints, channel-aware).
Staff: `GET /pipeline/customers/:id/journey-status`, `POST .../meta-verification`, `POST .../meta-verifier`, `GET .../meta-verifier/candidates`,
`POST .../services/:code/setup`, `POST /customers/:id/client-password-email`.

## Tests

`supabase/tests/client_journey_test.sql` (state machine, gating, RLS isolation, chat channels, backfill), the "client journey over the API"
block in `api_integration.test.ts`, and `ui_client_journey.test.mjs` (Playwright: locked items, typed URL, stage states, chat tabs, phone/tablet/desktop).
