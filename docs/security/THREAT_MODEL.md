# Security architecture and threat model

How data flows through Amuwa AI CRM, where it is protected, and what to check when something changes. Findings live
in [FINDINGS.md](FINDINGS.md); deployment steps in [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).

## Components and trust boundaries

```
Browser (React SPA, public JS)                     Vercel
  ├─ Supabase anon key + user JWT ──────────────►  Supabase PostgREST / Realtime  ─►  PostgreSQL (RLS + SECURITY DEFINER)
  │                                                    ▲ same JWT, same rules
  ├─ /api/v1 (Hono, api/crm.ts) ── user JWT ───────────┘ (user-scoped client)
  │        └─ service role (server only): auth admin, rate limits, security events, storage, attestations
  ├─ presigned PUT / GET ───────────────────────►  Cloudflare R2 (one private bucket) / Supabase Storage (legacy)
  └─ /api/proxy (signed-in, SSRF-filtered GET)
Inbound: /api/webhook(s) (shared secret, when set), /internal/automations/dispatch (bearer), biometric punch (bearer)
Outbound: SMTP / Resend / Brevo, WhatsApp webhook, Google Apps Script
```

**The database is the security boundary.** The browser can call every table and function that `authenticated` may
use, directly through PostgREST with the anon key and its own JWT. A rule enforced only in Hono (or only in React)
does not hold. Every new table needs RLS; every new user-callable function must check the caller
(`security_invariants_test.sql` fails otherwise).

| Boundary | Trust decision | Enforced by |
| --- | --- | --- |
| Anyone -> SPA assets | Public. **Nothing secret may be in `src/` or `VITE_*`.** | CI bundle check, gitleaks, Semgrep |
| Anyone -> `/api/v1` | Token verified by Supabase / PostgREST; profile and status read from the DB | `authenticateRequest`, `api_session` |
| User -> PostgREST | RLS per table; `SECURITY DEFINER` functions check `private.my_*` (require `ACTIVE`) | migrations, `rls_test.sql` |
| Client login -> data | Only `private.my_client_customer()`; no staff table privileges | `client_test.sql`, client isolation matrix |
| Server -> storage | Service-held keys; paths only from the DB; URLs after an authorization function | `StorageRepository`, `*_download` / `authorize_document_access` |
| Browser -> storage | One presigned PUT per pending row; completion only with a server attestation | `20261114000100` trigger |
| Senders -> webhooks | Shared secret (constant-time), size and rate limits | `server/webhooks/leadIngest.ts` |

## Inventory (22 Oct 2026)

* **Tables:** 85 in `public`, all with RLS (92 policies). Tables without policies are reachable only through
  `SECURITY DEFINER` functions. Directly writable by users (under RLS): leads, blueprint requests, member workspace
  tables, field visits, HR tables (HR staff), teams / departments (admins), notifications (own), customer services.
* **Functions:** 259 `SECURITY DEFINER` functions callable by signed-in users (each checks the caller); 17 for the
  service role only (rate limits, security events, attestations, client password reset lookup, automation queue, ...);
  one for signed-out visitors (`list_registration_options`).
* **API:** 219 staff routes and 44 client routes under `/api/v1` (`server/routes.ts`, `server/clientRoutes.ts`), plus
  `/health`, the dispatcher, the biometric punch, client forgot-password, `/api/proxy`, `/api/webhook(s)`.
* **Storage:** Cloudflare R2, one private bucket (`R2_BUCKET`) with logical prefixes `customer-documents/`,
  `chat-attachments/`, `ticket-attachments/`; Supabase Storage buckets `customer-documents`, `chat-attachments`,
  `ticket-attachments` (current / historical) and `blueprint-files`, `amuwa-docs` (legacy, made private, unused). Each
  file row records `storage_provider`, `storage_ref`, `storage_etag`.
* **Realtime:** 29 tables in `supabase_realtime`; Supabase applies each table's SELECT policies to subscribers.

## Customer documents: exposure assessment

| Path | Authorization | Notes |
| --- | --- | --- |
| Onboarding documents, staff | `begin_document_upload` / `complete_document_upload` / `authorize_document_access` (customer scope) | 2-minute URL, issued after the DB check; audited |
| Onboarding documents, client | `client_*_document_*`, own customer only | Same flow |
| Invoice PDFs (uploaded / generated) | `accounts_can_invoice`, `invoice_file_access`, `client_invoice_file` | Generated PDFs stored by the server |
| Chat attachments | `chat_access` membership; `chat_attachment_download` | 5 MB, signature checked |
| Ticket attachments | `ticket_own_pending`, `can_view_ticket`; audited download | 5 MB |
| Legacy buckets | none needed: private, no policies, not linked | Verify no dashboard policy (diagnostic) |

Object keys contain ids only (no names). No public links exist. Weak points: the R2 PUT replay window (SEC-2026-003)
and no content scanning (SEC-2026-011). The completion bypass is fixed (SEC-2026-001).

## Authentication and roles: weaknesses

* No MFA (SEC-2026-006) - the largest remaining account-takeover risk.
* Password lock-out exists as a Supabase Auth hook but must be **enabled in the dashboard** (docs/SECURITY.md step 3).
* Role, department and status are read from `profiles` on every request (never from the token or the body); role and
  status changes go through checked functions; deactivation is immediate in the database and bans the sign-in.
* Signed-out tokens remain valid until expiry (SEC-2026-012).

## Logging and monitoring: assessment

* **Exists:** append-only `audit_logs` (database-enforced; scrubbed of secret-like keys) for business and security
  events, with actor, action, target, outcome and request id; server-recorded `ACCESS_DENIED` / `AUTH_REJECTED` /
  `RATE_LIMITED` / `SESSION_STARTED`; sign-in failures through the password hook; JSON access logs in Vercel.
* **Gaps:** no alerting (nothing pages anyone); no retention / export policy for `audit_logs`; chat attachment downloads
  and accepted webhook leads are not audited; Supabase Auth and Vercel logs have provider-defined retention.
* **Now automated (CI, every push / PR):** typecheck + build, production `npm audit`, bundle secret check, gitleaks over
  the full history, project Semgrep rules, the full RLS / API test suites including `security_invariants_test.sql`.
  **Weekly (`security.yml`):** dependency audit, full-history secret scan, security database suites, advisory Semgrep
  community rules. **Dependabot:** weekly update PRs. None of this watches the running production system.

## Change checklist (every PR)

1. New table: RLS on, policies per operation, no `anon` grant, no broad `authenticated` `DELETE` / `UPDATE` unless the
   policy is the whole rule.
2. New function: `security definer set search_path = ''`, checks the caller first, `revoke ... from public, anon`.
3. New file flow: DB row first, presigned target for that row only, server inspection + `attest`, download only after a
   DB authorization function.
4. New integration: secrets in server env vars only; inbound requests authenticated (constant-time) and size-limited.
5. Add allowed and denied tests for each role; update FINDINGS.md.
