-- =============================================================================
-- AI Studio: a new department with its own projects, tasks and daily reports, inside the existing CRM.
--
--   * Department `ai-studio` + one team. The people are ordinary profiles: Department Head (role DEPARTMENT_HEAD), Team Leads (TEAM_HEAD) and
--     Team Members (TEAM_MEMBER). A Team Member belongs to ONE Team Lead through the existing profiles.manager_id (private.direct_lead_of),
--     exactly as in every other department, so the existing hierarchy, attendance, meetings, chat, leave and notifications work unchanged.
--   * profiles.default_dashboard gets 'ai-studio-head' / 'ai-studio-lead' / 'ai-studio-member' for that department (nothing else changes).
--   * Projects (ai_studio_projects, seeded: AI CRM, AI Website, AIQR; the Department Head adds more) and who works on them
--     (ai_studio_project_members: a Team Lead on one or more projects, a Team Member on projects of their own Team Lead).
--   * Tasks (ai_studio_tasks) with a progress/status history (ai_studio_task_updates).
--   * Daily reports (ai_studio_daily_reports) with the approval chain
--       Team Member -> Team Lead -> Department Head      (a Team Lead's own report goes straight to the Department Head)
--     and its full history (ai_studio_report_events).
--
-- Security model (as everywhere in this CRM): RLS is on and nothing is granted to anon / authenticated on the tables; every read and write
-- goes through the security definer functions below, which work out the caller from auth.uid() and check who may do what. The browser never
-- sends a role, a team or a reviewer. Additive and safe to run again: nothing is deleted or rewritten, no other department is touched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. The department and its team
-- ---------------------------------------------------------------------------
insert into public.departments (slug, name, description, category, icon_name, accent_color, generates_revenue)
values ('ai-studio', 'AI Studio', 'Project-based AI work: AI CRM, AI Website, AIQR and the projects added later.', 'Technology', 'Sparkles', '#7C3AED', false)
on conflict do nothing;

insert into public.teams (department_id, name, division)
select d.id, 'AI Studio Team', 'GENERAL'
  from public.departments d
 where d.slug = 'ai-studio' and not exists (select 1 from public.teams t where t.department_id = d.id)
on conflict do nothing;

create or replace function private.ai_studio_department()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.departments where slug = 'ai-studio'
$$;
revoke all on function private.ai_studio_department() from public, anon;
grant execute on function private.ai_studio_department() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The dashboard a person opens (the latest definition, 20261222000100, plus AI Studio)
-- ---------------------------------------------------------------------------
create or replace function private.tg_profiles_default_dashboard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_division text;
  v_slug text;
begin
  select division into v_division from public.teams where id = new.team_id;
  select slug into v_slug from public.departments where id = new.department_id;
  if new.sales_sub_role is not null and (new.role is distinct from 'TEAM_MEMBER' or v_division is distinct from 'SALES') then
    new.sales_sub_role := null;
  end if;
  -- an HR designation belongs to a Team Member / Team Lead of the HR department and nobody else
  if new.hr_sub_role is not null and not (v_slug = 'hr' and new.role in ('TEAM_MEMBER', 'TEAM_HEAD')) then
    new.hr_sub_role := null;
  end if;
  new.default_dashboard := case new.role
    when 'SUPER_ADMIN' then 'super-admin'
    when 'DEPARTMENT_HEAD' then case
      when v_slug = 'hr' then 'hr-head'
      when v_slug = 'ai-studio' then 'ai-studio-head'
      when new.head_division = 'SALES' and v_slug is distinct from 'accounts' then 'sales-department-head'
      else 'department-head' end
    when 'TEAM_HEAD' then case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_slug = 'ai-studio' then 'ai-studio-lead'
      when v_slug = 'hr' and new.hr_sub_role = 'HR_RECRUITER' then 'hr-recruiter'
      when v_division = 'SUPPORT' then 'support-lead'
      when v_division = 'SALES' then 'sales-lead'
      else 'team-lead'
    end
    else case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_slug = 'ai-studio' then 'ai-studio-member'
      when v_slug = 'hr' and new.hr_sub_role = 'HR_RECRUITER' then 'hr-recruiter'
      when v_division = 'SUPPORT' and coalesce(new.is_technical_consultant, false) then 'technical-consultant'
      when v_division = 'SUPPORT' and coalesce(new.is_meta_verifier, false) then 'meta-verifier'
      when v_division = 'SUPPORT' then 'support-member'
      when v_division = 'SALES' and new.sales_sub_role = 'TELECALLER' then 'telecaller'
      when v_division = 'SALES' and new.sales_sub_role = 'BUSINESS_ASSOCIATE' then 'business-associate'
      when v_division = 'SALES' and new.sales_sub_role is not null then 'sales-' || lower(replace(new.sales_sub_role, '_', '-'))
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $$;
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;

-- anybody already placed in the department (none on a fresh install) gets the dashboard value recomputed
update public.profiles set updated_at = updated_at where department_id = private.ai_studio_department();

-- ---------------------------------------------------------------------------
-- 2. Who is who in AI Studio
-- ---------------------------------------------------------------------------
-- 'ADMIN' (Super Admin), 'HEAD', 'LEAD' or 'MEMBER' for an active AI Studio person; null for everybody else (another department, a client, ...)
create or replace function private.ai_studio_role(p_profile uuid default auth.uid())
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.role = 'SUPER_ADMIN' then 'ADMIN'
    when p.department_id is distinct from private.ai_studio_department() then null
    when p.role = 'DEPARTMENT_HEAD' then 'HEAD'
    when p.role = 'TEAM_HEAD' then 'LEAD'
    when p.role = 'TEAM_MEMBER' then 'MEMBER'
  end
  from public.profiles p where p.id = p_profile and p.status = 'ACTIVE'
$$;
revoke all on function private.ai_studio_role(uuid) from public, anon;
grant execute on function private.ai_studio_role(uuid) to authenticated, service_role;

create or replace function private.ai_studio_require(p_allowed text[])
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v text := private.ai_studio_role();
begin
  if v is null or not (v = any (p_allowed)) then
    raise exception 'FORBIDDEN: This page is only for the people of AI Studio.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function private.ai_studio_require(text[]) from public, anon;
grant execute on function private.ai_studio_require(text[]) to authenticated, service_role;

-- today in Indian time (the company works in it); a report dated "today" must never be refused because the server is on UTC
create or replace function private.ai_studio_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;
revoke all on function private.ai_studio_today() from public, anon;
grant execute on function private.ai_studio_today() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Tables (read and written only through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_studio_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text check (description is null or length(description) <= 2000),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- no two projects with the same name (letters of any case, extra spaces ignored)
create unique index if not exists ai_studio_projects_name_key on public.ai_studio_projects (lower(btrim(name)));
drop trigger if exists ai_studio_projects_set_updated_at on public.ai_studio_projects;
create trigger ai_studio_projects_set_updated_at before update on public.ai_studio_projects
  for each row execute function public.tg_set_updated_at();

insert into public.ai_studio_projects (name, description) values
  ('AI CRM', 'The Amuwa AI CRM.'),
  ('AI Website', 'AI-built websites for Amuwa customers.'),
  ('AIQR', 'AIQR codes and the AIQR studio.')
on conflict do nothing;

create table if not exists public.ai_studio_project_members (
  project_id uuid not null references public.ai_studio_projects (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);
create index if not exists ai_studio_project_members_profile_idx on public.ai_studio_project_members (profile_id);

create table if not exists public.ai_studio_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ai_studio_projects (id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 4000),
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  assigned_by uuid references public.profiles (id) on delete set null,
  assignee_id uuid not null references public.profiles (id) on delete cascade,
  due_date date,
  status text not null default 'ASSIGNED' check (status in ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED')),
  progress integer not null default 0 check (progress between 0 and 100),
  started_at timestamptz,
  completed_at timestamptz,
  completion_note text check (completion_note is null or length(completion_note) <= 2000),
  last_update_note text check (last_update_note is null or length(last_update_note) <= 2000),
  last_update_at timestamptz,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_studio_tasks_assignee_idx on public.ai_studio_tasks (assignee_id, status);
create index if not exists ai_studio_tasks_project_idx on public.ai_studio_tasks (project_id, status);
create index if not exists ai_studio_tasks_assigner_idx on public.ai_studio_tasks (assigned_by);
drop trigger if exists ai_studio_tasks_set_updated_at on public.ai_studio_tasks;
create trigger ai_studio_tasks_set_updated_at before update on public.ai_studio_tasks
  for each row execute function public.tg_set_updated_at();

create table if not exists public.ai_studio_task_updates (
  id uuid primary key default gen_random_uuid(),
  -- the order of the steps: two steps of one request share a timestamp, so the history is ordered by this
  seq bigint generated always as identity,
  task_id uuid not null references public.ai_studio_tasks (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text,
  kind text not null check (kind in ('ASSIGNED', 'PROGRESS', 'EDITED')),
  status text not null check (status in ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED')),
  progress integer not null check (progress between 0 and 100),
  note text check (note is null or length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists ai_studio_task_updates_task_idx on public.ai_studio_task_updates (task_id, created_at desc);

create table if not exists public.ai_studio_daily_reports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  author_name text not null,
  author_role text not null check (author_role in ('MEMBER', 'LEAD')),
  project_id uuid not null references public.ai_studio_projects (id) on delete restrict,
  task_id uuid references public.ai_studio_tasks (id) on delete set null,
  report_date date not null,
  work_completed text check (work_completed is null or length(work_completed) <= 4000),
  work_in_progress text check (work_in_progress is null or length(work_in_progress) <= 4000),
  pending_work text check (pending_work is null or length(pending_work) <= 4000),
  blockers text check (blockers is null or length(blockers) <= 4000),
  remarks text check (remarks is null or length(remarks) <= 4000),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'PENDING_TL_APPROVAL', 'RETURNED_BY_TL', 'PENDING_DH_APPROVAL', 'RETURNED_BY_DH', 'APPROVED')),
  -- the Team Lead who reviews a Team Member's report (recorded when it is submitted); null for a Team Lead's own report
  lead_id uuid references public.profiles (id) on delete set null,
  lead_name text,
  revision integer not null default 1,
  tl_reviewed_by uuid references public.profiles (id) on delete set null,
  tl_reviewed_at timestamptz,
  tl_comment text check (tl_comment is null or length(tl_comment) <= 2000),
  dh_reviewed_by uuid references public.profiles (id) on delete set null,
  dh_reviewed_at timestamptz,
  dh_comment text check (dh_comment is null or length(dh_comment) <= 2000),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one report per person, day, project and task: a double click or a retry opens the same report instead of making a second one
create unique index if not exists ai_studio_daily_reports_one_key
  on public.ai_studio_daily_reports (author_id, report_date, project_id, coalesce(task_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists ai_studio_daily_reports_lead_idx on public.ai_studio_daily_reports (lead_id, status) where lead_id is not null;
create index if not exists ai_studio_daily_reports_status_idx on public.ai_studio_daily_reports (status, report_date desc);
create index if not exists ai_studio_daily_reports_project_idx on public.ai_studio_daily_reports (project_id, report_date desc);
drop trigger if exists ai_studio_daily_reports_set_updated_at on public.ai_studio_daily_reports;
create trigger ai_studio_daily_reports_set_updated_at before update on public.ai_studio_daily_reports
  for each row execute function public.tg_set_updated_at();

create table if not exists public.ai_studio_report_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  report_id uuid not null references public.ai_studio_daily_reports (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  actor_role text,
  action text not null check (action in ('CREATED', 'SUBMITTED', 'RESUBMITTED', 'APPROVED', 'RETURNED')),
  stage text check (stage is null or stage in ('TEAM_LEAD', 'DEPARTMENT_HEAD')),
  from_status text,
  to_status text not null,
  comment text check (comment is null or length(comment) <= 2000),
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists ai_studio_report_events_report_idx on public.ai_studio_report_events (report_id, created_at);

alter table public.ai_studio_projects enable row level security;
alter table public.ai_studio_project_members enable row level security;
alter table public.ai_studio_tasks enable row level security;
alter table public.ai_studio_task_updates enable row level security;
alter table public.ai_studio_daily_reports enable row level security;
alter table public.ai_studio_report_events enable row level security;
revoke all on public.ai_studio_projects, public.ai_studio_project_members, public.ai_studio_tasks, public.ai_studio_task_updates,
  public.ai_studio_daily_reports, public.ai_studio_report_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row helpers (private: only the functions below call them)
-- ---------------------------------------------------------------------------
-- is the person on the project?
create or replace function private.ai_studio_on_project(p_project uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ai_studio_project_members m where m.project_id = p_project and m.profile_id = p_profile)
$$;
revoke all on function private.ai_studio_on_project(uuid, uuid) from public, anon;
grant execute on function private.ai_studio_on_project(uuid, uuid) to authenticated, service_role;

-- who may see a task: the assignee, the person who gave it, the assignee's Team Lead, the Department Head, the Super Admin
create or replace function private.ai_studio_can_see_task(t public.ai_studio_tasks)
returns boolean language sql stable security definer set search_path = '' as $$
  -- coalesce: a comparison with "no lead" is null, and "not null" must never let a caller through
  select coalesce(case private.ai_studio_role()
    when 'ADMIN' then true
    when 'HEAD' then true
    when 'LEAD' then t.assignee_id = auth.uid() or t.assigned_by = auth.uid() or private.direct_lead_of(t.assignee_id) = auth.uid()
    when 'MEMBER' then t.assignee_id = auth.uid()
    else false
  end, false)
$$;
revoke all on function private.ai_studio_can_see_task(public.ai_studio_tasks) from public, anon;
grant execute on function private.ai_studio_can_see_task(public.ai_studio_tasks) to authenticated, service_role;

create or replace function private.ai_studio_task_row(t public.ai_studio_tasks)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'projectId', t.project_id, 'projectName', pr.name, 'title', t.title, 'description', t.description,
    'priority', t.priority, 'status', t.status, 'progress', t.progress, 'dueDate', t.due_date,
    'assignedAt', t.created_at, 'startedAt', t.started_at, 'completedAt', t.completed_at,
    'assigneeId', t.assignee_id, 'assigneeName', a.full_name, 'assignedById', t.assigned_by, 'assignedByName', b.full_name,
    'lastUpdateNote', t.last_update_note, 'lastUpdateAt', t.last_update_at, 'completionNote', t.completion_note,
    'attachments', t.attachments,
    'overdue', (t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < private.ai_studio_today()))
    from public.ai_studio_projects pr
    join public.profiles a on a.id = t.assignee_id
    left join public.profiles b on b.id = t.assigned_by
   where pr.id = t.project_id
$$;
revoke all on function private.ai_studio_task_row(public.ai_studio_tasks) from public, anon;
grant execute on function private.ai_studio_task_row(public.ai_studio_tasks) to authenticated, service_role;

-- up to five http(s) links; anything else is refused
create or replace function private.ai_studio_links(p_links jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if p_links is null then return null; end if;
  if jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 5 then
    raise exception 'VALIDATION_ERROR: Add at most 5 links.' using errcode = 'P0001';
  end if;
  for v in select * from jsonb_array_elements(p_links) loop
    if jsonb_typeof(v) <> 'string' or (btrim(v #>> '{}') !~* '^https?://[^\s]+$' or length(btrim(v #>> '{}')) > 500) then
      raise exception 'VALIDATION_ERROR: An attachment must be a link that starts with http:// or https://.' using errcode = 'P0001';
    end if;
    v_out := v_out || to_jsonb(btrim(v #>> '{}'));
  end loop;
  return v_out;
end $$;
revoke all on function private.ai_studio_links(jsonb) from public, anon;
grant execute on function private.ai_studio_links(jsonb) to authenticated, service_role;

-- the Team Lead who decides a Team Member's report: the member's CURRENT lead while it waits for them, the recorded one afterwards
create or replace function private.ai_studio_report_lead(r public.ai_studio_daily_reports)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when r.author_role <> 'MEMBER' then null
              when r.status in ('PENDING_TL_APPROVAL', 'RETURNED_BY_TL', 'DRAFT') then coalesce(private.direct_lead_of(r.author_id), r.lead_id)
              else coalesce(r.lead_id, private.direct_lead_of(r.author_id)) end
$$;
revoke all on function private.ai_studio_report_lead(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_lead(public.ai_studio_daily_reports) to authenticated, service_role;

-- every active Department Head of AI Studio
create or replace function private.ai_studio_head_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.department_id = private.ai_studio_department() and p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE'
$$;
revoke all on function private.ai_studio_head_ids() from public, anon;
grant execute on function private.ai_studio_head_ids() to authenticated, service_role;

create or replace function private.ai_studio_event(
  r public.ai_studio_daily_reports, p_action text, p_stage text, p_from text, p_comment text)
returns void language sql security definer set search_path = '' as $$
  insert into public.ai_studio_report_events (report_id, actor_id, actor_name, actor_role, action, stage, from_status, to_status, comment, revision)
  select r.id, p.id, p.full_name, private.ai_studio_role(p.id), p_action, p_stage, p_from, r.status, nullif(btrim(coalesce(p_comment, '')), ''), r.revision
    from public.profiles p where p.id = auth.uid()
$$;
revoke all on function private.ai_studio_event(public.ai_studio_daily_reports, text, text, text, text) from public, anon;
grant execute on function private.ai_studio_event(public.ai_studio_daily_reports, text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Projects
-- ---------------------------------------------------------------------------
-- The projects the caller works with (the Department Head and the Super Admin: every project), with their people and task counts. The counts
-- cover the tasks the caller may see, so a Team Member's numbers are their own and a Team Lead's are their team's.
create or replace function public.ai_studio_projects_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'description', pr.description, 'status', pr.status, 'createdAt', pr.created_at,
      'mine', exists (select 1 from public.ai_studio_project_members m where m.project_id = pr.id and m.profile_id = v_me),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name) order by l.full_name)
                           from public.ai_studio_project_members m join public.profiles l on l.id = m.profile_id
                          where m.project_id = pr.id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE'
                            and (v_role in ('ADMIN', 'HEAD') or l.id = v_me or v_role = 'MEMBER' and l.id = private.direct_lead_of(v_me))), '[]'::jsonb),
      'memberCount', (select count(*) from public.ai_studio_project_members m join public.profiles x on x.id = m.profile_id
                       where m.project_id = pr.id and x.role = 'TEAM_MEMBER' and x.status = 'ACTIVE'
                         and (v_role in ('ADMIN', 'HEAD') or v_role = 'LEAD' and private.direct_lead_of(x.id) = v_me or v_role = 'MEMBER' and x.id = v_me)),
      'tasks', (select jsonb_build_object('total', count(*), 'assigned', count(*) filter (where t.status = 'ASSIGNED'),
                         'ongoing', count(*) filter (where t.status = 'IN_PROGRESS'), 'onHold', count(*) filter (where t.status = 'ON_HOLD'),
                         'completed', count(*) filter (where t.status = 'COMPLETED'),
                         'progress', coalesce(round(avg(t.progress)), 0))
                  from public.ai_studio_tasks t where t.project_id = pr.id and private.ai_studio_can_see_task(t))
    ) order by (pr.status = 'ARCHIVED'), pr.name)
    from public.ai_studio_projects pr
   where v_role in ('ADMIN', 'HEAD')
      or exists (select 1 from public.ai_studio_project_members m where m.project_id = pr.id and m.profile_id = v_me)), '[]'::jsonb);
end $$;
revoke all on function public.ai_studio_projects_list() from public, anon;
grant execute on function public.ai_studio_projects_list() to authenticated;

-- Add (p_id null) or edit a project: the Department Head and the Super Admin
create or replace function public.ai_studio_project_save(p_id uuid, p_name text, p_description text, p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  pr public.ai_studio_projects;
begin
  perform private.ai_studio_require(array['ADMIN', 'HEAD']);
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'VALIDATION_ERROR: Enter the project name (2 to 120 characters).' using errcode = 'P0001';
  end if;
  if v_desc is not null and length(v_desc) > 2000 then
    raise exception 'VALIDATION_ERROR: The description can have at most 2000 characters.' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED') then
    raise exception 'VALIDATION_ERROR: Unknown project status.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.ai_studio_projects x where lower(btrim(x.name)) = lower(v_name) and x.id is distinct from p_id) then
    raise exception 'CONFLICT: A project named "%" already exists.', v_name using errcode = 'P0001';
  end if;
  begin
    if p_id is null then
      insert into public.ai_studio_projects (name, description, status, created_by)
      values (v_name, v_desc, coalesce(p_status, 'ACTIVE'), auth.uid()) returning * into pr;
      perform private.write_audit('AI_STUDIO_PROJECT_CREATED', 'ai_studio_project', pr.id, private.ai_studio_department(), null, jsonb_build_object('name', v_name));
    else
      update public.ai_studio_projects set name = v_name, description = v_desc, status = coalesce(p_status, status) where id = p_id returning * into pr;
      if pr.id is null then raise exception 'NOT_FOUND: Project not found.' using errcode = 'P0001'; end if;
      perform private.write_audit('AI_STUDIO_PROJECT_UPDATED', 'ai_studio_project', pr.id, private.ai_studio_department(), null, jsonb_build_object('name', v_name, 'status', pr.status));
    end if;
  exception when unique_violation then
    raise exception 'CONFLICT: A project named "%" already exists.', v_name using errcode = 'P0001';
  end;
  return jsonb_build_object('id', pr.id, 'name', pr.name, 'description', pr.description, 'status', pr.status, 'createdAt', pr.created_at);
end $$;
revoke all on function public.ai_studio_project_save(uuid, text, text, text) from public, anon;
grant execute on function public.ai_studio_project_save(uuid, text, text, text) to authenticated;

-- Put a person on a project, or take them off.
--   * Team Lead: the Department Head or the Super Admin. A Team Lead can work on several projects.
--   * Team Member: only on a project their own Team Lead is on; by the Department Head, the Super Admin or that Team Lead.
create or replace function public.ai_studio_project_assign(p_project uuid, p_profile uuid, p_assign boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  v_me uuid := auth.uid();
  pr public.ai_studio_projects;
  t public.profiles;
  v_lead uuid;
begin
  select * into pr from public.ai_studio_projects where id = p_project;
  if pr.id is null then raise exception 'NOT_FOUND: Project not found.' using errcode = 'P0001'; end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null or t.status <> 'ACTIVE' or t.department_id is distinct from private.ai_studio_department() or t.role not in ('TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead or Team Member of AI Studio.' using errcode = 'P0001';
  end if;
  if t.role = 'TEAM_HEAD' and v_role = 'LEAD' then
    raise exception 'FORBIDDEN: Only the Department Head can put a Team Lead on a project.' using errcode = '42501';
  end if;
  if t.role = 'TEAM_MEMBER' then
    v_lead := private.direct_lead_of(t.id);
    if v_role = 'LEAD' and v_lead is distinct from v_me then
      raise exception 'FORBIDDEN: You can only assign your own Team Members.' using errcode = '42501';
    end if;
    if p_assign and v_lead is null then
      raise exception 'VALIDATION_ERROR: % has no Team Lead yet. Choose their Team Lead first.', t.full_name using errcode = 'P0001';
    end if;
    if p_assign and not private.ai_studio_on_project(p_project, v_lead) then
      raise exception 'VALIDATION_ERROR: Put the Team Lead of % on "%" first.', t.full_name, pr.name using errcode = 'P0001';
    end if;
  end if;
  if p_assign then
    if pr.status = 'ARCHIVED' then
      raise exception 'VALIDATION_ERROR: "%" is archived.', pr.name using errcode = 'P0001';
    end if;
    insert into public.ai_studio_project_members (project_id, profile_id, assigned_by) values (p_project, p_profile, v_me) on conflict do nothing;
    if found then
      perform private.write_audit('AI_STUDIO_PROJECT_ASSIGNED', 'ai_studio_project', p_project, t.department_id, t.team_id, jsonb_build_object('profile', t.id));
      perform private.notify(t.id, 'AI_STUDIO_PROJECT_ASSIGNED', format('You were added to %s', pr.name), 'Open Projects to see its tasks.', 'ai_studio_project', p_project);
    end if;
  else
    if exists (select 1 from public.ai_studio_tasks k where k.project_id = p_project and k.assignee_id = t.id and k.status <> 'COMPLETED') then
      raise exception 'CONFLICT: % still has open tasks in "%". Complete or move them first.', t.full_name, pr.name using errcode = 'P0001';
    end if;
    if t.role = 'TEAM_HEAD' and exists (
         select 1 from public.ai_studio_project_members m join public.profiles x on x.id = m.profile_id
          where m.project_id = p_project and x.role = 'TEAM_MEMBER' and x.status = 'ACTIVE' and private.direct_lead_of(x.id) = t.id) then
      raise exception 'CONFLICT: Take the Team Members of % off "%" first.', t.full_name, pr.name using errcode = 'P0001';
    end if;
    delete from public.ai_studio_project_members where project_id = p_project and profile_id = p_profile;
    if found then
      perform private.write_audit('AI_STUDIO_PROJECT_UNASSIGNED', 'ai_studio_project', p_project, t.department_id, t.team_id, jsonb_build_object('profile', t.id));
    end if;
  end if;
  return jsonb_build_object('projectId', p_project, 'profileId', p_profile, 'assigned', p_assign);
end $$;
revoke all on function public.ai_studio_project_assign(uuid, uuid, boolean) from public, anon;
grant execute on function public.ai_studio_project_assign(uuid, uuid, boolean) to authenticated;

-- Checked BEFORE an account is made: a new AI Studio Team Lead / Team Member needs at least one active project (and, for a Team Member, a Team Lead who
-- is on every chosen project), so a wrong choice creates nothing. Does nothing for any other department.
create or replace function public.ai_studio_project_check(p_department uuid, p_role text, p_team uuid, p_projects uuid[], p_lead uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_role();
  v_projects uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_projects, '{}'::uuid[])) x), '{}'::uuid[]);
  v_lead uuid := p_lead;
  -- the screens know the team, not the department: the team says which department the new person joins
  v_dept uuid := coalesce(p_department, (select t.department_id from public.teams t where t.id = p_team));
  p uuid;
begin
  if v_dept is distinct from private.ai_studio_department() then
    if cardinality(v_projects) > 0 or p_lead is not null then
      raise exception 'VALIDATION_ERROR: Projects belong to the AI Studio department only.' using errcode = 'P0001';
    end if;
    return;
  end if;
  if p_role not in ('TEAM_HEAD', 'TEAM_MEMBER') then
    if cardinality(v_projects) > 0 then
      raise exception 'VALIDATION_ERROR: Projects are given to Team Leads and Team Members.' using errcode = 'P0001';
    end if;
    return;
  end if;
  if v_role is null then raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501'; end if;
  if cardinality(v_projects) = 0 then
    raise exception 'VALIDATION_ERROR: Select a project for the AI Studio %.', case when p_role = 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end using errcode = 'P0001';
  end if;
  foreach p in array v_projects loop
    if not exists (select 1 from public.ai_studio_projects x where x.id = p and x.status <> 'ARCHIVED') then
      raise exception 'VALIDATION_ERROR: Choose a project from the list.' using errcode = 'P0001';
    end if;
  end loop;
  if p_role = 'TEAM_HEAD' then
    if v_role not in ('ADMIN', 'HEAD') then raise exception 'FORBIDDEN: Only the Department Head can add a Team Lead.' using errcode = '42501'; end if;
    return;
  end if;
  -- a Team Member: the Team Lead is the caller (a Team Lead adds their own people) or the one the Department Head / Super Admin names
  if v_role = 'LEAD' then
    if v_lead is not null and v_lead <> auth.uid() then raise exception 'FORBIDDEN: A Team Lead adds Team Members to their own team.' using errcode = '42501'; end if;
    v_lead := auth.uid();
  end if;
  if v_lead is null then
    raise exception 'VALIDATION_ERROR: Choose the Team Lead of the new Team Member.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles l where l.id = v_lead and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and l.department_id = v_dept and l.team_id is not distinct from p_team) then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead of the same team.' using errcode = 'P0001';
  end if;
  foreach p in array v_projects loop
    if not private.ai_studio_on_project(p, v_lead) then
      raise exception 'VALIDATION_ERROR: The Team Lead is not on the selected project. Put the Team Lead on it first.' using errcode = 'P0001';
    end if;
  end loop;
end $$;
revoke all on function public.ai_studio_project_check(uuid, text, uuid, uuid[], uuid) from public, anon;
grant execute on function public.ai_studio_project_check(uuid, text, uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. People
-- ---------------------------------------------------------------------------
-- The Department Head and the Super Admin: everybody in AI Studio. A Team Lead: themselves and their own Team Members.
create or replace function public.ai_studio_people()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  v_me uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by (x."role" = 'DEPARTMENT_HEAD') desc, (x."role" = 'TEAM_HEAD') desc, x."fullName")
      from (
        select p.id, p.full_name as "fullName", p.email, p.role::text as "role", p."position", p.status::text as "status",
               case when p.role = 'TEAM_MEMBER' then private.direct_lead_of(p.id) end as "leadId",
               (select l.full_name from public.profiles l where l.id = case when p.role = 'TEAM_MEMBER' then private.direct_lead_of(p.id) end) as "leadName",
               coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.name)
                           from public.ai_studio_project_members m join public.ai_studio_projects pr on pr.id = m.project_id where m.profile_id = p.id), '[]'::jsonb) as "projects",
               (select count(*) from public.ai_studio_tasks t where t.assignee_id = p.id and t.status <> 'COMPLETED') as "openTasks",
               (select count(*) from public.ai_studio_tasks t where t.assignee_id = p.id and t.status = 'COMPLETED') as "completedTasks"
          from public.profiles p
         where p.department_id = private.ai_studio_department() and p.status in ('ACTIVE', 'SUSPENDED')
           and (v_role in ('ADMIN', 'HEAD') or p.id = v_me or (p.role = 'TEAM_MEMBER' and private.direct_lead_of(p.id) = v_me))
      ) x), '[]'::jsonb);
end $$;
revoke all on function public.ai_studio_people() from public, anon;
grant execute on function public.ai_studio_people() to authenticated;

-- Name (or change) the Team Lead of an AI Studio Team Member: the Department Head and the Super Admin, through the same function every department uses
-- (assign_direct_lead). The new Team Lead must already be on every project the member is on, so a member never works on a project their lead is not on.
create or replace function public.ai_studio_set_lead(p_member uuid, p_lead uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.profiles;
  l public.profiles;
  v_missing text;
begin
  perform private.ai_studio_require(array['ADMIN', 'HEAD']);
  select * into m from public.profiles where id = p_member;
  select * into l from public.profiles where id = p_lead;
  if m.id is null or m.role <> 'TEAM_MEMBER' or m.status <> 'ACTIVE' or m.department_id is distinct from private.ai_studio_department() then
    raise exception 'NOT_FOUND: Team Member not found.' using errcode = 'P0001';
  end if;
  if l.id is null or l.role <> 'TEAM_HEAD' or l.status <> 'ACTIVE' or l.department_id is distinct from private.ai_studio_department() then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead of AI Studio.' using errcode = 'P0001';
  end if;
  select string_agg(pr.name, ', ' order by pr.name) into v_missing
    from public.ai_studio_project_members pm join public.ai_studio_projects pr on pr.id = pm.project_id
   where pm.profile_id = m.id and not private.ai_studio_on_project(pm.project_id, l.id);
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: % is not on % yet. Put them on it first, or take % off it.', l.full_name, v_missing, m.full_name using errcode = 'P0001';
  end if;
  return public.assign_direct_lead(m.id, l.id);
end $$;
revoke all on function public.ai_studio_set_lead(uuid, uuid) from public, anon;
grant execute on function public.ai_studio_set_lead(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Tasks
-- ---------------------------------------------------------------------------
-- The Department Head (and the Super Admin) give a task to a Team Lead or a Team Member of the project; a Team Lead gives one to their own Team Members.
create or replace function public.ai_studio_task_assign(
  p_project uuid, p_assignee uuid, p_title text, p_description text, p_priority text, p_due date, p_links jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  v_me uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_priority text := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'MEDIUM');
  pr public.ai_studio_projects;
  a public.profiles;
  v_lead uuid;
  t public.ai_studio_tasks;
  v_by text;
begin
  if length(v_title) < 1 or length(v_title) > 200 then raise exception 'VALIDATION_ERROR: Enter the task title (up to 200 characters).' using errcode = 'P0001'; end if;
  if v_desc is not null and length(v_desc) > 4000 then raise exception 'VALIDATION_ERROR: The description can have at most 4000 characters.' using errcode = 'P0001'; end if;
  if v_priority not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001'; end if;
  if p_due is not null and p_due < private.ai_studio_today() then raise exception 'VALIDATION_ERROR: The deadline cannot be in the past.' using errcode = 'P0001'; end if;
  select * into pr from public.ai_studio_projects where id = p_project;
  if pr.id is null then raise exception 'NOT_FOUND: Project not found.' using errcode = 'P0001'; end if;
  if pr.status <> 'ACTIVE' then raise exception 'VALIDATION_ERROR: "%" is not active, so no task can be added to it.', pr.name using errcode = 'P0001'; end if;
  select * into a from public.profiles where id = p_assignee;
  if a.id is null or a.status <> 'ACTIVE' or a.department_id is distinct from private.ai_studio_department() or a.role not in ('TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead or Team Member of AI Studio.' using errcode = 'P0001';
  end if;
  v_lead := case when a.role = 'TEAM_MEMBER' then private.direct_lead_of(a.id) end;
  if v_role = 'LEAD' and not (a.role = 'TEAM_MEMBER' and v_lead = v_me) then
    raise exception 'FORBIDDEN: You can give tasks to your own Team Members only.' using errcode = '42501';
  end if;
  if not private.ai_studio_on_project(p_project, a.id) then
    raise exception 'VALIDATION_ERROR: % is not on "%". Add them to the project first.', a.full_name, pr.name using errcode = 'P0001';
  end if;

  insert into public.ai_studio_tasks (project_id, title, description, priority, assigned_by, assignee_id, due_date, attachments)
  values (p_project, v_title, v_desc, v_priority, v_me, a.id, p_due, coalesce(private.ai_studio_links(p_links), '[]'::jsonb))
  returning * into t;
  select full_name into v_by from public.profiles where id = v_me;
  insert into public.ai_studio_task_updates (task_id, author_id, author_name, kind, status, progress, note)
  values (t.id, v_me, v_by, 'ASSIGNED', 'ASSIGNED', 0, null);
  perform private.write_audit('AI_STUDIO_TASK_ASSIGNED', 'ai_studio_task', t.id, a.department_id, a.team_id, jsonb_build_object('assignee', a.id, 'project', p_project, 'title', v_title));
  perform private.notify(a.id, 'AI_STUDIO_TASK_ASSIGNED', format('New task: %s', v_title),
    format('%s · assigned by %s%s', pr.name, v_by, case when p_due is null then '' else format(' · due %s', to_char(p_due, 'DD Mon')) end), 'ai_studio_task', t.id);
  -- the Department Head gave a Team Member work: their Team Lead is told as well
  if v_lead is not null and v_lead is distinct from v_me then
    perform private.notify(v_lead, 'AI_STUDIO_TASK_ASSIGNED_TEAM', format('%s got a task: %s', a.full_name, v_title), format('%s · assigned by %s', pr.name, v_by), 'ai_studio_task', t.id);
  end if;
  return private.ai_studio_task_row(t);
end $$;
revoke all on function public.ai_studio_task_assign(uuid, uuid, text, text, text, date, jsonb) from public, anon;
grant execute on function public.ai_studio_task_assign(uuid, uuid, text, text, text, date, jsonb) to authenticated;

-- Change a task's details or deadline (the person who gave it, the assignee's Team Lead, the Department Head, the Super Admin). The assignee is told of a new deadline.
create or replace function public.ai_studio_task_edit(p_task uuid, p_title text, p_description text, p_priority text, p_due date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  v_me uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_priority text := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'MEDIUM');
  t public.ai_studio_tasks;
  v_old date;
  v_by text;
begin
  select * into t from public.ai_studio_tasks where id = p_task for update;
  if t.id is null or not private.ai_studio_can_see_task(t) or (v_role = 'LEAD' and t.assignee_id = v_me) then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  if t.status = 'COMPLETED' then raise exception 'CONFLICT: A completed task cannot be changed.' using errcode = 'P0001'; end if;
  if length(v_title) < 1 or length(v_title) > 200 then raise exception 'VALIDATION_ERROR: Enter the task title (up to 200 characters).' using errcode = 'P0001'; end if;
  if v_desc is not null and length(v_desc) > 4000 then raise exception 'VALIDATION_ERROR: The description can have at most 4000 characters.' using errcode = 'P0001'; end if;
  if v_priority not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001'; end if;
  if p_due is not null and p_due is distinct from t.due_date and p_due < private.ai_studio_today() then
    raise exception 'VALIDATION_ERROR: The deadline cannot be in the past.' using errcode = 'P0001';
  end if;
  v_old := t.due_date;
  update public.ai_studio_tasks set title = v_title, description = v_desc, priority = v_priority, due_date = p_due where id = t.id returning * into t;
  select full_name into v_by from public.profiles where id = v_me;
  insert into public.ai_studio_task_updates (task_id, author_id, author_name, kind, status, progress, note)
  values (t.id, v_me, v_by, 'EDITED', t.status, t.progress,
          case when v_old is distinct from p_due then format('Deadline changed from %s to %s.', coalesce(to_char(v_old, 'DD Mon YYYY'), 'none'), coalesce(to_char(p_due, 'DD Mon YYYY'), 'none')) else 'Task details changed.' end);
  if v_old is distinct from p_due then
    perform private.notify(t.assignee_id, 'AI_STUDIO_TASK_DEADLINE', format('Deadline updated: %s', t.title),
      format('%s is now %s.', 'The deadline', coalesce(to_char(p_due, 'DD Mon YYYY'), 'not set')), 'ai_studio_task', t.id);
  end if;
  perform private.write_audit('AI_STUDIO_TASK_EDITED', 'ai_studio_task', t.id, private.ai_studio_department(), null, jsonb_build_object('dueFrom', v_old, 'dueTo', p_due));
  return private.ai_studio_task_row(t);
end $$;
revoke all on function public.ai_studio_task_edit(uuid, text, text, text, date) from public, anon;
grant execute on function public.ai_studio_task_edit(uuid, text, text, text, date) to authenticated;

-- The assignee reports progress: start, update the percentage, put on hold, or complete with completion details. Only the assignee can do this.
create or replace function public.ai_studio_task_update(p_task uuid, p_status text, p_progress integer, p_note text, p_links jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_progress integer := p_progress;
  t public.ai_studio_tasks;
  v_links jsonb;
  v_lead uuid;
  v_name text;
  v_done boolean;
begin
  perform private.ai_studio_require(array['LEAD', 'MEMBER']);
  select * into t from public.ai_studio_tasks where id = p_task for update;
  if t.id is null or t.assignee_id <> v_me then raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001'; end if;
  if t.status = 'COMPLETED' then raise exception 'CONFLICT: This task is already completed.' using errcode = 'P0001'; end if;
  if p_status not in ('IN_PROGRESS', 'ON_HOLD', 'COMPLETED') then
    raise exception 'VALIDATION_ERROR: Choose In progress, On hold or Completed.' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 2000 then raise exception 'VALIDATION_ERROR: The note can have at most 2000 characters.' using errcode = 'P0001'; end if;
  v_done := p_status = 'COMPLETED';
  if v_done then
    v_progress := 100;
    if v_note is null or length(v_note) < 3 then
      raise exception 'VALIDATION_ERROR: Describe what was completed before you complete the task.' using errcode = 'P0001';
    end if;
  else
    if v_progress is null or v_progress < 0 or v_progress > 99 then
      raise exception 'VALIDATION_ERROR: Progress must be between 0 and 99. Complete the task to reach 100.' using errcode = 'P0001';
    end if;
    if p_status = 'ON_HOLD' and v_note is null then
      raise exception 'VALIDATION_ERROR: Say why the task is on hold.' using errcode = 'P0001';
    end if;
  end if;
  v_links := private.ai_studio_links(p_links);
  update public.ai_studio_tasks
     set status = p_status, progress = v_progress,
         started_at = coalesce(started_at, now()),
         completed_at = case when v_done then now() else null end,
         completion_note = case when v_done then v_note else completion_note end,
         last_update_note = coalesce(v_note, last_update_note), last_update_at = now(),
         attachments = coalesce(v_links, attachments)
   where id = t.id returning * into t;
  select full_name into v_name from public.profiles where id = v_me;
  insert into public.ai_studio_task_updates (task_id, author_id, author_name, kind, status, progress, note) values (t.id, v_me, v_name, 'PROGRESS', t.status, t.progress, v_note);
  -- the person who gave the task and the assignee's Team Lead hear about it (each once, never the assignee)
  v_lead := private.direct_lead_of(t.assignee_id);
  perform private.notify(t.assigned_by, case when v_done then 'AI_STUDIO_TASK_COMPLETED' else 'AI_STUDIO_TASK_UPDATED' end,
    case when v_done then format('%s completed: %s', v_name, t.title) else format('%s updated: %s', v_name, t.title) end,
    format('%s · %s%% · %s', initcap(replace(lower(t.status), '_', ' ')), t.progress, t.title), 'ai_studio_task', t.id);
  if v_lead is not null and v_lead is distinct from t.assigned_by then
    perform private.notify(v_lead, case when v_done then 'AI_STUDIO_TASK_COMPLETED' else 'AI_STUDIO_TASK_UPDATED' end,
      case when v_done then format('%s completed: %s', v_name, t.title) else format('%s updated: %s', v_name, t.title) end,
      format('%s%%', t.progress), 'ai_studio_task', t.id);
  end if;
  return private.ai_studio_task_row(t);
end $$;
revoke all on function public.ai_studio_task_update(uuid, text, integer, text, jsonb) from public, anon;
grant execute on function public.ai_studio_task_update(uuid, text, integer, text, jsonb) to authenticated;

-- A page of tasks the caller may see.
--   p_scope: 'mine' (given to me), 'ongoing' (mine, started and not completed), 'team' (everything I may see: my Team Members' tasks for a Team Lead, all for the head)
--   p_status: one status, or 'OPEN' (not completed)
create or replace function public.ai_studio_tasks_list(
  p_scope text default 'mine', p_project uuid default null, p_status text default null, p_assignee uuid default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_items jsonb;
begin
  if p_scope not in ('mine', 'ongoing', 'team') then raise exception 'VALIDATION_ERROR: Unknown task list.' using errcode = 'P0001'; end if;
  if p_status is not null and p_status not in ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'OPEN') then raise exception 'VALIDATION_ERROR: Unknown task status.' using errcode = 'P0001'; end if;
  if p_scope = 'team' and v_role = 'MEMBER' then raise exception 'FORBIDDEN: Team tasks are for Team Leads and the Department Head.' using errcode = '42501'; end if;
  select count(*) into v_total from public.ai_studio_tasks t
   where private.ai_studio_can_see_task(t)
     and (p_scope = 'team' or t.assignee_id = v_me)
     and (p_scope <> 'ongoing' or t.status in ('IN_PROGRESS', 'ON_HOLD'))
     and (p_project is null or t.project_id = p_project)
     and (p_status is null or t.status = p_status or (p_status = 'OPEN' and t.status <> 'COMPLETED'))
     and (p_assignee is null or t.assignee_id = p_assignee);
  select coalesce(jsonb_agg(private.ai_studio_task_row(x) order by (x.status = 'COMPLETED'), x.due_date nulls last, x.created_at desc), '[]'::jsonb) into v_items
    from (select t.* from public.ai_studio_tasks t
           where private.ai_studio_can_see_task(t)
             and (p_scope = 'team' or t.assignee_id = v_me)
             and (p_scope <> 'ongoing' or t.status in ('IN_PROGRESS', 'ON_HOLD'))
             and (p_project is null or t.project_id = p_project)
             and (p_status is null or t.status = p_status or (p_status = 'OPEN' and t.status <> 'COMPLETED'))
             and (p_assignee is null or t.assignee_id = p_assignee)
           order by (t.status = 'COMPLETED'), t.due_date nulls last, t.created_at desc
           limit v_size offset (v_page - 1) * v_size) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.ai_studio_tasks_list(text, uuid, text, uuid, integer, integer) from public, anon;
grant execute on function public.ai_studio_tasks_list(text, uuid, text, uuid, integer, integer) to authenticated;

create or replace function public.ai_studio_task_get(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.ai_studio_tasks;
begin
  perform private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  select * into t from public.ai_studio_tasks where id = p_task;
  if t.id is null or not private.ai_studio_can_see_task(t) then raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001'; end if;
  return private.ai_studio_task_row(t) || jsonb_build_object(
    'canUpdate', t.assignee_id = auth.uid() and t.status <> 'COMPLETED',
    'canEdit', t.status <> 'COMPLETED' and private.ai_studio_role() in ('ADMIN', 'HEAD', 'LEAD') and t.assignee_id <> auth.uid(),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'status', u.status, 'progress', u.progress, 'note', u.note,
                                                               'authorName', u.author_name, 'createdAt', u.created_at) order by u.seq desc)
                           from public.ai_studio_task_updates u where u.task_id = t.id), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_task_get(uuid) from public, anon;
grant execute on function public.ai_studio_task_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Daily reports
-- ---------------------------------------------------------------------------
-- What the report form needs: my projects, my tasks and the Team Lead my report goes to
create or replace function public.ai_studio_report_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_lead uuid := case when private.ai_studio_role() = 'MEMBER' then private.direct_lead_of(auth.uid()) end;
begin
  return jsonb_build_object(
    'role', v_role,
    'today', private.ai_studio_today(),
    'reviewer', case when v_role = 'MEMBER' then (select l.full_name from public.profiles l where l.id = v_lead)
                     else (select string_agg(h.full_name, ', ' order by h.full_name) from public.profiles h where h.id in (select private.ai_studio_head_ids())) end,
    'hasReviewer', case when v_role = 'MEMBER' then v_lead is not null else exists (select 1 from private.ai_studio_head_ids()) end,
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.name)
                            from public.ai_studio_project_members m join public.ai_studio_projects pr on pr.id = m.project_id
                           where m.profile_id = v_me and pr.status <> 'ARCHIVED'), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'projectId', t.project_id, 'title', t.title, 'status', t.status) order by t.due_date nulls last, t.created_at desc)
                         from public.ai_studio_tasks t
                        where t.assignee_id = v_me and (t.status <> 'COMPLETED' or t.completed_at > now() - interval '14 days')), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_report_context() from public, anon;
grant execute on function public.ai_studio_report_context() to authenticated;

create or replace function private.ai_studio_report_row(r public.ai_studio_daily_reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'authorId', r.author_id, 'authorName', r.author_name, 'authorRole', r.author_role,
    'projectId', r.project_id, 'projectName', pr.name, 'taskId', r.task_id, 'taskTitle', k.title,
    'reportDate', r.report_date, 'status', r.status, 'revision', r.revision,
    'leadId', private.ai_studio_report_lead(r), 'leadName', (select l.full_name from public.profiles l where l.id = private.ai_studio_report_lead(r)),
    'submittedAt', r.submitted_at, 'approvedAt', r.approved_at, 'updatedAt', r.updated_at)
    from public.ai_studio_projects pr left join public.ai_studio_tasks k on k.id = r.task_id where pr.id = r.project_id
$$;
revoke all on function private.ai_studio_report_row(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_row(public.ai_studio_daily_reports) to authenticated, service_role;

-- may the caller read this report? the author (drafts too), the report's Team Lead, the Department Head and the Super Admin (never a draft)
create or replace function private.ai_studio_can_see_report(r public.ai_studio_daily_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(r.author_id = auth.uid()
      or (r.status <> 'DRAFT' and (private.ai_studio_role() in ('ADMIN', 'HEAD') or private.ai_studio_report_lead(r) = auth.uid())), false)
$$;
revoke all on function private.ai_studio_can_see_report(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_can_see_report(public.ai_studio_daily_reports) to authenticated, service_role;

-- Can the caller decide this report right now? (the same rule the review function applies)
create or replace function private.ai_studio_can_review(r public.ai_studio_daily_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(r.author_id is distinct from auth.uid() and case
    when r.status = 'PENDING_TL_APPROVAL' then private.ai_studio_role() = 'LEAD' and private.ai_studio_report_lead(r) = auth.uid()
    when r.status = 'PENDING_DH_APPROVAL' then private.ai_studio_role() = 'HEAD'
    else false end, false)
$$;
revoke all on function private.ai_studio_can_review(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_can_review(public.ai_studio_daily_reports) to authenticated, service_role;

create or replace function private.ai_studio_report_detail(r public.ai_studio_daily_reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.ai_studio_report_row(r) || jsonb_build_object(
    'workCompleted', r.work_completed, 'workInProgress', r.work_in_progress, 'pendingWork', r.pending_work, 'blockers', r.blockers, 'remarks', r.remarks,
    'tlComment', r.tl_comment, 'tlReviewedAt', r.tl_reviewed_at, 'tlReviewerName', (select p.full_name from public.profiles p where p.id = r.tl_reviewed_by),
    'dhComment', r.dh_comment, 'dhReviewedAt', r.dh_reviewed_at, 'dhReviewerName', (select p.full_name from public.profiles p where p.id = r.dh_reviewed_by),
    'canEdit', r.author_id = auth.uid() and r.status in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH'),
    'canReview', private.ai_studio_can_review(r),
    'reviewStage', case when r.status = 'PENDING_TL_APPROVAL' then 'TEAM_LEAD' when r.status = 'PENDING_DH_APPROVAL' then 'DEPARTMENT_HEAD' end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'stage', e.stage, 'fromStatus', e.from_status, 'toStatus', e.to_status,
                                                               'comment', e.comment, 'actorName', e.actor_name, 'actorRole', e.actor_role, 'revision', e.revision,
                                                               'createdAt', e.created_at) order by e.seq)
                           from public.ai_studio_report_events e where e.report_id = r.id), '[]'::jsonb))
$$;
revoke all on function private.ai_studio_report_detail(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_detail(public.ai_studio_daily_reports) to authenticated, service_role;

-- Create (p_id null) or change my own report, and optionally submit it. A new report is a draft until it is submitted. A returned report is edited and
-- submitted again; it then starts the approval chain again from the beginning (the earlier rounds stay in the history).
create or replace function public.ai_studio_report_save(
  p_id uuid, p_project uuid, p_task uuid, p_date date, p_work_completed text, p_work_in_progress text, p_pending_work text, p_blockers text, p_remarks text, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_completed text := nullif(btrim(coalesce(p_work_completed, '')), '');
  v_progress text := nullif(btrim(coalesce(p_work_in_progress, '')), '');
  v_pending text := nullif(btrim(coalesce(p_pending_work, '')), '');
  v_blockers text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  me public.profiles;
  pr public.ai_studio_projects;
  tk public.ai_studio_tasks;
  r public.ai_studio_daily_reports;
  v_lead uuid;
  v_from text;
  v_action text;
begin
  select * into me from public.profiles where id = v_me;
  if p_date is null then raise exception 'VALIDATION_ERROR: Choose the report date.' using errcode = 'P0001'; end if;
  if p_date > private.ai_studio_today() then raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001'; end if;
  if p_date < private.ai_studio_today() - 60 then raise exception 'VALIDATION_ERROR: A report can be written for the last 60 days only.' using errcode = 'P0001'; end if;
  if greatest(length(coalesce(v_completed, '')), length(coalesce(v_progress, '')), length(coalesce(v_pending, '')), length(coalesce(v_blockers, '')), length(coalesce(v_remarks, ''))) > 4000 then
    raise exception 'VALIDATION_ERROR: Each part of the report can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  select * into pr from public.ai_studio_projects where id = p_project;
  if pr.id is null or pr.status = 'ARCHIVED' or not private.ai_studio_on_project(p_project, v_me) then
    raise exception 'VALIDATION_ERROR: Choose one of your projects.' using errcode = 'P0001';
  end if;
  if p_task is not null then
    select * into tk from public.ai_studio_tasks where id = p_task;
    if tk.id is null or tk.assignee_id <> v_me or tk.project_id <> p_project then
      raise exception 'VALIDATION_ERROR: Choose a task that was assigned to you in this project.' using errcode = 'P0001';
    end if;
  end if;
  if p_submit and v_completed is null then
    raise exception 'VALIDATION_ERROR: Describe the work completed today before you submit.' using errcode = 'P0001';
  end if;

  if p_id is null then
    if exists (select 1 from public.ai_studio_daily_reports x where x.author_id = v_me and x.report_date = p_date and x.project_id = p_project
                  and coalesce(x.task_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_task, '00000000-0000-0000-0000-000000000000'::uuid)) then
      raise exception 'CONFLICT: You already have a report for this project, task and date. Open it from My Daily Reports.' using errcode = 'P0001';
    end if;
    begin
      insert into public.ai_studio_daily_reports (author_id, author_name, author_role, project_id, task_id, report_date, work_completed, work_in_progress, pending_work, blockers, remarks, status)
      values (v_me, me.full_name, v_role, p_project, p_task, p_date, v_completed, v_progress, v_pending, v_blockers, v_remarks, 'DRAFT') returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a report for this project, task and date. Open it from My Daily Reports.' using errcode = 'P0001';
    end;
    perform private.ai_studio_event(r, 'CREATED', null, null, null);
    v_from := 'DRAFT';
  else
    select * into r from public.ai_studio_daily_reports where id = p_id for update;
    if r.id is null or r.author_id <> v_me then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
    if r.status not in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH') then
      raise exception 'CONFLICT: This report was already submitted and can no longer be changed.' using errcode = 'P0001';
    end if;
    begin
      update public.ai_studio_daily_reports
         set project_id = p_project, task_id = p_task, report_date = p_date, work_completed = v_completed, work_in_progress = v_progress,
             pending_work = v_pending, blockers = v_blockers, remarks = v_remarks
       where id = r.id returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a report for this project, task and date. Open it from My Daily Reports.' using errcode = 'P0001';
    end;
    v_from := r.status;
  end if;

  if p_submit then
    if v_role = 'MEMBER' then
      v_lead := private.direct_lead_of(v_me);
      if v_lead is null then
        raise exception 'VALIDATION_ERROR: You are not assigned to a Team Lead yet. Ask your Department Head.' using errcode = 'P0001';
      end if;
    end if;
    v_action := case when v_from in ('RETURNED_BY_TL', 'RETURNED_BY_DH') then 'RESUBMITTED' else 'SUBMITTED' end;
    update public.ai_studio_daily_reports
       set status = case when v_role = 'MEMBER' then 'PENDING_TL_APPROVAL' else 'PENDING_DH_APPROVAL' end,
           lead_id = v_lead, lead_name = (select l.full_name from public.profiles l where l.id = v_lead),
           revision = case when v_action = 'RESUBMITTED' then revision + 1 else revision end,
           tl_reviewed_by = null, tl_reviewed_at = null, tl_comment = null, dh_reviewed_by = null, dh_reviewed_at = null, dh_comment = null,
           submitted_at = now(), approved_at = null
     where id = r.id returning * into r;
    perform private.ai_studio_event(r, v_action, null, v_from, null);
    perform private.write_audit('AI_STUDIO_REPORT_' || v_action, 'ai_studio_report', r.id, me.department_id, me.team_id, jsonb_build_object('date', r.report_date, 'revision', r.revision));
    if v_role = 'MEMBER' then
      perform private.notify(v_lead, 'AI_STUDIO_REPORT_SUBMITTED', format('Daily report to review: %s', me.full_name),
        format('%s · %s%s', pr.name, to_char(r.report_date, 'DD Mon YYYY'), case when v_action = 'RESUBMITTED' then ' · resubmitted' else '' end), 'ai_studio_report', r.id);
    else
      perform private.notify(h, 'AI_STUDIO_REPORT_PENDING_HEAD', format('Daily report to review: %s', me.full_name),
        format('Team Lead · %s · %s', pr.name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id) from private.ai_studio_head_ids() h;
    end if;
  end if;
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_report_save(uuid, uuid, uuid, date, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.ai_studio_report_save(uuid, uuid, uuid, date, text, text, text, text, text, boolean) to authenticated;

-- Only an unsent draft can be deleted, and only by its author
create or replace function public.ai_studio_report_delete_draft(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ai_studio_require(array['LEAD', 'MEMBER']);
  delete from public.ai_studio_daily_reports where id = p_id and author_id = auth.uid() and status = 'DRAFT';
  if not found then raise exception 'NOT_FOUND: Draft not found.' using errcode = 'P0001'; end if;
end $$;
revoke all on function public.ai_studio_report_delete_draft(uuid) from public, anon;
grant execute on function public.ai_studio_report_delete_draft(uuid) to authenticated;

-- A decision on a report that waits for the caller: the report's Team Lead (stage 1) or the Department Head (stage 2). Nobody decides their own report.
create or replace function public.ai_studio_report_review(p_report uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'HEAD']);
  v_me uuid := auth.uid();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  r public.ai_studio_daily_reports;
  v_from text;
  v_stage text;
  v_name text;
  pr_name text;
begin
  if p_decision not in ('APPROVE', 'RETURN') then raise exception 'VALIDATION_ERROR: Choose Approve or Return.' using errcode = 'P0001'; end if;
  if v_comment is not null and length(v_comment) > 2000 then raise exception 'VALIDATION_ERROR: The remarks can have at most 2000 characters.' using errcode = 'P0001'; end if;
  if p_decision = 'RETURN' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write the remarks the employee should act on.' using errcode = 'P0001';
  end if;
  select * into r from public.ai_studio_daily_reports where id = p_report for update;
  if r.id is null or not private.ai_studio_can_see_report(r) then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
  if r.author_id = v_me then raise exception 'FORBIDDEN: You cannot decide your own report.' using errcode = '42501'; end if;
  if not private.ai_studio_can_review(r) then
    raise exception 'CONFLICT: This report is not waiting for your decision.' using errcode = 'P0001';
  end if;
  v_from := r.status;
  select full_name into v_name from public.profiles where id = v_me;
  select name into pr_name from public.ai_studio_projects where id = r.project_id;

  if v_from = 'PENDING_TL_APPROVAL' then
    v_stage := 'TEAM_LEAD';
    update public.ai_studio_daily_reports
       set status = case when p_decision = 'APPROVE' then 'PENDING_DH_APPROVAL' else 'RETURNED_BY_TL' end,
           lead_id = v_me, lead_name = v_name, tl_reviewed_by = v_me, tl_reviewed_at = now(), tl_comment = v_comment
     where id = r.id returning * into r;
  else
    v_stage := 'DEPARTMENT_HEAD';
    update public.ai_studio_daily_reports
       set status = case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED_BY_DH' end,
           dh_reviewed_by = v_me, dh_reviewed_at = now(), dh_comment = v_comment,
           approved_at = case when p_decision = 'APPROVE' then now() else null end
     where id = r.id returning * into r;
  end if;
  perform private.ai_studio_event(r, case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED' end, v_stage, v_from, v_comment);
  perform private.write_audit('AI_STUDIO_REPORT_' || case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED' end, 'ai_studio_report', r.id,
                              private.ai_studio_department(), null, jsonb_build_object('stage', v_stage, 'from', v_from, 'to', r.status, 'author', r.author_id));

  if v_stage = 'TEAM_LEAD' and p_decision = 'APPROVE' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_TL_APPROVED', 'Your daily report was approved by your Team Lead',
      format('%s · %s. It now waits for the Department Head.', pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
    perform private.notify(h, 'AI_STUDIO_REPORT_PENDING_HEAD', format('Daily report to review: %s', r.author_name),
      format('Approved by %s · %s · %s', v_name, pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id) from private.ai_studio_head_ids() h;
  elsif v_stage = 'TEAM_LEAD' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_RETURNED', 'Your Team Lead returned your daily report',
      format('%s · %s: %s', pr_name, to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
  elsif p_decision = 'APPROVE' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_APPROVED', 'Your daily report was approved',
      format('%s · %s. Final approval by the Department Head.', pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
    if r.lead_id is not null then
      perform private.notify(r.lead_id, 'AI_STUDIO_REPORT_APPROVED', format('%s''s daily report was approved', r.author_name),
        format('%s · %s · final approval by the Department Head.', pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
    end if;
  else
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_RETURNED', 'The Department Head returned your daily report',
      format('%s · %s: %s', pr_name, to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
    if r.lead_id is not null then
      perform private.notify(r.lead_id, 'AI_STUDIO_REPORT_RETURNED', format('%s''s daily report was returned by the Department Head', r.author_name),
        format('%s · %s: %s', pr_name, to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
    end if;
  end if;
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_report_review(uuid, text, text) from public, anon;
grant execute on function public.ai_studio_report_review(uuid, text, text) to authenticated;

create or replace function public.ai_studio_report_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.ai_studio_daily_reports;
begin
  perform private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  select * into r from public.ai_studio_daily_reports where id = p_id;
  if r.id is null or not private.ai_studio_can_see_report(r) then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_report_get(uuid) from public, anon;
grant execute on function public.ai_studio_report_get(uuid) to authenticated;

-- A page of reports.
--   p_view: 'mine' (my own, drafts included), 'team' (my Team Members' submitted reports: Team Lead), 'department' (every submitted report: Department Head, Super Admin)
-- The counts per status ignore the status filter, so the tabs can show them.
create or replace function public.ai_studio_reports_list(
  p_view text default 'mine', p_project uuid default null, p_status text default null, p_lead uuid default null, p_author uuid default null,
  p_from date default null, p_to date default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_items jsonb;
  v_counts jsonb;
begin
  if p_view not in ('mine', 'team', 'department') then raise exception 'VALIDATION_ERROR: Unknown report list.' using errcode = 'P0001'; end if;
  if p_view = 'mine' and v_role in ('ADMIN', 'HEAD') then raise exception 'FORBIDDEN: You do not write daily reports.' using errcode = '42501'; end if;
  if p_view = 'team' and v_role <> 'LEAD' then raise exception 'FORBIDDEN: Team reports are for Team Leads.' using errcode = '42501'; end if;
  if p_view = 'department' and v_role not in ('ADMIN', 'HEAD') then raise exception 'FORBIDDEN: Department reports are for the Department Head.' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('DRAFT', 'SUBMITTED', 'PENDING_TL_APPROVAL', 'RETURNED_BY_TL', 'PENDING_DH_APPROVAL', 'RETURNED_BY_DH', 'APPROVED') then
    raise exception 'VALIDATION_ERROR: Unknown report status.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) into v_counts
    from (select r.status, count(*) as n from public.ai_studio_daily_reports r
           where (case p_view when 'mine' then r.author_id = v_me
                              when 'team' then r.author_role = 'MEMBER' and r.status <> 'DRAFT' and private.ai_studio_report_lead(r) = v_me
                              else r.status <> 'DRAFT' end)
             and (p_project is null or r.project_id = p_project)
             and (p_lead is null or r.lead_id = p_lead or r.author_id = p_lead)
             and (p_author is null or r.author_id = p_author)
             and (p_from is null or r.report_date >= p_from) and (p_to is null or r.report_date <= p_to)
           group by r.status) s;
  select count(*) into v_total from public.ai_studio_daily_reports r
   where (case p_view when 'mine' then r.author_id = v_me
                      when 'team' then r.author_role = 'MEMBER' and r.status <> 'DRAFT' and private.ai_studio_report_lead(r) = v_me
                      else r.status <> 'DRAFT' end)
     and (p_project is null or r.project_id = p_project) and (p_status is null or r.status = p_status)
     and (p_lead is null or r.lead_id = p_lead or r.author_id = p_lead) and (p_author is null or r.author_id = p_author)
     and (p_from is null or r.report_date >= p_from) and (p_to is null or r.report_date <= p_to);
  select coalesce(jsonb_agg(private.ai_studio_report_row(x) order by x.report_date desc, x.updated_at desc, x.id), '[]'::jsonb) into v_items
    from (select r.* from public.ai_studio_daily_reports r
           where (case p_view when 'mine' then r.author_id = v_me
                              when 'team' then r.author_role = 'MEMBER' and r.status <> 'DRAFT' and private.ai_studio_report_lead(r) = v_me
                              else r.status <> 'DRAFT' end)
             and (p_project is null or r.project_id = p_project) and (p_status is null or r.status = p_status)
             and (p_lead is null or r.lead_id = p_lead or r.author_id = p_lead) and (p_author is null or r.author_id = p_author)
             and (p_from is null or r.report_date >= p_from) and (p_to is null or r.report_date <= p_to)
           order by r.report_date desc, r.updated_at desc, r.id
           limit v_size offset (v_page - 1) * v_size) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size, 'counts', v_counts);
end $$;
revoke all on function public.ai_studio_reports_list(text, uuid, text, uuid, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.ai_studio_reports_list(text, uuid, text, uuid, uuid, date, date, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Overview (every number is counted from the records)
-- ---------------------------------------------------------------------------
-- "Pending" = not started yet (Assigned) or On hold; "Ongoing" = In progress; the three together with Completed are all the tasks.
create or replace function public.ai_studio_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_dept uuid := private.ai_studio_department();
  v_today date := private.ai_studio_today();
  v_out jsonb := jsonb_build_object('role', v_role, 'today', v_today);
begin
  -- my own work (a Team Lead and a Team Member)
  if v_role in ('LEAD', 'MEMBER') then
    v_out := v_out || jsonb_build_object(
      'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'status', pr.status,
                       'tasks', (select count(*) from public.ai_studio_tasks t where t.project_id = pr.id and t.assignee_id = v_me),
                       'completed', (select count(*) from public.ai_studio_tasks t where t.project_id = pr.id and t.assignee_id = v_me and t.status = 'COMPLETED')) order by pr.name)
                    from public.ai_studio_project_members m join public.ai_studio_projects pr on pr.id = m.project_id where m.profile_id = v_me), '[]'::jsonb),
      'myTasks', (select jsonb_build_object('total', count(*), 'assigned', count(*), 'ongoing', count(*) filter (where t.status = 'IN_PROGRESS'),
                          'completed', count(*) filter (where t.status = 'COMPLETED'), 'pending', count(*) filter (where t.status in ('ASSIGNED', 'ON_HOLD')),
                          'overdue', count(*) filter (where t.status <> 'COMPLETED' and t.due_date < v_today))
                    from public.ai_studio_tasks t where t.assignee_id = v_me),
      'upcoming', coalesce((select jsonb_agg(private.ai_studio_task_row(x) order by x.due_date, x.created_at)
                              from (select t.* from public.ai_studio_tasks t where t.assignee_id = v_me and t.status <> 'COMPLETED' and t.due_date is not null
                                       and t.due_date <= v_today + 14 order by t.due_date, t.created_at limit 8) x), '[]'::jsonb),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('kind', y.kind, 'text', y.text, 'at', y.at, 'entityType', y.entity_type, 'entityId', y.entity_id) order by y.at desc)
                            from (select * from (
                                    select 'TASK' as kind, format('%s · %s · %s%% (%s)', t.title, initcap(replace(lower(u.status), '_', ' ')), u.progress, coalesce(u.author_name, 'Someone')) as text, u.created_at as at, 'ai_studio_task' as entity_type, t.id as entity_id
                                      from public.ai_studio_task_updates u join public.ai_studio_tasks t on t.id = u.task_id where t.assignee_id = v_me
                                    union all
                                    select 'REPORT', format('Daily report %s · %s (%s)', to_char(r.report_date, 'DD Mon'), lower(replace(e.to_status, '_', ' ')), coalesce(e.actor_name, 'Someone')), e.created_at, 'ai_studio_report', r.id
                                      from public.ai_studio_report_events e join public.ai_studio_daily_reports r on r.id = e.report_id where r.author_id = v_me
                                  ) z order by z.at desc limit 10) y), '[]'::jsonb),
      'dailyReport', jsonb_build_object(
        'todayStatus', (select r.status from public.ai_studio_daily_reports r where r.author_id = v_me and r.report_date = v_today order by r.updated_at desc limit 1),
        'todayCount', (select count(*) from public.ai_studio_daily_reports r where r.author_id = v_me and r.report_date = v_today and r.status <> 'DRAFT'),
        'returned', (select count(*) from public.ai_studio_daily_reports r where r.author_id = v_me and r.status in ('RETURNED_BY_TL', 'RETURNED_BY_DH')),
        'pendingApproval', (select count(*) from public.ai_studio_daily_reports r where r.author_id = v_me and r.status in ('PENDING_TL_APPROVAL', 'PENDING_DH_APPROVAL')),
        'approved', (select count(*) from public.ai_studio_daily_reports r where r.author_id = v_me and r.status = 'APPROVED')));
  end if;

  -- a Team Lead also sees their team
  if v_role = 'LEAD' then
    v_out := v_out || jsonb_build_object('team', jsonb_build_object(
      'members', (select count(*) from public.profiles p where p.department_id = v_dept and p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.direct_lead_of(p.id) = v_me),
      'tasks', (select jsonb_build_object('total', count(*), 'ongoing', count(*) filter (where t.status = 'IN_PROGRESS'), 'completed', count(*) filter (where t.status = 'COMPLETED'),
                         'pending', count(*) filter (where t.status in ('ASSIGNED', 'ON_HOLD')), 'overdue', count(*) filter (where t.status <> 'COMPLETED' and t.due_date < v_today))
                  from public.ai_studio_tasks t where t.assignee_id <> v_me and private.ai_studio_can_see_task(t)),
      'reportsToReview', (select count(*) from public.ai_studio_daily_reports r where r.status = 'PENDING_TL_APPROVAL' and private.ai_studio_report_lead(r) = v_me),
      'reportsToday', (select count(*) from public.ai_studio_daily_reports r where r.report_date = v_today and r.status <> 'DRAFT' and r.author_role = 'MEMBER' and private.ai_studio_report_lead(r) = v_me)));
  end if;

  -- the Department Head and the Super Admin see the whole department
  if v_role in ('ADMIN', 'HEAD') then
    v_out := v_out || jsonb_build_object('department', jsonb_build_object(
      'employees', (select count(*) from public.profiles p where p.department_id = v_dept and p.status = 'ACTIVE'),
      'leads', (select count(*) from public.profiles p where p.department_id = v_dept and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'),
      'members', (select count(*) from public.profiles p where p.department_id = v_dept and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER'),
      'unassignedMembers', (select count(*) from public.profiles p where p.department_id = v_dept and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and private.direct_lead_of(p.id) is null),
      'activeProjects', (select count(*) from public.ai_studio_projects where status = 'ACTIVE'),
      'tasks', (select jsonb_build_object('assigned', count(*), 'ongoing', count(*) filter (where status = 'IN_PROGRESS'), 'completed', count(*) filter (where status = 'COMPLETED'),
                         'pending', count(*) filter (where status in ('ASSIGNED', 'ON_HOLD')), 'overdue', count(*) filter (where status <> 'COMPLETED' and due_date < v_today))
                  from public.ai_studio_tasks),
      'reportsAwaitingHead', (select count(*) from public.ai_studio_daily_reports where status = 'PENDING_DH_APPROVAL'),
      'reportsAwaitingLead', (select count(*) from public.ai_studio_daily_reports where status = 'PENDING_TL_APPROVAL'),
      'reportsApproved', (select count(*) from public.ai_studio_daily_reports where status = 'APPROVED'),
      'reportsToday', (select count(*) from public.ai_studio_daily_reports where report_date = v_today and status <> 'DRAFT'),
      'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'status', pr.status,
                       'total', (select count(*) from public.ai_studio_tasks t where t.project_id = pr.id),
                       'completed', (select count(*) from public.ai_studio_tasks t where t.project_id = pr.id and t.status = 'COMPLETED'),
                       'ongoing', (select count(*) from public.ai_studio_tasks t where t.project_id = pr.id and t.status = 'IN_PROGRESS'),
                       'progress', (select coalesce(round(avg(t.progress)), 0) from public.ai_studio_tasks t where t.project_id = pr.id),
                       'leads', coalesce((select jsonb_agg(l.full_name order by l.full_name) from public.ai_studio_project_members m join public.profiles l on l.id = m.profile_id
                                           where m.project_id = pr.id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE'), '[]'::jsonb)) order by (pr.status = 'ARCHIVED'), pr.name)
                              from public.ai_studio_projects pr), '[]'::jsonb)));
  end if;
  return v_out;
end $$;
revoke all on function public.ai_studio_overview() from public, anon;
grant execute on function public.ai_studio_overview() to authenticated;

notify pgrst, 'reload schema';
