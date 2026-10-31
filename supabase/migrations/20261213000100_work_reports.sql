-- =============================================================================
-- Hierarchical work reports.
--
--   Team Member -> Team Lead -> Department Head -> Operations Head
--
--  * Everyone below the Operations Head writes an individual report (saved as a draft, then submitted).
--  * A Team Member's report goes to their Team Lead, who approves it, rejects it or asks for a revision.
--  * A Team Lead's own report goes to their Department Head (never through the Team Lead approval).
--  * A Department Head's own report goes to the Operations Head who manages the department.
--  * The Department Head forwards a consolidated "package" for a period. The package holds no copy of any report: the boxes are built
--    from the individual reports by relationships (department -> Team Lead -> team members), so every report keeps its own identity.
--
-- Individual reports are separate rows. Nobody reads or writes the tables directly: every call is a security definer function that
-- works out who the caller is and what the hierarchy allows. Nothing is deleted. Safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.work_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('MEMBER', 'TEAM_LEAD', 'DEPARTMENT_HEAD')),
  author_id uuid references public.profiles (id) on delete set null,
  -- who wrote it, as it was when written (the person may be renamed or removed later)
  author_name text not null,
  author_designation text,
  -- the real (base) department and, for members and Team Leads, the team at the time
  department_id uuid not null references public.departments (id) on delete restrict,
  team_id uuid references public.teams (id) on delete set null,
  title text not null check (length(btrim(title)) between 3 and 200),
  report_date date not null,
  period_type text not null default 'DAILY' check (period_type in ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM')),
  period_start date not null,
  period_end date not null,
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED')),
  revision integer not null default 1 check (revision >= 1),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_comment text check (length(review_comment) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_reports_period_check check (period_end >= period_start and period_end - period_start <= 366)
);
create index if not exists work_reports_author_idx on public.work_reports (author_id, period_end desc);
create index if not exists work_reports_team_idx on public.work_reports (team_id, kind, status, period_end desc);
create index if not exists work_reports_department_idx on public.work_reports (department_id, kind, status, period_end desc);

-- every step of a report, for the history (nothing is overwritten)
create table if not exists public.work_report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.work_reports (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text not null,
  action text not null check (action in ('CREATED', 'SUBMITTED', 'RESUBMITTED', 'OPENED', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED')),
  from_status text,
  to_status text,
  comment text check (length(comment) <= 2000),
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists work_report_events_report_idx on public.work_report_events (report_id, id);

-- the consolidated department package a Department Head forwards for a period (a pointer, not a copy)
create table if not exists public.work_report_packages (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  period_type text not null default 'WEEKLY' check (period_type in ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM')),
  period_start date not null,
  period_end date not null,
  note text check (length(note) <= 4000),
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_by_name text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_report_packages_period_check check (period_end >= period_start and period_end - period_start <= 366),
  unique (department_id, period_start, period_end)
);

alter table public.work_reports enable row level security;
alter table public.work_report_events enable row level security;
alter table public.work_report_packages enable row level security;
revoke all on public.work_reports, public.work_report_events, public.work_report_packages from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who is who
-- ---------------------------------------------------------------------------
-- MEMBER / TEAM_LEAD / DEPARTMENT_HEAD / OPERATIONS_HEAD / SUPER_ADMIN, or null (not a person who reports).
create or replace function private.report_level()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.role = 'SUPER_ADMIN' then 'SUPER_ADMIN'
    when p.role = 'DEPARTMENT_HEAD' and p.is_operations_head then 'OPERATIONS_HEAD'
    when p.role = 'DEPARTMENT_HEAD' then 'DEPARTMENT_HEAD'
    when p.role = 'TEAM_HEAD' then 'TEAM_LEAD'
    when p.role = 'TEAM_MEMBER' then 'MEMBER' end
  from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'
$$;
revoke all on function private.report_level() from public, anon;
grant execute on function private.report_level() to authenticated;

-- The kind of report a role writes.
create or replace function private.report_kind_of(p_level text)
returns text language sql immutable set search_path = '' as $$
  select case p_level when 'MEMBER' then 'MEMBER' when 'TEAM_LEAD' then 'TEAM_LEAD' when 'DEPARTMENT_HEAD' then 'DEPARTMENT_HEAD' end
$$;
revoke all on function private.report_kind_of(text) from public, anon, authenticated;

-- The departments the caller reports about at the top: the Super Admin sees every real department, an Operations Head the ones they are the accountable owner of.
create or replace function private.report_scope_departments()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select d.id from public.departments d where d.facet_of is null and private.report_level() = 'SUPER_ADMIN'
  union
  select d.id from public.departments d where d.facet_of is null and private.report_level() = 'OPERATIONS_HEAD' and private.owner_of_department(d.id) = auth.uid()
$$;
revoke all on function private.report_scope_departments() from public, anon, authenticated;

-- Does this (active) Department Head cover this department and, when the head looks after one side only, this team's side?
create or replace function private.head_covers(p_head uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles h
     where h.id = p_head and h.status = 'ACTIVE' and h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head
       and private.base_department(h.department_id) = p_department
       and (h.head_division is null or p_team is null
            or coalesce((select t.division::text from public.teams t where t.id = p_team), 'GENERAL') in ('GENERAL', h.head_division)))
$$;
revoke all on function private.head_covers(uuid, uuid, uuid) from public, anon, authenticated;

-- Who reviews a report of this kind: the Team Lead of the team, the Department Head of the department (and side), the Operations Head who manages the department.
create or replace function private.report_reviewer_ids(p_kind text, p_department uuid, p_team uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
   where p.status = 'ACTIVE' and (
        (p_kind = 'MEMBER' and p.role = 'TEAM_HEAD' and p.team_id is not null and p.team_id = p_team)
     or (p_kind = 'TEAM_LEAD' and private.head_covers(p.id, p_department, p_team))
     or (p_kind = 'DEPARTMENT_HEAD' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head
         and private.owner_of_department(p_department) = p.id))
$$;
revoke all on function private.report_reviewer_ids(text, uuid, uuid) from public, anon, authenticated;

create or replace function private.is_report_reviewer(r public.work_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.author_id is distinct from auth.uid()
     and (private.report_level() = 'SUPER_ADMIN'
          or exists (select 1 from private.report_reviewer_ids(r.kind, r.department_id, r.team_id) x where x = auth.uid()))
$$;
revoke all on function private.is_report_reviewer(public.work_reports) from public, anon, authenticated;

-- Who may read a report:
--   the author; the Super Admin; the reviewer (any report that was submitted);
--   a Department Head (of that department and side): Team Lead reports that were submitted and Team Member reports their Team Lead APPROVED;
--   an Operations Head of the department: every submitted report of the department's chain (Team Member reports only once approved).
create or replace function private.can_view_report(r public.work_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.author_id = auth.uid()
      or private.report_level() = 'SUPER_ADMIN'
      or (r.status <> 'DRAFT' and (
            private.is_report_reviewer(r)
         or (r.kind = 'MEMBER' and r.status = 'APPROVED' and private.head_covers(auth.uid(), r.department_id, r.team_id))
         or (r.kind = 'TEAM_LEAD' and private.head_covers(auth.uid(), r.department_id, r.team_id))
         or (private.report_level() = 'OPERATIONS_HEAD' and r.department_id in (select private.report_scope_departments())
             and (r.kind <> 'MEMBER' or r.status = 'APPROVED'))))
$$;
revoke all on function private.can_view_report(public.work_reports) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Report content
-- ---------------------------------------------------------------------------
-- The fields each kind of report has (anything else sent is dropped); every field is text of at most 5000 characters.
create or replace function private.clean_report_content(p_kind text, p_content jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_keys text[] := case p_kind
    when 'MEMBER' then array['tasksAssigned', 'tasksCompleted', 'workCompleted', 'todayActivities', 'pendingTasks', 'challenges', 'achievements', 'remarks']
    when 'TEAM_LEAD' then array['workCompleted', 'tasksHandled', 'teamCoordination', 'targetProgress', 'challenges', 'pendingActivities', 'achievements', 'nextPlans', 'remarks']
    else array['departmentOverview', 'achievements', 'workCompleted', 'teamLeadPerformance', 'targets', 'pendingActivities', 'challenges', 'resourceRequirements', 'nextPlans', 'remarks'] end;
  v_out jsonb := '{}'::jsonb;
  k text;
  v text;
  a jsonb;
  v_att jsonb := '[]'::jsonb;
  n int := 0;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    return '{}'::jsonb;
  end if;
  foreach k in array v_keys loop
    v := nullif(btrim(coalesce(p_content ->> k, '')), '');
    if v is not null then
      if length(v) > 5000 then
        raise exception 'VALIDATION_ERROR: Keep each section under 5000 characters.' using errcode = 'P0001';
      end if;
      v_out := v_out || jsonb_build_object(k, v);
    end if;
  end loop;
  -- supporting attachments: links to the files (a shared folder, a document, a screenshot), at most 5
  if jsonb_typeof(p_content -> 'attachments') = 'array' then
    for a in select * from jsonb_array_elements(p_content -> 'attachments') loop
      exit when n >= 5;
      continue when jsonb_typeof(a) <> 'object';
      v := nullif(btrim(coalesce(a ->> 'url', '')), '');
      continue when v is null;
      if length(v) > 500 or v !~* '^https?://[^\s]+$' then
        raise exception 'VALIDATION_ERROR: An attachment link must be a web address starting with http:// or https://.' using errcode = 'P0001';
      end if;
      v_att := v_att || jsonb_build_array(jsonb_build_object('name', left(coalesce(nullif(btrim(a ->> 'name'), ''), v), 120), 'url', v));
      n := n + 1;
    end loop;
  end if;
  if n > 0 then
    v_out := v_out || jsonb_build_object('attachments', v_att);
  end if;
  return v_out;
end $$;
revoke all on function private.clean_report_content(text, jsonb) from public, anon, authenticated;

-- A report as the screens read it. The full content is included only when asked for (the lists carry a short excerpt instead).
create or replace function private.report_json(r public.work_reports, p_content boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'authorId', r.author_id, 'author', r.author_name, 'designation', r.author_designation,
    'departmentId', r.department_id, 'department', (select d.name from public.departments d where d.id = r.department_id),
    'teamId', r.team_id, 'team', (select t.name from public.teams t where t.id = r.team_id),
    'title', r.title, 'reportDate', r.report_date, 'periodType', r.period_type, 'periodStart', r.period_start, 'periodEnd', r.period_end,
    'status', r.status, 'revision', r.revision, 'submittedAt', r.submitted_at,
    'reviewedBy', r.reviewed_by_name, 'reviewedAt', r.reviewed_at, 'reviewComment', r.review_comment,
    'createdAt', r.created_at, 'updatedAt', r.updated_at,
    'excerpt', left(coalesce(r.content ->> 'workCompleted', r.content ->> 'departmentOverview', ''), 180))
    || case when p_content then jsonb_build_object('content', r.content) else '{}'::jsonb end
$$;
revoke all on function private.report_json(public.work_reports, boolean) from public, anon, authenticated;

create or replace function private.report_event(p_report uuid, p_action text, p_from text, p_to text, p_comment text, p_revision integer)
returns void language sql security definer set search_path = '' as $$
  insert into public.work_report_events (report_id, actor_id, actor_name, action, from_status, to_status, comment, revision)
  select p_report, p.id, p.full_name, p_action, p_from, p_to, p_comment, p_revision
    from public.profiles p where p.id = auth.uid()
$$;
revoke all on function private.report_event(uuid, text, text, text, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Writing and submitting a report
-- ---------------------------------------------------------------------------
create or replace function public.work_report_save(
  p_id uuid, p_title text, p_report_date date, p_period_type text, p_period_start date, p_period_end date, p_content jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.profiles;
  r public.work_reports;
  v_level text := private.report_level();
  v_kind text := private.report_kind_of(private.report_level());
  v_title text := btrim(coalesce(p_title, ''));
  v_content jsonb;
begin
  if v_kind is null then
    raise exception 'FORBIDDEN: Reports are written by team members, team leads and department heads.' using errcode = '42501';
  end if;
  select * into a from public.profiles where id = auth.uid();
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a report title (3 to 200 characters).' using errcode = 'P0001';
  end if;
  if p_report_date is null or p_period_start is null or p_period_end is null then
    raise exception 'VALIDATION_ERROR: Choose the report date and the reporting period.' using errcode = 'P0001';
  end if;
  if p_period_end < p_period_start or p_period_end - p_period_start > 366 then
    raise exception 'VALIDATION_ERROR: The reporting period must end on or after its start and be at most a year.' using errcode = 'P0001';
  end if;
  if coalesce(p_period_type, 'DAILY') not in ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM') then
    raise exception 'VALIDATION_ERROR: Choose daily, weekly, monthly or a custom period.' using errcode = 'P0001';
  end if;
  v_content := private.clean_report_content(v_kind, p_content);

  if p_id is null then
    insert into public.work_reports (kind, author_id, author_name, author_designation, department_id, team_id, title, report_date,
                                     period_type, period_start, period_end, content)
    values (v_kind, a.id, a.full_name, nullif(a."position", ''), private.base_department(a.department_id),
            case when v_kind = 'DEPARTMENT_HEAD' then null else a.team_id end,
            v_title, p_report_date, coalesce(p_period_type, 'DAILY'), p_period_start, p_period_end, v_content)
    returning * into r;
    perform private.report_event(r.id, 'CREATED', null, 'DRAFT', null, r.revision);
  else
    select * into r from public.work_reports where id = p_id and author_id = auth.uid() for update;
    if r.id is null then
      raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
    end if;
    if r.status not in ('DRAFT', 'REVISION_REQUIRED') then
      raise exception 'CONFLICT: This report was already submitted and cannot be edited.' using errcode = 'P0001';
    end if;
    update public.work_reports
       set title = v_title, report_date = p_report_date, period_type = coalesce(p_period_type, 'DAILY'),
           period_start = p_period_start, period_end = p_period_end, content = v_content, updated_at = now()
     where id = p_id returning * into r;
  end if;
  return private.report_json(r, true);
end $$;
revoke all on function public.work_report_save(uuid, text, date, text, date, date, jsonb) from public, anon;
grant execute on function public.work_report_save(uuid, text, date, text, date, date, jsonb) to authenticated;

create or replace function public.work_report_submit(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.work_reports;
  v_from text;
  v_action text;
  v_reviewer uuid;
  v_n int := 0;
begin
  if private.report_kind_of(private.report_level()) is null then
    raise exception 'FORBIDDEN: Reports are written by team members, team leads and department heads.' using errcode = '42501';
  end if;
  select * into r from public.work_reports where id = p_id and author_id = auth.uid() for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  if r.status not in ('DRAFT', 'REVISION_REQUIRED') then
    raise exception 'CONFLICT: This report was already submitted.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(r.content ->> 'workCompleted', '')), '') is null or length(r.content ->> 'workCompleted') < 3 then
    raise exception 'VALIDATION_ERROR: Describe the work completed before submitting.' using errcode = 'P0001';
  end if;
  -- the reviewer must exist now, so a report is never submitted into the void
  select count(*) into v_n from private.report_reviewer_ids(r.kind, r.department_id, r.team_id);
  if v_n = 0 then
    raise exception 'CONFLICT: %', case r.kind
      when 'MEMBER' then 'You are not assigned to a Team Lead yet. Ask your Department Head to assign you, then submit again.'
      when 'TEAM_LEAD' then 'No Department Head is set for your department yet. Ask the Super Admin or HR.'
      else 'No Operations Head manages your department yet. Ask the Super Admin to assign one.' end using errcode = 'P0001';
  end if;
  v_from := r.status;
  v_action := case when v_from = 'REVISION_REQUIRED' then 'RESUBMITTED' else 'SUBMITTED' end;
  update public.work_reports
     set status = 'SUBMITTED', submitted_at = now(), updated_at = now(),
         revision = case when v_from = 'REVISION_REQUIRED' then revision + 1 else revision end,
         reviewed_by = null, reviewed_by_name = null, reviewed_at = null, review_comment = null
   where id = p_id returning * into r;
  perform private.report_event(r.id, v_action, v_from, 'SUBMITTED', null, r.revision);
  for v_reviewer in select * from private.report_reviewer_ids(r.kind, r.department_id, r.team_id) loop
    perform private.notify(v_reviewer, case when v_action = 'RESUBMITTED' then 'REPORT_RESUBMITTED' else 'REPORT_SUBMITTED' end,
      format('%s: %s', case when v_action = 'RESUBMITTED' then 'Report resubmitted' else 'New report to review' end, r.author_name),
      format('"%s" (%s to %s) is waiting for your review.', r.title, to_char(r.period_start, 'DD Mon'), to_char(r.period_end, 'DD Mon YYYY')),
      'work_report', r.id);
  end loop;
  perform private.write_audit('WORK_REPORT_' || v_action, 'work_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'revision', r.revision));
  return private.report_json(r, true);
end $$;
revoke all on function public.work_report_submit(uuid) from public, anon;
grant execute on function public.work_report_submit(uuid) to authenticated;

-- A draft nobody has seen can be thrown away by its author (a submitted report is kept).
create or replace function public.work_report_delete_draft(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.work_reports where id = p_id and author_id = auth.uid() and status = 'DRAFT';
  if not found then
    raise exception 'NOT_FOUND: Draft not found.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.work_report_delete_draft(uuid) from public, anon;
grant execute on function public.work_report_delete_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reading
-- ---------------------------------------------------------------------------
-- One report with its content and history. A reviewer opening a submitted report marks it "under review" (once).
create or replace function public.work_report_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.work_reports;
  v_review boolean;
begin
  select * into r from public.work_reports where id = p_id;
  if r.id is null or not private.can_view_report(r) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  v_review := private.is_report_reviewer(r);
  if v_review and r.status = 'SUBMITTED' then
    update public.work_reports set status = 'UNDER_REVIEW', updated_at = now() where id = r.id returning * into r;
    perform private.report_event(r.id, 'OPENED', 'SUBMITTED', 'UNDER_REVIEW', null, r.revision);
  end if;
  return private.report_json(r, true) || jsonb_build_object(
    'canEdit', r.author_id = auth.uid() and r.status in ('DRAFT', 'REVISION_REQUIRED'),
    'canReview', v_review and r.status in ('SUBMITTED', 'UNDER_REVIEW'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'actor', e.actor_name, 'action', e.action, 'fromStatus', e.from_status,
                          'toStatus', e.to_status, 'comment', e.comment, 'revision', e.revision) order by e.id)
                         from public.work_report_events e where e.report_id = r.id), '[]'::jsonb));
end $$;
revoke all on function public.work_report_get(uuid) from public, anon;
grant execute on function public.work_report_get(uuid) to authenticated;

-- My own reports (drafts included).
create or replace function public.work_reports_mine(p_status text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.report_json(r) order by r.updated_at desc), '[]'::jsonb)
    from (select * from public.work_reports where author_id = auth.uid() and (p_status is null or status = p_status) order by updated_at desc limit 300) r
$$;
revoke all on function public.work_reports_mine(text) from public, anon;
grant execute on function public.work_reports_mine(text) to authenticated;

-- The reports waiting for the caller's review (and the ones already decided): Team Members' reports for a Team Lead, Team Leads' for a
-- Department Head, Department Heads' for an Operations Head.
create or replace function public.work_reports_inbox(p_status text default null, p_from date default null, p_to date default null, p_author uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := private.report_level();
  v_team uuid := private.my_team_id();
  v_dept uuid := (select private.base_department(p.department_id) from public.profiles p where p.id = auth.uid());
  v_items jsonb;
  v_counts jsonb;
begin
  if v_level not in ('TEAM_LEAD', 'DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only people who review reports can open this list.' using errcode = '42501';
  end if;
  with inbox as (
    select r.* from public.work_reports r
     where r.status <> 'DRAFT'
       and (p_from is null or r.period_end >= p_from) and (p_to is null or r.period_start <= p_to)
       and (p_author is null or r.author_id = p_author)
       and (   (v_level = 'TEAM_LEAD' and r.kind = 'MEMBER' and r.team_id = v_team)
            or (v_level = 'DEPARTMENT_HEAD' and r.kind = 'TEAM_LEAD' and r.department_id = v_dept and private.head_covers(auth.uid(), r.department_id, r.team_id))
            or (v_level = 'OPERATIONS_HEAD' and r.kind = 'DEPARTMENT_HEAD' and r.department_id in (select private.report_scope_departments()))
            or (v_level = 'SUPER_ADMIN' and r.kind <> 'MEMBER'))
  )
  select
    (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select i.status, count(*) n from inbox i group by i.status) s),
    (select coalesce(jsonb_agg(private.report_json(x) order by (x.status in ('SUBMITTED', 'UNDER_REVIEW')) desc, x.submitted_at desc), '[]'::jsonb)
       from (select i.* from inbox i
              where p_status is null or i.status = p_status or (p_status = 'PENDING' and i.status in ('SUBMITTED', 'UNDER_REVIEW'))
              order by i.submitted_at desc limit 300) x)
    into v_counts, v_items;
  return jsonb_build_object('items', v_items, 'counts', v_counts);
end $$;
revoke all on function public.work_reports_inbox(text, date, date, uuid) from public, anon;
grant execute on function public.work_reports_inbox(text, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Deciding
-- ---------------------------------------------------------------------------
create or replace function public.work_report_review(p_id uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.work_reports;
  me public.profiles;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_from text;
  v_status text;
  v_action text;
begin
  if p_decision not in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then
    raise exception 'VALIDATION_ERROR: Choose approve, reject or request a revision.' using errcode = 'P0001';
  end if;
  if p_decision <> 'APPROVED' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write a comment so the author knows what to do.' using errcode = 'P0001';
  end if;
  select * into r from public.work_reports where id = p_id for update;
  if r.id is null or not private.can_view_report(r) or not private.is_report_reviewer(r) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  if r.status not in ('SUBMITTED', 'UNDER_REVIEW') then
    raise exception 'CONFLICT: This report is not waiting for a decision.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  v_from := r.status;
  v_status := p_decision;
  v_action := case p_decision when 'APPROVED' then 'APPROVED' when 'REJECTED' then 'REJECTED' else 'REVISION_REQUESTED' end;
  update public.work_reports
     set status = v_status, reviewed_by = me.id, reviewed_by_name = me.full_name, reviewed_at = now(), review_comment = left(v_comment, 2000), updated_at = now()
   where id = p_id returning * into r;
  perform private.report_event(r.id, v_action, v_from, v_status, left(v_comment, 2000), r.revision);
  perform private.notify(r.author_id,
    case p_decision when 'APPROVED' then 'REPORT_APPROVED' when 'REJECTED' then 'REPORT_REJECTED' else 'REPORT_REVISION_REQUIRED' end,
    case p_decision when 'APPROVED' then 'Report approved' when 'REJECTED' then 'Report rejected' else 'Revision requested on your report' end,
    format('"%s" was %s by %s.%s', r.title, case p_decision when 'APPROVED' then 'approved' when 'REJECTED' then 'rejected' else 'sent back for a revision' end,
           me.full_name, coalesce(' ' || left(v_comment, 300), '')),
    'work_report', r.id);
  perform private.write_audit('WORK_REPORT_' || v_action, 'work_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'revision', r.revision, 'comment', left(v_comment, 300)));
  return private.report_json(r, true);
end $$;
revoke all on function public.work_report_review(uuid, text, text) from public, anon;
grant execute on function public.work_report_review(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The boxes
-- ---------------------------------------------------------------------------
-- Team Lead: the team's collective box, built from the members' own reports.
create or replace function public.work_reports_team_box(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_members jsonb;
  v_counts jsonb;
begin
  if private.report_level() <> 'TEAM_LEAD' then
    raise exception 'FORBIDDEN: This is the Team Lead''s team report box.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select coalesce(jsonb_agg(m order by m ->> 'name'), '[]'::jsonb) into v_members from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'designation', nullif(p."position", ''),
      'counts', jsonb_build_object(
         'submitted', (select count(*) from public.work_reports r where r.author_id = p.id and r.kind = 'MEMBER' and r.team_id = me.team_id and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
         'pending', (select count(*) from public.work_reports r where r.author_id = p.id and r.kind = 'MEMBER' and r.team_id = me.team_id and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to),
         'approved', (select count(*) from public.work_reports r where r.author_id = p.id and r.kind = 'MEMBER' and r.team_id = me.team_id and r.status = 'APPROVED' and r.period_end >= p_from and r.period_start <= p_to),
         'revision', (select count(*) from public.work_reports r where r.author_id = p.id and r.kind = 'MEMBER' and r.team_id = me.team_id and r.status = 'REVISION_REQUIRED' and r.period_end >= p_from and r.period_start <= p_to),
         'rejected', (select count(*) from public.work_reports r where r.author_id = p.id and r.kind = 'MEMBER' and r.team_id = me.team_id and r.status = 'REJECTED' and r.period_end >= p_from and r.period_start <= p_to)),
      'reports', coalesce((select jsonb_agg(private.report_json(r) order by r.period_end desc, r.submitted_at desc)
                             from public.work_reports r where r.author_id = p.id and r.kind = 'MEMBER' and r.team_id = me.team_id and r.status <> 'DRAFT'
                              and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb)) as m
      from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and p.team_id = me.team_id
  ) q;
  select jsonb_build_object(
    'submitted', count(*) filter (where r.status <> 'DRAFT'),
    'pending', count(*) filter (where r.status in ('SUBMITTED', 'UNDER_REVIEW')),
    'approved', count(*) filter (where r.status = 'APPROVED'),
    'revision', count(*) filter (where r.status = 'REVISION_REQUIRED'),
    'rejected', count(*) filter (where r.status = 'REJECTED')) into v_counts
    from public.work_reports r where r.kind = 'MEMBER' and r.team_id = me.team_id and r.period_end >= p_from and r.period_start <= p_to;
  return jsonb_build_object(
    'teamId', me.team_id, 'team', (select t.name from public.teams t where t.id = me.team_id), 'teamLead', me.full_name,
    'periodStart', p_from, 'periodEnd', p_to,
    'totalMembers', jsonb_array_length(v_members), 'counts', v_counts, 'members', v_members,
    'myReports', coalesce((select jsonb_agg(private.report_json(r) order by r.period_end desc)
                            from public.work_reports r where r.author_id = auth.uid() and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb));
end $$;
revoke all on function public.work_reports_team_box(date, date) from public, anon;
grant execute on function public.work_reports_team_box(date, date) to authenticated;

-- The pieces of one Team Lead's box, read by the Department Head and by the Operations Head: the lead's own reports and the members'
-- APPROVED reports (pending ones are only counted, never shown as approved). The full content is included so a box can be opened in place.
create or replace function private.team_lead_box(p_lead public.profiles, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'leadId', p_lead.id, 'lead', p_lead.full_name, 'teamId', p_lead.team_id, 'team', (select t.name from public.teams t where t.id = p_lead.team_id),
    'totalMembers', (select count(*) from public.profiles m where m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and m.team_id = p_lead.team_id),
    'counts', jsonb_build_object(
      'submitted', (select count(*) from public.work_reports r where r.kind = 'MEMBER' and r.team_id = p_lead.team_id and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
      'approved', (select count(*) from public.work_reports r where r.kind = 'MEMBER' and r.team_id = p_lead.team_id and r.status = 'APPROVED' and r.period_end >= p_from and r.period_start <= p_to),
      'pending', (select count(*) from public.work_reports r where r.kind = 'MEMBER' and r.team_id = p_lead.team_id and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to),
      'revision', (select count(*) from public.work_reports r where r.kind = 'MEMBER' and r.team_id = p_lead.team_id and r.status = 'REVISION_REQUIRED' and r.period_end >= p_from and r.period_start <= p_to),
      'rejected', (select count(*) from public.work_reports r where r.kind = 'MEMBER' and r.team_id = p_lead.team_id and r.status = 'REJECTED' and r.period_end >= p_from and r.period_start <= p_to)),
    'leadReports', coalesce((select jsonb_agg(private.report_json(r, true) order by r.period_end desc, r.submitted_at desc)
                               from public.work_reports r where r.kind = 'TEAM_LEAD' and r.author_id = p_lead.id and r.status <> 'DRAFT'
                                and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb),
    'memberReports', coalesce((select jsonb_agg(private.report_json(r, true) order by r.author_name, r.period_end desc)
                                 from public.work_reports r where r.kind = 'MEMBER' and r.team_id = p_lead.team_id and r.status = 'APPROVED'
                                  and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb),
    'leadReportStatus', (select r.status from public.work_reports r where r.kind = 'TEAM_LEAD' and r.author_id = p_lead.id and r.status <> 'DRAFT'
                           and r.period_end >= p_from and r.period_start <= p_to order by r.submitted_at desc limit 1),
    'lastSubmittedAt', (select max(r.submitted_at) from public.work_reports r
                         where r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to
                           and ((r.kind = 'TEAM_LEAD' and r.author_id = p_lead.id) or (r.kind = 'MEMBER' and r.team_id = p_lead.team_id))))
$$;
revoke all on function private.team_lead_box(public.profiles, date, date) from public, anon, authenticated;

create or replace function private.package_json(p public.work_report_packages)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then jsonb_build_object('status', 'NOT_SUBMITTED')
    else jsonb_build_object('status', 'SUBMITTED', 'id', p.id, 'note', p.note, 'submittedBy', p.submitted_by_name, 'submittedAt', p.submitted_at, 'periodType', p.period_type) end
$$;
revoke all on function private.package_json(public.work_report_packages) from public, anon, authenticated;

-- Department Head: one box per Team Lead of the department (and side), the department's consolidated package and the head's own reports.
create or replace function public.work_reports_department(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
  v_boxes jsonb;
  pk public.work_report_packages;
begin
  if private.report_level() <> 'DEPARTMENT_HEAD' then
    raise exception 'FORBIDDEN: This is the Department Head''s department report box.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a valid reporting period.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  v_dept := private.base_department(me.department_id);
  select coalesce(jsonb_agg(private.team_lead_box(l, p_from, p_to) order by l.full_name), '[]'::jsonb) into v_boxes
    from public.profiles l
   where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and private.base_department(l.department_id) = v_dept and private.head_covers(me.id, v_dept, l.team_id);
  select * into pk from public.work_report_packages where department_id = v_dept and period_start = p_from and period_end = p_to;
  return jsonb_build_object(
    'departmentId', v_dept, 'department', (select d.name from public.departments d where d.id = v_dept), 'departmentHead', me.full_name,
    'periodStart', p_from, 'periodEnd', p_to, 'teams', v_boxes, 'package', private.package_json(pk),
    'myReports', coalesce((select jsonb_agg(private.report_json(r) order by r.period_end desc)
                             from public.work_reports r where r.author_id = me.id and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb));
end $$;
revoke all on function public.work_reports_department(date, date) from public, anon;
grant execute on function public.work_reports_department(date, date) to authenticated;

-- Department Head: forward the department's consolidated package for a period to the Operations Head. The package is a pointer: the
-- reports themselves are read live from their own rows, so a report approved later appears in it too.
create or replace function public.work_report_package_submit(p_from date, p_to date, p_period_type text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
  pk public.work_report_packages;
  v_new boolean;
  v_head uuid;
begin
  if private.report_level() <> 'DEPARTMENT_HEAD' then
    raise exception 'FORBIDDEN: Only a Department Head forwards the department package.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a valid reporting period.' using errcode = 'P0001';
  end if;
  if coalesce(p_period_type, 'WEEKLY') not in ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM') then
    raise exception 'VALIDATION_ERROR: Choose daily, weekly, monthly or a custom period.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_note, '')) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep the department observations under 4000 characters.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  v_dept := private.base_department(me.department_id);
  if not exists (select 1 from private.report_reviewer_ids('DEPARTMENT_HEAD', v_dept, null)) then
    raise exception 'CONFLICT: No Operations Head manages this department yet. Ask the Super Admin to assign one.' using errcode = 'P0001';
  end if;
  select * into pk from public.work_report_packages where department_id = v_dept and period_start = p_from and period_end = p_to for update;
  v_new := pk.id is null;
  if v_new then
    insert into public.work_report_packages (department_id, period_type, period_start, period_end, note, submitted_by, submitted_by_name)
    values (v_dept, coalesce(p_period_type, 'WEEKLY'), p_from, p_to, nullif(btrim(p_note), ''), me.id, me.full_name)
    returning * into pk;
  else
    update public.work_report_packages set note = nullif(btrim(p_note), ''), submitted_by = me.id, submitted_by_name = me.full_name, updated_at = now()
     where id = pk.id returning * into pk;
  end if;
  -- told once, when the package is first sent (changing the note later does not notify again)
  if v_new then
    for v_head in select * from private.report_reviewer_ids('DEPARTMENT_HEAD', v_dept, null) loop
      perform private.notify(v_head, 'REPORT_PACKAGE_SUBMITTED',
        format('Department report: %s', (select d.name from public.departments d where d.id = v_dept)),
        format('%s sent the department report for %s to %s.', me.full_name, to_char(p_from, 'DD Mon'), to_char(p_to, 'DD Mon YYYY')),
        'work_report_package', pk.id);
    end loop;
  end if;
  perform private.write_audit('WORK_REPORT_PACKAGE_SUBMITTED', 'department', v_dept, v_dept, null,
    jsonb_build_object('from', p_from, 'to', p_to, 'first', v_new));
  return private.package_json(pk);
end $$;
revoke all on function public.work_report_package_submit(date, date, text, text) from public, anon;
grant execute on function public.work_report_package_submit(date, date, text, text) to authenticated;

-- Operations Head (and Super Admin): one box per department, with the counts for the period.
create or replace function public.work_reports_operations(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the company reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a valid reporting period.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(row_obj order by row_obj ->> 'name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'slug', d.slug,
      'departmentHeads', (select coalesce(jsonb_agg(h.full_name order by h.full_name), '[]'::jsonb) from public.profiles h
                           where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = d.id),
      'teamLeads', (select count(*) from public.profiles p where p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id),
      'teamMembers', (select count(*) from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id),
      'counts', jsonb_build_object(
        'submitted', (select count(*) from public.work_reports r where r.department_id = d.id and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'memberApproved', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'MEMBER' and r.status = 'APPROVED' and r.period_end >= p_from and r.period_start <= p_to),
        'memberPending', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to),
        'teamLeadReports', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'TEAM_LEAD' and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'headReports', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'DEPARTMENT_HEAD' and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'headPending', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'DEPARTMENT_HEAD' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to)),
      'headReportStatus', (select r.status from public.work_reports r where r.department_id = d.id and r.kind = 'DEPARTMENT_HEAD' and r.status <> 'DRAFT'
                              and r.period_end >= p_from and r.period_start <= p_to order by r.submitted_at desc limit 1),
      'lastSubmittedAt', (select max(r.submitted_at) from public.work_reports r where r.department_id = d.id and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
      'package', private.package_json((select pk from public.work_report_packages pk where pk.department_id = d.id and pk.period_start = p_from and pk.period_end = p_to))
    ) as row_obj
    from public.departments d where d.id in (select private.report_scope_departments())
  ) q;
  return jsonb_build_object('periodStart', p_from, 'periodEnd', p_to, 'departments', v_rows);
end $$;
revoke all on function public.work_reports_operations(date, date) from public, anon;
grant execute on function public.work_reports_operations(date, date) to authenticated;

-- Operations Head: one department opened up: the Department Head's reports, then every Team Lead's box (the lead's own reports and the
-- members' approved reports). The reports are released once the Department Head has forwarded the package for that period; before that
-- only the counts are shown.
create or replace function public.work_reports_operations_department(p_department uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  pk public.work_report_packages;
  v_released boolean;
  v_heads jsonb;
  v_leads jsonb;
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the company reports.' using errcode = '42501';
  end if;
  if p_department not in (select private.report_scope_departments()) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a valid reporting period.' using errcode = 'P0001';
  end if;
  select * into pk from public.work_report_packages where department_id = p_department and period_start = p_from and period_end = p_to;
  v_released := pk.id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'designation', nullif(h."position", ''),
      'reports', case when v_released then coalesce((select jsonb_agg(private.report_json(r) order by r.period_end desc, r.submitted_at desc)
                         from public.work_reports r where r.kind = 'DEPARTMENT_HEAD' and r.author_id = h.id and r.status <> 'DRAFT'
                          and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb) else '[]'::jsonb end) order by h.full_name), '[]'::jsonb) into v_heads
    from public.profiles h
   where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = p_department;
  select coalesce(jsonb_agg(
      case when v_released then private.team_lead_box(l, p_from, p_to)
           else private.team_lead_box(l, p_from, p_to) || jsonb_build_object('leadReports', '[]'::jsonb, 'memberReports', '[]'::jsonb) end order by l.full_name), '[]'::jsonb) into v_leads
    from public.profiles l
   where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and private.base_department(l.department_id) = p_department;
  return jsonb_build_object(
    'departmentId', p_department, 'department', (select d.name from public.departments d where d.id = p_department),
    'periodStart', p_from, 'periodEnd', p_to, 'package', private.package_json(pk), 'released', v_released,
    -- the packages sent for this department (newest first), so a period with no package can be switched to one that exists
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'periodType', x.period_type, 'periodStart', x.period_start, 'periodEnd', x.period_end, 'submittedAt', x.submitted_at) order by x.period_end desc, x.submitted_at desc)
                           from (select * from public.work_report_packages k where k.department_id = p_department order by k.period_end desc, k.submitted_at desc limit 10) x), '[]'::jsonb),
    'departmentHeads', v_heads, 'teamLeads', v_leads);
end $$;
revoke all on function public.work_reports_operations_department(uuid, date, date) from public, anon;
grant execute on function public.work_reports_operations_department(uuid, date, date) to authenticated;

-- What the sidebar needs: who the caller is in the reporting chain, whom they report to, and the numbers for the badge.
create or replace function public.work_reports_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := private.report_level();
  v_kind text := private.report_kind_of(private.report_level());
  me public.profiles;
  r public.work_reports;
  v_pending int := 0;
  v_revision int := 0;
  v_to jsonb := '[]'::jsonb;
begin
  if v_level is null then
    raise exception 'FORBIDDEN: Reports are not available for this account.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if v_kind is not null then
    select count(*) into v_revision from public.work_reports x where x.author_id = me.id and x.status = 'REVISION_REQUIRED';
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name), '[]'::jsonb) into v_to
      from public.profiles p where p.id in (select private.report_reviewer_ids(v_kind, private.base_department(me.department_id),
                                                case when v_kind = 'DEPARTMENT_HEAD' then null else me.team_id end));
  end if;
  if v_level = 'TEAM_LEAD' then
    select count(*) into v_pending from public.work_reports x where x.kind = 'MEMBER' and x.team_id = me.team_id and x.status in ('SUBMITTED', 'UNDER_REVIEW');
  elsif v_level = 'DEPARTMENT_HEAD' then
    select count(*) into v_pending from public.work_reports x where x.kind = 'TEAM_LEAD' and x.department_id = private.base_department(me.department_id)
       and x.status in ('SUBMITTED', 'UNDER_REVIEW') and private.head_covers(me.id, x.department_id, x.team_id);
  elsif v_level in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    select count(*) into v_pending from public.work_reports x where x.kind = 'DEPARTMENT_HEAD' and x.status in ('SUBMITTED', 'UNDER_REVIEW')
       and x.department_id in (select private.report_scope_departments());
  end if;
  return jsonb_build_object('level', v_level, 'canWrite', v_kind is not null, 'reportsTo', v_to,
    'pendingReview', v_pending, 'needsRevision', v_revision, 'badge', v_pending + v_revision,
    'team', (select t.name from public.teams t where t.id = me.team_id), 'name', me.full_name);
end $$;
revoke all on function public.work_reports_context() from public, anon;
grant execute on function public.work_reports_context() to authenticated;
