-- =============================================================================
-- Team member workspace. Everything a sales executive works with — leads,
-- follow-ups, activity log, deals, calendar, end-of-day reports, invoices and
-- field visits — lives here instead of in each browser's localStorage, so the
-- same account sees the same data on every device. Realtime is enabled so an
-- open dashboard updates when another device changes something.
--
-- Access:
--   * the owner reads and writes their own rows
--   * Super Admin, the department head and the team head can READ rows of
--     members in their scope
-- =============================================================================

-- Can the current user read records owned by p_owner?
create or replace function private.can_view_owner(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_owner = private.my_id()
    or private.my_role() = 'SUPER_ADMIN'
    or exists (
      select 1 from public.profiles p
      where p.id = p_owner
        and ((private.my_role() = 'DEPARTMENT_HEAD' and p.department_id = private.my_department_id())
          or (private.my_role() = 'TEAM_HEAD' and p.team_id = private.my_team_id()))
    )
$$;

-- ---------------------------------------------------------------------------
-- Leads: inbound webhook leads (crm_leads) gain an owner and a pipeline stage.
-- A team member sees leads assigned to them plus unassigned leads of their
-- department; acting on an unassigned lead claims it.
-- ---------------------------------------------------------------------------
alter table public.crm_leads
  add column if not exists assigned_to uuid references public.profiles (id) on delete set null,
  add column if not exists stage text not null default 'New'
    check (stage in ('New', 'New Lead', 'Contacted', 'Interested', 'Demo', 'Proposal', 'Negotiation', 'Won', 'Lost')),
  add column if not exists priority text not null default 'Medium' check (priority in ('High', 'Medium', 'Low')),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists crm_leads_assigned_to_idx on public.crm_leads (assigned_to);
create index if not exists crm_leads_department_idx on public.crm_leads (department, created_at desc);

-- Team members may only claim unassigned leads or work on their own.
create or replace function private.tg_crm_leads_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if private.my_role() = 'TEAM_MEMBER' then
    if old.assigned_to is not null and old.assigned_to <> private.my_id() then
      raise exception 'FORBIDDEN: This lead is assigned to another team member.' using errcode = '42501';
    end if;
    if new.assigned_to is distinct from old.assigned_to and new.assigned_to is distinct from private.my_id() then
      raise exception 'FORBIDDEN: You can only assign leads to yourself.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists crm_leads_before_update on public.crm_leads;
create trigger crm_leads_before_update before update on public.crm_leads
  for each row execute function private.tg_crm_leads_before_update();

-- ---------------------------------------------------------------------------
-- Member-owned tables
-- ---------------------------------------------------------------------------
create table public.member_follow_ups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  lead_id text check (length(lead_id) <= 100),
  lead_name text not null check (length(lead_name) <= 200),
  company text check (length(company) <= 200),
  type text not null check (type in ('Call', 'WhatsApp', 'Email', 'Meeting')),
  due_label text not null default '' check (length(due_label) <= 100),
  notes text not null default '' check (length(notes) <= 2000),
  status text not null default 'upcoming' check (status in ('upcoming', 'overdue', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index member_follow_ups_owner_idx on public.member_follow_ups (owner_id, created_at desc);

create table public.member_activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  lead_id text check (length(lead_id) <= 100),
  lead_name text not null default '' check (length(lead_name) <= 200),
  action text not null check (length(action) <= 300),
  notes text check (length(notes) <= 2000),
  type text not null default 'update' check (type in ('call', 'message', 'demo', 'update', 'stage')),
  created_at timestamptz not null default now()
);
create index member_activities_owner_idx on public.member_activities (owner_id, created_at desc);

create table public.member_deals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  lead_id text check (length(lead_id) <= 100),
  lead_name text not null check (length(lead_name) <= 200),
  company text not null default '' check (length(company) <= 200),
  value numeric(14, 2) not null default 0 check (value >= 0),
  stage text not null default 'Proposal' check (stage in ('Proposal', 'Negotiation', 'Won', 'Lost')),
  expected_close date,
  created_at timestamptz not null default now()
);
create index member_deals_owner_idx on public.member_deals (owner_id, created_at desc);

create table public.member_calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (length(title) <= 200),
  customer text not null check (length(customer) <= 200),
  company text check (length(company) <= 200),
  type text not null default 'call' check (type in ('call', 'demo', 'meeting', 'review')),
  event_date date not null,
  event_time text not null default '' check (length(event_time) <= 20),
  status text not null default 'confirmed' check (status in ('confirmed', 'pending', 'completed')),
  created_at timestamptz not null default now()
);
create index member_calendar_events_owner_idx on public.member_calendar_events (owner_id, event_date);

create table public.member_eod_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  user_name text not null default '' check (length(user_name) <= 160),
  report_date date not null default current_date,
  leads_advanced integer not null default 0 check (leads_advanced >= 0),
  sales_closed integer not null default 0 check (sales_closed >= 0),
  calls_made integer not null default 0 check (calls_made >= 0),
  demos_scheduled integer not null default 0 check (demos_scheduled >= 0),
  notes text check (length(notes) <= 4000),
  created_at timestamptz not null default now(),
  unique (owner_id, report_date)
);

create table public.member_invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  invoice_number text not null check (length(invoice_number) <= 60),
  customer_name text not null check (length(customer_name) <= 200),
  company text not null default '' check (length(company) <= 200),
  amount numeric(14, 2) not null check (amount >= 0),
  status text not null default 'Pending' check (status in ('Paid', 'Pending', 'Overdue')),
  issue_date text not null default '' check (length(issue_date) <= 40),
  due_date text not null default '' check (length(due_date) <= 40),
  -- department, line items, terms, contact details
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 32768),
  created_at timestamptz not null default now()
);
create index member_invoices_owner_idx on public.member_invoices (owner_id, created_at desc);

create table public.field_visits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status text not null default 'In Transit' check (length(status) <= 40),
  -- client, purpose, timings, stops
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index field_visits_owner_idx on public.field_visits (owner_id, created_at desc);
create trigger field_visits_set_updated_at before update on public.field_visits
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owner writes, owner + managers in scope read
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['member_follow_ups', 'member_activities', 'member_deals', 'member_calendar_events',
                           'member_eod_reports', 'member_invoices', 'field_visits']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.can_view_owner(owner_id))',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select private.my_id()))',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select private.my_id())) with check (owner_id = (select private.my_id()))',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select private.my_id()))',
                   t || '_delete', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;

  begin
    alter publication supabase_realtime add table public.crm_leads;
  exception when duplicate_object then null;
  end;
end $$;
