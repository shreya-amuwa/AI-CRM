-- =============================================================================
-- Dashboard round 2: leads -> onboarding hand-over of details, Business Name and Address split, the consultant's
-- corrections, Department Head customer view, client tickets routing and client notices.
--
-- 1. A lead can carry a business address. The Sales onboarding checklist now has separate
--    "Business Name" and "Business Address" cards (the old combined card is switched off).
-- 2. What Sales typed on the lead (customer name, mobile, business name, address) is copied into the
--    onboarding checklist automatically, and kept in step when the lead is edited. Editing one of those
--    cards in onboarding updates the customer record too, so there is one source of truth and nobody types it twice.
-- Additive / re-runnable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Address on the lead; Business Name and Business Address as separate onboarding cards
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists address text check (length(address) <= 500);
grant insert (address), update (address) on public.customers to authenticated;

create or replace function public.create_lead(p_fields jsonb, p_services text[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(array_length(p_services, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Select at least one service.' using errcode = 'P0001';
  end if;
  insert into public.customers (
    owner_id, lifecycle_stage, lead_status, name, company, phone, whatsapp, email, city, address,
    business_category, lead_source, next_follow_up_at, expected_budget, notes)
  values (
    (p_fields ->> 'ownerId')::uuid, 'LEAD', coalesce(p_fields ->> 'leadStatus', 'NEW'),
    p_fields ->> 'name', p_fields ->> 'company', p_fields ->> 'phone', p_fields ->> 'whatsapp',
    p_fields ->> 'email', p_fields ->> 'city', nullif(btrim(p_fields ->> 'address'), ''), p_fields ->> 'businessCategory', p_fields ->> 'leadSource',
    (p_fields ->> 'nextFollowUpAt')::timestamptz, (p_fields ->> 'expectedBudget')::numeric, p_fields ->> 'notes')
  returning id into v_id;
  perform private.set_customer_services(v_id, p_services);
  insert into public.customer_activities (customer_id, type, note)
  values (v_id, 'LEAD_CREATED', 'Lead added' || coalesce(' from ' || nullif(p_fields ->> 'leadSource', ''), ''));
  perform private.sync_lead_note(v_id, p_fields ->> 'notes');
  return v_id;
end $$;

create or replace function public.update_lead(p_id uuid, p_fields jsonb, p_services text[] default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_old public.customers;
  v_new public.customers;
begin
  select * into v_old from public.customers where id = p_id;
  if v_old.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_old.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This lead is with Accounts for payment confirmation.' using errcode = 'P0001';
  end if;
  if p_services is not null and coalesce(array_length(p_services, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Select at least one service.' using errcode = 'P0001';
  end if;

  update public.customers set
    name = case when p_fields ? 'name' then p_fields ->> 'name' else name end,
    company = case when p_fields ? 'company' then p_fields ->> 'company' else company end,
    phone = case when p_fields ? 'phone' then p_fields ->> 'phone' else phone end,
    whatsapp = case when p_fields ? 'whatsapp' then p_fields ->> 'whatsapp' else whatsapp end,
    email = case when p_fields ? 'email' then p_fields ->> 'email' else email end,
    city = case when p_fields ? 'city' then p_fields ->> 'city' else city end,
    address = case when p_fields ? 'address' then nullif(btrim(p_fields ->> 'address'), '') else address end,
    business_category = case when p_fields ? 'businessCategory' then p_fields ->> 'businessCategory' else business_category end,
    lead_source = case when p_fields ? 'leadSource' then p_fields ->> 'leadSource' else lead_source end,
    lead_status = case when p_fields ? 'leadStatus' then p_fields ->> 'leadStatus' else lead_status end,
    next_follow_up_at = case when p_fields ? 'nextFollowUpAt' then (p_fields ->> 'nextFollowUpAt')::timestamptz else next_follow_up_at end,
    expected_budget = case when p_fields ? 'expectedBudget' then (p_fields ->> 'expectedBudget')::numeric else expected_budget end,
    notes = case when p_fields ? 'notes' then p_fields ->> 'notes' else notes end
  where id = p_id
  returning * into v_new;
  if v_new.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;

  perform private.set_customer_services(p_id, p_services);
  if p_fields ? 'notes' then
    perform private.sync_lead_note(p_id, p_fields ->> 'notes');
  end if;
  if v_new.lead_status is distinct from v_old.lead_status then
    insert into public.customer_activities (customer_id, type, note)
    values (p_id, 'STATUS_' || v_new.lead_status, coalesce(nullif(p_fields ->> 'activityNote', ''),
            'Status changed to ' || initcap(replace(v_new.lead_status, '_', ' '))));
  end if;
end $$;

insert into public.onboarding_items (code, section, label, hint, kind, options, always_required, sort_order) values
  ('BUSINESS_NAME', 'BUSINESS_BASICS', 'Business Name', 'The registered business name', 'DETAILS', null, true, 10),
  ('BUSINESS_ADDRESS', 'BUSINESS_BASICS', 'Business Address', 'The full business address', 'DETAILS', null, true, 15)
on conflict (code) do update set label = excluded.label, hint = excluded.hint, kind = excluded.kind,
  always_required = excluded.always_required, sort_order = excluded.sort_order, is_active = true;
update public.onboarding_items set is_active = false where code = 'BUSINESS_NAME_ADDRESS';

-- Customers who already saved the old combined card keep their progress: the saved text moves to both new cards
-- (the name from the customer record when there is one), with the same review status.
insert into public.customer_onboarding_entries (customer_id, item_code, value, status, saved_by, saved_at, reviewed_by, reviewed_at, review_note)
select e.customer_id, n.code, n.value, e.status, e.saved_by, e.saved_at, e.reviewed_by, e.reviewed_at, e.review_note
  from public.customer_onboarding_entries e
  join public.customers c on c.id = e.customer_id
  cross join lateral (values ('BUSINESS_NAME', coalesce(nullif(btrim(c.company), ''), e.value)), ('BUSINESS_ADDRESS', e.value)) n(code, value)
 where e.item_code = 'BUSINESS_NAME_ADDRESS' and e.status in ('SAVED', 'VERIFIED') and n.value is not null
on conflict (customer_id, item_code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. One source of truth: the lead record fills (and keeps filling) these onboarding cards
-- ---------------------------------------------------------------------------
create or replace function private.sync_lead_to_onboarding(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_changed integer;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or not exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer) then
    return;
  end if;
  with up as (
    insert into public.customer_onboarding_entries as e (customer_id, item_code, value, status, saved_by, saved_at)
    select p_customer, v.code, v.val, 'SAVED', coalesce((select private.my_id()), c.owner_id), now()
      from (values ('CUSTOMER_NAME', nullif(btrim(c.name), '')),
                   ('CUSTOMER_MOBILE', nullif(btrim(c.phone), '')),
                   ('BUSINESS_NAME', nullif(btrim(c.company), '')),
                   ('BUSINESS_ADDRESS', nullif(btrim(c.address), ''))) v(code, val)
     where v.val is not null
    on conflict (customer_id, item_code) do update
      set value = excluded.value, status = 'SAVED', saved_by = excluded.saved_by, saved_at = now(),
          reviewed_by = null, reviewed_at = null, review_note = null
      where e.value is distinct from excluded.value
    returning 1)
  select count(*) into v_changed from up;
  if v_changed > 0 then
    perform private.refresh_onboarding_progress(p_customer);
  end if;
end $$;
revoke all on function private.sync_lead_to_onboarding(uuid) from public, anon, authenticated;

create or replace function private.trg_customer_details_to_onboarding()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'customer_onboarding' then
    perform private.sync_lead_to_onboarding(new.customer_id);
  elsif new.name is distinct from old.name or new.phone is distinct from old.phone
     or new.company is distinct from old.company or new.address is distinct from old.address then
    perform private.sync_lead_to_onboarding(new.id);
  end if;
  return new;
end $$;
revoke all on function private.trg_customer_details_to_onboarding() from public, anon, authenticated;

drop trigger if exists customers_details_to_onboarding on public.customers;
create trigger customers_details_to_onboarding after update of name, phone, company, address on public.customers
  for each row execute function private.trg_customer_details_to_onboarding();
drop trigger if exists onboarding_starts_with_lead_details on public.customer_onboarding;
create trigger onboarding_starts_with_lead_details after insert on public.customer_onboarding
  for each row execute function private.trg_customer_details_to_onboarding();

-- Editing one of these four cards in onboarding updates the customer record too (same value everywhere).
create or replace function public.save_onboarding_entry(p_customer uuid, p_item text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_collect_customer(p_customer, p_item);
  i public.onboarding_items;
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if p_item = 'INVOICE' then
    raise exception 'FORBIDDEN: Invoices are issued by the Accounts department.' using errcode = '42501';
  end if;
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Details are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into i from (select * from private.customer_items(p_customer)
                         union all select * from private.customer_optional_items(p_customer)
                         union all select * from private.customer_addon_items(p_customer)) x where x.code = p_item limit 1;
  if i.code is null then
    raise exception 'VALIDATION_ERROR: This item is not part of this customer''s onboarding.' using errcode = 'P0001';
  end if;
  if i.kind = 'FILE' then
    raise exception 'VALIDATION_ERROR: Upload a file for this item.' using errcode = 'P0001';
  end if;
  if v_value is null then
    raise exception 'VALIDATION_ERROR: Enter a value.' using errcode = 'P0001';
  end if;
  if length(v_value) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep it under 4000 characters.' using errcode = 'P0001';
  end if;
  if i.kind = 'YES_NO' and v_value not in ('YES', 'NO') then
    raise exception 'VALIDATION_ERROR: Answer yes or no.' using errcode = 'P0001';
  end if;
  if i.kind = 'AMOUNT' and v_value !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
    raise exception 'VALIDATION_ERROR: Enter an amount in rupees.' using errcode = 'P0001';
  end if;
  if i.kind = 'CHOICE' and not (v_value = any (i.options)) then
    raise exception 'VALIDATION_ERROR: Choose one of the options.' using errcode = 'P0001';
  end if;
  if p_item = 'CUSTOMER_NAME' and length(v_value) > 200 then
    raise exception 'VALIDATION_ERROR: Keep the name under 200 characters.' using errcode = 'P0001';
  end if;
  if p_item = 'BUSINESS_ADDRESS' and length(v_value) > 500 then
    raise exception 'VALIDATION_ERROR: Keep the address under 500 characters.' using errcode = 'P0001';
  end if;

  -- the customer record follows the card
  if p_item = 'CUSTOMER_NAME' then
    update public.customers set name = v_value where id = p_customer and name is distinct from v_value;
  elsif p_item = 'CUSTOMER_MOBILE' then
    update public.customers set phone = v_value where id = p_customer and phone is distinct from v_value;
  elsif p_item = 'BUSINESS_NAME' then
    update public.customers set company = v_value where id = p_customer and company is distinct from v_value;
  elsif p_item = 'BUSINESS_ADDRESS' then
    update public.customers set address = v_value where id = p_customer and address is distinct from v_value;
  end if;

  insert into public.customer_onboarding_entries as e (customer_id, item_code, value, status, saved_by, saved_at)
  values (p_customer, p_item, v_value, 'SAVED', (select private.my_id()), now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, status = 'SAVED', saved_by = excluded.saved_by, saved_at = now(),
        reviewed_by = null, reviewed_at = null,
        review_note = case when e.status = 'REJECTED' then e.review_note end;

  perform private.log_customer_activity(p_customer, 'ONBOARDING_ITEM_SAVED', format('%s saved', i.label));
  perform private.write_audit('ONBOARDING_ITEM_SAVED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('item', p_item));
  perform private.refresh_onboarding_progress(p_customer);
end $$;
revoke all on function public.save_onboarding_entry(uuid, text, text) from public, anon;
grant execute on function public.save_onboarding_entry(uuid, text, text) to authenticated;

-- Fill the cards for everyone already in onboarding (never overwrites something already saved).
do $$
declare
  r record;
begin
  for r in select o.customer_id from public.customer_onboarding o loop
    insert into public.customer_onboarding_entries (customer_id, item_code, value, status, saved_by, saved_at)
    select r.customer_id, v.code, v.val, 'SAVED', c.owner_id, now()
      from public.customers c
      cross join lateral (values ('CUSTOMER_NAME', nullif(btrim(c.name), '')), ('CUSTOMER_MOBILE', nullif(btrim(c.phone), '')),
                                 ('BUSINESS_NAME', nullif(btrim(c.company), ''))) v(code, val)
     where c.id = r.customer_id and v.val is not null
    on conflict (customer_id, item_code) do nothing;
    perform private.refresh_onboarding_progress(r.customer_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The Technical Consultant can correct mistakes in what Sales sent
--    (replace a document, fix a detail) while the customer is still in onboarding with support (before the hand-over).
--    Everything still goes through the same save / upload functions, so the usual checks (file type, size,
--    content, who saved it, activity log) apply; Invoices stay with Accounts. Deleting stays with Sales:
--    the consultant replaces a file instead.
-- ---------------------------------------------------------------------------
create or replace function private.can_correct_onboarding_item(p_customer uuid, p_item text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_item <> 'INVOICE'
     and private.can_review_onboarding(p_customer)
     and exists (select 1 from public.customers c where c.id = p_customer and c.lifecycle_stage = 'ONBOARDING'
                  and c.department_id = private.my_support_department_id())
     and (exists (select 1 from private.customer_items(p_customer) i where i.code = p_item)
          or exists (select 1 from private.customer_optional_items(p_customer) i where i.code = p_item))
$$;
revoke all on function private.can_correct_onboarding_item(uuid, text) from public, anon;
grant execute on function private.can_correct_onboarding_item(uuid, text) to authenticated;

-- "May collect": the add-on rule as before, or the consultant correcting a Sales item. The save / upload / complete
-- functions already ask this one question, so they all follow.
create or replace function private.can_collect_addon_item(p_customer uuid, p_item text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (private.can_manage_addons(p_customer)
          and exists (select 1 from public.addon_requests r where r.customer_id = p_customer and r.status in ('PAYMENT_CONFIRMED', 'IN_PROGRESS'))
          and exists (select 1 from private.customer_addon_items(p_customer) i where i.code = p_item))
      or private.can_correct_onboarding_item(p_customer, p_item)
$$;
revoke all on function private.can_collect_addon_item(uuid, text) from public, anon;
grant execute on function private.can_collect_addon_item(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A ticket raised by a client reaches the people looking after that client:
--    the Team Member the customer was assigned to, their Team Lead and the Department Head.
--    (No assignment yet: it goes to the department's Support team lead as before.)
-- ---------------------------------------------------------------------------
create or replace function private.client_ticket_owner(p_customer uuid, out o_team uuid, out o_assignee uuid, out o_lead uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid;
  v_tl uuid;
  v_tm uuid;
begin
  select c.department_id into v_dept from public.customers c where c.id = p_customer;
  select o.team_lead_id, o.team_member_id into v_tl, v_tm from public.customer_onboarding o where o.customer_id = p_customer;
  -- only people who are still active
  select p.id into o_lead from public.profiles p where p.id = v_tl and p.status = 'ACTIVE';
  select p.id into o_assignee from public.profiles p where p.id = v_tm and p.status = 'ACTIVE';
  o_team := coalesce(
    (select p.team_id from public.profiles p where p.id = o_lead),
    (select p.team_id from public.profiles p where p.id = o_assignee),
    (select t.id from public.teams t where t.department_id = v_dept and t.division = 'SUPPORT' order by t.created_at limit 1));
end $$;
revoke all on function private.client_ticket_owner(uuid) from public, anon, authenticated;

create or replace function public.client_create_ticket(p_subject text, p_description text, p_category text default 'GENERAL', p_service text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  c public.customers;
  t public.support_tickets;
  v_team uuid;
  v_assignee uuid;
  v_lead uuid;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if length(v_subject) < 3 or length(v_subject) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a subject (3 to 200 characters).' using errcode = 'P0001';
  end if;
  if v_desc is null or length(v_desc) < 5 or length(v_desc) > 4000 then
    raise exception 'VALIDATION_ERROR: Describe the problem (5 to 4000 characters).' using errcode = 'P0001';
  end if;
  if coalesce(p_category, 'GENERAL') not in ('GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Unknown category.' using errcode = 'P0001';
  end if;
  if p_service is not null and not exists (select 1 from public.customer_services cs where cs.customer_id = v_customer and cs.service_code = p_service) then
    raise exception 'VALIDATION_ERROR: Choose one of your own services.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.support_tickets x where x.customer_id = v_customer and x.created_at > now() - interval '1 day') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many tickets today. Please reply to an open ticket or try again tomorrow.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  select o.o_team, o.o_assignee, o.o_lead into v_team, v_assignee, v_lead from private.client_ticket_owner(v_customer) o;
  insert into public.support_tickets (customer_id, department_id, team_id, subject, description, category, priority, service_code, created_by, assignee_id)
  values (v_customer, c.department_id, v_team, v_subject, v_desc, coalesce(p_category, 'GENERAL'), 'MEDIUM', p_service, null, v_assignee)
  returning * into t;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, to_status, note, client_author)
  values (t.id, null, 'CREATED', 'OPEN', v_desc, true);
  if v_assignee is not null then
    insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_author)
    values (t.id, null, 'ASSIGNED', 'Assigned to ' || (select full_name from public.profiles where id = v_assignee) || ' (the client''s Team Member)', false);
  end if;
  perform private.client_notify(v_customer, 'TICKET_CREATED', format('Ticket %s created', t.ticket_no), v_subject, 'ticket', t.id, format('TKT|created|%s', t.id));
  perform private.log_customer_activity(v_customer, 'CLIENT_TICKET', format('Client raised ticket %s: %s', t.ticket_no, v_subject));
  perform private.write_audit('CLIENT_TICKET_CREATED', 'support_ticket', t.id, c.department_id, v_team, jsonb_build_object('ticket_no', t.ticket_no, 'customer_id', v_customer));
  -- the assigned member, their lead (or the team's leads while nobody is assigned) and the Department Head
  perform private.notify(r.id, 'TICKET_FROM_CLIENT', format('New client ticket %s: %s', t.ticket_no, v_subject), left(v_desc, 300), 'support_ticket', t.id)
    from (select v_assignee as id where v_assignee is not null
          union
          select p.id from public.profiles p
           where p.status = 'ACTIVE'
             and ((p.role = 'TEAM_HEAD' and (p.id = v_lead or (v_lead is null and p.team_id = v_team)))
                  or (p.role = 'DEPARTMENT_HEAD' and p.department_id = c.department_id))) r;
  return private.client_ticket_json(t);
end $$;
revoke all on function public.client_create_ticket(text, text, text, text) from public, anon;
grant execute on function public.client_create_ticket(text, text, text, text) to authenticated;

-- When a client is assigned (or re-assigned) later, their still-unassigned open tickets follow.
create or replace function private.trg_assign_client_tickets()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o record;
begin
  select * into o from private.client_ticket_owner(new.customer_id);
  if o.o_assignee is not null then
    update public.support_tickets set assignee_id = o.o_assignee, team_id = coalesce(o.o_team, team_id), updated_at = now()
     where customer_id = new.customer_id and created_by is null and assignee_id is null
       and status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED');
  end if;
  return null;
end $$;
revoke all on function private.trg_assign_client_tickets() from public, anon, authenticated;
drop trigger if exists customer_onboarding_assign_client_tickets on public.customer_onboarding;
create trigger customer_onboarding_assign_client_tickets after update of team_member_id, team_lead_id on public.customer_onboarding
  for each row when (new.team_member_id is not null and new.team_member_id is distinct from old.team_member_id)
  execute function private.trg_assign_client_tickets();

-- ---------------------------------------------------------------------------
-- 6. Department Head: the department's customers with who looks after each, and their tickets
-- ---------------------------------------------------------------------------
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
    select c.*, o.handover_stage, o.team_lead_id, o.team_member_id,
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
      'handoverStage', coalesce(b.handover_stage, 'CONSULTANT'),
      'services', (select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order), '[]'::jsonb)
                     from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = b.id),
      'teamLead', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = b.team_lead_id),
      'teamMember', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = b.team_member_id),
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

create or replace function public.head_customer_tickets(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
begin
  if v_role is null or v_role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Department Head can see this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and (v_role = 'SUPER_ADMIN' or c.department_id = private.my_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'ticketNo', t.ticket_no, 'subject', t.subject, 'status', t.status, 'priority', t.priority, 'category', t.category,
      'raisedByClient', t.created_by is null, 'createdAt', t.created_at, 'resolvedAt', t.resolved_at,
      'assignee', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = t.assignee_id),
      -- the Team Lead the client was passed to; without one, the lead of the ticket's team
      'teamLead', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p
                    where p.status = 'ACTIVE' and (p.id = (select o.team_lead_id from public.customer_onboarding o where o.customer_id = t.customer_id)
                                                   or (p.role = 'TEAM_HEAD' and p.team_id = t.team_id))
                    order by (p.id = (select o.team_lead_id from public.customer_onboarding o where o.customer_id = t.customer_id)) desc, p.created_at limit 1),
      'serviceName', (select s.name from public.crm_services s where s.code = t.service_code)) order by t.created_at desc)
    from public.support_tickets t where t.customer_id = p_customer), '[]'::jsonb);
end $$;
revoke all on function public.head_customer_tickets(uuid) from public, anon;
grant execute on function public.head_customer_tickets(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Notices for clients: "office closed" days and new services
--    * A Department Head (for their department's clients) or the Super Admin (for one department or everyone)
--      publishes a notice. Clients see it as a banner / pop-up on their dashboard and in their Notification Center.
--    * "Office closed" can repeat on the same day of every month (e.g. the monthly performance review on the 1st).
--    * A new service added to the catalogue is announced to every client automatically, and the Department Heads
--      are told as well. Clients open it straight in Explore Services.
-- ---------------------------------------------------------------------------
create table if not exists public.client_announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('OFFICE_CLOSED', 'NEW_SERVICE')),
  title text not null check (length(btrim(title)) between 3 and 120),
  body text check (length(body) <= 1000),
  -- null = every client; otherwise only the clients of that department
  department_id uuid references public.departments (id) on delete cascade,
  service_code text references public.crm_services (code) on delete cascade,
  event_date date,
  event_end date,
  recurrence text not null default 'NONE' check (recurrence in ('NONE', 'MONTHLY')),
  -- how many days ahead of the day clients start seeing an "office closed" notice
  notice_days integer not null default 7 check (notice_days between 0 and 60),
  shows_from date not null default ((now() at time zone 'Asia/Kolkata')::date),
  expires_on date,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'OFFICE_CLOSED' or event_date is not null),
  check (kind <> 'NEW_SERVICE' or service_code is not null),
  check (event_end is null or event_end >= event_date)
);
create index if not exists client_announcements_live_idx on public.client_announcements (active, kind, department_id);
alter table public.client_announcements enable row level security;
revoke all on public.client_announcements from public, anon, authenticated;

create table if not exists public.client_announcement_dismissals (
  announcement_id uuid not null references public.client_announcements (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  occurrence text not null default 'ONCE',
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, customer_id, occurrence)
);
alter table public.client_announcement_dismissals enable row level security;
revoke all on public.client_announcement_dismissals from public, anon, authenticated;

alter table public.client_notifications drop constraint if exists client_notifications_entity_type_check;
alter table public.client_notifications add constraint client_notifications_entity_type_check
  check (entity_type in ('invoice', 'service', 'plan', 'ticket', 'service_request', 'plan_request', 'addon', 'announcement'));

-- today in the office's time zone
create or replace function private.office_today() returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- The date of the closure a client should be told about today (null when there is nothing to show yet or any more).
create or replace function private.announcement_occurrence(a public.client_announcements, p_today date default null)
returns date language plpgsql stable set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.office_today());
  v_day integer;
  v_month date;
  v_this date;
  v_next date;
begin
  if a.kind <> 'OFFICE_CLOSED' or a.event_date is null then
    return null;
  end if;
  if a.recurrence = 'MONTHLY' then
    if v_today < a.event_date - a.notice_days then
      return null;
    end if;
    v_day := extract(day from a.event_date)::integer;
    v_month := date_trunc('month', v_today)::date;
    v_this := v_month + (least(v_day, extract(day from (v_month + interval '1 month - 1 day'))::integer) - 1);
    v_next := (v_month + interval '1 month')::date;
    v_next := v_next + (least(v_day, extract(day from (v_next + interval '1 month - 1 day'))::integer) - 1);
    if v_this >= v_today then
      v_next := v_this;
    end if;
    return case when v_next - v_today <= a.notice_days then v_next end;
  end if;
  if v_today >= a.event_date - a.notice_days and v_today <= coalesce(a.event_end, a.event_date) then
    return a.event_date;
  end if;
  return null;
end $$;
revoke all on function private.announcement_occurrence(public.client_announcements, date) from public, anon, authenticated;

-- One place that creates a notice and tells the people it concerns.
create or replace function private.create_announcement(
  p_kind text, p_title text, p_body text, p_department uuid, p_service text,
  p_event_date date, p_event_end date, p_recurrence text, p_notice_days integer, p_expires_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.client_announcements;
  c record;
  r record;
  v_when text;
begin
  insert into public.client_announcements (kind, title, body, department_id, service_code, event_date, event_end, recurrence, notice_days, expires_on, created_by)
  values (p_kind, btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), p_department, p_service, p_event_date, p_event_end,
          coalesce(p_recurrence, 'NONE'), coalesce(p_notice_days, 7), p_expires_on, (select private.my_id()))
  returning * into a;

  -- the bell of every client who has a login
  v_when := case when a.kind = 'OFFICE_CLOSED'
                 then to_char(a.event_date, 'FMDay, FMDD FMMonth YYYY') || case when a.recurrence = 'MONTHLY' then ' (and the same day every month)' else '' end end;
  for c in select cu.id from public.customers cu
            where cu.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and (a.department_id is null or cu.department_id = a.department_id)
              and exists (select 1 from public.customer_client_accounts x where x.customer_id = cu.id) loop
    perform private.client_notify(c.id, case a.kind when 'OFFICE_CLOSED' then 'OFFICE_CLOSED' else 'NEW_SERVICE' end,
      a.title, coalesce(v_when || '. ', '') || coalesce(a.body, ''), 'announcement',
      null, format('ANN|%s|%s', a.id, c.id));
  end loop;

  -- Department Heads hear about new services (and about notices published by someone else)
  if a.kind = 'NEW_SERVICE' then
    for r in select p.id from public.profiles p
              where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and (a.department_id is null or p.department_id = a.department_id) loop
      perform private.notify(r.id, 'NEW_SERVICE', a.title, 'Clients are being told about this new service. ' || coalesce(a.body, ''), 'client_announcement', a.id);
    end loop;
  end if;
  perform private.write_audit('CLIENT_ANNOUNCEMENT_PUBLISHED', 'client_announcement', a.id, a.department_id, null,
    jsonb_build_object('kind', a.kind, 'title', a.title));
  return a.id;
end $$;
revoke all on function private.create_announcement(text, text, text, uuid, text, date, date, text, integer, date) from public, anon, authenticated;

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
  -- a Department Head speaks for their own department only
  v_dept := case when v_role = 'DEPARTMENT_HEAD' then private.my_department_id() else p_department end;
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
   where v_role = 'SUPER_ADMIN' or a.department_id is null or a.department_id = private.my_department_id()), '[]'::jsonb);
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
  if a.id is null or (v_role = 'DEPARTMENT_HEAD' and a.department_id is distinct from private.my_department_id()) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0001';
  end if;
  update public.client_announcements set active = false where id = p_id;
  perform private.write_audit('CLIENT_ANNOUNCEMENT_ENDED', 'client_announcement', p_id, a.department_id, null, jsonb_build_object('title', a.title));
end $$;
revoke all on function public.end_client_announcement(uuid) from public, anon;
grant execute on function public.end_client_announcement(uuid) to authenticated;

-- What the signed-in client sees right now (not yet dismissed).
create or replace function public.client_announcements()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_dept uuid := (select c.department_id from public.customers c where c.id = v_customer);
  v_today date := private.office_today();
begin
  return coalesce((
    select jsonb_agg(x.item order by x.sort_key)
      from (
        select a.created_at as sort_key,
               jsonb_build_object(
                 'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body, 'serviceCode', a.service_code,
                 'serviceName', (select s.name from public.crm_services s where s.code = a.service_code),
                 'serviceDescription', (select s.description from public.crm_services s where s.code = a.service_code),
                 'eventDate', occ.d, 'eventEnd', case when a.recurrence = 'NONE' then a.event_end end,
                 'daysAway', case when occ.d is not null then occ.d - v_today end,
                 'recurrence', a.recurrence, 'occurrence', coalesce(occ.d::text, 'ONCE'), 'createdAt', a.created_at) as item
          from public.client_announcements a
          cross join lateral (select private.announcement_occurrence(a) as d) occ
         where a.active and (a.department_id is null or a.department_id = v_dept)
           and ((a.kind = 'OFFICE_CLOSED' and occ.d is not null)
                or (a.kind = 'NEW_SERVICE' and v_today between a.shows_from and coalesce(a.expires_on, a.shows_from + 30)
                    and not exists (select 1 from public.customer_services cs where cs.customer_id = v_customer and cs.service_code = a.service_code)))
           and not exists (select 1 from public.client_announcement_dismissals d
                            where d.announcement_id = a.id and d.customer_id = v_customer and d.occurrence = coalesce(occ.d::text, 'ONCE'))) x), '[]'::jsonb);
end $$;
revoke all on function public.client_announcements() from public, anon;
grant execute on function public.client_announcements() to authenticated;

create or replace function public.client_dismiss_announcement(p_id uuid, p_occurrence text default 'ONCE')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  if not exists (select 1 from public.client_announcements a join public.customers c on c.id = v_customer
                  where a.id = p_id and (a.department_id is null or a.department_id = c.department_id)) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0001';
  end if;
  insert into public.client_announcement_dismissals (announcement_id, customer_id, occurrence)
  values (p_id, v_customer, left(coalesce(nullif(p_occurrence, ''), 'ONCE'), 20))
  on conflict do nothing;
end $$;
revoke all on function public.client_dismiss_announcement(uuid, text) from public, anon;
grant execute on function public.client_dismiss_announcement(uuid, text) to authenticated;

-- A service added to the catalogue is announced to every client automatically.
create or replace function private.trg_announce_new_service()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_active then
    perform private.create_announcement('NEW_SERVICE', 'New service: ' || new.name,
      coalesce(new.description, 'Amuwa now offers ' || new.name || '. Open it to see the details.'),
      null, new.code, null, null, 'NONE', 0, private.office_today() + 30);
  end if;
  return new;
end $$;
revoke all on function private.trg_announce_new_service() from public, anon, authenticated;
drop trigger if exists crm_services_announce_new on public.crm_services;
create trigger crm_services_announce_new after insert on public.crm_services
  for each row execute function private.trg_announce_new_service();
