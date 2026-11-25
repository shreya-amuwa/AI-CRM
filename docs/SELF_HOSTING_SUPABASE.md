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

In `.env`, set:
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`: new strong values,
  generated as Supabase's guide describes. Keep them in a password manager, never in the repository or in chat.
- `SITE_URL=https://crm.amuwacorporation.com` and `API_EXTERNAL_URL=https://db.<your domain>` (the address the CRM will use).
- **E-mail:** the CRM sends Auth e-mails through its hook (`docs/EMPLOYEE_WELCOME_EMAIL.md`, `server/automations/authEmailHook.ts`):
  - `GOTRUE_HOOK_SEND_EMAIL_ENABLED=true`
  - `GOTRUE_HOOK_SEND_EMAIL_URI=https://crm.amuwacorporation.com/api/v1/internal/auth/email-hook`
  - `GOTRUE_HOOK_SEND_EMAIL_SECRETS=<the same v1,whsec_... value as the Worker's SUPABASE_AUTH_HOOK_SECRET>`
- **Link lifetime (24 hours):** `GOTRUE_MAILER_OTP_EXP=86400`.
- Sign-up stays closed as today (staff are created by HR; candidates register through the CRM's own endpoint).

Extensions the CRM uses: `pg_trgm` and `pg_cron` (both in Supabase's Postgres image). `pg_cron` is optional; the Worker's cron does the
same work.

## 3. Security (before any data goes on it)

- **Firewall** (ufw): allow only 22 (SSH), 80 and 443. **Postgres (5432/6543) and Studio are never open to the internet.** Reach Studio
  through an SSH tunnel.
- **SSH:** keys only, no passwords, no root login; fail2ban on.
- **TLS:** put Caddy or nginx in front of Kong, with Let's Encrypt, for `db.<your domain>`.
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
4. **Restore** with `psql` into the new server, in that order (roles, schema, data).
5. **Check the copy:**
   - row counts of the main tables (profiles, customers, attendance_records, notifications, chat_messages) match;
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
