# Security: audit, hardening and what to switch on

Migration: `supabase/migrations/20261106000100_security_hardening.sql` (additive, safe to rerun in the Supabase SQL editor; nothing is deleted).
Tests: `npm run test:db` (security section at the end), `npm run test:api`, `npm run test:unit` (`security.test.ts`).

## What the audit found and what was done

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Critical | `/api/proxy` was an open, unauthenticated request relay with `Access-Control-Allow-Origin: *`. Anyone on the internet could make the server call any address (cloud metadata `169.254.169.254`, internal hosts) and read the answer, and the caller's `Authorization` header was forwarded to the target. | The proxy now needs a signed-in, active CRM user, answers GET only, sends no CORS headers, never forwards credentials, and uses `server/net/safeFetch.ts`: http(s) on ports 80/443 only, no URL credentials, loopback / private / link-local / metadata / reserved addresses refused **at connection time** (DNS-rebinding safe), redirects re-checked (max 3), 10 s and 2 MB limits, answers served as plain data with `nosniff`. The two screens that use it (Accounts expense sync, lead webhook checker) now send the session token (`src/lib/api/proxyFetch.ts`). |
| 2 | Critical | The lead webhooks (`/api/webhook`, `/api/webhooks/...`) accepted anything from anyone, wrote to `crm_leads` with the service-role key, took the department and channel from free text, returned database error text and allowed any origin. | Shared handler `server/webhooks/leadIngest.ts`: optional-until-set shared secret (`WEBHOOK_SECRET`, constant-time compare), department must exist, department / source are plain slugs, every field length limited, raw payload capped at 64 KB, per-address rate limit (shared across instances), no CORS, generic errors, Meta challenge only echoed when it is a plain token (and checked against `WEBHOOK_VERIFY_TOKEN` when set). Rejected requests are audited (`WEBHOOK_REJECTED`, never the secret or the body). **Set `WEBHOOK_SECRET` and update the senders**; until then the endpoint stays open so existing integrations keep working (a warning is logged). |
| 3 | High | Leads (`crm_leads`) and `blueprint_requirements` could be read, changed and deleted by every active staff member of every department (HR, Accounts, other business units). | Policies now allow the Super Admin, the Amuwa Corporation (head office) department, the row's own department, or the member the lead is assigned to. |
| 4 | High | The two legacy storage buckets `blueprint-files` and `amuwa-docs` were **public**. | Set to private (objects are kept; the app does not link to them). |
| 5 | High | No security headers on the web app (clickjacking, MIME sniffing, no CSP). | `vercel.json`: CSP (`script-src 'self'`, no inline scripts, `frame-ancestors 'none'`, `base-uri 'self'`), `X-Frame-Options: DENY`, `nosniff`, HSTS, Referrer-Policy, Permissions-Policy (geolocation stays allowed for the field-visit tracker). |
| 6 | Medium | Failed sign-ins were neither counted nor audited; no lock-out. | Supabase Auth password-verification hook `public.hook_password_verification_attempt` (see below): 5 failures in 15 minutes lock the account for the rest of the window (even a correct password is refused), audited as `LOGIN_FAILED` / `LOGIN_LOCKED` without any password. |
| 7 | Medium | Signed-out visitors held table privileges (`anon` SELECT/TRUNCATE on several tables) and could execute 3 internal functions; signed-in users held `TRUNCATE` (skips Row Level Security) and write privileges on catalogue tables. | Revoked. Only `list_registration_options()` is callable signed-out. New tables / functions no longer start with `anon` access (default privileges). |
| 8 | Medium | Audit metadata was whatever the caller passed. | `private.scrub_audit_metadata` removes keys containing password / secret / token / authorization / api key / cookie / credential (also nested) from every audit entry; `record_security_event()` (service role only) records events without a signed-in user. |

Checked and found sound (no change): every public table has Row Level Security; all `SECURITY DEFINER` functions set `search_path`; role / status changes only through checked functions (`profiles` is read-only for users); requests are validated with strict Zod schemas; no raw SQL string building; PostgREST filters escaped; no secrets in the repository; `npm audit --omit=dev` reports 0 vulnerabilities; the 500 KB invoice PDF limit is enforced by the database (`complete_document_upload` checks the **stored** object's real size and signature, not the size the browser claims), by the bucket limit and by the schema in `shared/validation.ts`; per-user rate limits (shared across instances) and a per-address flood limit on the API; CORS is an explicit allow-list; the client dashboard only reaches the signed-in customer's own records.

## Switch these on (one time)

1. **Run the migrations** `20261106000100_security_hardening.sql`, then `20261110000100_dashboards_overview.sql` and `20261110000200_security_events.sql`, in the Supabase SQL editor (each is safe to run again).
2. **Webhook secret.** In Vercel set `WEBHOOK_SECRET` (a random string of 16+ characters; several may be comma separated while rotating) and make every sender (n8n, WhatsApp provider, forms) send `X-Webhook-Secret: <value>` or `Authorization: Bearer <value>`. For the Meta handshake also set `WEBHOOK_VERIFY_TOKEN`.
3. **Sign-in lock-out.** Supabase dashboard > Authentication > Hooks > *Password verification attempt* > Postgres function > `public.hook_password_verification_attempt` > enable. (Available on Supabase plans that include Auth hooks. Until enabled, Supabase's own per-IP rate limits are the only brute-force control.)
4. **Supabase Auth settings** (dashboard > Authentication): minimum password length 10 or more, enable *leaked password protection*, keep e-mail confirmation on, set a short JWT expiry (1 hour) and enable CAPTCHA (Auth > Attack Protection) if sign-up is public.
5. **Keys.** `SUPABASE_SERVICE_ROLE_KEY` only in server environment variables (never `VITE_`). If it was ever pasted into a chat, ticket or commit, rotate it in Supabase and in Vercel.

## Security and audit logging (what is recorded, where, and how to read it)

There are four different kinds of record. They are not interchangeable:

| Kind | Where | What it holds |
| --- | --- | --- |
| Business audit trail | `public.audit_logs` (database) | Who did what to which record: customers, payments, invoices, documents, roles, expenses, imports, chat group membership, exports ... Written by database triggers and `SECURITY DEFINER` functions in the same transaction as the change. |
| Security events from the API server | `public.audit_logs` (through `record_server_event`, service role only) | Refused requests (`ACCESS_DENIED` for 403, `AUTH_REJECTED` for 401, `RATE_LIMITED` for 429), the start of a sign-in session (`SESSION_STARTED`), client password links and reset requests. A refused request rolls its own transaction back, so only the server can record it. |
| Sign-in provider logs | Supabase Auth (dashboard > Logs) | Every sign-in, sign-out and token event. Not copied into the app. `LOGIN_FAILED` / `LOGIN_LOCKED` in `audit_logs` come from the password verification hook (see "Switch these on", step 3). |
| Application logs | Vercel > Logs | One JSON line per API request (method, route, status, time, request id, user id). Retention is Vercel's. |

Every `audit_logs` row now has: time, actor (and a name and role snapshot kept even if the person is removed), action, target type and id, department and team, **outcome** (`SUCCESS`, `FAILURE`, `DENIED`), the **request id** (the `X-Request-Id` of the API request that caused it, also in the Vercel log and in the response header), the caller's address for server-recorded events, and safe details.

Rules the database enforces (migration `20261110000200_security_events.sql`):

* Rows are **append-only**: a trigger refuses UPDATE, DELETE and TRUNCATE for everyone, including the table's owner. The only allowed change is the foreign-key clean-up that clears a removed person's reference (the name snapshot stays). A deliberate clean-up of test data must declare itself with `set_config('amuwa.audit_purge', 'on', true)` (the maintenance script does). A database superuser can still disable the trigger: that is a limit of any database-held log; export or stream the table if you need tamper evidence.
* Every insert is scrubbed: keys named like `password`, `token`, `secret`, `authorization`, `api_key`, `cookie` or `credential` are removed at any depth, whichever code wrote the row. Free-text values are not scanned, so never put a secret in a note or a reason.
* Retried requests do not repeat events: server events carry a dedupe key (caller + kind + route + five minutes).
* Passwords, tokens, request bodies and query strings are never recorded; routes are recorded as patterns (`/pipeline/customers/:id`), not raw paths.
* If the service role key is not set on the server, denied requests and sessions cannot be recorded; the server says so once in its log.

Who can read it: the **Super Admin** (everything), a **Department Head** (the department) and a **Team Lead** (the team), through *Security & Audit Logs* (Super Admin menu) or `GET /api/v1/audit-logs/search` (search by person, event or request id; filter by event type, outcome and dates; paged). Nobody can edit or delete a record through the app or the API.

Known gaps (not changed): logouts and password changes made in Supabase Auth are only in the Supabase Auth logs; unknown-email sign-in attempts never reach the password hook; browser-side exports are recorded by the browser (a user who bypasses the screen is not recorded; the data they could read is limited by access rules anyway); chat attachment downloads and accepted webhook leads are not audited (ticket attachments are: `TICKET_ATTACHMENT_ADDED` and `TICKET_ATTACHMENT_DOWNLOADED`, without file names); there is no retention or archiving policy for `audit_logs`; there is no automated alerting (the Super Admin dashboard lists exceptions, it does not page anyone).

## Remaining risks (not changed, on purpose)

* The lead webhook stays open until `WEBHOOK_SECRET` is set (switching it on by default would silently stop inbound leads from senders that were not updated).
* The Amuwa Corporation (head office) department keeps access to every unit's leads: the existing head-office dashboard needs it.
* The "Status Completed" onboarding e-mail contains the client's initial password (stored encrypted until sent, then erased). Prefer the *Set your password* link used by the customer import.
* R2 pre-signed uploads cannot cap the size while uploading; an oversized object is detected and removed when the upload is completed (the 500 KB / 2 MB limits are enforced there).
* The API rate limit fails open to a per-instance counter if the rate-limit database function is unavailable (availability over exact quotas; authorization is still enforced by the database).
* The CSP allows `https:` for `connect-src` / `img-src` / `frame-src` because the lead-webhook checker and Google Sheet sync call user-configured addresses; scripts are restricted to the app itself.
* Multi-factor authentication is not enforced.
