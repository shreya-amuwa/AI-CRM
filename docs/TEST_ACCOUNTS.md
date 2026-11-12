# Dummy accounts for testing every dashboard

`npm run seed:test-accounts` creates one login for every dashboard, plus two client logins, through the application's own API as a Super Admin.
It uses the same calls as *Add Team Member* and the existing-customer import, so every rule of the real screens applies (who may create whom, one Sales
head and one Support head per department, Operations Heads and the departments they oversee, Technical Consultant / Meta Verifier flags, Sales roles).

```
API_URL=https://<your-app>/api/v1  SUPABASE_URL=https://<project>.supabase.co  SUPABASE_ANON_KEY=<anon key> \
SA_EMAIL=<your Super Admin e-mail>  npm run seed:test-accounts -- [--domain example.com] [--prefix qa] [--sep .] [--out qa-accounts.local.md] [--no-clients] [--dry-run]
```

The Super Admin password is asked for without echo (or `SA_PASSWORD`). Passwords are made up on every run and written **only** to the `--out` file
(mode 600; file names containing `.local.` are git-ignored). They are never printed or logged. Rerunning is safe: an account that already exists is left
alone and the file says so. `--dry-run` creates nothing.

| Login (`qa.<name>@<domain>`) | Opens |
|---|---|
| `sales.head` | Sales Department Head |
| `support.head` | Department Head (Support side) |
| `dept.head` | Department Head (no side) |
| `sales.lead` / `support.lead` | Sales / Support Team Lead |
| `sales.member` | Sales Team Member |
| `telecaller` / `business.associate` | Telecaller / Business Associate |
| `support.member` | Support Team Member |
| `technical.consultant` / `meta.verifier` | Technical Consultant / Meta Verifier |
| `ops.sales` / `ops.support` / `ops.both` | Sales / Support / Sales & Support Operations Head (oversee both sandbox departments) |
| `accounts.member` / `accounts.lead` / `accounts.head` | Accounts (the head only if the department has none) |
| `hr.member` (HR Assistant) / `hr.recruiter` (HR Recruiter) / `hr.head` (HR Admin Head) | HR (the head only if the department has none). `hr.lead` is only attempted: HR has no Team Lead designation, so the list says it was not created |
| `client.calls` / `client.whatsapp` | Client dashboard, sign in at `/client/login` (existing customers with live services) |

Your own Super Admin account opens the Super Admin dashboard.

## One password for every account

Add `--same-password`: the script asks for one password (typed twice, not shown; 10 to 72 characters, no spaces) and gives it to every account made in that run,
clients included. For a script, set `SEED_PASSWORD` instead. Use it on a test or staging project only: one shared, easy password is as weak as it is convenient.
An account that already exists keeps its own password (the file says "password unchanged"); to get the shared password for it, delete the user in Team Members
and run the script again, or use a new `--prefix`.

## Choosing the e-mail names

The login is `<prefix><sep><name>@<domain>`. By default `qa.sales.head@example.com`. With `--prefix wabastore --sep -` it becomes
`wabastore-sales-head@example.com`, `wabastore-support-member@example.com`, `wabastore-client-calls@example.com`, and so on. Each prefix gets its own pair of
sandbox departments ("Wabastore Sandbox", "Wabastore Sandbox Two"), so several sets can exist side by side (a department has one head per side).
`--domain amuwa.com` changes the domain (only use one where every `<prefix>...@` address is yours).

## Every real department (`--all-departments`)

```
npm run seed:test-accounts -- --all-departments --sep -
```

For each real department it makes one login per role it has teams for, named `<department-slug>-<role>@<domain>`:
`wabastore-sales-head`, `wabastore-sales-lead`, `wabastore-sales-member`, `wabastore-telecaller`, `wabastore-business-associate`,
`wabastore-support-head`, `wabastore-support-lead`, `wabastore-support-member`, `wabastore-technical-consultant`, `wabastore-meta-verifier`
(and the same for whatsbox, dtalk, digitree, mpillar, designstudio, wabastar, ...). A department with a single general team (for example Education & Training)
gets a head, a lead and a member. Accounts and HR get their members, leads and (if free) head. One extra **Operations Head** (`qa-ops-all`, home in a
sandbox) oversees every department. `--only wabastore,whatsbox` and `--skip dtalk` limit the list; try `--dry-run` first.

These are the **real** departments and teams: the test users sit next to real staff, and a head slot already held by a real Sales or Support head is
refused (the file lists it as "not created"). Run it on a staging project, or suspend the logins afterwards.

## What it touches

- Two sandbox departments (**QA Sandbox** and **QA Sandbox Two** by default), each with a Sales and a Support team. All sandbox staff and the Operations Heads
  (home: QA Sandbox Two) live there, so they never mix with real teams. Accounts and HR are the real departments: only members and leads are added.
- The default e-mail domain is `example.com`, so no real person is mailed. The clients' sign-in e-mail goes to `qa.client.*@example.com`
  (it bounces or is dropped; the passwords in the file work regardless).
- The database and Auth are the ones your `API_URL` points to: run it against a staging project, or accept that these users exist in production
  until you suspend or delete the `qa.*` users in *Team Members* (and the two sandbox departments).

## Tested

`supabase/tests/e2e/run-seed-test-accounts.sh` runs the script against a throw-away local stack, then signs in as every account, checks the
role / dashboard / flags (Technical Consultant, Meta Verifier, Sales roles, Operations Head side and departments), that both clients reach the client
API, and that a second run changes nothing and writes no password.
