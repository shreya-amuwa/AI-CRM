# Security findings and remediation tracker

The living record of security findings for Amuwa AI CRM. Update it in the same pull request as the fix. Earlier work
(the open proxy, open lead webhooks, public legacy buckets, sign-in lock-out, append-only audit log) is recorded in
[`docs/SECURITY.md`](../SECURITY.md) and is not repeated here.

**Severity** follows impact on customer data, money and accounts: *Critical* (remote, no account needed, broad data
or money impact), *High* (any account, or no account for limited data; cross-customer or privileged impact),
*Medium* (needs a specific role or condition; limited impact), *Low* (defence in depth).

**Evidence** labels: *Verified* = reproduced in the local test database / API test harness (never against production).
*Code-verified* = proven from the code and configuration, not exercised live. *Unverified* = needs a check in the
live project (`supabase/diagnostics/security_posture.sql`, Vercel or Google settings).

## Summary (audit of 22 Oct 2026)

| ID | Sev. | Finding | Status |
| --- | --- | --- | --- |
| SEC-2026-001 | High | Upload completion could be called directly through PostgREST, skipping the server's check of the stored file | **Fixed** (deploy API, then migration) |
| SEC-2026-002 | High | Team Heads / Department Heads could delete customers directly, bypassing `delete_customer()` | **Fixed** (migration) |
| SEC-2026-004 | High | Lead-sheet web app URL, webhook URLs and an API key shipped in the public JavaScript bundle and git history | **Code fixed; owner must rotate** |
| SEC-2026-006 | High | No multi-factor authentication for the Super Admin and other privileged roles | Open: rollout plan below |
| SEC-2026-003 | Medium | R2 presigned upload URL can overwrite a file after it was checked | Mitigated (5 min window); open |
| SEC-2026-005 | Medium | Client "Forgot password?" limit was per server instance, with no per-address limit | **Fixed** |
| SEC-2026-007 | Medium | Accounts expense sync tells users to share the expense Google Sheet with "Anyone with the link" | Open |
| SEC-2026-010 | Medium | Inbound lead webhook accepts unauthenticated requests until `WEBHOOK_SECRET` is set | Open: *Unverified* in production |
| SEC-2026-008 | Low | Dev server (`npm run dev`, bound to 0.0.0.0) exposes an open proxy and a wildcard-CORS lead stream | Open (development only) |
| SEC-2026-009 | Low | Build-time dependency advisories (13 high, 4 moderate; none in production dependencies) | Open: Dependabot |
| SEC-2026-011 | Low | No malware scanning / quarantine of uploaded business documents | Open |
| SEC-2026-012 | Low | Signed-out access tokens stay valid until they expire | Accepted, with settings |
| SEC-2026-013 | Info | `docs/SECURITY.md` claimed the database checks the stored file's real size; it did not (see 001) | **Corrected** |
| SEC-2026-014 | Info | `supabase/tests/hr_email_test.sql` fails from 22 Oct 2026 (date-dependent fixtures); `npm run test:db` stops there | Open (not security; security suites now run before it) |

---

## SEC-2026-001: upload completion bypass (High) - Fixed

* **Component:** `public.complete_document_upload`, `client_complete_document_upload`, `chat_complete_upload`,
  `ticket_complete_upload`; `server/services/{Pipeline,Client,Chat,TicketAttachment}Service.ts`.
* **Impact:** any signed-in user (staff or **client**) could mark their own pending upload as stored with any size,
  skipping the API's inspection of the stored object (exists, real size, first bytes match the declared type). An
  executable, an HTML page or an oversized object could be stored as a "verified PDF" and later opened by staff.
  Authorization to the customer was still enforced; the bypass is of the file-content and size controls.
* **Evidence (Verified):** the browser holds the Supabase URL and anon key; the functions were `EXECUTE`-able by
  `authenticated` and trusted `p_size`. On a database without the fix, `complete_document_upload(<pending id>, 1)` as the
  uploading member returned `UPLOADED`.
* **Fix:** migration `20261114000100_security_upload_attestation.sql`. After inspecting the object the API records an
  attestation through `attest_upload()` (service role only) with the size and ETag the storage provider reported. A
  trigger on `customer_documents`, `chat_attachments` and `support_ticket_attachments` refuses the
  `PENDING -> UPLOADED/READY` step unless a fresh (1 hour) attestation with the same size exists; it is used once and its
  ETag replaces the caller's. `StorageRepository.attest()` is called by all four services.
* **Tests:** `supabase/tests/security_invariants_test.sql` (direct call refused, users cannot attest or write
  attestations, wrong size refused, attested upload succeeds once); `api_integration.test.ts` (direct PostgREST RPC with
  a user token refused; the document stays `PENDING`; the API's content check still applies).
* **Rollout:** deploy the API first (it tolerates the missing function), then run the migration. Run the other way round,
  uploads fail until the API is deployed.
* **Remaining risk:** see SEC-2026-003.

## SEC-2026-002: direct customer deletion (High) - Fixed

* **Component:** `public.customers` (grant `DELETE` to `authenticated`, policy `customers_delete`).
* **Impact:** a Team Head (own team) or Department Head (own department) could delete customers with one PostgREST
  `DELETE`, bypassing `delete_customer()`: its role rule (Super Admin and the customer's Department Head only), its
  refusal while a verified payment exists, and the removal of stored files (left orphaned in R2 / Storage). Customers
  with issued invoices were protected only incidentally by an invoice trigger.
* **Evidence (Verified):** as a Team Head, `delete from customers where <no invoice>` deleted 17 team customers (rolled
  back).
* **Fix:** same migration: policy dropped, `DELETE` revoked. `delete_customer()` is unchanged. The unused
  `CustomerService.delete` / `CustomerRepository.delete` (a direct table delete) were removed.
* **Tests:** `security_invariants_test.sql`, `rls_test.sql` (Team Member, Team Head, Department Head refused; deletion
  through `delete_customer` audited), `api_integration.test.ts` (Team Head, Department Head and Super Admin refused through
  PostgREST), project Semgrep rule `no-direct-customer-delete`.

## SEC-2026-003: R2 upload URL replay after verification (Medium) - Mitigated, open

* **Component:** `server/storage/R2Driver.ts` (`createUploadTarget`).
* **Impact:** a presigned `PUT` stays valid until it expires and can be replayed after the upload was checked, replacing a
  verified file with other bytes (the signed `Content-Type` stays the same). Only the uploader holds the URL.
* **Evidence:** Code-verified.
* **Done:** lifetime cut from 15 to 5 minutes.
* **Recommended next step:** before signing a download URL for an R2 object with a recorded `storage_etag`, `HEAD` it and
  refuse (and audit) on an ETag mismatch; or copy the object to a final key on completion so the uploaded key is never
  served.

## SEC-2026-004: credentials in the public bundle and git history (High) - Code fixed, rotation required

* **Component:** `src/components/departments/wabastore/WabastorePanel.tsx`, `WabastoreWebhookLiveBar.tsx`,
  `vite.config.ts`, `Code.gs`, `google-apps-script/`.
* **Impact:** the production JavaScript (downloadable without signing in) and the git history contained:
  1. the URL of the Google Apps Script web app deployed with access **Anyone** and **no authentication**: `GET` returns
     every row of the lead spreadsheet (customer names, phone numbers, e-mail addresses), `POST` appends rows;
  2. two `webhooks.wabastore.com/webhook/<id>` URLs whose path id is the credential;
  3. an API key / webhook secret sent to the AI-calling webhook;
  4. the spreadsheet id, with in-app advice to set the sheet to "Anyone with the link".
* **Evidence:** Code-verified (values present in `dist/assets/*.js` and in 136 commits). The live endpoints were **not**
  called: that would read production customer data.
* **Fix (code):** values removed. Staff paste the integration addresses once; they are kept in that browser only
  (`src/lib/leadIntegrations.ts`). The dev server reads `DEV_LEAD_FORWARD_URL`, `DEV_AI_CALLING_FORWARD_URL`,
  `DEV_LEAD_FORWARD_TOKEN`. `Code.gs` now refuses every request without `?key=` matching the `CRM_SHEET_KEY` script
  property, and no longer returns internal error text. The UI no longer advises public link-sharing of the lead sheet.
* **Fix (owner, required; removing the values from the code does not revoke them):**
  1. Apps Script: set `CRM_SHEET_KEY`, create a **new deployment**, **archive every older deployment** (the leaked URL stops
     working), paste the new URL with `?key=` in the CRM. See `google-apps-script/README.md`.
  2. Set the lead spreadsheet's sharing to **Restricted**.
  3. Rotate both wabastore webhook ids and the AI-calling API key with that provider, and enter the new values in the CRM.
  4. Treat the lead sheet's contents as possibly exposed since the URL was first committed; decide on notification
     obligations with whoever owns data-protection compliance.
* **Detection:** CI (`.github/workflows/ci.yml`): gitleaks with project rules (`.gitleaks.toml`) over every commit,
  Semgrep rule `no-hardcoded-integration-credential`, and a bundle check for these URL shapes. Historical occurrences
  are listed by fingerprint in `.gitleaksignore` (no secret values).
* **Known behaviour change:** the AI Calling channel now uses the same webhook address the user enters unless an
  AI-calling address is saved; a separate field can be added if both are used at once.

## SEC-2026-005: client password-reset flooding (Medium) - Fixed

* **Component:** `POST /api/v1/client-auth/forgot-password` (`server/app.ts`).
* **Impact:** the only unauthenticated endpoint that sends e-mail counted requests per serverless instance (reset on
  every cold start, not shared) and per IP only: one client's inbox could be flooded from many addresses. When neither
  `APP_URL` nor the Vercel production URL was set, the link base came from the caller's `Origin` header (Supabase's
  redirect allow-list still applied).
* **Fix:** limits kept in the shared Postgres store: 5 per IP per 15 minutes and 3 per e-mail (SHA-256, no address
  stored) per hour. A caller's `Origin` is used only if it is in `API_ALLOWED_ORIGINS` or a loopback address.
* **Tests:** `api_integration.test.ts` (fourth request for one address from four different IPs is 429; no address in
  the counter table).
* **Remaining:** if the rate-limit function is unavailable the server falls back to per-instance counting (fail open,
  logged), as for the rest of the API.

## SEC-2026-006: no MFA for privileged roles (High) - Open

* **Impact:** a phished or reused Super Admin password gives full access to every customer, document, invoice and
  account. Supabase Auth supports TOTP MFA; the session's assurance level is in the JWT (`aal`).
* **Proposed rollout (needs approval; can lock users out if rushed):**
  1. Add an enrolment screen (Supabase `mfa.enroll` / `challenge` / `verify`) and a "verify code" step after sign-in when
     the user has a factor. No enforcement yet.
  2. Use `supabase/diagnostics/security_posture.sql` (check 7) until every Super Admin and Department Head is enrolled.
  3. Add a database switch (off by default) that makes `private.my_role()` treat a privileged role as inactive unless
     `auth.jwt() ->> 'aal' = 'aal2'`. The API's `api_session` uses the same helper, so the check is enforced on both paths.
  4. Turn it on for `SUPER_ADMIN` first, keep a break-glass procedure (a second Super Admin, or factor reset through the
     Supabase dashboard), then extend to Department Heads and Accounts.
* **Also recommended:** re-authentication (fresh `aal2` within N minutes) for user deletion, role changes and financial
  reversals.

## SEC-2026-007: expense sheet shared by link (Medium) - Open

* **Component:** `src/components/departments/accounts/ExpenseView.tsx` (Google Sheet expense sync via `/api/proxy`).
* **Impact:** the sync works only if the company's expense sheet is shared "Anyone with the link"; the link then protects
  financial records.
* **Recommendation:** read the sheet server-side with a Google service account (sheet shared only with that account), or
  the keyed Apps Script pattern used for leads. Until then keep the link out of tickets and chats.

## SEC-2026-008: dev server open proxy (Low, development only) - Open

* **Component:** `vite.config.ts` (`liveWebhookPlugin`); `npm run dev` binds to `0.0.0.0`.
* **Impact:** while a developer runs `npm run dev`, anyone on the same network can use `/api/proxy` to fetch internal
  addresses, and any website the developer visits can read `/api/webhooks/stream` (`Access-Control-Allow-Origin: *`).
* **Recommendation:** answer these dev routes only for loopback callers and drop the wildcard CORS header, or bind to
  `127.0.0.1` unless `--host` is passed.

## SEC-2026-009: build-time dependency advisories (Low) - Open

* `npm audit --omit=dev`: **0** vulnerabilities. Full tree: 13 high / 4 moderate, all in build tooling
  (`@vercel/node` -> `path-to-regexp`, `tailwindcss` -> `postcss-selector-parser`). Fixes need major upgrades
  (`@vercel/node@4`, `tailwindcss@4`); Dependabot will open them; test before merging.

## SEC-2026-010: lead webhook open until a secret is set (Medium) - Open

* Recorded in `docs/SECURITY.md`. **Unverified:** whether `WEBHOOK_SECRET` is set in Vercel production. Check Vercel >
  Settings > Environment Variables; if absent, set it and update every sender.

## SEC-2026-011: no malware scanning of uploads (Low) - Open

* Uploads are limited by type, file signature (first bytes) and size (500 KB invoices, 2 MB documents, 5 MB chat /
  ticket files) and are served with `Content-Disposition` from a separate origin. Nothing scans PDF contents.
  Recommendation for client uploads: quarantine status until a scanner (for example a ClamAV worker on R2 events) marks
  them clean.

## SEC-2026-012: token lifetime after sign-out (Low) - Accepted with settings

* Access tokens are verified by signature and expiry. A signed-out token stays usable until it expires. Suspension and
  role changes take effect on the next request (every database helper reads `profiles` and requires `ACTIVE`; the
  sign-in is also banned). Keep the JWT expiry at 1 hour or less (Supabase > Auth settings).
* **Risk owner:** to be named by the business (Super Admin).

## SEC-2026-014: date-dependent HR e-mail test (Info) - Open

* `hr_email_test.sql:107` fails from 22 Oct 2026 because fixtures from earlier suites create birthday / probation dates
  relative to `now()`. `run.sh` stops at the first failure, so suites after it did not run in CI. The new
  `security_invariants_test.sql` runs right after `rls_test.sql`, and `npm run test:security` runs the security suites
  on their own.

---

## Verified sound in this audit (with evidence)

* **Client isolation:** a client JWT reading every public table directly returned only its own 5 notifications; every
  other table returned no rows or `permission denied`.
* **Staff scoping:** a role x table matrix (Super Admin, Department Head, Team Head, Team Member across departments) matched
  the designed scopes; Accounts and HR see their whole domain by design.
* **Deactivation:** every role helper (`private.my_role`, `my_id`, `my_department_id`, ...) requires `status = 'ACTIVE'`,
  so suspended users lose direct database access on their next request, not only through the API.
* **Catalog:** every public table has RLS; `anon` holds no table privilege and can execute only
  `list_registration_options()`; every `SECURITY DEFINER` function sets `search_path`; no `TRUNCATE` for users; no views.
  All 259 user-callable definer functions reference the caller (6 delegate to checked helpers and are listed by name).
  These are now enforced by `security_invariants_test.sql`.
* **Storage:** all five Supabase buckets are private in migrations; migrations create no `storage.objects` policies
  (dashboard-made policies: run the diagnostic). Download URLs are issued only after a database authorization function
  and use paths read from the database.
* **Dependencies:** 0 known vulnerabilities in production dependencies.

## Not covered by this audit (needs specialist review or production access)

* Live Supabase dashboard settings (Auth hooks, JWT expiry, leaked-password protection, redirect allow-list), Vercel
  project access and preview protection, R2 bucket public-access and CORS settings, backup / point-in-time-recovery
  configuration and a restore test: owner checks listed in `DEPLOYMENT_CHECKLIST.md`.
* Business-logic abuse of the financial workflows beyond the existing test suites, and a manual penetration test of
  the deployed application.
