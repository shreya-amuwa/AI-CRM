-- =============================================================================
-- Technical Consultant dashboard.
--
--  * Consultants (support-team members of the department), department heads
--    and the super admin see every customer in ONBOARDING — including those
--    still waiting for documents — and can authorize items as soon as sales
--    saves them (previously only after "Forward to support").
--  * Four review states for the list: AWAITING_DOCUMENTS, TO_REVIEW,
--    NEEDS_FIX, VERIFIED (authorized).
--  * "Authorize all" in one call.
--  * Onboarding automations (Email / WhatsApp / AI Calling) are run by the API
--    against a Google Sheet webhook; every run is recorded here.
-- Additive / idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Visibility and review rights: any onboarding customer of the department
-- ---------------------------------------------------------------------------
create or replace function private.can_review_onboarding(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()))
$$;

drop policy if exists customers_select_review on public.customers;
create policy customers_select_review on public.customers for select to authenticated
  using (department_id = (select private.my_support_department_id()) and lifecycle_stage in ('ONBOARDING', 'CUSTOMER'));

-- ---------------------------------------------------------------------------
-- 2. Review state with "awaiting documents"
-- ---------------------------------------------------------------------------
alter table public.customer_onboarding drop column if exists review_state;
alter table public.customer_onboarding
  add column review_state text generated always as (
    case when items_rejected > 0 then 'NEEDS_FIX'
         when items_total > 0 and items_verified >= items_total then 'VERIFIED'
         when items_saved > items_verified then 'TO_REVIEW'
         else 'AWAITING_DOCUMENTS' end) stored;

-- Tab counts for the consultant list.
create or replace function public.onboarding_review_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'all', count(*),
    'TO_REVIEW', count(*) filter (where o.review_state = 'TO_REVIEW'),
    'NEEDS_FIX', count(*) filter (where o.review_state = 'NEEDS_FIX'),
    'VERIFIED', count(*) filter (where o.review_state = 'VERIFIED'),
    'AWAITING_DOCUMENTS', count(*) filter (where o.review_state = 'AWAITING_DOCUMENTS'))
  from public.customers c
  join public.customer_onboarding o on o.customer_id = c.id
  where c.lifecycle_stage = 'ONBOARDING' and private.can_review_onboarding(c.id)
$$;
revoke all on function public.onboarding_review_counts() from public, anon;
grant execute on function public.onboarding_review_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Authorize all saved items at once
-- ---------------------------------------------------------------------------
create or replace function public.verify_all_onboarding_entries(p_customer uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  n integer;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  update public.customer_onboarding_entries
     set status = 'VERIFIED', reviewed_by = (select private.my_id()), reviewed_at = now(), review_note = null
   where customer_id = p_customer and status = 'SAVED'
     and item_code in (select code from private.customer_items(p_customer));
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'CONFLICT: Nothing is waiting for authorization.' using errcode = 'P0001';
  end if;
  perform private.refresh_onboarding_progress(p_customer);
  perform private.log_customer_activity(p_customer, 'ONBOARDING_ITEMS_VERIFIED', format('%s items authorized', n));
  perform private.write_audit('ONBOARDING_ITEMS_VERIFIED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('count', n));
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if o.items_total > 0 and o.items_verified = o.items_total then
    perform private.notify(v.owner_id, 'ONBOARDING_VERIFIED', format('Onboarding verified: %s', coalesce(v.company, v.name)),
      'All documents and details were verified by the technical team.', 'customer', p_customer);
  end if;
  return n;
end $$;
revoke all on function public.verify_all_onboarding_entries(uuid) from public, anon;
grant execute on function public.verify_all_onboarding_entries(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Automation runs (Email / WhatsApp / AI Calling via Google Sheets)
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_automation_runs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  automation text not null check (automation in ('EMAIL', 'WHATSAPP', 'AI_CALLING')),
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED')),
  detail text check (length(detail) <= 500),
  triggered_by uuid references public.profiles (id) on delete set null,
  triggered_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists onboarding_automation_runs_customer_idx
  on public.onboarding_automation_runs (customer_id, automation, triggered_at desc);

alter table public.onboarding_automation_runs enable row level security;
grant select on public.onboarding_automation_runs to authenticated;
revoke insert, update, delete on public.onboarding_automation_runs from authenticated, anon;
drop policy if exists onboarding_automation_runs_select on public.onboarding_automation_runs;
create policy onboarding_automation_runs_select on public.onboarding_automation_runs for select to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));

-- Starts a run (authorization checked here) and returns what the API sends
-- to the Google Sheet. At most one run per customer + automation per minute.
create or replace function public.begin_onboarding_automation(p_customer uuid, p_automation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_run uuid;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_automation not in ('EMAIL', 'WHATSAPP', 'AI_CALLING') then
    raise exception 'VALIDATION_ERROR: Unknown automation.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  if exists (select 1 from public.onboarding_automation_runs r
             where r.customer_id = p_customer and r.automation = p_automation
               and (r.status = 'PENDING' or r.triggered_at > now() - interval '1 minute')
               and r.triggered_at > now() - interval '10 minutes') then
    raise exception 'CONFLICT: This automation was just triggered. Please wait a minute before running it again.' using errcode = 'P0001';
  end if;
  insert into public.onboarding_automation_runs (customer_id, automation, triggered_by)
  values (p_customer, p_automation, (select private.my_id()))
  returning id into v_run;
  return jsonb_build_object(
    'runId', v_run,
    'customer', jsonb_build_object(
      'id', v.id, 'name', v.name, 'company', v.company, 'phone', v.phone, 'whatsapp', coalesce(v.whatsapp, v.phone),
      'email', v.email, 'city', v.city, 'dealAmount', v.deal_amount, 'amountReceived', v.amount_received),
    'services', (select coalesce(jsonb_agg(s.name order by s.sort_order), '[]'::jsonb)
                   from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                  where cs.customer_id = p_customer),
    'triggeredBy', (select full_name from public.profiles where id = (select private.my_id())));
end $$;
revoke all on function public.begin_onboarding_automation(uuid, text) from public, anon;
grant execute on function public.begin_onboarding_automation(uuid, text) to authenticated;

create or replace function public.finish_onboarding_automation(p_run uuid, p_ok boolean, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.onboarding_automation_runs;
  v public.customers;
begin
  select * into r from public.onboarding_automation_runs where id = p_run for update;
  if r.id is null or r.triggered_by is distinct from (select private.my_id()) or r.status <> 'PENDING' then
    raise exception 'NOT_FOUND: Run not found.' using errcode = 'P0001';
  end if;
  update public.onboarding_automation_runs
     set status = case when p_ok then 'SENT' else 'FAILED' end, detail = left(p_detail, 500), finished_at = now()
   where id = p_run;
  select * into v from public.customers where id = r.customer_id;
  perform private.log_customer_activity(r.customer_id, 'AUTOMATION_' || r.automation,
    format('%s automation %s', initcap(replace(r.automation, '_', ' ')), case when p_ok then 'triggered' else 'failed' end));
  perform private.write_audit(case when p_ok then 'AUTOMATION_TRIGGERED' else 'AUTOMATION_FAILED' end,
    'customer', r.customer_id, v.department_id, v.team_id, jsonb_build_object('automation', r.automation, 'run_id', p_run));
end $$;
revoke all on function public.finish_onboarding_automation(uuid, boolean, text) from public, anon;
grant execute on function public.finish_onboarding_automation(uuid, boolean, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.onboarding_automation_runs;
exception when duplicate_object then null;
end $$;
