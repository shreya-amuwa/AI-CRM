-- =============================================================================
-- AI calls: who a call is transferred to when the agent says "transfer to the Technical Consultant".
--
-- The calling agent (BolifyAI) used to transfer to ONE number typed into its settings. The company has several departments, each with its own
-- Technical Consultants, so the number has to depend on the customer being called. The agent asks the CRM, during the call, "who do I transfer
-- this customer to?" (an HTTPS tool, see docs/BOLIFY_AI.md) and the CRM answers from its own records:
--
--   customer      the person being called (found from the call's reference / call id, else from the phone number),
--   department    the customer's department (a Support side counts as its department),
--   consultant    that customer's Technical Consultant if there is one and they are reachable, else the department's Technical Consultants
--                 in turn (the one who was sent a call longest ago), else the department's Support Team Lead,
--   reachable     active, has a valid Indian mobile number on their profile, and is not on approved full-day leave today.
--
-- Nothing is sent to a consultant who cannot be reached, and a call with no one to transfer to says so (the agent then promises a call back and
-- the department's consultants and Support Team Lead are notified). Every answer is logged (ai_call_transfers, append-only; phone numbers are
-- stored masked) and a transfer is written on the customer's timeline. The same call asking twice gets the same consultant.
--
-- Only the server (service role, with the secret the calling agent presents) may ask. Nothing is deleted. Safe to run again.
-- =============================================================================

create table if not exists public.ai_call_transfers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_id uuid references public.customers (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  consultant_id uuid references public.profiles (id) on delete set null,
  outcome text not null check (outcome in ('ROUTED', 'NO_CONSULTANT', 'NO_CUSTOMER')),
  how text check (how in ('ASSIGNED', 'ROTATION', 'TEAM_LEAD')),
  reference text check (length(reference) <= 200),
  call_id text check (length(call_id) <= 200),
  phone_masked text,
  reason text check (length(reason) <= 500)
);
create index if not exists ai_call_transfers_consultant_idx on public.ai_call_transfers (consultant_id, created_at desc) where outcome = 'ROUTED';
create index if not exists ai_call_transfers_customer_idx on public.ai_call_transfers (customer_id, created_at desc);
create index if not exists ai_call_transfers_recent_idx on public.ai_call_transfers (created_at desc);
alter table public.ai_call_transfers enable row level security;
revoke all on public.ai_call_transfers from public, anon, authenticated;
-- no policy and no grant: reached only through the functions below

-- ---------------------------------------------------------------------------
-- Who can be called now in a department
-- ---------------------------------------------------------------------------
create or replace function private.ai_call_reachable(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_profile and p.status = 'ACTIVE' and private.mobile10(p.phone) is not null
       and not exists (select 1 from public.leave_requests l
                        where l.employee_id = p.id and l.status = 'APPROVED' and l.leave_type = 'FULL_DAY'
                          and (now() at time zone 'Asia/Kolkata')::date between l.start_date and l.end_date))
$$;
revoke all on function private.ai_call_reachable(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The question the agent asks. Service role only.
-- ---------------------------------------------------------------------------
create or replace function public.ai_call_transfer_target(p_phone text, p_reference text default null, p_call_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ten text := private.mobile10(p_phone);
  v_masked text := case when private.mobile10(p_phone) is null then null else '+91XXXXXX' || right(private.mobile10(p_phone), 4) end;
  v_ref text := nullif(left(btrim(coalesce(p_reference, '')), 200), '');
  v_call text := nullif(left(btrim(coalesce(p_call_id, '')), 200), '');
  c public.customers;
  v_matches integer := 0;
  v_dept uuid;
  v_dept_name text;
  v_pick uuid;
  v_how text;
  v_prev uuid;
  v_prev_how text;
  v_to text;
  v_name text;
  v_recipient uuid;
  v_recent integer;
begin
  -- 1. the customer: the reminder this call belongs to (its reference or the provider's call id), else the phone number
  if v_ref is not null or v_call is not null then
    select cu.* into c
      from public.subscription_reminders sr join public.customers cu on cu.id = sr.customer_id
     where (v_ref is not null and sr.id::text = v_ref) or (v_call is not null and sr.external_call_id = v_call)
     order by sr.updated_at desc limit 1;
  end if;
  if c.id is null and v_ten is not null then
    select count(*) into v_matches from public.customers cu where private.mobile10(cu.phone) = v_ten or private.mobile10(cu.whatsapp) = v_ten;
    select cu.* into c from public.customers cu
     where private.mobile10(cu.phone) = v_ten or private.mobile10(cu.whatsapp) = v_ten
     order by (cu.lifecycle_stage = 'CUSTOMER') desc, cu.updated_at desc limit 1;
  end if;
  if c.id is null then
    insert into public.ai_call_transfers (outcome, reference, call_id, phone_masked, reason)
    values ('NO_CUSTOMER', v_ref, v_call, v_masked, 'No customer has this reference or number.');
    return jsonb_build_object('found', false, 'reason', 'NO_CUSTOMER');
  end if;

  -- 2. the department (a Support side of a department is that department)
  v_dept := private.base_department(c.department_id);
  select d.name into v_dept_name from public.departments d where d.id = v_dept;

  -- 3. the same call asking again gets the same person (a few minutes), if they can still be reached
  select t.consultant_id, t.how into v_prev, v_prev_how from public.ai_call_transfers t
   where t.outcome = 'ROUTED' and t.customer_id = c.id and t.created_at > now() - interval '15 minutes'
     and ((v_ref is not null and t.reference = v_ref) or (v_call is not null and t.call_id = v_call) or (v_ref is null and v_call is null))
   order by t.created_at desc limit 1;
  if v_prev is not null and private.ai_call_reachable(v_prev) then
    v_pick := v_prev; v_how := v_prev_how;
  end if;

  -- 4. the customer's own Technical Consultant (the one who started their onboarding), if they are in this department and reachable
  if v_pick is null then
    select o.consultant_started_by into v_pick
      from public.customer_onboarding o join public.profiles p on p.id = o.consultant_started_by
     where o.customer_id = c.id and p.is_technical_consultant and private.base_department(p.department_id) = v_dept and private.ai_call_reachable(p.id);
    if v_pick is not null then v_how := 'ASSIGNED'; end if;
  end if;

  -- 5. otherwise the department's Technical Consultants in turn: the one who was sent a call the longest ago
  if v_pick is null then
    select p.id into v_pick from public.profiles p
     where p.is_technical_consultant and private.base_department(p.department_id) = v_dept and private.ai_call_reachable(p.id)
     order by coalesce((select max(t.created_at) from public.ai_call_transfers t where t.consultant_id = p.id and t.outcome = 'ROUTED'), 'epoch'::timestamptz), p.full_name, p.id
     limit 1;
    if v_pick is not null then v_how := 'ROTATION'; end if;
  end if;

  -- 6. nobody: the department's Support Team Lead
  if v_pick is null then
    select p.id into v_pick from public.profiles p join public.teams t on t.id = p.team_id
     where p.role = 'TEAM_HEAD' and t.division = 'SUPPORT' and private.base_department(p.department_id) = v_dept and private.ai_call_reachable(p.id)
     order by p.full_name, p.id limit 1;
    if v_pick is not null then v_how := 'TEAM_LEAD'; end if;
  end if;

  if v_pick is null then
    insert into public.ai_call_transfers (customer_id, department_id, outcome, reference, call_id, phone_masked, reason)
    values (c.id, v_dept, 'NO_CONSULTANT', v_ref, v_call, v_masked, 'No Technical Consultant of the department can be reached (no number, on leave, or none exists).');
    -- tell the people who can call the customer back (once an hour per customer: the row above is the first of the hour or not)
    select count(*) into v_recent from public.ai_call_transfers t where t.customer_id = c.id and t.outcome = 'NO_CONSULTANT' and t.created_at > now() - interval '1 hour';
    if v_recent <= 1 then
      for v_recipient in
        select p.id from public.profiles p
         where p.status = 'ACTIVE' and private.base_department(p.department_id) = v_dept
           and (p.is_technical_consultant or (p.role = 'TEAM_HEAD' and exists (select 1 from public.teams t where t.id = p.team_id and t.division = 'SUPPORT')))
      loop
        perform private.notify(v_recipient, 'AI_CALL_TRANSFER_MISSED', 'A customer asked for a consultant on an AI call',
          left(coalesce(nullif(btrim(c.company), ''), c.name), 120) || ' asked to speak to a Technical Consultant and nobody could be reached. Please call them back.', 'customer', c.id);
      end loop;
      perform private.log_customer_activity(c.id, 'AI_CALL_TRANSFER_MISSED', 'The AI call asked for a Technical Consultant, but nobody could be reached.');
    end if;
    return jsonb_build_object('found', false, 'reason', 'NO_CONSULTANT', 'department', v_dept_name);
  end if;

  select '+91' || private.mobile10(p.phone), p.full_name into v_to, v_name from public.profiles p where p.id = v_pick;
  insert into public.ai_call_transfers (customer_id, department_id, consultant_id, outcome, how, reference, call_id, phone_masked)
  values (c.id, v_dept, v_pick, 'ROUTED', v_how, v_ref, v_call, v_masked);
  -- (the same call asking again is not a second transfer)
  if v_prev is distinct from v_pick then
    perform private.log_customer_activity(c.id, 'AI_CALL_TRANSFERRED', 'The AI call was transferred to ' || v_name || ' (' || coalesce(v_dept_name, 'the department') || ').');
  end if;
  return jsonb_build_object('found', true, 'transferTo', v_to, 'consultantName', v_name, 'consultantFirstName', split_part(btrim(v_name), ' ', 1),
    'department', v_dept_name, 'how', v_how, 'ambiguousNumber', v_matches > 1);
end $$;
revoke all on function public.ai_call_transfer_target(text, text, text) from public, anon, authenticated;
grant execute on function public.ai_call_transfer_target(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The record, for the people who answer for it: the Super Admin (everything) and a Department Head (their own department).
-- ---------------------------------------------------------------------------
create or replace function public.ai_call_transfers_recent(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid;
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if private.is_super_admin() then
    v_dept := null;
  elsif private.my_role() = 'DEPARTMENT_HEAD' then
    v_dept := private.base_department(private.my_department_id());
  else
    raise exception 'FORBIDDEN: Only a Department Head or the Super Admin can see AI call transfers.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', t.created_at, 'outcome', t.outcome, 'how', t.how, 'customer', nullif(btrim(c.company), ''),
             'customerName', c.name, 'department', d.name, 'consultant', p.full_name, 'phone', t.phone_masked, 'reason', t.reason) order by t.created_at desc)
      from (select * from public.ai_call_transfers x
             where v_dept is null or x.department_id = v_dept
             order by x.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) t
      left join public.customers c on c.id = t.customer_id
      left join public.departments d on d.id = t.department_id
      left join public.profiles p on p.id = t.consultant_id), '[]'::jsonb);
end $$;
revoke all on function public.ai_call_transfers_recent(integer) from public, anon;
grant execute on function public.ai_call_transfers_recent(integer) to authenticated;
