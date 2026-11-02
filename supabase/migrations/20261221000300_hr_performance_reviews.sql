-- =============================================================================
-- HR performance reviews and the consolidated company performance report.
--
--   Operations Head approves a department's week  ->  HR reviews every Team Lead and every Team Member separately  ->  HR submits the
--   consolidated report to the Super Admin.
--
--  * hr_performance_reviews: one separate record per person and weekly package (never one rating for a department). A draft can be saved
--    and edited; a submitted review is final and stays in the person's history. HR never changes a daily report or its approval: the review
--    table is the only thing HR writes, and the report approval status and the HR review status are independent.
--  * The rating scale and the working days are settings (report_settings), not code.
--  * hr_consolidated_reports: one per week. It points at the weekly packages that are fully reviewed (no copy) and keeps a snapshot of what
--    was complete and what was still pending when it was submitted. A package that is not fully reviewed is never marked as finished.
--  * Everything is a security definer function that works out the caller from the login. HR staff are the members of the HR department.
--
-- Safe to run again. Run after 20261221000200_reports_weekly_cycle.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
alter table public.report_settings
  add column if not exists rating_scale jsonb not null default
    '[{"value":1,"label":"Needs improvement"},{"value":2,"label":"Below expectations"},{"value":3,"label":"Meets expectations"},{"value":4,"label":"Exceeds expectations"},{"value":5,"label":"Outstanding"}]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.hr_performance_reviews (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.work_report_packages (id) on delete cascade,
  subject_id uuid references public.profiles (id) on delete set null,
  -- who was reviewed, as they were then
  subject_name text not null,
  subject_designation text,
  subject_kind text not null check (subject_kind in ('TEAM_MEMBER', 'TEAM_LEAD')),
  department_id uuid not null references public.departments (id) on delete restrict,
  team_id uuid references public.teams (id) on delete set null,
  period_start date not null,
  period_end date not null,
  reviewer_id uuid references public.profiles (id) on delete set null,
  reviewer_name text not null,
  rating integer check (rating between 1 and 10),
  consistency_note text check (length(consistency_note) <= 1000),
  work_assessment text check (length(work_assessment) <= 2000),
  comments text check (length(comments) <= 2000),
  recommendations text check (length(recommendations) <= 2000),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED')),
  -- the figures the review was written against (kept so a later change of the records does not rewrite the review)
  metrics jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_review_submitted_check check (status = 'DRAFT' or (rating is not null and submitted_at is not null)),
  unique (package_id, subject_id)
);
create index if not exists hr_reviews_subject_idx on public.hr_performance_reviews (subject_id, period_end desc);
create index if not exists hr_reviews_department_idx on public.hr_performance_reviews (department_id, period_end desc, status);
alter table public.hr_performance_reviews enable row level security;
revoke all on public.hr_performance_reviews from public, anon, authenticated;

create table if not exists public.hr_consolidated_reports (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED_TO_SUPERADMIN', 'AI_ANALYSIS_COMPLETED')),
  note text check (length(note) <= 4000),
  revision integer not null default 0 check (revision >= 0),
  -- what was complete and what was pending when it was last submitted
  readiness jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_by_name text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_consolidated_period_check check (period_end = period_start + 6),
  unique (period_start)
);
alter table public.hr_consolidated_reports enable row level security;
revoke all on public.hr_consolidated_reports from public, anon, authenticated;

-- which weekly packages a submission contains (pointers: no report is copied)
create table if not exists public.hr_consolidated_packages (
  consolidated_id uuid not null references public.hr_consolidated_reports (id) on delete cascade,
  package_id uuid not null references public.work_report_packages (id) on delete cascade,
  included_revision integer not null,
  included_at timestamptz not null default now(),
  primary key (consolidated_id, package_id)
);
alter table public.hr_consolidated_packages enable row level security;
revoke all on public.hr_consolidated_packages from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Figures of one person in a period (from the individual reports and the task records)
-- ---------------------------------------------------------------------------
create or replace function private.report_person_stats(p_person uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with rep as (
    select r.* from public.work_reports r where r.author_id = p_person and r.status <> 'DRAFT' and r.report_date between p_from and p_to
  ), t as (
    select w.* from public.work_tasks w
     where w.assignee_id = p_person
       and coalesce(w.due_date, (w.created_at at time zone 'Asia/Kolkata')::date) between p_from and p_to
  ), e as (select private.report_expected_days(p_person, p_from, p_to) as n)
  select jsonb_build_object(
    'expected', (select n from e),
    'submitted', (select count(*) from rep),
    'approved', (select count(*) from rep where status = 'APPROVED'),
    'pendingTl', (select count(*) from rep where kind = 'MEMBER' and status in ('SUBMITTED', 'UNDER_REVIEW')),
    'pendingDh', (select count(*) from rep where (kind = 'MEMBER' and status = 'PENDING_DEPARTMENT_HEAD') or (kind = 'TEAM_LEAD' and status in ('SUBMITTED', 'UNDER_REVIEW'))),
    'rejected', (select count(*) from rep where status = 'REJECTED'),
    'revisionNow', (select count(*) from rep where status = 'REVISION_REQUIRED'),
    'revisionRequests', (select count(*) from public.work_report_events ev join rep on rep.id = ev.report_id where ev.action = 'REVISION_REQUESTED'),
    'tlApproved', (select count(*) from rep where tl_status = 'APPROVED'),
    'dhApproved', (select count(*) from rep where dh_status = 'APPROVED'),
    -- sent on the report day or the day after
    'onTime', (select count(*) from rep where submitted_at is not null and (submitted_at at time zone 'Asia/Kolkata')::date <= report_date + 1),
    'assigned', (select count(distinct x ->> 'id') from rep cross join lateral jsonb_array_elements(case when jsonb_typeof(rep.content -> 'assignedTasks') = 'array' then rep.content -> 'assignedTasks' else '[]'::jsonb end) x),
    'completed', (select count(distinct x ->> 'id') from rep cross join lateral jsonb_array_elements(case when jsonb_typeof(rep.content -> 'completedTasks') = 'array' then rep.content -> 'completedTasks' else '[]'::jsonb end) x),
    'compliance', (select case when n > 0 then least(100, round(100.0 * (select count(*) from rep) / n, 1)) end from e),
    -- the task records themselves (tasks due in the period)
    'tasksAssigned', (select count(*) from t),
    'tasksCompleted', (select count(*) from t where status = 'COMPLETED'),
    'taskCompletionRate', (select case when count(*) > 0 then round(100.0 * count(*) filter (where status = 'COMPLETED') / count(*), 1) end from t))
$$;
revoke all on function private.report_person_stats(uuid, date, date) from public, anon, authenticated;

create or replace function private.rating_label(p_rating integer)
returns text language sql stable security definer set search_path = '' as $$
  select x ->> 'label' from public.report_settings s cross join jsonb_array_elements(s.rating_scale) x where (x ->> 'value')::int = p_rating limit 1
$$;
revoke all on function private.rating_label(integer) from public, anon, authenticated;

create or replace function private.hr_review_json(v public.hr_performance_reviews)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when v.id is null then null else jsonb_build_object(
    'id', v.id, 'packageId', v.package_id, 'subjectId', v.subject_id, 'subject', v.subject_name, 'subjectKind', v.subject_kind,
    'periodStart', v.period_start, 'periodEnd', v.period_end, 'status', v.status,
    'rating', v.rating, 'ratingLabel', private.rating_label(v.rating),
    'consistencyNote', v.consistency_note, 'workAssessment', v.work_assessment, 'comments', v.comments, 'recommendations', v.recommendations,
    'reviewer', v.reviewer_name, 'submittedAt', v.submitted_at, 'updatedAt', v.updated_at, 'metrics', v.metrics) end
$$;
revoke all on function private.hr_review_json(public.hr_performance_reviews) from public, anon, authenticated;

-- The people HR reviews for a weekly package: every active Team Lead and Team Member of the department.
create or replace function private.hr_subjects(p_department uuid)
returns table (id uuid, kind text, team_id uuid, full_name text, designation text)
language sql stable security definer set search_path = '' as $$
  select s.id, case s.kind when 'TEAM_LEAD' then 'TEAM_LEAD' else 'TEAM_MEMBER' end, s.team_id, s.full_name, s.designation
    from private.report_people(p_department, null) s where s.kind in ('MEMBER', 'TEAM_LEAD')
$$;
revoke all on function private.hr_subjects(uuid) from public, anon, authenticated;

-- Review counts of a package: expected = the people, then the drafts and the submitted reviews.
create or replace function private.hr_review_counts(p_package uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'expected', (select count(*) from private.hr_subjects(k.department_id)),
    'submitted', (select count(*) from public.hr_performance_reviews v where v.package_id = k.id and v.status = 'SUBMITTED'
                    and v.subject_id in (select id from private.hr_subjects(k.department_id))),
    'drafts', (select count(*) from public.hr_performance_reviews v where v.package_id = k.id and v.status = 'DRAFT'
                 and v.subject_id in (select id from private.hr_subjects(k.department_id))))
  from public.work_report_packages k where k.id = p_package
$$;
revoke all on function private.hr_review_counts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. HR: the weeks and departments waiting for review
-- ---------------------------------------------------------------------------
create or replace function public.hr_reviews_overview(p_week_start date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_week date := p_week_start;
  v_rows jsonb;
begin
  if not private.is_hr_reviewer() then
    raise exception 'FORBIDDEN: Performance reviews are written by HR.' using errcode = '42501';
  end if;
  if v_week is null then
    select max(k.period_start) into v_week from public.work_report_packages k where private.package_hr_visible(k.status);
  end if;
  if v_week is not null then
    perform private.week_check(v_week);
  end if;
  select coalesce(jsonb_agg(row_obj order by row_obj ->> 'name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'packageId', k.id,
      'departmentHeads', (select coalesce(jsonb_agg(h.full_name order by h.full_name), '[]'::jsonb) from public.profiles h
                           where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = d.id),
      'package', private.package_json(k),
      'reviews', private.hr_review_counts(k.id),
      'teamLeads', (select count(*) from private.hr_subjects(d.id) s where s.kind = 'TEAM_LEAD'),
      'teamMembers', (select count(*) from private.hr_subjects(d.id) s where s.kind = 'TEAM_MEMBER')) as row_obj
      from public.work_report_packages k join public.departments d on d.id = k.department_id
     where k.period_start = v_week and private.package_hr_visible(k.status)
  ) q;
  return jsonb_build_object('weekStart', v_week, 'weekEnd', v_week + 6, 'departments', v_rows,
    'weeks', coalesce((select jsonb_agg(w order by w desc) from (select distinct k.period_start as w from public.work_report_packages k where private.package_hr_visible(k.status)) x), '[]'::jsonb),
    'scale', (select s.rating_scale from public.report_settings s where s.id));
end $$;
revoke all on function public.hr_reviews_overview(date) from public, anon;
grant execute on function public.hr_reviews_overview(date) to authenticated;

-- One department's week opened up for review: Team Leads first, each with their Team Members. Every person has their own review record.
-- HR reads the weeks that were sent to it; the Super Admin reads the weeks HR submitted (and the ones in review).
create or replace function public.hr_reviews_department(p_package uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  k public.work_report_packages;
  v_leads jsonb;
begin
  select * into k from public.work_report_packages where id = p_package;
  if k.id is null or not (
       (private.is_hr_reviewer() and private.package_hr_visible(k.status))
    or (private.report_level() = 'SUPER_ADMIN' and k.status not in ('DRAFT', 'COMPILING', 'REVISION_REQUIRED'))) then
    raise exception 'NOT_FOUND: Weekly report not found.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.full_name, 'designation', l.designation, 'teamId', l.team_id, 'team', (select t.name from public.teams t where t.id = l.team_id),
      'stats', private.report_person_stats(l.id, k.period_start, k.period_end),
      'review', private.hr_review_json((select v from public.hr_performance_reviews v where v.package_id = k.id and v.subject_id = l.id)),
      'teamStats', (select tt from jsonb_array_elements(private.report_scope_stats(k.department_id, null, k.period_start, k.period_end) -> 'teams') tt where (tt ->> 'teamId')::uuid = l.team_id limit 1),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.full_name, 'designation', m.designation,
          'stats', private.report_person_stats(m.id, k.period_start, k.period_end),
          'review', private.hr_review_json((select v from public.hr_performance_reviews v where v.package_id = k.id and v.subject_id = m.id))) order by m.full_name)
         from private.hr_subjects(k.department_id) m where m.kind = 'TEAM_MEMBER' and m.team_id is not distinct from l.team_id), '[]'::jsonb)
    ) order by l.full_name), '[]'::jsonb) into v_leads
    from private.hr_subjects(k.department_id) l where l.kind = 'TEAM_LEAD';
  return jsonb_build_object(
    'package', private.package_json(k), 'departmentId', k.department_id, 'department', (select d.name from public.departments d where d.id = k.department_id),
    'periodStart', k.period_start, 'periodEnd', k.period_end, 'reviews', private.hr_review_counts(k.id),
    'stats', private.report_scope_stats(k.department_id, null, k.period_start, k.period_end),
    'teamLeads', v_leads,
    -- members whose team has no Team Lead in the department (still reviewed)
    'otherMembers', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.full_name, 'designation', m.designation,
          'stats', private.report_person_stats(m.id, k.period_start, k.period_end),
          'review', private.hr_review_json((select v from public.hr_performance_reviews v where v.package_id = k.id and v.subject_id = m.id))) order by m.full_name)
         from private.hr_subjects(k.department_id) m where m.kind = 'TEAM_MEMBER'
          and not exists (select 1 from private.hr_subjects(k.department_id) l where l.kind = 'TEAM_LEAD' and l.team_id is not distinct from m.team_id)), '[]'::jsonb),
    'scale', (select s.rating_scale from public.report_settings s where s.id),
    'canReview', private.is_hr_reviewer() and k.status <> 'SUBMITTED_TO_SUPERADMIN');
end $$;
revoke all on function public.hr_reviews_department(uuid) from public, anon;
grant execute on function public.hr_reviews_department(uuid) to authenticated;

-- The daily reports of one person in the week (lazy: loaded when a person is opened). Read only, with the approval records and revisions.
create or replace function public.hr_person_reports(p_package uuid, p_person uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  k public.work_report_packages;
begin
  select * into k from public.work_report_packages where id = p_package;
  if k.id is null or not (
       (private.is_hr_reviewer() and private.package_hr_visible(k.status))
    or (private.report_level() = 'SUPER_ADMIN' and k.status not in ('DRAFT', 'COMPILING', 'REVISION_REQUIRED'))) then
    raise exception 'NOT_FOUND: Weekly report not found.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from private.hr_subjects(k.department_id) s where s.id = p_person) then
    raise exception 'NOT_FOUND: Person not found in this department.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(private.report_json(r, true) || jsonb_build_object(
            'history', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'actor', e.actor_name, 'action', e.action, 'comment', e.comment, 'stage', e.stage, 'revision', e.revision) order by e.id)
                                   from public.work_report_events e where e.report_id = r.id and e.action <> 'OPENED'), '[]'::jsonb))
            order by r.report_date desc)
     from public.work_reports r where r.author_id = p_person and r.status <> 'DRAFT' and r.report_date between k.period_start and k.period_end), '[]'::jsonb);
end $$;
revoke all on function public.hr_person_reports(uuid, uuid) from public, anon;
grant execute on function public.hr_person_reports(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. HR: write a review (draft or final)
-- ---------------------------------------------------------------------------
create or replace function public.hr_review_save(
  p_package uuid, p_subject uuid, p_rating integer, p_consistency text, p_assessment text, p_comments text, p_recommendations text, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  k public.work_report_packages;
  s record;
  v public.hr_performance_reviews;
  v_counts jsonb;
  v_from text;
begin
  if not private.is_hr_reviewer() then
    raise exception 'FORBIDDEN: Performance reviews are written by HR.' using errcode = '42501';
  end if;
  select * into k from public.work_report_packages where id = p_package for update;
  if k.id is null or not private.package_hr_visible(k.status) then
    raise exception 'NOT_FOUND: Weekly report not found. It must be approved by the Operations Head first.' using errcode = 'P0001';
  end if;
  if k.status = 'SUBMITTED_TO_SUPERADMIN' then
    raise exception 'CONFLICT: This week was already submitted to the Super Admin.' using errcode = 'P0001';
  end if;
  select * into s from private.hr_subjects(k.department_id) x where x.id = p_subject;
  if s.id is null then
    raise exception 'NOT_FOUND: This person is not a Team Lead or Team Member of the department.' using errcode = 'P0001';
  end if;
  if p_subject = auth.uid() then
    raise exception 'FORBIDDEN: You cannot review yourself.' using errcode = '42501';
  end if;
  if p_rating is not null and private.rating_label(p_rating) is null then
    raise exception 'VALIDATION_ERROR: Choose a rating from the scale.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_consistency, '')) > 1000 or length(coalesce(p_assessment, '')) > 2000 or length(coalesce(p_comments, '')) > 2000 or length(coalesce(p_recommendations, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the comments short enough (2000 characters each).' using errcode = 'P0001';
  end if;
  if p_submit and (p_rating is null or (nullif(btrim(coalesce(p_assessment, '')), '') is null and nullif(btrim(coalesce(p_comments, '')), '') is null)) then
    raise exception 'VALIDATION_ERROR: Give a rating and write the work assessment or your comments before submitting the review.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select * into v from public.hr_performance_reviews where package_id = k.id and subject_id = p_subject for update;
  if v.id is not null and v.status = 'SUBMITTED' then
    raise exception 'CONFLICT: This review was already submitted. It stays in the history unchanged.' using errcode = 'P0001';
  end if;
  if v.id is null then
    insert into public.hr_performance_reviews (package_id, subject_id, subject_name, subject_designation, subject_kind, department_id, team_id, period_start, period_end,
                                               reviewer_id, reviewer_name, rating, consistency_note, work_assessment, comments, recommendations, status, metrics, submitted_at)
    values (k.id, s.id, s.full_name, s.designation, s.kind, k.department_id, s.team_id, k.period_start, k.period_end, me.id, me.full_name, p_rating,
            nullif(btrim(p_consistency), ''), nullif(btrim(p_assessment), ''), nullif(btrim(p_comments), ''), nullif(btrim(p_recommendations), ''),
            case when p_submit then 'SUBMITTED' else 'DRAFT' end,
            case when p_submit then private.report_person_stats(s.id, k.period_start, k.period_end) end,
            case when p_submit then now() end)
    returning * into v;
  else
    update public.hr_performance_reviews
       set reviewer_id = me.id, reviewer_name = me.full_name, rating = p_rating, consistency_note = nullif(btrim(p_consistency), ''),
           work_assessment = nullif(btrim(p_assessment), ''), comments = nullif(btrim(p_comments), ''), recommendations = nullif(btrim(p_recommendations), ''),
           status = case when p_submit then 'SUBMITTED' else 'DRAFT' end,
           metrics = case when p_submit then private.report_person_stats(s.id, k.period_start, k.period_end) else metrics end,
           submitted_at = case when p_submit then now() else submitted_at end, updated_at = now()
     where id = v.id returning * into v;
  end if;
  -- the weekly report moves with the reviews: first review = in progress, all reviews submitted = completed
  v_from := k.status;
  v_counts := private.hr_review_counts(k.id);
  if k.status = 'SENT_TO_HR' then
    update public.work_report_packages set status = 'HR_REVIEW_IN_PROGRESS', updated_at = now() where id = k.id returning * into k;
    perform private.package_event(k.id, 'HR_STARTED', v_from, k.status, null, k.revision);
  end if;
  if k.status = 'HR_REVIEW_IN_PROGRESS' and (v_counts ->> 'expected')::int > 0 and (v_counts ->> 'submitted')::int >= (v_counts ->> 'expected')::int then
    update public.work_report_packages set status = 'HR_REVIEW_COMPLETED', hr_completed_at = now(), updated_at = now() where id = k.id returning * into k;
    perform private.package_event(k.id, 'HR_COMPLETED', 'HR_REVIEW_IN_PROGRESS', k.status, null, k.revision);
  end if;
  perform private.write_audit(case when p_submit then 'HR_REVIEW_SUBMITTED' else 'HR_REVIEW_SAVED' end, 'hr_review', v.id, k.department_id, v.team_id,
    jsonb_build_object('subject', v.subject_id, 'rating', v.rating, 'from', k.period_start, 'to', k.period_end));
  return private.hr_review_json(v) || jsonb_build_object('packageStatus', k.status, 'reviews', private.hr_review_counts(k.id));
end $$;
revoke all on function public.hr_review_save(uuid, uuid, integer, text, text, text, text, boolean) from public, anon;
grant execute on function public.hr_review_save(uuid, uuid, integer, text, text, text, text, boolean) to authenticated;

-- A person's earlier reviews (HR and the Super Admin): newest first, submitted ones only.
create or replace function public.hr_review_history(p_subject uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_hr_reviewer() or private.report_level() = 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Review history is for HR and the Super Admin.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(private.hr_review_json(v) || jsonb_build_object('department', (select d.name from public.departments d where d.id = v.department_id))
                                    order by v.period_end desc)
                     from public.hr_performance_reviews v where v.subject_id = p_subject and v.status = 'SUBMITTED'), '[]'::jsonb);
end $$;
revoke all on function public.hr_review_history(uuid) from public, anon;
grant execute on function public.hr_review_history(uuid) to authenticated;

-- All submitted reviews, filterable (the Review History tab), paged in the database.
create or replace function public.hr_review_log(p_department uuid default null, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not (private.is_hr_reviewer() or private.report_level() = 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Review history is for HR and the Super Admin.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.hr_performance_reviews v where v.status = 'SUBMITTED' and (p_department is null or v.department_id = p_department)
                and (v_search is null or v.subject_name ilike '%' || v_search || '%')),
    'items', coalesce((select jsonb_agg(x) from (
       select private.hr_review_json(v) || jsonb_build_object('department', (select d.name from public.departments d where d.id = v.department_id)) as x
         from public.hr_performance_reviews v
        where v.status = 'SUBMITTED' and (p_department is null or v.department_id = p_department)
          and (v_search is null or v.subject_name ilike '%' || v_search || '%')
        order by v.period_end desc, v.subject_name
        limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) q), '[]'::jsonb));
end $$;
revoke all on function public.hr_review_log(uuid, text, integer, integer) from public, anon;
grant execute on function public.hr_review_log(uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. HR: the consolidated report to the Super Admin
-- ---------------------------------------------------------------------------
-- What is complete and what is still pending for a week.
create or replace function private.hr_consolidated_readiness(p_week date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_done jsonb;
  v_pending jsonb;
  v_waiting jsonb;
begin
  -- weeks of departments that reached HR: complete when every Team Lead and Team Member has a submitted review
  select coalesce(jsonb_agg(x order by x ->> 'department') filter (where (x ->> 'complete')::boolean), '[]'::jsonb),
         coalesce(jsonb_agg(x order by x ->> 'department') filter (where not (x ->> 'complete')::boolean), '[]'::jsonb)
    into v_done, v_pending from (
    select jsonb_build_object('packageId', k.id, 'departmentId', d.id, 'department', d.name, 'status', k.status, 'revision', k.revision,
        'reviews', private.hr_review_counts(k.id),
        'complete', (private.hr_review_counts(k.id) ->> 'expected')::int > 0
                    and (private.hr_review_counts(k.id) ->> 'submitted')::int >= (private.hr_review_counts(k.id) ->> 'expected')::int,
        'alreadySubmitted', k.status = 'SUBMITTED_TO_SUPERADMIN',
        'missingReviews', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'kind', s.kind, 'draft', v.status = 'DRAFT') order by s.full_name)
                                      from private.hr_subjects(k.department_id) s
                                      left join public.hr_performance_reviews v on v.package_id = k.id and v.subject_id = s.id
                                     where v.id is null or v.status <> 'SUBMITTED'), '[]'::jsonb),
        -- approvals and revisions still open in the department that week (the daily reports themselves are never changed by HR)
        'openApprovals', (private.report_scope_stats(k.department_id, null, k.period_start, k.period_end) -> 'pendingTl')::int
                         + (private.report_scope_stats(k.department_id, null, k.period_start, k.period_end) -> 'pendingDh')::int,
        'openRevisions', (private.report_scope_stats(k.department_id, null, k.period_start, k.period_end) -> 'revision')::int) as x
      from public.work_report_packages k join public.departments d on d.id = k.department_id
     where k.period_start = p_week and private.package_hr_visible(k.status)) q;
  -- departments whose weekly report has not reached HR yet
  select coalesce(jsonb_agg(jsonb_build_object('departmentId', d.id, 'department', d.name,
           'status', coalesce(k.status, 'NOT_SUBMITTED')) order by d.name), '[]'::jsonb) into v_waiting
    from public.departments d
    left join public.work_report_packages k on k.department_id = d.id and k.period_start = p_week
   where d.facet_of is null and exists (select 1 from private.report_people(d.id, null))
     and (k.id is null or not private.package_hr_visible(k.status));
  return jsonb_build_object('complete', v_done, 'pending', v_pending, 'notReceived', v_waiting);
end $$;
revoke all on function private.hr_consolidated_readiness(date) from public, anon, authenticated;

create or replace function public.hr_consolidated_get(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hr_consolidated_reports;
  v_readiness jsonb;
begin
  if not private.is_hr_reviewer() then
    raise exception 'FORBIDDEN: The consolidated performance report is prepared by HR.' using errcode = '42501';
  end if;
  perform private.week_check(p_week_start);
  select * into c from public.hr_consolidated_reports where period_start = p_week_start;
  v_readiness := private.hr_consolidated_readiness(p_week_start);
  return jsonb_build_object('weekStart', p_week_start, 'weekEnd', p_week_start + 6, 'readiness', v_readiness,
    'report', case when c.id is null then null else jsonb_build_object('id', c.id, 'status', c.status, 'note', c.note, 'revision', c.revision,
        'submittedBy', c.submitted_by_name, 'submittedAt', c.submitted_at, 'snapshot', c.readiness) end,
    -- Pending HR Review / Partially Reviewed / HR Review Completed / Submitted to Superadmin / AI Analysis Completed
    'stage', case
      when c.status = 'AI_ANALYSIS_COMPLETED' then 'AI_ANALYSIS_COMPLETED'
      when c.status = 'SUBMITTED_TO_SUPERADMIN' and jsonb_array_length(v_readiness -> 'pending') = 0 then 'SUBMITTED_TO_SUPERADMIN'
      when jsonb_array_length(v_readiness -> 'complete') + jsonb_array_length(v_readiness -> 'pending') = 0 then 'PENDING_HR_REVIEW'
      when jsonb_array_length(v_readiness -> 'pending') = 0 and jsonb_array_length(v_readiness -> 'notReceived') = 0 then 'HR_REVIEW_COMPLETED'
      when exists (select 1 from public.hr_performance_reviews v join public.work_report_packages k on k.id = v.package_id where k.period_start = p_week_start) then 'PARTIALLY_REVIEWED'
      else 'PENDING_HR_REVIEW' end,
    'weeks', coalesce((select jsonb_agg(w order by w desc) from (select distinct k.period_start as w from public.work_report_packages k where private.package_hr_visible(k.status)) x), '[]'::jsonb));
end $$;
revoke all on function public.hr_consolidated_get(date) from public, anon;
grant execute on function public.hr_consolidated_get(date) to authenticated;

-- Save the note (a draft) or submit: every fully reviewed weekly package of the week goes to the Super Admin; packages that are not fully
-- reviewed stay with HR, unfinished, and are listed as pending in the record.
create or replace function public.hr_consolidated_save(p_week_start date, p_note text, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.hr_consolidated_reports;
  v_readiness jsonb;
  x jsonb;
  v_n int := 0;
  v_sa uuid;
  k public.work_report_packages;
begin
  if not private.is_hr_reviewer() then
    raise exception 'FORBIDDEN: The consolidated performance report is prepared by HR.' using errcode = '42501';
  end if;
  perform private.week_check(p_week_start);
  if length(coalesce(p_note, '')) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 4000 characters.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select * into c from public.hr_consolidated_reports where period_start = p_week_start for update;
  if c.id is null then
    insert into public.hr_consolidated_reports (period_start, period_end, note, created_by) values (p_week_start, p_week_start + 6, nullif(btrim(p_note), ''), me.id)
    returning * into c;
  else
    update public.hr_consolidated_reports set note = nullif(btrim(p_note), ''), updated_at = now() where id = c.id returning * into c;
  end if;
  if p_submit then
    v_readiness := private.hr_consolidated_readiness(p_week_start);
    -- only packages that are complete and not sent before
    for x in select * from jsonb_array_elements(v_readiness -> 'complete') loop
      continue when (x ->> 'alreadySubmitted')::boolean;
      select * into k from public.work_report_packages where id = (x ->> 'packageId')::uuid for update;
      update public.work_report_packages set status = 'SUBMITTED_TO_SUPERADMIN', updated_at = now() where id = k.id returning * into k;
      perform private.package_event(k.id, 'SUBMITTED_TO_SUPERADMIN', 'HR_REVIEW_COMPLETED', k.status, null, k.revision);
      insert into public.hr_consolidated_packages (consolidated_id, package_id, included_revision) values (c.id, k.id, k.revision) on conflict do nothing;
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      raise exception 'CONFLICT: No department of this week has every review submitted yet. Save the report as a draft and finish the reviews.' using errcode = 'P0001';
    end if;
    update public.hr_consolidated_reports
       set status = 'SUBMITTED_TO_SUPERADMIN', revision = revision + 1, readiness = private.hr_consolidated_readiness(p_week_start),
           submitted_by = me.id, submitted_by_name = me.full_name, submitted_at = now(), updated_at = now()
     where id = c.id returning * into c;
    for v_sa in select * from private.super_admin_ids() loop
      perform private.notify(v_sa, 'REPORT_CONSOLIDATED_SUBMITTED', 'Consolidated performance report received',
        format('HR submitted the company performance report for %s to %s (%s department%s).', to_char(c.period_start, 'DD Mon'), to_char(c.period_end, 'DD Mon YYYY'), v_n, case when v_n = 1 then '' else 's' end),
        'hr_consolidated_report', c.id);
    end loop;
    insert into public.work_report_signals (recipient_id, report_id, event)
      select s, null, 'CONSOLIDATED' from private.super_admin_ids() s;
    perform private.write_audit('HR_CONSOLIDATED_SUBMITTED', 'hr_consolidated_report', c.id, null, null,
      jsonb_build_object('from', c.period_start, 'to', c.period_end, 'departments', v_n, 'revision', c.revision,
                         'pending', jsonb_array_length(c.readiness -> 'pending'), 'notReceived', jsonb_array_length(c.readiness -> 'notReceived')));
  end if;
  return jsonb_build_object('id', c.id, 'status', c.status, 'note', c.note, 'revision', c.revision, 'submittedAt', c.submitted_at, 'submittedDepartments', v_n);
end $$;
revoke all on function public.hr_consolidated_save(date, text, boolean) from public, anon;
grant execute on function public.hr_consolidated_save(date, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Live updates: HR reviews and the consolidated report tell the people concerned
-- ---------------------------------------------------------------------------
create or replace function private.tg_hr_review_signal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.work_report_signals (recipient_id, report_id, event)
  select distinct h, null::uuid, 'HR_REVIEW' from private.hr_reviewer_ids() h;
  return new;
end $$;
revoke all on function private.tg_hr_review_signal() from public, anon, authenticated;
drop trigger if exists hr_reviews_signal on public.hr_performance_reviews;
create trigger hr_reviews_signal after insert or update of status on public.hr_performance_reviews
  for each row execute function private.tg_hr_review_signal();

notify pgrst, 'reload schema';
