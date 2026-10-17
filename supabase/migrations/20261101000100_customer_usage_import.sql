-- =============================================================================
-- Existing customers: import from the Excel sheet, plans, usage and campaigns
--
--  * customer_services gets the plan the customer bought: plan name, price, billing cycle, start date,
--    status (Live / Setting up / Paused / Expired / Cancelled), panel / platform and panel account.
--  * service_usage: one row per customer, service and kind (WhatsApp package, AI Calling credits, RCS / Voice
--    package, monthly deliverables per month). Re-importing replaces the row.
--  * service_campaigns: the WhatsApp (or other) campaigns with sent / delivered / read / replied / failed.
--  * import_customer_data(p_data, p_commit): the Support Team Member, Team Lead or Department Head uploads the
--    filled sheet. Every row is checked; with p_commit = false (preview) or any error NOTHING is saved and the
--    errors come back with sheet and row number. With p_commit = true and no errors everything is saved at once.
--    A Team Member always adds customers for themselves; a Team Lead / Department Head names the member.
--    A mobile number that already exists is updated (if the caller looks after that customer), not added twice.
--  * Client logins: the rows with a "Client Login E-mail" are returned; the API creates the login and e-mails
--    the client a "Set your password" link (no password is typed or sent by anyone).
--  * Client dashboard: client_services() also returns the plan and the latest usage; client_campaigns().
--  * Customers added by the Support team (no hand-over record) show their member / lead to the Department Head
--    and their client tickets go to that member.
-- Re-runnable. Nothing is deleted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists customer_since date;

alter table public.customer_services
  add column if not exists plan_name text check (length(plan_name) <= 120),
  add column if not exists price numeric(14,2) check (price >= 0),
  add column if not exists billing_cycle text check (length(billing_cycle) <= 40),
  add column if not exists started_on date,
  add column if not exists service_status text check (service_status in ('LIVE', 'SETTING_UP', 'PAUSED', 'EXPIRED', 'CANCELLED')),
  add column if not exists platform text check (length(platform) <= 120),
  add column if not exists panel_account text check (length(panel_account) <= 200),
  add column if not exists notes text check (length(notes) <= 1000);

-- ---------------------------------------------------------------------------
-- 2. Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.service_usage (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null references public.crm_services (code) on delete restrict,
  kind text not null check (kind in ('WHATSAPP', 'AI_CALLING', 'RCS', 'VOICE', 'MONTHLY')),
  -- '' for the current package; 'YYYY-MM' for monthly deliverables
  period text not null default '' check (period = '' or period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object' and pg_column_size(metrics) <= 8192),
  as_of date,
  valid_until date,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, service_code, kind, period)
);
create index if not exists service_usage_customer_idx on public.service_usage (customer_id, service_code);
alter table public.service_usage enable row level security;
revoke all on public.service_usage from public, anon, authenticated;

create table if not exists public.service_campaigns (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null references public.crm_services (code) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  template text check (length(template) <= 200),
  sent_on date,
  audience_type text check (length(audience_type) <= 60),
  audience_size integer check (audience_size >= 0),
  sent integer check (sent >= 0),
  delivered integer check (delivered >= 0),
  read integer check (read >= 0),
  replied integer check (replied >= 0),
  failed integer check (failed >= 0),
  status text check (length(status) <= 40),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists service_campaigns_key on public.service_campaigns (customer_id, service_code, lower(name), coalesce(sent_on, '0001-01-01'::date));
create index if not exists service_campaigns_customer_idx on public.service_campaigns (customer_id, sent_on desc);
alter table public.service_campaigns enable row level security;
revoke all on public.service_campaigns from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- The last 10 digits of an Indian mobile (+91 / 0 prefix allowed); null when it is not one.
create or replace function private.mobile10(p text)
returns text language sql immutable set search_path = '' as $$
  select case when d ~ '^(91|0)?[6-9]\d{9}$' then right(d, 10) end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- A service from the sheet: its code, its catalogue name, or the name used in the Excel template.
create or replace function private.import_service_code(p text)
returns text language sql stable security definer set search_path = '' as $$
  with k as (select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) as v)
  select coalesce(
    (select s.code from public.crm_services s, k where lower(s.code) = k.v or lower(s.name) = k.v limit 1),
    (select a.code from k, (values
        ('whatsapp api', 'WHATSAPP_API_BLUE_TICK'), ('whatsapp api + blue tick', 'WHATSAPP_API_BLUE_TICK'), ('whatsapp', 'WHATSAPP_API_BLUE_TICK'),
        ('rcs registration + platform', 'RCS_REGISTRATION'), ('rcs', 'RCS_REGISTRATION'),
        ('voice message', 'VOICE_MESSAGE_BULK'), ('voice message (bulk)', 'VOICE_MESSAGE_BULK'), ('voice', 'VOICE_MESSAGE_BULK'),
        ('crocodile (call crm)', 'CROCODILE_CHANNEL_WEBHOOK'), ('crocodile', 'CROCODILE_CHANNEL_WEBHOOK'),
        ('gbp setup', 'GBP_SETUP'), ('gbp management', 'GBP_MANAGEMENT'), ('gmb ranking', 'GMB_RANKING'),
        ('meta ads', 'META_ADS_MANAGEMENT'), ('social media', 'SOCIAL_MEDIA_MANAGEMENT')) a(name, code)
      where a.name = k.v and exists (select 1 from public.crm_services s where s.code = a.code)))
$$;
revoke all on function private.import_service_code(text) from public, anon, authenticated;

-- May the caller change this (already existing) customer from the Support side?
create or replace function private.may_update_support_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
      join public.profiles me on me.id = private.my_id() and me.status = 'ACTIVE'
      left join public.customer_onboarding o on o.customer_id = c.id
     where c.id = p_customer
       and c.lifecycle_stage not in ('LEAD', 'POTENTIAL', 'LOST')
       and (me.role = 'SUPER_ADMIN'
            or (me.role = 'DEPARTMENT_HEAD' and c.department_id = me.department_id)
            or c.owner_id = me.id or o.team_member_id = me.id or o.team_lead_id = me.id
            or (me.role = 'TEAM_HEAD' and c.team_id = me.team_id)))
$$;
revoke all on function private.may_update_support_customer(uuid) from public, anon, authenticated;

create or replace function private.import_num(p jsonb, k text)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  v numeric;
begin
  if p -> k is null or jsonb_typeof(p -> k) = 'null' then
    return null;
  end if;
  begin
    v := (p ->> k)::numeric;
  exception when others then
    raise exception 'VALIDATION_ERROR: "%" must be a number.', k using errcode = 'P0001';
  end;
  if v < 0 then
    raise exception 'VALIDATION_ERROR: "%" cannot be negative.', k using errcode = 'P0001';
  end if;
  return v;
end $$;

create or replace function private.import_date(p jsonb, k text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if nullif(btrim(coalesce(p ->> k, '')), '') is null then
    return null;
  end if;
  if (p ->> k) !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'VALIDATION_ERROR: "%" is not a date (use DD-MM-YYYY).', k using errcode = 'P0001';
  end if;
  return (p ->> k)::date;
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'VALIDATION_ERROR: "%" is not a real date.', k using errcode = 'P0001';
end $$;

create or replace function private.import_text(p jsonb, k text, p_max integer default 200)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(btrim(regexp_replace(coalesce(p ->> k, ''), '\s+', ' ', 'g')), '');
begin
  if length(v) > p_max then
    raise exception 'VALIDATION_ERROR: "%" is too long (at most % characters).', k, p_max using errcode = 'P0001';
  end if;
  return v;
end $$;

-- The error text without the internal "CODE: " prefix, for the import report.
create or replace function private.import_message(p text)
returns text language sql immutable set search_path = '' as $$
  select left(regexp_replace(coalesce(p, 'Could not save this row.'), '^[A-Z_]+:\s*', ''), 300)
$$;

-- ---------------------------------------------------------------------------
-- 4. The import
-- ---------------------------------------------------------------------------
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
        perform private.import_require_service(v_id, 'WHATSAPP_API_BLUE_TICK');
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
        perform private.import_require_service(v_id, 'WHATSAPP_API_BLUE_TICK');
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
        perform private.import_require_service(v_id, 'AI_CALLING');
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
        perform private.import_require_service(v_id, v_service);
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
        perform private.import_require_service(v_id, v_service);
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

-- A customer for a usage row: one from sheet 1 of this file, or one the caller already looks after.
create or replace function private.import_customer_for(p_mobile text, p_map jsonb)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_mobile text := private.mobile10(p_mobile);
  v_id uuid;
begin
  if v_mobile is null then
    raise exception 'VALIDATION_ERROR: Mobile must be a 10-digit Indian mobile number.';
  end if;
  if p_map ? v_mobile then
    return (p_map ->> v_mobile)::uuid;
  end if;
  select c.id into v_id from public.customers c
   where private.mobile10(c.phone) = v_mobile and private.may_update_support_customer(c.id)
   order by (c.lifecycle_stage = 'CUSTOMER') desc, c.created_at limit 1;
  if v_id is null then
    raise exception 'VALIDATION_ERROR: Mobile % is not in sheet "1 Customers" (and is not one of your customers yet).', v_mobile;
  end if;
  return v_id;
end $$;
revoke all on function private.import_customer_for(text, jsonb) from public, anon, authenticated;

create or replace function private.import_require_service(p_customer uuid, p_service text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and cs.service_code = p_service) then
    raise exception 'VALIDATION_ERROR: Add "%" for this customer in sheet "2 Services" first.', (select s.name from public.crm_services s where s.code = p_service);
  end if;
end $$;
revoke all on function private.import_require_service(uuid, text) from public, anon, authenticated;

create or replace function private.import_save_usage(p_customer uuid, p_service text, p_kind text, p_period text, p_metrics jsonb, p_as_of date, p_valid date)
returns void language sql security definer set search_path = '' as $$
  insert into public.service_usage as u (customer_id, service_code, kind, period, metrics, as_of, valid_until, updated_by)
  values (p_customer, p_service, p_kind, p_period, p_metrics, coalesce(p_as_of, current_date), p_valid, private.my_id())
  on conflict (customer_id, service_code, kind, period) do update
    set metrics = excluded.metrics, as_of = excluded.as_of, valid_until = coalesce(excluded.valid_until, u.valid_until),
        updated_by = excluded.updated_by, updated_at = now()
$$;
revoke all on function private.import_save_usage(uuid, text, text, text, jsonb, date, date) from public, anon, authenticated;

revoke all on function public.import_customer_data(jsonb, boolean) from public, anon;
grant execute on function public.import_customer_data(jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Client logins for imported customers (the API creates the Supabase Auth user first)
-- ---------------------------------------------------------------------------
create or replace function public.record_imported_client_login(p_customer uuid, p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not private.may_work_in_support() or not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: This customer already has a login.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u
                  where u.id = p_user_id and lower(u.email) = v_email
                    and u.raw_app_meta_data ->> 'client_customer_id' = p_customer::text) then
    raise exception 'VALIDATION_ERROR: The client login was not created for this customer.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  insert into public.customer_client_accounts (customer_id, auth_user_id, email, created_by)
  values (p_customer, p_user_id, v_email, private.my_id());
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_CREATED', format('Client login created from the Excel import (%s)', v_email));
  perform private.write_audit('CLIENT_LOGIN_CREATED', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('email', v_email, 'via', 'import'));
end $$;
revoke all on function public.record_imported_client_login(uuid, uuid, text) from public, anon;
grant execute on function public.record_imported_client_login(uuid, uuid, text) to authenticated;

-- Who may (re)send the "Set your password" e-mail: the people who look after the customer.
-- Returns the login e-mail and the client's name.
create or replace function public.client_login_invite_target(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a public.customer_client_accounts;
begin
  if not (private.may_update_support_customer(p_customer) or private.may_manage_client_account(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  if a.customer_id is null then
    raise exception 'CONFLICT: This customer has no client login yet.' using errcode = 'P0001';
  end if;
  return (select jsonb_build_object('email', a.email, 'name', c.name, 'businessName', coalesce(c.company, c.name))
            from public.customers c where c.id = p_customer);
end $$;
revoke all on function public.client_login_invite_target(uuid) from public, anon;
grant execute on function public.client_login_invite_target(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Client dashboard
-- ---------------------------------------------------------------------------
create or replace function public.client_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  c public.customers;
  a public.customer_client_accounts;
begin
  select * into c from public.customers where id = v_customer;
  select * into a from public.customer_client_accounts where customer_id = v_customer;
  return jsonb_build_object(
    'customerId', c.id, 'name', c.name, 'businessName', coalesce(nullif(btrim(c.company), ''), c.name),
    'email', c.email, 'phone', c.phone, 'segment', c.segment, 'status', c.status,
    'department', (select d.name from public.departments d where d.id = c.department_id),
    'loginEmail', a.email, 'clientSince', coalesce(c.customer_since::timestamptz, a.created_at, c.created_at));
end $$;

-- Same as before (20261023000100_client_services_contract: a missing optional column or table means "Live", the
-- active plan is looked up once, details are always an object), plus the plan bought, its status and the latest
-- usage / monthly deliverables.
create or replace function public.client_services()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_complete boolean := true;
  v_plan_id uuid;
  v_plan_name text;
begin
  begin
    execute 'select coalesce(o.client_status = ''COMPLETED'' or o.stage = ''COMPLETED'', true) from public.customer_onboarding o where o.customer_id = $1'
      into v_complete using v_customer;
  exception when undefined_column or undefined_table then
    v_complete := true;
  end;
  v_complete := coalesce(v_complete, true);

  select p.id, p.name into v_plan_id, v_plan_name
    from public.customer_plans cp join public.monthly_plans p on p.id = cp.plan_id
   where cp.customer_id = v_customer and cp.status = 'ACTIVE'
   order by cp.created_at desc
   limit 1;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', s.code, 'name', s.name, 'category', s.category, 'description', s.description,
      'purchasedAt', coalesce(cs.started_on::timestamptz, cs.created_at), 'activatedAt', cs.activated_at, 'renewsOn', cs.renews_on,
      'status', coalesce(cs.service_status, case when cs.activated_at is not null or v_complete then 'LIVE' else 'SETTING_UP' end),
      'plan', case when v_plan_id is not null and exists (
                select 1 from public.monthly_plan_services ps where ps.plan_id = v_plan_id and ps.service_code = s.code)
              then v_plan_name end,
      'planName', cs.plan_name, 'price', cs.price, 'billingCycle', cs.billing_cycle, 'platform', cs.platform,
      'panelAccount', cs.panel_account,
      'usage', (select jsonb_build_object('kind', u.kind, 'metrics', u.metrics, 'asOf', u.as_of, 'validUntil', u.valid_until)
                  from public.service_usage u where u.customer_id = v_customer and u.service_code = s.code and u.period = ''
                 order by u.updated_at desc limit 1),
      'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', m.period, 'metrics', m.metrics) order by m.period desc), '[]'::jsonb)
                    from (select * from public.service_usage u where u.customer_id = v_customer and u.service_code = s.code and u.kind = 'MONTHLY'
                           order by u.period desc limit 6) m),
      'campaignCount', (select count(*) from public.service_campaigns sc where sc.customer_id = v_customer and sc.service_code = s.code),
      'details', case when jsonb_typeof(cs.details) = 'object' then cs.details else '{}'::jsonb end)
      order by cs.created_at, s.name)
    from public.customer_services cs join public.crm_services s on s.code = cs.service_code
   where cs.customer_id = v_customer), '[]'::jsonb);
end $$;
revoke all on function public.client_services() from public, anon;
grant execute on function public.client_services() to authenticated;

create or replace function public.client_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', sc.id, 'serviceCode', sc.service_code, 'serviceName', s.name, 'name', sc.name, 'template', sc.template,
      'sentOn', sc.sent_on, 'audienceType', sc.audience_type, 'audienceSize', sc.audience_size,
      'sent', sc.sent, 'delivered', sc.delivered, 'read', sc.read, 'replied', sc.replied, 'failed', sc.failed,
      'status', sc.status) order by sc.sent_on desc nulls last, sc.created_at desc)
    from (select * from public.service_campaigns x where x.customer_id = v_customer
           order by x.sent_on desc nulls last, x.created_at desc limit 300) sc
    join public.crm_services s on s.code = sc.service_code), '[]'::jsonb);
end $$;
revoke all on function public.client_campaigns() from public, anon;
grant execute on function public.client_campaigns() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Customers added by the Support team: their member / lead (no hand-over record)
-- ---------------------------------------------------------------------------
-- The member who looks after a Support customer: the hand-over Team Member, else the owner when the owner
-- is in a Support team.
create or replace function private.support_member_of(p_customer uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select o.team_member_id from public.customer_onboarding o where o.customer_id = p_customer and o.team_member_id is not null),
    (select c.owner_id from public.customers c join public.teams t on t.id = c.team_id and t.division = 'SUPPORT' where c.id = p_customer))
$$;
revoke all on function private.support_member_of(uuid) from public, anon, authenticated;

create or replace function private.support_lead_of(p_customer uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select o.team_lead_id from public.customer_onboarding o where o.customer_id = p_customer and o.team_lead_id is not null),
    (select p.id from public.customers c join public.teams t on t.id = c.team_id and t.division = 'SUPPORT'
       join public.profiles p on p.team_id = t.id and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE'
      where c.id = p_customer order by (p.id = c.owner_id) desc, p.created_at limit 1))
$$;
revoke all on function private.support_lead_of(uuid) from public, anon, authenticated;

create or replace function private.client_ticket_owner(p_customer uuid, out o_team uuid, out o_assignee uuid, out o_lead uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid;
begin
  select c.department_id into v_dept from public.customers c where c.id = p_customer;
  -- only people who are still active
  select p.id into o_lead from public.profiles p where p.id = private.support_lead_of(p_customer) and p.status = 'ACTIVE';
  select p.id into o_assignee from public.profiles p where p.id = private.support_member_of(p_customer) and p.status = 'ACTIVE';
  o_team := coalesce(
    (select p.team_id from public.profiles p where p.id = o_lead),
    (select p.team_id from public.profiles p where p.id = o_assignee),
    (select t.id from public.teams t where t.department_id = v_dept and t.division = 'SUPPORT' order by t.created_at limit 1));
end $$;
revoke all on function private.client_ticket_owner(uuid) from public, anon, authenticated;

create or replace function public.head_customer_directory(p_search text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  v_dept uuid := private.my_department_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_total integer;
  v_items jsonb;
begin
  if v_role is null or v_role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Department Head can see this.' using errcode = '42501';
  end if;
  with base as (
    select c.*, o.customer_id is not null as handed_over, o.handover_stage,
           private.support_lead_of(c.id) as lead_id, private.support_member_of(c.id) as member_id,
           coalesce(o.assigned_to_member_at, o.passed_to_team_lead_at, o.to_department_head_at, c.created_at) as sort_at
      from public.customers c
      left join public.customer_onboarding o on o.customer_id = c.id
     where (v_role = 'SUPER_ADMIN' or c.department_id = v_dept)
       and (c.lifecycle_stage = 'CUSTOMER' or (c.lifecycle_stage = 'ONBOARDING' and o.forwarded_to_support_at is not null))
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')),
  pg as (
    select b.sort_at, jsonb_build_object(
      'id', b.id, 'code', b.customer_code, 'name', b.name, 'company', b.company, 'phone', b.phone, 'email', b.email,
      'city', b.city, 'address', b.address, 'lifecycleStage', b.lifecycle_stage,
      -- a customer the Support team added itself has no hand-over: it is with its member
      'handoverStage', case when b.handed_over then coalesce(b.handover_stage, 'CONSULTANT') when b.member_id is not null then 'TEAM_MEMBER' else 'TEAM_LEAD' end,
      'services', (select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order), '[]'::jsonb)
                     from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = b.id),
      'teamLead', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = b.lead_id),
      'teamMember', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = b.member_id),
      'tickets', jsonb_build_object(
        'open', (select count(*) from public.support_tickets t where t.customer_id = b.id and t.status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED')),
        'resolved', (select count(*) from public.support_tickets t where t.customer_id = b.id and t.status in ('RESOLVED', 'CLOSED'))),
      'hasClientLogin', exists (select 1 from public.customer_client_accounts a where a.customer_id = b.id)) as item
      from base b order by b.sort_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from base), coalesce((select jsonb_agg(pg.item order by pg.sort_at desc) from pg), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;
revoke all on function public.head_customer_directory(text, integer, integer) from public, anon;
grant execute on function public.head_customer_directory(text, integer, integer) to authenticated;

-- "Forgot password?" on the client sign-in page: the API (service key only) looks up the client login.
create or replace function public.client_login_for_reset(p_email text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', a.email, 'name', c.name, 'businessName', coalesce(c.company, c.name))
    from public.customer_client_accounts a join public.customers c on c.id = a.customer_id
   where a.email = lower(btrim(coalesce(p_email, '')))
$$;
revoke all on function public.client_login_for_reset(text) from public, anon, authenticated;
grant execute on function public.client_login_for_reset(text) to service_role;

-- Let the API see the new functions right away.
notify pgrst, 'reload schema';
