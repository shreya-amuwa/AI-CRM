# Lead tags and CEO-managed Crocodial connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The MD and CEOs create lead tags themselves (one tag per lead, replacing the fixed lead status). Crocodial statuses map onto those tags. CEOs connect and run Crocodial for the departments they run, and only those.

**Architecture:**
- A `lead_tags` table: each tag counts as one of the 4 existing stages. A trigger keeps `customers.lead_status` equal to the tag's stage, so every existing reader keeps working.
- Crocodial status mappings point to tags.
- Crocodial keys are stored AES-256-GCM-encrypted (existing `server/automations/secrets.ts`).
- Every Crocodial function's "MD only" guard becomes "MD, or a CEO who runs every department linked to this connection". The database enforces it.

**Tech Stack:** Postgres (Supabase) migrations and security-definer functions; Hono server (`server/`); React + Tailwind (`src/`); tests in `supabase/tests` (SQL via `run.sh`, API via `run-api.sh`, unit and browser via `run-unit.sh`).

**Spec:** `docs/superpowers/specs/2026-11-27-lead-tags-and-ceo-crocodial-connections-design.md`

## Global Constraints

- **Three PRs**, each from the latest `origin/main`, each its own `claude/` branch:
  - PR 1: Tasks 1–4.
  - PR 2: Tasks 5–6.
  - PR 3: Tasks 7–10.
- **Migrations** (newest on main is `20270304000100`): `20270305000100_lead_tags.sql`, `20270306000100_crocodial_status_tags.sql`, `20270307000100_crocodial_ceo_connections.sql`. Before writing each one, check that no newer file landed on main; renumber if one did.
- **Migration rules:**
  - safe to run twice and pasteable in the SQL editor; no temp tables;
  - `security definer` + `set search_path = ''`; revoked from `public, anon`;
  - error prefixes `NOT_FOUND:` / `VALIDATION_ERROR:` / `FORBIDDEN:` / `CONFLICT:`;
  - every change audited with `private.write_audit`;
  - a rollback note in the header.
- **Never edit a migration already on main.** To change a function, copy its latest definition (find it with `grep -ln "function public.<name>(" supabase/migrations/*.sql | tail -1`) into the new migration and change only what the task says.
- **"Runs a department"** = `private.is_ceo_for_sales(p_department)` (Task 1). Never a plain `scope_covers`, which also covers ordinary Department Heads.
- **Tags never change the lifecycle stage.** LEAD → POTENTIAL/customer stays Accounts-verified only.
- **Crocodial keys** are never returned, logged, audited or stored in plain text. Only the last 4 characters may be shown.
- **Copy** (exact):
  - `FORBIDDEN: Only the Managing Director or the department's CEO can manage lead tags.`
  - `FORBIDDEN: You can manage Crocodial only for departments you run.`
  - `Switched off by the Managing Director. Ask the Managing Director to switch it back on.`
  - `This Crocodial account is already connected (by another department).`
  - `Crocodial keys can't be stored on this server. Ask the Managing Director.`
  - `Key needs to be entered again`
- **Tag colours** (fixed palette): `slate, blue, indigo, violet, green, amber, orange, red`.
- **Seed tags** (company-wide):

  | Label | Stage | Seed of stage (cannot be retired) |
  |---|---|---|
  | New | NEW | yes |
  | Contacted | CONTACTED | yes |
  | Interested | INTERESTED | yes |
  | Ready to buy | READY_TO_BUY | yes |
  | Demo done | INTERESTED | no |
  | No response / unreachable | CONTACTED | no |
  | On hold / future prospect | CONTACTED | no |

- **Before each PR:** merge (not rebase) `origin/main`; `npm run typecheck`, `run.sh`, `run-api.sh`, `run-unit.sh`, `npm run build`, `npm run docs:check` all green; a fresh reviewer; open the PR and stop. Never merge or deploy.

## Review Focus

1. **A lead created or edited by any older path** (sheet upload, `create_lead`, `update_lead` with `lead_status`, Crocodial import, Excel import) must end up with the seed tag of its stage, never a null tag. Test in Task 1.
2. **A label typed with different case or spaces** ("Demo done ", "demo DONE") is the same tag: refused as CONFLICT where an active one is visible. Test in Task 2.
3. **A CEO who loses a department** (their `operations_head_departments` row removed): their tags leave that department, and its leads on those tags fall back to the seed tag of the same stage. Test in Task 1.
4. **A pasted key with spaces or a trailing newline** is trimmed before the shape check, the live test and the fingerprint. The same key pasted again, with different whitespace, is a duplicate. Test in Task 8.
5. **Crocodial unreachable or answering 401 while saving a key:** nothing is stored, and the CEO sees which one it was. Test in Task 8.

---

## PR 1: Lead tags

### Task 1: Tag tables, the stage-sync trigger, backfill

**Files:**
- Create: `supabase/migrations/20270305000100_lead_tags.sql`
- Test: `supabase/tests/lead_tags_test.sql` (register at the end of `supabase/tests/run.sh`)

**Interfaces:**
- Produces:
  - tables `public.lead_tags (id uuid pk, label text, colour text, stage text, scope text check in ('COMPANY','DEPARTMENTS'), seed_stage text unique null, sort_order int, created_by uuid, created_at, retired_at, retired_by)` and `public.lead_tag_departments (tag_id, department_id, primary key both)`. RLS on, no grants.
  - `customers.lead_tag_id uuid references lead_tags`.
  - `private.is_ceo_for_sales(p_department uuid) returns boolean`: the caller is an ACTIVE `DEPARTMENT_HEAD` with `is_operations_head` and `private.scope_covers(auth.uid(), p_department, 'SALES')`.
  - `private.lead_tag_usable(p_tag uuid, p_department uuid) returns boolean`: active and (COMPANY, or `p_department` is in its departments by base department).
  - `private.lead_tag_seed(p_stage text) returns uuid`.
  - Trigger `customers_lead_tag_sync` (BEFORE INSERT OR UPDATE OF `lead_tag_id, lead_status, department_id`), in order:
    1. tag changed and not null → `VALIDATION_ERROR: That tag can't be used in this lead's department.` unless usable; else `lead_status := tag.stage`;
    2. otherwise, if `lead_status` changed or the tag is null → `lead_tag_id := seed(lead_status)`;
    3. otherwise, if the department changed and the tag isn't usable → `lead_tag_id := seed(lead_status)`.
  - Trigger on `operations_head_departments` AFTER DELETE: remove that department from tags `created_by` that profile, and re-seed affected leads.

- [ ] **Step 1: Write the failing SQL test**

  Fixtures: CEOs created like `sales_ceo_assignment_test.sql`, with `test.create_auth_user(... 'provisioned_operations_head', true)` and `operations_head_departments` rows:
  - `lt_ceo_a`: wabastore + whatsbox, division null;
  - `lt_ceo_b`: whatsbox + digitree, division null;
  - `lt_ceo_sup`: whatsbox, SUPPORT only.

  Checks:
  - the 7 seed tags exist with the stages above;
  - `select count(*) from customers where lifecycle = 'LEAD' and lead_tag_id is null` = 0 after the migration;
  - counts by `lead_status` are equal before and after re-running the migration;
  - `update customers set lead_status = 'INTERESTED'` → tag = the Interested seed;
  - setting `lead_tag_id` to "Demo done" → `lead_status = 'INTERESTED'`;
  - `create_lead(...)` with no tag → seed of NEW;
  - a tag limited to wabastore set on a digitree lead → VALIDATION_ERROR;
  - moving a lead with a wabastore-only tag to a digitree owner → the seed tag of the same stage;
  - deleting `lt_ceo_a`'s wabastore row → that CEO's wabastore-only tag no longer lists wabastore, and its wabastore leads are re-seeded (Review Focus 3);
  - `is_ceo_for_sales` is true for `lt_ceo_a` on wabastore, false for `lt_ceo_sup` on whatsbox, false for the plain `sh_head` Department Head.
- [ ] **Step 2: Run** `PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=root bash supabase/tests/run.sh`. Expected: fails at `lead_tags_test.sql` (the relation does not exist).
- [ ] **Step 3: Write the migration.** Tables and seeds (`on conflict (seed_stage)` / by label for the 3 Crocodial seeds), the helpers and both triggers. Backfill `update customers set lead_tag_id = lead_tag_seed(lead_status) where lead_tag_id is null`.
- [ ] **Step 4: Run `run.sh`.** Expected: `lead_tags_test.sql` passes, and every earlier file still passes (the triggers must not break earlier lead tests).
- [ ] **Step 5: Commit.**

### Task 2: Managing tags (database and API)

**Files:**
- Modify: `supabase/migrations/20270305000100_lead_tags.sql`
- Create: `server/services/LeadTagService.ts`; routes in `server/routes.ts`; controller in `server/controllers/index.ts`; `src/lib/api/leadTags.ts`
- Test: `supabase/tests/lead_tags_test.sql`, `supabase/tests/api_integration.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `public.lead_tags_list(p_department uuid default null) returns jsonb`: an array of `{id, label, colour, stage, scope, departmentIds, retired, seed, leadCount, canManage}`.
    - MD: all tags.
    - CEO: COMPANY plus tags touching their departments.
    - Anyone else: tags usable in `p_department`, or in their own department when null.
  - `public.lead_tag_save(p jsonb) returns jsonb`: `p = {id?, label, colour, stage, departmentIds?}`.
    - MD: may save COMPANY tags (no `departmentIds`) or DEPARTMENTS tags.
    - CEO: only DEPARTMENTS tags; `departmentIds` default to every department they run, and each must satisfy `is_ceo_for_sales`.
    - The label is trimmed, 1–40 characters; duplicates are compared case-insensitively against active tags visible in any of the same departments → CONFLICT.
    - A stage change updates `lead_status` of every lead with the tag.
    - Narrowing departments re-seeds leads that are no longer usable.
  - `public.lead_tag_retire(p_id uuid, p_retired boolean) returns jsonb`. Seed-of-stage tags → `VALIDATION_ERROR: A stage's basic tag can't be retired.`
  - `public.lead_tag_set(p_customer uuid, p_tag uuid) returns void`: security invoker (lead RLS decides who may edit).
  - API:
    - `GET /lead-tags?departmentId=`
    - `POST /lead-tags` (save)
    - `POST /lead-tags/:id/retire` `{retired}`
    - `POST /pipeline/leads/:id/tag` `{tagId}`
  - Front-end client `leadTagsApi.list(departmentId?)`, `.save(input)`, `.retire(id, retired)`, `.setOnLead(leadId, tagId)`.

- [ ] **Step 1: Write the failing SQL checks** (append to `lead_tags_test.sql`):
  - `lt_ceo_a` creates "Hot" → departments = {wabastore, whatsbox};
  - `lt_ceo_b` sees "Hot" in whatsbox but cannot rename it (it isn't all theirs) → FORBIDDEN with the exact copy;
  - `lt_ceo_a` adding digitree → FORBIDDEN;
  - " hot " in whatsbox → CONFLICT (Review Focus 2);
  - `tm_a` (a team member) saving → FORBIDDEN;
  - retiring the New seed → VALIDATION_ERROR;
  - a retired tag is absent from the lists of non-managers;
  - changing "Hot" from INTERESTED to CONTACTED moves its leads' `lead_status`;
  - every action is in `audit_logs`, with actions `LEAD_TAG_CREATED / _UPDATED / _RETIRED`.
- [ ] **Step 2: Run `run.sh`.** Expected: FAIL (the function doesn't exist).
- [ ] **Step 3: Implement the functions.** Then `LeadTagService` with `list(departmentId?)`, `save(body)` (zod: label 1–40, colour from the palette, stage from the 4, `departmentIds` uuid[] ≤ 20), `retire(id, retired)` and `setOnLead(id, tagId)`. Creating a tag (no `id`) is rate limited with `enforce([{ key: 'lead-tag-create:' + actorId, limit: 30, window: 86400 }], 'shared')` (`server/http/rateLimit.ts`). Routes: write routes `options: S`.
- [ ] **Step 4: API checks** in `api_integration.test.ts`: the MD creates a company tag (201/200); a 31st tag created by the same person within a day → 429 (lower the limit through the test's env if the suite allows, otherwise loop); a team member gets 403 on save; `GET /lead-tags` as a team member lists company tags and none of another department's; setting another department's tag on a lead → 422.
- [ ] **Step 5: Run `run.sh` and `run-api.sh`.** Expected: PASS. Commit.

### Task 3: "Lead tags" page for the MD and CEOs

**Files:**
- Create: `src/components/leadTags/LeadTagsPage.tsx`, `src/components/leadTags/TagChip.tsx`, `src/components/leadTags/useLeadTags.ts`
- Modify: `src/components/superadmin/SuperAdminDashboard.tsx` (page `'lead-tags'`, nav "Lead tags"); `src/components/sales-head/SalesHeadDashboard.tsx` (page `'lead-tags'`, shown only when `operationsHead`)
- Test: `supabase/tests/ui_lead_tags.test.mjs` (harness `supabase/tests/ui/lead_tags_harness.tsx`, stubbed API like `ui_bot_check`); register on line 22 of `run-unit.sh`

**Interfaces:**
- Consumes: `leadTagsApi` (Task 2).
- Produces:
  - `useLeadTags(departmentId?: string): { tags: LeadTag[]; byId: Map<string, LeadTag>; reload(): void }`.
  - `<TagChip tag={LeadTag} />`.
  - `type LeadTag = { id; label; colour; stage: LeadStatus; scope; departmentIds: string[]; retired; seed; leadCount; canManage }`.

- [ ] **Step 1: Failing browser test.**
  - The page lists tags with chip, "Counts as" and "Leads".
  - "New tag" posts `{label, colour, stage, departmentIds}`.
  - Changing a tag's stage shows "This moves N leads to <stage>." before saving.
  - Rows with `canManage: false` have no edit or retire buttons.
  - A FORBIDDEN answer shows its message inline, not an error screen.
  - No sideways scroll at 360px.
- [ ] **Step 2: Run** `node supabase/tests/ui_lead_tags.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement the page.** A table on desktop and cards below `sm`, matching existing dashboard pages (e.g. `NoticeBoard`). A CEO sees company tags read-only.
- [ ] **Step 4: Run.** Expected: PASS. Commit.

### Task 4: Tags on leads (form, lead page, cards, filters)

**Files:**
- Modify: `src/components/team-member/pipeline/LeadForms.tsx` (the "Lead status" select at about line 598, the status logic at about lines 727/785/888/958), `src/components/team-member/pipeline/LeadsView.tsx`, `src/components/team-member/pipeline/shared.tsx`, `src/services/teamMemberStore.ts` (select `lead_tag_id`)
- Test: extend the existing pipeline browser test that covers the lead form (find it with `grep -l "lead-leadStatus" supabase/tests/*.mjs`), or add `ui_lead_tag_form.test.mjs`

**Interfaces:**
- Consumes: `useLeadTags`, `TagChip`, `leadTagsApi.setOnLead`.
- The form keeps sending `leadStatus` for old servers; it also sends the tag through `setOnLead`. `READY_TO_BUY` behaviour reads `tag.stage`.

- [ ] **Step 1: Failing test.**
  - The lead form shows "Tag" grouped by stage, with active tags only.
  - Choosing "Demo done" saves `tagId`, and the card shows the chip.
  - A tag with stage READY_TO_BUY shows the existing "Moves to Potential" prompt.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Filters gain a "Tag" select next to the stage filters.
- [ ] **Step 4: Run.** Expected: PASS. Then the PR checklist (Global Constraints). Update `docs/` (a new "Lead tags" section in the sales pipeline doc found by `grep -l "lead status" docs/*.md`). Open PR 1.

## PR 2: Crocodial statuses onto tags

### Task 5: Mappings point to tags; reconciliation writes tags

**Files:**
- Create: `supabase/migrations/20270306000100_crocodial_status_tags.sql`
- Test: `supabase/tests/crocodial_status_tags_test.sql` (register after `crocodial_lead_links_test.sql` in `run.sh`); `api_integration.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2.
- Produces:
  - `crocodial_status_mappings.tag_id uuid null references lead_tags` and `ignored boolean not null default false`. Backfill from `disposition` using the spec's table; `IGNORE` → `ignored = true`.
  - `public.croc_status_mapping_tag_set(p_connection uuid, p_status text, p_tag uuid, p_ignore boolean default false) returns jsonb`. `p_tag` must be usable in every department linked to the connection → else `VALIDATION_ERROR: That tag can't be used in every department of this connection.` Both null and false → the mapping is removed. Guard: unchanged (`private.require_super_admin()`) in this PR; Task 9 widens it.
  - `croc_reconcile`, copied from `20270304000100`: replace the disposition lookup with `select tag_id, ignored ... into v_tag, v_ignored`. Wherever it set `lead_status = coalesce(private.croc_disposition_status(v_disp), lead_status)`, set `lead_tag_id = coalesce(v_tag, lead_tag_id)` instead (the trigger sets `lead_status`). New leads get `coalesce(v_tag, lead_tag_seed('NEW'))`. Everything else is unchanged.
  - `croc_reconcile_overview`, copied: the mapping rows add `tagId` and `ignored`.
  - Trigger on `crocodial_department_links` AFTER INSERT/UPDATE: mappings whose tag isn't usable in every linked department → set `tag_id = null`; the count goes into the audit metadata.
  - API: `POST /crocodial/connections/:id/status-mappings` now takes `{status, tagId?: uuid|null, ignore?: boolean}`. The old `{disposition}` body is still accepted and translated with the same table.

- [ ] **Step 1: Failing SQL test:**
  - mapping "demo done" → "Demo done" makes a reconciled LEAD get that tag and `lead_status = 'INTERESTED'`;
  - a protected (past-LEAD) record is unchanged;
  - an ignored status changes nothing;
  - a wabastore-only tag is refused for a connection also linked to M Pillar;
  - adding a link to a department where a mapped tag isn't usable resets that mapping;
  - old dispositions were migrated exactly per the spec's table.
- [ ] **Step 2: Run `run.sh`.** Expected: FAIL.
- [ ] **Step 3: Implement** the migration and the route/service change in `server/services/CrocodialService.ts` / `CrocodialRepository.ts`.
- [ ] **Step 4: Run `run.sh` and `run-api.sh`.** Expected: PASS (including the existing `crocodial_lead_links_test.sql` and the API "crocodial pipeline" checks). Commit.

### Task 6: Status mapping UI on tags

**Files:**
- Modify: `src/components/crocodial/CrocodialLeadPipeline.tsx` (the status mapping list in the screenshot)
- Test: the existing `ui_crocodial_pipeline.test.mjs`

- [ ] **Step 1: Failing test.**
  - Each unknown status row has a select of tags (grouped by stage, plus "Ignore" and "Not mapped").
  - "Create a tag from this status" opens the tag form pre-filled with the status label. Saving creates the tag and maps the status in one go.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with `useLeadTags` and `TagChip`. Departments for the tag form default to the connection's linked departments.
- [ ] **Step 4: Run.** Expected: PASS. PR checklist; update `docs/CROCODIAL_INTEGRATION.md` (status mapping is now tags; the disposition table becomes the migration table). Open PR 2.

## PR 3: CEO-managed Crocodial connections

### Task 7: Who may manage a connection (database guard)

**Files:**
- Create: `supabase/migrations/20270307000100_crocodial_ceo_connections.sql`
- Test: `supabase/tests/crocodial_ceo_connections_test.sql` (register last in `run.sh`)

**Interfaces:**
- Consumes: `private.is_ceo_for_sales` (Task 1).
- Produces:
  - `private.croc_can_manage(p_connection uuid) returns boolean`: the MD, or `is_ceo_for_sales` is true for every department in `crocodial_department_links` of the connection, with at least one link.
  - `private.croc_require_manager(p_connection uuid)`: raises the exact FORBIDDEN copy.
  - Columns `crocodial_connections.md_disabled_at timestamptz` and `crocodial_department_links.md_disabled_at timestamptz`.
  - **Functions copied from their latest definitions, with the guard changed to `croc_require_manager(<connection>)`:**
    - `croc_admin_connection`;
    - `croc_mapping_check`, `croc_mapping_create` (the profile must be ACTIVE with its department in the connection's links, else `VALIDATION_ERROR: Choose an employee of this connection's departments.`);
    - `croc_mapping_approve`, `croc_mapping_revoke`, `croc_mapping_count_from` (the connection via the mapping);
    - `croc_status_mapping_tag_set`, `croc_lead_import_set`, `croc_lead_links_list`, `croc_lead_link_resolve` (the connection via the link; `p_customer` must be in a linked department), `croc_reconcile_overview`, `croc_sync_request`;
    - and `croc_reconcile` when called by a signed-in user (service role unchanged).
  - **`croc_admin_overview`:** the MD gets everything as before. A CEO gets only connections where `croc_can_manage` is true, no rollout table, and `departments` limited to those passing `is_ceo_for_sales`. Each connection gains `managedBy: [{id, name}]` (CEOs for whom `croc_can_manage` would be true).
  - **`croc_connection_save(p jsonb)`:**
    - MD: as before (`credentialRef` still allowed).
    - CEO: `credentialRef` refused; required `departmentIds` (≥1, each passing `is_ceo_for_sales`) → creates the connection and SALES links in one transaction, and sets `crocodial_rollout` allowed for each (audited as by that CEO).
    - Enabling while `md_disabled_at` is set, by a non-MD → `CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.`
    - MD switching off sets `md_disabled_at`; MD switching on clears it.
  - **`croc_department_link_save`:** manager of the connection AND `is_ceo_for_sales(p_department)` (MD: as before). SALES only for CEOs. Auto-allows the rollout. Applies the same `md_disabled_at` rule.
  - `croc_rollout_set`: stays MD only.
  - `crocodial_connections.credential_ref`: becomes nullable; the unique constraint is kept for non-null values.

- [ ] **Step 1: Failing SQL test** (fixtures from Task 1: `lt_ceo_a` wabastore+whatsbox, `lt_ceo_b` whatsbox+digitree, `lt_ceo_sup`):
  - `lt_ceo_a` creates a connection for wabastore+whatsbox → OK, and the rollout is allowed;
  - `lt_ceo_b` can't open it (FORBIDDEN exact copy: it includes wabastore);
  - `lt_ceo_b` creates one for whatsbox only → `lt_ceo_a` can also manage it (`croc_can_manage` true);
  - `lt_ceo_a` linking digitree → FORBIDDEN;
  - `lt_ceo_sup` creating anything → FORBIDDEN;
  - mapping an employee of digitree onto `lt_ceo_a`'s connection → VALIDATION_ERROR;
  - `lt_ceo_a`'s overview doesn't contain the M Pillar connection or its leads count;
  - after the MD switches `lt_ceo_a`'s connection off, `lt_ceo_a` switching it on → CONFLICT with the exact copy;
  - a plain Department Head (`sh_head`) → FORBIDDEN everywhere;
  - the MD's results for the existing `crocodial_*_test.sql` files are unchanged (those files must still pass).
- [ ] **Step 2: Run `run.sh`.** Expected: FAIL.
- [ ] **Step 3: Implement the migration.**
- [ ] **Step 4: Run `run.sh`.** Expected: PASS, including every earlier `crocodial_*` file. Commit.

### Task 8: Storing and using encrypted keys

**Files:**
- Modify: `supabase/migrations/20270307000100_crocodial_ceo_connections.sql`, `server/services/CrocodialService.ts`, `server/repositories/CrocodialRepository.ts`, `server/crocodial/sync.ts`, `server/routes.ts`, `server/controllers/index.ts`
- Create: `server/crocodial/keys.ts`
- Test: `supabase/tests/crocodial_keys.test.ts` (unit, register in `run-unit.sh` line 9); SQL checks in `crocodial_ceo_connections_test.sql`; `api_integration.test.ts`

**Interfaces:**
- Produces:
  - Columns `token_ciphertext text`, `token_fingerprint text` (partial unique index where not null), `token_last4 text`, `token_set_by uuid`, `token_set_at timestamptz`.
  - Health value `KEY_UNREADABLE` added to the health check constraint.
  - Service-role-only functions:
    - `croc_token_store(p_connection uuid, p_ciphertext text, p_fingerprint text, p_last4 text, p_actor uuid) returns jsonb` (unique violation → `CONFLICT: This Crocodial account is already connected (by another department).`; audit `CROCODIAL_KEY_SET` with last4 only);
    - `croc_token_clear(p_connection uuid, p_actor uuid)` (also switches the connection off; audit `CROCODIAL_KEY_REMOVED`);
  - `croc_sync_due` copied: it also returns `tokenCiphertext`.
  - `croc_can_manage_check(p_connection uuid) returns void`: authenticated; raises FORBIDDEN, so the server checks permission as the user before touching the key.
  - `server/crocodial/keys.ts`:
    - `normaliseKey(raw: string): string` (trim, remove whitespace and newlines);
    - `keyFingerprint(key: string): string` (sha256 hex);
    - `sealKey(key: string, secret: string): string` and `openKey(cipher: string, secret: string | null): string | null`, wrapping `encryptSecret` / `decryptSecret`.
  - `CrocodialService.saveKey(id: string, raw: string, actorId: string): Promise<{ ok: true; last4: string; users: number }>`:
    1. `croc_can_manage_check` as the user;
    2. rate limit `{ key: 'croc-key:' + actorId, limit: 5, window: 600 }` shared;
    3. no `AUTOMATION_SECRET_KEY` → `AppError('SERVICE_UNAVAILABLE', <exact copy>)`;
    4. `tokenFormatValid`;
    5. a live read of 1 user with the new key (`testCrocodialConnection` with a token override): 401/403 → `VALIDATION_ERROR: Crocodial refused this key.`, network/5xx → `SERVICE_UNAVAILABLE: Crocodial could not be reached. Nothing was saved; try again.`;
    6. `croc_token_store` with the service client.
  - `CrocodialService.removeKey(id, actorId)`.
  - Routes: `POST /crocodial/connections/:id/key {key}`, `DELETE /crocodial/connections/:id/key` (both `options: S`).
  - **Sync** (`sync.ts`): the token is `tokenCiphertext ? openKey(...) : crocodialToken(credentialRef)`. A ciphertext that won't open → `croc_connection_status(id, 'KEY_UNREADABLE', null)` and the connection is skipped.
  - `croc_admin_overview` / `croc_admin_connection` add `keySource: 'DATABASE'|'SERVER_SETTING'|'NONE'` and `keyLast4`. They never include ciphertext or fingerprint.

- [ ] **Step 1: Failing unit test** `crocodial_keys.test.ts`:
  - `normaliseKey(' abc\n ') === 'abc'` (Review Focus 4);
  - the same fingerprint for `'abc'` and `' abc\n'`;
  - `openKey(sealKey(k, 's1'), 's1') === k`;
  - `openKey(sealKey(k, 's1'), 's2') === null`;
  - `openKey('garbage', 's1') === null`.

  Plus a `saveKey` test with stub repo/client:
  - a 401 from Crocodial → VALIDATION_ERROR and store not called;
  - a network error → SERVICE_UNAVAILABLE and store not called (Review Focus 5);
  - no secret → SERVICE_UNAVAILABLE with the exact copy;
  - success → store called with ciphertext ≠ key and last4 = the key's last 4.
- [ ] **Step 2: Run** `scratchpad/ut.sh crocodial_keys` (or `run-unit.sh`). Expected: FAIL.
- [ ] **Step 3: Implement** `keys.ts`, the service methods, routes, the sync change and the SQL.
- [ ] **Step 4: SQL and API checks.**
  - SQL: `croc_token_store` is not executable by `authenticated`; a duplicate fingerprint → CONFLICT; no audit row contains the ciphertext.
  - API: as `lt_ceo_a` (create the API fixture like the Sales CEO block), `POST key` on a connection they don't manage → 403; with a fake Crocodial server returning 200 → 200, `keyLast4` shown, and the response body doesn't contain the key; a second connection with the same key → 409.
- [ ] **Step 5: Run `run-unit.sh`, `run.sh` and `run-api.sh`.** Expected: PASS. Commit.

### Task 9: CEO Crocodial setup page

**Files:**
- Modify: `src/components/crocodial/CrocodialAdminPage.tsx` (role-aware: hide the rollout table and the `credentialRef` field when `!isMd`; a `departmentIds` picker on create; `managedBy`, `keySource`, `md_disabled` states)
- Create: `src/components/crocodial/CrocodialKeyForm.tsx`
- Modify: `src/components/sales-head/SalesHeadDashboard.tsx` (page `'crocodial-setup'`, nav "Crocodial Integration", only when `operationsHead`)
- Test: `supabase/tests/ui_crocodial_ceo_setup.test.mjs` (stubbed API), registered in `run-unit.sh`

**Interfaces:**
- Consumes: Task 7 and Task 8 API shapes.
- `<CrocodialKeyForm connectionId keySource keyLast4 onSaved />`: a password-type input and "Test and save". It shows:
  - "Connected: N Crocodial users found";
  - "Crocodial refused this key.";
  - the unreachable message;
  - the duplicate message;
  - "Key needs to be entered again" for `KEY_UNREADABLE`.

  "Replace key" and "Disconnect" (with confirmation).

- [ ] **Step 1: Failing browser test** (as a CEO with 2 departments):
  - "Connect Crocodial" lists only their departments;
  - the key field is a password type and is cleared after saving;
  - a 403 answer shows "You can manage Crocodial only for departments you run." inline;
  - an MD-disabled connection shows the exact copy and no "Switch on";
  - no rollout table is rendered;
  - no sideways scroll at 360px.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse the existing connection sections (people, status mapping, lead import, monitor). The database scopes them.
- [ ] **Step 4: Run.** Expected: PASS. Commit.

### Task 10: MD view, docs, PR

**Files:**
- Modify: `src/components/crocodial/CrocodialAdminPage.tsx` (MD: a "Managed by" column, the key source, the switch-off control setting the MD flag), `docs/CROCODIAL_INTEGRATION.md` (a section "CEOs connect their own departments", key storage, rotation note: changing `AUTOMATION_SECRET_KEY` means re-entering keys), `docs/SECURITY.md` (keys at rest)

- [ ] **Step 1:** Extend `ui_crocodial_ceo_setup.test.mjs` with an MD run: "Managed by" shows the CEO names; switching off shows "Switched off by you"; the key source shows "Stored (•••• 1a2b)" or "Server setting".
- [ ] **Step 2: Run.** Expected: FAIL. Then implement. Then PASS.
- [ ] **Step 3:** PR checklist (Global Constraints). In the PR body: the migration, the owner's steps (none required; M Pillar unchanged; optionally paste M Pillar's key to move it into the database), and the rollback (the old `credential_ref` path still works). Open PR 3.
