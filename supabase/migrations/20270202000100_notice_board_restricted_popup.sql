-- =============================================================================
-- Notice Board: managed by a named few, a company-wide popup until acknowledged (docs/NOTICE_BOARD.md)
-- =============================================================================
-- Builds on 20270131000200_company_notice_board.sql (the Notice Board that already exists: notices, recipients, read receipts, revisions, files, the bell and the push
-- outbox). Nothing is rebuilt, no notice, recipient or revision is deleted or rewritten. Additive and safe to run twice.
--
--  WHO MANAGES (publishes, edits, archives, sees the receipts) - decided here, in the database, never only in the screen:
--     * the Super Admin (existing role);
--     * HR (existing rule: the HR department, not recruiters);
--     * the CRM team - Ashish, Shreya and Siddhesh - as NAMED ACCOUNTS: rows of public.notice_board_managers, keyed by profile id. It is seeded once from the Developers
--       team members whose name or sign-in email match them (a same-named stranger who is not in the team is not picked); a later approval of one of them is picked
--       up by a trigger; the Super Admin can add or remove a person (notice_manager_set). A name alone never grants anything.
--     NOT any more: the Developers team as such, an Operations Head. A Department Head, Team Lead, Team Member, Business Associate, Technical Consultant, Accounts
--     employee... cannot manage unless they are one of the above. Every employee still READS the notices addressed to them and acknowledges them.
--  ACKNOWLEDGEMENT: company_notice_recipients gets acknowledged_at / acknowledged_version (the same row as the read receipt: no second record). notice_acknowledge is
--     idempotent. Existing read receipts count as acknowledged once, when the column is added (nobody is shown an old notice they already opened).
--  POPUP: notice_pending() is the person's notices that are published, not expired, not archived and not yet acknowledged: Urgent first, then Important, then Normal,
--     oldest first inside a priority. Persistent (a table, not a realtime message): an employee who was offline gets it when they next open the CRM.
--  RE-ACKNOWLEDGEMENT: an edit that sets acknowledgeAgain clears the acknowledgements of that notice and notifies everyone once more (one bell per version). Any other
--     edit leaves every acknowledgement alone.
--  The managers see, for every company-wide notice, targeted / read / acknowledged counts and percentages and each employee's read and acknowledgement time.
-- Needs 20270131000200_company_notice_board.sql (and, for the seed, 20270122000300_developer_bugs.sql).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The managers (stable profile ids) and the acknowledgement columns
-- ---------------------------------------------------------------------------
create table if not exists public.notice_board_managers (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.notice_board_managers enable row level security;
revoke all on public.notice_board_managers from public, anon, authenticated;

alter table public.company_notices drop constraint if exists company_notices_publisher_role_check;
alter table public.company_notices add constraint company_notices_publisher_role_check
  check (publisher_role in ('SUPER_ADMIN', 'OPERATIONS_HEAD', 'HR', 'DEVELOPER', 'CRM_TEAM'));

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_notice_recipients' and column_name = 'acknowledged_at') then
    alter table public.company_notice_recipients add column acknowledged_at timestamptz;
    alter table public.company_notice_recipients add column acknowledged_version integer;
    -- once: a notice the person already opened counts as acknowledged (at the time they opened it)
    update public.company_notice_recipients r set acknowledged_at = r.read_at, acknowledged_version = n.version
      from public.company_notices n where n.id = r.notice_id and r.read_at is not null;
  end if;
end $$;
create index if not exists company_notice_recipients_pending_idx on public.company_notice_recipients (profile_id) where acknowledged_at is null;

-- which of the three a name means, spelled the way the Developers team was seeded (20270122000400): first name starting shreya / ashish / sid, last name mande / sinha / shinde
create or replace function private.notice_crm_name(p_name text)
returns text language sql immutable set search_path = '' as $$
  select case
    when w.f like 'shreya%' and w.l = 'mande' then 'shreya'
    when w.f like 'ashish%' and w.l = 'sinha' then 'ashish'
    when w.f like 'sid%' and w.l = 'shinde' then 'siddhesh'
  end
  from (select lower(split_part(btrim(coalesce(p_name, '')), ' ', 1)) as f, lower(regexp_replace(btrim(coalesce(p_name, '')), '^.*\s', '')) as l) w
$$;
revoke all on function private.notice_crm_name(text) from public, anon, authenticated;

-- the CRM team: the Developers team members who are Shreya Mande, Ashish Sinha or Siddhesh Shinde (by name or by sign-in email)
create or replace function private.notice_manager_sync(p_profile uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
begin
  if to_regclass('public.dev_team_members') is null then
    return 0;
  end if;
  with found as (
    select p.id from public.profiles p
     where (p_profile is null or p.id = p_profile) and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
       and exists (select 1 from public.dev_team_members d where d.profile_id = p.id)
       and (private.notice_crm_name(p.full_name) is not null
            or lower(btrim(coalesce(p.email, ''))) = 'siddhesh.amuwa@gmail.com'
            or exists (select 1 from auth.users u where u.id = p.id and lower(btrim(coalesce(u.email, ''))) = 'siddhesh.amuwa@gmail.com'))
  ), added as (
    insert into public.notice_board_managers (profile_id) select id from found on conflict (profile_id) do nothing returning 1)
  select count(*) into v_n from added;
  return v_n;
end $$;
revoke all on function private.notice_manager_sync(uuid) from public, anon, authenticated;

-- an account of the CRM team approved or created later is picked up once (a Super Admin's removal is not undone by a later profile edit)
create or replace function private.tg_notice_manager_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ACTIVE' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.notice_manager_sync(new.id);
  end if;
  return null;
end $$;
revoke all on function private.tg_notice_manager_sync() from public, anon, authenticated;
drop trigger if exists profiles_notice_manager_sync on public.profiles;
create trigger profiles_notice_manager_sync after insert or update of status on public.profiles for each row execute function private.tg_notice_manager_sync();

do $$
declare
  v_name text;
begin
  perform private.notice_manager_sync();
  -- say which of the three has no account yet (nothing is guessed: the Super Admin adds them in the Notice Board when their account exists)
  foreach v_name in array array['shreya', 'ashish', 'siddhesh'] loop
    if not exists (select 1 from public.notice_board_managers m join public.profiles p on p.id = m.profile_id
                    where private.notice_crm_name(p.full_name) = v_name
                       or (v_name = 'siddhesh' and lower(btrim(coalesce(p.email, ''))) = 'siddhesh.amuwa@gmail.com')) then
      raise notice 'NOTICE BOARD: % is not a notice manager yet (no active Developers-team account with that name was found). The Super Admin can add them in Notice Board > Managers.', v_name;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Who manages (replaces the definitions of 20270131000200; copies changed where marked 20270202000100)
-- ---------------------------------------------------------------------------
create or replace function private.notice_publisher_role(p_profile uuid default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.id is null then null
    when p.role = 'SUPER_ADMIN' then 'SUPER_ADMIN'
    when exists (select 1 from public.departments d where d.id = p.department_id and d.slug = 'hr') and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER' then 'HR'
    -- the CRM team (Ashish, Shreya, Siddhesh): named accounts in notice_board_managers, by profile id - never by name, never by role alone
    when exists (select 1 from public.notice_board_managers m where m.profile_id = p.id) then 'CRM_TEAM'
  end
  from (select * from public.profiles where id = coalesce(p_profile, auth.uid()) and status = 'ACTIVE') p
  right join (select 1) one on true
$$;

create or replace function private.notice_check_scope(p_role text, p_profile uuid, p_type text, p_departments uuid[], p_employees uuid[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  -- (20270202000100) publishing is the Super Admin, HR and the named CRM team only; every one of them may address any audience
  if p_role is null then
    raise exception 'FORBIDDEN: Only the Super Admin, HR and the CRM team publish notices.' using errcode = '42501';
  end if;
end $$;

create or replace function public.notice_audience_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.notice_publisher_role();
begin
  if v_role is null then
    return jsonb_build_object('canPublish', false, 'role', null, 'audiences', '[]'::jsonb, 'departments', '[]'::jsonb, 'roles', '[]'::jsonb, 'employees', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'canPublish', true, 'role', v_role,
    'audiences', '["COMPANY","DEPARTMENT","ROLE","EMPLOYEES"]'::jsonb,
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d
                               ), '[]'::jsonb),
    'roles', '[{"id":"DEPARTMENT_HEAD","label":"Department Heads"},{"id":"OPERATIONS_HEAD","label":"Operations Heads"},{"id":"TEAM_HEAD","label":"Team Leads"},{"id":"TEAM_MEMBER","label":"Team Members"},{"id":"HR","label":"HR"},{"id":"SUPER_ADMIN","label":"Super Admin"}]'::jsonb,
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role,
                     'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
                     'departmentId', private.base_department(p.department_id)) order by p.full_name)
                   from public.profiles p where p.status = 'ACTIVE' and p.id <> auth.uid()
                   ), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 3. What a notice shows: the person's own acknowledgement, the managers' counts
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
    -- (20270202000100) the acknowledgement of the person looking, and (managers only) the counts
    'acknowledged', coalesce((select r.acknowledged_at is not null from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()), true),
    'acknowledgedAt', (select r.acknowledged_at from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()),
    'isRecipient', exists (select 1 from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()),
    'read', coalesce((select r.read_at is not null from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()), true),
    'readAt', (select r.read_at from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()),
    'canManage', n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false),
    'recipientCount', case when private.notice_publisher_role() is null then 0 else (select count(*) from public.company_notice_recipients r where r.notice_id = n.id) end,
    'readCount', case when private.notice_publisher_role() is null then 0 else (select count(*) from public.company_notice_recipients r where r.notice_id = n.id and r.read_at is not null) end,
    'acknowledgedCount', case when private.notice_publisher_role() is null then 0 else (select count(*) from public.company_notice_recipients r where r.notice_id = n.id and r.acknowledged_at is not null) end,
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime_type, 'size', a.size_bytes) order by a.created_at)
                    from public.employee_issue_attachments a where a.notice_id = n.id and a.status = 'READY'), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 4. Releasing a notice: one bell per person, retry-safe (copy of the 20270131000200 definition; changed where marked 20270202000100)
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
           -- (20270202000100) title, priority, publisher and time; the data lets the screen open the notice and keeps a retry from notifying twice
           'A new ' || case n.priority when 'URGENT' then 'URGENT ' when 'IMPORTANT' then 'important ' else '' end || 'notice has been published by ' || coalesce(v_by, 'the company')
             || ' on ' || to_char(coalesce(n.released_at, now()) at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') || '. Open it to read and acknowledge.',
           'company_notice', n.id, n.publisher_id, jsonb_build_object('noticeId', n.id, 'priority', n.priority, 'publisher', v_by, 'publishedAt', now(), 'dedupeKey', 'NOTICE|' || n.id),
           case when n.priority = 'URGENT' then 'urgent' else 'normal' end
      from fresh f
    on conflict (recipient_id, (data ->> 'dedupeKey')) where data ? 'dedupeKey' do nothing
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

-- ---------------------------------------------------------------------------
-- 5. The popup queue and the acknowledgement
-- ---------------------------------------------------------------------------
-- the notices this person must still acknowledge: published, not expired, not archived. Urgent first, then Important, then Normal; the oldest first inside a priority.
-- The whole text and the files come with it (a persistent read, so an employee who was offline sees it when they next open the CRM).
create or replace function public.notice_pending()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pending', (select count(*) from public.company_notice_recipients r join public.company_notices n on n.id = r.notice_id
                 where r.profile_id = me and r.acknowledged_at is null and n.status = 'PUBLISHED' and (n.expires_at is null or n.expires_at > now())),
    'items', coalesce((select jsonb_agg(private.notice_json(x, true) order by case x.priority when 'URGENT' then 0 when 'IMPORTANT' then 1 else 2 end, x.publish_at, x.id)
                         from (select n.* from public.company_notice_recipients r join public.company_notices n on n.id = r.notice_id
                                where r.profile_id = me and r.acknowledged_at is null and n.status = 'PUBLISHED' and (n.expires_at is null or n.expires_at > now())
                                order by case n.priority when 'URGENT' then 0 when 'IMPORTANT' then 1 else 2 end, n.publish_at, n.id limit 30) x), '[]'::jsonb));
end $$;

-- "Acknowledge" / "Mark as read": the person's own row only, once (a second call changes nothing). It also marks the notice read and the bell's notification read.
create or replace function public.notice_acknowledge(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n public.company_notices;
  r public.company_notice_recipients;
begin
  if me is null or not exists (select 1 from public.profiles where id = me and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into n from public.company_notices where id = p_id;
  select * into r from public.company_notice_recipients where notice_id = p_id and profile_id = me;
  if n.id is null or r.profile_id is null or n.status = 'SCHEDULED' then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0002';
  end if;
  update public.company_notice_recipients set read_at = coalesce(read_at, now()), acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_version = coalesce(acknowledged_version, n.version)
   where notice_id = n.id and profile_id = me;
  update public.notifications set read_at = now() where recipient_id = me and entity_type = 'company_notice' and entity_id = n.id and read_at is null;
  return jsonb_build_object('noticeId', n.id, 'acknowledged', true,
    'acknowledgedAt', (select acknowledged_at from public.company_notice_recipients where notice_id = n.id and profile_id = me),
    'pending', (select count(*) from public.company_notice_recipients x join public.company_notices y on y.id = x.notice_id
                 where x.profile_id = me and x.acknowledged_at is null and y.status = 'PUBLISHED' and (y.expires_at is null or y.expires_at > now())));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Receipts with acknowledgement, and edits that can ask for a new acknowledgement
-- ---------------------------------------------------------------------------
create or replace function public.notice_receipts(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  n public.company_notices;
begin
  select * into n from public.company_notices where id = p_id;
  -- (20270202000100) the notice managers (Super Admin, HR, CRM team) see the receipts of every company-wide notice, and of their own
  if n.id is null or not (n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)
                          or (private.notice_publisher_role() is not null and n.audience_type <> 'EMPLOYEES')) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'noticeId', n.id, 'status', n.status,
    'total', (select count(*) from public.company_notice_recipients where notice_id = n.id),
    'read', (select count(*) from public.company_notice_recipients where notice_id = n.id and read_at is not null),
    'unread', (select count(*) from public.company_notice_recipients where notice_id = n.id and read_at is null),
    'acknowledged', (select count(*) from public.company_notice_recipients where notice_id = n.id and acknowledged_at is not null),
    'notAcknowledged', (select count(*) from public.company_notice_recipients where notice_id = n.id and acknowledged_at is null),
    'readPercent', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where read_at is not null) / count(*), 1) end from public.company_notice_recipients where notice_id = n.id),
    'acknowledgedPercent', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where acknowledged_at is not null) / count(*), 1) end from public.company_notice_recipients where notice_id = n.id),
    'version', n.version,
    'push', (select jsonb_build_object('devices', count(*), 'accepted', count(*) filter (where status = 'ACCEPTED_BY_PUSH_SERVICE'),
               'pending', count(*) filter (where status in ('PENDING', 'PROCESSING', 'RETRY_PENDING')), 'failed', count(*) filter (where status in ('FAILED', 'EXPIRED')),
               'cancelled', count(*) filter (where status = 'CANCELLED'))
             from public.notification_deliveries where kind = 'COMPANY_NOTICE' and tag = 'notice-' || n.id),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('profileId', p.id, 'name', p.full_name,
               'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
               'notifiedAt', r.notified_at, 'readAt', r.read_at, 'acknowledgedAt', r.acknowledged_at, 'acknowledgedVersion', r.acknowledged_version)
               order by r.acknowledged_at nulls first, p.full_name)
             from public.company_notice_recipients r join public.profiles p on p.id = r.profile_id where r.notice_id = n.id), '[]'::jsonb));
end $$;

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
  v_again boolean := coalesce((p ->> 'acknowledgeAgain')::boolean, false);
  v_by text;
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
  if v_title = n.title and v_body = n.body and v_cat = n.category and v_pri = n.priority and v_exp is not distinct from n.expires_at and not v_again then
    return private.notice_json(n, true);
  end if;
  v_before := jsonb_build_object('title', n.title, 'body', n.body, 'category', n.category, 'priority', n.priority, 'expiresAt', n.expires_at);
  update public.company_notices set title = v_title, body = v_body, category = v_cat, priority = v_pri, expires_at = v_exp, version = version + 1
   where id = n.id returning * into n;
  insert into public.company_notice_revisions (notice_id, version, action, edited_by, before, after)
  values (n.id, n.version, 'EDITED', auth.uid(), v_before,
          jsonb_build_object('title', n.title, 'body', n.body, 'category', n.category, 'priority', n.priority, 'expiresAt', n.expires_at));
  -- (20270202000100) a material change: the publisher asks that everyone acknowledges the new version. Their acknowledgement is cleared, they are told again (once per
  -- version) and the notice comes up in their popup. A minor edit (a typo, an expiry) leaves every acknowledgement as it was.
  if v_again and n.status = 'PUBLISHED' then
    v_by := (select full_name from public.profiles where id = auth.uid());
    update public.company_notice_recipients set acknowledged_at = null, acknowledged_version = null where notice_id = n.id;
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
    select r.profile_id, 'COMPANY_NOTICE', 'Updated Company Notice: ' || left(n.title, 150),
           'This ' || case n.priority when 'URGENT' then 'URGENT ' when 'IMPORTANT' then 'important ' else '' end || 'notice was changed by ' || coalesce(v_by, 'the company')
             || ' on ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') || '. Please read it again and acknowledge.',
           'company_notice', n.id, auth.uid(), jsonb_build_object('noticeId', n.id, 'priority', n.priority, 'publisher', v_by, 'version', n.version, 'dedupeKey', 'NOTICEV|' || n.id || '|' || n.version),
           case when n.priority = 'URGENT' then 'urgent' else 'normal' end
      from public.company_notice_recipients r where r.notice_id = n.id
    on conflict (recipient_id, (data ->> 'dedupeKey')) where data ? 'dedupeKey' do nothing;
  end if;
  perform private.write_audit('COMPANY_NOTICE_EDITED', 'company_notice', n.id, null, null, jsonb_build_object('reference', n.reference, 'version', n.version, 'acknowledgeAgain', v_again));
  return private.notice_json(n, true);
end $$;

-- ---------------------------------------------------------------------------
-- 7. The Super Admin manages the CRM team's access (by profile id; audited)
-- ---------------------------------------------------------------------------
create or replace function public.notice_managers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(private.notice_publisher_role() <> 'SUPER_ADMIN', true) then
    raise exception 'FORBIDDEN: Only the Super Admin manages who runs the Notice Board.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'managers', coalesce((select jsonb_agg(jsonb_build_object('profileId', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status,
                    'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)), 'since', m.created_at) order by p.full_name)
                  from public.notice_board_managers m join public.profiles p on p.id = m.profile_id), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('profileId', p.id, 'name', p.full_name, 'role', p.role,
                    'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id))) order by p.full_name)
                  from public.profiles p where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
                   and not exists (select 1 from public.notice_board_managers m where m.profile_id = p.id)), '[]'::jsonb));
end $$;

create or replace function public.notice_manager_set(p_profile uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  if coalesce(private.notice_publisher_role() <> 'SUPER_ADMIN', true) then
    raise exception 'FORBIDDEN: Only the Super Admin manages who runs the Notice Board.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = p_profile;
  if p.id is null then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0002';
  end if;
  if p_enabled then
    if p.status <> 'ACTIVE' then
      raise exception 'VALIDATION_ERROR: Only an active employee can run the Notice Board.' using errcode = '22023';
    end if;
    insert into public.notice_board_managers (profile_id, added_by) values (p.id, auth.uid()) on conflict (profile_id) do nothing;
  else
    delete from public.notice_board_managers where profile_id = p.id;
  end if;
  perform private.write_audit(case when p_enabled then 'NOTICE_MANAGER_ADDED' else 'NOTICE_MANAGER_REMOVED' end, 'profile', p.id, p.department_id, p.team_id,
    jsonb_build_object('name', p.full_name));
  return jsonb_build_object('profileId', p.id, 'manager', p_enabled);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.notice_publisher_role(uuid)', 'private.notice_check_scope(text, uuid, text, uuid[], uuid[])',
    'private.notice_json(public.company_notices, boolean)', 'private.notice_release(uuid, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.notice_pending()', 'public.notice_acknowledge(uuid)', 'public.notice_managers()', 'public.notice_manager_set(uuid, boolean)',
    'public.notice_receipts(uuid)', 'public.notice_audience_options()', 'public.notice_update(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
notify pgrst, 'reload schema';
