-- =============================================================================
-- Notice Board: delete a notice (a safe "soft" delete). Run after 20270204000100_crocodial_scoped_refresh.sql. Safe to run twice.
--
-- A deleted notice vanishes from everything a person sees: the Notice Board lists, the unread badge, the popup queue, its files, and nobody can open, edit,
-- archive or acknowledge it. NOTHING IS PHYSICALLY REMOVED: the row stays with status DELETED (who and when), with its recipients, read and acknowledgement
-- receipts, every revision, the bell notifications (marked read, so no one is pointed at a notice that is gone) and the audit log. That keeps the history a
-- compliance question may need, and means no cascade touches any other record.
--
-- WHO. Exactly who may already archive: the publisher of the notice (while they still manage notices) and the Super Admin. HR and the CRM team can delete
-- their own notices only, like editing; everybody else is refused (42501 / NOT_FOUND). No permission is added.
--
-- HOW. status gets a fourth value, DELETED, so every place that reads "status = 'PUBLISHED'" (lists, badge, popup queue, acknowledgement counts) already
-- leaves a deleted notice out. The few places that did not look at the status are changed below: notice_visible (so notice_open and the file download say "not
-- found"), the "my published notices" list, notice_receipts and notice_acknowledge. A deleted notice is final: a trigger refuses any later change to it, so
-- notice_update, notice_archive and a release of a scheduled notice cannot bring it back.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns and the new status / revision action
-- ---------------------------------------------------------------------------
alter table public.company_notices add column if not exists deleted_at timestamptz;
alter table public.company_notices add column if not exists deleted_by uuid references public.profiles (id) on delete set null;

alter table public.company_notices drop constraint if exists company_notices_status_check;
alter table public.company_notices add constraint company_notices_status_check check (status in ('SCHEDULED', 'PUBLISHED', 'ARCHIVED', 'DELETED'));
alter table public.company_notice_revisions drop constraint if exists company_notice_revisions_action_check;
alter table public.company_notice_revisions add constraint company_notice_revisions_action_check check (action in ('PUBLISHED', 'EDITED', 'ARCHIVED', 'DELETED'));

-- a deleted notice is final
create or replace function private.tg_company_notices_deleted_final()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'DELETED' then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0002';
  end if;
  return new;
end $$;
revoke all on function private.tg_company_notices_deleted_final() from public, anon, authenticated;
drop trigger if exists company_notices_deleted_final on public.company_notices;
create trigger company_notices_deleted_final before update on public.company_notices for each row execute function private.tg_company_notices_deleted_final();

-- ---------------------------------------------------------------------------
-- 2. Nobody can read a deleted notice (opening it, its files)
-- ---------------------------------------------------------------------------
create or replace function private.notice_visible(n public.company_notices)
returns boolean language sql stable security definer set search_path = '' as $$
  -- strictly true or false (a NULL here must never let anyone through)
  select coalesce(auth.uid() is not null and n.status <> 'DELETED' and (
    n.publisher_id = auth.uid()
    or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)
    or (n.status <> 'SCHEDULED' and exists (select 1 from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()))
    -- the other publishers see the company's notices (not one addressed to selected employees only)
    or (n.status <> 'SCHEDULED' and n.audience_type <> 'EMPLOYEES' and private.notice_publisher_role() is not null)), false)
$$;

-- ---------------------------------------------------------------------------
-- 3. The lists: "my published notices" (the only one that did not filter on the status) leaves deleted ones out
--    (a copy of public.notice_list from 20270131000200 with one added condition, marked 20270205000100)
-- ---------------------------------------------------------------------------
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
               -- (20270205000100) a deleted notice is not listed
               else n.status <> 'DELETED' and (n.publisher_id = me or coalesce(v_role = 'SUPER_ADMIN', false)) end
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

-- ---------------------------------------------------------------------------
-- 4. Receipts and acknowledgement of a deleted notice: "not found"
--    (copies of the latest definitions from 20270202000100 with the status check added, marked 20270205000100)
-- ---------------------------------------------------------------------------
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
  -- (20270205000100) a deleted notice cannot be acknowledged
  if n.id is null or r.profile_id is null or n.status in ('SCHEDULED', 'DELETED') then
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

create or replace function public.notice_receipts(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  n public.company_notices;
begin
  select * into n from public.company_notices where id = p_id;
  -- (20270202000100) the notice managers (Super Admin, HR, CRM team) see the receipts of every company-wide notice, and of their own
  -- (20270205000100) a deleted notice is not found
  if n.id is null or n.status = 'DELETED' or not (n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)
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

-- ---------------------------------------------------------------------------
-- 5. Delete
-- ---------------------------------------------------------------------------
create or replace function public.notice_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.company_notices;
  v_cancelled integer;
  v_bells integer;
begin
  select * into n from public.company_notices where id = p_id for update;
  -- the same rule as archiving: the publisher of the notice, or the Super Admin. Anybody else is told it does not exist.
  if n.id is null or not (n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0002';
  end if;
  -- ... and only while they still manage notices (an Operations Head who published one earlier no longer does)
  if private.notice_publisher_role() is null then
    raise exception 'FORBIDDEN: Only the people who manage notices can delete them.' using errcode = '42501';
  end if;
  -- a second click, or a retry: already done
  if n.status = 'DELETED' then
    return jsonb_build_object('id', n.id, 'deleted', true, 'alreadyDeleted', true);
  end if;
  update public.company_notices set status = 'DELETED', deleted_at = now(), deleted_by = auth.uid(), version = version + 1 where id = n.id;
  insert into public.company_notice_revisions (notice_id, version, action, edited_by, before, after)
  values (n.id, n.version + 1, 'DELETED', auth.uid(),
          jsonb_build_object('title', n.title, 'status', n.status, 'priority', n.priority, 'expiresAt', n.expires_at), jsonb_build_object('status', 'DELETED'));
  -- pushes still waiting never go out; a notice that was never released goes out to nobody
  update public.notification_deliveries set status = 'CANCELLED', last_error = 'NOTICE_DELETED', finished_at = now(), updated_at = now()
   where kind = 'COMPANY_NOTICE' and tag = 'notice-' || n.id and status in ('PENDING', 'RETRY_PENDING');
  get diagnostics v_cancelled = row_count;
  -- the bell's notifications about it stay in each person's history but are read: nobody is pointed at a notice that is gone, and no unread count stays up
  update public.notifications set read_at = now() where entity_type = 'company_notice' and entity_id = n.id and read_at is null;
  get diagnostics v_bells = row_count;
  perform private.write_audit('COMPANY_NOTICE_DELETED', 'company_notice', n.id, null, null,
    jsonb_build_object('reference', n.reference, 'title', n.title, 'statusBefore', n.status, 'recipients', (select count(*) from public.company_notice_recipients where notice_id = n.id),
                       'acknowledged', (select count(*) from public.company_notice_recipients where notice_id = n.id and acknowledged_at is not null),
                       'pushCancelled', v_cancelled, 'bellsMarkedRead', v_bells));
  return jsonb_build_object('id', n.id, 'deleted', true, 'alreadyDeleted', false);
end $$;
revoke all on function public.notice_delete(uuid) from public, anon;
grant execute on function public.notice_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
