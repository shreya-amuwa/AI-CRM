-- =============================================================================
-- Core CRM schema: organisation hierarchy, profiles, customers, approvals,
-- notifications, audit log, settings.
-- Hierarchy: departments → teams → profiles → customers.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER');
create type public.account_status as enum ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED');
create type public.team_division as enum ('SALES', 'SUPPORT', 'GENERAL');
create type public.customer_segment as enum ('RETAIL', 'WHOLESALE', 'CORPORATE', 'OTHER');
create type public.customer_status as enum ('ACTIVE', 'INACTIVE', 'PROSPECT');
create type public.approval_request_type as enum ('USER_REGISTRATION');
create type public.approval_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- Generic updated_at maintenance
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Departments (business units). `slug` keeps the legacy string ids used in
-- URLs and department panels (e.g. 'wabastore').
-- ---------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 2 and 120),
  description text not null default '' check (length(description) <= 1000),
  category text check (length(category) <= 120),
  icon_name text not null default 'Building2',
  accent_color text not null default '#3B82F6' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url text,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create unique index departments_name_lower_key on public.departments (lower(name));
create trigger departments_set_updated_at before update on public.departments
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Teams. (id, department_id) is unique so children can carry a composite FK
-- that guarantees team ∈ department.
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 120),
  division public.team_division not null default 'GENERAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (id, department_id)
);
create unique index teams_department_name_key on public.teams (department_id, lower(name));
create trigger teams_set_updated_at before update on public.teams
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles: application identity for auth.users. Authorization state
-- (role, status, department, team) lives ONLY here.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null check (length(trim(full_name)) between 1 and 160),
  avatar_url text check (length(avatar_url) <= 1000),
  phone text check (length(phone) <= 40),
  position text check (length(position) <= 120),
  role public.app_role not null default 'TEAM_MEMBER',
  status public.account_status not null default 'PENDING',
  department_id uuid references public.departments (id) on delete restrict,
  team_id uuid,
  status_reason text check (length(status_reason) <= 500),
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_team_in_department
    foreign key (team_id, department_id) references public.teams (id, department_id) on delete restrict,
  constraint profiles_team_requires_department check (team_id is null or department_id is not null),
  constraint profiles_department_head_scope check (
    role <> 'DEPARTMENT_HEAD' or (department_id is not null and team_id is null)),
  constraint profiles_active_team_roles_need_team check (
    role not in ('TEAM_HEAD', 'TEAM_MEMBER') or status <> 'ACTIVE' or team_id is not null)
);
create unique index profiles_email_key on public.profiles (email);
create index profiles_department_idx on public.profiles (department_id) where department_id is not null;
create index profiles_team_idx on public.profiles (team_id) where team_id is not null;
create index profiles_role_status_idx on public.profiles (role, status);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

alter table public.departments
  add constraint departments_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;
alter table public.teams
  add constraint teams_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Customers. team_id / department_id are derived from the owner by trigger,
-- never trusted from the client.
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  team_id uuid not null,
  department_id uuid not null references public.departments (id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 200),
  email text check (email is null or (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or phone ~ '^[0-9+()\-\s.]{5,25}$'),
  company text check (length(company) <= 200),
  segment public.customer_segment not null default 'RETAIL',
  status public.customer_status not null default 'ACTIVE',
  notes text check (length(notes) <= 5000),
  last_order_date date,
  last_order_amount numeric(14, 2) check (last_order_amount >= 0),
  total_spent numeric(14, 2) not null default 0 check (total_spent >= 0),
  order_count integer not null default 0 check (order_count >= 0),
  search_text text generated always as (
    lower(name || ' ' || coalesce(company, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  constraint customers_team_in_department
    foreign key (team_id, department_id) references public.teams (id, department_id) on delete restrict,
  constraint customers_contact_present check (email is not null or phone is not null)
);
create index customers_owner_created_idx on public.customers (owner_id, created_at desc);
create index customers_team_created_idx on public.customers (team_id, created_at desc);
create index customers_department_created_idx on public.customers (department_id, created_at desc);
create index customers_status_idx on public.customers (department_id, status);
create index customers_search_trgm_idx on public.customers using gin (search_text extensions.gin_trgm_ops);
-- Duplicate protection: one customer per e-mail inside a department.
create unique index customers_department_email_key on public.customers (department_id, email) where email is not null;

-- Customer activity timeline (calls, notes, meetings…). Immutable rows.
create table public.customer_activities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type text not null check (type ~ '^[A-Z][A-Z0-9_]{1,49}$'),
  note text check (length(note) <= 5000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index customer_activities_customer_idx on public.customer_activities (customer_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Approval requests
-- ---------------------------------------------------------------------------
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_type public.approval_request_type not null,
  subject_user_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  status public.approval_status not null default 'PENDING',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_decision_consistent check (
    (status = 'PENDING' and decided_at is null) or (status <> 'PENDING' and decided_at is not null))
);
create unique index approval_requests_one_pending_key
  on public.approval_requests (subject_user_id, request_type) where status = 'PENDING';
create index approval_requests_pending_team_idx on public.approval_requests (team_id, created_at desc) where status = 'PENDING';
create index approval_requests_pending_department_idx on public.approval_requests (department_id, created_at desc) where status = 'PENDING';
create index approval_requests_status_created_idx on public.approval_requests (status, created_at desc);
create trigger approval_requests_set_updated_at before update on public.approval_requests
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Notifications (one row per recipient). `type` is open-ended UPPER_SNAKE
-- text so new types need no migration.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  title text not null check (length(title) between 1 and 200),
  body text not null default '' check (length(body) <= 2000),
  priority text not null default 'normal' check (priority in ('normal', 'urgent', 'announcement')),
  entity_type text check (entity_type ~ '^[a-z_]{1,40}$'),
  entity_id uuid,
  actor_id uuid references public.profiles (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
create index notifications_recipient_unread_idx on public.notifications (recipient_id, created_at desc) where read_at is null;

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  entity_type text not null check (entity_type ~ '^[a-z_]{1,40}$'),
  entity_id uuid,
  department_id uuid references public.departments (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_department_created_idx on public.audit_logs (department_id, created_at desc) where department_id is not null;
create index audit_logs_team_created_idx on public.audit_logs (team_id, created_at desc) where team_id is not null;
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc) where actor_id is not null;

-- ---------------------------------------------------------------------------
-- CRM settings (system configuration, Super Admin managed)
-- ---------------------------------------------------------------------------
create table public.crm_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{1,79}$'),
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger crm_settings_set_updated_at before update on public.crm_settings
  for each row execute function public.tg_set_updated_at();
