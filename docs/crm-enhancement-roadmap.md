# CRM enhancement roadmap (six phases)

Status: **Phase 0 complete and approved (decisions D1–D9 approved as recommended). Phase 1 in progress: part 1 of 4 (core + Sales Department Head) done.**
Branch of the audit: `claude/crm-enhancement-roadmap` (from `main` at `70fd7741`). Baseline on that commit: `npm run typecheck` and `npm run build` pass.
There is no lint script in this repository (`package.json` has none), so "run linting" cannot be executed until one is added.

Each phase ships as its own pull request(s), after approval, with its own migration(s) (`supabase/migrations/`, additive and re-runnable, per
`AGENTS.md`), tests and a completion report. Nothing is deployed or applied to the production database by these pull requests; the owner runs the
listed migrations.

## Role names used below

| This document | In the CRM (internal key) |
| --- | --- |
| Managing Director / Super Admin | `SUPER_ADMIN` |
| CEO, Sales / Support Operations Head | `DEPARTMENT_HEAD` + `is_operations_head` (scope per department and function) |
| Department Head | `DEPARTMENT_HEAD` (`head_division` SALES / SUPPORT) |
| Team Leader | `TEAM_HEAD` |
| Team Member, Sales Executive | `TEAM_MEMBER` (Sales Executive = Sales team member, Telecaller, Business Associate) |
| Accountant | Team Member / Team Lead of the Accounts department (`accounts-staff`) and the Accounts Department Head |
| Meta Verifier, Technical Consultant | Support team members with `is_meta_verifier` / `is_technical_consultant` |
| HR | HR department staff (`is_hr_staff`; recruiters excluded) |

---

## Phase 0: audit summary (what exists and is reused)

| Area | What exists today | Where |
| --- | --- | --- |
| Architecture | React + Vite + Tailwind frontend; Hono API (route → controller → service with Zod → repository → `security definer` function); Supabase PostgreSQL with RLS; Cloudflare Worker (static files + API + crons every 5 min, 09:00 and 10:30 IST) | `AGENTS.md`, `docs/ARCHITECTURE.md`, `server/routes.ts`, `worker/` |
| In-app feedback | **A central toast + confirmation + input-dialog system already exists**: success / error / warning / info, auto-dismiss (4/5/7/9 s), manual dismiss, de-duplication (same message refreshes "×2"), at most 4 toasts, mobile placement at the top, safe error messages (`userMessage`), in-dialog actions that run once. No browser `alert/confirm/prompt` is left (the remaining matches are local functions and Apps Script text). | `src/components/feedback/AppFeedback.tsx`, `src/lib/feedback/feedbackStore.ts`, `src/lib/feedback/errors.ts`, `docs/APP_FEEDBACK_SYSTEM.md`, test `no_native_dialogs` |
| Customers and leads | One `customers` table for every stage (`lifecycle_stage` LEAD → POTENTIAL → ONBOARDING → CUSTOMER / LOST). `phone`, `email` and a separate `whatsapp` column (all optional today). Duplicate check on phone / e-mail inside a department (`private.find_duplicate_customer`). Services per customer in `customer_services` (multiple services, no duplicate customer). | migrations `20261007000300`, `20261009400000` |
| Customer creation entry points (latest definitions) | `create_lead`, `create_support_customer` (Support "Add Customer"), `import_customer_data` (existing-customer import), `sales_lead_sheet_assign` (sheet upload), `private.customer_from_inbound_lead` (website / webhook enquiries), `create_support_ticket` (a ticket for a new contact), `private.croc_reconcile_one` (Crocodial dialler). Stage changes: `move_customer_to_potential`, `start_customer_onboarding`, `accounts_confirm_and_return`, `send_to_delivery_departments`. Also the Google Sheet sync (`/customers/sheet-sync`). | `supabase/migrations/*` |
| Origin tracking | **Already recorded and protected**: `customers.acquisition_division` (SALES / SUPPORT), `acquisition_department_id`, `acquired_by`, written at creation from the owner's team, never changed by reassignment (trigger), corrected only by Accounts / Super Admin with a reason (audited). Current assignment: `owner_id`, `team_id`, `customer_onboarding.team_lead_id / team_member_id`. | `20261114000100_revenue_attribution.sql` |
| Accounts and verification flow | Sales / Support pipeline → Accounts confirms payment and creates the client login → route pinned per customer (`crm_services.requires_meta_verification`, `requires_technical_consultant`) → Meta Verifier (WhatsApp services) or Technical Consultant → `send_to_department_head` → Department Head → Team Lead → Team Member; hand-over queue, reconciliation, audit. | `docs/ROLES_AND_LIFECYCLE.md`, `docs/CLIENT_ONBOARDING_JOURNEY.md`, `20261209000600_department_head_handover_queue.sql` |
| Support "Add Customer" | Creates the customer **directly at the CUSTOMER stage**, assigned to a Support member (no payment confirmation, no verification). Support members also have the full lead pipeline (My Leads → Potential → Customer Onboarding), which goes through Accounts and verification like Sales. | `create_support_customer`, Support member dashboard |
| Customer automations | Onboarding e-mail + WhatsApp per stage: `automation_jobs` (QUEUED / SENDING / SENT / FAILED / SKIPPED / CANCELLED, attempts, lock, dedupe key `ONBOARD|customer|channel|stage`); "send this step's messages again" for the Technical Consultant (`consultant_resend_client_messages`). Lead welcome WhatsApp: `lead_whatsapp_dispatches` (one per lead, statuses incl. ACCEPTED / DELIVERED / SKIPPED, "Send again" once a number is added). Invoice WhatsApp: `invoice_whatsapp_dispatches`. Every e-mail: central log `email_messages` / `email_attempts` / `email_events` (Resend primary, SES fallback, delivery webhooks, suppressions). Consent: `customer_message_optout` (per customer and channel). | `20261016000100`, `20261016000200`, `20270104000200`, `20261129000100`, `20270201000100`, `20261128000100` |
| Contact validation | `shared/contactValidation.ts`: `cleanIndianMobile` / `mobileProblem` (Indian mobiles only), `normalizeWebsite`; the same helper in forms, API and sender. | `shared/contactValidation.ts` |
| OCR | On-device Tesseract.js (English data served from `/ocr/`), photo preparation, sign / card text parser (`shopText.ts`) with "not sure, please check" flags. Used by **Add Lead** (`LeadForms.tsx`) and **Field Visit** forms. Photos are not stored as files today. | `src/lib/ocr/*`, `src/components/common/ShopPhotoScan.tsx`, `docs/FIELD_VISIT_PHOTO_SCAN.md` |
| Files | Private Supabase Storage with signed single-use upload links and short-lived download links (issues, tickets, HR documents, customer documents). | upload routes in `server/routes.ts` |
| Notifications | `notifications` + bell + push outbox with retries (`notification_delivery_attempts`), device registration, notice pop-ups (`NoticePopupHost`) shown once per notice. | `docs/NOTIFICATION_RELIABILITY.md` |
| Employee data | `profiles` (account, role, status, phone), `hr_employees`, `employee_personal_details` (date of birth, joining date), designations. | HR migrations `20261027000100`, `20261103000100` |
| Birthdays / anniversaries | **E-mails already sent by the backend** at 09:00 IST, once per employee per year, completed years from the real joining date, inactive excluded, 29 Feb → 28 Feb in a common year, missing data listed for HR (`hr_email_events`, `GET /hr/email-automation/data-issues`). HR has Birthdays and Anniversaries pages under Award Management. No in-app pop-up, no WhatsApp. | `docs/HR_EMAIL_AUTOMATION.md`, `server/automations/hrTemplates.ts` |
| Field visits and live location | `lead_visits` (SCHEDULED / IN_PROGRESS / COMPLETED / FOLLOW_UP_REQUIRED / CANCELLED), live location only during an active visit with consent (`lead_visit_locations`, `lead_visit_tracking_events`, `tracking_status`), server checks (own visit, active, rate, max points, no future points), offline queue (200 points), Live / Stale / Offline, OpenStreetMap map + Google Maps link, realtime limited by row rules, audited views, 90-day retention. Viewers: the employee, direct Team Lead, Sales Department Head, Sales Operations Head (scope), HR. | `docs/FIELD_VISIT.md`, `20261228000100_field_visit_tracking_and_lead_routing.sql` |
| Scheduled jobs | Worker crons (`wrangler.jsonc`) call `/internal/automations/dispatch` and the reminders run; everything idempotent and database-driven (no admin needs to open the CRM). | `worker/index.ts`, `server/app.ts` |
| Google Maps | Server-side geocoding only (`GOOGLE_MAPS_API_KEY`, optional). No browser Maps JavaScript / Places key today. | `server/automations/attendancePlaces.ts` |

**Main conclusion:** much of what the six phases ask for already exists. Each phase below extends the existing system instead of building a second one.

---

## Phase 1: Global toast notification system

**Current status.** The central system exists and meets most requirements (see above). **Problems found:**
1. **Adoption is low.** Only 17 of 473 components call `toast.*`. About 238 components show their own inline success / error text with
   different wording, places and colours, and some actions give no feedback at all.
2. **No loading state.** There is no "Saving…" / "Uploading…" toast that turns into success or error.
3. **No global offline signal.** A network failure is reported per screen ("Cannot reach the server") but nothing says "You are offline".
4. **Double-submission protection is per screen** and not used everywhere.

**Proposed solution (reuse, no new library):**
* Extend `feedbackStore` with a `loading` kind and `toast.promise(promise, { loading, success, error })`: one toast that changes state in place,
  never dismissed while loading, success only after the server's answer, the error message through `userMessage`.
* Add a small `useSubmit` helper (busy flag + one call at a time + toast) for forms and action buttons.
* Global `online` / `offline` listener: one persistent "You are offline" warning, cleared when the connection returns.
* Map the API's error codes to clear defaults (`FORBIDDEN` → "You do not have permission…", `NETWORK_ERROR` → "Internet connection unavailable",
  `CONFLICT` duplicates → warning) inside `userMessage`.
* **Integrate dashboard by dashboard** (in this order: Sales Department Head, Team Lead, Team Member / Telecaller / Business Associate,
  Support member / lead, Accounts, Meta Verifier / Technical Consultant, HR, AI Studio, AI Design Studio, Field Visit, Super Admin). Inline
  field validation stays inline (that is the documented rule); only action results move to toasts.
* Split into 3–4 pull requests (core + Sales, Support + Accounts + verification, HR + studios + field visit, Super Admin + leftovers).

**Files.** `src/lib/feedback/*`, `src/components/feedback/AppFeedback.tsx`, then the dashboards' action handlers (`src/components/**`).
**Database / API.** None. **Permissions.** None.
**Risks.** Many files touched (merge conflicts with parallel work): kept to handler code, one dashboard group per PR. Duplicate feedback
(inline + toast) while migrating: each screen is switched completely.
**Tests.** Unit tests for the store (loading → success / error, de-duplication, offline); existing `ui_app_feedback` browser test extended;
each migrated dashboard's browser test checks the toast after a stubbed success / failure / 403 / network error and that double clicks send once.
**Acceptance.** Every major action on the listed dashboards shows success only after the server answers, a clear error otherwise, a loading
state for slow actions, no duplicate submission; no raw database text; works on phone widths.

---

## Phase 2: Mandatory customer contact details and automation re-trigger

**Current status.** E-mail and phone are optional everywhere. "Phone **or** e-mail" is required by `create_support_customer`; there is a
separate `whatsapp` column, falling back to `phone`. Automations skip a channel when the address is missing or invalid (recorded as SKIPPED).
A Technical Consultant can re-queue the current onboarding stage's messages; the lead welcome WhatsApp has "Send again". Accountants have no
communication history and no retry.

**Problems found.** Customers become paying customers with no usable WhatsApp number or e-mail; skipped messages are not visible to Accounts;
the four message logs (onboarding jobs, lead WhatsApp, invoice WhatsApp, e-mail log) are separate; WhatsApp validation is Indian-only.

**Proposed solution.**
1. **Validation** (shared, one implementation): extend `shared/contactValidation.ts` with an international WhatsApp normaliser (E.164;
   default +91 when no country code; Indian rules kept for +91) and use the existing e-mail check. Same Zod schemas in forms and services; the
   database functions check again.
2. **Where it is mandatory:** when a record becomes a customer or enters the paid pipeline: `move_customer_to_potential`,
   `start_customer_onboarding`, `create_support_customer`, conversions in `import_customer_data` (new customers only, see decision D2).
   Leads (`create_lead`, sheets, enquiries, Crocodial) may stay incomplete as drafts. Existing customers are **not** blocked or changed.
3. **Existing records:** a "Missing contact information" indicator (computed, no constraint) on customer lists and details; an authorized
   correction action for Accounts / the owner / their leads, audited (before / after); a report for the Super Admin. A `NOT VALID` check
   constraint or `not null` is added only in a later migration, after the data is cleaned and only with approval.
4. **Communication history (Accounts customer details):** a read-only database function that combines `automation_jobs`,
   `lead_whatsapp_dispatches`, `invoice_whatsapp_dispatches` and `email_messages` for one customer into one list (automation, channel,
   masked recipient, created / last attempt, status mapped to Pending / Processing / Sent / Delivered / Failed / Skipped / Cancelled / Delivery
   status unknown, failure reason, attempts). "Delivered" only where the provider confirms it (e-mail webhook, Wabastore status); the WhatsApp
   router webhook only gives "accepted" → shown as **Delivery status unknown**.
5. **Re-trigger** (`accounts_retry_communication(p_kind, p_id)`): only FAILED or SKIPPED entries; never SENT / DELIVERED / ACCEPTED (unknown
   ones are reconciled first where the provider allows, otherwise refused with an explanation); uses the customer's **current** validated
   address; respects `customer_message_optout`; re-queues through the **existing** dispatcher of that channel (same dedupe key family, a new
   attempt row, `for update` lock so two accountants cannot retry together, one retry per entry per minute, at most N per accountant per hour);
   records who, when, what and the outcome (audit + the channel's own events). Retrying never re-runs payment confirmation, customer creation or
   stage changes.
6. **Who may retry:** Accounts staff and the Accounts Department Head for customers they can already see; Super Admin. Not Sales / Support
   members (they keep their existing "Send again" where it exists).

**Files.** `shared/contactValidation.ts`, `shared/validation.ts`, the customer forms (Add Lead, Add Customer, conversion screens, import),
`src/components/accounts/AccountsCustomerDetails.tsx`, `server/routes.ts` + controller / service / repository for accounts communications,
the automation dispatchers (only to accept a manual retry), new migration(s).
**Database.** New migration: validation in the listed functions (create or replace from their latest definitions), the history and retry
functions, a `communication_retries` record **or** reuse of each channel's attempts table + audit (preferred: reuse; decided during build),
indexes on `(customer_id, created_at)` where missing. No constraint on existing rows.
**API.** `GET /accounts/customers/:id/communications`, `POST /accounts/customers/:id/communications/:kind/:entryId/retry`,
`PATCH /customers/:id/contact` (authorized correction).
**Risks.** Blocking a conversion that used to work (sales staff may be surprised: clear messages and the indicator); WhatsApp templates are
Meta-approved for Indian numbers: international numbers are validated but sending abroad needs the template / sender to allow it (decision
D3); retrying a message whose first attempt actually arrived (unknown status) → never retried automatically.
**Tests.** SQL: mandatory fields at each finalizing function, drafts allowed, legacy rows untouched, history merge, retry rules (only failed /
skipped, opt-out, lock, rate limit, unauthorized accountant of another scope, Sales / Support refused), audit rows. API: 200 / 403 / 409 / 422.
Browser: form highlights, indicator, history, retry button states. Dry-run mode for every channel during tests (no real messages).
**Acceptance.** No new customer can reach Potential / Onboarding / Customer without a valid e-mail and WhatsApp number; legacy customers are
flagged, not broken; the accountant sees every automation of a customer and can trigger a skipped or failed one exactly once, safely.

---

## Phase 3: Support-originated customer workflow

**Current status.** Origin is already recorded (`acquisition_division`, `acquired_by`, `acquisition_department_id`, immutable). Support
members' pipeline customers go through Accounts → Meta Verifier / Technical Consultant → `send_to_department_head` → Department Head → Team
Lead → Team Member, exactly like Sales. Support's "Add Customer" creates an active customer directly (no payment, no verification).

**Problem.** A customer a Support member acquired goes back through the Department Head and Team Lead queues after verification, and may end
up with someone else.

**Proposed solution.**
* **Origin:** reuse the three acquisition columns; add only `acquisition_team_id` (nullable, filled by the same trigger) if the team must be
  kept; a read-only `customer_origin` view value (SALES / SUPPORT / IMPORT / ENQUIRY / OTHER). No new ownership field; `owner_id` /
  `customer_onboarding.team_member_id` stay the current assignment.
* **The direct route** in `send_to_department_head` (and the Meta Verifier's completion path): when `acquisition_division = 'SUPPORT'` and the
  acquiring employee is **eligible** (active, still a Support member of the customer's department, allowed to work the service), assign the
  customer straight to them (handover stage completed, `team_member_id` / owner set, their Team Lead recorded for oversight), notify them, the
  Team Lead and the Department Head (information only), audit `HANDOVER_DIRECT_TO_ACQUIRER`. The Meta Verifier sees no manual forwarding
  choice for these customers.
* **Otherwise** (resigned, inactive, transferred, no permission, missing record): the existing Department Head hand-over queue, with the
  reason shown ("Original Support member is inactive").
* **Unchanged:** payment confirmation, documents, route pinning, Meta verification, the Technical Consultant follow-up, automations, the
  whole Sales route, management visibility (heads and leads keep seeing these customers in their scope and reports).
* **Payment pending / rejected, Meta failed:** the customer simply does not reach the hand-over step (existing gates). **Several services:**
  the hand-over is per customer (existing model); a later service bought through Support follows the existing add-on flow. **Existing
  customer:** the duplicate check stops a second record.

**Files.** New migration (create or replace `send_to_department_head`, the Meta completion function, eligibility helper), `docs/ROLES_AND_LIFECYCLE.md`,
the hand-over and verifier screens (hide the forward choice, show "Assigned to the acquiring Support member"), tests.
**API.** No new route expected; existing hand-over responses gain `routedTo` / `reason`.
**Permissions.** No new rights. Ordinary employees still cannot change origin (only `set_customer_acquisition`, Accounts / Super Admin, audited).
**Risks.** Hand-over code is central: changed only behind the `SUPPORT` condition, with the Sales route covered by the existing tests;
customers already in flight are not moved (the rule applies at the next hand-over step).
**Tests.** SQL: support-acquired → direct to acquirer; each ineligibility case → Department Head queue with reason; Sales unchanged;
payment / Meta gates still block; audit and notifications; nobody else can trigger it.
**Acceptance.** A Support-acquired customer reaches the acquiring member automatically after Accounts and (where needed) Meta verification,
without passing the Operations Head, Department Head or Team Lead queues; ineligible cases fall back safely; Sales flow unchanged.

---

## Phase 4: AI-powered lead capture and drafts

**Current status.** On-device OCR fills the Add Lead and Field Visit forms from a photo (English); uncertain fields are flagged; the photo is
not kept; there are no lead drafts.

**Proposed solution.**
* **Quick Capture** card on the Sales Executive dashboards (Sales team member / Business Associate, Telecaller, Sales Team Lead): Add Lead
  manually, Scan visiting card, Scan business poster, Upload image, View drafts. Mobile camera via `<input capture>` (no new library).
* **Drafts = leads not yet finalized.** Preferred: a `lead_drafts` table (owner, department, image file id, extracted fields as JSON with a
  confidence per field, status Draft / Processing / Extraction completed / Needs review / Extraction failed / Converted, converted customer id).
  A draft is **not** a customer row, so it never appears in pipelines, reports or automations until submitted (no separate lead database: on
  submit it becomes a normal lead through the existing `create_lead`).
* **Image:** uploaded first to private Storage (existing signed-upload pattern, size and type checked; same file reused if the hash is the
  same), so an OCR failure never loses it; OCR runs on the phone (existing Tesseract), result saved to the draft; Retry OCR and manual edit.
  Optional later: server-side fallback (Google Cloud Vision) only with approval and a key (decision D5).
* **Extraction:** extend `shopText.ts` for cards (name vs company, designation, several phones, e-mail, website, address, city, category);
  never fabricate; never mark a number as WhatsApp unless the card says so; low confidence = "Needs review".
* **Duplicates:** before submit, the existing `find_duplicate_customer` (normalized phone / e-mail, plus a phone check across the person's
  department) lists possible matches; no automatic merge.
* **Field Visit:** the visit's photo scan saves through the same draft path (Phase 6 completion screen links to it).
* **Offline:** if the upload fails, the draft is kept in the browser (IndexedDB) and clearly marked "Saved on this device only, not yet in the
  CRM" until synced; never a false server confirmation.

**Database.** New migration: `lead_drafts`, its functions (create / update / list own / delete / submit), RLS (own drafts; Team Lead and
Department Head read in scope), storage bucket policy reuse. **API.** `/lead-drafts` CRUD + `/lead-drafts/:id/submit` + upload begin / complete.
**Permissions.** Sales staff own drafts; leads / heads read in scope; no access across departments.
**Risks.** OCR quality on real cards (flagged fields, manual review); storage growth (size limit, retention for converted / deleted drafts);
privacy of captured contacts (private bucket, scoped RLS).
**Tests.** Parser unit tests on synthetic cards / posters; SQL for scoping, submit → one lead, duplicate listing, no automation before submit;
browser test with a drawn card under the production CSP; offline mode.
**Acceptance.** A Sales Executive can photograph a card, get a draft with flagged fields, edit it later and submit one lead (after the
duplicate check), on a phone, without losing the image if OCR fails.

---

## Phase 5: Birthday and work anniversary automation

**Current status.** Birthday and anniversary **e-mails** are already sent by the backend (09:00 IST, once per year, completed years, inactive
excluded, leap-day rule, data issues listed). No in-app pop-up, no WhatsApp, no delivery / retry view for HR.

**Proposed solution (extend the HR automation, no second scheduler or employee table):**
* **Time:** a setting (`crm_settings` / HR automation settings) with default **10:00 IST** (today's code uses 09:00: change of behaviour, decision
  D6); the existing 5-minute cron run sends when the time has passed (no dependence on punch-in or anyone opening the CRM). Optional "shift
  start" mode only if shifts are recorded per employee (they are not today → documented as a later option).
* **Channels:** e-mail (existing), **WhatsApp** through the existing Wabastore sender with an approved Meta template (needs template approval:
  decision D7), **in-app** as a celebration record shown once per event when the employee opens the CRM (a pop-up host like the notice pop-up;
  "seen" stored so it does not reappear on every page).
* **Once per employee, event, year and channel** (dedupe keys in the existing `hr_email_events` style, extended with a channel), failures retryable,
  missing data recorded without stopping the run, both events on one day allowed, leap-day policy made a setting (28 Feb default as today, or 1 Mar).
* **Templates:** the wording from the request as the default, editable by HR (with placeholders), per company branding.
* **HR section:** today's / upcoming birthdays and anniversaries, delivery status per channel, failures with Retry (HR only; date of birth shown
  as day and month only, never to other employees).

**Database.** Migration: settings, channel-aware event records (extend, not replace), celebration "seen" records, functions for the HR view and
retry. **API.** `/hr/celebrations` (list, status, retry), `/me/celebrations` (the employee's own pop-up). **Permissions.** HR staff; the
employee sees only their own pop-up.
**Risks.** Sending to real employees during tests (dry-run mode and test recipients only); WhatsApp template approval delay (WhatsApp ships
switched off until approved).
**Tests.** SQL / unit: due logic (timezone, leap day, completed years, inactive, both events), idempotency per channel, retry; browser: pop-up
once, dismiss, not on other pages; HR view permissions.
**Acceptance.** On the event day each active employee gets one e-mail, one WhatsApp (once enabled) and one in-app pop-up per event; HR sees
status and can retry failures; nothing is sent twice.

---

## Phase 6: Field visitor live GPS tracking

**Current status.** Most of the requested tracking already exists (see audit), with honest browser limits and privacy rules.

**Gaps against the request.**
1. Destination selection with **Google Maps Places** and a suggested route (today: typed address, OpenStreetMap map, Google Maps link).
2. Visit statuses Travelling / Arrived / Meeting in progress (today: SCHEDULED / IN_PROGRESS / COMPLETED / FOLLOW_UP_REQUIRED / CANCELLED).
3. **Destination check-in** with proximity and accuracy checks, distance, and an exception request.
4. Expected duration, ad hoc visit for a new contact (partly exists), completion form linked to Quick Capture (Phase 4).
5. A **multi-employee live map**, suggested route vs actual recorded route clearly distinguished.
6. Viewer scope: add the **Support** side (Support Department Head / Support Operations Head) only if Support staff do field visits (decision D8).
7. Adaptive interval (15–30 s moving, slower when still): today ~25 m / 60 s with a 15 s floor; made configurable.

**Proposed solution.** Extend `lead_visits` (new nullable columns: destination place id / coordinates, expected duration, arrived_at, arrival
distance / accuracy, check-in exception reason / status) and a `visit_stage` (TRAVELLING / ARRIVED / MEETING) separate from the existing status and
from the tracking health; keep every existing function; add check-in and exception functions; keep the tracking endpoints (accept points only for
active visits, already enforced; stop acceptance on completion, already enforced). Maps: a **browser key restricted by HTTP referrer and API**
(Maps JavaScript + Places + Directions), loaded only on the visit and tracking pages, CSP widened only for Google Maps origins; one route
request per visit start (cached), never per GPS point. If no key is configured, the current OpenStreetMap view stays.

**Background tracking.** The CRM is a web app / PWA: positions are reported only while the page is open. That stays documented and visible.
Reliable background tracking would need a native Android / iOS app (foreground service / background location permission). Documented as a
separate recommendation, not implemented.

**Risks.** Google Maps billing (quotas and alerts in Google Cloud; owner action); privacy (policy and employee notice before production use);
CSP change scope. **Tests.** SQL: check-in rules, exceptions, scope (Support side if approved), stop acceptance; unit: adaptive interval, staleness;
browser: map with and without a key (stubbed), check-in flows, mobile.
**Acceptance.** Managers in scope see live / stale positions, destination, suggested and actual routes on one map; employees can check in at
the destination with validation or request an exception; nothing is tracked outside an active visit.

---

## Decisions needed before / during the phases

| # | Phase | Question | My recommendation |
| --- | --- | --- | --- |
| D1 | 1 | Migrate inline success / error messages to toasts on every dashboard (many files, several PRs)? | Yes, dashboard group by group; keep inline field validation. |
| D2 | 2 | Existing-customer **imports** and the Google Sheet sync: require e-mail + WhatsApp (rows without them refused) or import and flag them? | Import and flag (they are existing customers, not new sales). |
| D3 | 2 | International WhatsApp numbers: accept and store them, while automated WhatsApp stays limited to what the approved templates / sender allow? | Yes; show "Automated WhatsApp not available for this country" when the sender cannot send. |
| D4 | 3 | Support's direct **Add Customer** (creates an active customer without payment): keep it for registering existing customers, while **new** acquisitions must use the pipeline (Accounts → verification → direct assignment)? | Keep it, label it "Register an existing customer", and route new sales through the pipeline. |
| D5 | 4 | Server-side OCR fallback (Google Cloud Vision, paid after 1,000 images / month) or on-device only? | On-device first; add the fallback later if real cards read badly. |
| D6 | 5 | Move the existing birthday / anniversary e-mail from 09:00 to 10:00 IST? | Yes, as a setting with default 10:00. |
| D7 | 5 | WhatsApp wishes need an approved Meta template and the Wabastore sender: who submits it? | Owner submits; the channel stays off until approved. |
| D8 | 6 | Do Support staff do field visits (add Support Department Head / Support Operations Head as viewers)? | Only if yes; otherwise keep the Sales scope. |
| D9 | 6 | Google Maps browser key (Maps JS, Places, Directions) with billing alerts: approved? | Yes, restricted by referrer and API; OpenStreetMap stays as the fallback. |

## Global rules applied to every phase

* Additive, re-runnable migrations with a timestamp after `main`'s latest; no data deleted; no constraint that breaks existing rows; RLS and
  `security definer` checks for every new function (`revoke … from public, anon`, `grant … to authenticated`); audit for money, status, permission
  and personal-data changes.
* Reuse: toasts / confirmations, notification and push outbox, e-mail router and log, WhatsApp senders and their dedupe keys, OCR, storage
  upload pattern, duplicate check, hand-over queue, HR automation, field-visit tracking.
* Permissions enforced in the database and API, never only by hiding buttons; cross-department isolation tested.
* Every message test in dry-run mode or to test recipients only.
* Each phase: unit, SQL, API and browser tests, `typecheck`, `build` (no lint script exists), a completion report, and this roadmap updated.

## Implementation progress

| Phase | Status | Pull request | Notes |
| --- | --- | --- | --- |
| 0. Audit and plan | Done, approved | `claude/crm-enhancement-roadmap` | D1–D9 approved as recommended |
| 1. Toast notifications | In progress (part 1 of 4) | part 1: `claude/crm-enhancement-roadmap` | Part 1: core (loading, `toast.promise`, `toast.fromError`, `useSubmit`, offline warning, clear defaults) + Sales Department Head (sheet assign, forward, inbound lead, task). Next: Support + Accounts + verification; HR + studios + field visit; Super Admin + the rest. |
| 2. Mandatory contacts + automation retry | Not started | | |
| 3. Support-originated workflow | Not started | | |
| 4. Lead capture and drafts | Not started | | |
| 5. Birthdays and anniversaries | Not started | | |
| 6. Field visit tracking | Not started | | |

### Phase 1, part 1 (core + Sales Department Head): what was done

* `src/lib/feedback/feedbackStore.ts`: a `loading` kind (never auto-dismissed), `updateToast`, `toast.loading`, `toast.promise`, `toast.fromError`
  and `errorKind` (VALIDATION_ERROR / CONFLICT → warning, everything else → error).
* `src/lib/feedback/errors.ts`: clear defaults for no permission, an expired session, too many attempts and offline (a readable server
  message is still kept as it is).
* `src/lib/feedback/useSubmit.ts`: one request at a time, a busy flag, toasts, `{ ok, value | error }`.
* `src/components/feedback/AppFeedback.tsx`: the spinner style and one persistent "You are offline" warning, then "Back online."
* Sales Department Head (`src/components/sales-head/`):
  * the sheet assignment uses one loading toast that becomes the result (a warning when the original file could not be stored), and retrying
    replaces the stale failure;
  * forwarding a sheet, assigning an inbound enquiry and creating a task show success toasts;
  * dialog errors stay in the dialog, with safe text;
  * the timed green banners were removed.
* The rule "where a result goes" is in `docs/APP_FEEDBACK_SYSTEM.md`.
* Tests:
  * `app_feedback.test.ts` (+14 checks);
  * `ui_app_feedback.test.mjs` (double click saves once, loading → success in place, safe failure text, offline / back online, at desktop
    and two phone widths);
  * `ui_ceo_lead_assign.test.mjs` (failed assignment → clear error toast without database text, retry → success, forward → success toast).
