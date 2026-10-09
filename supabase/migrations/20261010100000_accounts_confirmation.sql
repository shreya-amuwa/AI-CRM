-- =============================================================================
-- Accounts confirms the amount before the Technical Consultant gets the client.
--
--   Sales (details + documents complete)  --"Send to Accounts"-->  Accounts
--   Accounts checks the business details and the amount, presses Confirm
--   --> the customer goes to the Technical Consultant for onboarding.
--
-- forward_onboarding_to_support() (the call Sales already makes) now sends the
-- customer to Accounts the first time. When the Technical Consultant sends a
-- customer back and Sales fixes it, the amount is already confirmed, so it goes
-- straight back to the Technical Consultant.
-- Accounts staff = anyone active in the Accounts department (lead, member or
-- head) and the Super Admin. They read customers only through the functions
-- below: no change to the customers table policies.
-- Additive / idempotent.
-- =============================================================================

alter table public.customer_onboarding
  add column if not exists sent_to_accounts_at timestamptz,
  add column if not exists sent_to_accounts_by uuid references public.profiles (id) on delete set null,
  add column if not exists accounts_confirmed_at timestamptz,
  add column if not exists accounts_confirmed_by uuid references public.profiles (id) on delete set null,
  add column if not exists accounts_note text check (length(accounts_note) <= 1000);
create index if not exists customer_onboarding_accounts_idx on public.customer_onboarding (sent_to_accounts_at) where sent_to_accounts_at is not null;

-- Active staff of the Accounts department, or the Super Admin.
create or replace function private.is_accounts_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin() or exists (
    select 1 from public.profiles p join public.departments d on d.id = p.department_id
    where p.id = auth.uid() and p.status = 'ACTIVE' and d.slug = 'accounts')
$$;
revoke all on function private.is_accounts_staff() from public, anon;
grant execute on function private.is_accounts_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- The hand-off to the Technical Consultant (what forward_onboarding_to_support did)
-- ---------------------------------------------------------------------------
create or replace function private.forward_to_consultant(p_id uuid, v public.customers, v_again boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
begin
  update public.customer_onboarding
     set stage = 'SETUP', forwarded_to_support_at = now(), forwarded_by = (select private.my_id()),
         returned_at = null, returned_by = null, return_note = null
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'FORWARDED_TO_SUPPORT',
    case when v_again then 'Fixed and sent again to the Technical Consultant' else 'Sent to the Technical Consultant for verification' end);
  perform private.write_audit('ONBOARDING_FORWARDED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('resubmitted', coalesce(v_again, false)));

  for v_recipient in
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
    where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
      and (p.is_technical_consultant or p.role = 'TEAM_HEAD')
  loop
    perform private.notify(v_recipient, 'ONBOARDING_FORWARDED',
      format(case when v_again then 'Re-verify: %s' else 'New customer to verify: %s' end, coalesce(v.company, v.name)),
      case when v_again then 'Sales fixed the items you sent back.' else 'Accounts confirmed the amount. The customer''s details and documents are ready for verification.' end,
      'customer', p_id);
  end loop;
end $$;
revoke all on function private.forward_to_consultant(uuid, public.customers, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sales: send to Accounts (first time) or straight back to the consultant
-- ---------------------------------------------------------------------------
create or replace function public.forward_onboarding_to_support(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  o public.customer_onboarding;
  v_missing text;
  v_recipient uuid;
begin
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_id;
  if o.forwarded_to_support_at is not null then
    raise exception 'CONFLICT: Already sent to the Technical Consultant.' using errcode = 'P0001';
  end if;
  if o.sent_to_accounts_at is not null and o.accounts_confirmed_at is null then
    raise exception 'CONFLICT: Already sent to Accounts. Waiting for their confirmation.' using errcode = 'P0001';
  end if;
  select string_agg(i.label, ', ' order by i.sort_order) into v_missing
  from private.customer_items(p_id) i
  where not exists (select 1 from public.customer_onboarding_entries e
                    where e.customer_id = p_id and e.item_code = i.code and e.status in ('SAVED', 'VERIFIED'));
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: Complete these items first: %.', v_missing using errcode = 'P0001';
  end if;

  -- Amount already confirmed (the consultant sent it back): no second round with Accounts.
  if o.accounts_confirmed_at is not null then
    perform private.forward_to_consultant(p_id, v, o.returned_at is not null);
    return;
  end if;

  update public.customer_onboarding
     set sent_to_accounts_at = now(), sent_to_accounts_by = (select private.my_id())
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'SENT_TO_ACCOUNTS', 'Sent to Accounts to confirm the amount');
  perform private.write_audit('ONBOARDING_SENT_TO_ACCOUNTS', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('deal_amount', v.deal_amount, 'amount_received', v.amount_received));

  for v_recipient in
    select p.id from public.profiles p join public.departments d on d.id = p.department_id
    where p.status = 'ACTIVE' and d.slug = 'accounts'
  loop
    perform private.notify(v_recipient, 'SENT_TO_ACCOUNTS', format('Confirm the amount: %s', coalesce(v.company, v.name)),
      'Sales sent a new customer for payment confirmation.', 'customer', p_id);
  end loop;
end $$;
revoke all on function public.forward_onboarding_to_support(uuid) from public, anon;
grant execute on function public.forward_onboarding_to_support(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Accounts: the queue (business details + amount) and the confirmation
-- ---------------------------------------------------------------------------
create or replace function public.accounts_confirmations(
  p_status text default 'PENDING', p_search text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_pending boolean := coalesce(p_status, 'PENDING') = 'PENDING';
  v_total integer;
  v_items jsonb;
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can see payment confirmations.' using errcode = '42501';
  end if;
  if coalesce(p_status, 'PENDING') not in ('PENDING', 'CONFIRMED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;

  with q as (
    select c.*, o.sent_to_accounts_at, o.sent_to_accounts_by, o.accounts_confirmed_at, o.accounts_confirmed_by,
           o.accounts_note, o.payment_method, o.forwarded_to_support_at
      from public.customers c
      join public.customer_onboarding o on o.customer_id = c.id
     where o.sent_to_accounts_at is not null
       and ((v_pending and o.accounts_confirmed_at is null) or (not v_pending and o.accounts_confirmed_at is not null))
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
  )
  select count(*) into v_total from q;

  select coalesce(jsonb_agg(row_json order by sort_at desc), '[]'::jsonb) into v_items from (
    select
      case when v_pending then q.sent_to_accounts_at else q.accounts_confirmed_at end as sort_at,
      jsonb_build_object(
        'id', q.id,
        'code', q.customer_code,
        'name', q.name,
        'company', q.company,
        'email', q.email,
        'phone', q.phone,
        'segment', q.segment,
        'notes', q.notes,
        'department', (select d.name from public.departments d where d.id = q.department_id),
        'salesperson', (select p.full_name from public.profiles p where p.id = q.owner_id),
        'services', coalesce((select jsonb_agg(s.name order by s.sort_order)
                                from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                               where cs.customer_id = q.id), '[]'::jsonb),
        'dealAmount', q.deal_amount,
        'amountReceived', q.amount_received,
        'balance', greatest(coalesce(q.deal_amount, 0) - q.amount_received, 0),
        'paymentMethod', q.payment_method,
        'paymentDueDate', q.payment_due_date,
        'sentAt', q.sent_to_accounts_at,
        'sentBy', (select p.full_name from public.profiles p where p.id = q.sent_to_accounts_by),
        'confirmedAt', q.accounts_confirmed_at,
        'confirmedBy', (select p.full_name from public.profiles p where p.id = q.accounts_confirmed_by),
        'note', q.accounts_note,
        'sentToConsultantAt', q.forwarded_to_support_at
      ) as row_json
    from (
      select c.*, o.sent_to_accounts_at, o.sent_to_accounts_by, o.accounts_confirmed_at, o.accounts_confirmed_by,
             o.accounts_note, o.payment_method, o.forwarded_to_support_at
        from public.customers c
        join public.customer_onboarding o on o.customer_id = c.id
       where o.sent_to_accounts_at is not null
         and ((v_pending and o.accounts_confirmed_at is null) or (not v_pending and o.accounts_confirmed_at is not null))
         and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
    ) q
    order by sort_at desc
    limit v_size offset (v_page - 1) * v_size
  ) page;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.accounts_confirmations(text, text, integer, integer) from public, anon;
grant execute on function public.accounts_confirmations(text, text, integer, integer) to authenticated;

create or replace function public.confirm_accounts_payment(p_customer uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can confirm payments.' using errcode = '42501';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if v.id is null or o.customer_id is null or o.sent_to_accounts_at is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if o.accounts_confirmed_at is not null then
    raise exception 'CONFLICT: This customer is already confirmed.' using errcode = 'P0001';
  end if;
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set accounts_confirmed_at = now(), accounts_confirmed_by = (select private.my_id()), accounts_note = v_note
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ACCOUNTS_CONFIRMED',
    format('Amount confirmed by Accounts (deal ₹%s, received ₹%s)', v.deal_amount, v.amount_received) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('ACCOUNTS_CONFIRMED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('deal_amount', v.deal_amount, 'amount_received', v.amount_received, 'note', v_note));
  perform private.notify(v.owner_id, 'ACCOUNTS_CONFIRMED', format('Confirmed by Accounts: %s', coalesce(v.company, v.name)),
    'Accounts confirmed the amount. The customer went to the Technical Consultant.', 'customer', p_customer);

  perform private.forward_to_consultant(p_customer, v, false);
end $$;
revoke all on function public.confirm_accounts_payment(uuid, text) from public, anon;
grant execute on function public.confirm_accounts_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Stored default dashboard: Accounts staff open the Accounts dashboard
-- ---------------------------------------------------------------------------
create or replace function private.tg_profiles_default_dashboard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_division text;
  v_slug text;
begin
  select division into v_division from public.teams where id = new.team_id;
  select slug into v_slug from public.departments where id = new.department_id;
  new.default_dashboard := case new.role
    when 'SUPER_ADMIN' then 'super-admin'
    when 'DEPARTMENT_HEAD' then case when v_slug = 'hr' then 'hr-head' else 'department-head' end
    when 'TEAM_HEAD' then case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_division = 'SUPPORT' then 'support-lead'
      when v_division = 'SALES' then 'sales-lead'
      else 'team-lead'
    end
    else case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_division = 'SUPPORT' and coalesce(new.is_technical_consultant, false) then 'technical-consultant'
      when v_division = 'SUPPORT' then 'support-member'
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $$;
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;
update public.profiles p set updated_at = p.updated_at
 where p.department_id in (select id from public.departments where slug = 'accounts') and p.role in ('TEAM_MEMBER', 'TEAM_HEAD');
