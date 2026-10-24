-- =============================================================================
-- The two newest migrations. Paste the whole file into the Supabase SQL editor and run it once (safe to run again; nothing is deleted).
--   1. 20261117000100_hr_client_notices.sql    client notices from the HR head reach the clients they choose
--   2. 20261117000200_import_auto_service.sql  Excel import: usage rows add the service the customer does not have yet
-- Run it AFTER run_these_9_..., run_these_3_..._security, run_these_8_... and run_these_3_..._performance_hr.
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261117000100_hr_client_notices.sql
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261117000200_import_auto_service.sql
-- =============================================================================
-- Existing-customer import: usage rows no longer need a hand-made "2 Services" row for every service.
-- A customer on sheet 3 / 4 (WhatsApp), 5 (AI Calling), 6 (RCS & Voice) or 7 (Monthly Deliverables) now gets that service added
-- automatically when they do not have it yet: status Live, no price, no start or renewal date (fill them in on the customer, or
-- add the row in "2 Services" to set them). It is counted under "Services" in the preview, and nothing is changed for a customer
-- who already has the service or a row for it in sheet 2. Safe to rerun; nothing is deleted.
-- =============================================================================

create or replace function private.import_ensure_service(p_customer uuid, p_service text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_added integer;
begin
  if exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and cs.service_code = p_service) then
    return false;
  end if;
  insert into public.customer_services (customer_id, service_code, service_status, activated_at)
  values (p_customer, p_service, 'LIVE', now())
  on conflict (customer_id, service_code) do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform private.log_customer_activity(p_customer, 'CUSTOMER_IMPORTED',
      format('Service added from the Excel import: %s (it had usage data and no row in "2 Services")', (select s.name from public.crm_services s where s.code = p_service)));
  end if;
  return v_added > 0;
end $$;
revoke all on function private.import_ensure_service(uuid, text) from public, anon, authenticated;

create or replace function public.import_customer_data(p_data jsonb, p_commit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  owner public.profiles;
  c public.customers;
  dup public.customers;
  r jsonb;
  v_row integer;
  v_errors jsonb := '[]'::jsonb;
  v_logins jsonb := '[]'::jsonb;
  v_map jsonb := '{}'::jsonb;          -- mobile -> customer id (this file)
  v_owner_counts jsonb := '{}'::jsonb; -- owner id -> number of customers added for them
  v_added integer := 0;
  v_updated integer := 0;
  v_services integer := 0;
  v_usage integer := 0;
  v_campaigns integer := 0;
  v_mobile text;
  v_id uuid;
  v_code text;
  v_service text;
  v_kind text;
  v_period text;
  v_status text;
  v_email text;
  v_login text;
  v_metrics jsonb;
  v_member text;
  v_count integer;
  v_total integer;
  v_seen_login jsonb := '{}'::jsonb;
  v_owner uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.may_work_in_support() or me.role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'FORBIDDEN: Only the Support team can import customers.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'VALIDATION_ERROR: The file could not be read.' using errcode = 'P0001';
  end if;
  v_total := coalesce(jsonb_array_length(p_data -> 'customers'), 0) + coalesce(jsonb_array_length(p_data -> 'services'), 0)
           + coalesce(jsonb_array_length(p_data -> 'whatsapp'), 0) + coalesce(jsonb_array_length(p_data -> 'campaigns'), 0)
           + coalesce(jsonb_array_length(p_data -> 'aiCalling'), 0) + coalesce(jsonb_array_length(p_data -> 'rcsVoice'), 0)
           + coalesce(jsonb_array_length(p_data -> 'monthly'), 0);
  if v_total = 0 then
    raise exception 'VALIDATION_ERROR: The file has no rows filled in.' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_array_length(p_data -> 'customers'), 0) > 500 or v_total > 5000 then
    raise exception 'VALIDATION_ERROR: Too many rows: at most 500 customers and 5000 rows in one file.' using errcode = 'P0001';
  end if;

  begin  -- everything below is undone for a preview or when any row has an error
    -- ---- 1 Customers ----
    for r in select x from jsonb_array_elements(coalesce(p_data -> 'customers', '[]'::jsonb)) x loop
      v_row := coalesce((r ->> 'row')::integer, 0);
      begin
        v_mobile := private.mobile10(r ->> 'mobile');
        if v_mobile is null then
          raise exception 'VALIDATION_ERROR: Mobile Number must be a 10-digit Indian mobile number.';
        end if;
        if v_map ? v_mobile then
          raise exception 'VALIDATION_ERROR: This mobile number is already on another row of this sheet.';
        end if;
        if private.import_text(r, 'name') is null then
          raise exception 'VALIDATION_ERROR: Customer Name is required.';
        end if;
        if private.import_text(r, 'businessName') is null then
          raise exception 'VALIDATION_ERROR: Business Name is required.';
        end if;
        v_email := lower(private.import_text(r, 'email', 254));
        if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
          raise exception 'VALIDATION_ERROR: E-mail is not a valid address.';
        end if;

        -- who looks after the customer
        v_member := private.import_text(r, 'member', 200);
        owner := null;
        if me.role = 'TEAM_MEMBER' then
          owner := me;
        elsif v_member is null then
          raise exception 'VALIDATION_ERROR: Support Team Member is required (the name of the member who looks after this customer).';
        else
          select count(*) into v_count
            from public.profiles p join public.teams t on t.id = p.team_id and t.division = 'SUPPORT'
           where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD')
             and (lower(p.full_name) = lower(v_member) or lower(p.email) = lower(v_member))
             and private.can_assign_customer_owner(p.id);
          if v_count = 0 then
            raise exception 'VALIDATION_ERROR: Support Team Member "%" was not found in your Support team(s). Write the name as it is in the CRM.', v_member;
          elsif v_count > 1 then
            raise exception 'VALIDATION_ERROR: More than one member is called "%". Write their CRM e-mail instead.', v_member;
          end if;
          select p.* into owner
            from public.profiles p join public.teams t on t.id = p.team_id and t.division = 'SUPPORT'
           where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD')
             and (lower(p.full_name) = lower(v_member) or lower(p.email) = lower(v_member))
             and private.can_assign_customer_owner(p.id);
        end if;
        if owner.team_id is null or not exists (select 1 from public.teams t where t.id = owner.team_id and t.division = 'SUPPORT') then
          raise exception 'VALIDATION_ERROR: The customer must be looked after by a member of a Support team.';
        end if;

        -- existing customer (same mobile in the department): update instead of adding twice
        select * into c from public.customers x
         where x.department_id = owner.department_id and private.mobile10(x.phone) = v_mobile
         order by (x.lifecycle_stage = 'CUSTOMER') desc, x.created_at limit 1;
        if c.id is not null then
          if not private.may_update_support_customer(c.id) then
            raise exception 'CONFLICT: % (%) already has this mobile number and is looked after by someone else%.', c.name, c.customer_code,
              case when c.lifecycle_stage in ('LEAD', 'POTENTIAL') then ' (still with Sales)' else '' end;
          end if;
          if v_email is not null then
            dup := private.find_duplicate_customer(c.department_id, v_email, null, c.id);
            perform private.raise_duplicate_customer(dup);
          end if;
          update public.customers
             set name = private.import_text(r, 'name'),
                 company = private.import_text(r, 'businessName'),
                 email = coalesce(v_email, email),
                 city = coalesce(private.import_text(r, 'city', 120), city),
                 address = coalesce(private.import_text(r, 'address', 500), address),
                 business_category = coalesce(private.import_text(r, 'category', 120), business_category),
                 customer_since = coalesce(private.import_date(r, 'customerSince'), customer_since),
                 notes = coalesce(nullif(concat_ws(E'\n', private.import_text(r, 'notes', 2000),
                                   'Sold by (Sales): ' || private.import_text(r, 'soldBy', 120)), ''), notes),
                 owner_id = case when me.role = 'TEAM_MEMBER' or v_member is null then owner_id else owner.id end
           where id = c.id;
          v_id := c.id;
          v_updated := v_updated + 1;
          perform private.log_customer_activity(v_id, 'CUSTOMER_IMPORTED', format('Details updated from the Excel import by %s', me.full_name));
        else
          dup := private.find_duplicate_customer(owner.department_id, v_email, null, null);
          perform private.raise_duplicate_customer(dup);
          insert into public.customers (owner_id, name, company, phone, email, city, address, business_category, customer_since,
                                        notes, segment, status, lifecycle_stage, channel)
          values (owner.id, private.import_text(r, 'name'), private.import_text(r, 'businessName'), v_mobile, v_email,
                  private.import_text(r, 'city', 120), private.import_text(r, 'address', 500), private.import_text(r, 'category', 120),
                  private.import_date(r, 'customerSince'),
                  nullif(concat_ws(E'\n', private.import_text(r, 'notes', 2000), 'Sold by (Sales): ' || private.import_text(r, 'soldBy', 120)), ''),
                  'RETAIL', 'ACTIVE', 'CUSTOMER', 'Excel import')
          returning id into v_id;
          v_added := v_added + 1;
          if owner.id <> me.id then
            v_owner_counts := jsonb_set(v_owner_counts, array[owner.id::text], to_jsonb(coalesce((v_owner_counts ->> owner.id::text)::integer, 0) + 1));
          end if;
          insert into public.customer_activities (customer_id, actor_id, type, note)
          values (v_id, me.id, 'CUSTOMER_IMPORTED', format('Added from the Excel import by %s%s', me.full_name,
                  case when owner.id <> me.id then format(' for %s', owner.full_name) else '' end));
        end if;
        v_map := jsonb_set(v_map, array[v_mobile], to_jsonb(v_id));

        -- the client's login (created by the API after this is saved)
        v_login := lower(private.import_text(r, 'loginEmail', 254));
        if v_login is not null then
          if v_login !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
            raise exception 'VALIDATION_ERROR: Client Login E-mail is not a valid address.';
          end if;
          if exists (select 1 from public.customer_client_accounts a where a.customer_id = v_id) then
            if not exists (select 1 from public.customer_client_accounts a where a.customer_id = v_id and a.email = v_login) then
              raise exception 'CONFLICT: This customer already has a client login with a different e-mail (%).',
                (select a.email from public.customer_client_accounts a where a.customer_id = v_id);
            end if;
          else
            if v_seen_login ? v_login then
              raise exception 'VALIDATION_ERROR: Client Login E-mail % is used on another row. Every client needs their own.', v_login;
            end if;
            if exists (select 1 from auth.users u where lower(u.email) = v_login) or exists (select 1 from public.profiles p where lower(p.email) = v_login) then
              raise exception 'CONFLICT: % already has a login. Use a different Client Login E-mail.', v_login;
            end if;
            v_seen_login := jsonb_set(v_seen_login, array[v_login], 'true'::jsonb);
            v_logins := v_logins || jsonb_build_object('customerId', v_id, 'email', v_login,
              'name', private.import_text(r, 'name'), 'businessName', private.import_text(r, 'businessName'), 'row', v_row);
          end if;
        end if;
      exception when others then
        v_errors := v_errors || jsonb_build_object('sheet', '1 Customers', 'row', v_row, 'message', private.import_message(sqlerrm));
      end;
    end loop;

    -- ---- 2 Services ----
    for r in select x from jsonb_array_elements(coalesce(p_data -> 'services', '[]'::jsonb)) x loop
      v_row := coalesce((r ->> 'row')::integer, 0);
      begin
        v_id := private.import_customer_for(r ->> 'mobile', v_map);
        v_service := private.import_service_code(r ->> 'service');
        if v_service is null then
          raise exception 'VALIDATION_ERROR: Service "%" is not one of the services in the CRM. Pick it from the list.', coalesce(r ->> 'service', '');
        end if;
        v_status := upper(replace(btrim(coalesce(r ->> 'status', '')), ' ', '_'));
        if v_status = '' then
          raise exception 'VALIDATION_ERROR: Status is required.';
        end if;
        if v_status not in ('LIVE', 'SETTING_UP', 'PAUSED', 'EXPIRED', 'CANCELLED') then
          raise exception 'VALIDATION_ERROR: Status must be Live, Setting up, Paused, Expired or Cancelled.';
        end if;
        if private.import_date(r, 'startDate') is null then
          raise exception 'VALIDATION_ERROR: Start Date is required.';
        end if;
        if private.import_date(r, 'renewsOn') < private.import_date(r, 'startDate') then
          raise exception 'VALIDATION_ERROR: Renewal / Expiry Date is before the Start Date.';
        end if;
        insert into public.customer_services as cs (customer_id, service_code, plan_name, price, billing_cycle, started_on, renews_on,
                                                    service_status, activated_at, platform, panel_account, notes)
        values (v_id, v_service, private.import_text(r, 'plan', 120), private.import_num(r, 'price'), private.import_text(r, 'billingCycle', 40),
                private.import_date(r, 'startDate'), private.import_date(r, 'renewsOn'), v_status,
                case when v_status <> 'SETTING_UP' then private.import_date(r, 'startDate')::timestamptz end,
                private.import_text(r, 'platform', 120), private.import_text(r, 'panelAccount', 200), private.import_text(r, 'notes', 1000))
        on conflict (customer_id, service_code) do update
          set plan_name = excluded.plan_name, price = excluded.price, billing_cycle = excluded.billing_cycle,
              started_on = excluded.started_on, renews_on = excluded.renews_on, service_status = excluded.service_status,
              activated_at = coalesce(cs.activated_at, excluded.activated_at), platform = excluded.platform,
              panel_account = excluded.panel_account, notes = excluded.notes;
        -- the customer's main service (shown in lists) when none is set yet
        update public.customers x set service_code = v_service, service_interest = (select s.name from public.crm_services s where s.code = v_service)
         where x.id = v_id and x.service_code is null;
        v_services := v_services + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('sheet', '2 Services', 'row', v_row, 'message', private.import_message(sqlerrm));
      end;
    end loop;

    -- ---- 3 WhatsApp account ----
    for r in select x from jsonb_array_elements(coalesce(p_data -> 'whatsapp', '[]'::jsonb)) x loop
      v_row := coalesce((r ->> 'row')::integer, 0);
      begin
        v_id := private.import_customer_for(r ->> 'mobile', v_map);
        if private.import_ensure_service(v_id, 'WHATSAPP_API_BLUE_TICK') then v_services := v_services + 1; end if;
        v_metrics := jsonb_strip_nulls(jsonb_build_object(
          'apiNumber', private.import_text(r, 'apiNumber', 30), 'wabaId', private.import_text(r, 'wabaId', 60),
          'displayName', private.import_text(r, 'displayName', 120), 'blueTick', private.import_text(r, 'blueTick', 20),
          'qualityRating', private.import_text(r, 'quality', 20), 'messagingLimit', private.import_text(r, 'messagingLimit', 40),
          'packageName', private.import_text(r, 'packageName', 120),
          'packageMessages', private.import_num(r, 'packageMessages'), 'extraMessages', private.import_num(r, 'extraMessages'),
          'sent', private.import_num(r, 'sent'), 'delivered', private.import_num(r, 'delivered'), 'read', private.import_num(r, 'read'),
          'replied', private.import_num(r, 'replied'), 'failed', private.import_num(r, 'failed'), 'campaigns', private.import_num(r, 'campaigns')));
        if v_metrics ->> 'packageMessages' is null then
          raise exception 'VALIDATION_ERROR: Messages in Package is required (for example 100000).';
        end if;
        perform private.import_save_usage(v_id, 'WHATSAPP_API_BLUE_TICK', 'WHATSAPP', '', v_metrics,
          private.import_date(r, 'asOf'), private.import_date(r, 'validUntil'));
        v_usage := v_usage + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('sheet', '3 WhatsApp Account', 'row', v_row, 'message', private.import_message(sqlerrm));
      end;
    end loop;

    -- ---- 4 WhatsApp campaigns ----
    for r in select x from jsonb_array_elements(coalesce(p_data -> 'campaigns', '[]'::jsonb)) x loop
      v_row := coalesce((r ->> 'row')::integer, 0);
      begin
        v_id := private.import_customer_for(r ->> 'mobile', v_map);
        if private.import_ensure_service(v_id, 'WHATSAPP_API_BLUE_TICK') then v_services := v_services + 1; end if;
        if private.import_text(r, 'name') is null then
          raise exception 'VALIDATION_ERROR: Campaign Name is required.';
        end if;
        insert into public.service_campaigns as sc (customer_id, service_code, name, template, sent_on, audience_type, audience_size,
                                                    sent, delivered, read, replied, failed, status, updated_by)
        values (v_id, 'WHATSAPP_API_BLUE_TICK', private.import_text(r, 'name'), private.import_text(r, 'template'), private.import_date(r, 'sentOn'),
                private.import_text(r, 'audienceType', 60), private.import_num(r, 'audienceSize'), private.import_num(r, 'sent'),
                private.import_num(r, 'delivered'), private.import_num(r, 'read'), private.import_num(r, 'replied'),
                private.import_num(r, 'failed'), private.import_text(r, 'status', 40), me.id)
        on conflict (customer_id, service_code, lower(name), coalesce(sent_on, '0001-01-01'::date)) do update
          set template = excluded.template, audience_type = excluded.audience_type, audience_size = excluded.audience_size,
              sent = excluded.sent, delivered = excluded.delivered, read = excluded.read, replied = excluded.replied,
              failed = excluded.failed, status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
        v_campaigns := v_campaigns + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('sheet', '4 WhatsApp Campaigns', 'row', v_row, 'message', private.import_message(sqlerrm));
      end;
    end loop;

    -- ---- 5 AI Calling ----
    for r in select x from jsonb_array_elements(coalesce(p_data -> 'aiCalling', '[]'::jsonb)) x loop
      v_row := coalesce((r ->> 'row')::integer, 0);
      begin
        v_id := private.import_customer_for(r ->> 'mobile', v_map);
        if private.import_ensure_service(v_id, 'AI_CALLING') then v_services := v_services + 1; end if;
        v_metrics := jsonb_strip_nulls(jsonb_build_object(
          'platform', private.import_text(r, 'platform', 120), 'plan', private.import_text(r, 'plan', 120),
          'numbers', private.import_text(r, 'numbers', 200), 'agent', private.import_text(r, 'agent', 120),
          'creditsBought', private.import_num(r, 'creditsBought'), 'creditsLeft', private.import_num(r, 'creditsLeft'),
          'minutesBought', private.import_num(r, 'minutesBought'), 'minutesLeft', private.import_num(r, 'minutesLeft'),
          'totalCalls', private.import_num(r, 'totalCalls'), 'connectedCalls', private.import_num(r, 'connectedCalls'),
          'notAnswered', private.import_num(r, 'notAnswered'), 'interested', private.import_num(r, 'interested'),
          'campaigns', private.import_num(r, 'campaigns'), 'contacts', private.import_num(r, 'contacts')));
        if (v_metrics ->> 'minutesLeft')::numeric > (v_metrics ->> 'minutesBought')::numeric then
          raise exception 'VALIDATION_ERROR: Minutes Left is more than Minutes Bought.';
        end if;
        if (v_metrics ->> 'creditsLeft')::numeric > (v_metrics ->> 'creditsBought')::numeric then
          raise exception 'VALIDATION_ERROR: Credits Left is more than Credits Bought.';
        end if;
        perform private.import_save_usage(v_id, 'AI_CALLING', 'AI_CALLING', '', v_metrics,
          private.import_date(r, 'asOf'), private.import_date(r, 'validUntil'));
        v_usage := v_usage + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('sheet', '5 AI Calling', 'row', v_row, 'message', private.import_message(sqlerrm));
      end;
    end loop;

    -- ---- 6 RCS & Voice ----
    for r in select x from jsonb_array_elements(coalesce(p_data -> 'rcsVoice', '[]'::jsonb)) x loop
      v_row := coalesce((r ->> 'row')::integer, 0);
      begin
        v_id := private.import_customer_for(r ->> 'mobile', v_map);
        v_service := private.import_service_code(r ->> 'service');
        v_kind := case v_service when 'RCS_REGISTRATION' then 'RCS' when 'VOICE_MESSAGE_BULK' then 'VOICE' end;
        if v_kind is null then
          raise exception 'VALIDATION_ERROR: Service must be RCS or Voice Message.';
        end if;
        if private.import_ensure_service(v_id, v_service) then v_services := v_services + 1; end if;
        v_metrics := jsonb_strip_nulls(jsonb_build_object(
          'senderId', private.import_text(r, 'senderId', 120), 'packageMessages', private.import_num(r, 'packageMessages'),
          'sent', private.import_num(r, 'sent'), 'delivered', private.import_num(r, 'delivered'), 'read', private.import_num(r, 'read'),
          'clicks', private.import_num(r, 'clicks'), 'failed', private.import_num(r, 'failed'), 'campaigns', private.import_num(r, 'campaigns')));
        perform private.import_save_usage(v_id, v_service, v_kind, '', v_metrics,
          private.import_date(r, 'asOf'), private.import_date(r, 'validUntil'));
        v_usage := v_usage + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('sheet', '6 RCS & Voice', 'row', v_row, 'message', private.import_message(sqlerrm));
      end;
    end loop;

    -- ---- 7 Monthly deliverables ----
    for r in select x from jsonb_array_elements(coalesce(p_data -> 'monthly', '[]'::jsonb)) x loop
      v_row := coalesce((r ->> 'row')::integer, 0);
      begin
        v_id := private.import_customer_for(r ->> 'mobile', v_map);
        v_service := private.import_service_code(r ->> 'service');
        if v_service is null then
          raise exception 'VALIDATION_ERROR: Service "%" is not one of the services in the CRM.', coalesce(r ->> 'service', '');
        end if;
        if private.import_ensure_service(v_id, v_service) then v_services := v_services + 1; end if;
        v_period := btrim(coalesce(r ->> 'month', ''));
        if v_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
          raise exception 'VALIDATION_ERROR: Month must look like Oct-2026.';
        end if;
        v_metrics := jsonb_strip_nulls(jsonb_build_object(
          'unit', private.import_text(r, 'unit', 120), 'included', private.import_num(r, 'included'), 'delivered', private.import_num(r, 'delivered'),
          'result1Name', private.import_text(r, 'result1Name', 80), 'result1Value', private.import_text(r, 'result1Value', 80),
          'result2Name', private.import_text(r, 'result2Name', 80), 'result2Value', private.import_text(r, 'result2Value', 80),
          'link', private.import_text(r, 'link', 500), 'notes', private.import_text(r, 'notes', 500)));
        if v_metrics ->> 'link' is not null and v_metrics ->> 'link' !~* '^https?://' then
          raise exception 'VALIDATION_ERROR: Link must start with https://';
        end if;
        perform private.import_save_usage(v_id, v_service, 'MONTHLY', v_period, v_metrics, null, null);
        v_usage := v_usage + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('sheet', '7 Monthly Deliverables', 'row', v_row, 'message', private.import_message(sqlerrm));
      end;
    end loop;

    if p_commit and jsonb_array_length(v_errors) = 0 then
      -- one notification per member a Team Lead / Department Head added customers for
      for v_owner, v_count in select key::uuid, value::integer from jsonb_each_text(v_owner_counts) loop
        perform private.notify(v_owner, 'CUSTOMER_ASSIGNED', format('%s customer%s added for you', v_count, case when v_count = 1 then '' else 's' end),
          format('%s imported existing customers from Excel and assigned them to you.', me.full_name), 'customer', null);
      end loop;
      perform private.write_audit('CUSTOMERS_IMPORTED', 'customer', null, me.department_id, me.team_id,
        jsonb_build_object('added', v_added, 'updated', v_updated, 'services', v_services, 'usage', v_usage, 'campaigns', v_campaigns));
    else
      raise exception using errcode = 'P0099', message = 'import preview';
    end if;
  exception when sqlstate 'P0099' then
    null;  -- preview or errors: nothing is kept
  end;

  return jsonb_build_object(
    'committed', p_commit and jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'summary', jsonb_build_object('added', v_added, 'updated', v_updated, 'services', v_services, 'usage', v_usage,
                                  'campaigns', v_campaigns, 'logins', jsonb_array_length(v_logins)),
    'newLogins', v_logins);
end $$;


notify pgrst, 'reload schema';
