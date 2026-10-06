-- =============================================================================
-- Baseline of the tables that existed before migrations were introduced
-- (previously created ad hoc by schema.sql / run_migration.cjs).
-- Idempotent so it is safe on the existing production project.
-- Access policies for these tables are defined in ..._harden_legacy_tables.sql.
-- =============================================================================

create table if not exists public.blueprint_requirements (
  id text primary key,
  title text not null,
  description text,
  priority text default 'Normal',
  status text default 'New',
  requester_id text,
  requester_name text,
  requester_email text,
  requester_role text,
  team_id text,
  team_name text,
  team_lead_id text,
  department_id text,
  department_name text,
  client_info jsonb,
  due_time text,
  due_notes text,
  timeline_assigned_at text,
  blueprint_pdf_name text,
  blueprint_pdf_size text,
  blueprint_pdf_url text,
  delivered_at text,
  delivery_notes text,
  submitted_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.crm_leads (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  phone text,
  email text,
  company text,
  channel text,
  department text default 'wabastore',
  sub_department text default 'sales',
  status text default 'New',
  value numeric default 0,
  notes text,
  raw_payload jsonb,
  created_at timestamptz default now()
);

create table if not exists public.hr_employees (
  id text primary key,
  name text not null,
  email text,
  phone text,
  designation text,
  department_id text,
  status text default 'Full-Time',
  joining_date text,
  monthly_salary text,
  working_hours text default '09:30 AM - 06:30 PM (Mon-Sat)',
  data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.hr_attendance (
  id text primary key default gen_random_uuid()::text,
  emp_id text not null,
  name text,
  role text,
  time text,
  status text,
  device text,
  date date default current_date,
  created_at timestamptz default now()
);

create table if not exists public.hr_leave_applications (
  id text primary key default gen_random_uuid()::text,
  employee_id text not null,
  employee_name text,
  leave_type text,
  date text,
  reason text,
  status text default 'Pending',
  created_at timestamptz default now()
);

insert into storage.buckets (id, name, public) values ('blueprint-files', 'blueprint-files', true)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('amuwa-docs', 'amuwa-docs', true)
on conflict (id) do nothing;

alter table public.blueprint_requirements enable row level security;
alter table public.crm_leads enable row level security;
alter table public.hr_employees enable row level security;
alter table public.hr_attendance enable row level security;
alter table public.hr_leave_applications enable row level security;
