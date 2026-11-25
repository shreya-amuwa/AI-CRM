# Self-hosting Supabase (Contabo Cloud VPS 6)

This is the plan for moving the CRM's database from Supabase's hosted service to your own server. It covers choosing the server, setting
it up, backups, security, moving the data and the way back. Read `docs/OUTAGES.md` first for why.

**What changes and what doesn't:**
- **Changes:** the database and the Supabase services (Auth, the API, Realtime) run on your server.
- **Doesn't change:** the CRM's code, the Cloudflare Worker, R2 file storage and e-mail.
- **What you take on:** what Supabase did for you is now yours to do — backups, security updates, monitoring and upgrades. Skipping any
  of them risks losing data or the CRM being down with nobody to call.

## 1. The server

- **Plan:** Cloud VPS 6 (6 vCPU, 12 GB RAM). Choose the **100 GB NVMe** disk over the 200 GB SSD: a database lives on disk speed, and
  100 GB is many times what the CRM uses (64 MB today).
- **Location:** the data centre closest to the staff, **India if Contabo offers it, otherwise Singapore**. Not Europe or the US. Today the
  database is in Sydney; moving closer makes every screen faster.
- **System:** Ubuntu 24.04 LTS.
- **A second, smaller server or a managed bucket is needed for backups** (section 4). Backups on the same machine are not backups.

## 2. Install

Use Supabase's official self-hosting setup: Docker Compose from `supabase/supabase` → `docker/`, as described at
https://supabase.com/docs/guides/self-hosting/docker. Pin a release; do not track `master`.

In `.env` (these fill in `docker-compose.yml`), set:
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`: new strong values,
  generated as Supabase's guide describes. Keep them in a password manager, never in the repository or in chat.
- `SITE_URL=https://crm.amuwacorporation.com` and `API_EXTERNAL_URL=https://db.<your domain>` (the address the CRM will use).
- **Sign-up closed:** `DISABLE_SIGNUP=true`, `ENABLE_PHONE_SIGNUP=false`, `ENABLE_ANONYMOUS_USERS=false`. The example file ships with
  sign-up **open**, and the anon key is public, so anyone could create accounts and make the CRM send e-mails. Staff, client and
  candidate accounts are all created by the CRM's server (`auth.admin.createUser`), so this does not affect them.

These go in **`docker-compose.yml` under `services.auth.environment`**, not only in `.env`. The auth container only receives the variables
listed there; the hook lines ship commented out and the OTP expiry is not listed. Then run `docker compose up -d auth`.
- **E-mail:** the CRM sends Auth e-mails through its hook (`docs/EMPLOYEE_WELCOME_EMAIL.md`, `server/automations/authEmailHook.ts`):
  - `GOTRUE_HOOK_SEND_EMAIL_ENABLED: "true"`
  - `GOTRUE_HOOK_SEND_EMAIL_URI: https://crm.amuwacorporation.com/api/v1/internal/auth/email-hook`
  - `GOTRUE_HOOK_SEND_EMAIL_SECRETS: <the same v1,whsec_... value as the Worker's SUPABASE_AUTH_HOOK_SECRET>`
- **Link lifetime (24 hours):** `GOTRUE_MAILER_OTP_EXP: "86400"`.

Check both after starting: a test password-reset e-mail arrives (through the CRM, not Supabase's own mailer) and its link still works
after a few hours.

Extensions the CRM uses: `pg_trgm` and `pg_cron` (both in Supabase's Postgres image). `pg_cron` is optional; the Worker's cron does the
same work.

## 3. Security (before any data goes on it)

- **Ports: ufw alone does not protect Docker.** Supabase's compose file publishes the database pooler (5432, 6543) and Kong (8000, 8443)
  on every address, and Docker's own firewall rules bypass ufw.
  - In `docker-compose.yml`, bind every published port to the machine itself: `127.0.0.1:5432:5432`, `127.0.0.1:6543:6543`,
    `127.0.0.1:8000:8000`, `127.0.0.1:8443:8443`. Only Caddy/nginx (80, 443) and SSH (22) face the internet.
  - Also turn on Contabo's network firewall allowing only 22, 80 and 443.
  - **Check from another machine:** `nmap -p 1-65535 <server IP>` must show only 22, 80 and 443 open.
- **Studio is never public.** Kong's default `kong.yml` serves Studio at `/` behind a basic password. In Caddy/nginx, pass only
  `/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1` and `/functions/v1` to Kong and refuse everything else (or remove the dashboard
  route from `kong.yml`). Reach Studio through an SSH tunnel: `ssh -L 8000:127.0.0.1:8000 <server>`, then open http://localhost:8000.
- **SSH:** keys only, no passwords, no root login; fail2ban on.
- **TLS:** put Caddy or nginx in front of Kong, with Let's Encrypt, for `db.<your domain>` (with the path rule above).
- **Updates:** unattended security upgrades on. Supabase images: upgrade on a schedule (monthly), after a backup, using a rehearsal copy
  first.
- **Docker logs:** rotate them (`max-size`), or the disk fills up.

## 4. Backups (not optional)

- **Continuous:** WAL-G or pgBackRest to Cloudflare R2 (an S3-compatible bucket only for backups, with its own key). A daily full backup
  plus the write-ahead log every few minutes means you can restore to any minute.
- **Nightly copy:** `pg_dump` of the whole database to the same bucket, kept for 30 days.
- **Restore drill:** restore the latest backup onto a scratch server once a month and open the CRM against it. A backup that was never
  restored is not known to work.
- **Contabo snapshots** are a convenience, not the backup.

## 5. Monitoring

- **Uptime:** the monitor on `/api/v1/health/database` (`docs/OUTAGES.md`), pointed at the CRM.
- **Server alerts** (Netdata, Better Stack, or Contabo's own): disk over 80%, memory over 90%, load high for 10 minutes, any container
  restarting.
- **Backups:** an alert when the last successful backup is older than 26 hours.

## 6. Moving over

### Rehearsal (do it once, on a weekday)
1. Copy production into the new server (steps 3–5 below) without switching anything.
2. Point a local or preview build of the CRM at it.
3. Sign in as a few roles, open each dashboard, punch in, send a chat message, and check notifications arrive live.
4. Note how long the copy took; that sets the maintenance window.

### The move (an evening, about 1 hour)
1. **Tell staff.** Set the Worker variable `SCHEDULED_ENABLED=false` so no job writes during the copy.
2. **Stop writes.** Put the CRM in maintenance: leave it open but tell staff not to work in it.
3. **Copy the database** with the Supabase CLI against the hosted project's connection string:
   - `supabase db dump --db-url "<hosted>" -f roles.sql --role-only`
   - `supabase db dump --db-url "<hosted>" -f schema.sql`
   - `supabase db dump --db-url "<hosted>" -f data.sql --use-copy --data-only`
   - The hosted copy includes the `auth` schema, so every staff, client and candidate password keeps working.
4. **Restore** in one transaction, stopping at the first error, with triggers switched off for the data. Otherwise the CRM's own
   triggers fire while rows are copied, write duplicate rows, and a later table's copy fails and is skipped:
   `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql -d "$NEW_DB_URL"`
5. **Check the copy:**
   - row counts of the main tables (`auth.users`, profiles, customers, attendance_records, notifications, chat_messages) match;
   - the CRM's triggers on sign-in accounts exist (they create a new employee's profile):
     `select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;` must list `on_auth_user_created`,
     `on_auth_user_created_deferred` and `on_auth_user_email_changed`. If any is missing, re-run its `create trigger` from
     `supabase/migrations/20261008000800_provision_staff_after_app_metadata.sql` and `20261006000300_domain_triggers.sql`;
   - `select * from pg_publication_tables where pubname = 'supabase_realtime'` lists the same tables as before.
6. **Switch the CRM:**
   - Worker secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
   - the front-end build's `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (redeploy);
   - Staff sign in once again, because the new server signs sessions with a new key.
7. **Check, then reopen:**
   - `/api/v1/health` reports the new database host and "ok";
   - `/api/v1/health/database` gives 200;
   - test one sign-in per role;
   - set `SCHEDULED_ENABLED=true`.

### The way back
- Keep the hosted Supabase project **untouched and paused-but-not-deleted for 2 weeks**.
- To go back, restore the Worker and front-end settings to the hosted values. Anything written on the new server after the move would
  need copying back, so decide within the first hours if something is wrong.

## 7. Who does what

| Task | How often |
| --- | --- |
| Check the backup alert and the uptime monitor | daily (a glance) |
| Security updates (automatic) and a look at disk/memory | weekly |
| Restore drill; Supabase image upgrade after a backup | monthly |
