# Lead tags and CEO-managed Crocodial connections: design

Date: 2026-11-27. Status: draft for the owner's approval.

## Why

1. **Lead tags.**
   - Crocodial accounts have their own lead statuses ("demo done", "no response / unreachable", "on hold / future prospect"). Each
     account can add more at any time.
   - The CRM cannot represent them:
     - a lead has only 4 fixed statuses (`customers.lead_status`: NEW, CONTACTED, INTERESTED, READY_TO_BUY);
     - the Crocodial status mapping offers 9 fixed "dispositions" built into code (`20270304000100_crocodial_crm_lead_links.sql`).
   - Every new status therefore needs a developer.
   - The owner wants the Managing Director (MD, role `SUPER_ADMIN`) and CEOs (`DEPARTMENT_HEAD` with operations-head departments) to
     create tags themselves, from their dashboards.
2. **CEO-managed connections.**
   - Today only the MD manages Crocodial (`private.croc_require_admin`).
   - The access token must be a Cloudflare Worker secret named by `crocodial_connections.credential_ref`, which only someone with
     Cloudflare access can add.
   - The owner wants each CEO to connect their own departments' Crocodial account and run it, so the MD no longer has to.
   - A CEO must never connect, read or manage another department's data. Anything refused gets a clear message.

## Facts this design is built on (production, 2026-11-27)

- **CEOs and their departments** (`operations_head_departments`):
  - Aarti: Amuwa International, Amuwa Reseller, D Talk, Wabastar, Wabastore, Whatsbox.
  - Ashwini: D Talk, Digitree, Wabastore, Whatsbox.
  - **D Talk, Wabastore and Whatsbox are run by both.**
- **One Crocodial connection exists:** "M Pillar", linked to M Pillar Corporation (Sales), with 239 leads. M Pillar has no CEO, so
  the MD runs it.
- **Lead statuses** are read by reports, the pipeline board, incentives and performance. There are 24 migrations and about 11 UI
  files.
- **Encryption:** `server/automations/secrets.ts` already does AES-256-GCM with `AUTOMATION_SECRET_KEY` (used for client
  temporary passwords).

## Decisions made with the owner

- **A tag replaces the status (option A).**
  - Each lead has exactly one tag, as in Crocodial.
  - Crocodial statuses map one-to-one onto tags.
- **Who sees a tag.**
  - Tags created by the MD are company-wide.
  - A CEO's tags appear only in the departments that CEO runs. In departments run by two CEOs, both CEOs' tags appear.
- **Crocodial keys are encrypted in the CRM database (option A).**
  - AES-256-GCM with the existing `AUTOMATION_SECRET_KEY`.
  - Supabase Vault was rejected: it is tied to the Supabase instance and the database moves to self-hosting.
  - Cloudflare-only secrets were rejected: they defeat the purpose.
- **CEOs may run several departments.**
  - A CEO may link one Crocodial account to several departments, but only departments they run.

## Goals

- MD and CEOs create, rename, recolour and retire lead tags without a deploy.
- A Crocodial status maps to any tag the connection's departments can use, including new ones.
- A CEO connects Crocodial for departments they run (paste the token once) and does the whole setup there:
  - department links;
  - people mappings;
  - status mappings;
  - lead import Off / Preview / Import;
  - Reconcile now;
  - held-lead resolution.
- Department isolation is enforced in the database, not only in the UI.

## Non-goals

- Tags never change the lifecycle stage. LEAD → POTENTIAL/customer stays Accounts-verified only, as today.
- No multiple tags per lead (option B was rejected).
- No change to who sees which leads: lead visibility rules stay as they are.
- No Crocodial write-back. The integration stays read-only.

## Anti-goals (a failure even if it "works")

- A CEO sees or changes anything of a department they do not run: leads, calls, mappings, tags, connection settings or tokens.
- A token is ever shown back, logged, put in an audit entry, returned by an API, or stored unencrypted.
- Existing reports, incentives, performance or the pipeline board show different numbers after the change.
- M Pillar's working connection breaks or needs re-setup.

## Part 1: lead tags

### Data

- **New table `public.lead_tags`:**

  | Column | Meaning |
  |---|---|
  | `id` | uuid |
  | `label` | 1–40 characters, shown as typed |
  | `colour` | one of a fixed palette of about 8 names, so it matches the design system |
  | `stage` | NEW / CONTACTED / INTERESTED / READY_TO_BUY: the pipeline stage the tag counts as |
  | `scope` | `COMPANY` or `DEPARTMENTS` |
  | `created_by`, `created_at` | who and when |
  | `retired_at`, `retired_by` | set when retired |
  | `sort_order` | display order |

- **New table `public.lead_tag_departments (tag_id, department_id)`** for `DEPARTMENTS` scope. A CEO's tag gets the departments they
  run at creation.
  - A CEO may narrow that list, but only to departments they run.
- **Duplicates:** label uniqueness is case-insensitive within what one department can see. Creating "Demo done" where an active
  "demo done" is already visible is refused as CONFLICT.
- **Seed** (company-wide, created by the system):
  - the 4 current statuses, as tags with their own stage;
  - the 3 Crocodial statuses from the screenshot: "Demo done" → INTERESTED, "No response / unreachable" → CONTACTED, "On hold /
    future prospect" → CONTACTED.
  - The MD can change their stage later.
- **On `customers`:** add `lead_tag_id uuid references lead_tags`. Backfill every lead from its `lead_status` to the matching seed
  tag.
  - **`lead_status` stays** and is kept equal to the tag's `stage` by a trigger. All existing readers keep working unchanged.
  - Writing `lead_status` directly (old clients, Crocodial dispositions) sets the seed tag of that stage.

### Rules

- **Create / rename / recolour / retire:**
  - The MD: any tag.
  - A CEO: only tags whose departments are all departments they run. They cannot touch company-wide tags.
  - Everyone else: refused with `FORBIDDEN: Only the Managing Director or the department's CEO can manage lead tags.`
- **Changing a tag's `stage`** moves every lead with that tag, so the stage of leads already tagged changes. Allowed for the same
  people. The UI shows how many leads it affects before saving.
- **Retire, never delete.**
  - Leads keep a retired tag.
  - A retired tag is not offered for new choices.
  - The 4 seed status tags cannot be retired, so every stage always has a tag.
- **Tagging a lead:** whoever may edit the lead may set any active tag visible in the lead's department. A tag outside the lead's
  department is refused (VALIDATION_ERROR).
- **Audit:** every create, rename, recolour, stage change and retire is audited.

### UI

- **Where tags are managed:** a "Lead tags" page in the MD dashboard (all tags) and the CEO dashboard (company-wide tags read-only,
  plus their own). It shows label, colour chip, counts as, departments, leads using it, and retire / restore.
  - "New tag": label, colour, counts as, and departments (CEO: limited to theirs).
- **Lead form and lead page:** the "Lead status" select becomes "Tag". It lists active tags visible in the lead's department,
  grouped by stage, and shows the colour chip.
- **Pipeline cards, lists and filters** show the tag chip; filtering by tag sits alongside the stage filters.
- **READY_TO_BUY behaviour** (the "moves to Potential" prompts) follows the tag's stage, so it works unchanged.

## Part 2: Crocodial status mapping onto tags

- `crocodial_status_mappings` gains `tag_id`. Mapping a status means choosing a tag (or "Ignore").
  - The choices are the active tags usable in all of the connection's linked departments. Company-wide tags always qualify.
- Reconciliation sets `lead_tag_id`, and through it `lead_status`, from the mapped tag. The existing safety rules stay:
  - leads past the LEAD stage are never changed;
  - Converted never changes the lifecycle;
  - unknown statuses change nothing and are listed.
- **Existing disposition mappings migrate** to the matching seed tags:

  | Old disposition | New tag |
  |---|---|
  | NEW | New |
  | CONTACTED, FOLLOW_UP, NOT_INTERESTED, LOST | Contacted |
  | INTERESTED, DEMO_SCHEDULED | Interested |
  | CONVERTED | Ready to buy |
  | IGNORE | Ignore |

  The `disposition` column stays readable for one release, then is dropped in a later migration.
- **From the status mapping row:** "Create a tag from this status" pre-fills the label, so a new Crocodial status becomes a tag in
  one step.

## Part 3: CEO-managed Crocodial connections

### Token storage

- **New columns on `crocodial_connections`:**
  - `token_ciphertext` (AES-256-GCM via `encryptSecret`, `v1:` format);
  - `token_fingerprint` (sha256 of the token, hex, unique among active connections);
  - `token_last4`, shown as "•••• 1a2b";
  - `token_set_by`, `token_set_at`.
- **Lookup order** (`server/crocodial/client.ts` / `runtime.ts`): `token_ciphertext` when set, else the existing `credential_ref`
  Worker secret. M Pillar keeps working untouched, and the MD may later paste its key to move it into the database.
- **Saving a key:**
  1. The server checks its shape.
  2. It makes one live read (a page of users, limit 1) to prove the key works.
  3. It encrypts the key, then stores it through a service-role function.

  The plain key never reaches the database, logs, audit or API answers.
- **Errors:**
  - No `AUTOMATION_SECRET_KEY` on the server: "Crocodial keys can't be stored on this server. Ask the Managing Director." Nothing is
    stored.
  - A key whose fingerprint is already on another active connection: refused with "This Crocodial account is already connected (by
    another department)." The other connection's name is not revealed to a CEO who can't manage it.
- **Replace / remove:** "Replace key" re-tests and replaces. "Disconnect" clears the ciphertext and switches the connection off;
  synced data stays.

### Who manages a connection

- **The MD** manages every connection, as today.
- **A CEO** manages a connection only if they run **all** of its linked departments.
  - Example: Ashwini's account linked to D Talk + Digitree is hers alone. Aarti runs D Talk but not Digitree, so she cannot manage it.
  - Aarti still sees D Talk's Crocodial figures through the existing activity and lead pages.
- **A CEO can:**
  - create a connection (it starts linked to the departments they choose from their own, at least one);
  - add or remove links to departments they run;
  - approve people mappings, only to active employees of the connection's linked departments;
  - set status mappings (tags as above);
  - set lead import per linked department;
  - Reconcile now;
  - resolve held leads, linking only to records of the connection's departments.
- **Guard:** `private.croc_require_admin()` becomes `private.croc_require_manager(p_connection)` (MD, or a CEO running every linked
  department) for these functions. Creating a connection or adding a link checks `private.runs_department(p_department)`.
- **Refusals** use `FORBIDDEN: You can manage Crocodial only for departments you run.` The UI hides what the person can't use, and
  turns any FORBIDDEN that still arrives into that message, never an error screen.
- **The MD's view** keeps every connection. A "Managed by" column shows the CEO(s) who can manage each one. The MD can switch any
  connection off.

### UI

- **CEO dashboard:** a "Crocodial Integration" page next to their existing "Crocodial Overview". It shows only connections they
  manage, plus "Connect Crocodial".
- **The connection page** is the same component the MD uses (connection, people, status mapping, lead import, monitor), scoped by the
  database. It is reused, not copied.
- **Key form:** a password-type field, a "Test and save" button, and the result:
  - OK: "Connected: 23 Crocodial users found";
  - invalid key;
  - Crocodial unreachable;
  - already connected.

## Security and limits

- All new functions:
  - `security definer` with `set search_path = ''`;
  - revoked from public/anon;
  - token functions granted to `service_role` only;
  - errors prefixed NOT_FOUND / VALIDATION_ERROR / FORBIDDEN / CONFLICT.
- **Audit:** key set / replaced / removed (never the key, only last 4 and who), connection created, links changed, tag changes.
- **Rate limits:** "Test and save" 5 per CEO per 10 minutes (shared limiter). Tag creation 30 per person per day.
- **New tables:** RLS on, no direct grants; reads go through functions.

## Rollout and rollback

- **Migrations** are new timestamps after main's newest, safe to run twice, and pasteable in the SQL editor.
- **Backfill** is in the same migration. Afterwards, check that `count(*) where lead_tag_id is null and lifecycle = 'LEAD'` is 0.
- **Rollback:** the old `lead_status` column is still maintained and the old Worker-secret token path still works, so reverting the
  app is safe. Tag tables can stay.

## Tests the builder must write (beyond the usual)

- **Isolation:**
  - Aarti cannot read, mappings-edit, reconcile, link, or see the token state of a connection linked to Digitree.
  - Ashwini cannot link a connection to Amuwa Reseller.
  - Neither can approve a mapping to an employee of a department outside the connection.
- **Shared departments:** either CEO can manage a Wabastore-only connection; both CEOs' tags show in Wabastore.
- **Tags:**
  - stage sync both ways;
  - a retired tag isn't offered;
  - an outside-department tag is refused on a lead;
  - the seed backfill leaves report totals unchanged (before/after counts by `lead_status`).
- **Tokens:**
  - never returned or logged;
  - a wrong `AUTOMATION_SECRET_KEY` cannot decrypt;
  - a duplicate fingerprint is refused;
  - a Worker-secret connection still syncs.

## Left to the builder

Exact component split, palette names, the order of PRs (suggested: tags → mapping onto tags → CEO connections), and copy wording in
the plain style of the existing UI.
