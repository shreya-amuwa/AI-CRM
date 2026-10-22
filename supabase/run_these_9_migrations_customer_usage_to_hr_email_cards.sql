-- =============================================================================
-- The migrations that none of the other run_these_*.sql files contain (everything from 20261101 up to 20261115, except the
-- security ones). Paste the whole file into the Supabase SQL editor and run it once.
-- Every part is idempotent (safe to run again); nothing is deleted.
--   1. 20261101000100_customer_usage_import.sql              customer usage import
--   2. 20261102000100_invoice_prefill_agreed_amount.sql      invoice builder fills the agreed amount
--   3. 20261103000100_hr_members_employee_record.sql         HR members get their HR employee record
--   4. 20261103000100_order_tax_basis.sql                    agreed amount, GST, total payable and balance as one model
--   5. 20261104000100_business_attribution_reports.sql       Sales / Support business reports
--   6. 20261105000100_department_business_orders.sql         Department Income -> one department's orders
--   7. 20261107000100_hr_email_automation.sql                HR email automation (also defines private.hr_today / hr_require_staff
--                                                            that Recruitment and Training need)
--   8. 20261108000100_chat.sql                               chat
--   9. 20261115000100_hr_email_cards.sql                     HR email cards
-- Order of all the files:  this file  ->  run_these_3_migrations_security.sql  ->  run_these_8_migrations_tickets_to_payment_gst.sql
--                          ->  run_these_3_migrations_performance_hr.sql
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261101000100_customer_usage_import.sql
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261102000100_invoice_prefill_agreed_amount.sql
-- Invoice builder: the amount is filled in from the customer's own record.
--
-- Until now the invoice rows for a purchase came pre-filled with every detail except the price, so Accounts typed each amount.
-- The only amount recorded for a purchase is the one Sales agreed with the customer (customers.deal_amount, with tax) for all
-- the services together, and the invoices already issued for it are in generated_invoices. So the builder now offers, for each
-- service of THIS customer, a share of what is still to be invoiced (agreed amount - invoices already issued), worked out so that
-- the invoice total with GST is as close as possible to that balance without passing it (the cap the database enforces).
--   * The balance is split by the services' catalogue starting prices when every service has one, otherwise equally.
--   * Nothing is filled when no amount was agreed, or when it has been invoiced in full (a warning says so). Nothing is invented.
--   * Add-on invoices already come with the approved prices; additional purchases start empty. Both are unchanged.
-- Every amount stays editable and the database still recomputes the totals and enforces the cap when the invoice is issued.
-- Idempotent.

-- Largest base amount (rupees, 2 decimals) whose total with GST (GST = round(base x rate / 100, 2), as the invoice does) does not pass p_total.
create or replace function private.invoice_base_for_total(p_total numeric, p_rate numeric)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  v_target bigint := floor(p_total * 100);
  v_b bigint;
begin
  if v_target <= 0 then return 0; end if;
  v_b := floor(v_target * 100 / (100 + p_rate));
  while (v_b + 1) + round((v_b + 1) * p_rate / 100) <= v_target loop v_b := v_b + 1; end loop;
  while v_b > 0 and v_b + round(v_b * p_rate / 100) > v_target loop v_b := v_b - 1; end loop;
  return round(v_b / 100.0, 2);
end $$;
revoke all on function private.invoice_base_for_total(numeric, numeric) from public, anon, authenticated;

-- Fills "baseAmount" on each line so that the lines (with GST) add up to p_total, or as near below it as paise rounding allows.
create or replace function private.spread_invoice_total(p_lines jsonb, p_total numeric)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  n integer := coalesce(jsonb_array_length(p_lines), 0);
  v_total bigint := floor(p_total * 100);
  v_w numeric[];
  v_rate numeric[];
  v_share bigint[];
  v_base numeric[];
  v_sum_w numeric := 0;
  v_all_priced boolean := true;
  v_used bigint := 0;
  v_left bigint;
  v_line_total bigint;
  i integer;
  v_price numeric;
begin
  if n = 0 or v_total <= 0 then return p_lines; end if;
  for i in 1..n loop
    select s.starting_price into v_price from public.crm_services s where s.code = p_lines -> (i - 1) ->> 'serviceCode';
    v_w[i] := coalesce(v_price, 0);
    v_rate[i] := coalesce(nullif(p_lines -> (i - 1) ->> 'taxRate', '')::numeric, 18);
    if v_w[i] <= 0 then v_all_priced := false; end if;
  end loop;
  for i in 1..n loop
    if not v_all_priced then v_w[i] := 1; end if;
    v_sum_w := v_sum_w + v_w[i];
  end loop;
  -- each service's share of the balance, in paise (the leftover paise go to the first services)
  for i in 1..n loop
    v_share[i] := floor(v_total * v_w[i] / v_sum_w);
    v_used := v_used + v_share[i];
  end loop;
  v_left := v_total - v_used;
  i := 1;
  while v_left > 0 loop v_share[i] := v_share[i] + 1; v_left := v_left - 1; i := i % n + 1; end loop;
  -- base amounts: with GST each line stays within its share
  v_used := 0;
  for i in 1..n loop
    v_base[i] := private.invoice_base_for_total(v_share[i] / 100.0, v_rate[i]);
    v_line_total := round(v_base[i] * 100) + round(round(v_base[i] * 100) * v_rate[i] / 100);
    v_used := v_used + v_line_total;
  end loop;
  -- a service whose share is too small to carry an amount: put the whole balance on the first service instead
  for i in 1..n loop
    if v_base[i] <= 0 then
      v_base[1] := private.invoice_base_for_total(v_total / 100.0, v_rate[1]);
      for i in 2..n loop v_base[i] := null; end loop;
      v_used := -1;
      exit;
    end if;
  end loop;
  -- what paise rounding left over goes to the first line, as far as its GST allows
  if v_used >= 0 and v_total - v_used > 0 then
    v_line_total := round(v_base[1] * 100) + round(round(v_base[1] * 100) * v_rate[1] / 100);
    v_base[1] := private.invoice_base_for_total((v_line_total + (v_total - v_used)) / 100.0, v_rate[1]);
  end if;
  return (select jsonb_agg(l || jsonb_build_object('baseAmount', round(v_base[ord::integer], 2)) order by ord)
            from jsonb_array_elements(p_lines) with ordinality as t(l, ord));
end $$;
revoke all on function private.spread_invoice_total(jsonb, numeric) from public, anon, authenticated;

create or replace function public.accounts_invoice_prefill(p_customer uuid, p_purpose text default 'SERVICES', p_addon_request uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  r public.addon_requests;
  prev public.generated_invoices;
  v_purpose text := upper(coalesce(nullif(btrim(p_purpose), ''), 'SERVICES'));
  v_name text; v_business text; v_address text; v_contact text; v_mobile text; v_gstin text; v_state text;
  v_src_business text := 'NONE'; v_src_address text := 'NONE'; v_src_contact text := 'NONE'; v_src_mobile text := 'NONE';
  v_src_gstin text := 'NONE'; v_src_state text := 'NONE';
  v_lines jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_next bigint; v_last bigint; v_called boolean; v_suggest text;
  v_treatment text;
  v_invoiced numeric := 0;
begin
  perform private.require_accounts_staff();
  if p_customer is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_purpose not in ('SERVICES', 'ADDON', 'ADDITIONAL') then
    raise exception 'VALIDATION_ERROR: Choose what this invoice is for.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;

  -- Business name / address / contact / mobile: what was collected in onboarding first (the onboarding cards and the customer
  -- record are kept in step, so they normally agree), then the customer record. Nothing is invented.
  select nullif(btrim(e.value), '') into v_business from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'BUSINESS_NAME' and e.status in ('SAVED', 'VERIFIED');
  if v_business is not null then v_src_business := 'ONBOARDING';
  else
    v_business := nullif(btrim(c.company), '');
    if v_business is not null then v_src_business := 'CUSTOMER'; end if;
  end if;
  select nullif(btrim(e.value), '') into v_address from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'BUSINESS_ADDRESS' and e.status in ('SAVED', 'VERIFIED');
  if v_address is not null then v_src_address := 'ONBOARDING';
  else
    v_address := nullif(btrim(c.address), '');
    if v_address is not null then v_src_address := 'CUSTOMER'; end if;
  end if;
  select nullif(btrim(e.value), '') into v_contact from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'CUSTOMER_NAME' and e.status in ('SAVED', 'VERIFIED');
  if v_contact is not null then v_src_contact := 'ONBOARDING';
  else
    v_contact := nullif(btrim(c.name), '');
    if v_contact is not null then v_src_contact := 'CUSTOMER'; end if;
  end if;
  v_name := coalesce(nullif(btrim(c.name), ''), v_contact);
  v_mobile := nullif(btrim(c.phone), '');
  if v_mobile is not null then
    v_src_mobile := 'CUSTOMER';
  else
    select nullif(btrim(e.value), '') into v_mobile from public.customer_onboarding_entries e
     where e.customer_id = c.id and e.item_code = 'CUSTOMER_MOBILE' and e.status in ('SAVED', 'VERIFIED');
    if v_mobile is not null then v_src_mobile := 'ONBOARDING'; end if;
  end if;

  -- GSTIN: there is no structured GST field on the customer, so the only structured source is the customer's own previous
  -- invoice. Otherwise it stays blank for Accounts to enter (no extraction from uploaded documents).
  select * into prev from public.generated_invoices g where g.customer_id = c.id order by g.issued_at desc limit 1;
  if prev.invoice_id is not null and prev.customer_gstin is not null then
    v_gstin := prev.customer_gstin;
    v_src_gstin := 'PREVIOUS_INVOICE';
  end if;
  -- State: the address first, then the GSTIN prefix, then the previous invoice. When two of these disagree Accounts is warned.
  v_state := private.infer_state_code(v_address);
  if v_state is not null then
    v_src_state := 'ADDRESS';
  elsif v_gstin is not null and private.valid_gstin(v_gstin) then
    v_state := left(v_gstin, 2);
    v_src_state := 'GSTIN';
  elsif prev.invoice_id is not null then
    v_state := prev.customer_state_code;
    v_src_state := 'PREVIOUS_INVOICE';
  end if;
  if v_state is not null and v_gstin is not null and private.valid_gstin(v_gstin) and left(v_gstin, 2) <> v_state then
    v_warnings := v_warnings || to_jsonb(format('The address says %s but the GSTIN starts with %s (%s). Verify the state before issuing.',
      (select name from public.gst_states where code = v_state), left(v_gstin, 2), (select name from public.gst_states where code = left(v_gstin, 2))));
  end if;
  if v_state is null then
    v_warnings := v_warnings || to_jsonb('The customer''s state could not be worked out. Choose it so the right tax is applied.'::text);
  end if;
  if v_address is null then
    v_warnings := v_warnings || to_jsonb('The customer has no business address on record. Enter it before issuing.'::text);
  end if;
  if c.email is null then
    v_warnings := v_warnings || to_jsonb('The customer has no e-mail address, so the invoice cannot be e-mailed. Add it to the customer first.'::text);
  end if;
  v_treatment := case when v_state is null then null when v_state = private.company_state_code() then 'INTRA_STATE' else 'INTER_STATE' end;

  -- The services of THIS purchase, each once.
  if v_purpose = 'SERVICES' then
    select coalesce(jsonb_agg(jsonb_build_object('serviceCode', s.code, 'particulars', s.name, 'hsnSac', '998313', 'taxRate', 18,
                                                  'quantity', '1 Nos', 'baseAmount', null) order by s.sort_order, s.name), '[]'::jsonb)
      into v_lines
      from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id;
    -- An invoice can be made for each part payment: the invoices of the agreed services together may not exceed the agreed amount.
    select coalesce(sum(g.total_amount), 0) into v_invoiced from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES';
    if v_invoiced > 0 then
      v_warnings := v_warnings || to_jsonb(format('Invoices already issued for the agreed services total %s%s. This invoice, for the next payment, can cover the rest.',
        private.rupees(v_invoiced), case when coalesce(c.deal_amount, 0) > 0 then format(' of the agreed %s', private.rupees(c.deal_amount)) else '' end));
    end if;
    -- The amount comes from this customer's own record: what Sales agreed for the services, less what has already been
    -- invoiced for them, spread over the services of the purchase (so the invoices together never pass the agreed amount).
    if coalesce(c.deal_amount, 0) > 0 then
      if c.deal_amount - v_invoiced > 0 then
        v_lines := private.spread_invoice_total(v_lines, c.deal_amount - v_invoiced);
      else
        v_warnings := v_warnings || to_jsonb(format('The agreed %s has already been invoiced in full, so no amount is filled in.', private.rupees(c.deal_amount)));
      end if;
    end if;
  elsif v_purpose = 'ADDON' then
    if p_addon_request is not null then
      select * into r from public.addon_requests where id = p_addon_request and customer_id = c.id;
    else
      select * into r from public.addon_requests where customer_id = c.id and status = 'APPROVED' order by created_at desc limit 1;
    end if;
    if r.id is null or r.status <> 'APPROVED' then
      raise exception 'CONFLICT: There is no approved add-on request waiting for an invoice for this customer.' using errcode = 'P0001';
    end if;
    -- the approved prices: base = quantity x unit price - discount, with the tax the request was approved with
    select coalesce(jsonb_agg(jsonb_build_object('serviceCode', i.service_code, 'particulars', i.name, 'hsnSac', '998313',
                                                  'taxRate', i.tax_percent, 'quantity', format('%s Nos', i.quantity),
                                                  'baseAmount', i.quantity * i.unit_price - i.discount) order by i.sort_order), '[]'::jsonb)
      into v_lines from public.addon_request_items i where i.request_id = r.id;
  end if;

  select last_value, is_called into v_last, v_called from public.invoice_number_seq;
  v_next := case when v_called then v_last + 1 else v_last end;
  loop
    v_suggest := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_next::text, 5, '0');
    exit when not exists (select 1 from public.member_invoices where lower(invoice_number) = lower(v_suggest));
    v_next := v_next + 1;
  end loop;

  return jsonb_build_object(
    'customerId', c.id, 'customerCode', c.customer_code, 'purpose', v_purpose, 'addonRequestId', r.id,
    'customer', jsonb_build_object('name', v_name, 'businessName', v_business, 'address', v_address, 'contactPerson', v_contact,
      'contactNumber', v_mobile, 'gstin', v_gstin, 'stateCode', v_state,
      'state', (select name from public.gst_states where code = v_state)),
    'sources', jsonb_build_object('businessName', v_src_business, 'address', v_src_address, 'contactPerson', v_src_contact,
      'contactNumber', v_src_mobile, 'gstin', v_src_gstin, 'state', v_src_state),
    'recipientEmail', c.email,
    'taxTreatment', v_treatment,
    'company', jsonb_build_object('name', 'Amuwa Corporation', 'stateCode', private.company_state_code(), 'gstin', private.company_gstin()),
    'suggestedInvoiceNumber', v_suggest,
    'invoiceDate', (now() at time zone 'Asia/Kolkata')::date,
    'orderNumber', 'Verbal', 'terms', '100% Payment Against supply.',
    'lines', v_lines,
    'dealAmount', c.deal_amount,
    'servicesInvoiced', (select coalesce(sum(g.total_amount), 0) from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES'),
    'addonTotal', r.total,
    'existingInvoices', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.invoice_number, 'kind', x.kind, 'status', x.status, 'total', x.amount)
                                    order by x.created_at desc)
                                   from (select * from public.member_invoices i where i.customer_id = c.id and i.kind <> 'MANUAL'
                                          order by i.created_at desc limit 10) x), '[]'::jsonb),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'category', s.category) order by s.sort_order, s.name)
                           from public.crm_services s where s.is_active), '[]'::jsonb),
    'warnings', v_warnings);
end $$;

revoke all on function public.accounts_invoice_prefill(uuid, text, uuid) from public, anon;
grant execute on function public.accounts_invoice_prefill(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261103000100_hr_members_employee_record.sql
-- HR members get their HR employee record at once.
--
-- A login created in the HR department (Department Head, Team Lead or Team Member, from the Super Admin's Add Member form, the
-- API or `npm run create:hr-login`) is linked to its HR employee record (public.hr_employees.profile_id) when the account is
-- created, so the HR dashboard's directory, salary, documents and leave all hang off one record per person. Until now that row
-- appeared only the first time HR edited the person.
--
--  * The record id is the same one the HR directory shows for an account without a record (EMP- + the first 8 characters of the
--    account id), so nothing is listed twice. An existing record (matched by account or by id) is never changed.
--  * It also covers a member moved into the HR department later.
--  * Existing HR members without a record get one now. Nothing is deleted or overwritten.
-- Idempotent.

create or replace function private.link_hr_employee_record(p_profile uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.hr_employees (id, name, email, designation, department_id, status, joining_date, profile_id)
  select 'EMP-' || upper(left(p.id::text, 8)), p.full_name, p.email,
         coalesce(nullif(btrim(p.position), ''), case p.role when 'DEPARTMENT_HEAD' then 'Department Head' when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end),
         'hr', 'Full-Time', to_char(coalesce(p.approved_at, p.created_at), 'YYYY-MM-DD'), p.id
    from public.profiles p join public.departments d on d.id = p.department_id
   where p.id = p_profile and d.slug = 'hr' and p.role <> 'SUPER_ADMIN'
  on conflict do nothing;
end $$;
revoke all on function private.link_hr_employee_record(uuid) from public, anon, authenticated;

create or replace function private.tg_link_hr_employee_record()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.link_hr_employee_record(new.id);
  return new;
end $$;
revoke all on function private.tg_link_hr_employee_record() from public, anon, authenticated;

drop trigger if exists profiles_link_hr_employee_record on public.profiles;
create trigger profiles_link_hr_employee_record after insert or update of department_id on public.profiles
  for each row when (new.department_id is not null) execute function private.tg_link_hr_employee_record();

-- members already in the HR department
do $$
declare
  r record;
begin
  for r in select p.id from public.profiles p join public.departments d on d.id = p.department_id
            where d.slug = 'hr' and p.role <> 'SUPER_ADMIN' loop
    perform private.link_hr_employee_record(r.id);
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261103000100_order_tax_basis.sql
-- One order, one financial model: the agreed amount, GST, the total payable and the balance.
--
-- ROOT CAUSE this fixes. Sales' agreed amount was stored in customers.deal_amount and treated everywhere as the total the customer
-- pays. When the agreement is BEFORE GST (the usual case: 1,20,000 + 18% GST = 1,41,600), the invoice check compared GST-inclusive
-- invoice totals with the pre-GST agreement ("would total 1,41,600 but only 1,20,000 was agreed"), and every payment / balance /
-- status rule (all of which read deal_amount) capped the order at the pre-GST figure, so the balance and the paid status were wrong.
--
-- THE MODEL (nothing is duplicated; deal_amount keeps its meaning for every existing rule):
--   customers.agreed_amount     what Sales agreed, as agreed (NULL: an older agreement, kept exactly as it was)
--   customers.agreed_tax_basis  INCLUSIVE (the agreed amount already has GST in it) or EXCLUSIVE (GST is added)
--   customers.deal_amount       the TOTAL PAYABLE including GST: the agreed amount when INCLUSIVE; when EXCLUSIVE the GST of the invoices
--                               already issued plus the agreed amount not yet invoiced with its GST at the rate of those invoices
--                               (18% until the first invoice). Payments, balances and statuses all read this.
--   total confirmed payments    customers.amount_verified (verified customer_payments only)
--   order balance               deal_amount - amount_verified
--   an invoice's own figures    unchanged (taxable subtotal, GST, total, and what the verified payments cover of it)
-- Older agreements are NOT reinterpreted: they stay INCLUSIVE. Accounts can change an agreement's basis (audited, with a reason).
--
-- Run after 20261102000100_invoice_prefill_agreed_amount.sql (it replaces that migration's accounts_invoice_prefill, keeping its
-- fill-in of the amounts and making it work on the amount before GST when the agreement excludes GST). Safe to run again.

alter table public.customers add column if not exists agreed_amount numeric(14, 2) check (agreed_amount > 0);
alter table public.customers add column if not exists agreed_tax_basis text not null default 'INCLUSIVE' check (agreed_tax_basis in ('INCLUSIVE', 'EXCLUSIVE'));

-- ---------------------------------------------------------------------------
-- The total payable of an agreement that excludes GST
-- ---------------------------------------------------------------------------
create or replace function private.sync_order_payable(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric; v_gst numeric; v_gross numeric; v_rate numeric; v_new numeric;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or c.agreed_amount is null or c.agreed_tax_basis <> 'EXCLUSIVE' then
    return;
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_gst), 0), coalesce(sum(total_amount), 0)
    into v_net, v_gst, v_gross
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  -- the GST rate of what is already invoiced (18% before the first invoice) applies to what is still to invoice
  v_rate := case when v_net > 0 then v_gst / v_net else 0.18 end;
  v_new := round(v_gross + greatest(c.agreed_amount - v_net, 0) * (1 + v_rate), 2);
  -- never below what has already been received
  v_new := greatest(v_new, c.amount_received);
  if c.deal_amount is distinct from v_new then
    update public.customers set deal_amount = v_new where id = c.id;
  end if;
end $$;
revoke all on function private.sync_order_payable(uuid) from public, anon, authenticated;

-- The whole order in one place: what was agreed, the GST, what is payable, what was confirmed, what is left.
create or replace function private.order_summary(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric; v_gst numeric; v_gross numeric;
  v_excl boolean;
  v_payable numeric;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null then
    return null;
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_gst), 0), coalesce(sum(total_amount), 0)
    into v_net, v_gst, v_gross
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  v_excl := c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE';
  v_payable := coalesce(c.deal_amount, 0);
  return jsonb_build_object(
    'basis', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end,
    'agreedAmount', coalesce(c.agreed_amount, c.deal_amount),
    'taxableTotal', case when v_excl then c.agreed_amount end,
    'gstTotal', case when v_excl then round(v_payable - c.agreed_amount, 2) end,
    'totalPayable', v_payable,
    'confirmed', c.amount_verified,
    'pending', greatest(c.amount_received - c.amount_verified, 0),
    'balance', greatest(v_payable - c.amount_verified, 0),
    'state', case when v_payable > 0 and c.amount_verified >= v_payable then 'FULLY_PAID' when c.amount_verified > 0 then 'PARTIALLY_PAID' else 'UNPAID' end,
    'invoicedTaxable', v_net, 'invoicedGst', v_gst, 'invoicedTotal', v_gross,
    -- true while part of the payable (the GST of what is not invoiced yet) is still an estimate
    'estimated', v_excl and c.agreed_amount > v_net);
end $$;
revoke all on function private.order_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invoice validation: compare like with like
-- ---------------------------------------------------------------------------
create or replace function private.tg_generated_invoice_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric;
  v_gross numeric;
begin
  select * into c from public.customers where id = new.customer_id;
  new.payment_ledger := case when new.addon_request_id is not null then 'ADDON'
                             when new.purpose = 'SERVICES' and coalesce(c.deal_amount, 0) > 0 then 'CUSTOMER'
                             else 'INVOICE' end;
  if new.payment_ledger = 'CUSTOMER' then
    select coalesce(sum(g.subtotal), 0), coalesce(sum(g.total_amount), 0) into v_net, v_gross
      from public.generated_invoices g where g.customer_id = new.customer_id and g.payment_ledger = 'CUSTOMER';
    if c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE' then
      -- the agreement excludes GST: the taxable value of all the invoices may not exceed it (the GST is added on top of it)
      if v_net + new.subtotal > c.agreed_amount then
        raise exception 'VALIDATION_ERROR: The invoices of the agreed services would total % before GST but only % was agreed with Sales, excluding GST (already invoiced: %). Lower this invoice, or ask Sales to correct the agreed amount first.',
          private.rupees(v_net + new.subtotal), private.rupees(c.agreed_amount), private.rupees(v_net) using errcode = 'P0001';
      end if;
    elsif v_gross + new.total_amount > c.deal_amount then
      -- the agreement includes GST: compare invoice totals (with GST) with it
      raise exception 'VALIDATION_ERROR: The invoices of the agreed services would total % but only % was agreed with Sales, including GST (already invoiced: %). Lower this invoice, or ask Sales to correct the agreed amount first.',
        private.rupees(v_gross + new.total_amount), private.rupees(c.deal_amount), private.rupees(v_gross) using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_generated_invoice_ledger() from public, anon, authenticated;

-- After an invoice exists, the total payable follows it (its real GST replaces the estimate for that part of the order).
create or replace function private.tg_generated_invoice_order_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_ledger = 'CUSTOMER' then
    perform private.sync_order_payable(new.customer_id);
  end if;
  return null;
end $$;
revoke all on function private.tg_generated_invoice_order_sync() from public, anon, authenticated;
drop trigger if exists generated_invoices_order_sync on public.generated_invoices;
create trigger generated_invoices_order_sync after insert on public.generated_invoices
  for each row execute function private.tg_generated_invoice_order_sync();

-- ---------------------------------------------------------------------------
-- Payments: the same cap as ever (the total payable), paise only for the payment that settles the exact balance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.check_payment_fields(v public.customers, p_exclude uuid, p_type text, p_amount numeric, p_method text, p_reference text, p_paid_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_recorded numeric;
begin
  if p_type is null or p_type not in ('PART', 'FULL') then
    raise exception 'VALIDATION_ERROR: Choose part payment or full payment.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the amount received.' using errcode = 'P0001';
  end if;
  if p_method is null or p_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Select the payment method.' using errcode = 'P0001';
  end if;
  if p_method in ('UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE') and p_reference is null then
    raise exception 'VALIDATION_ERROR: Enter the transaction / reference number.' using errcode = 'P0001';
  end if;
  if p_paid_at > now() + interval '1 hour' then
    raise exception 'VALIDATION_ERROR: The payment date cannot be in the future.' using errcode = 'P0001';
  end if;
  if coalesce(v.deal_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: The agreed amount is not set for this customer.' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into v_recorded from public.customer_payments
   where customer_id = v.id and status in ('PENDING', 'VERIFIED') and id is distinct from p_exclude;
  -- Payments are in whole rupees, except the one that settles the exact balance (the total payable can carry paise from the GST).
  if p_amount <> trunc(p_amount) and v_recorded + p_amount <> v.deal_amount then
    raise exception 'VALIDATION_ERROR: Enter the amount in whole rupees (no paise). Only the payment that settles the exact balance (%) can include paise.', private.rupees(v.deal_amount - v_recorded) using errcode = 'P0001';
  end if;
  if v_recorded + p_amount > v.deal_amount then
    raise exception 'VALIDATION_ERROR: This would exceed the agreed amount. Balance still to receive: %.', private.rupees(v.deal_amount - v_recorded) using errcode = 'P0001';
  end if;
  if p_type = 'FULL' and v_recorded + p_amount <> v.deal_amount then
    raise exception 'VALIDATION_ERROR: A full payment must settle the agreed amount (balance %). Record it as a part payment instead.', private.rupees(v.deal_amount - v_recorded) using errcode = 'P0001';
  end if;
  if p_type = 'PART' and v_recorded + p_amount = v.deal_amount then
    raise exception 'VALIDATION_ERROR: This payment settles the agreed amount. Record it as a full payment.' using errcode = 'P0001';
  end if;
end $function$;


-- An invoice's own figures, and the whole order next to them
create or replace function private.invoice_payment_summary(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.generated_invoices;
  inv public.member_invoices;
  v_sum numeric := 0;
  v_pending numeric := 0;
  v_confirmed numeric;
  v_payments jsonb := '[]'::jsonb;
  v_prior numeric := 0;
begin
  select * into g from public.generated_invoices where invoice_id = p_invoice;
  if g.invoice_id is null then
    return null;
  end if;
  select * into inv from public.member_invoices where id = p_invoice;
  if g.payment_ledger = 'CUSTOMER' then
    select coalesce(sum(amount) filter (where status = 'VERIFIED'), 0), coalesce(sum(amount) filter (where status = 'PENDING'), 0)
      into v_sum, v_pending from public.customer_payments where customer_id = g.customer_id;
    select coalesce(sum(o.total_amount), 0) into v_prior from public.generated_invoices o
     where o.customer_id = g.customer_id and o.payment_ledger = 'CUSTOMER' and (o.issued_at, o.invoice_id) < (g.issued_at, g.invoice_id);
    v_sum := greatest(v_sum - v_prior, 0);
    select coalesce(jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'reference', x.reference, 'paidAt', x.paid_at) order by x.paid_at, x.recorded_at), '[]'::jsonb)
      into v_payments from (select * from public.customer_payments where customer_id = g.customer_id and status = 'VERIFIED' order by paid_at desc, recorded_at desc limit 20) x;
  elsif g.payment_ledger = 'ADDON' then
    select coalesce(sum(amount) filter (where status = 'VERIFIED'), 0), coalesce(sum(amount) filter (where status = 'PENDING'), 0)
      into v_sum, v_pending from public.addon_payments where request_id = inv.addon_request_id;
    select coalesce(jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'reference', x.reference, 'paidAt', x.paid_at) order by x.paid_at, x.recorded_at), '[]'::jsonb)
      into v_payments from (select * from public.addon_payments where request_id = inv.addon_request_id and status = 'VERIFIED' order by paid_at desc, recorded_at desc limit 20) x;
  else
    select coalesce(sum(amount), 0) into v_sum from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED';
    select coalesce(jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'reference', x.reference, 'paidAt', x.paid_on) order by x.paid_on, x.recorded_at), '[]'::jsonb)
      into v_payments from (select * from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED' order by paid_on desc, recorded_at desc limit 20) x;
  end if;
  v_confirmed := case when g.lifecycle = 'PAID' then g.total_amount else least(v_sum, g.total_amount) end;
  return jsonb_build_object(
    'total', g.total_amount, 'confirmed', v_confirmed, 'balance', g.total_amount - v_confirmed,
    'state', case when v_confirmed >= g.total_amount then 'FULLY_PAID' when v_confirmed > 0 then 'PARTIALLY_PAID' else 'UNPAID' end,
    'pending', v_pending, 'ledger', g.payment_ledger, 'payments', v_payments,
    -- the whole agreed order (every invoice of the agreed services together), kept apart from this invoice's own figures
    'order', case when g.payment_ledger = 'CUSTOMER' then private.order_summary(g.customer_id) end);
end $$;
revoke all on function private.invoice_payment_summary(uuid) from public, anon, authenticated;
revoke all on function private.invoice_payment_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sales: Send to Accounts records what was agreed and whether it includes GST
-- ---------------------------------------------------------------------------
drop function if exists public.send_lead_to_accounts(uuid, numeric, text);
create or replace function public.send_lead_to_accounts(p_customer uuid, p_amount numeric, p_note text default null, p_tax_basis text default 'INCLUSIVE')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_basis text := upper(coalesce(nullif(btrim(p_tax_basis), ''), 'INCLUSIVE'));
  v_request uuid;
  v_payable numeric;
begin
  if v_basis not in ('INCLUSIVE', 'EXCLUSIVE') then
    raise exception 'VALIDATION_ERROR: Say whether the agreed amount includes or excludes GST.' using errcode = 'P0001';
  end if;
  if v.lifecycle_stage <> 'LEAD' then
    raise exception 'CONFLICT: Only leads can be sent to Accounts.' using errcode = 'P0001';
  end if;
  if v.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' or exists (
       select 1 from public.payment_requests r where r.customer_id = p_customer and r.status = 'PENDING') then
    raise exception 'CONFLICT: This lead is already with Accounts for payment confirmation.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customer_services s where s.customer_id = p_customer) then
    raise exception 'VALIDATION_ERROR: Select at least one service before sending to Accounts.' using errcode = 'P0001';
  end if;
  if v.phone is null and v.email is null then
    raise exception 'VALIDATION_ERROR: Add a phone number or e-mail before sending to Accounts.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the agreed amount.' using errcode = 'P0001';
  end if;
  if p_amount <> trunc(p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the agreed amount in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  if v_basis = 'INCLUSIVE' and p_amount < v.amount_received then
    raise exception 'VALIDATION_ERROR: The agreed amount cannot be less than the % already recorded.', private.rupees(v.amount_received) using errcode = 'P0001';
  end if;

  insert into public.payment_requests (customer_id, agreed_amount, sales_note, requested_by)
  values (p_customer, p_amount, v_note, (select private.my_id()))
  returning id into v_request;
  -- deal_amount is what the customer has to pay in total (GST included): every payment, balance and status rule keeps reading it.
  -- agreed_amount / agreed_tax_basis keep what Sales actually agreed.
  update public.customers
     set payment_workflow = 'PENDING_PAYMENT_CONFIRMATION', deal_amount = p_amount, agreed_amount = p_amount, agreed_tax_basis = v_basis,
         lead_status = 'READY_TO_BUY'
   where id = p_customer;
  perform private.sync_order_payable(p_customer);
  select deal_amount into v_payable from public.customers where id = p_customer;
  perform private.log_customer_activity(p_customer, 'SENT_TO_ACCOUNTS',
    format('Sent to Accounts for payment confirmation (agreed %s%s)', private.rupees(p_amount), case when v_basis = 'EXCLUSIVE' then ' excluding GST' else '' end) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('PAYMENT_SENT_TO_ACCOUNTS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', v_request, 'agreed_amount', p_amount, 'tax_basis', v_basis, 'payable', v_payable, 'note', v_note));
  perform private.notify_accounts('PAYMENT_CONFIRMATION_REQUESTED', format('Confirm payment: %s', coalesce(v.company, v.name)),
    format('Sales sent a customer for payment confirmation (agreed %s%s).', private.rupees(p_amount), case when v_basis = 'EXCLUSIVE' then ' excluding GST' else '' end), p_customer);
  return v_request;
end $$;
revoke all on function public.send_lead_to_accounts(uuid, numeric, text, text) from public, anon;
grant execute on function public.send_lead_to_accounts(uuid, numeric, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Accounts: correct the basis of an agreement (audited; older agreements are never reinterpreted silently)
-- ---------------------------------------------------------------------------
create or replace function public.accounts_set_agreement_basis(p_customer uuid, p_basis text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_basis text := upper(coalesce(nullif(btrim(p_basis), ''), ''));
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_agreed numeric;
  v_net numeric; v_gross numeric;
begin
  perform private.require_accounts_staff();
  if p_customer is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_basis not in ('INCLUSIVE', 'EXCLUSIVE') then
    raise exception 'VALIDATION_ERROR: Say whether the agreed amount includes or excludes GST.' using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'VALIDATION_ERROR: Say why the agreement is being changed (at least 5 characters).' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  if coalesce(c.deal_amount, 0) <= 0 then
    raise exception 'CONFLICT: No amount has been agreed for this customer yet.' using errcode = 'P0001';
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_amount), 0) into v_net, v_gross
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  v_agreed := coalesce(c.agreed_amount, c.deal_amount);
  if v_basis = coalesce(case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end, 'INCLUSIVE') then
    raise exception 'CONFLICT: The agreement already has this basis.' using errcode = 'P0001';
  end if;
  if v_basis = 'EXCLUSIVE' then
    -- the figure on record is taken to be the amount BEFORE GST
    if v_net > v_agreed then
      raise exception 'CONFLICT: The invoices already issued total % before GST, more than the amount on record (%). Correct the agreed amount first.', private.rupees(v_net), private.rupees(v_agreed) using errcode = 'P0001';
    end if;
    update public.customers set agreed_amount = v_agreed, agreed_tax_basis = 'EXCLUSIVE' where id = c.id;
    perform private.sync_order_payable(c.id);
  else
    -- the amount on record is taken to be the TOTAL including GST
    if v_agreed < greatest(c.amount_received, v_gross) then
      raise exception 'CONFLICT: The amount on record (%) is below what was already received or invoiced (%).', private.rupees(v_agreed), private.rupees(greatest(c.amount_received, v_gross)) using errcode = 'P0001';
    end if;
    update public.customers set agreed_amount = v_agreed, agreed_tax_basis = 'INCLUSIVE', deal_amount = v_agreed where id = c.id;
  end if;
  perform private.log_customer_activity(c.id, 'AGREEMENT_BASIS_CHANGED',
    format('Accounts set the agreed amount (%s) to %s GST · %s', private.rupees(v_agreed), case when v_basis = 'EXCLUSIVE' then 'excluding' else 'including' end, v_reason));
  perform private.write_audit('AGREEMENT_BASIS_CHANGED', 'customer', c.id, c.department_id, c.team_id,
    jsonb_build_object('from', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end, 'to', v_basis, 'agreed_amount', v_agreed,
                       'deal_amount_before', c.deal_amount, 'reason', v_reason));
  return private.order_summary(c.id);
end $$;
revoke all on function public.accounts_set_agreement_basis(uuid, text, text) from public, anon;
grant execute on function public.accounts_set_agreement_basis(uuid, text, text) to authenticated;

-- Agreements made before this change are not guessed at. This lists every customer who already has an invoice for the agreed services
-- under such an agreement, so Accounts can confirm each one (and use accounts_set_agreement_basis where the amount was before GST).
create or replace function public.accounts_agreement_review()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name), 'totalPayableOnRecord', c.deal_amount,
      'invoicedTaxable', x.net, 'invoicedTotal', x.gross, 'invoices', x.n, 'confirmedPayments', c.amount_verified,
      'note', case when x.net * 1.0 >= c.deal_amount * 0.5 then 'Invoices already cover half or more of the amount on record: check whether it was meant to be before GST.'
                   else 'Amount on record is treated as the total including GST.' end) order by c.customer_code)
      from public.customers c
      join (select customer_id, sum(subtotal) net, sum(total_amount) gross, count(*) n from public.generated_invoices
             where payment_ledger = 'CUSTOMER' group by customer_id) x on x.customer_id = c.id
     where c.agreed_amount is null), '[]'::jsonb);
end $$;
revoke all on function public.accounts_agreement_review() from public, anon;
grant execute on function public.accounts_agreement_review() to authenticated;

-- ---------------------------------------------------------------------------
-- What the screens read
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_payment_overview(p_customer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.customers;
  v_accounts boolean := private.accounts_can_view(p_customer);
begin
  if not (v_accounts or private.can_access_customer(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  return jsonb_build_object(
    'customerId', v.id,
    'workflow', v.payment_workflow,
    'dealAmount', v.deal_amount,
    'agreedAmount', coalesce(v.agreed_amount, v.deal_amount),
    'taxBasis', case when v.agreed_amount is null then 'INCLUSIVE' else v.agreed_tax_basis end,
    'order', private.order_summary(v.id),
    'recorded', v.amount_received,
    'verified', v.amount_verified,
    'pending', coalesce((select sum(amount) from public.customer_payments where customer_id = v.id and status = 'PENDING'), 0),
    'balance', greatest(coalesce(v.deal_amount, 0) - v.amount_verified, 0),
    'paymentStatus', v.payment_status,
    'accountsOwner', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = v.accounts_owner_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'type', p.payment_type, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
        'paidAt', p.paid_at, 'status', p.status, 'source', p.source, 'note', p.note, 'statusReason', p.status_reason,
        'recordedBy', (select full_name from public.profiles where id = p.recorded_by), 'recordedAt', p.recorded_at,
        'verifiedBy', (select full_name from public.profiles where id = p.verified_by), 'verifiedAt', p.verified_at)
        order by p.paid_at desc, p.recorded_at desc)
      from public.customer_payments p where p.customer_id = v.id), '[]'::jsonb),
    'request', (select jsonb_build_object(
        'id', r.id, 'status', r.status, 'agreedAmount', r.agreed_amount, 'salesNote', r.sales_note,
        'requestedAt', r.requested_at, 'requestedBy', (select full_name from public.profiles where id = r.requested_by),
        'resolvedAt', r.resolved_at, 'resolvedBy', (select full_name from public.profiles where id = r.resolved_by),
        'resolutionNote', r.resolution_note)
      from public.payment_requests r where r.customer_id = v.id order by r.requested_at desc limit 1),
    'followUps', case when v_accounts then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'outcome', f.outcome, 'note', f.note, 'contactedAt', f.contacted_at, 'nextFollowUpAt', f.next_follow_up_at,
        'author', (select full_name from public.profiles where id = f.author_id))
        order by f.contacted_at desc)
      from public.payment_followups f where f.customer_id = v.id), '[]'::jsonb) else null end,
    'isAccounts', v_accounts);
end $function$;

create or replace function public.accounts_payment_requests(p_status text default 'PENDING', p_search text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total integer;
  v_items jsonb;
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can see payment confirmations.' using errcode = '42501';
  end if;
  if coalesce(p_status, 'PENDING') not in ('PENDING', 'CONFIRMED', 'RETURNED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;

  select count(*) into v_total
    from public.payment_requests r join public.customers c on c.id = r.customer_id
   where r.status = coalesce(p_status, 'PENDING')
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%');

  select coalesce(jsonb_agg(row_json order by sort_at desc), '[]'::jsonb) into v_items from (
    select coalesce(r.resolved_at, r.requested_at) as sort_at,
      jsonb_build_object(
        'requestId', r.id, 'id', c.id, 'code', c.customer_code, 'name', c.name, 'company', c.company, 'email', c.email,
        'phone', c.phone, 'whatsapp', c.whatsapp, 'city', c.city, 'notes', c.notes,
        'salesperson', (select p.full_name from public.profiles p where p.id = c.owner_id),
        'services', coalesce((select jsonb_agg(s.name order by s.sort_order)
                                from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                               where cs.customer_id = c.id), '[]'::jsonb),
        'lastConversation', (select jsonb_build_object('note', l.note, 'at', l.occurred_at)
                               from public.lead_conversations l where l.customer_id = c.id order by l.occurred_at desc, l.created_at desc limit 1),
        'status', r.status, 'agreedAmount', r.agreed_amount, 'payableAmount', c.deal_amount,
        'taxBasis', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end, 'salesNote', r.sales_note,
        'sentAt', r.requested_at, 'sentBy', (select full_name from public.profiles where id = r.requested_by),
        'sentFrom', (select t.division::text from public.profiles p join public.teams t on t.id = p.team_id where p.id = r.requested_by),
        'resolvedAt', r.resolved_at, 'resolvedBy', (select full_name from public.profiles where id = r.resolved_by),
        'resolutionNote', r.resolution_note,
        'amountVerified', c.amount_verified, 'amountRecorded', c.amount_received,
        'balance', greatest(coalesce(c.deal_amount, r.agreed_amount) - c.amount_verified, 0), 'paymentStatus', c.payment_status,
        'stage', c.lifecycle_stage,
        'journey', private.customer_journey(c.id),
        'clientLogin', case when exists (select 1 from public.customer_client_accounts a where a.customer_id = c.id) then 'CREATED'
                            else coalesce((select pr.status from public.customer_client_provisioning pr where pr.customer_id = c.id), 'NOT_STARTED') end) as row_json
      from public.payment_requests r join public.customers c on c.id = r.customer_id
     where r.status = coalesce(p_status, 'PENDING')
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
     order by coalesce(r.resolved_at, r.requested_at) desc
     limit v_size offset (v_page - 1) * v_size
  ) page;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.accounts_payment_requests(text, text, integer, integer) from public, anon;
grant execute on function public.accounts_payment_requests(text, text, integer, integer) to authenticated;

create or replace function public.accounts_invoice_prefill(p_customer uuid, p_purpose text default 'SERVICES', p_addon_request uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  r public.addon_requests;
  prev public.generated_invoices;
  v_purpose text := upper(coalesce(nullif(btrim(p_purpose), ''), 'SERVICES'));
  v_name text; v_business text; v_address text; v_contact text; v_mobile text; v_gstin text; v_state text;
  v_src_business text := 'NONE'; v_src_address text := 'NONE'; v_src_contact text := 'NONE'; v_src_mobile text := 'NONE';
  v_src_gstin text := 'NONE'; v_src_state text := 'NONE';
  v_lines jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_next bigint; v_last bigint; v_called boolean; v_suggest text;
  v_treatment text;
  v_invoiced numeric := 0;
  v_invoiced_net numeric := 0;
  v_excl boolean;
  v_left_net numeric;
begin
  perform private.require_accounts_staff();
  if p_customer is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_purpose not in ('SERVICES', 'ADDON', 'ADDITIONAL') then
    raise exception 'VALIDATION_ERROR: Choose what this invoice is for.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  v_excl := c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE';

  -- Business name / address / contact / mobile: what was collected in onboarding first (the onboarding cards and the customer
  -- record are kept in step, so they normally agree), then the customer record. Nothing is invented.
  select nullif(btrim(e.value), '') into v_business from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'BUSINESS_NAME' and e.status in ('SAVED', 'VERIFIED');
  if v_business is not null then v_src_business := 'ONBOARDING';
  else
    v_business := nullif(btrim(c.company), '');
    if v_business is not null then v_src_business := 'CUSTOMER'; end if;
  end if;
  select nullif(btrim(e.value), '') into v_address from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'BUSINESS_ADDRESS' and e.status in ('SAVED', 'VERIFIED');
  if v_address is not null then v_src_address := 'ONBOARDING';
  else
    v_address := nullif(btrim(c.address), '');
    if v_address is not null then v_src_address := 'CUSTOMER'; end if;
  end if;
  select nullif(btrim(e.value), '') into v_contact from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'CUSTOMER_NAME' and e.status in ('SAVED', 'VERIFIED');
  if v_contact is not null then v_src_contact := 'ONBOARDING';
  else
    v_contact := nullif(btrim(c.name), '');
    if v_contact is not null then v_src_contact := 'CUSTOMER'; end if;
  end if;
  v_name := coalesce(nullif(btrim(c.name), ''), v_contact);
  v_mobile := nullif(btrim(c.phone), '');
  if v_mobile is not null then
    v_src_mobile := 'CUSTOMER';
  else
    select nullif(btrim(e.value), '') into v_mobile from public.customer_onboarding_entries e
     where e.customer_id = c.id and e.item_code = 'CUSTOMER_MOBILE' and e.status in ('SAVED', 'VERIFIED');
    if v_mobile is not null then v_src_mobile := 'ONBOARDING'; end if;
  end if;

  -- GSTIN: there is no structured GST field on the customer, so the only structured source is the customer's own previous
  -- invoice. Otherwise it stays blank for Accounts to enter (no extraction from uploaded documents).
  select * into prev from public.generated_invoices g where g.customer_id = c.id order by g.issued_at desc limit 1;
  if prev.invoice_id is not null and prev.customer_gstin is not null then
    v_gstin := prev.customer_gstin;
    v_src_gstin := 'PREVIOUS_INVOICE';
  end if;
  -- State: the address first, then the GSTIN prefix, then the previous invoice. When two of these disagree Accounts is warned.
  v_state := private.infer_state_code(v_address);
  if v_state is not null then
    v_src_state := 'ADDRESS';
  elsif v_gstin is not null and private.valid_gstin(v_gstin) then
    v_state := left(v_gstin, 2);
    v_src_state := 'GSTIN';
  elsif prev.invoice_id is not null then
    v_state := prev.customer_state_code;
    v_src_state := 'PREVIOUS_INVOICE';
  end if;
  if v_state is not null and v_gstin is not null and private.valid_gstin(v_gstin) and left(v_gstin, 2) <> v_state then
    v_warnings := v_warnings || to_jsonb(format('The address says %s but the GSTIN starts with %s (%s). Verify the state before issuing.',
      (select name from public.gst_states where code = v_state), left(v_gstin, 2), (select name from public.gst_states where code = left(v_gstin, 2))));
  end if;
  if v_state is null then
    v_warnings := v_warnings || to_jsonb('The customer''s state could not be worked out. Choose it so the right tax is applied.'::text);
  end if;
  if v_address is null then
    v_warnings := v_warnings || to_jsonb('The customer has no business address on record. Enter it before issuing.'::text);
  end if;
  if c.email is null then
    v_warnings := v_warnings || to_jsonb('The customer has no e-mail address, so the invoice cannot be e-mailed. Add it to the customer first.'::text);
  end if;
  v_treatment := case when v_state is null then null when v_state = private.company_state_code() then 'INTRA_STATE' else 'INTER_STATE' end;

  -- The services of THIS purchase, each once.
  if v_purpose = 'SERVICES' then
    select coalesce(jsonb_agg(jsonb_build_object('serviceCode', s.code, 'particulars', s.name, 'hsnSac', '998313', 'taxRate', 18,
                                                  'quantity', '1 Nos', 'baseAmount', null) order by s.sort_order, s.name), '[]'::jsonb)
      into v_lines
      from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id;
    -- An invoice can be made for each part payment. When the agreement excludes GST the amounts before GST are compared with it
    -- (the GST is added on top); otherwise the invoice totals with GST are compared with the agreed amount.
    select coalesce(sum(g.subtotal), 0), coalesce(sum(g.total_amount), 0) into v_invoiced_net, v_invoiced
      from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES';
    if v_invoiced > 0 then
      v_warnings := v_warnings || to_jsonb(
        case when v_excl
             then format('Invoices already issued for the agreed services total %s before GST (%s with GST) of the agreed %s excluding GST. This invoice can cover the rest.',
                         private.rupees(v_invoiced_net), private.rupees(v_invoiced), private.rupees(c.agreed_amount))
             else format('Invoices already issued for the agreed services total %s%s. This invoice, for the next payment, can cover the rest.',
                         private.rupees(v_invoiced), case when coalesce(c.deal_amount, 0) > 0 then format(' of the agreed %s (including GST)', private.rupees(c.deal_amount)) else '' end) end);
    end if;
    -- The amount comes from this customer's own record: what Sales agreed for the services, less what has already been
    -- invoiced for them, spread over the services of the purchase (so the invoices together never pass the agreed amount).
    if v_excl then
      v_left_net := c.agreed_amount - v_invoiced_net;
      if v_left_net > 0 then
        -- the amounts are before GST: spread the balance with its GST (at the rate of the lines), so the bases add up to the balance
        v_lines := private.spread_invoice_total(v_lines, round(v_left_net * 1.18, 2));
      else
        v_warnings := v_warnings || to_jsonb(format('The agreed %s (excluding GST) has already been invoiced in full, so no amount is filled in.', private.rupees(c.agreed_amount)));
      end if;
    elsif coalesce(c.deal_amount, 0) > 0 then
      if c.deal_amount - v_invoiced > 0 then
        v_lines := private.spread_invoice_total(v_lines, c.deal_amount - v_invoiced);
      else
        v_warnings := v_warnings || to_jsonb(format('The agreed %s has already been invoiced in full, so no amount is filled in.', private.rupees(c.deal_amount)));
      end if;
    end if;
  elsif v_purpose = 'ADDON' then
    if p_addon_request is not null then
      select * into r from public.addon_requests where id = p_addon_request and customer_id = c.id;
    else
      select * into r from public.addon_requests where customer_id = c.id and status = 'APPROVED' order by created_at desc limit 1;
    end if;
    if r.id is null or r.status <> 'APPROVED' then
      raise exception 'CONFLICT: There is no approved add-on request waiting for an invoice for this customer.' using errcode = 'P0001';
    end if;
    -- the approved prices: base = quantity x unit price - discount, with the tax the request was approved with
    select coalesce(jsonb_agg(jsonb_build_object('serviceCode', i.service_code, 'particulars', i.name, 'hsnSac', '998313',
                                                  'taxRate', i.tax_percent, 'quantity', format('%s Nos', i.quantity),
                                                  'baseAmount', i.quantity * i.unit_price - i.discount) order by i.sort_order), '[]'::jsonb)
      into v_lines from public.addon_request_items i where i.request_id = r.id;
  end if;

  select last_value, is_called into v_last, v_called from public.invoice_number_seq;
  v_next := case when v_called then v_last + 1 else v_last end;
  loop
    v_suggest := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_next::text, 5, '0');
    exit when not exists (select 1 from public.member_invoices where lower(invoice_number) = lower(v_suggest));
    v_next := v_next + 1;
  end loop;

  return jsonb_build_object(
    'customerId', c.id, 'customerCode', c.customer_code, 'purpose', v_purpose, 'addonRequestId', r.id,
    'customer', jsonb_build_object('name', v_name, 'businessName', v_business, 'address', v_address, 'contactPerson', v_contact,
      'contactNumber', v_mobile, 'gstin', v_gstin, 'stateCode', v_state,
      'state', (select name from public.gst_states where code = v_state)),
    'sources', jsonb_build_object('businessName', v_src_business, 'address', v_src_address, 'contactPerson', v_src_contact,
      'contactNumber', v_src_mobile, 'gstin', v_src_gstin, 'state', v_src_state),
    'recipientEmail', c.email,
    'taxTreatment', v_treatment,
    'company', jsonb_build_object('name', 'Amuwa Corporation', 'stateCode', private.company_state_code(), 'gstin', private.company_gstin()),
    'suggestedInvoiceNumber', v_suggest,
    'invoiceDate', (now() at time zone 'Asia/Kolkata')::date,
    'orderNumber', 'Verbal', 'terms', '100% Payment Against supply.',
    'lines', v_lines,
    'dealAmount', c.deal_amount,
    'servicesInvoiced', (select coalesce(sum(g.total_amount), 0) from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES'),
    'servicesInvoicedTaxable', (select coalesce(sum(g.subtotal), 0) from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES'),
    'agreedAmount', coalesce(c.agreed_amount, c.deal_amount),
    'agreedTaxBasis', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end,
    'order', private.order_summary(c.id),
    'addonTotal', r.total,
    'existingInvoices', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.invoice_number, 'kind', x.kind, 'status', x.status, 'total', x.amount)
                                    order by x.created_at desc)
                                   from (select * from public.member_invoices i where i.customer_id = c.id and i.kind <> 'MANUAL'
                                          order by i.created_at desc limit 10) x), '[]'::jsonb),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'category', s.category) order by s.sort_order, s.name)
                           from public.crm_services s where s.is_active), '[]'::jsonb),
    'warnings', v_warnings);
end $$;
revoke all on function public.accounts_invoice_prefill(uuid, text, uuid) from public, anon;
grant execute on function public.accounts_invoice_prefill(uuid, text, uuid) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261104000100_business_attribution_reports.sql
-- Department-wise business attribution and the Accounts Sales / Support business reports.
--
-- Safe to run again in the Supabase SQL editor. Run it after 20261103000100_order_tax_basis.sql.
--
-- What this adds (and what it deliberately does not):
--   * NO new money tables. Every figure is read from the payment records that already exist, so nothing can be counted twice:
--       customer_payments  the payments of the services Sales agreed with the customer            -> INITIAL SALE  -> Sales
--       addon_payments     the payments of approved add-on requests                              -> ADD-ON        -> Support
--       invoice_payments   payments recorded on an invoice itself:
--                            SERVICES invoice                                                    -> INITIAL SALE  -> Sales
--                            ADDON invoice                                                       -> ADD-ON        -> Support
--                            ADDITIONAL invoice tagged Renewal / Add-on by Accounts              -> RENEWAL / ADD-ON -> Support
--                            ADDITIONAL invoice nobody has tagged                                -> UNCLASSIFIED (counted in neither)
--       customer_plans     a monthly plan Accounts activated as paid                             -> SUBSCRIPTION  -> Support
--   * invoice_business_tags: the one small extension. The system has no renewal transaction of its own (only renewal DATES), so
--     Accounts says which additional invoice is a renewal (or an add-on bought outside the add-on workflow). The tag can also
--     name the Support member who asked for the invoice (an invoice request), which is how a renewal gets its responsible employee.
--   * private.business_ledger() / private.business_orders(): the single definition of every figure. The dashboards, the employee
--     tables and the transaction list all read these, so they always agree.
--   * business_report(), business_report_transactions(): the Accounts department (it already sees every department's income)
--     and the Super Admin only.
--
-- Accounting basis (unchanged, same as Accounts' income): CASH. A figure counts as collected only when its payment is VERIFIED.
-- An unpaid or pending invoice is never collected revenue; it is shown as pending / outstanding.
--   collected    verified payments (money received)
--   pending      payments recorded but not yet verified by Accounts
--   refunded     payments that were REVERSED (taken back out of collected)
--   billed       what was agreed / invoiced for the orders in the range (Sales: the agreed amount; add-on: the add-on total;
--                renewal: the invoice total)
--   outstanding  billed - collected, never below zero, for those orders as of now
-- Rejected payments are not money and appear in none of these.
--
-- Who is responsible (never guessed; blank means "not recorded", listed for review):
--   Initial sale   the Sales member who submitted the sale for payment confirmation (payment_requests.requested_by, unless Accounts
--                  sent it back); a payment
--                  Sales recorded itself falls back to whoever recorded it. The customer's CURRENT owner is never used, so
--                  reassigning a customer does not move old sales.
--   Add-on         the member who submitted the add-on request (then its creator, then its Technical Consultant)
--   Renewal        the Support member whose invoice request Accounts linked when tagging the invoice
--   Plan           not recorded by the workflow

-- ---------------------------------------------------------------------------
-- 1. Accounts tags an additional invoice as a renewal / add-on
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_business_tags (
  invoice_id uuid primary key references public.member_invoices (id) on delete cascade,
  kind text not null check (kind in ('RENEWAL', 'ADDON', 'OTHER')),
  service_code text references public.crm_services (code) on delete set null,
  invoice_request_id uuid references public.invoice_requests (id) on delete set null,
  responsible_id uuid references public.profiles (id) on delete set null,
  note text check (length(note) <= 500),
  tagged_by uuid references public.profiles (id) on delete set null,
  tagged_at timestamptz not null default now()
);
alter table public.invoice_business_tags enable row level security;
revoke all on public.invoice_business_tags from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Access: the Accounts department and the Super Admin
-- ---------------------------------------------------------------------------
create or replace function private.can_view_business_reports()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff()
$$;
revoke all on function private.can_view_business_reports() from public, anon;
grant execute on function private.can_view_business_reports() to authenticated;

create or replace function private.require_business_reports()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_business_reports() then
    raise exception 'FORBIDDEN: Only the Accounts department can see the business reports.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_business_reports() from public, anon;
grant execute on function private.require_business_reports() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The ledger: one row per payment event, classified once
-- ---------------------------------------------------------------------------
create or replace function private.business_ledger()
returns table (tx_key text, source text, source_id uuid, customer_id uuid, department_id uuid, division text, tx_type text,
               amount numeric, status text, occurred_at timestamptz, employee_id uuid, service text, reference text, method text,
               order_key text)
language sql stable security definer set search_path = '' as $$
  -- initial sale: the payments of the agreed services
  select 'CP:' || p.id::text, 'CUSTOMER_PAYMENT', p.id, p.customer_id, c.department_id, 'SALES'::text, 'INITIAL_SALE'::text, p.amount,
         case p.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' when 'REVERSED' then 'REFUNDED' else 'REJECTED' end,
         p.paid_at,
         coalesce(pr.requested_by, case when p.source = 'SALES' then p.recorded_by end, fr.requested_by),
         null::text, p.reference, p.method, 'SALE:' || p.customer_id::text
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.payment_requests pr on pr.id = p.request_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = p.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- add-on purchases: always Support, whichever department onboarded the customer
  select 'AP:' || a.id::text, 'ADDON_PAYMENT', a.id, a.customer_id, c.department_id, 'SUPPORT', 'ADDON', a.amount,
         case a.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' else 'REJECTED' end,
         a.paid_at, coalesce(r.submitted_by, r.created_by, r.consultant_id),
         (select string_agg(i.name, ', ' order by i.sort_order) from public.addon_request_items i where i.request_id = r.id),
         a.reference, a.method, 'ADDON:' || r.id::text
    from public.addon_payments a
    join public.addon_requests r on r.id = a.request_id
    join public.customers c on c.id = a.customer_id
  union all
  -- payments recorded on the invoice itself
  select 'IP:' || ip.id::text, 'INVOICE_PAYMENT', ip.id, ip.customer_id, c.department_id,
         case when g.purpose = 'SERVICES' then 'SALES' when g.purpose = 'ADDON' or t.kind in ('ADDON', 'RENEWAL') then 'SUPPORT' end,
         case when g.purpose = 'SERVICES' then 'INITIAL_SALE' when g.purpose = 'ADDON' or t.kind = 'ADDON' then 'ADDON'
              when t.kind = 'RENEWAL' then 'RENEWAL' else 'UNCLASSIFIED' end,
         ip.amount, case ip.status when 'VERIFIED' then 'COLLECTED' else 'REFUNDED' end,
         (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz,
         case when g.purpose = 'SERVICES' then fr.requested_by when g.purpose = 'ADDITIONAL' then t.responsible_id end,
         (select s.name from public.crm_services s where s.code = t.service_code), ip.reference, ip.method, 'INV:' || ip.invoice_id::text
    from public.invoice_payments ip
    join public.generated_invoices g on g.invoice_id = ip.invoice_id
    join public.customers c on c.id = ip.customer_id
    left join public.invoice_business_tags t on t.invoice_id = ip.invoice_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = ip.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- a monthly plan Accounts activated as paid
  select 'PL:' || cp.id::text, 'PLAN_ACTIVATION', cp.id, cp.customer_id, c.department_id, 'SUPPORT', 'SUBSCRIPTION', cp.price_at_start,
         'COLLECTED', cp.started_at::timestamp at time zone 'Asia/Kolkata', null::uuid,
         (select p.name from public.monthly_plans p where p.id = cp.plan_id), null::text, null::text, 'PLAN:' || cp.id::text
    from public.customer_plans cp
    join public.customers c on c.id = cp.customer_id
   where cp.payment_status = 'PAID' and cp.price_at_start > 0
$$;
revoke all on function private.business_ledger() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The orders: what was agreed / invoiced (for billed and outstanding)
-- ---------------------------------------------------------------------------
create or replace function private.business_orders()
returns table (order_key text, division text, order_type text, customer_id uuid, department_id uuid, employee_id uuid,
               billed numeric, billed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- the services Sales agreed with the customer
  select 'SALE:' || c.id::text, 'SALES'::text, 'INITIAL_SALE'::text, c.id, c.department_id, fr.requested_by, c.deal_amount,
         coalesce(fr.resolved_at, (select min(p.recorded_at) from public.customer_payments p where p.customer_id = c.id))
    from public.customers c
    left join lateral (select x.requested_by, x.resolved_at from public.payment_requests x
                        where x.customer_id = c.id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where coalesce(c.deal_amount, 0) > 0
     and (fr.requested_by is not null or exists (select 1 from public.payment_requests x where x.customer_id = c.id and x.status <> 'RETURNED')
          or exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status <> 'REJECTED'))
  union all
  -- a services invoice whose payments are recorded on the invoice (the customer has no agreed amount)
  select 'INV:' || g.invoice_id::text, 'SALES', 'INITIAL_SALE', g.customer_id, c.department_id, fr.requested_by, g.total_amount,
         g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.customers c on c.id = g.customer_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = g.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where g.purpose = 'SERVICES' and g.payment_ledger = 'INVOICE'
  union all
  -- approved add-ons that were invoiced
  select 'ADDON:' || r.id::text, 'SUPPORT', 'ADDON', r.customer_id, c.department_id, coalesce(r.submitted_by, r.created_by, r.consultant_id), r.total,
         coalesce((select g.invoice_date::timestamp at time zone 'Asia/Kolkata' from public.generated_invoices g where g.addon_request_id = r.id limit 1),
                  r.decided_at, r.submitted_at, r.created_at)
    from public.addon_requests r
    join public.customers c on c.id = r.customer_id
   where r.status in ('INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') and r.total > 0
  union all
  -- additional invoices Accounts tagged as renewal / add-on
  select 'INV:' || g.invoice_id::text, 'SUPPORT', case t.kind when 'RENEWAL' then 'RENEWAL' else 'ADDON' end, g.customer_id, c.department_id,
         t.responsible_id, g.total_amount, g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.invoice_business_tags t on t.invoice_id = g.invoice_id and t.kind in ('RENEWAL', 'ADDON')
    join public.customers c on c.id = g.customer_id
   where g.purpose = 'ADDITIONAL'
$$;
revoke all on function private.business_orders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Filters (shared by every report, so the summary, the employee tables and the list always agree)
-- ---------------------------------------------------------------------------
create or replace function private.business_day_start(p_day date)
returns timestamptz language sql immutable set search_path = '' as $$
  select case when p_day is null then null else p_day::timestamp at time zone 'Asia/Kolkata' end
$$;

create or replace function private.business_ledger_filtered(
  p_from date, p_to date, p_department uuid, p_division text, p_employee uuid, p_type text, p_status text)
returns table (tx_key text, source text, source_id uuid, customer_id uuid, department_id uuid, division text, tx_type text,
               amount numeric, status text, occurred_at timestamptz, employee_id uuid, service text, reference text, method text,
               order_key text)
language sql stable security definer set search_path = '' as $$
  select l.* from private.business_ledger() l
   where (p_from is null or l.occurred_at >= private.business_day_start(p_from))
     and (p_to is null or l.occurred_at < private.business_day_start(p_to + 1))
     and (p_department is null or l.department_id = p_department)
     and (p_division is null or l.division = p_division)
     and (p_employee is null or l.employee_id = p_employee)
     and (p_type is null or l.tx_type = p_type)
     and (p_status is null or l.status = p_status)
$$;
revoke all on function private.business_ledger_filtered(date, date, uuid, text, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Summary report
-- ---------------------------------------------------------------------------
create or replace function public.business_report(
  p_from date default null, p_to date default null, p_department uuid default null, p_division text default null,
  p_employee uuid default null, p_type text default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_div text := upper(nullif(btrim(coalesce(p_division, '')), ''));
  v_type text := upper(nullif(btrim(coalesce(p_type, '')), ''));
  v_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  v jsonb;
begin
  perform private.require_business_reports();
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_div is not null and v_div not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_type is not null and v_type not in ('INITIAL_SALE', 'ADDON', 'RENEWAL', 'SUBSCRIPTION', 'UNCLASSIFIED') then
    raise exception 'VALIDATION_ERROR: Unknown transaction type.' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('COLLECTED', 'PENDING', 'REFUNDED') then
    raise exception 'VALIDATION_ERROR: Unknown payment status.' using errcode = 'P0001';
  end if;

  with l as materialized (
    select * from private.business_ledger_filtered(p_from, p_to, p_department, v_div, p_employee, v_type, v_status)
     where status <> 'REJECTED'),
  o as materialized (
    select o.*, coalesce(s.collected, 0) as collected, coalesce(s.pending, 0) as pending
      from private.business_orders() o
      left join (select order_key, sum(amount) filter (where status = 'COLLECTED') collected, sum(amount) filter (where status = 'PENDING') pending
                   from private.business_ledger() group by order_key) s on s.order_key = o.order_key
     where (p_from is null or o.billed_at >= private.business_day_start(p_from))
       and (p_to is null or o.billed_at < private.business_day_start(p_to + 1))
       and (p_department is null or o.department_id = p_department)
       and (v_div is null or o.division = v_div)
       and (p_employee is null or o.employee_id = p_employee)
       and (v_type is null or o.order_type = v_type)),
  by_type as (
    select division, tx_type,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected, coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending,
           coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded, count(*) filter (where status = 'COLLECTED') n,
           count(distinct customer_id) filter (where status = 'COLLECTED') customers
      from l group by division, tx_type),
  by_emp as (
    select division, employee_id,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected, coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending,
           coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded, count(*) filter (where status = 'COLLECTED') n,
           count(distinct customer_id) filter (where status = 'COLLECTED') customers
      from l where division is not null group by division, employee_id),
  by_dept as (
    select department_id,
           coalesce(sum(amount) filter (where division = 'SALES' and status = 'COLLECTED'), 0) sales_collected,
           coalesce(sum(amount) filter (where division = 'SALES' and status = 'PENDING'), 0) sales_pending,
           coalesce(sum(amount) filter (where division = 'SALES' and status = 'REFUNDED'), 0) sales_refunded,
           count(*) filter (where division = 'SALES' and status = 'COLLECTED') sales_n,
           coalesce(sum(amount) filter (where division = 'SUPPORT' and status = 'COLLECTED'), 0) support_collected,
           coalesce(sum(amount) filter (where division = 'SUPPORT' and status = 'PENDING'), 0) support_pending,
           coalesce(sum(amount) filter (where division = 'SUPPORT' and status = 'REFUNDED'), 0) support_refunded,
           count(*) filter (where division = 'SUPPORT' and status = 'COLLECTED') support_n
      from l where division is not null group by department_id),
  ord_type as (
    select division, order_type, count(*) orders, coalesce(sum(billed), 0) billed, coalesce(sum(greatest(billed - collected, 0)), 0) outstanding
      from o group by division, order_type),
  ord_emp as (
    select division, employee_id, count(*) orders, coalesce(sum(billed), 0) billed, coalesce(sum(greatest(billed - collected, 0)), 0) outstanding
      from o group by division, employee_id)
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('departmentId', p_department, 'division', v_div, 'employeeId', p_employee, 'type', v_type, 'status', v_status),
    'sections', coalesce((
      select jsonb_object_agg(lower(d.division), jsonb_build_object(
        'collected', coalesce((select sum(collected) from by_type t where t.division = d.division), 0),
        'pending', coalesce((select sum(pending) from by_type t where t.division = d.division), 0),
        'refunded', coalesce((select sum(refunded) from by_type t where t.division = d.division), 0),
        'transactions', coalesce((select sum(n) from by_type t where t.division = d.division), 0),
        'customers', (select count(distinct customer_id) from l where l.division = d.division and l.status = 'COLLECTED'),
        'billed', coalesce((select sum(billed) from ord_type t where t.division = d.division), 0),
        'outstanding', coalesce((select sum(outstanding) from ord_type t where t.division = d.division), 0),
        'orders', coalesce((select sum(orders) from ord_type t where t.division = d.division), 0),
        'byType', coalesce((select jsonb_agg(jsonb_build_object('type', t.tx_type, 'collected', t.collected, 'pending', t.pending,
                    'refunded', t.refunded, 'transactions', t.n, 'customers', t.customers,
                    'billed', coalesce(ot.billed, 0), 'outstanding', coalesce(ot.outstanding, 0)) order by t.tx_type)
                    from by_type t left join ord_type ot on ot.division = t.division and ot.order_type = t.tx_type
                   where t.division = d.division), '[]'::jsonb),
        'employees', coalesce((select jsonb_agg(jsonb_build_object('employeeId', e.employee_id, 'name', coalesce(p.full_name, 'Not recorded'),
                    'collected', e.collected, 'pending', e.pending, 'refunded', e.refunded, 'transactions', e.n, 'customers', e.customers,
                    'billed', coalesce(oe.billed, 0), 'outstanding', coalesce(oe.outstanding, 0))
                    order by e.collected desc, p.full_name nulls last)
                    from by_emp e
                    left join public.profiles p on p.id = e.employee_id
                    left join ord_emp oe on oe.division = e.division and oe.employee_id is not distinct from e.employee_id
                   where e.division = d.division), '[]'::jsonb)))
      from (values ('SALES'), ('SUPPORT')) d(division) where v_div is null or d.division = v_div), '{}'::jsonb),
    -- income by the customer's business unit (the same departments as Accounts' Department Income), split Sales / Support
    'departments', coalesce((select jsonb_agg(jsonb_build_object('departmentId', x.department_id, 'name', coalesce(d.name, 'Unknown'),
          'sales', jsonb_build_object('collected', x.sales_collected, 'pending', x.sales_pending, 'refunded', x.sales_refunded, 'transactions', x.sales_n),
          'support', jsonb_build_object('collected', x.support_collected, 'pending', x.support_pending, 'refunded', x.support_refunded, 'transactions', x.support_n),
          'collected', x.sales_collected + x.support_collected)
          order by x.sales_collected + x.support_collected desc, d.name)
        from by_dept x left join public.departments d on d.id = x.department_id), '[]'::jsonb),
    'unclassified', jsonb_build_object(
      'collected', coalesce((select sum(amount) from l where tx_type = 'UNCLASSIFIED' and status = 'COLLECTED'), 0),
      'pending', coalesce((select sum(amount) from l where tx_type = 'UNCLASSIFIED' and status = 'PENDING'), 0),
      'transactions', (select count(*) from l where tx_type = 'UNCLASSIFIED')),
    'organization', jsonb_build_object(
      'collected', coalesce((select sum(amount) from l where division is not null and status = 'COLLECTED'), 0),
      'pending', coalesce((select sum(amount) from l where division is not null and status = 'PENDING'), 0),
      'refunded', coalesce((select sum(amount) from l where division is not null and status = 'REFUNDED'), 0),
      'billed', coalesce((select sum(billed) from o), 0),
      'outstanding', coalesce((select sum(greatest(billed - collected, 0)) from o), 0)),
    'review', jsonb_build_object(
      'withoutEmployee', (select count(*) from l where division is not null and employee_id is null),
      'withoutEmployeeAmount', coalesce((select sum(amount) from l where division is not null and employee_id is null and status = 'COLLECTED'), 0),
      'unclassifiedInvoices', (select count(*) from l where tx_type = 'UNCLASSIFIED'))
  ) into v;
  return v;
end $$;
revoke all on function public.business_report(date, date, uuid, text, uuid, text, text) from public, anon;
grant execute on function public.business_report(date, date, uuid, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Transaction history
-- ---------------------------------------------------------------------------
create or replace function public.business_report_transactions(
  p_from date default null, p_to date default null, p_department uuid default null, p_division text default null,
  p_employee uuid default null, p_type text default null, p_status text default null, p_search text default null,
  p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_div text := upper(nullif(btrim(coalesce(p_division, '')), ''));
  v_type text := upper(nullif(btrim(coalesce(p_type, '')), ''));
  v_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  v_search text := nullif(left(lower(btrim(coalesce(p_search, ''))), 100), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v jsonb;
begin
  perform private.require_business_reports();
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_div is not null and v_div not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_type is not null and v_type not in ('INITIAL_SALE', 'ADDON', 'RENEWAL', 'SUBSCRIPTION', 'UNCLASSIFIED') then
    raise exception 'VALIDATION_ERROR: Unknown transaction type.' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('COLLECTED', 'PENDING', 'REFUNDED') then
    raise exception 'VALIDATION_ERROR: Unknown payment status.' using errcode = 'P0001';
  end if;

  with l as (
    select x.*, c.name as customer_name, c.company as customer_company, c.customer_code, d.name as department_name, p.full_name as employee_name
      from private.business_ledger_filtered(p_from, p_to, p_department, v_div, p_employee, v_type, v_status) x
      join public.customers c on c.id = x.customer_id
      left join public.departments d on d.id = x.department_id
      left join public.profiles p on p.id = x.employee_id
     where x.status <> 'REJECTED'
       and (v_search is null or lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.customer_code, '') || ' ' ||
            coalesce(p.full_name, '') || ' ' || coalesce(x.reference, '') || ' ' || coalesce(x.service, '')) like '%' || v_search || '%')),
  page as (select * from l order by occurred_at desc, tx_key limit v_size offset (v_page - 1) * v_size)
  select jsonb_build_object(
    'total', (select count(*) from l),
    'page', v_page, 'pageSize', v_size,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'key', pg.tx_key, 'source', pg.source, 'type', pg.tx_type, 'division', pg.division, 'amount', pg.amount, 'status', pg.status,
        'occurredAt', pg.occurred_at, 'customerId', pg.customer_id, 'customerName', pg.customer_name, 'company', pg.customer_company,
        'customerCode', pg.customer_code, 'departmentId', pg.department_id, 'department', pg.department_name, 'service', pg.service,
        'employeeId', pg.employee_id, 'employeeName', pg.employee_name, 'reference', pg.reference, 'method', pg.method)
        order by pg.occurred_at desc, pg.tx_key) from page pg), '[]'::jsonb)) into v;
  return v;
end $$;
revoke all on function public.business_report_transactions(date, date, uuid, text, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.business_report_transactions(date, date, uuid, text, uuid, text, text, text, integer, integer) to authenticated;

-- Who can be filtered on: the people who appear in the ledger, with their department and team division.
create or replace function public.business_report_people()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_business_reports();
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'division', t.division, 'department', d.name) order by p.full_name), '[]'::jsonb)
    into v
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    left join public.departments d on d.id = p.department_id
   where p.id in (select employee_id from private.business_ledger() where employee_id is not null);
  return v;
end $$;
revoke all on function public.business_report_people() from public, anon;
grant execute on function public.business_report_people() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Accounts: say what an additional invoice is
-- ---------------------------------------------------------------------------
create or replace function public.accounts_tag_invoice_business(
  p_invoice uuid, p_kind text, p_service text default null, p_invoice_request uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.generated_invoices;
  v_kind text := upper(nullif(btrim(coalesce(p_kind, '')), ''));
  t public.invoice_business_tags;
  ir public.invoice_requests;
begin
  perform private.require_accounts_staff();
  if v_kind is null or v_kind not in ('RENEWAL', 'ADDON', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose Renewal, Add-on or Other.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = p_invoice for update;
  if g.invoice_id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if g.purpose <> 'ADDITIONAL' then
    raise exception 'CONFLICT: Only an additional invoice is classified here. A services invoice is the initial sale and an add-on invoice is already an add-on.' using errcode = 'P0001';
  end if;
  if p_service is not null and not exists (select 1 from public.crm_services where code = p_service) then
    raise exception 'VALIDATION_ERROR: Service not found.' using errcode = 'P0001';
  end if;
  if p_invoice_request is not null then
    select * into ir from public.invoice_requests where id = p_invoice_request for update;
    if ir.id is null or ir.customer_id <> g.customer_id then
      raise exception 'VALIDATION_ERROR: That invoice request is not for this customer.' using errcode = 'P0001';
    end if;
  end if;
  -- once money has been recorded the classification (and so the department it is credited to) is fixed; only the Super Admin may correct it
  select * into t from public.invoice_business_tags where invoice_id = p_invoice;
  if t.invoice_id is not null and not private.is_super_admin()
     and exists (select 1 from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED') then
    raise exception 'CONFLICT: Payments are already recorded on this invoice, so its classification can no longer be changed.' using errcode = 'P0001';
  end if;
  insert into public.invoice_business_tags as x (invoice_id, kind, service_code, invoice_request_id, responsible_id, note, tagged_by, tagged_at)
  values (p_invoice, v_kind, p_service, p_invoice_request, ir.requested_by, nullif(left(btrim(coalesce(p_note, '')), 500), ''), (select private.my_id()), now())
  on conflict (invoice_id) do update
     set kind = excluded.kind, service_code = excluded.service_code, invoice_request_id = excluded.invoice_request_id,
         responsible_id = excluded.responsible_id, note = excluded.note, tagged_by = excluded.tagged_by, tagged_at = excluded.tagged_at;
  if ir.id is not null and ir.status = 'REQUESTED' then
    update public.invoice_requests set status = 'RAISED' where id = ir.id;
  end if;
  perform private.write_audit('INVOICE_BUSINESS_TAGGED', 'invoice', p_invoice, null, null,
    jsonb_build_object('kind', v_kind, 'service', p_service, 'invoice_request', p_invoice_request));
  return jsonb_build_object('invoiceId', p_invoice, 'kind', v_kind, 'serviceCode', p_service, 'invoiceRequestId', p_invoice_request,
                            'responsibleId', ir.requested_by);
end $$;
revoke all on function public.accounts_tag_invoice_business(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.accounts_tag_invoice_business(uuid, text, text, uuid, text) to authenticated;

-- What an invoice is tagged as, and the open Support invoice requests it could be linked to.
create or replace function public.accounts_invoice_business(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.generated_invoices;
begin
  perform private.require_accounts_staff();
  select * into g from public.generated_invoices where invoice_id = p_invoice;
  if g.invoice_id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'purpose', g.purpose,
    'tag', (select jsonb_build_object('kind', t.kind, 'serviceCode', t.service_code, 'invoiceRequestId', t.invoice_request_id,
                   'responsibleId', t.responsible_id, 'responsible', (select p.full_name from public.profiles p where p.id = t.responsible_id), 'note', t.note)
              from public.invoice_business_tags t where t.invoice_id = p_invoice),
    'locked', exists (select 1 from public.invoice_business_tags where invoice_id = p_invoice)
              and exists (select 1 from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED') and not private.is_super_admin(),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'requestedBy', r.requested_by,
                   'requestedByName', (select p.full_name from public.profiles p where p.id = r.requested_by),
                   'fromMonth', r.from_month, 'toMonth', r.to_month, 'note', r.note, 'createdAt', r.created_at) order by r.created_at desc)
              from public.invoice_requests r where r.customer_id = g.customer_id and r.status = 'REQUESTED'), '[]'::jsonb));
end $$;
revoke all on function public.accounts_invoice_business(uuid) from public, anon;
grant execute on function public.accounts_invoice_business(uuid) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261105000100_department_business_orders.sql
-- Department Income -> one department: the Sales team's and the Support team's orders with their invoices.
--
-- Safe to run again in the SQL editor. Run it after 20261104000100_business_attribution_reports.sql.
--
-- business_report() / business_report_transactions() (migration 20261104) already give every figure and every payment for one
-- department (their department filter) split into Sales and Support. This adds the one thing they do not show: the ORDERS behind
-- those figures with their invoices, so Accounts can see, per customer order, what was billed, what is collected, pending and
-- outstanding, and whether the invoice is paid. It reads the same private.business_orders() / private.business_ledger(), so it can
-- never disagree with the totals, and it adds no table and no money record.
--
-- An order is: the services Sales agreed with a customer (invoiced as one or more SERVICES invoices), an approved add-on request
-- (its add-on invoice), or an additional invoice Accounts classified as a renewal / add-on. Access: the Accounts department and
-- the Super Admin (same check as the other business reports).

-- RE-ASSERTS what 20261104 changed after it was first released. The first release gave the reports to HR; they are for the Accounts
-- department (and the Super Admin), and the summary also returns the income of each customer department. A database that ran the first
-- release gets both fixes just by running this file; one that ran the final 20261104 simply gets the same definitions again.
create or replace function private.can_view_business_reports()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff()
$$;
revoke all on function private.can_view_business_reports() from public, anon;
grant execute on function private.can_view_business_reports() to authenticated;

create or replace function private.require_business_reports()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_business_reports() then
    raise exception 'FORBIDDEN: Only the Accounts department can see the business reports.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_business_reports() from public, anon;
grant execute on function private.require_business_reports() to authenticated;


create or replace function public.business_report(
  p_from date default null, p_to date default null, p_department uuid default null, p_division text default null,
  p_employee uuid default null, p_type text default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_div text := upper(nullif(btrim(coalesce(p_division, '')), ''));
  v_type text := upper(nullif(btrim(coalesce(p_type, '')), ''));
  v_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  v jsonb;
begin
  perform private.require_business_reports();
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_div is not null and v_div not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_type is not null and v_type not in ('INITIAL_SALE', 'ADDON', 'RENEWAL', 'SUBSCRIPTION', 'UNCLASSIFIED') then
    raise exception 'VALIDATION_ERROR: Unknown transaction type.' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('COLLECTED', 'PENDING', 'REFUNDED') then
    raise exception 'VALIDATION_ERROR: Unknown payment status.' using errcode = 'P0001';
  end if;

  with l as materialized (
    select * from private.business_ledger_filtered(p_from, p_to, p_department, v_div, p_employee, v_type, v_status)
     where status <> 'REJECTED'),
  o as materialized (
    select o.*, coalesce(s.collected, 0) as collected, coalesce(s.pending, 0) as pending
      from private.business_orders() o
      left join (select order_key, sum(amount) filter (where status = 'COLLECTED') collected, sum(amount) filter (where status = 'PENDING') pending
                   from private.business_ledger() group by order_key) s on s.order_key = o.order_key
     where (p_from is null or o.billed_at >= private.business_day_start(p_from))
       and (p_to is null or o.billed_at < private.business_day_start(p_to + 1))
       and (p_department is null or o.department_id = p_department)
       and (v_div is null or o.division = v_div)
       and (p_employee is null or o.employee_id = p_employee)
       and (v_type is null or o.order_type = v_type)),
  by_type as (
    select division, tx_type,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected, coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending,
           coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded, count(*) filter (where status = 'COLLECTED') n,
           count(distinct customer_id) filter (where status = 'COLLECTED') customers
      from l group by division, tx_type),
  by_emp as (
    select division, employee_id,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected, coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending,
           coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded, count(*) filter (where status = 'COLLECTED') n,
           count(distinct customer_id) filter (where status = 'COLLECTED') customers
      from l where division is not null group by division, employee_id),
  by_dept as (
    select department_id,
           coalesce(sum(amount) filter (where division = 'SALES' and status = 'COLLECTED'), 0) sales_collected,
           coalesce(sum(amount) filter (where division = 'SALES' and status = 'PENDING'), 0) sales_pending,
           coalesce(sum(amount) filter (where division = 'SALES' and status = 'REFUNDED'), 0) sales_refunded,
           count(*) filter (where division = 'SALES' and status = 'COLLECTED') sales_n,
           coalesce(sum(amount) filter (where division = 'SUPPORT' and status = 'COLLECTED'), 0) support_collected,
           coalesce(sum(amount) filter (where division = 'SUPPORT' and status = 'PENDING'), 0) support_pending,
           coalesce(sum(amount) filter (where division = 'SUPPORT' and status = 'REFUNDED'), 0) support_refunded,
           count(*) filter (where division = 'SUPPORT' and status = 'COLLECTED') support_n
      from l where division is not null group by department_id),
  ord_type as (
    select division, order_type, count(*) orders, coalesce(sum(billed), 0) billed, coalesce(sum(greatest(billed - collected, 0)), 0) outstanding
      from o group by division, order_type),
  ord_emp as (
    select division, employee_id, count(*) orders, coalesce(sum(billed), 0) billed, coalesce(sum(greatest(billed - collected, 0)), 0) outstanding
      from o group by division, employee_id)
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('departmentId', p_department, 'division', v_div, 'employeeId', p_employee, 'type', v_type, 'status', v_status),
    'sections', coalesce((
      select jsonb_object_agg(lower(d.division), jsonb_build_object(
        'collected', coalesce((select sum(collected) from by_type t where t.division = d.division), 0),
        'pending', coalesce((select sum(pending) from by_type t where t.division = d.division), 0),
        'refunded', coalesce((select sum(refunded) from by_type t where t.division = d.division), 0),
        'transactions', coalesce((select sum(n) from by_type t where t.division = d.division), 0),
        'customers', (select count(distinct customer_id) from l where l.division = d.division and l.status = 'COLLECTED'),
        'billed', coalesce((select sum(billed) from ord_type t where t.division = d.division), 0),
        'outstanding', coalesce((select sum(outstanding) from ord_type t where t.division = d.division), 0),
        'orders', coalesce((select sum(orders) from ord_type t where t.division = d.division), 0),
        'byType', coalesce((select jsonb_agg(jsonb_build_object('type', t.tx_type, 'collected', t.collected, 'pending', t.pending,
                    'refunded', t.refunded, 'transactions', t.n, 'customers', t.customers,
                    'billed', coalesce(ot.billed, 0), 'outstanding', coalesce(ot.outstanding, 0)) order by t.tx_type)
                    from by_type t left join ord_type ot on ot.division = t.division and ot.order_type = t.tx_type
                   where t.division = d.division), '[]'::jsonb),
        'employees', coalesce((select jsonb_agg(jsonb_build_object('employeeId', e.employee_id, 'name', coalesce(p.full_name, 'Not recorded'),
                    'collected', e.collected, 'pending', e.pending, 'refunded', e.refunded, 'transactions', e.n, 'customers', e.customers,
                    'billed', coalesce(oe.billed, 0), 'outstanding', coalesce(oe.outstanding, 0))
                    order by e.collected desc, p.full_name nulls last)
                    from by_emp e
                    left join public.profiles p on p.id = e.employee_id
                    left join ord_emp oe on oe.division = e.division and oe.employee_id is not distinct from e.employee_id
                   where e.division = d.division), '[]'::jsonb)))
      from (values ('SALES'), ('SUPPORT')) d(division) where v_div is null or d.division = v_div), '{}'::jsonb),
    -- income by the customer's business unit (the same departments as Accounts' Department Income), split Sales / Support
    'departments', coalesce((select jsonb_agg(jsonb_build_object('departmentId', x.department_id, 'name', coalesce(d.name, 'Unknown'),
          'sales', jsonb_build_object('collected', x.sales_collected, 'pending', x.sales_pending, 'refunded', x.sales_refunded, 'transactions', x.sales_n),
          'support', jsonb_build_object('collected', x.support_collected, 'pending', x.support_pending, 'refunded', x.support_refunded, 'transactions', x.support_n),
          'collected', x.sales_collected + x.support_collected)
          order by x.sales_collected + x.support_collected desc, d.name)
        from by_dept x left join public.departments d on d.id = x.department_id), '[]'::jsonb),
    'unclassified', jsonb_build_object(
      'collected', coalesce((select sum(amount) from l where tx_type = 'UNCLASSIFIED' and status = 'COLLECTED'), 0),
      'pending', coalesce((select sum(amount) from l where tx_type = 'UNCLASSIFIED' and status = 'PENDING'), 0),
      'transactions', (select count(*) from l where tx_type = 'UNCLASSIFIED')),
    'organization', jsonb_build_object(
      'collected', coalesce((select sum(amount) from l where division is not null and status = 'COLLECTED'), 0),
      'pending', coalesce((select sum(amount) from l where division is not null and status = 'PENDING'), 0),
      'refunded', coalesce((select sum(amount) from l where division is not null and status = 'REFUNDED'), 0),
      'billed', coalesce((select sum(billed) from o), 0),
      'outstanding', coalesce((select sum(greatest(billed - collected, 0)) from o), 0)),
    'review', jsonb_build_object(
      'withoutEmployee', (select count(*) from l where division is not null and employee_id is null),
      'withoutEmployeeAmount', coalesce((select sum(amount) from l where division is not null and employee_id is null and status = 'COLLECTED'), 0),
      'unclassifiedInvoices', (select count(*) from l where tx_type = 'UNCLASSIFIED'))
  ) into v;
  return v;
end $$;
revoke all on function public.business_report(date, date, uuid, text, uuid, text, text) from public, anon;
grant execute on function public.business_report(date, date, uuid, text, uuid, text, text) to authenticated;


-- A sale that is still waiting for Accounts has no "resolved" date yet: it is dated from when it was submitted (never left undated,
-- which would also hide it from every date range).
create or replace function private.business_orders()
returns table (order_key text, division text, order_type text, customer_id uuid, department_id uuid, employee_id uuid,
               billed numeric, billed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- the services Sales agreed with the customer
  select 'SALE:' || c.id::text, 'SALES'::text, 'INITIAL_SALE'::text, c.id, c.department_id, fr.requested_by, c.deal_amount,
         coalesce(fr.resolved_at, fr.requested_at, (select min(p.recorded_at) from public.customer_payments p where p.customer_id = c.id), c.created_at)
    from public.customers c
    left join lateral (select x.requested_by, x.resolved_at, x.requested_at from public.payment_requests x
                        where x.customer_id = c.id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where coalesce(c.deal_amount, 0) > 0
     and (fr.requested_by is not null or exists (select 1 from public.payment_requests x where x.customer_id = c.id and x.status <> 'RETURNED')
          or exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status <> 'REJECTED'))
  union all
  -- a services invoice whose payments are recorded on the invoice (the customer has no agreed amount)
  select 'INV:' || g.invoice_id::text, 'SALES', 'INITIAL_SALE', g.customer_id, c.department_id, fr.requested_by, g.total_amount,
         g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.customers c on c.id = g.customer_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = g.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where g.purpose = 'SERVICES' and g.payment_ledger = 'INVOICE'
  union all
  -- approved add-ons that were invoiced
  select 'ADDON:' || r.id::text, 'SUPPORT', 'ADDON', r.customer_id, c.department_id, coalesce(r.submitted_by, r.created_by, r.consultant_id), r.total,
         coalesce((select g.invoice_date::timestamp at time zone 'Asia/Kolkata' from public.generated_invoices g where g.addon_request_id = r.id limit 1),
                  r.decided_at, r.submitted_at, r.created_at)
    from public.addon_requests r
    join public.customers c on c.id = r.customer_id
   where r.status in ('INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') and r.total > 0
  union all
  -- additional invoices Accounts tagged as renewal / add-on
  select 'INV:' || g.invoice_id::text, 'SUPPORT', case t.kind when 'RENEWAL' then 'RENEWAL' else 'ADDON' end, g.customer_id, c.department_id,
         t.responsible_id, g.total_amount, g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.invoice_business_tags t on t.invoice_id = g.invoice_id and t.kind in ('RENEWAL', 'ADDON')
    join public.customers c on c.id = g.customer_id
   where g.purpose = 'ADDITIONAL'
$$;
revoke all on function private.business_orders() from public, anon, authenticated;

create or replace function public.business_report_orders(
  p_from date default null, p_to date default null, p_department uuid default null, p_division text default null,
  p_employee uuid default null, p_type text default null, p_search text default null,
  p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_div text := upper(nullif(btrim(coalesce(p_division, '')), ''));
  v_type text := upper(nullif(btrim(coalesce(p_type, '')), ''));
  v_search text := nullif(left(lower(btrim(coalesce(p_search, ''))), 100), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v jsonb;
begin
  perform private.require_business_reports();
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_div is not null and v_div not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_type is not null and v_type not in ('INITIAL_SALE', 'ADDON', 'RENEWAL') then
    raise exception 'VALIDATION_ERROR: Unknown order type.' using errcode = 'P0001';
  end if;

  with pay as (
    select order_key,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected,
           coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending,
           coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded
      from private.business_ledger() group by order_key),
  o as (
    select o.*, coalesce(p.collected, 0) collected, coalesce(p.pending, 0) pending, coalesce(p.refunded, 0) refunded,
           greatest(o.billed - coalesce(p.collected, 0), 0) outstanding,
           c.name customer_name, c.company customer_company, c.customer_code, d.name department_name, e.full_name employee_name,
           coalesce((select jsonb_agg(jsonb_build_object('invoiceId', m.id, 'number', m.invoice_number,
                       'date', coalesce((select g.invoice_date::text from public.generated_invoices g where g.invoice_id = m.id), nullif(m.issue_date, '')),
                       'total', m.amount, 'kind', m.kind, 'paid', m.status = 'Paid') order by m.created_at, m.invoice_number)
                       from public.member_invoices m
                      where m.kind in ('SERVICE', 'UPLOADED', 'GENERATED')
                        and ((o.order_key like 'SALE:%' and m.customer_id = o.customer_id and m.addon_request_id is null
                              and not exists (select 1 from public.generated_invoices g where g.invoice_id = m.id and g.purpose <> 'SERVICES'))
                          or (o.order_key like 'ADDON:%' and m.addon_request_id::text = substr(o.order_key, 7))
                          or (o.order_key like 'INV:%' and m.id::text = substr(o.order_key, 5)))), '[]'::jsonb) invoices
      from private.business_orders() o
      left join pay p on p.order_key = o.order_key
      join public.customers c on c.id = o.customer_id
      left join public.departments d on d.id = o.department_id
      left join public.profiles e on e.id = o.employee_id
     where (p_from is null or o.billed_at >= private.business_day_start(p_from))
       and (p_to is null or o.billed_at < private.business_day_start(p_to + 1))
       and (p_department is null or o.department_id = p_department)
       and (v_div is null or o.division = v_div)
       and (p_employee is null or o.employee_id = p_employee)
       and (v_type is null or o.order_type = v_type)
       and (v_search is null or lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.customer_code, '') || ' ' || coalesce(e.full_name, '')) like '%' || v_search || '%')),
  page as (select * from o order by billed_at desc, order_key limit v_size offset (v_page - 1) * v_size)
  select jsonb_build_object(
    'total', (select count(*) from o), 'page', v_page, 'pageSize', v_size,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'key', x.order_key, 'type', x.order_type, 'division', x.division, 'billedAt', x.billed_at, 'billed', x.billed,
        'collected', x.collected, 'pending', x.pending, 'refunded', x.refunded, 'outstanding', x.outstanding,
        'state', case when x.billed > 0 and x.collected >= x.billed then 'PAID' when x.collected > 0 then 'PARTLY_PAID' else 'UNPAID' end,
        'customerId', x.customer_id, 'customerName', x.customer_name, 'company', x.customer_company, 'customerCode', x.customer_code,
        'departmentId', x.department_id, 'department', x.department_name, 'employeeId', x.employee_id, 'employeeName', x.employee_name,
        'invoices', x.invoices) order by x.billed_at desc, x.order_key) from page x), '[]'::jsonb)) into v;
  return v;
end $$;
revoke all on function public.business_report_orders(date, date, uuid, text, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.business_report_orders(date, date, uuid, text, uuid, text, text, integer, integer) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261107000100_hr_email_automation.sql
-- =============================================================================
-- HR e-mail automation: birthdays, work anniversaries, probation reminders and employment confirmation.
--
-- Uses the employee data the HR dashboard already shows (CRM accounts in profiles + their HR record in hr_employees +
-- the personal details from Add Member) - no second employee table.
--
--  * hr_email_events      one row per e-mail to send / sent, with a UNIQUE event_key, so the same occasion can never
--                         be queued (or sent) twice. Status PENDING / SENDING / RETRY / SENT / FAILED / SKIPPED / DRY_RUN,
--                         attempts, timestamps and the last error.
--  * hr_probation_cycles  one confirmation cycle per employee and joining date: probation end = joining date + 6 months,
--                         status PENDING / APPROVED / DISMISSED, who approved and when. Nothing marks anyone permanent
--                         by itself: only hr_confirm_probation() (HR lead, Department Head of the employee, Super Admin).
--  * hr_schedule_emails() the daily check (service role, called by the API's scheduler endpoint; idempotent, so running
--                         it every few minutes is harmless): birthdays and anniversaries of today (and the 2 days before,
--                         for a missed run), probation reminders from 7 days before the end, weekly overdue reminders
--                         to HR (max 8) while a confirmation is still pending.
--  * hr_email_claim / hr_email_finish  the queue the mail sender works through (SKIP LOCKED, lease, back-off 5/15/60/240
--                         minutes, FAILED after 5 attempts).
--  * HR dashboard RPCs    overview, history, probation list, retry, approve / dismiss, data issues, fix dates.
-- Dates use Indian time (Asia/Kolkata); mails go out from 09:00 that day. Idempotent. No data is dropped or changed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.hr_probation_cycles (
  id uuid primary key default gen_random_uuid(),
  employee_key text not null,                 -- profile id, or 'HR:<hr record id>' for an HR-only record
  profile_id uuid references public.profiles (id) on delete set null,
  hr_record_id text,
  employee_name text not null,
  employee_email text,
  employee_code text not null,
  department_id uuid references public.departments (id) on delete set null,
  department_name text,
  joining_date date not null,
  probation_end date not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'DISMISSED')),
  effective_date date,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  decision_note text check (length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_key, joining_date)
);
create index if not exists hr_probation_cycles_status_idx on public.hr_probation_cycles (status, probation_end);
alter table public.hr_probation_cycles enable row level security;
revoke all on public.hr_probation_cycles from public, anon, authenticated;

create table if not exists public.hr_email_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (length(event_key) <= 300),
  kind text not null check (kind in ('BIRTHDAY', 'ANNIVERSARY', 'PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR',
                                     'PROBATION_OVERDUE_HR', 'CONFIRMATION_EMPLOYEE', 'CONFIRMATION_HR')),
  employee_key text,
  profile_id uuid references public.profiles (id) on delete set null,
  cycle_id uuid references public.hr_probation_cycles (id) on delete set null,
  recipient_email text,
  recipient_name text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096),
  event_date date not null,                   -- the occasion (birthday, anniversary, reminder day)
  send_after timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENDING', 'RETRY', 'SENT', 'FAILED', 'SKIPPED', 'DRY_RUN')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text check (length(last_error) <= 500),
  response_code integer,
  provider_ref text check (length(provider_ref) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_email_events_queue_idx on public.hr_email_events (status, send_after);
create index if not exists hr_email_events_created_idx on public.hr_email_events (created_at desc);
create index if not exists hr_email_events_cycle_idx on public.hr_email_events (cycle_id);
alter table public.hr_email_events enable row level security;
revoke all on public.hr_email_events from public, anon, authenticated;

create table if not exists public.hr_automation_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.hr_automation_state enable row level security;
revoke all on public.hr_automation_state from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.hr_today()
returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- 09:00 Indian time on that date
create or replace function private.hr_nine_am(p_date date)
returns timestamptz language sql immutable set search_path = '' as $$ select (p_date::timestamp + interval '9 hours') at time zone 'Asia/Kolkata' $$;

-- A real date from the text HR keeps (YYYY-MM-DD or DD-MM-YYYY); null when it is not one.
create or replace function private.hr_safe_date(p text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if p is null then return null; end if;
  if p ~ '^\d{4}-\d{2}-\d{2}' then return left(p, 10)::date; end if;
  if p ~ '^\d{2}-\d{2}-\d{4}$' then return to_date(p, 'DD-MM-YYYY'); end if;
  return null;
exception when others then
  return null;
end $$;

-- The day of the year an annual date falls on (29 February is celebrated on 28 February in a common year).
create or replace function private.hr_occasion_date(p_date date, p_year integer)
returns date language sql immutable set search_path = '' as $$
  select case
    when extract(month from p_date) = 2 and extract(day from p_date) = 29 and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0))
      then make_date(p_year, 2, 28)
    else make_date(p_year, extract(month from p_date)::int, extract(day from p_date)::int)
  end
$$;

-- Everybody the HR dashboard lists (CRM accounts merged with their HR record, plus HR-only records), with the dates the
-- automation uses: date of birth (Add Member details) and the actual joining date (details, else the HR record's date).
-- Never falls back to the account creation date.
create or replace function private.hr_mail_employees()
returns table (employee_key text, profile_id uuid, hr_record_id text, full_name text, email text, department_id uuid, department_name text,
               employee_code text, date_of_birth date, joining_date date, hr_status text, is_active boolean)
language sql stable security definer set search_path = '' as $$
  select p.id::text, p.id, h.id, p.full_name, lower(btrim(coalesce(p.email, ''))), p.department_id, d.name,
         coalesce(h.id, 'EMP-' || upper(left(p.id::text, 8))),
         coalesce(x.date_of_birth, private.hr_safe_date(h.data ->> 'dateOfBirth')),
         coalesce(x.joining_date, private.hr_safe_date(h.joining_date)),
         h.status,
         (p.status = 'ACTIVE' and coalesce(h.status, '') <> 'Left')
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    left join public.employee_personal_details x on x.profile_id = p.id
    left join lateral (
      select y.* from public.hr_employees y
       where y.profile_id = p.id or (y.profile_id is null and lower(trim(coalesce(y.email, ''))) = p.email)
       order by (y.profile_id is not null) desc, y.created_at limit 1) h on true
   where p.role <> 'SUPER_ADMIN' and p.status <> 'REJECTED'
  union all
  select 'HR:' || h.id, null::uuid, h.id, h.name, lower(btrim(coalesce(h.email, ''))), d.id, coalesce(d.name, h.department_id), h.id,
         private.hr_safe_date(h.data ->> 'dateOfBirth'), private.hr_safe_date(h.joining_date), h.status, (coalesce(h.status, '') <> 'Left')
    from public.hr_employees h
    left join public.departments d on d.slug = h.department_id
   where h.profile_id is null
     and not exists (select 1 from public.profiles p where p.email = lower(trim(coalesce(h.email, ''))) and p.status <> 'REJECTED')
$$;
revoke all on function private.hr_mail_employees() from public, anon, authenticated;

-- Who gets the HR copies: the active HR department members, plus any addresses in crm_settings "hr.notify_emails" (JSON array).
create or replace function private.hr_notify_recipients()
returns table (email text, name text) language sql stable security definer set search_path = '' as $$
  select distinct on (r.email) r.email, r.name from (
    select lower(btrim(p.email)) as email, p.full_name as name
      from public.profiles p join public.departments d on d.id = p.department_id
     where d.slug = 'hr' and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
    union all
    select lower(btrim(x)), 'HR Team'
      from public.crm_settings s, jsonb_array_elements_text(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) x
     where s.key = 'hr.notify_emails'
  ) r
  where r.email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  order by r.email, r.name
$$;
revoke all on function private.hr_notify_recipients() from public, anon, authenticated;

-- Queue one e-mail. Returns true when it was new. The unique key makes a second call for the same occasion a no-op.
-- A recipient without a valid address is recorded as SKIPPED so HR can see why nothing was sent.
create or replace function private.hr_enqueue(
  p_key text, p_kind text, p_employee_key text, p_profile uuid, p_cycle uuid, p_email text, p_name text,
  p_payload jsonb, p_event_date date, p_send_after timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean := coalesce(p_email, '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  v_rows integer;
begin
  insert into public.hr_email_events (event_key, kind, employee_key, profile_id, cycle_id, recipient_email, recipient_name, payload,
                                      event_date, send_after, status, last_error)
  values (p_key, p_kind, p_employee_key, p_profile, p_cycle, nullif(lower(btrim(coalesce(p_email, ''))), ''), p_name, p_payload,
          p_event_date, p_send_after, case when v_ok then 'PENDING' else 'SKIPPED' end,
          case when v_ok then null else 'No valid e-mail address for the recipient.' end)
  on conflict (event_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;
revoke all on function private.hr_enqueue(text, text, text, uuid, uuid, text, text, jsonb, date, timestamptz) from public, anon, authenticated;

-- May the signed-in user decide this confirmation? Super Admin, an HR Department Head / Team Lead, or the Department Head of
-- the employee's department - never one's own.
create or replace function private.can_confirm_probation(p_cycle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_probation_cycles c
     where c.id = p_cycle
       and (private.is_super_admin() or (
         c.profile_id is distinct from auth.uid() and exists (
           select 1 from public.profiles me join public.departments d on d.id = me.department_id
            where me.id = auth.uid() and me.status = 'ACTIVE'
              and ((d.slug = 'hr' and me.role in ('DEPARTMENT_HEAD', 'TEAM_HEAD'))
                or (me.role = 'DEPARTMENT_HEAD' and me.department_id = c.department_id)))))
  )
$$;
revoke all on function private.can_confirm_probation(uuid) from public, anon;
grant execute on function private.can_confirm_probation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The daily check (service role). Idempotent: run it as often as you like.
-- ---------------------------------------------------------------------------
create or replace function public.hr_schedule_emails(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.hr_today());
  e record;
  c record;
  r record;
  d integer;
  v_occ date;
  v_end date;
  v_n integer;
  v_birthdays integer := 0;
  v_anniversaries integer := 0;
  v_cycles integer := 0;
  v_reminders integer := 0;
  v_overdue integer := 0;
  v_new boolean;
  v_rows integer;
begin
  -- 3a. Birthdays and work anniversaries: today, and the two days before (a run that was missed still sends, late but once).
  for e in select * from private.hr_mail_employees() m where m.is_active loop
    for d in 0..2 loop
      v_occ := v_today - d;
      if e.date_of_birth is not null and e.date_of_birth <= v_occ
         and private.hr_occasion_date(e.date_of_birth, extract(year from v_occ)::int) = v_occ then
        v_new := private.hr_enqueue('BIRTHDAY:' || e.employee_key || ':' || extract(year from v_occ)::int, 'BIRTHDAY', e.employee_key, e.profile_id, null,
                  e.email, e.full_name, jsonb_build_object('employeeName', e.full_name), v_occ, private.hr_nine_am(v_occ));
        if v_new then v_birthdays := v_birthdays + 1; end if;
      end if;
      if e.joining_date is not null and extract(year from v_occ) > extract(year from e.joining_date)
         and private.hr_occasion_date(e.joining_date, extract(year from v_occ)::int) = v_occ then
        v_new := private.hr_enqueue('ANNIVERSARY:' || e.employee_key || ':' || (extract(year from v_occ)::int - extract(year from e.joining_date)::int),
                  'ANNIVERSARY', e.employee_key, e.profile_id, null, e.email, e.full_name,
                  jsonb_build_object('employeeName', e.full_name, 'years', extract(year from v_occ)::int - extract(year from e.joining_date)::int),
                  v_occ, private.hr_nine_am(v_occ));
        if v_new then v_anniversaries := v_anniversaries + 1; end if;
      end if;
    end loop;
  end loop;

  -- 3b. Probation cycles. Close the ones nobody needs any more ...
  update public.hr_probation_cycles pc
     set status = 'DISMISSED', decision_note = 'Closed automatically: the employee is no longer active.', updated_at = now()
   where pc.status = 'PENDING'
     and not exists (select 1 from private.hr_mail_employees() m where m.employee_key = pc.employee_key and m.is_active);
  update public.hr_probation_cycles pc
     set status = 'DISMISSED', decision_note = 'Closed automatically: the joining date was changed.', updated_at = now()
   where pc.status = 'PENDING'
     and exists (select 1 from private.hr_mail_employees() m where m.employee_key = pc.employee_key and m.joining_date is distinct from pc.joining_date);

  -- ... open one for recent joiners (joined less than 6 months + 30 days ago) and for everyone marked "Training / Probation".
  -- Interns have none. Employees who joined long ago are treated as confirmed: nothing is sent for them.
  for e in select * from private.hr_mail_employees() m
            where m.is_active and m.joining_date is not null and m.joining_date <= v_today and coalesce(m.hr_status, '') <> 'Intern' loop
    v_end := (e.joining_date + interval '6 months')::date;
    if coalesce(e.hr_status, '') = 'Training / Probation' or v_end >= v_today - 30 then
      insert into public.hr_probation_cycles (employee_key, profile_id, hr_record_id, employee_name, employee_email, employee_code,
                                              department_id, department_name, joining_date, probation_end)
      values (e.employee_key, e.profile_id, e.hr_record_id, e.full_name, e.email, e.employee_code, e.department_id, e.department_name, e.joining_date, v_end)
      on conflict (employee_key, joining_date) do update
         set employee_name = excluded.employee_name, employee_email = excluded.employee_email, employee_code = excluded.employee_code,
             department_id = excluded.department_id, department_name = excluded.department_name, hr_record_id = excluded.hr_record_id, updated_at = now()
       where public.hr_probation_cycles.status = 'PENDING'
         and (public.hr_probation_cycles.employee_name, public.hr_probation_cycles.employee_email, public.hr_probation_cycles.employee_code,
              public.hr_probation_cycles.department_name) is distinct from (excluded.employee_name, excluded.employee_email, excluded.employee_code, excluded.department_name);
      get diagnostics v_rows = row_count;
      v_cycles := v_cycles + v_rows;
    end if;
  end loop;

  -- 3c. Reminders for pending confirmations.
  for c in select * from public.hr_probation_cycles pc where pc.status = 'PENDING' loop
    if v_today >= c.probation_end - 7 and v_today <= c.probation_end then
      -- one week before (or, if the cycle is found later, as soon as it is found): the employee and HR, once per cycle
      v_new := private.hr_enqueue('PROBATION_REMINDER_EMPLOYEE:' || c.id, 'PROBATION_REMINDER_EMPLOYEE', c.employee_key, c.profile_id, c.id,
                c.employee_email, c.employee_name,
                jsonb_build_object('employeeName', c.employee_name, 'probationEndDate', c.probation_end),
                c.probation_end - 7, private.hr_nine_am(c.probation_end - 7));
      if v_new then v_reminders := v_reminders + 1; end if;
      for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
        v_new := private.hr_enqueue('PROBATION_REMINDER_HR:' || c.id || ':' || r.email, 'PROBATION_REMINDER_HR', c.employee_key, c.profile_id, c.id,
                  r.email, r.name,
                  jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                                     'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'daysLeft', c.probation_end - v_today),
                  c.probation_end - 7, private.hr_nine_am(c.probation_end - 7));
        if v_new then v_reminders := v_reminders + 1; end if;
      end loop;
    elsif v_today > c.probation_end then
      -- still not decided after the end date: HR is reminded weekly (at most 8 times); the employee is NOT confirmed
      v_n := least(7, (v_today - c.probation_end - 1) / 7);
      for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
        v_new := private.hr_enqueue('PROBATION_OVERDUE_HR:' || c.id || ':' || v_n || ':' || r.email, 'PROBATION_OVERDUE_HR', c.employee_key, c.profile_id, c.id,
                  r.email, r.name,
                  jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                                     'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'daysOverdue', v_today - c.probation_end),
                  v_today, private.hr_nine_am(v_today));
        if v_new then v_overdue := v_overdue + 1; end if;
      end loop;
    end if;
  end loop;

  insert into public.hr_automation_state (key, value, updated_at)
  values ('last_schedule', jsonb_build_object('ranAt', now(), 'day', v_today, 'birthdays', v_birthdays, 'anniversaries', v_anniversaries,
                                              'cyclesOpened', v_cycles, 'reminders', v_reminders, 'overdueReminders', v_overdue), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object('day', v_today, 'birthdays', v_birthdays, 'anniversaries', v_anniversaries, 'cyclesOpened', v_cycles,
                            'reminders', v_reminders, 'overdueReminders', v_overdue);
end $$;
revoke all on function public.hr_schedule_emails(date) from public, anon, authenticated;
grant execute on function public.hr_schedule_emails(date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The sending queue (service role)
-- ---------------------------------------------------------------------------
-- p_mode 'live': PENDING / RETRY that are due, DRY_RUN rows that are still relevant, and SENDING rows whose lease expired.
-- p_mode 'dry_run': only PENDING / RETRY (they become DRY_RUN and are not sent).
-- p_only_recipients (test mode): only e-mails to these addresses are claimed; the rest wait untouched.
create or replace function public.hr_email_claim(p_limit integer default 10, p_mode text default 'live', p_lease_seconds integer default 600, p_only_recipients text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_today date := private.hr_today();
begin
  -- a greeting that is days late is not sent
  update public.hr_email_events
     set status = 'SKIPPED', last_error = 'Too late to send: the day has passed.', locked_until = null, updated_at = now()
   where kind in ('BIRTHDAY', 'ANNIVERSARY') and status in ('PENDING', 'RETRY', 'DRY_RUN', 'SENDING')
     and (status <> 'SENDING' or locked_until < now()) and event_date < v_today - 2;
  -- reminders about a confirmation that has been decided are pointless
  update public.hr_email_events ev
     set status = 'SKIPPED', last_error = 'The confirmation has already been decided.', locked_until = null, updated_at = now()
   where ev.kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR', 'PROBATION_OVERDUE_HR') and ev.status in ('PENDING', 'RETRY', 'DRY_RUN')
     and exists (select 1 from public.hr_probation_cycles pc where pc.id = ev.cycle_id and pc.status <> 'PENDING');

  select coalesce(array_agg(id), '{}') into v_ids from (
    select ev.id from public.hr_email_events ev
     where ev.send_after <= now()
       and (p_only_recipients is null or lower(ev.recipient_email) = any (p_only_recipients))
       and ((ev.status in ('PENDING', 'RETRY') and ev.next_attempt_at <= now())
         or (p_mode = 'live' and ev.status = 'DRY_RUN')
         or (ev.status = 'SENDING' and ev.locked_until < now()))
     order by ev.send_after
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;

  update public.hr_email_events
     set status = 'SENDING', attempts = case when status = 'DRY_RUN' then 1 else attempts + 1 end, last_attempt_at = now(), updated_at = now(),
         locked_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 600), 1800)))
   where id = any (v_ids);

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', ev.id, 'kind', ev.kind, 'attempts', ev.attempts, 'to', ev.recipient_email,
                                        'toName', ev.recipient_name, 'payload', ev.payload, 'eventDate', ev.event_date) order by ev.send_after)
      from public.hr_email_events ev where ev.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.hr_email_claim(integer, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.hr_email_claim(integer, text, integer, text[]) to service_role;

create or replace function public.hr_email_finish(p_event uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_provider_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ev public.hr_email_events;
  v_status text;
begin
  if p_outcome not in ('SENT', 'SKIPPED', 'FAILED', 'RETRY', 'DRY_RUN') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into ev from public.hr_email_events where id = p_event for update;
  if ev.id is null or ev.status <> 'SENDING' then
    raise exception 'CONFLICT: This e-mail is not being sent.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and ev.attempts >= 5 then 'FAILED' else p_outcome end;
  update public.hr_email_events
     set status = v_status,
         last_error = case when v_status = 'SENT' then null else left(p_detail, 500) end,
         response_code = p_response_code,
         provider_ref = coalesce(left(p_provider_ref, 200), provider_ref),
         locked_until = null,
         sent_at = case when v_status = 'SENT' then now() else sent_at end,
         next_attempt_at = case when v_status = 'RETRY' then now() + (array[5, 15, 60, 240])[least(ev.attempts, 4)] * interval '1 minute' else next_attempt_at end,
         updated_at = now()
   where id = p_event
  returning * into ev;
  if v_status in ('SENT', 'FAILED') then
    perform private.write_audit(case when v_status = 'SENT' then 'HR_EMAIL_SENT' else 'HR_EMAIL_FAILED' end, 'hr_email', ev.id, null, null,
      jsonb_build_object('kind', ev.kind, 'attempts', ev.attempts));
  end if;
  return jsonb_build_object('id', ev.id, 'status', ev.status, 'attempts', ev.attempts, 'nextAttemptAt', ev.next_attempt_at);
end $$;
revoke all on function public.hr_email_finish(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.hr_email_finish(uuid, text, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Approval of the confirmation (HR lead, the employee's Department Head, Super Admin)
-- ---------------------------------------------------------------------------
create or replace function private.hr_cycle_json(c public.hr_probation_cycles)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'employeeName', c.employee_name, 'employeeEmail', c.employee_email, 'employeeCode', c.employee_code,
    'department', c.department_name, 'joiningDate', c.joining_date, 'probationEnd', c.probation_end,
    'daysLeft', c.probation_end - private.hr_today(), 'status', c.status, 'effectiveDate', c.effective_date,
    'approvedAt', c.approved_at, 'approvedBy', (select a.full_name from public.profiles a where a.id = c.approved_by),
    'note', c.decision_note, 'canDecide', private.can_confirm_probation(c.id))
$$;
revoke all on function private.hr_cycle_json(public.hr_probation_cycles) from public, anon, authenticated;

create or replace function public.hr_confirm_probation(p_cycle uuid, p_effective date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  me public.profiles;
  v_eff date;
  v_send timestamptz;
  r record;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not private.can_confirm_probation(c.id) then
    raise exception 'FORBIDDEN: Only the HR lead, the employee''s Department Head or the Super Admin can confirm an employee, and nobody can confirm themselves.' using errcode = '42501';
  end if;
  if c.status <> 'PENDING' then raise exception 'CONFLICT: This confirmation was already decided.' using errcode = 'P0001'; end if;
  v_eff := coalesce(p_effective, c.probation_end);
  if v_eff < c.joining_date or v_eff > private.hr_today() + 366 then
    raise exception 'VALIDATION_ERROR: Enter a valid confirmation effective date.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();

  update public.hr_probation_cycles
     set status = 'APPROVED', effective_date = v_eff, approved_by = auth.uid(), approved_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), updated_at = now()
   where id = c.id returning * into c;

  -- the confirmation e-mails go out once the probation period is over (not before) and only because of this approval
  v_send := greatest(now(), private.hr_nine_am(c.probation_end));
  perform private.hr_enqueue('CONFIRMATION_EMPLOYEE:' || c.id, 'CONFIRMATION_EMPLOYEE', c.employee_key, c.profile_id, c.id, c.employee_email, c.employee_name,
    jsonb_build_object('employeeName', c.employee_name, 'confirmationEffectiveDate', v_eff), private.hr_today(), v_send);
  for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
    perform private.hr_enqueue('CONFIRMATION_HR:' || c.id || ':' || r.email, 'CONFIRMATION_HR', c.employee_key, c.profile_id, c.id, r.email, r.name,
      jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                         'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'confirmationEffectiveDate', v_eff,
                         'approvalStatus', 'Approved', 'approvedBy', me.full_name),
      private.hr_today(), v_send);
  end loop;

  -- the HR record follows the decision (only a record that says "Training / Probation")
  update public.hr_employees set status = 'Full-Time', updated_at = now()
   where id = c.hr_record_id and status = 'Training / Probation';

  perform private.write_audit('EMPLOYEE_CONFIRMED', 'hr_probation', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'effectiveDate', v_eff));
  return private.hr_cycle_json(c);
end $$;
revoke all on function public.hr_confirm_probation(uuid, date, text) from public, anon;
grant execute on function public.hr_confirm_probation(uuid, date, text) to authenticated;

create or replace function public.hr_dismiss_probation(p_cycle uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not private.can_confirm_probation(c.id) then
    raise exception 'FORBIDDEN: Only the HR lead, the employee''s Department Head or the Super Admin can close a confirmation.' using errcode = '42501';
  end if;
  if c.status <> 'PENDING' then raise exception 'CONFLICT: This confirmation was already decided.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: Say why the confirmation is closed without e-mails (for example "confirmed earlier").' using errcode = 'P0001';
  end if;
  update public.hr_probation_cycles
     set status = 'DISMISSED', approved_by = auth.uid(), approved_at = now(), decision_note = left(btrim(p_note), 500), updated_at = now()
   where id = c.id returning * into c;
  perform private.write_audit('PROBATION_CLOSED', 'hr_probation', c.id, c.department_id, null, jsonb_build_object('employee', c.employee_name));
  return private.hr_cycle_json(c);
end $$;
revoke all on function public.hr_dismiss_probation(uuid, text) from public, anon;
grant execute on function public.hr_dismiss_probation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. HR dashboard (HR staff and the Super Admin)
-- ---------------------------------------------------------------------------
create or replace function private.hr_require_staff()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff can use the e-mail automation.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.hr_require_staff() from public, anon;
grant execute on function private.hr_require_staff() to authenticated, service_role;

create or replace function public.hr_email_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return jsonb_build_object(
    'today', v_today,
    'lastRun', (select value from public.hr_automation_state where key = 'last_schedule'),
    'last30Days', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) as n from public.hr_email_events where created_at > now() - interval '30 days' group by status) s), '{}'::jsonb),
    'byKind', coalesce((select jsonb_object_agg(kind, n) from (
        select kind, count(*) as n from public.hr_email_events where status = 'SENT' and sent_at > now() - interval '365 days' group by kind) s), '{}'::jsonb),
    'queue', jsonb_build_object(
      'pending', (select count(*) from public.hr_email_events where status in ('PENDING', 'SENDING')),
      'retrying', (select count(*) from public.hr_email_events where status = 'RETRY'),
      'failed', (select count(*) from public.hr_email_events where status = 'FAILED')),
    'confirmations', jsonb_build_object(
      'pending', (select count(*) from public.hr_probation_cycles where status = 'PENDING'),
      'dueWithin7Days', (select count(*) from public.hr_probation_cycles where status = 'PENDING' and probation_end between v_today and v_today + 7),
      'overdue', (select count(*) from public.hr_probation_cycles where status = 'PENDING' and probation_end < v_today)),
    'upcoming', coalesce((select jsonb_agg(u order by (u ->> 'date'), (u ->> 'name')) from (
        select jsonb_build_object('kind', 'BIRTHDAY', 'name', m.full_name, 'date', dd.g) as u
          from private.hr_mail_employees() m, generate_series(0, 13) n,
               lateral (select v_today + n as g) dd
         where m.is_active and m.date_of_birth is not null and private.hr_occasion_date(m.date_of_birth, extract(year from dd.g)::int) = dd.g
        union all
        select jsonb_build_object('kind', 'ANNIVERSARY', 'name', m.full_name, 'date', dd.g,
                                  'years', extract(year from dd.g)::int - extract(year from m.joining_date)::int)
          from private.hr_mail_employees() m, generate_series(0, 13) n,
               lateral (select v_today + n as g) dd
         where m.is_active and m.joining_date is not null and extract(year from dd.g) > extract(year from m.joining_date)
           and private.hr_occasion_date(m.joining_date, extract(year from dd.g)::int) = dd.g) x), '[]'::jsonb));
end $$;
revoke all on function public.hr_email_overview() from public, anon;
grant execute on function public.hr_email_overview() to authenticated;

create or replace function public.hr_email_history(p_status text default null, p_kind text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_total bigint;
begin
  perform private.hr_require_staff();
  select count(*) into v_total from public.hr_email_events ev
   where (p_status is null or ev.status = p_status) and (p_kind is null or ev.kind = p_kind);
  return jsonb_build_object('total', v_total, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', ev.id, 'kind', ev.kind, 'employeeName', ev.payload ->> 'employeeName', 'recipientEmail', ev.recipient_email,
        'recipientName', ev.recipient_name, 'status', ev.status, 'attempts', ev.attempts, 'eventDate', ev.event_date,
        'sendAfter', ev.send_after, 'sentAt', ev.sent_at, 'lastAttemptAt', ev.last_attempt_at, 'nextAttemptAt', ev.next_attempt_at,
        'error', ev.last_error, 'createdAt', ev.created_at) order by ev.created_at desc, ev.id)
      from (select * from public.hr_email_events e2
             where (p_status is null or e2.status = p_status) and (p_kind is null or e2.kind = p_kind)
             order by e2.created_at desc, e2.id
             limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) ev), '[]'::jsonb));
end $$;
revoke all on function public.hr_email_history(text, text, integer, integer) from public, anon;
grant execute on function public.hr_email_history(text, text, integer, integer) to authenticated;

create or replace function public.hr_probation_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((
    select jsonb_agg(private.hr_cycle_json(c) order by (c.status = 'PENDING') desc, c.probation_end)
      from public.hr_probation_cycles c
     where c.status = 'PENDING' or c.updated_at > now() - interval '90 days'), '[]'::jsonb);
end $$;
revoke all on function public.hr_probation_list() from public, anon;
grant execute on function public.hr_probation_list() to authenticated;

-- Try a failed e-mail again (its retries start from zero).
create or replace function public.hr_email_retry(p_event uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ev public.hr_email_events;
begin
  perform private.hr_require_staff();
  select * into ev from public.hr_email_events where id = p_event for update;
  if ev.id is null then raise exception 'NOT_FOUND: E-mail not found.' using errcode = 'P0001'; end if;
  if ev.status <> 'FAILED' then raise exception 'CONFLICT: Only a failed e-mail can be tried again.' using errcode = 'P0001'; end if;
  update public.hr_email_events set status = 'PENDING', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
   where id = ev.id returning * into ev;
  return jsonb_build_object('id', ev.id, 'status', ev.status);
end $$;
revoke all on function public.hr_email_retry(uuid) from public, anon;
grant execute on function public.hr_email_retry(uuid) to authenticated;

-- Employees the automation cannot serve yet, and why.
create or replace function public.hr_email_data_issues()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object('employeeKey', m.employee_key, 'name', m.full_name, 'department', m.department_name, 'email', nullif(m.email, ''),
                                        'dateOfBirth', m.date_of_birth, 'joiningDate', m.joining_date,
                                        'issues', to_jsonb(array_remove(array[
                                          case when m.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then 'NO_VALID_EMAIL' end,
                                          case when m.date_of_birth is null then 'NO_DATE_OF_BIRTH' end,
                                          case when m.joining_date is null then 'NO_JOINING_DATE' end,
                                          case when m.joining_date > v_today then 'JOINING_DATE_IN_THE_FUTURE' end], null)))
                    order by m.full_name)
      from private.hr_mail_employees() m
     where m.is_active and (m.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or m.date_of_birth is null or m.joining_date is null or m.joining_date > v_today)), '[]'::jsonb);
end $$;
revoke all on function public.hr_email_data_issues() from public, anon;
grant execute on function public.hr_email_data_issues() to authenticated;

-- HR fills in a missing date of birth / joining date (a CRM account: its personal details; an HR-only record: the record).
create or replace function public.hr_set_employee_dates(p_employee_key text, p_date_of_birth date default null, p_joining_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid;
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  if p_date_of_birth is null and p_joining_date is null then
    raise exception 'VALIDATION_ERROR: Enter a date of birth or a joining date.' using errcode = 'P0001';
  end if;
  if p_date_of_birth is not null and (p_date_of_birth < date '1940-01-01' or p_date_of_birth > v_today - 365 * 14) then
    raise exception 'VALIDATION_ERROR: Enter a valid date of birth (age 14 to 100).' using errcode = 'P0001';
  end if;
  if p_joining_date is not null and (p_joining_date < date '1990-01-01' or p_joining_date > v_today + 366) then
    raise exception 'VALIDATION_ERROR: Enter a valid joining date.' using errcode = 'P0001';
  end if;

  if p_employee_key like 'HR:%' then
    update public.hr_employees
       set joining_date = coalesce(to_char(p_joining_date, 'YYYY-MM-DD'), joining_date),
           data = case when p_date_of_birth is null then data
                       else jsonb_set(coalesce(data, '{}'::jsonb), '{dateOfBirth}', to_jsonb(to_char(p_date_of_birth, 'YYYY-MM-DD'))) end,
           updated_at = now()
     where id = substr(p_employee_key, 4) and profile_id is null;
    if not found then raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001'; end if;
  else
    begin
      v_profile := p_employee_key::uuid;
    exception when others then
      raise exception 'VALIDATION_ERROR: Unknown employee.' using errcode = 'P0001';
    end;
    if not exists (select 1 from public.profiles where id = v_profile and role <> 'SUPER_ADMIN') then
      raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
    end if;
    insert into public.employee_personal_details (profile_id, date_of_birth, joining_date)
    values (v_profile, p_date_of_birth, p_joining_date)
    on conflict (profile_id) do update
       set date_of_birth = coalesce(excluded.date_of_birth, public.employee_personal_details.date_of_birth),
           joining_date = coalesce(excluded.joining_date, public.employee_personal_details.joining_date),
           updated_at = now();
    if p_joining_date is not null then
      update public.hr_employees set joining_date = to_char(p_joining_date, 'YYYY-MM-DD'), updated_at = now() where profile_id = v_profile;
    end if;
  end if;
  perform private.write_audit('EMPLOYEE_DATES_SET', 'hr_employee', null, null, null, jsonb_build_object('employeeKey', p_employee_key));
  return jsonb_build_object('employeeKey', p_employee_key, 'dateOfBirth', p_date_of_birth, 'joiningDate', p_joining_date);
end $$;
revoke all on function public.hr_set_employee_dates(text, date, date) from public, anon;
grant execute on function public.hr_set_employee_dates(text, date, date) to authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261108000100_chat.sql
-- =============================================================================
-- Chat: (A) Client chat and (B) Internal employee chat (direct messages and groups).
--
-- One set of tables, one set of functions, two completely separate audiences:
--   CLIENT conversation  one per customer. Participants are decided LIVE from the customer's current assignment, never
--                        stored: the client, the customer's Team Member and Team Lead (private.support_member_of /
--                        support_lead_of). The Department Head of the customer's department (and the Super Admin) can
--                        READ it as a reviewer and can never write: the write check does not know that role.
--   DIRECT / GROUP       internal only; explicit membership (chat_members). A client can never be a member (members are
--                        profiles, and a client login has no profile).
--
-- Rules that are written down here and nowhere else:
--  * Identity comes from auth.uid(); nothing the caller sends can name a different sender.
--  * Tables are readable only through row level security (the same rule Supabase Realtime applies to each change it
--    delivers) and are NEVER writable by the API roles: every change goes through the functions below.
--  * Every message has a per-conversation sequence number (seq) assigned under a row lock, so order is stable, a
--    reconnecting screen asks for "everything after seq N", and unread counts are plain arithmetic.
--  * Sending is idempotent: the screen sends a client_msg_id; a retry or a duplicate request stores one message.
--  * History policy: a CLIENT conversation shows its whole history to the CURRENT assignees (the team changes, the
--    customer's thread stays, and the previous assignee loses access at once). A group member sees messages from
--    the moment they joined; a member who was removed or left loses the conversation entirely, including files.
--  * Read-state: chat_read_state (one row per person and conversation). "Seen" ticks use two mirrored columns on the
--    conversation (client_read_seq / staff_read_seq); reviewers never count as "staff who read it".
--  * Department Head review opens are audited (CLIENT_CHAT_REVIEWED, at most once per 30 minutes per person and chat).
--  * Not included on purpose: editing or deleting messages, voice or video, end-to-end encryption (messages are
--    protected by access control and encryption in transit and at rest, not end to end).
-- Additive / idempotent: safe to run again in the Supabase SQL editor. Nothing is deleted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('CLIENT', 'DIRECT', 'GROUP')),
  customer_id uuid references public.customers (id) on delete cascade,
  title text check (title is null or length(btrim(title)) between 1 and 80),
  -- DIRECT only: the two profile ids, sorted, so a pair of people can only ever have one conversation
  direct_key text,
  created_by uuid,
  last_seq bigint not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_name text,
  -- "seen" ticks of the client chat: how far the client / the assigned staff have read
  client_read_seq bigint not null default 0,
  staff_read_seq bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_conversation_shape check (
    (kind = 'CLIENT' and customer_id is not null and direct_key is null and title is null)
    or (kind = 'DIRECT' and customer_id is null and direct_key is not null and title is null)
    or (kind = 'GROUP' and customer_id is null and direct_key is null and title is not null))
);
create unique index if not exists chat_conversations_client_key on public.chat_conversations (customer_id) where kind = 'CLIENT';
create unique index if not exists chat_conversations_direct_key on public.chat_conversations (direct_key) where kind = 'DIRECT';
create index if not exists chat_conversations_activity_idx on public.chat_conversations (last_message_at desc nulls last);

create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('ADMIN', 'MEMBER')),
  joined_at timestamptz not null default now(),
  -- the member sees messages with seq greater than this (0 = everything; a member added later starts at "now")
  visible_from_seq bigint not null default 0,
  left_at timestamptz,
  removed_by uuid,
  primary key (conversation_id, profile_id)
);
create index if not exists chat_members_profile_idx on public.chat_members (profile_id) where left_at is null;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  seq bigint not null,
  -- the auth user who wrote it (a profile for staff, the client login for clients); null for system lines
  sender_id uuid,
  sender_kind text not null check (sender_kind in ('CLIENT', 'STAFF', 'SYSTEM')),
  -- names are kept as they were when the message was written
  sender_name text,
  sender_label text,
  kind text not null default 'TEXT' check (kind in ('TEXT', 'SYSTEM')),
  body text not null default '' check (length(body) <= 4000),
  reply_to uuid references public.chat_messages (id) on delete set null,
  client_msg_id uuid,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5),
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);
create unique index if not exists chat_messages_client_msg_key on public.chat_messages (conversation_id, sender_id, client_msg_id) where client_msg_id is not null;
create index if not exists chat_messages_history_idx on public.chat_messages (conversation_id, seq desc);

create table if not exists public.chat_read_state (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  user_id uuid not null,
  last_read_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- A file shared in a conversation. The file lives in the storage abstraction (R2 or Supabase Storage); only a reference
-- is kept here. It is PENDING until the upload is confirmed, then READY; a READY file without a message is only
-- reachable by the person who uploaded it until it is attached to a message.
create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  message_id uuid references public.chat_messages (id) on delete cascade,
  uploader_id uuid not null,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  status text not null default 'PENDING' check (status in ('PENDING', 'READY', 'FAILED')),
  storage_bucket text not null default 'chat-attachments',
  storage_path text not null,
  storage_provider text check (storage_provider in ('SUPABASE', 'R2')),
  storage_ref text,
  storage_etag text,
  created_at timestamptz not null default now()
);
create index if not exists chat_attachments_conversation_idx on public.chat_attachments (conversation_id, created_at desc);
create index if not exists chat_attachments_message_idx on public.chat_attachments (message_id) where message_id is not null;

-- Private bucket (no browser access: the API signs short-lived URLs after the database allowed the download).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('chat-attachments', 'chat-attachments', false, 5242880,
            array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- The client's notifications can point to the chat.
alter table public.client_notifications drop constraint if exists client_notifications_entity_type_check;
alter table public.client_notifications add constraint client_notifications_entity_type_check
  check (entity_type in ('invoice', 'service', 'plan', 'ticket', 'service_request', 'plan_request', 'addon', 'announcement', 'calendar', 'document', 'chat'));

-- ---------------------------------------------------------------------------
-- 2. Who may do what (the only place these rules are written)
-- ---------------------------------------------------------------------------
-- A Department Head of the customer's department, or the Super Admin: may READ the client conversation.
create or replace function private.chat_can_review(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_super_admin()
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
      from public.customers c where c.id = p_customer), false)
$$;
revoke all on function private.chat_can_review(uuid) from public, anon;

-- How the signed-in user relates to a conversation: CLIENT, STAFF (assigned Team Member / Team Lead), MEMBER (internal),
-- REVIEWER (read only) or NULL (no access at all). Clients and staff are told apart by their login: a client login has
-- no profile, a staff login has no client account.
create or replace function private.chat_access(p_conversation uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  v_client uuid;
  me uuid;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null then
    return null;
  end if;
  if c.kind = 'CLIENT' then
    v_client := private.my_client_customer();
    if v_client is not null then
      return case when v_client = c.customer_id then 'CLIENT' end;
    end if;
    me := private.my_id();
    if me is null then
      return null;
    end if;
    if me = private.support_member_of(c.customer_id) or me = private.support_lead_of(c.customer_id) then
      return 'STAFF';
    end if;
    if private.chat_can_review(c.customer_id) then
      return 'REVIEWER';
    end if;
    return null;
  end if;
  me := private.my_id();
  if me is not null and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null) then
    return 'MEMBER';
  end if;
  return null;
end $$;
revoke all on function private.chat_access(uuid) from public, anon;

-- The first message number this person may see (members of a group start where they joined).
create or replace function private.chat_visible_from(p_conversation uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select m.visible_from_seq from public.chat_members m
                    where m.conversation_id = p_conversation and m.profile_id = (select private.my_id()) and m.left_at is null), 0)
$$;
revoke all on function private.chat_visible_from(uuid) from public, anon;

create or replace function private.chat_message_visible(p_conversation uuid, p_seq bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select a is not null and (a <> 'MEMBER' or p_seq > private.chat_visible_from(p_conversation))
                     from (select private.chat_access(p_conversation) as a) x), false)
$$;
revoke all on function private.chat_message_visible(uuid, bigint) from public, anon;

-- May these two employees message each other? Every ACTIVE employee may message every other one (a client login is
-- not an employee). To restrict chat (for example to the same department) change this one function.
create or replace function private.chat_may_message(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and (select count(*) from public.profiles p where p.id in (p_a, p_b) and p.status = 'ACTIVE') = 2
$$;
revoke all on function private.chat_may_message(uuid, uuid) from public, anon;

-- Row level security policies run as the signed-in user, so the two helpers they call must be executable by that role
-- (they are SECURITY DEFINER: they read the tables as the owner, never as the caller).
grant execute on function private.chat_access(uuid) to authenticated;
grant execute on function private.chat_message_visible(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Row level security: read only, and only what the rules above allow
-- ---------------------------------------------------------------------------
alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_read_state enable row level security;
alter table public.chat_attachments enable row level security;
revoke all on public.chat_conversations, public.chat_members, public.chat_messages, public.chat_read_state, public.chat_attachments from public, anon, authenticated;
grant select on public.chat_conversations, public.chat_members, public.chat_messages to authenticated;

drop policy if exists chat_conversations_read on public.chat_conversations;
create policy chat_conversations_read on public.chat_conversations for select to authenticated
  using (private.chat_access(id) is not null);

-- Members of the same conversation see each other; a person always sees their own row (so a removal reaches them live).
drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members for select to authenticated
  using (profile_id = (select private.my_id()) or private.chat_access(conversation_id) = 'MEMBER');

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (private.chat_message_visible(conversation_id, seq));
-- chat_read_state and chat_attachments have no policy and no grant: they are reached only through the functions.

-- ---------------------------------------------------------------------------
-- 4. Building blocks (JSON for the screens, unread counts, system lines)
-- ---------------------------------------------------------------------------
create or replace function private.chat_role_label(p_role public.app_role)
returns text language sql immutable set search_path = '' as $$
  select case p_role when 'SUPER_ADMIN' then 'Admin' when 'DEPARTMENT_HEAD' then 'Department Head'
                     when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end
$$;
revoke all on function private.chat_role_label(public.app_role) from public, anon;

create or replace function private.chat_unread(p_conversation uuid, p_user uuid, p_from bigint)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.chat_messages m
   where m.conversation_id = p_conversation and m.kind = 'TEXT' and m.sender_id is distinct from p_user
     and m.seq > greatest(coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = p_conversation and r.user_id = p_user), 0), coalesce(p_from, 0))
$$;
revoke all on function private.chat_unread(uuid, uuid, bigint) from public, anon;

-- A message as the screens receive it. The sender's id is not part of it (the screen only needs "mine").
create or replace function private.chat_message_json(m public.chat_messages)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'conversationId', m.conversation_id, 'seq', m.seq, 'mine', m.sender_id is not distinct from auth.uid() and m.sender_id is not null,
    'senderKind', m.sender_kind, 'senderName', m.sender_name, 'senderLabel', m.sender_label, 'kind', m.kind, 'body', m.body,
    'attachments', m.attachments, 'clientMsgId', m.client_msg_id, 'createdAt', m.created_at,
    'replyTo', (select jsonb_build_object('id', r.id, 'seq', r.seq, 'senderName', r.sender_name, 'body', left(r.body, 140)) from public.chat_messages r where r.id = m.reply_to))
$$;
revoke all on function private.chat_message_json(public.chat_messages) from public, anon;

-- A line the system writes into the conversation ("Asha added Ravi"). The caller holds the conversation lock or is a trigger.
create or replace function private.chat_system_message(p_conversation uuid, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_seq bigint;
begin
  update public.chat_conversations set last_seq = last_seq + 1, last_message_at = now(), last_message_preview = left(p_text, 160),
         last_sender_name = null, updated_at = now()
   where id = p_conversation returning last_seq into v_seq;
  if v_seq is null then
    return;
  end if;
  insert into public.chat_messages (conversation_id, seq, sender_kind, kind, body) values (p_conversation, v_seq, 'SYSTEM', 'SYSTEM', left(p_text, 500));
end $$;
revoke all on function private.chat_system_message(uuid, text) from public, anon;

-- The customer's current Team Member and Team Lead (only people who are still ACTIVE count).
create or replace function private.chat_team_json(p_customer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'teamMember', (select jsonb_build_object('name', p.full_name, 'position', p.position) from public.profiles p where p.id = private.support_member_of(p_customer) and p.status = 'ACTIVE'),
    'teamLead', (select jsonb_build_object('name', p.full_name, 'position', p.position) from public.profiles p where p.id = private.support_lead_of(p_customer) and p.status = 'ACTIVE'))
$$;
revoke all on function private.chat_team_json(uuid) from public, anon;

-- A conversation as the signed-in person sees it.
create or replace function private.chat_conversation_json(c public.chat_conversations, p_full boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a text := private.chat_access(c.id);
  me uuid := auth.uid();
  v_from bigint := case when a = 'MEMBER' then private.chat_visible_from(c.id) else 0 end;
  v_title text;
  v_customer jsonb := null;
  v_team jsonb := null;
  v_members jsonb := null;
  v_admin boolean := false;
  v_peer_read bigint := null;
  v_read bigint := coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = me), 0);
begin
  if a is null then
    return null;
  end if;
  if c.kind = 'CLIENT' then
    select jsonb_build_object('id', x.id, 'name', x.name, 'business', coalesce(nullif(btrim(x.company), ''), x.name), 'code', x.customer_code,
                              'hasLogin', exists (select 1 from public.customer_client_accounts ca where ca.customer_id = x.id))
      into v_customer from public.customers x where x.id = c.customer_id;
    v_team := private.chat_team_json(c.customer_id);
    v_title := case when a = 'CLIENT' then 'Your Amuwa team' else v_customer ->> 'business' end;
    v_peer_read := case when a = 'CLIENT' then c.staff_read_seq else c.client_read_seq end;
    if a = 'CLIENT' then
      v_customer := null;
    end if;
  elsif c.kind = 'DIRECT' then
    select p.full_name into v_title from public.chat_members m join public.profiles p on p.id = m.profile_id
     where m.conversation_id = c.id and m.profile_id <> me limit 1;
    select r.last_read_seq into v_peer_read from public.chat_read_state r where r.conversation_id = c.id and r.user_id <> me limit 1;
  else
    v_title := c.title;
  end if;
  if a = 'MEMBER' then
    v_admin := exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null and m.role = 'ADMIN');
    if p_full or c.kind = 'GROUP' then
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', m.role, 'position', p.position,
                                                   'label', private.chat_role_label(p.role), 'department', d.name, 'me', p.id = me)
                               order by (m.role = 'ADMIN') desc, p.full_name), '[]'::jsonb)
        into v_members from public.chat_members m join public.profiles p on p.id = m.profile_id
        left join public.departments d on d.id = p.department_id
       where m.conversation_id = c.id and m.left_at is null;
    end if;
  end if;
  return jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'access', a, 'canWrite', a in ('CLIENT', 'STAFF', 'MEMBER'), 'title', v_title,
    'customer', v_customer, 'team', v_team, 'members', v_members, 'isAdmin', v_admin,
    'assigned', case when c.kind = 'CLIENT' then (v_team -> 'teamMember') is not null or (v_team -> 'teamLead') is not null end,
    'lastSeq', c.last_seq, 'lastMessageAt', c.last_message_at, 'lastMessagePreview', c.last_message_preview, 'lastSenderName', c.last_sender_name,
    'unread', private.chat_unread(c.id, me, v_from), 'readSeq', v_read, 'peerReadSeq', v_peer_read, 'createdAt', c.created_at);
end $$;
revoke all on function private.chat_conversation_json(public.chat_conversations, boolean) from public, anon;

create or replace function private.chat_clean_name(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9._ -]', '_', 'g'), '\.{2,}', '.', 'g')
$$;
revoke all on function private.chat_clean_name(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 5. Opening conversations
-- ---------------------------------------------------------------------------
create or replace function private.chat_ensure_client_conversation(p_customer uuid)
returns public.chat_conversations language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
begin
  select * into c from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer;
  if c.id is null then
    insert into public.chat_conversations (kind, customer_id) values ('CLIENT', p_customer)
    on conflict (customer_id) where kind = 'CLIENT' do nothing;
    select * into c from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer;
  end if;
  return c;
end $$;
revoke all on function private.chat_ensure_client_conversation(uuid) from public, anon;

-- The client's own conversation (created on first use). The customer always comes from the login.
create or replace function public.chat_client_conversation()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  c public.chat_conversations := private.chat_ensure_client_conversation(v_customer);
begin
  return private.chat_conversation_json(c, true);
end $$;

-- Staff: the conversation of a customer they look after (their Team Member / Team Lead), or review (Department Head).
create or replace function public.chat_customer_conversation(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  c public.chat_conversations;
begin
  -- coalesce: for someone who is not assigned the comparisons are NULL, and NOT NULL would not refuse
  if me is null or p_customer is null
     or not coalesce(me = private.support_member_of(p_customer) or me = private.support_lead_of(p_customer) or private.chat_can_review(p_customer), false) then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  c := private.chat_ensure_client_conversation(p_customer);
  return private.chat_conversation_json(c, true);
end $$;

-- The customers this employee looks after (Team Member or Team Lead), with their chat.
create or replace function public.chat_my_clients(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row order by sort_at desc nulls last, name) from (
      select c.name, cv.last_message_at as sort_at, jsonb_build_object(
        'customerId', c.id, 'name', c.name, 'business', coalesce(nullif(btrim(c.company), ''), c.name), 'code', c.customer_code,
        'conversationId', cv.id, 'lastMessageAt', cv.last_message_at, 'lastMessagePreview', cv.last_message_preview,
        'unread', case when cv.id is null then 0 else private.chat_unread(cv.id, me, 0) end,
        'hasLogin', exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id),
        'role', case when me = private.support_member_of(c.id) then 'Team Member' else 'Team Lead' end) as row
        from public.customers c
        left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id
       where c.department_id = private.my_department_id()
         and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
         and (me = private.support_member_of(c.id) or me = private.support_lead_of(c.id))
         and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
       order by cv.last_message_at desc nulls last, c.name limit 200) t), '[]'::jsonb);
end $$;

-- Internal conversations (direct messages and groups) of the signed-in employee, newest first.
create or replace function public.chat_internal_list(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(j order by (j ->> 'lastMessageAt') desc nulls last, (j ->> 'createdAt') desc) from (
      select private.chat_conversation_json(c, false) as j
        from public.chat_conversations c join public.chat_members m on m.conversation_id = c.id and m.profile_id = me and m.left_at is null
       where c.kind in ('DIRECT', 'GROUP')
       order by c.last_message_at desc nulls last limit 200) t
     where v_term is null or lower(coalesce(j ->> 'title', '')) like '%' || v_term || '%' or lower(coalesce(j ->> 'lastMessagePreview', '')) like '%' || v_term || '%'), '[]'::jsonb);
end $$;

-- Department Head / Super Admin: the client conversations they may review, most recently active first.
create or replace function public.chat_review_list(p_search text default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_total integer;
  v_items jsonb;
begin
  if me is null or private.my_role() not in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only a Department Head can review client conversations.' using errcode = '42501';
  end if;
  with scope as (
    select cv.id, cv.last_message_at from public.chat_conversations cv join public.customers c on c.id = cv.customer_id
     where cv.kind = 'CLIENT' and cv.last_seq > 0 and private.chat_can_review(c.id)
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')),
  pg as (
    select s.last_message_at, s.id from scope s order by s.last_message_at desc nulls last
     limit least(greatest(coalesce(p_limit, 30), 1), 100) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from scope),
         coalesce((select jsonb_agg(private.chat_conversation_json(cv, false) order by pg.last_message_at desc nulls last)
                     from pg join public.chat_conversations cv on cv.id = pg.id), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

-- Opening a client conversation as a reviewer is written to the audit log (at most once per 30 minutes per person and chat).
create or replace function public.chat_review_open(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  cu public.customers;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or private.chat_access(c.id) is distinct from 'REVIEWER' then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  -- two opens at the same moment (two tabs, a double click) must still leave one entry
  perform pg_advisory_xact_lock(hashtextextended('chat_review:' || auth.uid()::text || ':' || c.id::text, 0));
  if exists (select 1 from public.audit_logs l where l.actor_id = auth.uid() and l.action = 'CLIENT_CHAT_REVIEWED'
                and l.entity_id = c.id and l.created_at > now() - interval '30 minutes') then
    return;
  end if;
  select * into cu from public.customers where id = c.customer_id;
  perform private.write_audit('CLIENT_CHAT_REVIEWED', 'chat_conversation', c.id, cu.department_id, cu.team_id, jsonb_build_object('customer_id', cu.id));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Reading and sending
-- ---------------------------------------------------------------------------
create or replace function public.chat_conversation_detail(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or private.chat_access(c.id) is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  return private.chat_conversation_json(c, true);
end $$;

-- One page of history: the newest `p_limit` messages (or the ones before `p_before_seq`), or everything after `p_after_seq`
-- (what a screen asks for when it reconnects). Oldest first.
create or replace function public.chat_messages_page(p_conversation uuid, p_before_seq bigint default null, p_after_seq bigint default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  a text;
  v_from bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows public.chat_messages[];
  v_more boolean := false;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  v_from := case when a = 'MEMBER' then private.chat_visible_from(c.id) else 0 end;
  if p_after_seq is not null then
    select coalesce(array_agg(m order by m.seq), '{}') into v_rows from (
      select * from public.chat_messages x where x.conversation_id = c.id and x.seq > greatest(p_after_seq, v_from) order by x.seq limit 200) m;
  else
    select coalesce(array_agg(m order by m.seq), '{}') into v_rows from (
      select * from public.chat_messages x where x.conversation_id = c.id and x.seq > v_from and (p_before_seq is null or x.seq < p_before_seq)
       order by x.seq desc limit v_limit) m;
    v_more := exists (select 1 from public.chat_messages x where x.conversation_id = c.id and x.seq > v_from
                         and x.seq < coalesce((select min(r.seq) from unnest(v_rows) r), 0));
  end if;
  return jsonb_build_object(
    'messages', coalesce((select jsonb_agg(private.chat_message_json(r) order by r.seq) from unnest(v_rows) r), '[]'::jsonb),
    'hasMore', v_more, 'lastSeq', c.last_seq);
end $$;

create or replace function public.chat_send_message(
  p_conversation uuid, p_body text, p_client_msg_id uuid, p_reply_to uuid default null, p_attachments uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  a text;
  me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_existing public.chat_messages;
  v_msg public.chat_messages;
  v_seq bigint;
  v_name text;
  v_label text;
  v_kind text;
  v_atts jsonb := '[]'::jsonb;
  v_n integer := coalesce(array_length(p_attachments, 1), 0);
  v_found integer;
  v_cust public.customers;
  v_to uuid;
  v_read bigint;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if a = 'REVIEWER' then
    raise exception 'FORBIDDEN: You can read this conversation as a reviewer, but only the client and their assigned team can write in it.' using errcode = '42501';
  end if;
  if p_client_msg_id is null then
    raise exception 'VALIDATION_ERROR: The message has no identifier. Please try again.' using errcode = 'P0001';
  end if;
  -- a retry or a double click: the message was already stored
  select * into v_existing from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
  if v_existing.id is not null then
    return private.chat_message_json(v_existing);
  end if;
  if v_n > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files to one message.' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'VALIDATION_ERROR: A message can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  if v_body = '' and v_n = 0 then
    raise exception 'VALIDATION_ERROR: Write a message first.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_messages x where x.sender_id = me and x.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'VALIDATION_ERROR: You are sending messages too fast. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  if c.kind = 'CLIENT' then
    select * into v_cust from public.customers where id = c.customer_id;
    if a = 'CLIENT' and not exists (select 1 from public.profiles p where p.status = 'ACTIVE' and p.id in (private.support_member_of(c.customer_id), private.support_lead_of(c.customer_id))) then
      raise exception 'VALIDATION_ERROR: Your team has not been assigned yet. Please raise a support ticket and we will help you.' using errcode = 'P0001';
    end if;
  end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages r where r.id = p_reply_to and r.conversation_id = c.id) then
    raise exception 'VALIDATION_ERROR: The message you are replying to was not found.' using errcode = 'P0001';
  end if;
  if v_n > 0 then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.file_name, 'mime', t.mime_type, 'size', t.size_bytes) order by t.created_at), '[]'::jsonb)
      into v_found, v_atts from public.chat_attachments t
     where t.id = any (p_attachments) and t.conversation_id = c.id and t.uploader_id = me and t.status = 'READY' and t.message_id is null;
    if v_found <> v_n then
      raise exception 'VALIDATION_ERROR: One of the files is not ready or was already sent. Upload it again.' using errcode = 'P0001';
    end if;
  end if;

  if a = 'CLIENT' then
    v_name := coalesce(nullif(btrim(v_cust.name), ''), 'Client');
    v_label := 'Client';
    v_kind := 'CLIENT';
  else
    select p.full_name into v_name from public.profiles p where p.id = me;
    v_kind := 'STAFF';
    v_label := case when c.kind <> 'CLIENT' then null when me = private.support_lead_of(c.customer_id) then 'Team Lead' else 'Team Member' end;
  end if;

  -- the row lock orders concurrent senders: seq is assigned one at a time
  update public.chat_conversations
     set last_seq = last_seq + 1, last_message_at = now(), updated_at = now(),
         last_message_preview = left(regexp_replace(case when v_body = '' then '[file] ' || (v_atts -> 0 ->> 'name') else v_body end, '\s+', ' ', 'g'), 160),
         last_sender_name = v_name
   where id = c.id returning last_seq into v_seq;
  begin
    insert into public.chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, sender_label, kind, body, reply_to, client_msg_id, attachments)
    values (c.id, v_seq, me, v_kind, v_name, v_label, 'TEXT', v_body, p_reply_to, p_client_msg_id, v_atts)
    returning * into v_msg;
  exception when unique_violation then
    -- two requests with the same client_msg_id raced: the other one won
    select * into v_msg from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
    return private.chat_message_json(v_msg);
  end;
  if v_n > 0 then
    update public.chat_attachments set message_id = v_msg.id where id = any (p_attachments);
  end if;
  -- the sender has read everything up to their own message
  insert into public.chat_read_state (conversation_id, user_id, last_read_seq) values (c.id, me, v_seq)
  on conflict (conversation_id, user_id) do update set last_read_seq = greatest(public.chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now();
  if c.kind = 'CLIENT' then
    if a = 'CLIENT' then
      update public.chat_conversations set client_read_seq = v_seq where id = c.id;
    else
      update public.chat_conversations set staff_read_seq = greatest(staff_read_seq, v_seq) where id = c.id;
    end if;
    -- bells: at most one per person per "unread run" (a new one only after they have read the chat)
    if a = 'CLIENT' then
      for v_to in select x from unnest(array[private.support_member_of(c.customer_id), private.support_lead_of(c.customer_id)]) x where x is not null loop
        select coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = v_to), 0) into v_read;
        perform private.notify_once(v_to, 'CHAT_CLIENT_MESSAGE', format('New message from %s', coalesce(v_cust.company, v_cust.name)),
          left(v_body, 200), 'chat', c.id, format('CHAT|%s|%s', c.id, v_read));
      end loop;
    else
      perform private.client_notify(c.customer_id, 'CHAT_MESSAGE', format('New message from %s', v_name), left(v_body, 200), 'chat', c.id,
        format('CHAT|%s|%s', c.id, (select c2.client_read_seq from public.chat_conversations c2 where c2.id = c.id) ));
    end if;
  end if;
  return private.chat_message_json(v_msg);
end $$;

create or replace function public.chat_mark_read(p_conversation uuid, p_seq bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  a text;
  me uuid := auth.uid();
  v_seq bigint;
  v_prev bigint;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  v_seq := least(greatest(coalesce(p_seq, c.last_seq), 0), c.last_seq);
  select r.last_read_seq into v_prev from public.chat_read_state r where r.conversation_id = c.id and r.user_id = me;
  insert into public.chat_read_state (conversation_id, user_id, last_read_seq) values (c.id, me, v_seq)
  on conflict (conversation_id, user_id) do update set last_read_seq = greatest(public.chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now();
  -- a direct chat shows "seen" from the read state, which nobody can subscribe to: touch the conversation so the other side's screen refreshes
  if c.kind = 'DIRECT' and v_seq > coalesce(v_prev, 0) then
    update public.chat_conversations set updated_at = clock_timestamp() where id = c.id;
  end if;
  if c.kind = 'CLIENT' and a = 'CLIENT' then
    update public.chat_conversations set client_read_seq = v_seq where id = c.id and client_read_seq < v_seq;
    update public.client_notifications set read_at = now() where customer_id = c.customer_id and entity_type = 'chat' and entity_id = c.id and read_at is null;
  elsif c.kind = 'CLIENT' and a = 'STAFF' then
    update public.chat_conversations set staff_read_seq = v_seq where id = c.id and staff_read_seq < v_seq;
  end if;
  if a <> 'CLIENT' then
    update public.notifications set read_at = now() where recipient_id = me and entity_type = 'chat' and entity_id = c.id and read_at is null;
  end if;
  return jsonb_build_object('readSeq', (select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = me));
end $$;

-- Unread totals for the badges: internal chats, the employee's own clients, the review list (Department Head).
create or replace function public.chat_unread_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_client uuid := private.my_client_customer();
  v_internal integer := 0;
  v_clients integer := 0;
  v_review integer := 0;
begin
  if v_client is not null then
    select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_clients from public.chat_conversations c where c.kind = 'CLIENT' and c.customer_id = v_client;
    return jsonb_build_object('total', v_clients, 'internal', 0, 'clients', v_clients, 'review', 0);
  end if;
  if private.my_id() is null then
    return jsonb_build_object('total', 0, 'internal', 0, 'clients', 0, 'review', 0);
  end if;
  select coalesce(sum(private.chat_unread(m.conversation_id, me, m.visible_from_seq)), 0) into v_internal
    from public.chat_members m where m.profile_id = me and m.left_at is null;
  select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_clients
    from public.chat_conversations c join public.customers cu on cu.id = c.customer_id
   where c.kind = 'CLIENT' and c.last_seq > 0 and cu.department_id = private.my_department_id()
     and (me = private.support_member_of(cu.id) or me = private.support_lead_of(cu.id));
  if private.my_role() in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_review
      from public.chat_conversations c where c.kind = 'CLIENT' and c.last_seq > 0 and private.chat_access(c.id) = 'REVIEWER';
  end if;
  return jsonb_build_object('total', v_internal + v_clients, 'internal', v_internal, 'clients', v_clients, 'review', v_review);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Internal chat: people, direct messages, groups
-- ---------------------------------------------------------------------------
-- Find colleagues by name, position, department or team. Only what is needed to pick someone is returned.
create or replace function public.chat_directory(p_search text default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'label', private.chat_role_label(p.role), 'position', p.position,
                                         'department', d.name, 'team', t.name) order by p.full_name)
      from (select * from public.profiles x where x.status = 'ACTIVE' and x.id <> me order by x.full_name limit 2000) p
      left join public.departments d on d.id = p.department_id
      left join public.teams t on t.id = p.team_id
     where private.chat_may_message(me, p.id)
       and (v_term is null or lower(p.full_name) like '%' || v_term || '%' or lower(coalesce(p."position", '')) like '%' || v_term || '%'
            or lower(coalesce(d.name, '')) like '%' || v_term || '%' or lower(coalesce(t.name, '')) like '%' || v_term || '%')
     limit least(greatest(coalesce(p_limit, 30), 1), 100)), '[]'::jsonb);
end $$;

create or replace function public.chat_open_direct(p_profile uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_key text;
  c public.chat_conversations;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.chat_may_message(me, p_profile) then
    raise exception 'VALIDATION_ERROR: You cannot start a conversation with this person.' using errcode = 'P0001';
  end if;
  v_key := least(me::text, p_profile::text) || ':' || greatest(me::text, p_profile::text);
  select * into c from public.chat_conversations where kind = 'DIRECT' and direct_key = v_key;
  if c.id is null then
    insert into public.chat_conversations (kind, direct_key, created_by) values ('DIRECT', v_key, me)
    on conflict (direct_key) where kind = 'DIRECT' do nothing;
    select * into c from public.chat_conversations where kind = 'DIRECT' and direct_key = v_key;
    insert into public.chat_members (conversation_id, profile_id, role) values (c.id, me, 'MEMBER'), (c.id, p_profile, 'MEMBER') on conflict do nothing;
  end if;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_create_group(p_title text, p_members uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_title text := btrim(coalesce(p_title, ''));
  v_ids uuid[];
  v_id uuid;
  c public.chat_conversations;
  v_names text;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if length(v_title) < 1 or length(v_title) > 80 then
    raise exception 'VALIDATION_ERROR: Give the group a name (up to 80 characters).' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_members, '{}')) x where x <> me;
  if coalesce(array_length(v_ids, 1), 0) < 1 then
    raise exception 'VALIDATION_ERROR: Add at least one other person to the group.' using errcode = 'P0001';
  end if;
  if array_length(v_ids, 1) > 99 then
    raise exception 'VALIDATION_ERROR: A group can have at most 100 people.' using errcode = 'P0001';
  end if;
  foreach v_id in array v_ids loop
    if not private.chat_may_message(me, v_id) then
      raise exception 'VALIDATION_ERROR: One of the people you picked cannot be added to a group.' using errcode = 'P0001';
    end if;
  end loop;
  insert into public.chat_conversations (kind, title, created_by) values ('GROUP', v_title, me) returning * into c;
  insert into public.chat_members (conversation_id, profile_id, role) values (c.id, me, 'ADMIN');
  insert into public.chat_members (conversation_id, profile_id, role) select c.id, x, 'MEMBER' from unnest(v_ids) x;
  select string_agg(p.full_name, ', ' order by p.full_name) into v_names from public.profiles p where p.id = any (v_ids);
  perform private.chat_system_message(c.id, format('%s created the group and added %s', (select full_name from public.profiles where id = me), v_names));
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

-- Locks the group and checks the caller may manage it (ADMIN). Returns the locked row.
create or replace function private.chat_lock_group(p_conversation uuid, p_need_admin boolean)
returns public.chat_conversations language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  me uuid := private.my_id();
begin
  select * into c from public.chat_conversations where id = p_conversation and kind = 'GROUP' for update;
  if c.id is null or me is null or not exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null) then
    raise exception 'NOT_FOUND: Group not found.' using errcode = 'P0001';
  end if;
  if p_need_admin and not exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null and m.role = 'ADMIN') then
    raise exception 'FORBIDDEN: Only a group admin can do this.' using errcode = '42501';
  end if;
  return c;
end $$;
revoke all on function private.chat_lock_group(uuid, boolean) from public, anon;

create or replace function public.chat_group_rename(p_conversation uuid, p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, true);
  v_title text := btrim(coalesce(p_title, ''));
begin
  if length(v_title) < 1 or length(v_title) > 80 then
    raise exception 'VALIDATION_ERROR: Give the group a name (up to 80 characters).' using errcode = 'P0001';
  end if;
  if v_title <> c.title then
    update public.chat_conversations set title = v_title, updated_at = now() where id = c.id;
    perform private.chat_system_message(c.id, format('%s renamed the group to "%s"', (select full_name from public.profiles where id = private.my_id()), v_title));
  end if;
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_group_add_members(p_conversation uuid, p_members uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, true);
  me uuid := private.my_id();
  v_id uuid;
  v_names text[] := '{}';
  v_added integer := 0;
begin
  foreach v_id in array coalesce(p_members, '{}') loop
    if not private.chat_may_message(me, v_id) then
      raise exception 'VALIDATION_ERROR: One of the people you picked cannot be added to a group.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = v_id and m.left_at is null) then
      continue;
    end if;
    if (select count(*) from public.chat_members m where m.conversation_id = c.id and m.left_at is null) >= 100 then
      raise exception 'VALIDATION_ERROR: A group can have at most 100 people.' using errcode = 'P0001';
    end if;
    -- a new member (or one coming back) sees the conversation from now on
    insert into public.chat_members (conversation_id, profile_id, role, visible_from_seq, joined_at)
    values (c.id, v_id, 'MEMBER', c.last_seq, now())
    on conflict (conversation_id, profile_id) do update
      set left_at = null, removed_by = null, role = 'MEMBER', visible_from_seq = excluded.visible_from_seq, joined_at = now();
    v_names := v_names || (select full_name from public.profiles where id = v_id);
    v_added := v_added + 1;
  end loop;
  if v_added > 0 then
    perform private.chat_system_message(c.id, format('%s added %s', (select full_name from public.profiles where id = me), array_to_string(v_names, ', ')));
  end if;
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_group_remove_member(p_conversation uuid, p_profile uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, true);
  me uuid := private.my_id();
  m public.chat_members;
begin
  if p_profile = me then
    raise exception 'VALIDATION_ERROR: Use "Leave group" to leave a group yourself.' using errcode = 'P0001';
  end if;
  select * into m from public.chat_members where conversation_id = c.id and profile_id = p_profile and left_at is null;
  if m.profile_id is null then
    raise exception 'NOT_FOUND: That person is not in the group.' using errcode = 'P0001';
  end if;
  if m.role = 'ADMIN' then
    raise exception 'VALIDATION_ERROR: Remove their admin role first, then remove them.' using errcode = 'P0001';
  end if;
  update public.chat_members set left_at = now(), removed_by = me where conversation_id = c.id and profile_id = p_profile;
  perform private.chat_system_message(c.id, format('%s removed %s', (select full_name from public.profiles where id = me), (select full_name from public.profiles where id = p_profile)));
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_group_set_admin(p_conversation uuid, p_profile uuid, p_admin boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, true);
begin
  if not exists (select 1 from public.chat_members where conversation_id = c.id and profile_id = p_profile and left_at is null) then
    raise exception 'NOT_FOUND: That person is not in the group.' using errcode = 'P0001';
  end if;
  if not p_admin and (select count(*) from public.chat_members where conversation_id = c.id and left_at is null and role = 'ADMIN') <= 1
     and exists (select 1 from public.chat_members where conversation_id = c.id and profile_id = p_profile and role = 'ADMIN') then
    raise exception 'VALIDATION_ERROR: A group needs at least one admin.' using errcode = 'P0001';
  end if;
  update public.chat_members set role = case when p_admin then 'ADMIN' else 'MEMBER' end where conversation_id = c.id and profile_id = p_profile;
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_group_leave(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, false);
  me uuid := private.my_id();
  v_next uuid;
begin
  update public.chat_members set left_at = now() where conversation_id = c.id and profile_id = me;
  -- the group always keeps an admin: the longest-standing member takes over
  if not exists (select 1 from public.chat_members where conversation_id = c.id and left_at is null and role = 'ADMIN') then
    select profile_id into v_next from public.chat_members where conversation_id = c.id and left_at is null order by joined_at limit 1;
    if v_next is not null then
      update public.chat_members set role = 'ADMIN' where conversation_id = c.id and profile_id = v_next;
    end if;
  end if;
  perform private.chat_system_message(c.id, format('%s left the group', (select full_name from public.profiles where id = me)));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Attachments (the API issues the upload and download links after these checks)
-- ---------------------------------------------------------------------------
create or replace function public.chat_begin_upload(p_conversation uuid, p_file_name text, p_mime text, p_size bigint)
returns public.chat_attachments language plpgsql security definer set search_path = '' as $$
declare
  a text := private.chat_access(p_conversation);
  me uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  r public.chat_attachments;
begin
  if a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if a = 'REVIEWER' then
    raise exception 'FORBIDDEN: You can read this conversation as a reviewer, but you cannot send files in it.' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: The file needs a name (up to 200 characters).' using errcode = 'P0001';
  end if;
  if p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'VALIDATION_ERROR: This file type cannot be sent. Use an image, PDF, text, CSV, Word or Excel file.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_attachments t where t.uploader_id = me and t.status = 'PENDING' and t.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many uploads in progress. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  update public.chat_attachments set status = 'FAILED' where uploader_id = me and status = 'PENDING' and created_at < now() - interval '1 day';
  insert into public.chat_attachments (id, conversation_id, uploader_id, file_name, mime_type, size_bytes, storage_path)
  values (v_id, p_conversation, me, v_name, p_mime, p_size, format('%s/%s/%s', p_conversation, v_id, private.chat_clean_name(v_name)))
  returning * into r;
  return r;
end $$;

create or replace function public.chat_pending_upload(p_attachment uuid)
returns public.chat_attachments language plpgsql stable security definer set search_path = '' as $$
declare
  r public.chat_attachments;
begin
  select * into r from public.chat_attachments t where t.id = p_attachment and t.uploader_id = auth.uid() and t.status = 'PENDING';
  if r.id is null or private.chat_access(r.conversation_id) is null then
    raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001';
  end if;
  return r;
end $$;

create or replace function public.chat_complete_upload(p_attachment uuid, p_size bigint, p_etag text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.chat_attachments;
begin
  select * into r from public.chat_attachments t where t.id = p_attachment and t.uploader_id = auth.uid() and t.status = 'PENDING';
  if r.id is null or private.chat_access(r.conversation_id) is null then
    raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.chat_attachments set status = 'READY', size_bytes = p_size, storage_etag = coalesce(p_etag, storage_etag) where id = r.id returning * into r;
  return jsonb_build_object('id', r.id, 'name', r.file_name, 'mime', r.mime_type, 'size', r.size_bytes);
end $$;

create or replace function public.chat_abort_upload(p_attachment uuid)
returns void language sql security definer set search_path = '' as $$
  update public.chat_attachments set status = 'FAILED' where id = p_attachment and uploader_id = auth.uid() and status = 'PENDING'
$$;

-- Current authorization on every download: whoever may read the message (or its uploader, before it is sent).
create or replace function public.chat_attachment_download(p_attachment uuid)
returns public.chat_attachments language plpgsql stable security definer set search_path = '' as $$
declare
  r public.chat_attachments;
  m public.chat_messages;
begin
  select * into r from public.chat_attachments t where t.id = p_attachment and t.status = 'READY';
  if r.id is null then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  if r.message_id is null then
    if r.uploader_id is distinct from auth.uid() or private.chat_access(r.conversation_id) is null then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
  else
    select * into m from public.chat_messages where id = r.message_id;
    if not private.chat_message_visible(m.conversation_id, m.seq) then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 9. The client's chat follows the customer's assignment: tell the conversation when the team changes
-- ---------------------------------------------------------------------------
create or replace function private.tg_chat_team_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_conv uuid;
  v_team jsonb;
begin
  begin
    -- the same function serves customers (id) and customer_onboarding (customer_id)
    v_customer := (to_jsonb(new) ->> case when tg_table_name = 'customers' then 'id' else 'customer_id' end)::uuid;
    select id into v_conv from public.chat_conversations where kind = 'CLIENT' and customer_id = v_customer;
    if v_conv is not null then
      v_team := private.chat_team_json(v_customer);
      perform private.chat_system_message(v_conv, format('Your assigned team was updated. Team Member: %s. Team Lead: %s.',
        coalesce(v_team -> 'teamMember' ->> 'name', 'not assigned yet'), coalesce(v_team -> 'teamLead' ->> 'name', 'not assigned yet')));
    end if;
  exception when others then
    -- chat must never stop a hand-over
    raise warning 'chat: could not record the team change for customer %: %', v_customer, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_chat_team_changed() from public, anon, authenticated;
drop trigger if exists chat_team_changed_onboarding on public.customer_onboarding;
create trigger chat_team_changed_onboarding after update of team_member_id, team_lead_id on public.customer_onboarding
  for each row when (old.team_member_id is distinct from new.team_member_id or old.team_lead_id is distinct from new.team_lead_id)
  execute function private.tg_chat_team_changed();
drop trigger if exists chat_team_changed_customers on public.customers;
create trigger chat_team_changed_customers after update of owner_id on public.customers
  for each row when (old.owner_id is distinct from new.owner_id)
  execute function private.tg_chat_team_changed();

-- ---------------------------------------------------------------------------
-- 10. Grants and Realtime
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'chat\_%' loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_messages', 'chat_conversations', 'chat_members'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261115000100_hr_email_cards.sql
-- =============================================================================
-- HR e-mail automation, part 2 (safe to run again; nothing is deleted, no e-mail history is touched)
--   * the probation reminder e-mails now carry the employee's designation and reporting manager and how many days are left
--   * public.hr_email_cards(): live figures for the three automation cards on the HR dashboard (birthday, work anniversary,
--     employee confirmation reminders): sent, failed, waiting, the last e-mail and its outcome, the next occasion
-- There is no month-specific rule anywhere: every date is computed per employee from the records, in the company time zone.
-- =============================================================================

-- Designation of an employee: the HR record, else the CRM position, else the role.
create or replace function private.hr_designation(p_profile uuid, p_hr_record text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(h.designation), '') from public.hr_employees h where h.id = p_hr_record),
    (select nullif(btrim(p.position), '') from public.profiles p where p.id = p_profile),
    (select case p.role when 'DEPARTMENT_HEAD' then 'Department Head' when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end
       from public.profiles p where p.id = p_profile),
    'Not recorded')
$$;
revoke all on function private.hr_designation(uuid, text) from public, anon, authenticated;

-- Reporting manager: a member reports to the Team Lead of their team, a Team Lead (or a member without a lead) to the
-- Department Head of their department. Nobody is guessed: without either, "Not assigned".
create or replace function private.hr_reporting_manager(p_profile uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.full_name from public.profiles me
       join public.profiles m on m.team_id = me.team_id and m.role = 'TEAM_HEAD' and m.status = 'ACTIVE' and m.id <> me.id
      where me.id = p_profile and me.role = 'TEAM_MEMBER' and me.team_id is not null
      order by m.created_at limit 1),
    (select m.full_name from public.profiles me
       join public.profiles m on m.department_id = me.department_id and m.role = 'DEPARTMENT_HEAD' and m.status = 'ACTIVE' and m.id <> me.id
      where me.id = p_profile and me.department_id is not null
      order by m.created_at limit 1),
    'Not assigned')
$$;
revoke all on function private.hr_reporting_manager(uuid) from public, anon, authenticated;

create or replace function public.hr_schedule_emails(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.hr_today());
  e record;
  c record;
  r record;
  d integer;
  v_occ date;
  v_end date;
  v_n integer;
  v_birthdays integer := 0;
  v_anniversaries integer := 0;
  v_cycles integer := 0;
  v_reminders integer := 0;
  v_overdue integer := 0;
  v_new boolean;
  v_rows integer;
begin
  -- 3a. Birthdays and work anniversaries: today, and the two days before (a run that was missed still sends, late but once).
  for e in select * from private.hr_mail_employees() m where m.is_active loop
    for d in 0..2 loop
      v_occ := v_today - d;
      if e.date_of_birth is not null and e.date_of_birth <= v_occ
         and private.hr_occasion_date(e.date_of_birth, extract(year from v_occ)::int) = v_occ then
        v_new := private.hr_enqueue('BIRTHDAY:' || e.employee_key || ':' || extract(year from v_occ)::int, 'BIRTHDAY', e.employee_key, e.profile_id, null,
                  e.email, e.full_name, jsonb_build_object('employeeName', e.full_name), v_occ, private.hr_nine_am(v_occ));
        if v_new then v_birthdays := v_birthdays + 1; end if;
      end if;
      if e.joining_date is not null and extract(year from v_occ) > extract(year from e.joining_date)
         and private.hr_occasion_date(e.joining_date, extract(year from v_occ)::int) = v_occ then
        v_new := private.hr_enqueue('ANNIVERSARY:' || e.employee_key || ':' || (extract(year from v_occ)::int - extract(year from e.joining_date)::int),
                  'ANNIVERSARY', e.employee_key, e.profile_id, null, e.email, e.full_name,
                  jsonb_build_object('employeeName', e.full_name, 'years', extract(year from v_occ)::int - extract(year from e.joining_date)::int),
                  v_occ, private.hr_nine_am(v_occ));
        if v_new then v_anniversaries := v_anniversaries + 1; end if;
      end if;
    end loop;
  end loop;

  -- 3b. Probation cycles. Close the ones nobody needs any more ...
  update public.hr_probation_cycles pc
     set status = 'DISMISSED', decision_note = 'Closed automatically: the employee is no longer active.', updated_at = now()
   where pc.status = 'PENDING'
     and not exists (select 1 from private.hr_mail_employees() m where m.employee_key = pc.employee_key and m.is_active);
  update public.hr_probation_cycles pc
     set status = 'DISMISSED', decision_note = 'Closed automatically: the joining date was changed.', updated_at = now()
   where pc.status = 'PENDING'
     and exists (select 1 from private.hr_mail_employees() m where m.employee_key = pc.employee_key and m.joining_date is distinct from pc.joining_date);

  -- ... open one for recent joiners (joined less than 6 months + 30 days ago) and for everyone marked "Training / Probation".
  -- Interns have none. Employees who joined long ago are treated as confirmed: nothing is sent for them.
  for e in select * from private.hr_mail_employees() m
            where m.is_active and m.joining_date is not null and m.joining_date <= v_today and coalesce(m.hr_status, '') <> 'Intern' loop
    v_end := (e.joining_date + interval '6 months')::date;
    if coalesce(e.hr_status, '') = 'Training / Probation' or v_end >= v_today - 30 then
      insert into public.hr_probation_cycles (employee_key, profile_id, hr_record_id, employee_name, employee_email, employee_code,
                                              department_id, department_name, joining_date, probation_end)
      values (e.employee_key, e.profile_id, e.hr_record_id, e.full_name, e.email, e.employee_code, e.department_id, e.department_name, e.joining_date, v_end)
      on conflict (employee_key, joining_date) do update
         set employee_name = excluded.employee_name, employee_email = excluded.employee_email, employee_code = excluded.employee_code,
             department_id = excluded.department_id, department_name = excluded.department_name, hr_record_id = excluded.hr_record_id, updated_at = now()
       where public.hr_probation_cycles.status = 'PENDING'
         and (public.hr_probation_cycles.employee_name, public.hr_probation_cycles.employee_email, public.hr_probation_cycles.employee_code,
              public.hr_probation_cycles.department_name) is distinct from (excluded.employee_name, excluded.employee_email, excluded.employee_code, excluded.department_name);
      get diagnostics v_rows = row_count;
      v_cycles := v_cycles + v_rows;
    end if;
  end loop;

  -- 3c. Reminders for pending confirmations.
  for c in select * from public.hr_probation_cycles pc where pc.status = 'PENDING' loop
    if v_today >= c.probation_end - 7 and v_today <= c.probation_end then
      -- one week before (or, if the cycle is found later, as soon as it is found): the employee and HR, once per cycle
      v_new := private.hr_enqueue('PROBATION_REMINDER_EMPLOYEE:' || c.id, 'PROBATION_REMINDER_EMPLOYEE', c.employee_key, c.profile_id, c.id,
                c.employee_email, c.employee_name,
                jsonb_build_object('employeeName', c.employee_name, 'probationEndDate', c.probation_end, 'daysLeft', c.probation_end - v_today),
                c.probation_end - 7, private.hr_nine_am(c.probation_end - 7));
      if v_new then v_reminders := v_reminders + 1; end if;
      for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
        v_new := private.hr_enqueue('PROBATION_REMINDER_HR:' || c.id || ':' || r.email, 'PROBATION_REMINDER_HR', c.employee_key, c.profile_id, c.id,
                  r.email, r.name,
                  jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                                     'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'daysLeft', c.probation_end - v_today,
                                     'designation', private.hr_designation(c.profile_id, c.hr_record_id),
                                     'reportingManager', private.hr_reporting_manager(c.profile_id)),
                  c.probation_end - 7, private.hr_nine_am(c.probation_end - 7));
        if v_new then v_reminders := v_reminders + 1; end if;
      end loop;
    elsif v_today > c.probation_end then
      -- still not decided after the end date: HR is reminded weekly (at most 8 times); the employee is NOT confirmed
      v_n := least(7, (v_today - c.probation_end - 1) / 7);
      for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
        v_new := private.hr_enqueue('PROBATION_OVERDUE_HR:' || c.id || ':' || v_n || ':' || r.email, 'PROBATION_OVERDUE_HR', c.employee_key, c.profile_id, c.id,
                  r.email, r.name,
                  jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                                     'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'daysOverdue', v_today - c.probation_end),
                  v_today, private.hr_nine_am(v_today));
        if v_new then v_overdue := v_overdue + 1; end if;
      end loop;
    end if;
  end loop;

  insert into public.hr_automation_state (key, value, updated_at)
  values ('last_schedule', jsonb_build_object('ranAt', now(), 'day', v_today, 'birthdays', v_birthdays, 'anniversaries', v_anniversaries,
                                              'cyclesOpened', v_cycles, 'reminders', v_reminders, 'overdueReminders', v_overdue), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object('day', v_today, 'birthdays', v_birthdays, 'anniversaries', v_anniversaries, 'cyclesOpened', v_cycles,
                            'reminders', v_reminders, 'overdueReminders', v_overdue);
end $$;
revoke all on function public.hr_schedule_emails(date) from public, anon, authenticated;
grant execute on function public.hr_schedule_emails(date) to service_role;

-- ---------------------------------------------------------------------------
-- Live figures for the three automation cards (HR staff only)
-- ---------------------------------------------------------------------------
create or replace function public.hr_email_cards()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
  v_next_birthday jsonb;
  v_next_anniversary jsonb;
begin
  perform private.hr_require_staff();

  -- the next birthday / anniversary date within a year, and who has it
  select jsonb_build_object('date', x.g, 'names', (
           select jsonb_agg(y.full_name order by y.full_name) from (
             select m2.full_name from private.hr_mail_employees() m2
              where m2.is_active and m2.date_of_birth is not null
                and private.hr_occasion_date(m2.date_of_birth, extract(year from x.g)::int) = x.g limit 5) y))
    into v_next_birthday
    from (select dd.g from private.hr_mail_employees() m, generate_series(0, 366) n, lateral (select v_today + n as g) dd
           where m.is_active and m.date_of_birth is not null
             and private.hr_occasion_date(m.date_of_birth, extract(year from dd.g)::int) = dd.g
           order by dd.g limit 1) x;
  select jsonb_build_object('date', x.g, 'names', (
           select jsonb_agg(y.full_name order by y.full_name) from (
             select m2.full_name from private.hr_mail_employees() m2
              where m2.is_active and m2.joining_date is not null and extract(year from x.g) > extract(year from m2.joining_date)
                and private.hr_occasion_date(m2.joining_date, extract(year from x.g)::int) = x.g limit 5) y))
    into v_next_anniversary
    from (select dd.g from private.hr_mail_employees() m, generate_series(0, 366) n, lateral (select v_today + n as g) dd
           where m.is_active and m.joining_date is not null and extract(year from dd.g) > extract(year from m.joining_date)
             and private.hr_occasion_date(m.joining_date, extract(year from dd.g)::int) = dd.g
           order by dd.g limit 1) x;

  return jsonb_build_object(
    'today', v_today,
    'birthday', jsonb_build_object(
      'sent', (select count(*) from public.hr_email_events where kind = 'BIRTHDAY' and status = 'SENT'),
      'failed', (select count(*) from public.hr_email_events where kind = 'BIRTHDAY' and status = 'FAILED'),
      'waiting', (select count(*) from public.hr_email_events where kind = 'BIRTHDAY' and status in ('PENDING', 'SENDING', 'RETRY', 'DRY_RUN')),
      'last', (select jsonb_build_object('status', e.status, 'at', coalesce(e.sent_at, e.last_attempt_at, e.created_at), 'error', e.last_error, 'employee', e.payload ->> 'employeeName')
                 from public.hr_email_events e where e.kind = 'BIRTHDAY' order by coalesce(e.sent_at, e.last_attempt_at, e.created_at) desc limit 1),
      'next', v_next_birthday),
    'anniversary', jsonb_build_object(
      'sent', (select count(*) from public.hr_email_events where kind = 'ANNIVERSARY' and status = 'SENT'),
      'failed', (select count(*) from public.hr_email_events where kind = 'ANNIVERSARY' and status = 'FAILED'),
      'waiting', (select count(*) from public.hr_email_events where kind = 'ANNIVERSARY' and status in ('PENDING', 'SENDING', 'RETRY', 'DRY_RUN')),
      'last', (select jsonb_build_object('status', e.status, 'at', coalesce(e.sent_at, e.last_attempt_at, e.created_at), 'error', e.last_error, 'employee', e.payload ->> 'employeeName')
                 from public.hr_email_events e where e.kind = 'ANNIVERSARY' order by coalesce(e.sent_at, e.last_attempt_at, e.created_at) desc limit 1),
      'next', v_next_anniversary),
    'confirmation', jsonb_build_object(
      'sent', (select count(*) from public.hr_email_events where kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR') and status = 'SENT'),
      'failed', (select count(*) from public.hr_email_events where kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR') and status = 'FAILED'),
      'waiting', (select count(*) from public.hr_email_events where kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR') and status in ('PENDING', 'SENDING', 'RETRY', 'DRY_RUN')),
      'last', (select jsonb_build_object('status', e.status, 'at', coalesce(e.sent_at, e.last_attempt_at, e.created_at), 'error', e.last_error, 'employee', e.payload ->> 'employeeName')
                 from public.hr_email_events e where e.kind in ('PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR')
                order by coalesce(e.sent_at, e.last_attempt_at, e.created_at) desc limit 1),
      -- each pending confirmation with the day its reminder goes out (seven days before the six-month date), soonest first
      'upcoming', coalesce((select jsonb_agg(jsonb_build_object('name', u.employee_name, 'department', u.department_name, 'joiningDate', u.joining_date,
                                                              'confirmationDate', u.probation_end, 'reminderDate', u.probation_end - 7,
                                                              'reminderSent', exists (select 1 from public.hr_email_events e where e.cycle_id = u.id and e.kind = 'PROBATION_REMINDER_EMPLOYEE' and e.status = 'SENT'))
                                         order by u.probation_end)
                              from (select * from public.hr_probation_cycles pc where pc.status = 'PENDING' and pc.probation_end >= v_today
                                     order by pc.probation_end limit 10) u), '[]'::jsonb)));
end $$;
revoke all on function public.hr_email_cards() from public, anon;
grant execute on function public.hr_email_cards() to authenticated;

notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
