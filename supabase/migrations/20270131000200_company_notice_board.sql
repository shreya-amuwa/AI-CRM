-- =============================================================================
-- Company Notice Board (docs/NOTICE_BOARD.md). Run after 20270131000100_super_admin_attendance_alert.sql. Additive and safe to run twice.
--
--   * Every active employee reads the notices addressed to them (Notice Board > View Notices); opening one records it as read (a read receipt).
--   * Only four kinds of people publish (Notice Board > Send Notice), checked here in the database, never only in the screen:
--       SUPER_ADMIN      any audience, and manages every notice;
--       HR               (HR staff, not recruiters) any audience;
--       DEVELOPER        (the Developers team) any audience;
--       OPERATIONS_HEAD  only inside the departments they own (no "entire company"; departments, roles and employees of their departments).
--     A Department Head, Team Lead or Team Member who is none of these cannot publish, edit or archive anything.
--   * Audience: the entire company, departments, roles (optionally within departments), or selected employees. It is resolved into
--     company_notice_recipients when the notice is released (at once, or at its publish time by the Worker's 5-minute run: notice_release_due),
--     and only those people are notified (bell + push through the existing outbox) and can read it.
--   * Publishers see the notices of the company in View Notices (a notice for selected employees only to its publisher, its recipients and the
--     Super Admin), their own in My Notices with the read receipts and the push delivery status; they edit their own (the Super Admin any),
--     every edit kept in company_notice_revisions; they archive (nothing is deleted).
--   * Attachments use the existing private upload pipeline (employee_issue_attachments.notice_id); publishers may upload.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create sequence if not exists public.company_notice_ref_seq;

create table if not exists public.company_notices (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  title text not null check (length(btrim(title)) between 3 and 200),
  body text not null check (length(btrim(body)) between 1 and 10000),
  category text not null check (category in ('GENERAL', 'HR', 'POLICY', 'EVENT', 'HOLIDAY', 'IT_SYSTEM', 'OPERATIONS', 'OTHER')),
  priority text not null default 'NORMAL' check (priority in ('NORMAL', 'IMPORTANT', 'URGENT')),
  audience_type text not null check (audience_type in ('COMPANY', 'DEPARTMENT', 'ROLE', 'EMPLOYEES')),
  audience_departments uuid[] not null default '{}',
  audience_roles text[] not null default '{}',
  audience_employees uuid[] not null default '{}',
  publisher_id uuid not null references public.profiles (id) on delete restrict,
  publisher_role text not null check (publisher_role in ('SUPER_ADMIN', 'OPERATIONS_HEAD', 'HR', 'DEVELOPER')),
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'PUBLISHED', 'ARCHIVED')),
  released_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1,
  client_request_id text not null check (length(client_request_id) between 8 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publisher_id, client_request_id),
  check (expires_at is null or expires_at > publish_at)
);
create index if not exists company_notices_feed_idx on public.company_notices (status, publish_at desc);
create index if not exists company_notices_publisher_idx on public.company_notices (publisher_id, created_at desc);

create table if not exists public.company_notice_recipients (
  notice_id uuid not null references public.company_notices (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  notified_at timestamptz,
  read_at timestamptz,
  primary key (notice_id, profile_id)
);
create index if not exists company_notice_recipients_person_idx on public.company_notice_recipients (profile_id, notice_id) include (read_at);

-- every edit, as it was before and after (append-only)
create table if not exists public.company_notice_revisions (
  id bigint generated always as identity primary key,
  notice_id uuid not null references public.company_notices (id) on delete cascade,
  version integer not null,
  action text not null check (action in ('PUBLISHED', 'EDITED', 'ARCHIVED')),
  edited_by uuid references public.profiles (id) on delete set null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists company_notice_revisions_notice_idx on public.company_notice_revisions (notice_id, id);

alter table public.company_notices enable row level security;
alter table public.company_notice_recipients enable row level security;
alter table public.company_notice_revisions enable row level security;
revoke all on public.company_notices, public.company_notice_recipients, public.company_notice_revisions from public, anon, authenticated;
revoke all on sequence public.company_notice_ref_seq from public, anon, authenticated;

drop trigger if exists company_notices_set_updated_at on public.company_notices;
create trigger company_notices_set_updated_at before update on public.company_notices for each row execute function public.tg_set_updated_at();
create or replace function private.tg_company_notice_revisions_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'FORBIDDEN: The history of a notice cannot be changed.' using errcode = '42501';
end $$;
drop trigger if exists company_notice_revisions_append_only on public.company_notice_revisions;
create trigger company_notice_revisions_append_only before update or delete on public.company_notice_revisions
  for each row when (pg_trigger_depth() = 0) execute function private.tg_company_notice_revisions_append_only();

-- attachments: the existing private upload pipeline; a file belongs to an issue, a bug or a notice
alter table public.employee_issue_attachments add column if not exists notice_id uuid references public.company_notices (id) on delete cascade;
create index if not exists employee_issue_attachments_notice_idx on public.employee_issue_attachments (notice_id, created_at) where notice_id is not null;

-- the push outbox carries notices too
alter table public.notification_deliveries drop constraint if exists notification_deliveries_kind_check;
alter table public.notification_deliveries add constraint notification_deliveries_kind_check
  check (kind in ('ATTENDANCE_REMINDER', 'TEST', 'SA_ATTENDANCE', 'COMPANY_NOTICE'));

-- ---------------------------------------------------------------------------
-- 2. Who publishes, and where
-- ---------------------------------------------------------------------------
-- the signed-in person's publishing right: the broadest of their roles, or null (read only)
create or replace function private.notice_publisher_role(p_profile uuid default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.id is null then null
    when p.role = 'SUPER_ADMIN' then 'SUPER_ADMIN'
    when exists (select 1 from public.departments d where d.id = p.department_id and d.slug = 'hr') and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER' then 'HR'
    when private.is_developer(p.id) then 'DEVELOPER'
    when p.role = 'DEPARTMENT_HEAD' and p.is_operations_head then 'OPERATIONS_HEAD'
  end
  from (select * from public.profiles where id = coalesce(p_profile, auth.uid()) and status = 'ACTIVE') p
  right join (select 1) one on true
$$;

-- an Operations Head's departments: the ones they own, the Sales / Support functions they were named for, and their own
create or replace function private.notice_oh_departments(p_profile uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct d.id), '{}') from public.departments d
   where private.owner_of_department(d.id) = p_profile
      or exists (select 1 from public.department_function_owner o where o.department_id = d.id and o.operations_head_id = p_profile)
      or d.id = (select private.base_department(department_id) from public.profiles where id = p_profile)
$$;

-- the people an audience means (active employees; the publisher is left out)
create or replace function private.notice_audience(p_type text, p_departments uuid[], p_roles text[], p_employees uuid[], p_publisher uuid)
returns table (profile_id uuid) language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
   where p.status = 'ACTIVE' and p.id <> p_publisher
     and case p_type
           when 'COMPANY' then true
           when 'DEPARTMENT' then private.base_department(p.department_id) = any (p_departments)
           when 'ROLE' then (cardinality(p_departments) = 0 or private.base_department(p.department_id) = any (p_departments))
                            and (p.role::text = any (p_roles)
                                 or ('OPERATIONS_HEAD' = any (p_roles) and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head)
                                 or ('HR' = any (p_roles) and exists (select 1 from public.departments d where d.id = p.department_id and d.slug = 'hr')))
           when 'EMPLOYEES' then p.id = any (p_employees)
           else false end
$$;

-- what an Operations Head may address: only people of their departments
create or replace function private.notice_check_scope(p_role text, p_profile uuid, p_type text, p_departments uuid[], p_employees uuid[])
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_mine uuid[];
begin
  if p_role is null then
    raise exception 'FORBIDDEN: Only the Super Admin, an Operations Head, HR and the Developers team publish notices.' using errcode = '42501';
  end if;
  if p_role <> 'OPERATIONS_HEAD' then
    return;
  end if;
  v_mine := private.notice_oh_departments(p_profile);
  if p_type = 'COMPANY' then
    raise exception 'FORBIDDEN: An Operations Head publishes to the departments they manage, not to the entire company.' using errcode = '42501';
  end if;
  if p_type in ('DEPARTMENT', 'ROLE') and (cardinality(p_departments) = 0 or not (p_departments <@ v_mine)) then
    raise exception 'FORBIDDEN: Choose only departments you manage.' using errcode = '42501';
  end if;
  if p_type = 'EMPLOYEES' and exists (select 1 from public.profiles p where p.id = any (p_employees) and not (private.base_department(p.department_id) = any (v_mine))) then
    raise exception 'FORBIDDEN: Choose only employees of the departments you manage.' using errcode = '42501';
  end if;
end $$;

-- may the signed-in person read this notice?
create or replace function private.notice_visible(n public.company_notices)
returns boolean language sql stable security definer set search_path = '' as $$
  -- strictly true or false (a NULL here must never let anyone through)
  select coalesce(auth.uid() is not null and (
    n.publisher_id = auth.uid()
    or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)
    or (n.status <> 'SCHEDULED' and exists (select 1 from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()))
    -- the other publishers see the company's notices (not one addressed to selected employees only)
    or (n.status <> 'SCHEDULED' and n.audience_type <> 'EMPLOYEES' and private.notice_publisher_role() is not null)), false)
$$;

-- ---------------------------------------------------------------------------
-- 3. JSON
-- ---------------------------------------------------------------------------
create or replace function private.notice_json(n public.company_notices, p_full boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'reference', n.reference, 'title', n.title, 'body', case when p_full then n.body else left(n.body, 280) end,
    'category', n.category, 'priority', n.priority, 'status', n.status,
    'expired', n.expires_at is not null and n.expires_at <= now(),
    'publishAt', n.publish_at, 'expiresAt', n.expires_at, 'releasedAt', n.released_at, 'updatedAt', n.updated_at, 'version', n.version,
    'publisherId', n.publisher_id, 'publisherName', (select full_name from public.profiles where id = n.publisher_id), 'publisherRole', n.publisher_role,
    'audience', jsonb_build_object('type', n.audience_type, 'departments', to_jsonb(n.audience_departments), 'roles', to_jsonb(n.audience_roles),
                                   'employees', to_jsonb(n.audience_employees),
                                   'departmentNames', coalesce((select jsonb_agg(d.name order by d.name) from public.departments d where d.id = any (n.audience_departments)), '[]'::jsonb)),
    'isRecipient', exists (select 1 from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()),
    'read', coalesce((select r.read_at is not null from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()), true),
    'readAt', (select r.read_at from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()),
    'canManage', n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false),
    'recipientCount', (select count(*) from public.company_notice_recipients r where r.notice_id = n.id),
    'readCount', (select count(*) from public.company_notice_recipients r where r.notice_id = n.id and r.read_at is not null),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime_type, 'size', a.size_bytes) order by a.created_at)
                    from public.employee_issue_attachments a where a.notice_id = n.id and a.status = 'READY'), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 4. Releasing a notice: its audience, the bell and the push outbox (once per person)
-- ---------------------------------------------------------------------------
create or replace function private.notice_release(p_id uuid, p_push boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.company_notices;
  v_notified integer := 0;
  v_jobs integer := 0;
  v_ids bigint[];
  v_by text;
begin
  select * into n from public.company_notices where id = p_id for update;
  if n.id is null or n.status = 'ARCHIVED' or n.publish_at > now() then
    return jsonb_build_object('notified', 0, 'jobsCreated', 0, 'ids', '[]'::jsonb);
  end if;
  insert into public.company_notice_recipients (notice_id, profile_id)
  select n.id, a.profile_id from private.notice_audience(n.audience_type, n.audience_departments, n.audience_roles, n.audience_employees, n.publisher_id) a
  on conflict do nothing;
  v_by := (select full_name from public.profiles where id = n.publisher_id);
  with fresh as (
    update public.company_notice_recipients set notified_at = now() where notice_id = n.id and notified_at is null returning profile_id),
  bell as (
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
    select f.profile_id, 'COMPANY_NOTICE', 'New Company Notice: ' || left(n.title, 150),
           'A new notice has been published by ' || coalesce(v_by, 'the company') || '. Please check your Notice Board.',
           'company_notice', n.id, n.publisher_id, jsonb_build_object('noticeId', n.id, 'priority', n.priority, 'publisher', v_by),
           case when n.priority = 'URGENT' then 'urgent' else 'normal' end
      from fresh f
    returning recipient_id),
  jobs as (
    insert into public.notification_deliveries (kind, profile_id, subscription_id, device_label, title, body, tag, url, expires_at, next_attempt_at)
    select 'COMPANY_NOTICE', b.recipient_id, s.id, s.label, 'New Company Notice', left(n.title || ' — from ' || coalesce(v_by, 'the company'), 500),
           'notice-' || n.id, '/?open=notice&id=' || n.id, now() + interval '24 hours', now()
      from bell b join public.push_subscriptions s on s.profile_id = b.recipient_id and s.active
     where p_push
    returning id)
  select (select count(*) from bell), (select count(*) from jobs), (select coalesce(array_agg(id), '{}') from jobs) into v_notified, v_jobs, v_ids;
  update public.company_notices set status = 'PUBLISHED', released_at = coalesce(released_at, now()) where id = n.id;
  return jsonb_build_object('notified', v_notified, 'jobsCreated', v_jobs, 'ids', to_jsonb(v_ids));
end $$;

-- the Worker's 5-minute run: notices whose publish time has come (service role)
create or replace function public.notice_release_due(p_now timestamptz default now(), p_push boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  x jsonb;
  v_generated integer := 0;
  v_jobs integer := 0;
begin
  for r in select id from public.company_notices where status = 'SCHEDULED' and publish_at <= least(p_now, now()) order by publish_at limit 50 loop
    x := private.notice_release(r.id, p_push);
    v_generated := v_generated + (x ->> 'notified')::integer;
    v_jobs := v_jobs + (x ->> 'jobsCreated')::integer;
  end loop;
  return jsonb_build_object('generated', v_generated, 'jobsCreated', v_jobs, 'noDevice', 0);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reading
-- ---------------------------------------------------------------------------
-- p_scope: INBOX (addressed to me), ALL (every notice I may read: publishers see the company's), MINE (published by me; the Super Admin every notice)
create or replace function public.notice_list(p_scope text default 'INBOX', p_category text default null, p_priority text default null,
  p_from timestamptz default null, p_to timestamptz default null, p_unread boolean default false, p_search text default null,
  p_include_expired boolean default false, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_role text := private.notice_publisher_role();
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_scope text := upper(coalesce(nullif(p_scope, ''), 'INBOX'));
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
begin
  if me is null or not exists (select 1 from public.profiles where id = me and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if v_scope not in ('INBOX', 'ALL', 'MINE') then
    raise exception 'VALIDATION_ERROR: Unknown list.' using errcode = '22023';
  end if;
  if v_scope = 'MINE' and v_role is null then
    raise exception 'FORBIDDEN: Only publishers have published notices.' using errcode = '42501';
  end if;
  return (
    with f as (
      select n.* from public.company_notices n
       where case v_scope
               when 'INBOX' then n.status = 'PUBLISHED' and exists (select 1 from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = me)
               when 'ALL' then n.status = 'PUBLISHED' and private.notice_visible(n)
               else (n.publisher_id = me or coalesce(v_role = 'SUPER_ADMIN', false)) end
         and (v_scope = 'MINE' or p_include_expired or n.expires_at is null or n.expires_at > now())
         and (p_category is null or n.category = p_category)
         and (p_priority is null or n.priority = p_priority)
         and (p_from is null or n.publish_at >= p_from) and (p_to is null or n.publish_at < p_to)
         and (not coalesce(p_unread, false) or exists (select 1 from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = me and r.read_at is null))
         and (v_q is null or n.title ilike '%' || private.like_escape(v_q) || '%' or n.reference ilike '%' || private.like_escape(v_q) || '%'))
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(private.notice_json(x, false) order by x.publish_at desc, x.id)
                           from (select * from f order by publish_at desc, id limit v_limit offset v_off) x), '[]'::jsonb),
      'total', (select count(*) from f),
      'unread', (select count(*) from public.company_notice_recipients r join public.company_notices n on n.id = r.notice_id
                  where r.profile_id = me and r.read_at is null and n.status = 'PUBLISHED' and (n.expires_at is null or n.expires_at > now())),
      'publisherRole', v_role));
end $$;

create or replace function public.notice_unread_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.company_notice_recipients r join public.company_notices n on n.id = r.notice_id
   where r.profile_id = auth.uid() and r.read_at is null and n.status = 'PUBLISHED' and (n.expires_at is null or n.expires_at > now())
$$;

-- opening a notice: its full text, and (for a recipient) the read receipt, once
create or replace function public.notice_open(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.company_notices;
begin
  select * into n from public.company_notices where id = p_id;
  if n.id is null or not private.notice_visible(n) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0002';
  end if;
  update public.company_notice_recipients set read_at = now() where notice_id = n.id and profile_id = auth.uid() and read_at is null;
  -- the bell's notification about it is read too
  update public.notifications set read_at = now() where recipient_id = auth.uid() and entity_type = 'company_notice' and entity_id = n.id and read_at is null;
  return private.notice_json(n, true) || jsonb_build_object('history', case when n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)
    then coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'action', v.action, 'by', (select full_name from public.profiles where id = v.edited_by),
           'at', v.created_at, 'before', v.before, 'after', v.after) order by v.id) from public.company_notice_revisions v where v.notice_id = n.id), '[]'::jsonb)
    else '[]'::jsonb end);
end $$;

-- the read receipts and the push delivery status (the publisher, or the Super Admin)
create or replace function public.notice_receipts(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  n public.company_notices;
begin
  select * into n from public.company_notices where id = p_id;
  if n.id is null or not (n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'noticeId', n.id, 'status', n.status,
    'total', (select count(*) from public.company_notice_recipients where notice_id = n.id),
    'read', (select count(*) from public.company_notice_recipients where notice_id = n.id and read_at is not null),
    'unread', (select count(*) from public.company_notice_recipients where notice_id = n.id and read_at is null),
    'push', (select jsonb_build_object('devices', count(*), 'accepted', count(*) filter (where status = 'ACCEPTED_BY_PUSH_SERVICE'),
               'pending', count(*) filter (where status in ('PENDING', 'PROCESSING', 'RETRY_PENDING')), 'failed', count(*) filter (where status in ('FAILED', 'EXPIRED')),
               'cancelled', count(*) filter (where status = 'CANCELLED'))
             from public.notification_deliveries where kind = 'COMPANY_NOTICE' and tag = 'notice-' || n.id),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('profileId', p.id, 'name', p.full_name,
               'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
               'notifiedAt', r.notified_at, 'readAt', r.read_at) order by r.read_at nulls first, p.full_name)
             from public.company_notice_recipients r join public.profiles p on p.id = r.profile_id where r.notice_id = n.id), '[]'::jsonb));
end $$;

-- what a publisher may choose: their right, the departments, roles and employees within it
create or replace function public.notice_audience_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.notice_publisher_role();
  v_depts uuid[];
begin
  if v_role is null then
    return jsonb_build_object('canPublish', false, 'role', null, 'audiences', '[]'::jsonb, 'departments', '[]'::jsonb, 'roles', '[]'::jsonb, 'employees', '[]'::jsonb);
  end if;
  v_depts := case when v_role = 'OPERATIONS_HEAD' then private.notice_oh_departments(auth.uid()) end;
  return jsonb_build_object(
    'canPublish', true, 'role', v_role,
    'audiences', case when v_role = 'OPERATIONS_HEAD' then '["DEPARTMENT","ROLE","EMPLOYEES"]'::jsonb else '["COMPANY","DEPARTMENT","ROLE","EMPLOYEES"]'::jsonb end,
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d
                               where v_depts is null or d.id = any (v_depts)), '[]'::jsonb),
    'roles', '[{"id":"DEPARTMENT_HEAD","label":"Department Heads"},{"id":"OPERATIONS_HEAD","label":"Operations Heads"},{"id":"TEAM_HEAD","label":"Team Leads"},{"id":"TEAM_MEMBER","label":"Team Members"},{"id":"HR","label":"HR"},{"id":"SUPER_ADMIN","label":"Super Admin"}]'::jsonb,
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role,
                     'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
                     'departmentId', private.base_department(p.department_id)) order by p.full_name)
                   from public.profiles p where p.status = 'ACTIVE' and p.id <> auth.uid()
                    and (v_depts is null or private.base_department(p.department_id) = any (v_depts))), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Publishing, editing, archiving
-- ---------------------------------------------------------------------------
create or replace function private.notice_uuid_array(p jsonb)
returns uuid[] language plpgsql stable set search_path = '' as $$
declare
  v uuid[];
begin
  select coalesce(array_agg(distinct private.try_uuid(e)), '{}') into v from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) e;
  if array_position(v, null) is not null then
    raise exception 'VALIDATION_ERROR: Choose the departments and employees from the lists.' using errcode = '22023';
  end if;
  return v;
end $$;

create or replace function public.notice_publish(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_role text := private.notice_publisher_role();
  v_key text := nullif(btrim(coalesce(p ->> 'clientRequestId', '')), '');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_body text := btrim(coalesce(p ->> 'body', ''));
  v_cat text := coalesce(nullif(p ->> 'category', ''), 'GENERAL');
  v_pri text := coalesce(nullif(p ->> 'priority', ''), 'NORMAL');
  v_type text := coalesce(nullif(p ->> 'audienceType', ''), '');
  v_depts uuid[] := private.notice_uuid_array(p -> 'departmentIds');
  v_emps uuid[] := private.notice_uuid_array(p -> 'employeeIds');
  v_roles text[];
  v_files uuid[] := private.notice_uuid_array(p -> 'attachmentIds');
  v_publish timestamptz := coalesce(nullif(p ->> 'publishAt', '')::timestamptz, now());
  v_expires timestamptz := nullif(p ->> 'expiresAt', '')::timestamptz;
  v_n integer;
  n public.company_notices;
  x jsonb := '{}'::jsonb;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  perform private.notice_check_scope(v_role, me.id, v_type, v_depts, v_emps);   -- refuses anyone who may not publish
  if v_key is null or length(v_key) not between 8 and 80 then
    raise exception 'VALIDATION_ERROR: Invalid request id.' using errcode = '22023';
  end if;
  -- the same form sent twice: the first notice, nothing new
  select * into n from public.company_notices where publisher_id = me.id and client_request_id = v_key;
  if n.id is not null then
    return private.notice_json(n, true) || jsonb_build_object('duplicate', true);
  end if;
  select coalesce(array_agg(distinct rl), '{}') into v_roles from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) rl;
  if length(v_title) not between 3 and 200 then raise exception 'VALIDATION_ERROR: Give the notice a title (3-200 characters).' using errcode = '22023'; end if;
  if length(v_body) not between 1 and 10000 then raise exception 'VALIDATION_ERROR: Write the notice (up to 10000 characters).' using errcode = '22023'; end if;
  if v_cat not in ('GENERAL', 'HR', 'POLICY', 'EVENT', 'HOLIDAY', 'IT_SYSTEM', 'OPERATIONS', 'OTHER') then raise exception 'VALIDATION_ERROR: Choose a category.' using errcode = '22023'; end if;
  if v_pri not in ('NORMAL', 'IMPORTANT', 'URGENT') then raise exception 'VALIDATION_ERROR: Choose Normal, Important or Urgent.' using errcode = '22023'; end if;
  if v_type not in ('COMPANY', 'DEPARTMENT', 'ROLE', 'EMPLOYEES') then raise exception 'VALIDATION_ERROR: Choose who receives the notice.' using errcode = '22023'; end if;
  if v_type = 'DEPARTMENT' and cardinality(v_depts) = 0 then raise exception 'VALIDATION_ERROR: Choose at least one department.' using errcode = '22023'; end if;
  if v_type = 'ROLE' and (cardinality(v_roles) = 0 or not (v_roles <@ array['DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER', 'HR', 'SUPER_ADMIN'])) then
    raise exception 'VALIDATION_ERROR: Choose at least one designation.' using errcode = '22023';
  end if;
  if v_type = 'EMPLOYEES' and cardinality(v_emps) = 0 then raise exception 'VALIDATION_ERROR: Choose at least one employee.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_depts) d where not exists (select 1 from public.departments x where x.id = d)) then
    raise exception 'VALIDATION_ERROR: Choose the departments from the list.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_emps) e where not exists (select 1 from public.profiles x where x.id = e and x.status = 'ACTIVE')) then
    raise exception 'VALIDATION_ERROR: Choose the employees from the list.' using errcode = '22023';
  end if;
  if v_publish < now() - interval '5 minutes' or v_publish > now() + interval '366 days' then
    raise exception 'VALIDATION_ERROR: The publish date is now or within a year.' using errcode = '22023';
  end if;
  if v_expires is not null and v_expires <= greatest(v_publish, now()) then
    raise exception 'VALIDATION_ERROR: The expiry is after the publish date.' using errcode = '22023';
  end if;
  if cardinality(v_files) > 5 then raise exception 'VALIDATION_ERROR: Attach at most 5 files.' using errcode = '22023'; end if;
  if cardinality(v_files) > 0 then
    select count(*) into v_n from public.employee_issue_attachments a
     where a.id = any (v_files) and a.uploader_id = me.id and a.status = 'READY' and a.issue_id is null and a.bug_id is null and a.notice_id is null;
    if v_n <> cardinality(v_files) then
      raise exception 'VALIDATION_ERROR: One of the files is not available any more. Please attach it again.' using errcode = '22023';
    end if;
  end if;
  if not exists (select 1 from private.notice_audience(v_type, v_depts, v_roles, v_emps, me.id)) then
    raise exception 'VALIDATION_ERROR: Nobody is in this audience. Choose other departments, designations or employees.' using errcode = '22023';
  end if;

  insert into public.company_notices (reference, title, body, category, priority, audience_type, audience_departments, audience_roles, audience_employees,
                                      publisher_id, publisher_role, publish_at, expires_at, client_request_id)
  values ('NTC-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.company_notice_ref_seq')::text, 5, '0'),
          v_title, v_body, v_cat, v_pri, v_type,
          case when v_type in ('DEPARTMENT', 'ROLE') then v_depts else '{}' end, case when v_type = 'ROLE' then v_roles else '{}' end,
          case when v_type = 'EMPLOYEES' then v_emps else '{}' end,
          me.id, v_role, greatest(v_publish, now()), v_expires, v_key)
  on conflict (publisher_id, client_request_id) do nothing
  returning * into n;
  if n.id is null then
    select * into n from public.company_notices where publisher_id = me.id and client_request_id = v_key;
    return private.notice_json(n, true) || jsonb_build_object('duplicate', true);
  end if;
  if cardinality(v_files) > 0 then
    update public.employee_issue_attachments set notice_id = n.id where id = any (v_files);
  end if;
  insert into public.company_notice_revisions (notice_id, version, action, edited_by, after)
  values (n.id, 1, 'PUBLISHED', me.id, jsonb_build_object('title', n.title, 'body', n.body, 'category', n.category, 'priority', n.priority, 'expiresAt', n.expires_at,
          'audience', n.audience_type));
  perform private.write_audit('COMPANY_NOTICE_PUBLISHED', 'company_notice', n.id, me.department_id, me.team_id,
    jsonb_build_object('reference', n.reference, 'audience', n.audience_type, 'role', v_role, 'priority', n.priority, 'publishAt', n.publish_at));
  if n.publish_at <= now() then
    x := private.notice_release(n.id, coalesce((p ->> 'push')::boolean, true));
    select * into n from public.company_notices where id = n.id;
  end if;
  return private.notice_json(n, true) || jsonb_build_object('duplicate', false, 'deliveryIds', coalesce(x -> 'ids', '[]'::jsonb), 'notified', coalesce((x ->> 'notified')::integer, 0));
end $$;

-- edit the text, category, priority or expiry (the audience stays: the read receipts keep their meaning); every edit is kept
create or replace function public.notice_update(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.company_notices;
  v_before jsonb;
  v_title text;
  v_body text;
  v_cat text;
  v_pri text;
  v_exp timestamptz;
begin
  select * into n from public.company_notices where id = p_id for update;
  if n.id is null or not (n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0002';
  end if;
  if private.notice_publisher_role() is null then
    raise exception 'FORBIDDEN: Only publishers edit notices.' using errcode = '42501';
  end if;
  if n.status = 'ARCHIVED' then
    raise exception 'CONFLICT: An archived notice cannot be edited.' using errcode = 'P0001';
  end if;
  if (p ->> 'version') is not null and (p ->> 'version')::integer <> n.version then
    raise exception 'CONFLICT: Someone else changed this notice. Reload it and edit again.' using errcode = 'P0001';
  end if;
  v_title := btrim(coalesce(p ->> 'title', n.title));
  v_body := btrim(coalesce(p ->> 'body', n.body));
  v_cat := coalesce(nullif(p ->> 'category', ''), n.category);
  v_pri := coalesce(nullif(p ->> 'priority', ''), n.priority);
  v_exp := case when p ? 'expiresAt' then nullif(p ->> 'expiresAt', '')::timestamptz else n.expires_at end;
  if length(v_title) not between 3 and 200 then raise exception 'VALIDATION_ERROR: Give the notice a title (3-200 characters).' using errcode = '22023'; end if;
  if length(v_body) not between 1 and 10000 then raise exception 'VALIDATION_ERROR: Write the notice (up to 10000 characters).' using errcode = '22023'; end if;
  if v_cat not in ('GENERAL', 'HR', 'POLICY', 'EVENT', 'HOLIDAY', 'IT_SYSTEM', 'OPERATIONS', 'OTHER') then raise exception 'VALIDATION_ERROR: Choose a category.' using errcode = '22023'; end if;
  if v_pri not in ('NORMAL', 'IMPORTANT', 'URGENT') then raise exception 'VALIDATION_ERROR: Choose Normal, Important or Urgent.' using errcode = '22023'; end if;
  if v_exp is not null and v_exp <= n.publish_at then raise exception 'VALIDATION_ERROR: The expiry is after the publish date.' using errcode = '22023'; end if;
  if v_title = n.title and v_body = n.body and v_cat = n.category and v_pri = n.priority and v_exp is not distinct from n.expires_at then
    return private.notice_json(n, true);
  end if;
  v_before := jsonb_build_object('title', n.title, 'body', n.body, 'category', n.category, 'priority', n.priority, 'expiresAt', n.expires_at);
  update public.company_notices set title = v_title, body = v_body, category = v_cat, priority = v_pri, expires_at = v_exp, version = version + 1
   where id = n.id returning * into n;
  insert into public.company_notice_revisions (notice_id, version, action, edited_by, before, after)
  values (n.id, n.version, 'EDITED', auth.uid(), v_before,
          jsonb_build_object('title', n.title, 'body', n.body, 'category', n.category, 'priority', n.priority, 'expiresAt', n.expires_at));
  perform private.write_audit('COMPANY_NOTICE_EDITED', 'company_notice', n.id, null, null, jsonb_build_object('reference', n.reference, 'version', n.version));
  return private.notice_json(n, true);
end $$;

create or replace function public.notice_archive(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.company_notices;
begin
  select * into n from public.company_notices where id = p_id for update;
  if n.id is null or not (n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0002';
  end if;
  if private.notice_publisher_role() is null then
    raise exception 'FORBIDDEN: Only publishers archive notices.' using errcode = '42501';
  end if;
  if n.status = 'ARCHIVED' then
    return private.notice_json(n, true);
  end if;
  update public.company_notices set status = 'ARCHIVED', archived_at = now(), archived_by = auth.uid(), version = version + 1 where id = n.id returning * into n;
  insert into public.company_notice_revisions (notice_id, version, action, edited_by, before, after)
  values (n.id, n.version, 'ARCHIVED', auth.uid(), null, jsonb_build_object('status', 'ARCHIVED'));
  -- a scheduled notice that never went out stays unseen; deliveries still waiting are cancelled
  update public.notification_deliveries set status = 'CANCELLED', last_error = 'NOTICE_ARCHIVED', finished_at = now(), updated_at = now()
   where kind = 'COMPANY_NOTICE' and tag = 'notice-' || n.id and status in ('PENDING', 'RETRY_PENDING');
  perform private.write_audit('COMPANY_NOTICE_ARCHIVED', 'company_notice', n.id, null, null, jsonb_build_object('reference', n.reference));
  return private.notice_json(n, true);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Files: publishers upload (the Super Admin included); recipients and publishers download (20270128000200 + notices)
-- ---------------------------------------------------------------------------
create or replace function public.issue_begin_upload(p_file_name text, p_mime text, p_size bigint)
returns public.employee_issue_attachments language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  r public.employee_issue_attachments;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  -- employees (their issues and bugs), and notice publishers (the Super Admin included) for a notice's files
  if me.id is null or (me.role not in ('TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD') and private.notice_publisher_role(me.id) is null) then
    raise exception 'FORBIDDEN: Only a Team Member, Team Lead or Department Head can raise an issue or ask for a meeting.' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: The file needs a name (up to 200 characters).' using errcode = 'P0001';
  end if;
  if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'VALIDATION_ERROR: This file type cannot be attached. Use an image, PDF, text, CSV, Word or Excel file.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.employee_issue_attachments set status = 'FAILED' where uploader_id = me.id and status = 'PENDING' and created_at < now() - interval '1 day';
  if (select count(*) from public.employee_issue_attachments a where a.uploader_id = me.id and a.status = 'PENDING' and a.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many uploads in progress. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  insert into public.employee_issue_attachments (id, uploader_id, file_name, mime_type, size_bytes, storage_path)
  values (v_id, me.id, v_name, p_mime, p_size, format('%s/%s/%s', me.id, v_id, private.chat_clean_name(v_name)))
  returning * into r;
  return r;
end $$;

-- an issue never takes a file that belongs to a notice (20270122000300 + notice_id)
create or replace function private.issue_attach(p_issue uuid, p_event bigint, p_attachments uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := coalesce(p_attachments, '{}'::uuid[]);
  v_n integer;
begin
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(v_ids, 1) > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files at a time.' using errcode = 'P0001';
  end if;
  select count(distinct a.id) into v_n from public.employee_issue_attachments a
   where a.id = any (v_ids) and a.uploader_id = auth.uid() and a.status = 'READY' and a.issue_id is null and a.bug_id is null and a.notice_id is null;
  if v_n <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'VALIDATION_ERROR: One of the files is not available any more. Please attach it again.' using errcode = 'P0001';
  end if;
  update public.employee_issue_attachments set issue_id = p_issue, event_id = p_event where id = any (v_ids);
  return v_n;
end $$;

create or replace function public.issue_attachment_download(p_attachment uuid)
returns public.employee_issue_attachments language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issue_attachments;
  i public.employee_issues;
  b public.dev_bugs;
  n public.company_notices;
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into r from public.employee_issue_attachments a where a.id = p_attachment and a.status = 'READY';
  if r.id is null then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  -- a notice's file: whoever may read the notice
  if r.notice_id is not null then
    select * into n from public.company_notices where id = r.notice_id;
    if n.id is null or not private.notice_visible(n) then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
    perform private.write_audit('COMPANY_NOTICE_ATTACHMENT_DOWNLOADED', 'company_notice', n.id, null, null, jsonb_build_object('attachment_id', r.id, 'reference', n.reference));
    return r;
  end if;
  if r.bug_id is not null then
    select * into b from public.dev_bugs where id = r.bug_id;
    if not private.bug_visible(b.reporter_id, b.assigned_to) then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
    perform private.write_audit('DEV_BUG_ATTACHMENT_DOWNLOADED', 'dev_bug', b.id, null, null, jsonb_build_object('attachment_id', r.id, 'reference', b.reference));
    return r;
  end if;
  if r.issue_id is null then
    if r.uploader_id <> auth.uid() then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
    return r;
  end if;
  select * into i from public.employee_issues where id = r.issue_id;
  if i.employee_id = auth.uid() or (private.is_hr_staff() and i.employee_id <> auth.uid()) then
    perform private.write_audit('EMPLOYEE_ISSUE_ATTACHMENT_DOWNLOADED', 'employee_issue', i.id, i.department_id, null,
      jsonb_build_object('attachment_id', r.id, 'reference', i.issue_reference));
    return r;
  end if;
  select * into b from public.dev_bugs where source_issue_id = i.id;
  if b.id is not null and private.bug_team_visible(b.assigned_to) then
    perform private.write_audit('DEV_BUG_ATTACHMENT_DOWNLOADED', 'dev_bug', b.id, null, null,
      jsonb_build_object('attachment_id', r.id, 'reference', b.reference, 'issue', i.issue_reference));
    return r;
  end if;
  raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.notice_publisher_role(uuid)', 'private.notice_oh_departments(uuid)',
    'private.notice_audience(text, uuid[], text[], uuid[], uuid)', 'private.notice_check_scope(text, uuid, text, uuid[], uuid[])',
    'private.notice_visible(public.company_notices)', 'private.notice_json(public.company_notices, boolean)', 'private.notice_release(uuid, boolean)',
    'private.notice_uuid_array(jsonb)', 'private.tg_company_notice_revisions_append_only()', 'private.issue_attach(uuid, bigint, uuid[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.notice_list(text, text, text, timestamptz, timestamptz, boolean, text, boolean, integer, integer)',
    'public.notice_unread_count()', 'public.notice_open(uuid)', 'public.notice_receipts(uuid)', 'public.notice_audience_options()',
    'public.notice_publish(jsonb)', 'public.notice_update(uuid, jsonb)', 'public.notice_archive(uuid)',
    'public.issue_begin_upload(text, text, bigint)', 'public.issue_attachment_download(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public.notice_release_due(timestamptz, boolean) from public, anon, authenticated';
  execute 'grant execute on function public.notice_release_due(timestamptz, boolean) to service_role';
end $$;
