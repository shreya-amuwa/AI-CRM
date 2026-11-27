-- =============================================================================
-- Crocodial -> CRM lead pipeline: the lead fields kept, observed ownership history, an explicit external-to-CRM lead link, configurable status
-- mapping, a per-department import switch (OFF -> PREVIEW -> IMPORT), a resumable reconciliation run by the existing sync, the Super Admin's
-- reconciliation monitor and the lead page's Crocodial activity. docs/CROCODIAL_INTEGRATION.md, "Leads in the CRM pipeline".
--
-- Rules (enforced here, not in the browser):
--  * The CRM owner of an imported lead is the approved mapping of Crocodial's assigned_to (connection + external user id; never a name).
--    An assignee without a mapping, or mapped outside the department, is held for reconciliation and never given to someone else.
--  * One link per (connection, external lead) (unique). A lead seen again updates its link; it is never created twice. Two runs at once are
--    serialised per connection (advisory lock) and the same transaction creates the customer and its link.
--  * Matching: a normalised phone (last 10 digits) or e-mail of a customer IN THE SAME DEPARTMENT is evidence, not identity: one candidate
--    that is still a lead of the same owner is linked; one owned by someone else -> OWNER_CONFLICT; one already beyond LEAD (onboarding,
--    customer...) -> PROTECTED (linked, never changed or downgraded); several -> AMBIGUOUS. Nothing is merged across departments.
--  * Crocodial decides the external status, assignee, calls, follow-ups and remarks. The CRM keeps payments, invoices, onboarding, services,
--    incentives, portal access and its own assignments: a lead whose owner was changed in the CRM switches to CRM_OVERRIDE and the next sync
--    never moves it back (the difference is shown). Only lead_status (NEW / CONTACTED / INTERESTED / READY_TO_BUY) and the next follow-up of a
--    lead still at LEAD are ever written, through an explicit status mapping, and only when the Crocodial update is newer than the last CRM
--    edit. "Converted" never changes the lifecycle (Accounts verification stays the only way).
--  * Imported and re-assigned leads never trigger the welcome WhatsApp or other lead automations.
--  * A record that disappears from Crocodial is never deleted here.
-- Additive and safe to run twice. Nothing is deleted. Lead import stays OFF for every department until the Super Admin switches it on.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. More of Crocodial's lead (only what the CRM uses; custom fields only for the keys the Super Admin allows per connection)
-- ---------------------------------------------------------------------------
alter table public.crocodial_ext_leads add column if not exists email text check (email is null or length(email) <= 254);
alter table public.crocodial_ext_leads add column if not exists interest text check (interest is null or length(interest) <= 200);
alter table public.crocodial_ext_leads add column if not exists budget numeric(14, 2);
alter table public.crocodial_ext_leads add column if not exists deal_value numeric(14, 2);
alter table public.crocodial_ext_leads add column if not exists products text check (products is null or length(products) <= 500);
alter table public.crocodial_ext_leads add column if not exists import_batch_ext text check (import_batch_ext is null or length(import_batch_ext) <= 80);
alter table public.crocodial_ext_leads add column if not exists call_due_at timestamptz;
alter table public.crocodial_ext_leads add column if not exists expected_close_at timestamptz;
alter table public.crocodial_ext_leads add column if not exists ai_call_status text check (ai_call_status is null or length(ai_call_status) <= 60);
alter table public.crocodial_ext_leads add column if not exists custom_fields jsonb check (custom_fields is null or (jsonb_typeof(custom_fields) = 'object' and pg_column_size(custom_fields) <= 4000));
alter table public.crocodial_connections add column if not exists custom_field_keys text[] not null default '{}';
create index if not exists crocodial_ext_leads_updated on public.crocodial_ext_leads (connection_id, external_updated_at);
create index if not exists crocodial_ext_calls_lead on public.crocodial_ext_calls (connection_id, lead_ext, call_at desc);
create index if not exists crocodial_ext_followups_lead on public.crocodial_ext_followups (connection_id, lead_ext);
create index if not exists crocodial_ext_remarks_lead on public.crocodial_ext_remarks (connection_id, lead_ext);

-- ownership as the CRM observed it (Crocodial has no assignment history: the time is when a sync first saw it, the actor is unknown)
create table if not exists public.crocodial_lead_owner_history (
  id bigserial primary key,
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_lead_id bigint not null,
  assigned_to_ext bigint,
  observed_at timestamptz not null default now()
);
create index if not exists crocodial_lead_owner_history_lead on public.crocodial_lead_owner_history (connection_id, external_lead_id, observed_at desc);

create or replace function private.tg_croc_lead_owner_seen()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.assigned_to_ext is distinct from old.assigned_to_ext then
    insert into public.crocodial_lead_owner_history (connection_id, external_lead_id, assigned_to_ext) values (new.connection_id, new.external_id, new.assigned_to_ext);
  end if;
  return null;
end $$;
revoke all on function private.tg_croc_lead_owner_seen() from public, anon, authenticated;
drop trigger if exists crocodial_ext_leads_owner_seen on public.crocodial_ext_leads;
create trigger crocodial_ext_leads_owner_seen after insert or update of assigned_to_ext on public.crocodial_ext_leads
  for each row execute function private.tg_croc_lead_owner_seen();

-- ---------------------------------------------------------------------------
-- 2. Status mapping, the import switch, the links, the run state
-- ---------------------------------------------------------------------------
create table if not exists public.crocodial_status_mappings (
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_status text not null check (external_status = lower(btrim(external_status)) and length(external_status) between 1 and 80),
  disposition text not null check (disposition in ('NEW', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'DEMO_SCHEDULED', 'NOT_INTERESTED', 'LOST', 'CONVERTED', 'IGNORE')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, external_status)
);

alter table public.crocodial_department_links add column if not exists lead_import text not null default 'OFF';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crocodial_department_links_lead_import_check') then
    alter table public.crocodial_department_links add constraint crocodial_department_links_lead_import_check check (lead_import in ('OFF', 'PREVIEW', 'IMPORT'));
  end if;
end $$;

create table if not exists public.crocodial_crm_lead_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crocodial_connections (id) on delete cascade,
  external_lead_id bigint not null,
  customer_id uuid references public.customers (id) on delete set null,
  status text not null check (status in ('LINKED', 'PENDING_CREATE', 'PENDING_LINK', 'UNMAPPED_ASSIGNEE', 'OUT_OF_SCOPE', 'NOT_ENABLED',
                                         'AMBIGUOUS', 'OWNER_CONFLICT', 'PROTECTED', 'IGNORED', 'FAILED')),
  import_source text check (import_source is null or import_source in ('CREATED', 'MATCHED', 'MANUAL')),
  assignment_mode text not null default 'EXTERNAL' check (assignment_mode in ('EXTERNAL', 'CRM_OVERRIDE')),
  department_id uuid references public.departments (id) on delete set null,
  external_owner_ext bigint,
  external_owner_profile uuid references public.profiles (id) on delete set null,
  applied_owner_id uuid references public.profiles (id) on delete set null,
  external_status text,
  disposition text,
  candidate_ids uuid[] not null default '{}',
  reason text check (reason is null or length(reason) <= 300),
  last_external_update timestamptz,
  last_reconciled_at timestamptz,
  last_applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_lead_id)
);
create index if not exists crocodial_crm_lead_links_customer on public.crocodial_crm_lead_links (customer_id) where customer_id is not null;
create index if not exists crocodial_crm_lead_links_status on public.crocodial_crm_lead_links (connection_id, status, updated_at desc);
create index if not exists crocodial_crm_lead_links_dept on public.crocodial_crm_lead_links (department_id, status);

create table if not exists public.crocodial_reconcile_state (
  connection_id uuid primary key references public.crocodial_connections (id) on delete cascade,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  processed_last_run integer not null default 0,
  created_last_run integer not null default 0,
  updated_last_run integer not null default 0,
  duration_ms_last_run integer,
  pending integer not null default 0
);

do $$
declare
  t text;
begin
  foreach t in array array['crocodial_lead_owner_history', 'crocodial_status_mappings', 'crocodial_crm_lead_links', 'crocodial_reconcile_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- matching evidence: the last 10 digits of a phone number, a lower-cased e-mail (indexed per department)
create or replace function private.croc_phone_key(v text)
returns text language sql immutable set search_path = '' as $$
  select nullif(right(regexp_replace(coalesce(v, ''), '[^0-9]', '', 'g'), 10), '')
$$;
create index if not exists customers_dept_phone_key on public.customers (department_id, (private.croc_phone_key(phone)));
create index if not exists customers_dept_email_key on public.customers (department_id, (lower(email))) where email is not null;

-- lead automations (welcome WhatsApp) are skipped inside a transaction that set app.suppress_lead_automations
create or replace function private.lead_wa_after_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.suppress_lead_automations', true), '') = 'on' then
    return null;
  end if;
  if new.lifecycle_stage::text = 'LEAD' and new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    begin
      perform private.lead_wa_enqueue(new.id, new.owner_id);
    exception when others then
      raise warning 'lead welcome WhatsApp not queued for %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

-- the CRM lead_status a disposition sets (null: none; the lifecycle is never changed)
create or replace function private.croc_disposition_status(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'NEW' then 'NEW' when 'CONTACTED' then 'CONTACTED' when 'FOLLOW_UP' then 'CONTACTED' when 'INTERESTED' then 'INTERESTED'
                when 'DEMO_SCHEDULED' then 'INTERESTED' when 'NOT_INTERESTED' then 'CONTACTED' when 'LOST' then 'CONTACTED' when 'CONVERTED' then 'READY_TO_BUY' end
$$;

-- ---------------------------------------------------------------------------
-- 3. Storing a page of leads (as before, with the new fields)
-- ---------------------------------------------------------------------------
create or replace function public.croc_sync_store(p_connection uuid, p_resource text, p_rows jsonb, p_next_page integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  v_now timestamptz := now();
  v_full boolean;
  v_keys text[];
begin
  select coalesce(run_full, false) into v_full from public.crocodial_sync_state where connection_id = p_connection and resource = p_resource;
  if not exists (select 1 from public.crocodial_sync_state where connection_id = p_connection and resource = p_resource and running_since is not null) then
    raise exception 'CONFLICT: This sync does not hold the lease.' using errcode = 'P0001';
  end if;
  if p_resource = 'leads' then
    select custom_field_keys into v_keys from public.crocodial_connections where id = p_connection;
    insert into public.crocodial_ext_leads as t (connection_id, external_id, name, phone_number, company, city, status, source, assigned_to_ext, created_by_ext,
      called, dialer_outcome, remark_count, next_followup_at, last_interaction_at, external_created_at, external_updated_at, last_seen_at, missing_since,
      email, interest, budget, deal_value, products, import_batch_ext, call_due_at, expected_close_at, ai_call_status, custom_fields)
    select p_connection, private.croc_big(x ->> 'id'), left(x ->> 'name', 200), left(x ->> 'phone', 40), left(x ->> 'company', 200), left(x ->> 'city', 120),
           left(x ->> 'status', 80), left(x ->> 'source', 80), private.croc_big(x ->> 'assignedTo'), private.croc_big(x ->> 'createdBy'),
           (x ->> 'called')::boolean, left(x ->> 'dialerOutcome', 40), (x ->> 'remarkCount')::integer, private.croc_ts(x ->> 'nextFollowupAt'),
           private.croc_ts(x ->> 'lastInteractionAt'), private.croc_ts(x ->> 'createdAt'), private.croc_ts(x ->> 'updatedAt'), v_now, null,
           case when lower(btrim(x ->> 'email')) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then left(lower(btrim(x ->> 'email')), 254) end,
           left(x ->> 'interest', 200), private.croc_money(x ->> 'budget'), private.croc_money(x ->> 'dealValue'), left(x ->> 'products', 500),
           left(x ->> 'importBatch', 80), private.croc_ts(x ->> 'callDueAt'), private.croc_ts(x ->> 'expectedCloseAt'), left(x ->> 'aiCallStatus', 60),
           (select nullif(jsonb_object_agg(k, left(x -> 'customFields' ->> k, 200)), '{}'::jsonb)
              from unnest(coalesce(v_keys, '{}')) k where jsonb_typeof(x -> 'customFields') = 'object' and (x -> 'customFields') ? k)
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set name = excluded.name, phone_number = excluded.phone_number, company = excluded.company,
      city = excluded.city, status = excluded.status, source = excluded.source, assigned_to_ext = excluded.assigned_to_ext, created_by_ext = excluded.created_by_ext,
      called = excluded.called, dialer_outcome = excluded.dialer_outcome, remark_count = excluded.remark_count, next_followup_at = excluded.next_followup_at,
      last_interaction_at = excluded.last_interaction_at, external_created_at = excluded.external_created_at, external_updated_at = excluded.external_updated_at,
      email = excluded.email, interest = excluded.interest, budget = excluded.budget, deal_value = excluded.deal_value, products = excluded.products,
      import_batch_ext = excluded.import_batch_ext, call_due_at = excluded.call_due_at, expected_close_at = excluded.expected_close_at,
      ai_call_status = excluded.ai_call_status, custom_fields = excluded.custom_fields,
      last_seen_at = v_now, missing_since = null
      -- an older copy of a lead never replaces a newer one
      where (t.external_updated_at is null or excluded.external_updated_at is null or excluded.external_updated_at >= t.external_updated_at)
        and (v_full or t.missing_since is not null
         or (t.name, t.phone_number, t.company, t.city, t.status, t.source, t.assigned_to_ext, t.created_by_ext, t.called, t.dialer_outcome, t.remark_count,
             t.next_followup_at, t.last_interaction_at, t.external_created_at, t.external_updated_at, t.email, t.interest, t.budget, t.deal_value, t.products,
             t.import_batch_ext, t.call_due_at, t.expected_close_at, t.ai_call_status, t.custom_fields)
            is distinct from (excluded.name, excluded.phone_number, excluded.company, excluded.city, excluded.status, excluded.source, excluded.assigned_to_ext,
             excluded.created_by_ext, excluded.called, excluded.dialer_outcome, excluded.remark_count, excluded.next_followup_at, excluded.last_interaction_at,
             excluded.external_created_at, excluded.external_updated_at, excluded.email, excluded.interest, excluded.budget, excluded.deal_value, excluded.products,
             excluded.import_batch_ext, excluded.call_due_at, excluded.expected_close_at, excluded.ai_call_status, excluded.custom_fields));
  elsif p_resource = 'call-logs' then
    insert into public.crocodial_ext_calls as t (connection_id, external_id, called_by_ext, lead_ext, phone_number, contact_name, call_type, call_at,
      duration_seconds, connected, external_synced_at, last_seen_at, missing_since)
    select p_connection, private.croc_big(x ->> 'id'), private.croc_big(x ->> 'calledBy'), private.croc_big(x ->> 'lead'), left(x ->> 'phone', 40),
           left(x ->> 'contactName', 200),
           case when x ->> 'callType' in ('incoming', 'outgoing', 'missed', 'voicemail', 'rejected', 'blocked', 'answered_elsewhere') then x ->> 'callType' else 'unknown' end,
           private.croc_ts(x ->> 'callAt'), greatest(0, coalesce((x ->> 'durationSeconds')::integer, 0)), (x ->> 'connected')::boolean,
           private.croc_ts(x ->> 'syncedAt'), v_now, null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set called_by_ext = excluded.called_by_ext, lead_ext = excluded.lead_ext, phone_number = excluded.phone_number,
      contact_name = excluded.contact_name, call_type = excluded.call_type, call_at = excluded.call_at, duration_seconds = excluded.duration_seconds,
      connected = excluded.connected, external_synced_at = excluded.external_synced_at, last_seen_at = v_now, missing_since = null
      where v_full or t.missing_since is not null
         or (t.called_by_ext, t.lead_ext, t.phone_number, t.contact_name, t.call_type, t.call_at, t.duration_seconds, t.connected, t.external_synced_at)
            is distinct from (excluded.called_by_ext, excluded.lead_ext, excluded.phone_number, excluded.contact_name, excluded.call_type, excluded.call_at,
             excluded.duration_seconds, excluded.connected, excluded.external_synced_at);
  elsif p_resource = 'followups' then
    insert into public.crocodial_ext_followups as t (connection_id, external_id, created_by_ext, lead_ext, phone_number, note, scheduled_at, done, completed_at,
      external_created_at, external_updated_at, last_seen_at, missing_since)
    select p_connection, private.croc_big(x ->> 'id'), private.croc_big(x ->> 'createdBy'), private.croc_big(x ->> 'lead'), left(x ->> 'phone', 40),
           left(x ->> 'note', 2000), private.croc_ts(x ->> 'scheduledAt'), (x ->> 'done')::boolean, private.croc_ts(x ->> 'completedAt'),
           private.croc_ts(x ->> 'createdAt'), private.croc_ts(x ->> 'updatedAt'), v_now, null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set created_by_ext = excluded.created_by_ext, lead_ext = excluded.lead_ext, phone_number = excluded.phone_number,
      note = excluded.note, scheduled_at = excluded.scheduled_at, done = excluded.done, completed_at = excluded.completed_at,
      external_created_at = excluded.external_created_at, external_updated_at = excluded.external_updated_at, last_seen_at = v_now, missing_since = null
      where v_full or t.missing_since is not null
         or (t.created_by_ext, t.lead_ext, t.phone_number, t.note, t.scheduled_at, t.done, t.completed_at, t.external_created_at, t.external_updated_at)
            is distinct from (excluded.created_by_ext, excluded.lead_ext, excluded.phone_number, excluded.note, excluded.scheduled_at, excluded.done,
             excluded.completed_at, excluded.external_created_at, excluded.external_updated_at);
  elsif p_resource = 'remarks' then
    insert into public.crocodial_ext_remarks as t (connection_id, external_id, written_by_ext, lead_ext, phone_number, remark, external_created_at, external_updated_at,
      last_seen_at, missing_since)
    select p_connection, private.croc_big(x ->> 'id'), private.croc_big(x ->> 'writtenBy'), private.croc_big(x ->> 'lead'), left(x ->> 'phone', 40),
           left(x ->> 'remark', 2000), private.croc_ts(x ->> 'createdAt'), private.croc_ts(x ->> 'updatedAt'), v_now, null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where private.croc_big(x ->> 'id') is not null
    on conflict (connection_id, external_id) do update set written_by_ext = excluded.written_by_ext, lead_ext = excluded.lead_ext, phone_number = excluded.phone_number,
      remark = excluded.remark, external_created_at = excluded.external_created_at, external_updated_at = excluded.external_updated_at, last_seen_at = v_now, missing_since = null
      where v_full or t.missing_since is not null
         or (t.written_by_ext, t.lead_ext, t.phone_number, t.remark, t.external_created_at, t.external_updated_at)
            is distinct from (excluded.written_by_ext, excluded.lead_ext, excluded.phone_number, excluded.remark, excluded.external_created_at, excluded.external_updated_at);
  else
    raise exception 'VALIDATION_ERROR: Unknown resource.' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  update public.crocodial_sync_state set next_page = p_next_page, rows_in_run = rows_in_run + v_n, running_since = now()
   where connection_id = p_connection and resource = p_resource;
  return v_n;
end $$;
revoke all on function public.croc_sync_store(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.croc_sync_store(uuid, text, jsonb, integer) to service_role;

create or replace function private.croc_money(v text)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return least(greatest(round(regexp_replace(v, '[^0-9.\-]', '', 'g')::numeric, 2), -999999999999), 999999999999);
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Reconciliation (the server runs it after each leads sync, in batches; it resumes where it stopped)
-- ---------------------------------------------------------------------------
-- one external lead: what would happen / happens (p_apply). Returns 'CREATED', 'UPDATED', 'UNCHANGED' or the hold status.
create or replace function private.croc_reconcile_one(p_connection uuid, p_ext bigint, p_apply boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  e public.crocodial_ext_leads;
  lk public.crocodial_crm_lead_links;
  m public.crocodial_employee_mappings;
  o public.profiles;
  c public.customers;
  v_mode text;
  v_disp text;
  v_status text;
  v_cands uuid[];
  v_n integer;
  v_result text := 'UNCHANGED';
  v_new uuid;
  v_local_newer boolean;
begin
  select * into e from public.crocodial_ext_leads where connection_id = p_connection and external_id = p_ext;
  if e.external_id is null then return 'UNCHANGED'; end if;
  select * into lk from public.crocodial_crm_lead_links where connection_id = p_connection and external_lead_id = p_ext for update;
  v_disp := (select s.disposition from public.crocodial_status_mappings s where s.connection_id = p_connection and s.external_status = lower(btrim(e.status)));

  -- the CRM person Crocodial assigned it to: an approved mapping in effect now, never a name
  if e.assigned_to_ext is not null then
    select * into m from public.crocodial_employee_mappings x
     where x.connection_id = p_connection and x.external_employee_id = e.assigned_to_ext and x.status = 'APPROVED'
       and x.effective_from is not null and x.effective_from <= now() and x.ended_at is null
     order by x.effective_from desc limit 1;
  end if;
  if m.profile_id is not null then
    select * into o from public.profiles where id = m.profile_id;
    select l.lead_import into v_mode from public.crocodial_department_links l
      join public.crocodial_rollout r on r.department_id = l.department_id and r.division = l.division and r.allowed
     where l.connection_id = p_connection and l.department_id = m.department_id and l.division = m.division and l.enabled;
  end if;

  if lk.id is null then
    insert into public.crocodial_crm_lead_links (connection_id, external_lead_id, status) values (p_connection, p_ext, 'NOT_ENABLED') returning * into lk;
  end if;

  -- holds that need nobody's data changed
  if m.profile_id is null then
    v_status := 'UNMAPPED_ASSIGNEE';
  elsif coalesce(v_mode, 'OFF') = 'OFF' then
    v_status := 'NOT_ENABLED';
  elsif o.id is null or o.status <> 'ACTIVE' or o.department_id is distinct from m.department_id
        or not (o.role = 'DEPARTMENT_HEAD' or exists (select 1 from public.teams t where t.id = o.team_id and t.division::text = m.division)) then
    v_status := 'OUT_OF_SCOPE';
  end if;
  if v_status is not null and lk.customer_id is null then
    update public.crocodial_crm_lead_links set status = v_status, department_id = m.department_id, external_owner_ext = e.assigned_to_ext,
           external_owner_profile = m.profile_id, external_status = e.status, disposition = v_disp, last_external_update = e.external_updated_at,
           last_reconciled_at = now(), updated_at = now(),
           reason = case v_status when 'UNMAPPED_ASSIGNEE' then 'The Crocodial user it is assigned to has no approved mapping.'
                                  when 'OUT_OF_SCOPE' then 'The mapped person is inactive or not in this department''s Sales function.'
                                  else 'Lead import is off for this department.' end
     where id = lk.id;
    return v_status;
  end if;

  -- ---- an existing link: update it (a protected or overridden lead keeps its CRM data)
  if lk.customer_id is not null then
    select * into c from public.customers where id = lk.customer_id for update;
    if c.id is null then
      update public.crocodial_crm_lead_links set status = 'FAILED', customer_id = null, reason = 'The linked CRM record no longer exists.', updated_at = now() where id = lk.id;
      return 'FAILED';
    end if;
    if c.lifecycle_stage::text <> 'LEAD' then
      update public.crocodial_crm_lead_links set status = 'PROTECTED', external_owner_ext = e.assigned_to_ext, external_owner_profile = m.profile_id,
             external_status = e.status, disposition = v_disp, last_external_update = e.external_updated_at, last_reconciled_at = now(), updated_at = now(),
             reason = 'The CRM record is past the lead stage: Crocodial changes are not applied.'
       where id = lk.id;
      return 'UNCHANGED';
    end if;
    if not p_apply or v_status is not null then
      update public.crocodial_crm_lead_links set external_owner_ext = e.assigned_to_ext, external_owner_profile = m.profile_id, external_status = e.status,
             disposition = v_disp, last_external_update = e.external_updated_at, last_reconciled_at = now(), updated_at = now()
       where id = lk.id;
      return 'UNCHANGED';
    end if;
    -- a CRM user changed the owner since the last sync: the CRM keeps it from now on
    if lk.assignment_mode = 'EXTERNAL' and lk.applied_owner_id is not null and c.owner_id is distinct from lk.applied_owner_id then
      lk.assignment_mode := 'CRM_OVERRIDE';
    end if;
    v_local_newer := c.updated_at > coalesce(lk.last_applied_at, '-infinity'::timestamptz) + interval '2 seconds'
                     and (e.external_updated_at is null or c.updated_at > e.external_updated_at);
    perform set_config('app.suppress_lead_automations', 'on', true);
    if lk.assignment_mode = 'EXTERNAL' and c.owner_id is distinct from m.profile_id then
      update public.customers set owner_id = m.profile_id where id = c.id;
      insert into public.customer_activities (customer_id, actor_id, type, note)
      values (c.id, null, 'CROCODIAL_OWNER_CHANGED', 'Assigned in Crocodial to ' || o.full_name || ' (seen by the CRM sync; Crocodial does not say who assigned it)');
      v_result := 'UPDATED';
    end if;
    if not v_local_newer then
      update public.customers
         set lead_status = coalesce(private.croc_disposition_status(v_disp), lead_status),
             next_follow_up_at = coalesce(e.next_followup_at, next_follow_up_at)
       where id = c.id
         and (lead_status is distinct from coalesce(private.croc_disposition_status(v_disp), lead_status)
              or (e.next_followup_at is not null and next_follow_up_at is distinct from e.next_followup_at));
      get diagnostics v_n = row_count;
      if v_n > 0 then v_result := 'UPDATED'; end if;
    end if;
    perform set_config('app.suppress_lead_automations', '', true);
    update public.crocodial_crm_lead_links set status = 'LINKED', assignment_mode = lk.assignment_mode, department_id = m.department_id,
           external_owner_ext = e.assigned_to_ext, external_owner_profile = m.profile_id,
           applied_owner_id = case when lk.assignment_mode = 'EXTERNAL' then m.profile_id else lk.applied_owner_id end,
           external_status = e.status, disposition = v_disp, last_external_update = e.external_updated_at, last_reconciled_at = now(),
           last_applied_at = case when v_result = 'UPDATED' then clock_timestamp() else lk.last_applied_at end,
           reason = case when lk.assignment_mode = 'CRM_OVERRIDE' and c.owner_id is distinct from m.profile_id then 'Owner changed in the CRM; Crocodial assigns it to ' || o.full_name || '.'
                         when v_disp is null and e.status is not null then 'Unknown Crocodial status "' || left(e.status, 80) || '": no CRM status was changed.'
                         when v_local_newer then 'Edited in the CRM after the last Crocodial change: the CRM edit was kept.' end,
           updated_at = now()
     where id = lk.id;
    return v_result;
  end if;

  -- ---- no CRM record yet: find candidates in the same department (phone / e-mail are evidence, not identity)
  select coalesce(array_agg(x.id order by x.created_at), '{}') into v_cands
    from (select distinct cu.id, cu.created_at from public.customers cu
           where cu.department_id = m.department_id
             and ((private.croc_phone_key(e.phone_number) is not null and private.croc_phone_key(cu.phone) = private.croc_phone_key(e.phone_number))
                  or (e.email is not null and lower(cu.email) = e.email))
           limit 5) x;
  if cardinality(v_cands) > 1 then
    v_status := 'AMBIGUOUS';
  elsif cardinality(v_cands) = 1 then
    select * into c from public.customers where id = v_cands[1] for update;
    if exists (select 1 from public.crocodial_crm_lead_links x where x.customer_id = c.id and x.connection_id = p_connection and x.id <> lk.id) then
      v_status := 'AMBIGUOUS';
    elsif c.lifecycle_stage::text <> 'LEAD' then
      v_status := 'PROTECTED';
    elsif c.owner_id is distinct from m.profile_id then
      v_status := 'OWNER_CONFLICT';
    else
      v_status := case when p_apply then 'LINKED' else 'PENDING_LINK' end;
    end if;
  else
    v_status := case when p_apply then 'LINKED' else 'PENDING_CREATE' end;
  end if;

  if p_apply and v_status = 'LINKED' and cardinality(v_cands) = 0 then
    perform set_config('app.suppress_lead_automations', 'on', true);
    insert into public.customers (owner_id, lifecycle_stage, lead_status, name, company, phone, email, lead_source, call_status, next_follow_up_at)
    values (m.profile_id, 'LEAD', coalesce(private.croc_disposition_status(v_disp), 'NEW'),
            left(coalesce(nullif(btrim(e.name), ''), nullif(btrim(e.company), ''), e.phone_number, 'Crocodial lead ' || e.external_id), 200),
            e.company, e.phone_number, e.email, 'Crocodial', 'PENDING', e.next_followup_at)
    returning id into v_new;
    insert into public.customer_activities (customer_id, actor_id, type, note)
    values (v_new, null, 'CROCODIAL_IMPORTED', 'Imported from Crocodial (lead ' || e.external_id || '), assigned there to ' || o.full_name || '. No welcome message was sent.');
    perform set_config('app.suppress_lead_automations', '', true);
    v_result := 'CREATED';
  end if;
  update public.crocodial_crm_lead_links
     set status = v_status,
         customer_id = case when v_new is not null then v_new when v_status in ('LINKED', 'PROTECTED') and p_apply then v_cands[1] end,
         import_source = case when v_new is not null then 'CREATED' when v_status in ('LINKED', 'PROTECTED') and p_apply then 'MATCHED' end,
         candidate_ids = v_cands, department_id = m.department_id, external_owner_ext = e.assigned_to_ext, external_owner_profile = m.profile_id,
         applied_owner_id = case when v_status = 'LINKED' and p_apply then m.profile_id end,
         external_status = e.status, disposition = v_disp, last_external_update = e.external_updated_at, last_reconciled_at = now(),
         last_applied_at = case when v_new is not null then clock_timestamp() end,
         reason = case v_status
           when 'AMBIGUOUS' then 'Several CRM records of this department have the same phone number or e-mail.'
           when 'PROTECTED' then 'An existing CRM record past the lead stage has the same phone or e-mail: linked for reference, never changed.'
           when 'OWNER_CONFLICT' then 'An existing lead with the same phone or e-mail belongs to another CRM owner.'
           when 'PENDING_CREATE' then 'Preview: a new lead would be created for ' || o.full_name || '.'
           when 'PENDING_LINK' then 'Preview: it would be linked to the existing lead with the same phone or e-mail.'
           else null end,
         updated_at = now()
   where id = lk.id;
  if v_result = 'UNCHANGED' and v_status = 'LINKED' and p_apply then v_result := 'UPDATED'; end if;
  return case when v_status in ('LINKED', 'PENDING_CREATE', 'PENDING_LINK') then v_result else v_status end;
end $$;
revoke all on function private.croc_reconcile_one(uuid, bigint, boolean) from public, anon, authenticated;

-- One batch for one connection (service role: the sync after the leads read; the Super Admin's "Reconcile now" through the server).
-- Picks the leads whose Crocodial copy changed since their link was last reconciled, new leads, failed ones and previews whose department
-- is now on IMPORT. Serialised per connection. Returns what it did and how many are still waiting.
create or replace function public.croc_reconcile(p_connection uuid, p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz := clock_timestamp();
  x record;
  v_res text;
  v_proc integer := 0; v_created integer := 0; v_updated integer := 0; v_held integer := 0; v_failed integer := 0;
  v_pending integer;
  v_any boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('croc_reconcile:' || p_connection::text)) then
    return jsonb_build_object('skipped', 'another reconciliation of this connection is running');
  end if;
  -- nothing to do while every department of the connection has lead import off
  select exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection and l.enabled and l.lead_import <> 'OFF') into v_any;
  if not v_any then
    return jsonb_build_object('processed', 0, 'pending', 0, 'enabled', false);
  end if;
  for x in
    select e.external_id, (exists (select 1 from public.crocodial_employee_mappings m
                                     join public.crocodial_department_links l on l.connection_id = m.connection_id and l.department_id = m.department_id and l.division = m.division
                                    where m.connection_id = e.connection_id and m.external_employee_id = e.assigned_to_ext and m.status = 'APPROVED' and m.ended_at is null
                                      and l.lead_import = 'IMPORT')) as apply
      from public.crocodial_ext_leads e
      left join public.crocodial_crm_lead_links k on k.connection_id = e.connection_id and k.external_lead_id = e.external_id
     where e.connection_id = p_connection
       and coalesce(k.status, '') <> 'IGNORED'
       and (k.id is null
            or k.last_external_update is distinct from e.external_updated_at
            or (k.status = 'FAILED' and k.updated_at < now() - interval '15 minutes')
            or (k.status in ('PENDING_CREATE', 'PENDING_LINK', 'NOT_ENABLED', 'UNMAPPED_ASSIGNEE', 'OUT_OF_SCOPE') and k.last_reconciled_at < now() - interval '30 minutes'))
     order by e.external_updated_at nulls first, e.external_id
     limit greatest(1, least(coalesce(p_limit, 200), 500))
  loop
    begin
      v_res := private.croc_reconcile_one(p_connection, x.external_id, x.apply);
    exception when others then
      v_res := 'FAILED';
      insert into public.crocodial_crm_lead_links (connection_id, external_lead_id, status, reason, updated_at, last_reconciled_at)
      values (p_connection, x.external_id, 'FAILED', left(sqlerrm, 300), now(), now())
      on conflict (connection_id, external_lead_id) do update set status = 'FAILED', reason = left(excluded.reason, 300), updated_at = now(), last_reconciled_at = now();
    end;
    v_proc := v_proc + 1;
    case v_res when 'CREATED' then v_created := v_created + 1; when 'UPDATED' then v_updated := v_updated + 1; when 'FAILED' then v_failed := v_failed + 1;
      when 'UNCHANGED' then null; else v_held := v_held + 1; end case;
  end loop;
  select count(*) into v_pending
    from public.crocodial_ext_leads e
    left join public.crocodial_crm_lead_links k on k.connection_id = e.connection_id and k.external_lead_id = e.external_id
   where e.connection_id = p_connection and coalesce(k.status, '') <> 'IGNORED' and (k.id is null or k.last_external_update is distinct from e.external_updated_at);
  insert into public.crocodial_reconcile_state as s (connection_id, last_run_at, last_ok_at, last_error, processed_last_run, created_last_run, updated_last_run, duration_ms_last_run, pending)
  values (p_connection, now(), case when v_failed = 0 then now() end, case when v_failed > 0 then v_failed || ' lead(s) failed' end, v_proc, v_created, v_updated,
          (extract(epoch from clock_timestamp() - v_started) * 1000)::integer, v_pending)
  on conflict (connection_id) do update set last_run_at = excluded.last_run_at, last_ok_at = coalesce(excluded.last_ok_at, s.last_ok_at), last_error = excluded.last_error,
    processed_last_run = excluded.processed_last_run, created_last_run = excluded.created_last_run, updated_last_run = excluded.updated_last_run,
    duration_ms_last_run = excluded.duration_ms_last_run, pending = excluded.pending;
  return jsonb_build_object('processed', v_proc, 'created', v_created, 'updated', v_updated, 'held', v_held, 'failed', v_failed, 'pending', v_pending, 'enabled', true);
end $$;
revoke all on function public.croc_reconcile(uuid, integer) from public, anon, authenticated;
grant execute on function public.croc_reconcile(uuid, integer) to service_role;

-- A refresh says "up to date" only once the CRM lead links are reconciled too (where lead import is on): otherwise "partially synced".
create or replace function private.croc_refresh_connection_state(p_connection uuid, p_at timestamptz)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.crocodial_connections;
  f record;
  v_done boolean;
  v_failed boolean;
  v_touched boolean;
begin
  select * into c from public.crocodial_connections where id = p_connection;
  if c.id is null or not c.enabled then
    return 'DATA_UNAVAILABLE';
  end if;
  select * into f from private.croc_connection_freshness(p_connection);
  if c.last_attempt_at >= p_at and c.health = 'NO_CREDENTIAL' then return 'TOKEN_MISSING'; end if;
  if c.last_attempt_at >= p_at and c.health in ('AUTH_FAILED', 'DISABLED_AT_SOURCE') then return 'TOKEN_INVALID'; end if;
  if c.last_attempt_at >= p_at and c.health = 'RATE_LIMITED' then return 'RATE_LIMITED'; end if;
  if f.o_running then return 'SYNCING'; end if;
  select count(*) >= 4 and bool_and(s.last_ok_at >= p_at),
         bool_or(s.last_run_at >= p_at and s.last_error is not null),
         bool_or(s.last_run_at >= p_at)
    into v_done, v_failed, v_touched
    from public.crocodial_sync_state s where s.connection_id = p_connection;
  if coalesce(v_done, false) and not f.o_in_progress then
    if exists (select 1 from public.crocodial_department_links l where l.connection_id = p_connection and l.enabled and l.lead_import = 'IMPORT')
       and not exists (select 1 from public.crocodial_reconcile_state r where r.connection_id = p_connection and r.pending = 0 and r.last_run_at >= p_at) then
      return 'PARTIALLY_SYNCED';
    end if;
    return 'UP_TO_DATE';
  end if;
  if coalesce(v_failed, false) then return 'SYNC_FAILED'; end if;
  if coalesce(v_touched, false) and f.o_in_progress then return 'PARTIALLY_SYNCED'; end if;
  return 'REFRESH_QUEUED';
end $$;

-- ---------------------------------------------------------------------------
-- 5. The Super Admin: import switch, status mapping, monitor, resolution
-- ---------------------------------------------------------------------------
create or replace function public.croc_lead_import_set(p_connection uuid, p_department uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  perform private.require_super_admin();
  if p_mode not in ('OFF', 'PREVIEW', 'IMPORT') then raise exception 'VALIDATION_ERROR: Choose Off, Preview or Import.' using errcode = 'P0001'; end if;
  select lead_import into v_old from public.crocodial_department_links where connection_id = p_connection and department_id = p_department and division = 'SALES' for update;
  if not found then raise exception 'NOT_FOUND: This department is not linked to the connection.' using errcode = 'P0001'; end if;
  update public.crocodial_department_links set lead_import = p_mode where connection_id = p_connection and department_id = p_department and division = 'SALES';
  -- that department's leads are looked at again on the next run (a preview becomes an import, an import stops)
  update public.crocodial_crm_lead_links set last_external_update = null where connection_id = p_connection and (department_id = p_department or department_id is null);
  perform private.write_audit('CROCODIAL_LEAD_IMPORT_SET', 'crocodial_connection', p_connection, p_department, null, jsonb_build_object('from', v_old, 'to', p_mode));
  return jsonb_build_object('departmentId', p_department, 'mode', p_mode);
end $$;
revoke all on function public.croc_lead_import_set(uuid, uuid, text) from public, anon;
grant execute on function public.croc_lead_import_set(uuid, uuid, text) to authenticated;

create or replace function public.croc_status_mapping_set(p_connection uuid, p_status text, p_disposition text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text := lower(btrim(coalesce(p_status, '')));
begin
  perform private.require_super_admin();
  if length(v_key) not between 1 and 80 then raise exception 'VALIDATION_ERROR: Enter the Crocodial status.' using errcode = 'P0001'; end if;
  if p_disposition is null then
    delete from public.crocodial_status_mappings where connection_id = p_connection and external_status = v_key;
  else
    if p_disposition not in ('NEW', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'DEMO_SCHEDULED', 'NOT_INTERESTED', 'LOST', 'CONVERTED', 'IGNORE') then
      raise exception 'VALIDATION_ERROR: Unknown CRM disposition.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.crocodial_connections where id = p_connection) then raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0001'; end if;
    insert into public.crocodial_status_mappings (connection_id, external_status, disposition, updated_by) values (p_connection, v_key, p_disposition, private.my_id())
    on conflict (connection_id, external_status) do update set disposition = excluded.disposition, updated_by = excluded.updated_by, updated_at = now();
  end if;
  -- the leads with this status are looked at again on the next run
  update public.crocodial_crm_lead_links k set last_external_update = null
    from public.crocodial_ext_leads e
   where k.connection_id = p_connection and e.connection_id = k.connection_id and e.external_id = k.external_lead_id and lower(btrim(e.status)) = v_key;
  perform private.write_audit('CROCODIAL_STATUS_MAPPING_SET', 'crocodial_connection', p_connection, null, null, jsonb_build_object('status', v_key, 'disposition', p_disposition));
  return jsonb_build_object('status', v_key, 'disposition', p_disposition);
end $$;
revoke all on function public.croc_status_mapping_set(uuid, text, text) from public, anon;
grant execute on function public.croc_status_mapping_set(uuid, text, text) to authenticated;

create or replace function public.croc_reconcile_overview(p_connection uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return jsonb_build_object(
    'departments', coalesce((select jsonb_agg(jsonb_build_object('departmentId', l.department_id, 'name', d.name, 'enabled', l.enabled, 'leadImport', l.lead_import) order by d.name)
                               from public.crocodial_department_links l join public.departments d on d.id = l.department_id
                              where l.connection_id = p_connection and l.division = 'SALES'), '[]'::jsonb),
    'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.crocodial_crm_lead_links where connection_id = p_connection group by status) q), '{}'::jsonb),
    'ownershipDiffers', (select count(*) from public.crocodial_crm_lead_links k join public.customers c on c.id = k.customer_id
                          where k.connection_id = p_connection and k.assignment_mode = 'CRM_OVERRIDE' and c.owner_id is distinct from k.external_owner_profile),
    'externalLeads', (select count(*) from public.crocodial_ext_leads where connection_id = p_connection),
    'missingAtSource', (select count(*) from public.crocodial_ext_leads where connection_id = p_connection and missing_since is not null),
    'unknownStatuses', coalesce((select jsonb_agg(jsonb_build_object('status', s, 'leads', n) order by n desc) from (
         select lower(btrim(e.status)) s, count(*) n from public.crocodial_ext_leads e
          where e.connection_id = p_connection and e.status is not null and btrim(e.status) <> ''
            and not exists (select 1 from public.crocodial_status_mappings m where m.connection_id = e.connection_id and m.external_status = lower(btrim(e.status)))
          group by 1 order by 2 desc limit 50) q), '[]'::jsonb),
    'mappings', coalesce((select jsonb_agg(jsonb_build_object('status', external_status, 'disposition', disposition) order by external_status)
                            from public.crocodial_status_mappings where connection_id = p_connection), '[]'::jsonb),
    'unmappedAssignees', coalesce((select jsonb_agg(jsonb_build_object('externalId', q.ext, 'name', (select x.name from public.crocodial_ext_employees x where x.connection_id = p_connection and x.external_id = q.ext), 'leads', q.n) order by q.n desc) from (
         select e.assigned_to_ext ext, count(*) n from public.crocodial_ext_leads e
          where e.connection_id = p_connection and e.assigned_to_ext is not null
            and not exists (select 1 from public.crocodial_employee_mappings m where m.connection_id = e.connection_id and m.external_employee_id = e.assigned_to_ext and m.status = 'APPROVED' and m.ended_at is null)
          group by 1 order by 2 desc limit 50) q), '[]'::jsonb),
    'reconcile', (select to_jsonb(s) - 'connection_id' from public.crocodial_reconcile_state s where s.connection_id = p_connection),
    'resources', coalesce((select jsonb_agg(jsonb_build_object('resource', s.resource, 'lastOkAt', s.last_ok_at, 'lastRunAt', s.last_run_at, 'lastError', s.last_error,
                                                            'rowsLastRun', s.rows_last_run, 'inProgress', s.next_page is not null) order by s.resource)
                             from public.crocodial_sync_state s where s.connection_id = p_connection), '[]'::jsonb),
    'recentRuns', coalesce((select jsonb_agg(jsonb_build_object('resource', r.resource, 'outcome', r.outcome, 'rows', r.rows_stored, 'pages', r.pages, 'finishedAt', r.finished_at,
                                                             'seconds', round(extract(epoch from r.finished_at - r.started_at)::numeric, 1), 'error', r.error,
                                                             'rateLimited', coalesce(r.error ilike '%429%' or r.error ilike '%rate%', false)) order by r.finished_at desc)
                              from (select * from public.crocodial_sync_runs where connection_id = p_connection order by finished_at desc limit 20) r), '[]'::jsonb));
end $$;
revoke all on function public.croc_reconcile_overview(uuid) from public, anon;
grant execute on function public.croc_reconcile_overview(uuid) to authenticated;

create or replace function public.croc_lead_links_list(p_connection uuid, p_status text default null, p_page integer default 1, p_page_size integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  perform private.require_super_admin();
  return jsonb_build_object(
    'total', (select count(*) from public.crocodial_crm_lead_links k where k.connection_id = p_connection and (p_status is null or k.status = p_status)),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'externalLeadId', k.external_lead_id, 'status', k.status, 'reason', k.reason, 'assignmentMode', k.assignment_mode, 'importSource', k.import_source,
        'name', e.name, 'company', e.company, 'phone', e.phone_number, 'externalStatus', k.external_status, 'disposition', k.disposition,
        'externalOwner', (select x.name from public.crocodial_ext_employees x where x.connection_id = k.connection_id and x.external_id = k.external_owner_ext),
        'mappedOwner', (select p.full_name from public.profiles p where p.id = k.external_owner_profile),
        'customerId', k.customer_id, 'crmOwner', (select p.full_name from public.customers c join public.profiles p on p.id = c.owner_id where c.id = k.customer_id),
        'department', (select d.name from public.departments d where d.id = k.department_id),
        'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'lifecycle', c.lifecycle_stage, 'owner', (select p.full_name from public.profiles p where p.id = c.owner_id)))
                                  from public.customers c where c.id = any (k.candidate_ids)), '[]'::jsonb),
        'lastReconciledAt', k.last_reconciled_at, 'externalUpdatedAt', k.last_external_update) order by k.updated_at desc)
      from (select * from public.crocodial_crm_lead_links k where k.connection_id = p_connection and (p_status is null or k.status = p_status)
             order by k.updated_at desc offset (v_page - 1) * v_size limit v_size) k
      left join public.crocodial_ext_leads e on e.connection_id = k.connection_id and e.external_id = k.external_lead_id), '[]'::jsonb));
end $$;
revoke all on function public.croc_lead_links_list(uuid, text, integer, integer) from public, anon;
grant execute on function public.croc_lead_links_list(uuid, text, integer, integer) to authenticated;

-- The Super Admin settles one held lead:
--   LINK (p_customer: a CRM record of the same department) - linked for reference, its owner and stage are not changed;
--   IGNORE - never imported; RETRY - looked at again on the next run; RELEASE_OVERRIDE - Crocodial's assignee applies again.
create or replace function public.croc_lead_link_resolve(p_link uuid, p_action text, p_customer uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k public.crocodial_crm_lead_links;
  c public.customers;
begin
  perform private.require_super_admin();
  select * into k from public.crocodial_crm_lead_links where id = p_link for update;
  if k.id is null then raise exception 'NOT_FOUND: Link not found.' using errcode = 'P0001'; end if;
  if p_action = 'LINK' then
    select * into c from public.customers where id = p_customer;
    if c.id is null or c.department_id is distinct from k.department_id then
      raise exception 'VALIDATION_ERROR: Choose a CRM record of the same department.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.crocodial_crm_lead_links x where x.customer_id = c.id and x.connection_id = k.connection_id and x.id <> k.id) then
      raise exception 'CONFLICT: That CRM record is already linked to another Crocodial lead.' using errcode = 'P0001';
    end if;
    update public.crocodial_crm_lead_links set customer_id = c.id, import_source = 'MANUAL',
           status = case when c.lifecycle_stage::text = 'LEAD' then 'LINKED' else 'PROTECTED' end,
           assignment_mode = case when c.owner_id is distinct from k.external_owner_profile then 'CRM_OVERRIDE' else 'EXTERNAL' end,
           applied_owner_id = c.owner_id, reason = 'Linked by the Super Admin.', updated_at = now(), last_applied_at = now()
     where id = k.id;
  elsif p_action = 'IGNORE' then
    update public.crocodial_crm_lead_links set status = 'IGNORED', reason = 'Ignored by the Super Admin.', updated_at = now() where id = k.id;
  elsif p_action = 'RETRY' then
    update public.crocodial_crm_lead_links set last_external_update = null, status = case when status = 'IGNORED' then 'NOT_ENABLED' else status end, updated_at = now() where id = k.id;
  elsif p_action = 'RELEASE_OVERRIDE' then
    update public.crocodial_crm_lead_links set assignment_mode = 'EXTERNAL', applied_owner_id = (select owner_id from public.customers where id = k.customer_id),
           last_external_update = null, updated_at = now() where id = k.id;
  else
    raise exception 'VALIDATION_ERROR: Unknown action.' using errcode = 'P0001';
  end if;
  perform private.write_audit('CROCODIAL_LEAD_LINK_RESOLVED', 'crocodial_lead_link', k.id, k.department_id, null,
    jsonb_build_object('action', p_action, 'customer', p_customer, 'externalLeadId', k.external_lead_id));
  select * into k from public.crocodial_crm_lead_links where id = p_link;
  return jsonb_build_object('id', k.id, 'status', k.status, 'customerId', k.customer_id, 'assignmentMode', k.assignment_mode);
end $$;
revoke all on function public.croc_lead_link_resolve(uuid, text, uuid) from public, anon;
grant execute on function public.croc_lead_link_resolve(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The lead page: Crocodial activity of one CRM lead (whoever can see the lead; a CEO / head for the departments they cover)
-- ---------------------------------------------------------------------------
create or replace function public.croc_lead_activity(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  k public.crocodial_crm_lead_links;
  e public.crocodial_ext_leads;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or not (private.can_view_customer(c.id)
                          or (private.my_role() = 'DEPARTMENT_HEAD' and private.scope_covers(auth.uid(), c.department_id, 'SALES'))) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into k from public.crocodial_crm_lead_links where customer_id = c.id order by updated_at desc limit 1;
  if k.id is null then return jsonb_build_object('linked', false); end if;
  select * into e from public.crocodial_ext_leads where connection_id = k.connection_id and external_id = k.external_lead_id;
  return jsonb_build_object(
    'linked', true, 'externalLeadId', k.external_lead_id, 'status', k.status, 'reason', k.reason, 'assignmentMode', k.assignment_mode,
    'externalStatus', e.status, 'disposition', k.disposition,
    'externalOwner', (select x.name from public.crocodial_ext_employees x where x.connection_id = k.connection_id and x.external_id = e.assigned_to_ext),
    'externalOwnerProfile', (select p.full_name from public.profiles p where p.id = k.external_owner_profile),
    'crmOwner', (select p.full_name from public.profiles p where p.id = c.owner_id),
    'ownershipDiffers', c.owner_id is distinct from k.external_owner_profile and k.external_owner_profile is not null,
    'missingAtSource', e.missing_since is not null,
    'lastSyncAt', (select min(s.last_ok_at) from public.crocodial_sync_state s where s.connection_id = k.connection_id),
    'lastReconciledAt', k.last_reconciled_at,
    'calls', (select jsonb_build_object('total', count(*), 'outgoing', count(*) filter (where call_type = 'outgoing'), 'incoming', count(*) filter (where call_type = 'incoming'),
                                         'missed', count(*) filter (where call_type = 'missed'), 'connected', count(*) filter (where call_type = 'outgoing' and connected is true),
                                         'talkSeconds', coalesce(sum(duration_seconds) filter (where connected is true), 0), 'lastCallAt', max(call_at))
                from public.crocodial_ext_calls where connection_id = k.connection_id and lead_ext = k.external_lead_id),
    'callHistory', coalesce((select jsonb_agg(jsonb_build_object('at', x.call_at, 'type', x.call_type, 'connected', x.connected, 'seconds', x.duration_seconds,
                                    -- the caller is the person who made the call, at that time (not the lead's current owner)
                                    'by', coalesce((select p.full_name from public.profiles p where p.id = private.croc_person_at(k.connection_id, x.called_by_ext, x.call_at)),
                                                   (select y.name from public.crocodial_ext_employees y where y.connection_id = k.connection_id and y.external_id = x.called_by_ext))) order by x.call_at desc)
                               from (select * from public.crocodial_ext_calls where connection_id = k.connection_id and lead_ext = k.external_lead_id order by call_at desc limit 20) x), '[]'::jsonb),
    'remarks', coalesce((select jsonb_agg(jsonb_build_object('at', x.external_created_at, 'text', x.remark,
                                'by', coalesce((select p.full_name from public.profiles p where p.id = private.croc_person_at(k.connection_id, x.written_by_ext, x.external_created_at)),
                                               (select y.name from public.crocodial_ext_employees y where y.connection_id = k.connection_id and y.external_id = x.written_by_ext))) order by x.external_created_at desc)
                           from (select * from public.crocodial_ext_remarks where connection_id = k.connection_id and lead_ext = k.external_lead_id order by external_created_at desc limit 10) x), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(jsonb_build_object('scheduledAt', x.scheduled_at, 'done', x.done, 'completedAt', x.completed_at, 'note', x.note,
                                  'by', coalesce((select p.full_name from public.profiles p where p.id = private.croc_person_at(k.connection_id, x.created_by_ext, x.external_created_at)),
                                                 (select y.name from public.crocodial_ext_employees y where y.connection_id = k.connection_id and y.external_id = x.created_by_ext))) order by x.scheduled_at desc)
                             from (select * from public.crocodial_ext_followups where connection_id = k.connection_id and lead_ext = k.external_lead_id order by scheduled_at desc limit 10) x), '[]'::jsonb),
    'ownerHistory', coalesce((select jsonb_agg(jsonb_build_object('observedAt', h.observed_at,
                                     'owner', coalesce((select p.full_name from public.profiles p where p.id = private.croc_person_at(k.connection_id, h.assigned_to_ext, h.observed_at)),
                                                       (select y.name from public.crocodial_ext_employees y where y.connection_id = k.connection_id and y.external_id = h.assigned_to_ext))) order by h.observed_at desc)
                                from (select * from public.crocodial_lead_owner_history h where h.connection_id = k.connection_id and h.external_lead_id = k.external_lead_id order by observed_at desc limit 20) h), '[]'::jsonb));
end $$;
revoke all on function public.croc_lead_activity(uuid) from public, anon;
grant execute on function public.croc_lead_activity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Managers' lead figures (point in time: who owns which Crocodial lead now), for the people the caller may see (croc_can_view):
--    a CEO their Sales departments, a Department Head their department, a Team Lead their direct team. Each lead counts once (its one
--    current assignee). Calls stay in croc_team_activity (credited to the caller, by date range); this is ownership, not activity.
-- ---------------------------------------------------------------------------
create or replace function public.croc_team_leads(p_department uuid default null, p_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501'; end if;
  return (
    with ppl as (
      select distinct on (p.id) p.id, p.full_name, p.team_id, t.name as team_name, m.department_id, m.connection_id, m.external_employee_id
        from public.crocodial_employee_mappings m
        join public.profiles p on p.id = m.profile_id and p.status = 'ACTIVE'
        join public.crocodial_connections c on c.id = m.connection_id and c.enabled
        join public.crocodial_department_links l on l.connection_id = m.connection_id and l.department_id = m.department_id and l.division = m.division and l.enabled
        join public.crocodial_rollout ro on ro.department_id = m.department_id and ro.division = m.division and ro.allowed
        left join public.teams t on t.id = p.team_id
       where m.status = 'APPROVED' and m.ended_at is null
         and (p_department is null or m.department_id = p_department)
         and (p_team is null or p.team_id = p_team)
         and private.croc_can_view(p.id, m.department_id, m.division)
       order by p.id, m.approved_at desc),
    lds as (
      select ppl.id as profile_id, e.*, sm.disposition
        from ppl join public.crocodial_ext_leads e on e.connection_id = ppl.connection_id and e.assigned_to_ext = ppl.external_employee_id and e.missing_since is null
        left join public.crocodial_status_mappings sm on sm.connection_id = e.connection_id and sm.external_status = lower(btrim(e.status)))
    select jsonb_build_object(
      'people', coalesce((select jsonb_agg(jsonb_build_object('profileId', ppl.id, 'name', ppl.full_name, 'teamId', ppl.team_id, 'teamName', ppl.team_name,
                  'assigned', (select count(*) from lds where lds.profile_id = ppl.id),
                  'contacted', (select count(*) from lds where lds.profile_id = ppl.id and lds.called is true),
                  'notContacted', (select count(*) from lds where lds.profile_id = ppl.id and lds.called is not true),
                  'followupDue', (select count(*) from lds where lds.profile_id = ppl.id and lds.next_followup_at < now())) order by ppl.full_name) from ppl), '[]'::jsonb),
      'totals', jsonb_build_object(
        'assigned', (select count(*) from lds),
        'newLeads', (select count(*) from lds where lds.disposition = 'NEW' or (lds.disposition is null and lds.called is not true)),
        'contacted', (select count(*) from lds where lds.called is true),
        'notContacted', (select count(*) from lds where lds.called is not true),
        'followupDue', (select count(*) from lds where lds.next_followup_at < now())),
      -- by Crocodial's own status (and the CRM disposition when one is mapped); "demo" in a status name is not counted as a demo anywhere
      'statuses', coalesce((select jsonb_agg(jsonb_build_object('status', st, 'disposition', disp, 'leads', n) order by n desc)
                              from (select coalesce(nullif(btrim(lds.status), ''), '(none)') st, lds.disposition disp, count(*) n from lds group by 1, 2) q), '[]'::jsonb),
      'connectedEmployees', (select count(*) from ppl)));
end $$;
revoke all on function public.croc_team_leads(uuid, uuid) from public, anon;
grant execute on function public.croc_team_leads(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
