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
| Assignment | Meta Verifier = an active **Meta Verifier** of the customer's department on the META route (WhatsApp services), the **Technical Consultant** on the other route (`private.is_verifier_for`); the least busy one is assigned when the payment is confirmed and a Department Head can change it. Relationship Manager = the hand-over **Team Member**, with the **Team Lead** beside them |
| Login | Accounts' existing flow (`accounts_client_login_begin` -> create the Auth user -> `record_client_account`, `ACCOUNT_CREATED` e-mail with a one-time set-password link) |
| Meta completed | the existing `meta_completed_at` / `mark_meta_verification_completed` event, kept in step with the journey status by a trigger |
| Audit | the existing audit log; every state change goes through a `SECURITY DEFINER` function that writes it |

Migrations (after the Meta Verifier / client login migrations of `docs/ROLES_AND_LIFECYCLE.md`): `20261209000100_client_onboarding_journey.sql` (state, rules, gating) and `20261209000200_client_stage_chat.sql`
(channel-aware chat). Re-runnable; no table is dropped and nothing is deleted.

## The five stages

1. **Account & payment confirmation** - completed when Accounts confirms the payment. The login is created at the same moment.
2. **Meta verification** - `PENDING`, `IN_PROGRESS`, `DOCUMENTS_REQUIRED`, `REJECTED`, `COMPLETED`. Shows instructions, the documents still
   needed (with the verifier's note per item), the verifier's feedback and a Message button. Only the customer's verifier (Meta Verifier / Technical Consultant of the department), the Department Head or the Super Admin can move it, and
   `COMPLETED` is refused while a required item is missing or the payment/login is missing. The hand-over to the Department Head (which brings the Relationship Manager) is refused until it is completed. Uploading a document or paying never completes it.
3. **Relationship Manager** - opens when Meta verification is `COMPLETED` and a Team Member is assigned. The client sees the name and position only.
4. **Service setup & integration** - every purchased service has its own status. A service is `READY` only when the responsible team marks it
   (and, for Meta-dependent services, only after Meta verification).
5. **Onboarding completed** - set by the database the moment all of the above are true (and the date is kept). It opens the sections the client's services entitle them to.

Customers outside the journey (imported or existing customers, and anyone whose onboarding was already completed) are treated as completed:
every section stays open for them. A migration backfill applies this to existing data.

## Sign-in at payment confirmation

Confirming the payment and returning the customer to Sales (`POST /pipeline/customers/:id/accounts/payment-confirmed`) does **not** make the
client's login and does **not** send the "set your password" e-mail. Accounts creates the login from **Client Logins** (or the journey's
"Create login" step; `accountsCreateClientLogin`, method LINK): the e-mail comes from the customer record, the login gets a random password
nobody knows, and the client receives the one-time set-password e-mail then. The confirmation answer says `LATER` for the login.
Set `AUTO_CLIENT_LOGIN=on` to make the login at confirmation as well (the previous behaviour). No password is stored or sent in the outbox, and the
"Meta Verification completed" message follows Meta verification, not the login.

## Where the e-mail links point

Every link in a client e-mail starts at `APP_URL` (default `https://crm.amuwacorporation.com`): the sign-in page `/client/login` and the
set-password link `/client/set-password?token_hash=...&type=recovery`. The set-password link goes straight to the CRM, not through Supabase's own
redirect, so Supabase's *Site URL* / *Redirect URLs* settings no longer matter for it. The token is used only when the client presses
"Save password", so an e-mail scanner that opens the link does not use it up. An expired or used link shows "This link has expired" with a
way back to sign in ("Forgot password?").

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
`POST .../services/:code/setup` (existing: `meta-verification-completed`, Client Logins).

## Tests

`supabase/tests/client_journey_test.sql` (state machine, gating, RLS isolation, chat channels, backfill), the "client journey over the API"
block in `api_integration.test.ts`, and `ui_client_journey.test.mjs` (Playwright: locked items, typed URL, stage states, chat tabs, phone/tablet/desktop).

## Service-specific steps and automatic status
The five stages above stay the overall summary, but each purchased service now has its own steps and track (Meta, Technical Consultant or direct delivery, from the
service's own catalogue flags), the verification stage is called "Meta verification" only when Meta verifies a purchased service (otherwise "Verification by our team"), every step's
state is derived from stored facts, the overall percentage counts only the applicable required steps, and service setup starts by itself once payment, verification and the Relationship Manager
are done ("ready" stays a person's authorised action). The Meta decision itself is recorded once, idempotently and with its Meta reference (`record_meta_outcome`); it is never inferred from documents.
See `docs/SERVICE_SPECIFIC_JOURNEYS.md`.
