-- =============================================================================
-- Wabatalk: the Support department of D Talk.
--
--   D Talk    the SALES department.
--   Wabatalk  the SUPPORT department of D Talk. Its Support is looked after by the SAME Department Head who looks after the Support of
--             Wabastore, Whatsbox and Wabastar (a shared head, see 20261123000100_department_scopes.sql).
--
-- Wabatalk is a department of its own (a row in `departments`, with its own revenue, expenses and picker card) that is LINKED to D Talk:
-- `departments.facet_of` / `facet_division` say "this department is the SUPPORT side of that one". The people, teams, customers and
-- tickets of D Talk stay where they are, because the customer a D Talk salesperson sold is the same customer D Talk's Support looks after,
-- and every access rule of the CRM is written around that one shared department. What changes is everything that is about WHICH
-- DEPARTMENT A THING BELONGS TO FOR THE PURPOSE OF A HEAD AND OF REVENUE:
--
--   * Revenue: an order earned by Support (an add-on, a renewal, a monthly plan, a Support-acquired sale, ...) is recorded in Wabatalk;
--     an order earned by Sales is recorded in D Talk. Income reports, the Accounts department income, the Super Admin dashboard and the
--     business reports all read that one recorded department, so they agree.
--   * Heads: a Department Head given Wabatalk (Super Admin > Departments & functions) works D Talk's Support side. The database turns
--     Wabatalk into "D Talk, Support" for every access rule; nothing is duplicated and nothing is moved.
--
-- Nothing else is renamed, created or moved. Safe to run again. The link is made only when a department with the slug `dtalk` exists.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A department can be the Sales or Support side of another one
-- ---------------------------------------------------------------------------
alter table public.departments
  add column if not exists facet_of uuid references public.departments (id) on delete cascade,
  add column if not exists facet_division text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'departments_facet_check' and conrelid = 'public.departments'::regclass) then
    alter table public.departments add constraint departments_facet_check
      check ((facet_of is null) = (facet_division is null) and facet_of is distinct from id and (facet_division is null or facet_division in ('SALES', 'SUPPORT')));
  end if;
end $$;
create unique index if not exists departments_facet_unique on public.departments (facet_of, facet_division) where facet_of is not null;

-- one level only: a side cannot have sides of its own, and a department that has sides cannot become one
create or replace function private.tg_departments_facet()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.facet_of is not null then
    if exists (select 1 from public.departments b where b.id = new.facet_of and b.facet_of is not null) then
      raise exception 'VALIDATION_ERROR: A department that is itself the Sales or Support side of another cannot have sides.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.departments f where f.facet_of = new.id) then
      raise exception 'VALIDATION_ERROR: This department already has a Sales or Support side of its own.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists departments_facet on public.departments;
create trigger departments_facet before insert or update of facet_of, facet_division on public.departments
  for each row execute function private.tg_departments_facet();

-- ---------------------------------------------------------------------------
-- 2. Wabatalk, linked to D Talk's Support side
-- ---------------------------------------------------------------------------
do $$
declare
  v_base uuid;
  v_f uuid;
begin
  select id into v_base from public.departments where slug = 'dtalk';
  if v_base is null then
    raise notice 'No department with the slug dtalk: Wabatalk was not created or linked.';
    return;
  end if;
  select id into v_f from public.departments where slug = 'wabatalk' or lower(name) in ('wabatalk', 'waba talk') order by (slug = 'wabatalk') desc limit 1;
  if v_f is null then
    insert into public.departments (slug, name, description, icon_name, accent_color, generates_revenue)
    values ('wabatalk', 'Wabatalk', 'Support department of D Talk', 'Headset', '#7C3AED', true)
    returning id into v_f;
  end if;
  -- an existing Wabatalk department is linked, never renamed
  update public.departments set facet_of = v_base, facet_division = 'SUPPORT' where id = v_f and facet_of is null and not exists (select 1 from public.departments x where x.facet_of = v_base and x.facet_division = 'SUPPORT');
end $$;

-- The department that carries one function of another: the Support side of D Talk is Wabatalk; the Sales side is D Talk itself.
create or replace function private.shown_department(p_base uuid, p_division text)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select f.id from public.departments f where f.facet_of = p_base and f.facet_division = p_division), p_base)
$$;
revoke all on function private.shown_department(uuid, text) from public, anon;
grant execute on function private.shown_department(uuid, text) to authenticated, service_role;

-- The department an order of `p_division` belongs to, given the department of the customer (the department of the people who look
-- after it): Support's orders belong to the Support department (Wabatalk), Sales' to the Sales department (D Talk). A department
-- without sides is unchanged, so every other department behaves exactly as before.
create or replace function private.revenue_department(p_dept uuid, p_division text)
returns uuid language sql stable security definer set search_path = '' as $$
  select case
    when p_dept is null then null
    when p_division = 'SUPPORT' then private.shown_department(p_dept, 'SUPPORT')
    when p_division = 'SALES' then coalesce((select f.facet_of from public.departments f where f.id = p_dept and f.facet_division = 'SUPPORT'), p_dept)
    else p_dept
  end
$$;
revoke all on function private.revenue_department(uuid, text) from public, anon;
grant execute on function private.revenue_department(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A Department Head given Wabatalk works D Talk's Support side
--    (grants and the header name Wabatalk; every access rule sees "D Talk, Support")
-- ---------------------------------------------------------------------------
create or replace function private.my_scopes()
returns table (department_id uuid, division text)
language sql stable security definer set search_path = '' as $$
  select distinct coalesce(d.facet_of, d.id), coalesce(d.facet_division, r.division)
    from (select p.department_id, p.head_division as division
            from public.profiles p
           where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.department_id is not null
          union
          select a.department_id, a.division
            from public.department_access a
            join public.profiles p on p.id = a.profile_id
           where a.profile_id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD') r
    join public.departments d on d.id = r.department_id
$$;
revoke all on function private.my_scopes() from public, anon;
grant execute on function private.my_scopes() to authenticated, service_role;

create or replace function private.scopes_of(p_profile uuid)
returns table (department_id uuid, division text)
language sql stable security definer set search_path = '' as $$
  select distinct coalesce(d.facet_of, d.id), coalesce(d.facet_division, r.division)
    from (select p.department_id, p.head_division as division
            from public.profiles p
           where p.id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.department_id is not null
          union
          select a.department_id, a.division
            from public.department_access a
            join public.profiles p on p.id = a.profile_id
           where a.profile_id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD') r
    join public.departments d on d.id = r.department_id
$$;
revoke all on function private.scopes_of(uuid) from public, anon;
grant execute on function private.scopes_of(uuid) to authenticated, service_role;

-- What the request header asks for, as (data department, function): a side department (Wabatalk) means "its base department, that function".
create or replace function private.requested_scope()
returns table (department_id uuid, division text, is_facet boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce(d.facet_of, d.id), coalesce(d.facet_division, upper(private.request_header('x-active-division'))), d.facet_of is not null
    from public.departments d
   where d.id::text = lower(private.request_header('x-active-department'))
$$;
revoke all on function private.requested_scope() from public, anon;
grant execute on function private.requested_scope() to authenticated, service_role;

create or replace function private.active_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.department_id from private.my_scopes() s join private.requested_scope() r on r.department_id = s.department_id
      where not r.is_facet or s.division is null or s.division = r.division limit 1),
    (select p.department_id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'))
$$;
revoke all on function private.active_department_id() from public, anon;
grant execute on function private.active_department_id() to authenticated, service_role;

create or replace function private.active_head_division()
returns text language sql stable security definer set search_path = '' as $$
  with me as (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'),
       act as (select private.active_department_id() as d),
       mine as (select s.division from private.my_scopes() s, act where s.department_id = act.d),
       req as (select coalesce((select r.division from private.requested_scope() r, act where r.department_id = act.d and r.is_facet),
                               upper(private.request_header('x-active-division'))) as d)
  select case
    when not exists (select 1 from me) then null
    when (select d from req) in (select division from mine where division is not null) then (select d from req)
    when not exists (select 1 from mine where division is null) and (select count(distinct division) from mine) = 1 then (select division from mine limit 1)
    else null
  end
$$;
revoke all on function private.active_head_division() from public, anon;
grant execute on function private.active_head_division() to authenticated, service_role;

-- What the dashboard offers: one entry per department the head can work in, Wabatalk shown as its own department.
-- `dataDepartmentId` / `dataSlug` are the department whose people and customers the entry works on (D Talk for Wabatalk).
create or replace function public.my_department_scopes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_home uuid;
  v_home_div text;
  v_home_shown uuid;
  v jsonb;
  v_act uuid := private.active_department_id();
begin
  select p.department_id, p.head_division into v_home, v_home_div from public.profiles p
   where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD';
  if v_home is null then
    return jsonb_build_object('departments', '[]'::jsonb, 'homeDepartmentId', null, 'activeDepartmentId', null, 'activeDivision', null);
  end if;
  v_home_shown := private.shown_department(v_home, v_home_div);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'slug', d.slug, 'name', d.name, 'iconName', d.icon_name, 'accentColor', d.accent_color,
           'isHome', d.id = v_home_shown,
           'dataDepartmentId', g.base, 'dataSlug', b.slug,
           'divisions', coalesce(to_jsonb(g.divs), '[]'::jsonb),
           'wholeDepartment', g.whole
         ) order by (d.id = v_home_shown) desc, d.name), '[]'::jsonb)
    into v
    from (select x.shown, min(x.base::text)::uuid as base,
                 array_agg(distinct x.division order by x.division) filter (where x.division is not null) as divs,
                 coalesce(bool_or(x.division is null), false) as whole
            from (select s.department_id as base, s.division, private.shown_department(s.department_id, s.division) as shown from private.my_scopes() s) x
           group by x.shown) g
    join public.departments d on d.id = g.shown
    join public.departments b on b.id = g.base;
  return jsonb_build_object('departments', v, 'homeDepartmentId', v_home_shown,
                            'activeDepartmentId', private.shown_department(v_act, private.active_head_division()),
                            'activeDivision', private.active_head_division());
end $$;
revoke all on function public.my_department_scopes() from public, anon;
grant execute on function public.my_department_scopes() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The Super Admin's list of (department, function) pairs knows about the sides
-- ---------------------------------------------------------------------------
create or replace function public.department_access_get(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.profiles;
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can see this.' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'profileId', t.id, 'name', t.full_name, 'role', t.role, 'homeDepartmentId', private.shown_department(t.department_id, t.head_division), 'headDivision', t.head_division,
    'grants', (select coalesce(jsonb_agg(jsonb_build_object('departmentId', a.department_id, 'division', a.division) order by a.created_at), '[]'::jsonb)
                 from public.department_access a where a.profile_id = t.id),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', d.id, 'slug', d.slug, 'name', d.name,
                      'hasSales', exists (select 1 from public.teams x where x.department_id = coalesce(d.facet_of, d.id) and x.division = 'SALES')
                                  and coalesce(d.facet_division, 'SALES') = 'SALES'
                                  and not exists (select 1 from public.departments f where f.facet_of = d.id and f.facet_division = 'SALES'),
                      'hasSupport', exists (select 1 from public.teams x where x.department_id = coalesce(d.facet_of, d.id) and x.division = 'SUPPORT')
                                    and coalesce(d.facet_division, 'SUPPORT') = 'SUPPORT'
                                    and not exists (select 1 from public.departments f where f.facet_of = d.id and f.facet_division = 'SUPPORT'),
                      'supportDepartment', (select f.name from public.departments f where f.facet_of = d.id and f.facet_division = 'SUPPORT'),
                      'salesDepartment', (select f.name from public.departments f where f.facet_of = d.id and f.facet_division = 'SALES')) order by d.name), '[]'::jsonb)
                      from public.departments d));
end $$;
revoke all on function public.department_access_get(uuid) from public, anon;
grant execute on function public.department_access_get(uuid) to authenticated;

create or replace function public.department_access_set(p_profile uuid, p_department uuid, p_division text, p_granted boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  d public.departments;
  v_side public.departments;
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can give a Department Head more departments.' using errcode = '42501';
  end if;
  if p_division is null or p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001'; end if;
  if t.role <> 'DEPARTMENT_HEAD' or t.status <> 'ACTIVE' then
    raise exception 'VALIDATION_ERROR: Only an active Department Head can work in more than one department or function.' using errcode = 'P0001';
  end if;
  select * into d from public.departments where id = p_department;
  if d.id is null then raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001'; end if;
  if coalesce(p_granted, false) then
    if d.facet_of is not null and d.facet_division <> p_division then
      raise exception 'VALIDATION_ERROR: % is the % department, so only % can be given.', d.name, initcap(d.facet_division), initcap(d.facet_division) using errcode = 'P0001';
    end if;
    select * into v_side from public.departments f where f.facet_of = d.id and f.facet_division = p_division;
    if v_side.id is not null then
      raise exception 'VALIDATION_ERROR: The % side of % is the % department. Give % instead.', initcap(p_division), d.name, v_side.name, v_side.name using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.teams x where x.department_id = coalesce(d.facet_of, d.id) and x.division::text = p_division) then
      raise exception 'VALIDATION_ERROR: % has no % team, so there is nothing for this head to manage there.', d.name, initcap(p_division) using errcode = 'P0001';
    end if;
    insert into public.department_access (profile_id, department_id, division, granted_by)
    values (t.id, d.id, p_division, auth.uid())
    on conflict do nothing;
    perform private.write_audit('DEPARTMENT_ACCESS_GRANTED', 'profile', t.id, d.id, null, jsonb_build_object('division', p_division));
  else
    delete from public.department_access where profile_id = t.id and department_id = d.id and division = p_division;
    perform private.write_audit('DEPARTMENT_ACCESS_REVOKED', 'profile', t.id, d.id, null, jsonb_build_object('division', p_division));
  end if;
  return public.department_access_get(t.id);
end $$;
revoke all on function public.department_access_set(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.department_access_set(uuid, uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A head sees the income of the department of THEIR function (Support head: Wabatalk; Sales head: D Talk)
-- ---------------------------------------------------------------------------
create or replace function private.income_scope(p_department uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_base uuid;
  v_rev uuid;
begin
  if private.is_super_admin() or private.is_accounts_staff() then
    return p_department;
  end if;
  if private.my_role() = 'DEPARTMENT_HEAD' and private.my_department_id() is not null then
    v_base := private.my_department_id();
    v_rev := private.revenue_department(v_base, private.active_head_division());
    if p_department is not null and p_department not in (v_base, v_rev) then
      raise exception 'FORBIDDEN: A Department Head can see only their own department''s income.' using errcode = '42501';
    end if;
    return v_rev;
  end if;
  raise exception 'FORBIDDEN: Only the Super Admin, Accounts and Department Heads can see department income.' using errcode = '42501';
end $$;
revoke all on function private.income_scope(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The registration page offers real departments only (not a Support side such as Wabatalk, which has no teams of its own)
-- ---------------------------------------------------------------------------
create or replace function public.list_registration_options()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'slug', d.slug, 'name', d.name,
           'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'division', t.division)
                                               order by t.division, t.name)
                              from public.teams t where t.department_id = d.id), '[]'::jsonb))
         order by d.name), '[]'::jsonb)
  from public.departments d
  where not d.is_locked and d.facet_of is null
$$;
revoke all on function public.list_registration_options() from public;
grant execute on function public.list_registration_options() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Revenue: each order belongs to the department of the division that earns it
-- ---------------------------------------------------------------------------

-- from 20261114000100_revenue_attribution.sql: an order is recorded in the department of the division that earns it
create or replace function private.ensure_attribution(p_key text, p_customer uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  c public.customers;
begin
  if p_customer is null or exists (select 1 from public.revenue_attributions where order_key = p_key) then
    return;
  end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then return; end if;
  select * into r from private.attribution_rule(p_customer, p_kind);
  insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source)
  values (p_key, p_customer, r.o_division, private.revenue_department(c.department_id, r.o_division), r.o_source, c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''))
  on conflict (order_key) do nothing;
end $$;
revoke all on function private.ensure_attribution(text, uuid, text) from public, anon, authenticated;

-- from 20261114000100_revenue_attribution.sql: the department follows the division when the rule moves a Client Dashboard purchase
create or replace function private.tg_attr_client_addon()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if new.addon_request_id is null or new.addon_request_id is not distinct from old.addon_request_id then
    return null;
  end if;
  select * into r from private.attribution_rule(new.customer_id, 'CLIENT_PURCHASE');
  update public.revenue_attributions
     set division = r.o_division, department_id = private.revenue_department(department_id, r.o_division), source = 'CLIENT_DASHBOARD', updated_at = now()
   where order_key = 'ADDON:' || new.addon_request_id::text and source = 'SUPPORT_ADDON'
     and not exists (select 1 from public.addon_payments p where p.request_id = new.addon_request_id)
     and not exists (select 1 from public.generated_invoices g where g.addon_request_id = new.addon_request_id and exists
                       (select 1 from public.invoice_payments ip where ip.invoice_id = g.invoice_id));
  return null;
end $$;
revoke all on function private.tg_attr_client_addon() from public, anon, authenticated;

-- from 20261114000100_revenue_attribution.sql: the department of a payment / order follows the division that earns it
create or replace function private.verified_income_attributed()
returns table (id uuid, customer_id uuid, amount numeric, paid_at timestamptz, payment_type text, method text, reference text,
               verified_by uuid, recorded_at timestamptz, department_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id, p.customer_id, p.amount, p.paid_at, p.payment_type, p.method, p.reference, p.verified_by, p.recorded_at,
         coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES'))
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.revenue_attributions a on a.order_key = 'SALE:' || p.customer_id::text
   where p.status = 'VERIFIED'
  union all
  select ap.id, ap.customer_id, ap.amount, ap.paid_at, 'ADDON', ap.method, ap.reference, ap.verified_by, ap.recorded_at,
         coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT'))
    from public.addon_payments ap
    join public.customers c on c.id = ap.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || ap.request_id::text
   where ap.status = 'VERIFIED'
  union all
  select ip.id, ip.customer_id, ip.amount, (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz, ip.payment_type, ip.method, ip.reference,
         ip.recorded_by, ip.recorded_at, coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES'))
    from public.invoice_payments ip
    join public.customers c on c.id = ip.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || ip.invoice_id::text
   where ip.status = 'VERIFIED'
$$;
revoke all on function private.verified_income_attributed() from public, anon, authenticated;

create or replace function private.business_ledger()
returns table (tx_key text, source text, source_id uuid, customer_id uuid, department_id uuid, division text, tx_type text,
               amount numeric, status text, occurred_at timestamptz, employee_id uuid, service text, reference text, method text,
               order_key text)
language sql stable security definer set search_path = '' as $$
  -- initial sale: the payments of the agreed services
  select 'CP:' || p.id::text, 'CUSTOMER_PAYMENT', p.id, p.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES')), coalesce(a.division, 'SALES'), 'INITIAL_SALE'::text, p.amount,
         case p.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' when 'REVERSED' then 'REFUNDED' else 'REJECTED' end,
         p.paid_at,
         coalesce(pr.requested_by, case when p.source = 'SALES' then p.recorded_by end, fr.requested_by),
         null::text, p.reference, p.method, 'SALE:' || p.customer_id::text
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.revenue_attributions a on a.order_key = 'SALE:' || p.customer_id::text
    left join public.payment_requests pr on pr.id = p.request_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = p.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- add-on purchases
  select 'AP:' || ap.id::text, 'ADDON_PAYMENT', ap.id, ap.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT')), coalesce(a.division, 'SUPPORT'), 'ADDON', ap.amount,
         case ap.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' else 'REJECTED' end,
         ap.paid_at, coalesce(r.submitted_by, r.created_by, r.consultant_id),
         (select string_agg(i.name, ', ' order by i.sort_order) from public.addon_request_items i where i.request_id = r.id),
         ap.reference, ap.method, 'ADDON:' || r.id::text
    from public.addon_payments ap
    join public.addon_requests r on r.id = ap.request_id
    join public.customers c on c.id = ap.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || r.id::text
  union all
  -- payments recorded on the invoice itself
  select 'IP:' || ip.id::text, 'INVOICE_PAYMENT', ip.id, ip.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, (case when g.purpose = 'SERVICES' then 'SALES' else 'SUPPORT' end))),
         case when g.purpose = 'SERVICES' then coalesce(a.division, 'SALES') when g.purpose = 'ADDON' or t.kind in ('ADDON', 'RENEWAL') then coalesce(a.division, 'SUPPORT') end,
         case when g.purpose = 'SERVICES' then 'INITIAL_SALE' when g.purpose = 'ADDON' or t.kind = 'ADDON' then 'ADDON'
              when t.kind = 'RENEWAL' then 'RENEWAL' else 'UNCLASSIFIED' end,
         ip.amount, case ip.status when 'VERIFIED' then 'COLLECTED' else 'REFUNDED' end,
         (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz,
         case when g.purpose = 'SERVICES' then fr.requested_by when g.purpose = 'ADDITIONAL' then t.responsible_id end,
         (select s.name from public.crm_services s where s.code = t.service_code), ip.reference, ip.method, 'INV:' || ip.invoice_id::text
    from public.invoice_payments ip
    join public.generated_invoices g on g.invoice_id = ip.invoice_id
    join public.customers c on c.id = ip.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || ip.invoice_id::text
    left join public.invoice_business_tags t on t.invoice_id = ip.invoice_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = ip.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- a monthly plan Accounts activated as paid
  select 'PL:' || cp.id::text, 'PLAN_ACTIVATION', cp.id, cp.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT')), coalesce(a.division, 'SUPPORT'), 'SUBSCRIPTION', cp.price_at_start,
         'COLLECTED', cp.started_at::timestamp at time zone 'Asia/Kolkata', null::uuid,
         (select p.name from public.monthly_plans p where p.id = cp.plan_id), null::text, null::text, 'PLAN:' || cp.id::text
    from public.customer_plans cp
    join public.customers c on c.id = cp.customer_id
    left join public.revenue_attributions a on a.order_key = 'PLAN:' || cp.id::text
   where cp.payment_status = 'PAID' and cp.price_at_start > 0
$$;
revoke all on function private.business_ledger() from public, anon, authenticated;

create or replace function private.business_orders()
returns table (order_key text, division text, order_type text, customer_id uuid, department_id uuid, employee_id uuid,
               billed numeric, billed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- the services agreed with the customer
  select 'SALE:' || c.id::text, coalesce(a.division, 'SALES'), 'INITIAL_SALE'::text, c.id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES')), fr.requested_by, c.deal_amount,
         coalesce(fr.resolved_at, fr.requested_at, (select min(p.recorded_at) from public.customer_payments p where p.customer_id = c.id), c.created_at)
    from public.customers c
    left join public.revenue_attributions a on a.order_key = 'SALE:' || c.id::text
    left join lateral (select x.requested_by, x.resolved_at, x.requested_at from public.payment_requests x
                        where x.customer_id = c.id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where coalesce(c.deal_amount, 0) > 0
     and (fr.requested_by is not null or exists (select 1 from public.payment_requests x where x.customer_id = c.id and x.status <> 'RETURNED')
          or exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status <> 'REJECTED'))
  union all
  -- a services invoice whose payments are recorded on the invoice (the customer has no agreed amount)
  select 'INV:' || g.invoice_id::text, coalesce(a.division, 'SALES'), 'INITIAL_SALE', g.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES')), fr.requested_by, g.total_amount,
         g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.customers c on c.id = g.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || g.invoice_id::text
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = g.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where g.purpose = 'SERVICES' and g.payment_ledger = 'INVOICE'
  union all
  -- approved add-ons that were invoiced
  select 'ADDON:' || r.id::text, coalesce(a.division, 'SUPPORT'), 'ADDON', r.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT')), coalesce(r.submitted_by, r.created_by, r.consultant_id), r.total,
         coalesce((select g.invoice_date::timestamp at time zone 'Asia/Kolkata' from public.generated_invoices g where g.addon_request_id = r.id limit 1),
                  r.decided_at, r.submitted_at, r.created_at)
    from public.addon_requests r
    join public.customers c on c.id = r.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || r.id::text
   where r.status in ('INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') and r.total > 0
  union all
  -- additional invoices Accounts tagged as renewal / add-on
  select 'INV:' || g.invoice_id::text, coalesce(a.division, 'SUPPORT'), case t.kind when 'RENEWAL' then 'RENEWAL' else 'ADDON' end, g.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT')),
         t.responsible_id, g.total_amount, g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.invoice_business_tags t on t.invoice_id = g.invoice_id and t.kind in ('RENEWAL', 'ADDON')
    join public.customers c on c.id = g.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || g.invoice_id::text
   where g.purpose = 'ADDITIONAL'
$$;
revoke all on function private.business_orders() from public, anon, authenticated;

-- from 20261114000100_revenue_attribution.sql: a corrected order lands in the department of the division that earns it
create or replace function public.set_order_attribution(p_order_key text, p_division text, p_department uuid default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_customer uuid;
  v_dept uuid;
  old public.revenue_attributions;
  c public.customers;
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can change attribution.' using errcode = '42501';
  end if;
  if p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Say why the attribution is being changed.' using errcode = 'P0001';
  end if;
  select x.customer_id into v_customer from (select order_key, customer_id from private.business_orders() union all select order_key, customer_id from private.business_ledger()) x
   where x.order_key = p_order_key limit 1;
  if v_customer is null then
    raise exception 'NOT_FOUND: Order not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  select * into old from public.revenue_attributions where order_key = p_order_key;
  v_dept := private.revenue_department(coalesce(p_department, old.department_id, c.department_id), p_division);
  if not exists (select 1 from public.departments where id = v_dept and generates_revenue) then
    raise exception 'VALIDATION_ERROR: Choose a department that earns revenue.' using errcode = 'P0001';
  end if;
  insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source, needs_review, reason, updated_by)
  values (p_order_key, v_customer, p_division, v_dept, 'MANUAL', c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''), false, v_reason, auth.uid())
  on conflict (order_key) do update
     set division = excluded.division, department_id = excluded.department_id, source = 'MANUAL', needs_review = false, review_note = null,
         reason = excluded.reason, updated_at = now(), updated_by = excluded.updated_by;
  perform private.write_audit('ORDER_ATTRIBUTION_CHANGED', 'customer', v_customer, c.department_id, c.team_id,
    jsonb_build_object('order', p_order_key, 'from_division', old.division, 'to_division', p_division, 'from_department', old.department_id,
                       'to_department', v_dept, 'from_source', old.source, 'reason', v_reason));
  return jsonb_build_object('orderKey', p_order_key, 'division', p_division, 'departmentId', v_dept, 'source', 'MANUAL');
end $$;
revoke all on function public.set_order_attribution(text, text, uuid, text) from public, anon;
grant execute on function public.set_order_attribution(text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Orders that were recorded before Wabatalk existed: Support's belong to Wabatalk now (Sales' stay with D Talk).
--    Only orders of a department that has a Support / Sales side are touched, once; a second run finds nothing to change.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  update public.revenue_attributions a
     set department_id = private.revenue_department(a.department_id, a.division), updated_at = now()
   where a.department_id is not null
     and a.department_id is distinct from private.revenue_department(a.department_id, a.division);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    raise notice 'Moved the recorded department of % order(s) to the department of the division that earns them.', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
