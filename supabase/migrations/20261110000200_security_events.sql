-- Security and audit events: the smallest set of changes that makes the existing audit trail reliable and reviewable.
--
-- WHAT EXISTED (see docs/SECURITY.md): public.audit_logs written by triggers and SECURITY DEFINER functions (customers, payments, invoices,
-- documents, roles, ...), failed sign-ins through the Auth password hook, rejected lead webhooks. Protected from API roles by grants only.
--
-- WHAT THIS ADDS
--   1. audit_logs gets: outcome (SUCCESS / FAILURE / DENIED), the actor's role and a name snapshot (so deleting a person never erases
--      who did something), the request id (so a row can be tied to the request that caused it), the caller's address for server-side
--      events, and a dedupe key (a retried request records one event).
--   2. Every insert is scrubbed of secrets and stamped with the request id by a BEFORE INSERT trigger - including the writers that
--      insert directly. (Rows written earlier are not rewritten, except to fill the new columns.)
--   3. Audit rows are append-only in the database itself: a trigger refuses UPDATE and DELETE (the one allowed UPDATE is the foreign-key
--      clean-up that sets a removed person / department / team reference to NULL) and TRUNCATE. A deliberate clean-up must say so with
--      set_config('amuwa.audit_purge', 'on', true) (the maintenance script does).
--   4. public.record_server_event: the API server records what the database cannot (a refused request rolls its own transaction back):
--      denied / unauthenticated requests, rate limiting and the start of a session. service_role only; deduplicated.
--   5. public.record_data_export: an export of records from the browser is recorded with who, what and how many rows.
--   6. Chat group membership and role changes are audited (trigger on chat_members, so every path is covered).
--   7. public.audit_log_search / audit_log_actions: search by actor, action, request id, outcome and dates; paged; read-only; scoped by the
--      table's row-level security (Super Admin: all, Department Head: the department, Team Lead: the team).
--
-- Run after 20261110000100_dashboards_overview.sql. Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.audit_logs add column if not exists outcome text not null default 'SUCCESS' check (outcome in ('SUCCESS', 'FAILURE', 'DENIED'));
alter table public.audit_logs add column if not exists actor_role text;
alter table public.audit_logs add column if not exists actor_label text check (length(actor_label) <= 200);
alter table public.audit_logs add column if not exists request_id text check (length(request_id) <= 128);
alter table public.audit_logs add column if not exists ip text check (length(ip) <= 64);
alter table public.audit_logs add column if not exists dedupe_key text check (length(dedupe_key) <= 240);
create unique index if not exists audit_logs_dedupe_key on public.audit_logs (dedupe_key) where dedupe_key is not null;
create index if not exists audit_logs_outcome_idx on public.audit_logs (created_at desc) where outcome <> 'SUCCESS';
create index if not exists audit_logs_request_idx on public.audit_logs (request_id) where request_id is not null;

-- The append-only guard must not be in the way of the one-time fill of the new columns below.
drop trigger if exists audit_logs_protect on public.audit_logs;
update public.audit_logs a
   set actor_role = p.role::text, actor_label = left(p.full_name || ' <' || p.email || '>', 200)
  from public.profiles p
 where a.actor_id = p.id and a.actor_label is null;
update public.audit_logs set outcome = 'FAILURE' where outcome = 'SUCCESS' and action in ('LOGIN_FAILED', 'CLIENT_LOGIN_FAILED', 'AUTOMATION_FAILED');
update public.audit_logs set outcome = 'DENIED' where outcome = 'SUCCESS' and action in ('LOGIN_LOCKED', 'WEBHOOK_REJECTED');

-- ---------------------------------------------------------------------------
-- 2. Every insert: scrub secrets, stamp the request id, the actor's role and name, and the outcome of the well-known failures
-- ---------------------------------------------------------------------------
create or replace function private.tg_audit_logs_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_headers jsonb;
  v_rid text;
  p public.profiles;
begin
  new.metadata := private.scrub_audit_metadata(coalesce(new.metadata, '{}'::jsonb));
  if new.request_id is null then
    begin
      v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
      v_headers := null;
    end;
    v_rid := v_headers ->> 'x-request-id';
    -- the id is only a correlation label: keep it short and plain
    if v_rid ~ '^[A-Za-z0-9._:-]{1,128}$' then
      new.request_id := v_rid;
    end if;
  end if;
  if new.actor_id is not null and (new.actor_role is null or new.actor_label is null) then
    select * into p from public.profiles where id = new.actor_id;
    if p.id is not null then
      new.actor_role := coalesce(new.actor_role, p.role::text);
      new.actor_label := coalesce(new.actor_label, left(p.full_name || ' <' || p.email || '>', 200));
    end if;
  end if;
  if new.outcome = 'SUCCESS' then
    if new.action in ('LOGIN_FAILED', 'CLIENT_LOGIN_FAILED', 'AUTOMATION_FAILED') then
      new.outcome := 'FAILURE';
    elsif new.action in ('LOGIN_LOCKED', 'WEBHOOK_REJECTED') then
      new.outcome := 'DENIED';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_audit_logs_before_insert() from public, anon, authenticated;
drop trigger if exists audit_logs_before_insert on public.audit_logs;
create trigger audit_logs_before_insert before insert on public.audit_logs
  for each row execute function private.tg_audit_logs_before_insert();

-- ---------------------------------------------------------------------------
-- 3. Append-only
-- ---------------------------------------------------------------------------
create or replace function private.tg_audit_logs_protect()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('amuwa.audit_purge', true), '') = 'on' then
      return old;
    end if;
    raise exception 'FORBIDDEN: Audit records cannot be deleted.' using errcode = '42501';
  end if;
  -- UPDATE: only the foreign-key action that clears the reference to a removed person, department or team
  if (to_jsonb(new) - 'actor_id' - 'department_id' - 'team_id') is distinct from (to_jsonb(old) - 'actor_id' - 'department_id' - 'team_id')
     or (new.actor_id is distinct from old.actor_id and new.actor_id is not null)
     or (new.department_id is distinct from old.department_id and new.department_id is not null)
     or (new.team_id is distinct from old.team_id and new.team_id is not null) then
    raise exception 'FORBIDDEN: Audit records cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_audit_logs_protect() from public, anon, authenticated;
create trigger audit_logs_protect before update or delete on public.audit_logs
  for each row execute function private.tg_audit_logs_protect();

create or replace function private.tg_audit_logs_no_truncate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('amuwa.audit_purge', true), '') = 'on' then
    return null;
  end if;
  raise exception 'FORBIDDEN: Audit records cannot be deleted.' using errcode = '42501';
end $$;
revoke all on function private.tg_audit_logs_no_truncate() from public, anon, authenticated;
drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.tg_audit_logs_no_truncate();

-- ---------------------------------------------------------------------------
-- 4. Events the API server records (a refused request leaves nothing behind in the database otherwise)
-- ---------------------------------------------------------------------------
create or replace function public.record_server_event(
  p_action text, p_entity_type text, p_entity_id uuid, p_actor uuid, p_outcome text,
  p_request_id text, p_ip text, p_dedupe_key text, p_metadata jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_action is null or p_action !~ '^[A-Z][A-Z0-9_]{1,63}$' or p_entity_type is null or p_entity_type !~ '^[a-z_]{1,40}$' then
    raise exception 'VALIDATION_ERROR: Unknown event.' using errcode = 'P0001';
  end if;
  if p_outcome not in ('SUCCESS', 'FAILURE', 'DENIED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  if length(v_meta::text) > 4000 then
    v_meta := jsonb_build_object('truncated', true);
  end if;
  if p_actor is not null then
    select * into p from public.profiles where id = p_actor;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, outcome, request_id, ip, dedupe_key, metadata)
  values (p.id, p_action, p_entity_type, p_entity_id, p.department_id, p.team_id, p_outcome,
          nullif(left(p_request_id, 128), ''), nullif(left(p_ip, 64), ''), nullif(left(p_dedupe_key, 240), ''), v_meta)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return found;
end $$;
revoke all on function public.record_server_event(text, text, uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_server_event(text, text, uuid, uuid, text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Exports done in the browser
-- ---------------------------------------------------------------------------
create or replace function public.record_data_export(p_dataset text, p_rows integer, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if p.id is null then
    raise exception 'FORBIDDEN: Sign in to record an export.' using errcode = '42501';
  end if;
  if p_dataset is null or p_dataset !~ '^[a-z_]{1,40}$' then
    raise exception 'VALIDATION_ERROR: Unknown dataset.' using errcode = 'P0001';
  end if;
  perform private.write_audit('DATA_EXPORTED', 'export', null, p.department_id, p.team_id,
    jsonb_build_object('dataset', p_dataset, 'rows', greatest(least(coalesce(p_rows, 0), 10000000), 0), 'note', left(nullif(btrim(coalesce(p_note, '')), ''), 200)));
end $$;
revoke all on function public.record_data_export(text, integer, text) from public, anon;
grant execute on function public.record_data_export(text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Chat membership
-- ---------------------------------------------------------------------------
create or replace function private.tg_chat_members_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
begin
  select * into c from public.chat_conversations where id = new.conversation_id;
  -- Direct chats and the client chat of a customer are made by the system; group membership is a decision of people.
  if c.id is null or c.kind <> 'GROUP' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform private.write_audit('CHAT_MEMBER_ADDED', 'chat_conversation', c.id, null, null,
      jsonb_build_object('member', new.profile_id, 'role', new.role, 'title', c.title));
  elsif old.left_at is not null and new.left_at is null then
    perform private.write_audit('CHAT_MEMBER_ADDED', 'chat_conversation', c.id, null, null,
      jsonb_build_object('member', new.profile_id, 'role', new.role, 'title', c.title, 'rejoined', true));
  elsif old.left_at is null and new.left_at is not null then
    perform private.write_audit(case when new.removed_by is null then 'CHAT_MEMBER_LEFT' else 'CHAT_MEMBER_REMOVED' end, 'chat_conversation', c.id, null, null,
      jsonb_build_object('member', new.profile_id, 'removed_by', new.removed_by, 'title', c.title));
  elsif old.role is distinct from new.role then
    perform private.write_audit('CHAT_MEMBER_ROLE_CHANGED', 'chat_conversation', c.id, null, null,
      jsonb_build_object('member', new.profile_id, 'from', old.role, 'to', new.role, 'title', c.title));
  end if;
  return new;
end $$;
revoke all on function private.tg_chat_members_audit() from public, anon, authenticated;
drop trigger if exists chat_members_audit on public.chat_members;
create trigger chat_members_audit after insert or update on public.chat_members
  for each row execute function private.tg_chat_members_audit();

-- ---------------------------------------------------------------------------
-- 7. Reading: search, filters, pages. SECURITY INVOKER: audit_logs' own row-level security decides what is visible.
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_search(
  p_search text default null, p_action text default null, p_outcome text default null, p_entity_type text default null,
  p_from date default null, p_to date default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_total bigint;
  v_items jsonb;
begin
  if private.my_role() is null or private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') then
    raise exception 'FORBIDDEN: Only managers can read the audit log.' using errcode = '42501';
  end if;
  if p_outcome is not null and p_outcome not in ('SUCCESS', 'FAILURE', 'DENIED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;

  select count(*) into v_total from public.audit_logs a
   where (p_action is null or a.action = p_action)
     and (p_outcome is null or a.outcome = p_outcome)
     and (p_entity_type is null or a.entity_type = p_entity_type)
     and (p_from is null or a.created_at >= p_from::timestamptz)
     and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
     and (v_term is null or lower(a.action) like '%' || v_term || '%' or lower(coalesce(a.actor_label, '')) like '%' || v_term || '%'
          or lower(coalesce(a.request_id, '')) like '%' || v_term || '%' or a.entity_id::text = v_term);

  select coalesce(jsonb_agg(x.j order by x.created_at desc, x.id desc), '[]'::jsonb) into v_items from (
    select a.id, a.created_at, jsonb_build_object(
             'id', a.id, 'at', a.created_at, 'action', a.action, 'entityType', a.entity_type, 'entityId', a.entity_id,
             'outcome', a.outcome, 'actorId', a.actor_id, 'actor', coalesce(a.actor_label, pr.full_name), 'actorRole', a.actor_role,
             'departmentId', a.department_id, 'department', d.name, 'requestId', a.request_id, 'ip', a.ip, 'metadata', a.metadata) as j
      from public.audit_logs a
      left join public.profiles pr on pr.id = a.actor_id
      left join public.departments d on d.id = a.department_id
     where (p_action is null or a.action = p_action)
       and (p_outcome is null or a.outcome = p_outcome)
       and (p_entity_type is null or a.entity_type = p_entity_type)
       and (p_from is null or a.created_at >= p_from::timestamptz)
       and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
       and (v_term is null or lower(a.action) like '%' || v_term || '%' or lower(coalesce(a.actor_label, '')) like '%' || v_term || '%'
            or lower(coalesce(a.request_id, '')) like '%' || v_term || '%' or a.entity_id::text = v_term)
     order by a.created_at desc, a.id desc
     limit v_size offset (v_page - 1) * v_size) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.audit_log_search(text, text, text, text, date, date, integer, integer) from public, anon;
grant execute on function public.audit_log_search(text, text, text, text, date, date, integer, integer) to authenticated;

create or replace function public.audit_log_actions()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if private.my_role() is null or private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') then
    raise exception 'FORBIDDEN: Only managers can read the audit log.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(action order by action) from (select distinct action from public.audit_logs) t), '[]'::jsonb);
end $$;
revoke all on function public.audit_log_actions() from public, anon;
grant execute on function public.audit_log_actions() to authenticated;

notify pgrst, 'reload schema';
