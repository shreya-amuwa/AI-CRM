# Sales Dashboard → My Leads → Leads / Potential / Onboarding

## 1. Assessment of what existed

| Area | Before | Problem |
|---|---|---|
| My Leads | One flat page listing `crm_leads` rows (the website/WhatsApp webhook table) | `crm_leads` has text ids, is readable by every active user, and has no services, payment or document data. |
| Customers | `customers` table with owner → team → department RLS | Lead, deal and customer were separate things, so moving a lead forward would have meant copying it. |
| Documents | Nothing | No storage, no metadata, no audit. |

**Decision:** the `customers` row is the one record for a person. It moves through
`lifecycle_stage` LEAD → POTENTIAL → ONBOARDING (→ CUSTOMER / LOST). Nothing is copied
between sections, so there are no duplicates and the hierarchy rules that already protect
customers (RLS + ownership triggers) apply at every stage. `crm_leads` stays as the inbound
queue: a salesperson takes an enquiry with **Take this lead**, which turns it into a LEAD
record once (`claim_inbound_lead`, a second claim gets 409).

## 2. Data model (migration `20261007000300_lead_lifecycle_onboarding.sql`, additive only)

- `customers` + `lifecycle_stage`, `lead_status` (NEW / CONTACTED / INTERESTED / READY_TO_BUY),
  WhatsApp, city, business category, lead source, next follow-up, expected budget,
  deal amount, amount received, payment due date, `stage_changed_at`.
  Existing rows default to `CUSTOMER`, so My Customers is unchanged.
- `crm_services` (catalogue, 21 services in 4 groups) and `customer_services`.
- `customer_onboarding`: stage, payment method, started, target handover, forwarded to support.
- `document_types`: `INVOICE` and `IMPORTANT_DOCUMENTS` (both mandatory, PDF only).
- `customer_documents`: versioned metadata (PENDING → UPLOADED → SUPERSEDED / DELETED / FAILED);
  at most one UPLOADED file per customer and type.

Every state change is a database function that locks the customer row, re-checks access
and writes audit + activity in the same transaction: `create_lead`, `update_lead`,
`move_customer_to_potential`, `record_customer_payment`, `start_customer_onboarding`,
`forward_onboarding_to_support`, `begin/complete/fail_document_upload`,
`authorize_document_access`, `delete_customer_document`. The browser cannot set
`lifecycle_stage` directly (column grants + trigger).

## 3. Document storage

- Private bucket `customer-documents` (20 MB, `application/pdf` only). No public URLs and
  no storage policies for users — only the API's service role touches objects, and only
  after a database function has authorised the caller for that document.
- Paths contain ids only: `customers/<customer_id>/invoices/<document_id>.pdf` and
  `customers/<customer_id>/onboarding/<document_id>.pdf`. No names, phone numbers or other
  personal details. Ownership comes from the database row, never from the file name.

Upload flow (no orphans, no fake success):

1. Browser checks size and that the file starts with `%PDF-` (content, not extension).
2. `POST /pipeline/customers/:id/documents` → PENDING row + a single-use token for that exact path.
3. Browser uploads straight to Storage (avoids the 4.5 MB serverless body limit).
4. `POST /documents/:id/complete` → the API checks the stored object exists and its first bytes
   are a PDF, then the database marks it UPLOADED, supersedes the previous version and
   updates onboarding progress. If any step fails the row becomes FAILED and the object is removed.
5. Abandoned uploads (PENDING > 1 hour) are expired by `expire_stale_document_uploads` and cleaned up.

Viewing/downloading: `GET /documents/:id/url?action=view|download` returns a signed URL valid
for 120 seconds and writes DOCUMENT_VIEWED / DOCUMENT_DOWNLOADED to the audit log.
Uploads, replacements and deletions are logged as INVOICE_UPLOADED / INVOICE_REPLACED /
INVOICE_DELETED and DOCUMENT_UPLOADED / DOCUMENT_REPLACED / DOCUMENT_DELETED.
After forwarding to support the current files are locked (replace, don't delete).

## 4. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/pipeline/services`, `/pipeline/counts` | Catalogue; per-stage counts (RLS-scoped) |
| GET | `/pipeline/customers?stage=LEAD\|POTENTIAL\|ONBOARDING&…` | Server-side search, filters, sort, pagination |
| GET | `/pipeline/customers/:id` | Detail + documents + activity |
| POST / PATCH | `/pipeline/leads`, `/pipeline/leads/:id` | Add / edit lead |
| POST | `/pipeline/customers/:id/move-to-potential` · `/payments` · `/start-onboarding` · `/forward-to-support` | Stage changes |
| PATCH | `/pipeline/customers/:id/onboarding` | Target handover date |
| GET / POST | `/pipeline/inbound`, `/pipeline/inbound/:leadId/claim` | Website/WhatsApp enquiries |
| POST | `/pipeline/customers/:id/documents`, `/documents/:id/complete`, `/documents/:id/abort` | Upload |
| GET / DELETE | `/documents/:id/url`, `/documents/:id` | Signed URL; delete |

`GET /customers` accepts `lifecycle=ONBOARDING,CUSTOMER`; My Customers uses it so leads do not appear there.

## 5. UI

`src/components/team-member/pipeline/`: the existing sidebar's **My Leads** item expands
(`aria-expanded`) into **1 Leads**, **2 Potential**, **3 Customer onboarding** with live counts.
Pages follow the design: Leads list (search with Ctrl K, service/source/follow-up filters,
status tabs, pagination, Edit), Add lead, Edit lead (status track, *Save & move to Potential*),
Potential (filter cards, amount progress, part payment, *Confirm & start onboarding*),
Onboarding list (cards with document progress) and the one-customer page whose
**Mandatory Documents** section lists **1. Invoice** and **2. All Important Documents**
(with a keyboard-accessible ? tooltip). Stage changes wait for the server (no optimistic
updates); lists refresh through Supabase Realtime.

Not built yet: the design's service-specific checklists (e.g. "Brand logo", "Facebook page
access") — there is no agreed list of items per service. `document_types` is extensible, so
they can be added as data later.

## 6. Tests

- `npm run test:db` — RLS/function tests, incl. two-customer isolation, upload/replace/delete,
  locking after forwarding, inbound claim.
- `npm run test:api` — HTTP → Postgres + emulated Storage: renamed non-PDF rejected,
  missing object rejected, token bound to one path and single-use, other salesperson gets 404,
  signed URLs, versions, audit entries.
- Browser run (Playwright, local stack): full Lead → Potential → Onboarding flow, tooltip via
  keyboard, uploads, second salesperson on a phone-sized screen sees nothing of the first.

## 7. Deploying

Apply the migration (`supabase db push` or the SQL editor). It creates the private bucket.
`SUPABASE_SERVICE_ROLE_KEY` must be set on the server (Vercel) for uploads and signed URLs;
it is never sent to the browser.
