# Security deployment checklist

## This change (security audit of 22 Oct 2026)

Order matters.

1. **Merge and let Vercel deploy the API.** It calls `attest_upload()` after inspecting an upload, and carries on if the
   function does not exist yet. Check one document upload works.
2. **Run `supabase/migrations/20261114000100_security_upload_attestation.sql`** in the Supabase SQL editor (safe to run
   again). From then on uploads finish only with the server's attestation, and customers are deleted only through
   `delete_customer()` (Super Admin and the customer's Department Head; the existing Delete button).
   *Rollback, if uploads fail:* `drop trigger customer_documents_require_attestation on public.customer_documents;` (and
   the two other `*_require_attestation` triggers). Nothing else needs undoing.
3. **Upload smoke test** as a Sales member (KYC PDF), a client (onboarding document), chat and ticket attachments.
4. **Rotate the leaked integration credentials (SEC-2026-004).** Apps Script: new deployment with `CRM_SHEET_KEY`,
   archive the old deployments (`google-apps-script/README.md`); lead sheet sharing Restricted; new wabastore webhook ids
   and AI-calling key from that provider. Paste the new values once in Wabastore > Remote Leads API.
5. **Run `supabase/diagnostics/security_posture.sql`** (read-only) and act on every row.
6. **GitHub:** Settings > Code security: enable Dependabot alerts and security updates. Settings > Branches: protect
   `main` and require the CI checks *Typecheck, build & secret scan*, *Secret scan (gitleaks, full history)*,
   *Security rules (Semgrep, project rules)* and *RLS + API integration tests*. Keep e-mail notifications for failed
   workflows on (that is the alert for the weekly scan).

## Standing checks (owner, at least quarterly)

* Supabase > Auth: password hook `hook_password_verification_attempt` enabled; minimum password length 10+; leaked
  password protection on; JWT expiry 1 hour or less; redirect URLs list only the production domain (no wildcards for
  `*.vercel.app`).
* Supabase > Database > Backups: point-in-time recovery matches how much data the business can lose; **restore a backup
  into a separate project at least once a quarter** and record the date here.
* Vercel: only current staff are project members; preview deployments protected (Vercel Authentication) because they use
  production-like data; `SUPABASE_SERVICE_ROLE_KEY`, `R2_*`, `SMTP_PASS`, `WEBHOOK_SECRET`, `CRON_SECRET` set for
  Production only, never with a `VITE_` prefix.
* Cloudflare R2: bucket public access off; r2.dev subdomain disabled; CORS allows `PUT`/`GET` only from the production
  origin; the API token is limited to this bucket.
* `WEBHOOK_SECRET` set and every sender updated (SEC-2026-010).
* Review `docs/security/FINDINGS.md`: every open item has an owner and a date.

## Credential rotation (when a secret may have leaked)

Rotate in the provider, update Vercel (Production), redeploy, then revoke the old value. Supabase service role / JWT
secret rotation signs everyone out: schedule it, tell users first. Never paste secrets into chats, tickets or commits.

## Record of restores and rotations

| Date | What | By | Result |
| --- | --- | --- | --- |
| | | | |
