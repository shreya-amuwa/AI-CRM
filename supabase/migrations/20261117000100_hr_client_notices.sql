-- =============================================================================
-- Client notices from the HR head reach the clients they choose.
-- The Client Notices page is offered to the Super Admin and to the HR department's head, and says the HR head can pick one
-- department or every client. The database, however, limited every Department Head to their OWN department's clients, and the
-- HR department has no clients: a notice ("office closed", a new service) published by the HR head was saved and the
-- publisher saw "Published", but no client ever saw it.
-- Now the Super Admin and the HR department's head choose the audience (one department, or everyone when left empty); every
-- other Department Head still reaches their own department's clients only. Additive and safe to rerun; nothing is deleted.
-- =============================================================================

create or replace function private.can_notice_all_clients()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD'
          and exists (select 1 from public.departments d where d.id = private.my_department_id() and d.slug = 'hr'))
$$;
revoke all on function private.can_notice_all_clients() from public, anon, authenticated;

create or replace function public.publish_client_announcement(
  p_kind text, p_title text, p_body text default null, p_event_date date default null, p_event_end date default null,
  p_recurrence text default 'NONE', p_notice_days integer default 7, p_service text default null, p_department uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  v_dept uuid;
  v_expires date;
begin
  if v_role is null or v_role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Department Head can publish a notice for clients.' using errcode = '42501';
  end if;
  if p_kind not in ('OFFICE_CLOSED', 'NEW_SERVICE') then
    raise exception 'VALIDATION_ERROR: Choose the type of notice.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_title, ''))) < 3 or length(btrim(p_title)) > 120 then
    raise exception 'VALIDATION_ERROR: Enter a title (3 to 120 characters).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_body, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the message under 1000 characters.' using errcode = 'P0001';
  end if;
  -- a Department Head speaks for their own department only; the Super Admin and the HR head choose a department or everyone
  v_dept := case when private.can_notice_all_clients() then p_department else private.my_department_id() end;
  if p_kind = 'OFFICE_CLOSED' then
    if p_event_date is null then
      raise exception 'VALIDATION_ERROR: Choose the day the office is closed.' using errcode = 'P0001';
    end if;
    if p_event_end is not null and p_event_end < p_event_date then
      raise exception 'VALIDATION_ERROR: The last day cannot be before the first day.' using errcode = 'P0001';
    end if;
    if coalesce(p_recurrence, 'NONE') not in ('NONE', 'MONTHLY') then
      raise exception 'VALIDATION_ERROR: Choose how often it repeats.' using errcode = 'P0001';
    end if;
    if coalesce(p_recurrence, 'NONE') = 'NONE' and coalesce(p_event_end, p_event_date) < private.office_today() then
      raise exception 'VALIDATION_ERROR: That day has already passed.' using errcode = 'P0001';
    end if;
    if p_notice_days is not null and (p_notice_days < 0 or p_notice_days > 60) then
      raise exception 'VALIDATION_ERROR: Show the notice between 0 and 60 days ahead.' using errcode = 'P0001';
    end if;
    return private.create_announcement('OFFICE_CLOSED', p_title, p_body, v_dept, null, p_event_date,
      case when coalesce(p_recurrence, 'NONE') = 'MONTHLY' then null else p_event_end end, coalesce(p_recurrence, 'NONE'), p_notice_days, null);
  end if;
  if p_service is null or not exists (select 1 from public.crm_services s where s.code = p_service and s.is_active) then
    raise exception 'VALIDATION_ERROR: Choose the service to announce.' using errcode = 'P0001';
  end if;
  v_expires := private.office_today() + 30;
  return private.create_announcement('NEW_SERVICE', p_title, p_body, v_dept, p_service, null, null, 'NONE', 0, v_expires);
end $$;
revoke all on function public.publish_client_announcement(text, text, text, date, date, text, integer, text, uuid) from public, anon;
grant execute on function public.publish_client_announcement(text, text, text, date, date, text, integer, text, uuid) to authenticated;

create or replace function public.client_announcements_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
begin
  if v_role is null or v_role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Department Head can see this.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body, 'serviceCode', a.service_code,
      'serviceName', (select s.name from public.crm_services s where s.code = a.service_code),
      'eventDate', a.event_date, 'eventEnd', a.event_end, 'recurrence', a.recurrence, 'noticeDays', a.notice_days,
      'audience', coalesce((select d.name from public.departments d where d.id = a.department_id), 'All clients'),
      'active', a.active, 'createdAt', a.created_at,
      'createdBy', (select p.full_name from public.profiles p where p.id = a.created_by),
      'live', a.active and case a.kind
                 when 'NEW_SERVICE' then private.office_today() between a.shows_from and coalesce(a.expires_on, a.shows_from + 30)
                 else private.announcement_occurrence(a) is not null end,
      'nextDate', private.announcement_occurrence(a)) order by a.created_at desc)
    from public.client_announcements a
   where private.can_notice_all_clients() or a.department_id is null or a.department_id = private.my_department_id()), '[]'::jsonb);
end $$;
revoke all on function public.client_announcements_overview() from public, anon;
grant execute on function public.client_announcements_overview() to authenticated;

create or replace function public.end_client_announcement(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  a public.client_announcements;
begin
  if v_role is null or v_role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Department Head can do this.' using errcode = '42501';
  end if;
  select * into a from public.client_announcements where id = p_id for update;
  if a.id is null or (not private.can_notice_all_clients() and a.department_id is distinct from private.my_department_id()) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0001';
  end if;
  update public.client_announcements set active = false where id = p_id;
  perform private.write_audit('CLIENT_ANNOUNCEMENT_ENDED', 'client_announcement', p_id, a.department_id, null, jsonb_build_object('title', a.title));
end $$;
revoke all on function public.end_client_announcement(uuid) from public, anon;
grant execute on function public.end_client_announcement(uuid) to authenticated;

notify pgrst, 'reload schema';
