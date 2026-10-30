-- Narrow Accounts profile correction RPC; no new table grants or financial writes.
create or replace function public.accounts_customer_details(p_customer uuid, p_patch jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v jsonb;
  k text;
begin
  perform private.require_accounts_staff();
  select * into c from public.customers where id = p_customer for update;
  if c.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.';
  end if;
  if p_patch is not null then
    if jsonb_typeof(p_patch) <> 'object' or exists (
      select 1 from jsonb_object_keys(p_patch) x where x not in ('name','company','phone','whatsapp','email','city','address','businessCategory')) then
      raise exception 'VALIDATION_ERROR: Only customer profile fields may be edited.';
    end if;
    foreach k in array array['name','company','phone'] loop
      if nullif(btrim(p_patch->>k), '') is null then
        raise exception 'VALIDATION_ERROR: Name, business name and mobile are required.';
      end if;
    end loop;
    for k in select jsonb_object_keys(p_patch) loop
      if jsonb_typeof(p_patch->k) not in ('string','null') or length(p_patch->>k) > (case when k = 'address' then 500 when k in ('city','businessCategory') then 120 else 200 end) then
        raise exception 'VALIDATION_ERROR: Invalid profile field.';
      end if;
    end loop;
    foreach k in array array['phone','whatsapp'] loop
      if nullif(p_patch->>k,'') is not null and regexp_replace(p_patch->>k, '[^0-9]', '', 'g') !~ '^([6-9][0-9]{9}|91[6-9][0-9]{9}|0[6-9][0-9]{9})$' then
        raise exception 'VALIDATION_ERROR: Enter a valid mobile number.';
      end if;
    end loop;
    -- Reuse the established pre-login correction guard, including provisioning races.
    -- Linked authentication emails must be changed through the authentication workflow.
    if lower(coalesce(p_patch->>'email','')) is distinct from lower(coalesce(c.email,'')) then
      perform public.accounts_set_customer_email(p_customer, p_patch->>'email', 'Accounts customer details correction');
    end if;
    update public.customers set name = btrim(p_patch->>'name'), company = btrim(p_patch->>'company'),
      phone = btrim(p_patch->>'phone'), whatsapp = nullif(btrim(p_patch->>'whatsapp'),''),
      city = nullif(btrim(p_patch->>'city'),''), address = nullif(btrim(p_patch->>'address'),''),
      business_category = nullif(btrim(p_patch->>'businessCategory'),'')
      where id = p_customer;
    -- Existing customer triggers audit actor, timestamp and before/after values.
    select * into c from public.customers where id = p_customer;
  end if;
  return jsonb_build_object('name',c.name,'company',c.company,'phone',c.phone,'whatsapp',c.whatsapp,
    'email',c.email,'city',c.city,'address',c.address,'businessCategory',c.business_category,
    'hasClientLogin', exists(select 1 from public.customer_client_accounts where customer_id = p_customer));
end $$;
revoke all on function public.accounts_customer_details(uuid,jsonb) from public, anon;
grant execute on function public.accounts_customer_details(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
