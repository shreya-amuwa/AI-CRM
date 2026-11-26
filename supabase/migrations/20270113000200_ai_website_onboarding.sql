-- =============================================================================
-- AI Website client onboarding details on a lead.
--
-- When a lead asks for the AI Website service (crm_services code 'AI_WEBSITE'), the sales person records what the AI Website team needs to
-- start (the same questions as the WebTara order form): the client's name, mobile, e-mail (required), business name, whether the business is on Google
-- Maps (and its link), the city and the type of business.
--
--   * public.ai_website_onboarding: ONE row per customer (primary key customer_id), so editing never makes a second record and the details
--     stay with the lead through every stage, owner change and hand-over (the row belongs to the customer, not to a person or a stage).
--   * Read: whoever can read the customer reads its details. The policy asks the customers table AS THE CALLER, so the existing customer rules
--     decide (Sales owner / Team Lead / Department Head / Super Admin, the onboarding team, Technical Consultants, hand-over and delivery
--     departments); nothing new is opened.
--   * Write: only through public.ai_website_onboarding_save(customer, details), which validates every field, checks the caller may work on the
--     customer (the lead's own Sales side, or the onboarding team after the hand-over), upserts the one row and writes the audit log.
--
-- Additive and safe to run twice. Nothing existing is changed; until it runs, the API answers that the details are not available yet.
-- =============================================================================

create table if not exists public.ai_website_onboarding (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  client_name text not null check (char_length(client_name) between 1 and 160),
  mobile text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  email text check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  business_name text not null check (char_length(business_name) between 1 and 200),
  on_google_maps boolean not null,
  google_maps_link text check (google_maps_link is null or (char_length(google_maps_link) <= 500 and google_maps_link ~* '^https?://')),
  city text not null check (char_length(city) between 1 and 80),
  business_type text not null check (char_length(business_type) between 1 and 120),
  business_type_other text check (business_type_other is null or char_length(business_type_other) between 1 and 120),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a Google Maps link only for a business that is on Google Maps; "Other" always says which type
  constraint ai_website_onboarding_link_needs_maps check (on_google_maps or google_maps_link is null),
  constraint ai_website_onboarding_other_type check ((business_type = 'Other') = (business_type_other is not null))
);

drop trigger if exists ai_website_onboarding_set_updated_at on public.ai_website_onboarding;
create trigger ai_website_onboarding_set_updated_at before update on public.ai_website_onboarding
  for each row execute function public.tg_set_updated_at();

alter table public.ai_website_onboarding enable row level security;
revoke all on public.ai_website_onboarding from public, anon, authenticated;
grant select on public.ai_website_onboarding to authenticated;
drop policy if exists ai_website_onboarding_select on public.ai_website_onboarding;
-- the customers sub-query runs with the caller's own row level security: the details are visible exactly where the customer is
create policy ai_website_onboarding_select on public.ai_website_onboarding for select to authenticated
  using (customer_id in (select c.id from public.customers c));

-- The types of business offered (the CRM's business categories; "Other" needs the type typed in).
create or replace function private.ai_website_business_types()
returns text[] language sql immutable set search_path = '' as $$
  select array['Jewellery / Gold', 'Retail', 'Restaurant / Food', 'Healthcare', 'Education', 'Real Estate',
               'Beauty / Salon', 'Fitness', 'Manufacturing', 'Services', 'Other']
$$;

create or replace function public.ai_website_onboarding_save(p_customer uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(p ->> 'clientName', '')), '');
  v_mobile text := regexp_replace(coalesce(p ->> 'mobile', ''), '[\s\-()]', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p ->> 'email', ''))), '');
  v_business text := nullif(btrim(coalesce(p ->> 'businessName', '')), '');
  v_maps_raw text := p ->> 'onGoogleMaps';
  v_maps boolean;
  v_link text := nullif(btrim(coalesce(p ->> 'googleMapsLink', '')), '');
  v_city text := nullif(btrim(coalesce(p ->> 'city', '')), '');
  v_type text := nullif(btrim(coalesce(p ->> 'businessType', '')), '');
  v_other text := nullif(btrim(coalesce(p ->> 'businessTypeOther', '')), '');
  v_old public.ai_website_onboarding;
  v_row public.ai_website_onboarding;
  v_customer public.customers;
begin
  select * into v_customer from public.customers where id = p_customer;
  if v_customer.id is null or not private.can_view_customer(p_customer) and not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001';
  end if;
  if not (private.can_access_customer(p_customer) or private.may_update_support_customer(p_customer)) then
    raise exception 'FORBIDDEN: You can see this lead but not change its AI Website details.' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'VALIDATION_ERROR: Enter the AI Website details.' using errcode = 'P0001';
  end if;

  -- an Indian mobile number: 10 digits (a leading +91, 91 or 0 is accepted and removed)
  v_mobile := regexp_replace(v_mobile, '^(\+91|91|0)(?=[0-9]{10}$)', '');
  if v_name is null then raise exception 'VALIDATION_ERROR: Enter the client name.' using errcode = 'P0001'; end if;
  if char_length(v_name) > 160 then raise exception 'VALIDATION_ERROR: The client name is too long (at most 160 characters).' using errcode = 'P0001'; end if;
  if v_mobile !~ '^[6-9][0-9]{9}$' then raise exception 'VALIDATION_ERROR: Enter a valid 10-digit mobile number.' using errcode = 'P0001'; end if;
  if v_email is null then raise exception 'VALIDATION_ERROR: Enter the email address.' using errcode = 'P0001'; end if;
  if char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: Enter a valid email address.' using errcode = 'P0001';
  end if;
  if v_business is null then raise exception 'VALIDATION_ERROR: Enter the business name.' using errcode = 'P0001'; end if;
  if char_length(v_business) > 200 then raise exception 'VALIDATION_ERROR: The business name is too long (at most 200 characters).' using errcode = 'P0001'; end if;
  if v_maps_raw is null or v_maps_raw not in ('true', 'false') then
    raise exception 'VALIDATION_ERROR: Choose whether the business is on Google Maps.' using errcode = 'P0001';
  end if;
  v_maps := v_maps_raw::boolean;
  if not v_maps then
    v_link := null;   -- a link belongs to a business that is on Google Maps
  elsif v_link is not null and (char_length(v_link) > 500 or v_link !~* '^https?://[^\s]+$') then
    raise exception 'VALIDATION_ERROR: Enter the Google Maps link as a web address (https://...).' using errcode = 'P0001';
  end if;
  if v_city is null then raise exception 'VALIDATION_ERROR: Enter the city.' using errcode = 'P0001'; end if;
  if char_length(v_city) > 80 then raise exception 'VALIDATION_ERROR: The city is too long (at most 80 characters).' using errcode = 'P0001'; end if;
  if v_type is null or not (v_type = any (private.ai_website_business_types())) then
    raise exception 'VALIDATION_ERROR: Choose the type of business.' using errcode = 'P0001';
  end if;
  if v_type = 'Other' then
    if v_other is null then raise exception 'VALIDATION_ERROR: Type the type of business.' using errcode = 'P0001'; end if;
    if char_length(v_other) > 120 then raise exception 'VALIDATION_ERROR: The type of business is too long (at most 120 characters).' using errcode = 'P0001'; end if;
  else
    v_other := null;
  end if;

  select * into v_old from public.ai_website_onboarding where customer_id = p_customer for update;
  insert into public.ai_website_onboarding as a (customer_id, client_name, mobile, email, business_name, on_google_maps, google_maps_link, city,
                                                 business_type, business_type_other, created_by, updated_by)
  values (p_customer, v_name, v_mobile, v_email, v_business, v_maps, v_link, v_city, v_type, v_other, private.my_id(), private.my_id())
  on conflict (customer_id) do update
     set client_name = excluded.client_name, mobile = excluded.mobile, email = excluded.email, business_name = excluded.business_name,
         on_google_maps = excluded.on_google_maps, google_maps_link = excluded.google_maps_link, city = excluded.city,
         business_type = excluded.business_type, business_type_other = excluded.business_type_other, updated_by = excluded.updated_by
  returning * into v_row;

  -- which fields changed (not their values: they are personal data)
  perform private.write_audit(case when v_old.customer_id is null then 'AI_WEBSITE_ONBOARDING_ADDED' else 'AI_WEBSITE_ONBOARDING_UPDATED' end,
    'customer', p_customer, v_customer.department_id, v_customer.team_id,
    jsonb_build_object('changed', (
      select coalesce(jsonb_agg(k), '[]'::jsonb) from (values
        ('clientName', v_old.client_name is distinct from v_row.client_name), ('mobile', v_old.mobile is distinct from v_row.mobile),
        ('email', v_old.email is distinct from v_row.email), ('businessName', v_old.business_name is distinct from v_row.business_name),
        ('onGoogleMaps', v_old.on_google_maps is distinct from v_row.on_google_maps), ('googleMapsLink', v_old.google_maps_link is distinct from v_row.google_maps_link),
        ('city', v_old.city is distinct from v_row.city), ('businessType', v_old.business_type is distinct from v_row.business_type
                                                            or v_old.business_type_other is distinct from v_row.business_type_other)) as x(k, changed)
       where changed)));
  return private.ai_website_onboarding_json(v_row);
end $$;

create or replace function private.ai_website_onboarding_json(a public.ai_website_onboarding)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'customerId', a.customer_id, 'clientName', a.client_name, 'mobile', a.mobile, 'email', a.email, 'businessName', a.business_name,
    'onGoogleMaps', a.on_google_maps, 'googleMapsLink', a.google_maps_link, 'city', a.city, 'businessType', a.business_type,
    'businessTypeOther', a.business_type_other, 'createdAt', a.created_at, 'updatedAt', a.updated_at,
    'updatedBy', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = a.updated_by))
$$;

revoke all on function private.ai_website_business_types() from public, anon;
grant execute on function private.ai_website_business_types() to authenticated;
revoke all on function private.ai_website_onboarding_json(public.ai_website_onboarding) from public, anon, authenticated;
revoke all on function public.ai_website_onboarding_save(uuid, jsonb) from public, anon;
grant execute on function public.ai_website_onboarding_save(uuid, jsonb) to authenticated;
