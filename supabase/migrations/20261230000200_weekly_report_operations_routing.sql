-- =============================================================================
-- Fix: "No Operations Head manages this department yet" when a Department Head submits the weekly report (and their own daily report).
--
-- ROOT CAUSE. Every report check found the Operations Head through private.owner_of_department(department): the ONE department-level owner
-- (department_operations_owner). 20261224000100 introduced separate Sales and Support Operations Heads per department
-- (department_function_owner, private.operations_owner_for), but the reports were never connected to it. A department whose Operations Heads
-- are named per function has no department-level owner, so the weekly report (and the Department Head's daily report) found nobody, and the
-- Operations Head's weekly board did not list that department at all. The weekly package was also unique per (department, week), so the
-- Sales and the Support Department Head of one department could not each send their own week.
--
-- WHAT THIS CHANGES (additive; no report, package, event or approval is changed or deleted):
--   * work_report_packages.division (SALES / SUPPORT; NULL = the whole department, as every existing package). The weekly package is unique per
--     (department, function, week) instead of (department, week).
--   * ONE resolver, private.weekly_reviewer_ids(department, function) = private.operations_owner_for: the active Operations Head named for that
--     function of the department, else the department-level owner ONLY when that owner's scope covers the function. A Support Operations Head is
--     never resolved for Sales (no whole-department fallback across functions). An inactive Operations Head is never resolved.
--   * A Department Head reports for the function they head, in the department they are working in (the header switcher). A head of both
--     functions in a department whose functions have separate Operations Heads sends a Sales and a Support week, each to its own Operations Head.
--   * The Department Head's own daily report goes to the Operations Head of the head's function (a head of both: the department-level owner, or
--     else the Sales and the Support Operations Heads).
--   * The Operations Head's weekly board, pending list, review, drill-down and the counts list exactly the (department, function) they are
--     accountable for. HR's reviews of a function's week cover the people of that function.
--   * Nobody to send it to: the submission is refused with a clear message (the draft is kept: the screen saves it first) and nothing is
--     approved by itself. The Super Admin sees every department/function without an eligible Operations Head in weekly_report_routing_review()
--     and assigns one with the existing Operations Head controls.
-- Run after 20261230000100. Safe to run twice.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shape: a weekly package belongs to a department AND a function
-- ---------------------------------------------------------------------------
alter table public.work_report_packages add column if not exists division text;
do $$
declare c record;
begin
  if not exists (select 1 from pg_constraint where conname = 'work_report_packages_division_check') then
    alter table public.work_report_packages add constraint work_report_packages_division_check check (division in ('SALES', 'SUPPORT'));
  end if;
  -- the (department, week) uniqueness becomes (department, function, week): the index below replaces it
  for c in select conname from pg_constraint
            where conrelid = 'public.work_report_packages'::regclass and contype = 'u'
              and pg_get_constraintdef(oid) = 'UNIQUE (department_id, period_start, period_end)' loop
    execute format('alter table public.work_report_packages drop constraint %I', c.conname);
  end loop;
end $$;
create unique index if not exists work_report_packages_scope_uidx
  on public.work_report_packages (department_id, coalesce(division, ''), period_start, period_end);

-- ---------------------------------------------------------------------------
-- 2. Who reviews: one resolver
-- ---------------------------------------------------------------------------
-- The Operations Head of a department's function (NULL = the whole department). Empty = nobody eligible: a configuration issue.
create or replace function private.weekly_reviewer_ids(p_department uuid, p_division text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select x.o from (select private.operations_owner_for(private.base_department(p_department), nullif(p_division, 'GENERAL')) as o) x
   where x.o is not null
$$;
revoke all on function private.weekly_reviewer_ids(uuid, text) from public, anon, authenticated;

-- Who reviews a Department Head's OWN daily report: the Operations Head of the head's function. A head of both functions: the whole
-- department's Operations Head, or (when the functions have separate ones) the Sales and the Support Operations Heads.
create or replace function private.head_report_reviewer_ids(p_department uuid, p_division text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select x from private.weekly_reviewer_ids(p_department, p_division) x
  union
  select y from (values ('SALES'), ('SUPPORT')) v (dv)
         cross join lateral private.weekly_reviewer_ids(p_department, v.dv) y
   where p_division is null and not exists (select 1 from private.weekly_reviewer_ids(p_department, null))
$$;
revoke all on function private.head_report_reviewer_ids(uuid, text) from public, anon, authenticated;

-- The function a daily report belongs to: a Department Head's = the function they head in that department; anyone else's = their team's.
create or replace function private.report_division(r public.work_reports)
returns text language sql stable security definer set search_path = '' as $$
  select case when r.kind = 'DEPARTMENT_HEAD' then private.scope_division_in(r.author_id, r.department_id)
              else (select nullif(t.division::text, 'GENERAL') from public.teams t where t.id = r.team_id) end
$$;
revoke all on function private.report_division(public.work_reports) from public, anon, authenticated;

-- The Operations Head(s) of a report (its function's).
create or replace function private.report_oh_ids(r public.work_reports)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select x from private.head_report_reviewer_ids(r.department_id, private.report_division(r)) x
$$;
revoke all on function private.report_oh_ids(public.work_reports) from public, anon, authenticated;

-- The reviewers of a report at its own stage (a Team Member's report keeps its Team Lead rule, in the functions that call this).
create or replace function private.report_reviewers_of(r public.work_reports)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select x from private.report_oh_ids(r) x where r.kind = 'DEPARTMENT_HEAD'
  union
  select y from private.report_reviewer_ids(r.kind, r.department_id, r.team_id) y where r.kind <> 'DEPARTMENT_HEAD'
$$;
revoke all on function private.report_reviewers_of(public.work_reports) from public, anon, authenticated;

-- The old resolver keeps its signature; its Department Head branch now uses the same rule (whole department), never the bare owner.
create or replace function private.report_reviewer_ids(p_kind text, p_department uuid, p_team uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
   where p.status = 'ACTIVE' and (
        (p_kind = 'MEMBER' and p.role = 'TEAM_HEAD' and p.team_id is not null and p.team_id = p_team)
     or (p_kind = 'TEAM_LEAD' and private.head_covers(p.id, p_department, p_team)))
  union
  select x from private.head_report_reviewer_ids(p_department, null) x where p_kind = 'DEPARTMENT_HEAD'
$$;
revoke all on function private.report_reviewer_ids(text, uuid, uuid) from public, anon, authenticated;

-- The departments an Operations Head reports on: those they are accountable for (whole department or one function); the Super Admin: all.
create or replace function private.report_scope_departments()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select d.id from public.departments d where d.facet_of is null and private.report_level() = 'SUPER_ADMIN'
  union
  select d.id from public.departments d
   where d.facet_of is null and private.report_level() = 'OPERATIONS_HEAD'
     and (private.owner_of_department(d.id) = auth.uid()
          or exists (select 1 from (values (null::text), ('SALES'), ('SUPPORT')) v (dv)
                      where auth.uid() in (select private.weekly_reviewer_ids(d.id, v.dv))))
$$;
revoke all on function private.report_scope_departments() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The weekly scopes: one weekly report per (department, function) a Department Head heads
-- ---------------------------------------------------------------------------
-- The weekly report(s) a head scope sends: its function; a head of both functions sends one for the whole department when a whole-department
-- Operations Head exists (or no Operations Head at all, so the configuration issue shows), else one per function that has teams.
create or replace function private.weekly_scope_options(p_department uuid, p_division text)
returns table (division text) language sql stable security definer set search_path = '' as $$
  select p_division where p_division is not null
  union all
  select null::text
   where p_division is null
     and (exists (select 1 from private.weekly_reviewer_ids(p_department, null))
          or not exists (select 1 from (values ('SALES'), ('SUPPORT')) v (dv) cross join lateral private.weekly_reviewer_ids(p_department, v.dv) y))
  union all
  select v.dv from (values ('SALES'), ('SUPPORT')) v (dv)
   where p_division is null
     and not exists (select 1 from private.weekly_reviewer_ids(p_department, null))
     and exists (select 1 from (values ('SALES'), ('SUPPORT')) w (dv) cross join lateral private.weekly_reviewer_ids(p_department, w.dv) y)
     and exists (select 1 from public.teams t where t.department_id = private.base_department(p_department) and t.division::text = v.dv)
$$;
revoke all on function private.weekly_scope_options(uuid, text) from public, anon, authenticated;

-- Every weekly scope of the company: the scopes of the active Department Heads, expanded as above.
create or replace function private.weekly_scopes()
returns table (department_id uuid, division text) language sql stable security definer set search_path = '' as $$
  select distinct s.department_id, o.division
    from public.profiles h
    cross join lateral private.scopes_of(h.id) s
    cross join lateral private.weekly_scope_options(s.department_id, s.division) o
   where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE'
$$;
revoke all on function private.weekly_scopes() from public, anon, authenticated;

-- The Department Heads who prepare a weekly scope (a package of the whole department made before this migration: every head of the department).
create or replace function private.weekly_scope_heads(p_department uuid, p_division text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select h.id from public.profiles h
   where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE'
     and exists (select 1 from private.scopes_of(h.id) s
                  where s.department_id = private.base_department(p_department)
                    and (s.division is not distinct from p_division or (s.division is null and p_division is not null)))
  union
  select h.id from public.profiles h
   where p_division is null and h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE'
     and private.base_department(h.department_id) = private.base_department(p_department)
$$;
revoke all on function private.weekly_scope_heads(uuid, text) from public, anon, authenticated;

-- The package of a scope and period: the function's own, else (made before this migration) the whole department's.
create or replace function private.weekly_package(p_department uuid, p_division text, p_from date, p_to date)
returns public.work_report_packages language sql stable security definer set search_path = '' as $$
  select k from public.work_report_packages k
   where k.department_id = private.base_department(p_department) and k.period_start = p_from and k.period_end = p_to
     and (k.division is not distinct from p_division or k.division is null)
   order by (k.division is not distinct from p_division) desc
   limit 1
$$;
revoke all on function private.weekly_package(uuid, text, date, date) from public, anon, authenticated;

-- The signed-in Department Head's weekly scope: the department they are working in and the function they head there. A head of both
-- functions chooses ('SALES' / 'SUPPORT' / 'ALL') among the options; nothing chosen = the first option.
create or replace function private.my_weekly_scope(p_division text)
returns table (department_id uuid, division text) language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid;
  v_div text;
  v_want text := nullif(upper(btrim(coalesce(p_division, ''))), '');
begin
  select a.department_id, a.head_division into v_dept, v_div from private.assigner_department(null) a;
  if v_want is not null and v_want not in ('SALES', 'SUPPORT', 'ALL') then
    raise exception 'VALIDATION_ERROR: Choose Sales, Support or the whole department.' using errcode = 'P0001';
  end if;
  if v_div is not null then
    if v_want is not null and v_want <> v_div then
      raise exception 'FORBIDDEN: You prepare the weekly report of the % function only.', initcap(v_div) using errcode = '42501';
    end if;
    return query select v_dept, v_div;
    return;
  end if;
  if v_want is null then
    return query select v_dept, o.division from private.weekly_scope_options(v_dept, null) o
                 order by case when o.division is null then 0 when o.division = 'SALES' then 1 else 2 end limit 1;
    return;
  end if;
  if not exists (select 1 from private.weekly_scope_options(v_dept, null) o where o.division is not distinct from nullif(v_want, 'ALL')) then
    raise exception 'VALIDATION_ERROR: This department''s weekly report is not sent for that function.' using errcode = 'P0001';
  end if;
  return query select v_dept, nullif(v_want, 'ALL');
end $$;
revoke all on function private.my_weekly_scope(text) from public, anon, authenticated;

create or replace function private.function_label(p_division text)
returns text language sql immutable set search_path = '' as $$
  select case p_division when 'SALES' then 'Sales' when 'SUPPORT' then 'Support' else 'Whole department' end
$$;
revoke all on function private.function_label(text) from public, anon, authenticated;

-- The message shown when a scope has no eligible Operations Head (null = it has one).
create or replace function private.weekly_routing_issue(p_department uuid, p_division text)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from private.weekly_reviewer_ids(p_department, p_division)) then null
    else format('No active Operations Head is assigned to %s%s. The Super Admin can assign one under Operations Heads; until then the weekly report cannot be submitted (drafts are kept).',
                (select d.name from public.departments d where d.id = private.base_department(p_department)),
                case when p_division is null then ' (whole department)' else ' ' || private.function_label(p_division) end) end
$$;
revoke all on function private.weekly_routing_issue(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Figures and people of a function: report_scope_stats with a function, HR's people of a function's week
-- ---------------------------------------------------------------------------
-- (copy of the latest private.report_scope_stats, 20261221000100, with the people narrowed to the function; NULL = as before)

create or replace function private.report_scope_stats(p_department uuid, p_head uuid, p_from date, p_to date, p_division text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_totals jsonb;
  v_teams jsonb;
  v_missing jsonb;
begin
  with ppl as (select x.* from private.report_people(p_department, p_head) x
              where p_division is null
                 or (x.kind = 'DEPARTMENT_HEAD' and exists (select 1 from public.profiles a where a.id = x.id and a.head_division = p_division))
                 or (x.kind <> 'DEPARTMENT_HEAD' and x.team_id is not null and private.team_in_division(x.team_id, p_division))),
  rep as (
    select r.* from public.work_reports r join ppl on ppl.id = r.author_id
     where r.status <> 'DRAFT' and r.report_date between p_from and p_to
  ),
  per as (
    select ppl.id, ppl.kind, ppl.team_id, ppl.full_name, ppl.designation,
           private.report_expected_days(ppl.id, p_from, p_to) as expected,
           (select count(*) from rep x where x.author_id = ppl.id) as submitted,
           (select count(*) from rep x where x.author_id = ppl.id and x.status = 'APPROVED') as approved,
           (select count(*) from rep x where x.author_id = ppl.id and x.kind = 'MEMBER' and x.status in ('SUBMITTED', 'UNDER_REVIEW')) as pending_tl,
           (select count(*) from rep x where x.author_id = ppl.id
               and ((x.kind = 'MEMBER' and x.status = 'PENDING_DEPARTMENT_HEAD') or (x.kind = 'TEAM_LEAD' and x.status in ('SUBMITTED', 'UNDER_REVIEW')))) as pending_dh,
           (select count(*) from rep x where x.author_id = ppl.id and x.kind = 'DEPARTMENT_HEAD' and x.status in ('SUBMITTED', 'UNDER_REVIEW')) as pending_oh,
           (select count(*) from rep x where x.author_id = ppl.id and x.status = 'REVISION_REQUIRED') as revision,
           (select count(*) from rep x where x.author_id = ppl.id and x.status = 'REJECTED') as rejected,
           (select count(distinct t ->> 'id') from rep x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.content -> 'assignedTasks') = 'array' then x.content -> 'assignedTasks' else '[]'::jsonb end) t
             where x.author_id = ppl.id and t ->> 'id' is not null) as assigned,
           (select count(distinct t ->> 'id') from rep x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.content -> 'completedTasks') = 'array' then x.content -> 'completedTasks' else '[]'::jsonb end) t
             where x.author_id = ppl.id and t ->> 'id' is not null) as completed
      from ppl
  )
  select
    (select jsonb_build_object(
        'members', count(*) filter (where kind = 'MEMBER'), 'teamLeads', count(*) filter (where kind = 'TEAM_LEAD'), 'departmentHeads', count(*) filter (where kind = 'DEPARTMENT_HEAD'),
        'expected', coalesce(sum(expected), 0), 'submitted', coalesce(sum(submitted), 0),
        'pendingTl', coalesce(sum(pending_tl), 0), 'pendingDh', coalesce(sum(pending_dh), 0), 'pendingOh', coalesce(sum(pending_oh), 0),
        'approved', coalesce(sum(approved), 0), 'revision', coalesce(sum(revision), 0), 'rejected', coalesce(sum(rejected), 0),
        'assignedTasks', coalesce(sum(assigned), 0), 'completedTasks', coalesce(sum(completed), 0),
        'completionRate', case when coalesce(sum(assigned), 0) > 0 then round(100.0 * sum(completed) / sum(assigned), 1) end,
        'compliance', case when coalesce(sum(expected), 0) > 0 then least(100, round(100.0 * sum(submitted) / sum(expected), 1)) end)
       from per),
    (select coalesce(jsonb_agg(t order by t ->> 'team'), '[]'::jsonb) from (
       select jsonb_build_object(
         'teamId', tm.id, 'team', tm.name,
         'lead', (select string_agg(pp.full_name, ', ' order by pp.full_name) from per pp where pp.team_id = tm.id and pp.kind = 'TEAM_LEAD'),
         'members', count(*) filter (where per.kind = 'MEMBER'),
         'expected', coalesce(sum(per.expected), 0), 'submitted', coalesce(sum(per.submitted), 0), 'approved', coalesce(sum(per.approved), 0),
         'pendingTl', coalesce(sum(per.pending_tl), 0), 'pendingDh', coalesce(sum(per.pending_dh), 0),
         'assignedTasks', coalesce(sum(per.assigned), 0), 'completedTasks', coalesce(sum(per.completed), 0),
         'completionRate', case when coalesce(sum(per.assigned), 0) > 0 then round(100.0 * sum(per.completed) / sum(per.assigned), 1) end,
         'compliance', case when coalesce(sum(per.expected), 0) > 0 then least(100, round(100.0 * sum(per.submitted) / sum(per.expected), 1)) end) as t
        from per join public.teams tm on tm.id = per.team_id
       group by tm.id, tm.name) q),
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'designation', designation, 'kind', kind, 'expected', expected) order by full_name), '[]'::jsonb)
       from (select * from per where expected > 0 and submitted = 0 order by full_name limit 200) m)
    into v_totals, v_teams, v_missing;
  return v_totals || jsonb_build_object('teams', v_teams, 'missing', v_missing);
end $$;

revoke all on function private.report_scope_stats(uuid, uuid, date, date, text) from public, anon, authenticated;


-- The people HR reviews in a week of a function (NULL = the whole department, as before).
create or replace function private.hr_subjects(p_department uuid, p_division text)
returns table (id uuid, kind text, team_id uuid, full_name text, designation text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.kind, s.team_id, s.full_name, s.designation from private.hr_subjects(p_department) s
   where p_division is null or (s.team_id is not null and private.team_in_division(s.team_id, p_division))
$$;
revoke all on function private.hr_subjects(uuid, text) from public, anon, authenticated;

-- (copies of the latest HR review functions, 20261221000300: the people of the package's function)

create or replace function private.hr_review_counts(p_package uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'expected', (select count(*) from private.hr_subjects(k.department_id, k.division)),
    'submitted', (select count(*) from public.hr_performance_reviews v where v.package_id = k.id and v.status = 'SUBMITTED'
                    and v.subject_id in (select id from private.hr_subjects(k.department_id, k.division))),
    'drafts', (select count(*) from public.hr_performance_reviews v where v.package_id = k.id and v.status = 'DRAFT'
                 and v.subject_id in (select id from private.hr_subjects(k.department_id, k.division))))
  from public.work_report_packages k where k.id = p_package
$$;

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
      'id', d.id, 'name', d.name, 'function', coalesce(k.division, 'ALL'), 'packageId', k.id,
      'departmentHeads', (select coalesce(jsonb_agg(h.full_name order by h.full_name), '[]'::jsonb) from public.profiles h
                           where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = d.id),
      'package', private.package_json(k),
      'reviews', private.hr_review_counts(k.id),
      'teamLeads', (select count(*) from private.hr_subjects(d.id, k.division) s where s.kind = 'TEAM_LEAD'),
      'teamMembers', (select count(*) from private.hr_subjects(d.id, k.division) s where s.kind = 'TEAM_MEMBER')) as row_obj
      from public.work_report_packages k join public.departments d on d.id = k.department_id
     where k.period_start = v_week and private.package_hr_visible(k.status)
  ) q;
  return jsonb_build_object('weekStart', v_week, 'weekEnd', v_week + 6, 'departments', v_rows,
    'weeks', coalesce((select jsonb_agg(w order by w desc) from (select distinct k.period_start as w from public.work_report_packages k where private.package_hr_visible(k.status)) x), '[]'::jsonb),
    'scale', (select s.rating_scale from public.report_settings s where s.id));
end $$;

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
      'teamStats', (select tt from jsonb_array_elements(private.report_scope_stats(k.department_id, null, k.period_start, k.period_end, k.division) -> 'teams') tt where (tt ->> 'teamId')::uuid = l.team_id limit 1),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.full_name, 'designation', m.designation,
          'stats', private.report_person_stats(m.id, k.period_start, k.period_end),
          'review', private.hr_review_json((select v from public.hr_performance_reviews v where v.package_id = k.id and v.subject_id = m.id))) order by m.full_name)
         from private.hr_subjects(k.department_id, k.division) m where m.kind = 'TEAM_MEMBER' and m.team_id is not distinct from l.team_id), '[]'::jsonb)
    ) order by l.full_name), '[]'::jsonb) into v_leads
    from private.hr_subjects(k.department_id, k.division) l where l.kind = 'TEAM_LEAD';
  return jsonb_build_object(
    'package', private.package_json(k), 'departmentId', k.department_id, 'department', (select d.name from public.departments d where d.id = k.department_id),
    'periodStart', k.period_start, 'periodEnd', k.period_end, 'reviews', private.hr_review_counts(k.id),
    'stats', private.report_scope_stats(k.department_id, null, k.period_start, k.period_end, k.division),
    'teamLeads', v_leads,
    -- members whose team has no Team Lead in the department (still reviewed)
    'otherMembers', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.full_name, 'designation', m.designation,
          'stats', private.report_person_stats(m.id, k.period_start, k.period_end),
          'review', private.hr_review_json((select v from public.hr_performance_reviews v where v.package_id = k.id and v.subject_id = m.id))) order by m.full_name)
         from private.hr_subjects(k.department_id, k.division) m where m.kind = 'TEAM_MEMBER'
          and not exists (select 1 from private.hr_subjects(k.department_id, k.division) l where l.kind = 'TEAM_LEAD' and l.team_id is not distinct from m.team_id)), '[]'::jsonb),
    'scale', (select s.rating_scale from public.report_settings s where s.id),
    'canReview', private.is_hr_reviewer() and k.status <> 'SUBMITTED_TO_SUPERADMIN');
end $$;

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
  if not exists (select 1 from private.hr_subjects(k.department_id, k.division) s where s.id = p_person) then
    raise exception 'NOT_FOUND: Person not found in this department.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(private.report_json(r, true) || jsonb_build_object(
            'history', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'actor', e.actor_name, 'action', e.action, 'comment', e.comment, 'stage', e.stage, 'revision', e.revision) order by e.id)
                                   from public.work_report_events e where e.report_id = r.id and e.action <> 'OPENED'), '[]'::jsonb))
            order by r.report_date desc)
     from public.work_reports r where r.author_id = p_person and r.status <> 'DRAFT' and r.report_date between k.period_start and k.period_end), '[]'::jsonb);
end $$;

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
  select * into s from private.hr_subjects(k.department_id, k.division) x where x.id = p_subject;
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
    select jsonb_build_object('packageId', k.id, 'departmentId', d.id, 'department', d.name, 'function', coalesce(k.division, 'ALL'), 'status', k.status, 'revision', k.revision,
        'reviews', private.hr_review_counts(k.id),
        'complete', (private.hr_review_counts(k.id) ->> 'expected')::int > 0
                    and (private.hr_review_counts(k.id) ->> 'submitted')::int >= (private.hr_review_counts(k.id) ->> 'expected')::int,
        'alreadySubmitted', k.status = 'SUBMITTED_TO_SUPERADMIN',
        'missingReviews', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'kind', s.kind, 'draft', v.status = 'DRAFT') order by s.full_name)
                                      from private.hr_subjects(k.department_id, k.division) s
                                      left join public.hr_performance_reviews v on v.package_id = k.id and v.subject_id = s.id
                                     where v.id is null or v.status <> 'SUBMITTED'), '[]'::jsonb),
        -- approvals and revisions still open in the department that week (the daily reports themselves are never changed by HR)
        'openApprovals', (private.report_scope_stats(k.department_id, null, k.period_start, k.period_end, k.division) -> 'pendingTl')::int
                         + (private.report_scope_stats(k.department_id, null, k.period_start, k.period_end, k.division) -> 'pendingDh')::int,
        'openRevisions', (private.report_scope_stats(k.department_id, null, k.period_start, k.period_end, k.division) -> 'revision')::int) as x
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


-- ---------------------------------------------------------------------------
-- 5. The daily reports of a Department Head go to the Operations Head of their function (copies of the latest definitions, the resolver changed)
-- ---------------------------------------------------------------------------

create or replace function private.is_report_reviewer(r public.work_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.author_id is distinct from auth.uid()
     and case when r.kind = 'MEMBER' then
           private.report_lead_of(r) is not distinct from auth.uid()
           or (r.tl_status = 'APPROVED' and private.head_covers(auth.uid(), r.department_id, r.team_id))
         else
           private.report_level() = 'SUPER_ADMIN'
           or exists (select 1 from private.report_reviewers_of(r) x where x = auth.uid())
         end
$$;

create or replace function public.work_report_submit(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.work_reports;
  v_from text;
  v_action text;
  v_reviewer uuid;
  v_n int := 0;
  v_lead uuid;
  v_lead_name text;
  v_content jsonb;
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
  -- the task records are checked again now: a task reopened since the draft was saved cannot be sent as completed
  v_content := private.clean_task_report(r.content, r.content);
  if jsonb_array_length(v_content -> 'assignedTasks') = 0 and nullif(btrim(coalesce(v_content ->> 'remarks', '')), '') is null then
    raise exception 'VALIDATION_ERROR: Choose your assigned tasks or write a short remark before submitting.' using errcode = 'P0001';
  end if;
  if private.report_date_taken(r.author_id, r.report_date, r.id) then
    raise exception 'CONFLICT: You already have a report for this date.' using errcode = 'P0001';
  end if;
  -- the reviewer must exist now, so a report is never submitted into the void
  -- a Team Member's report goes to THEIR Team Lead (one person: the one shown, notified and allowed to decide)
  if r.kind = 'MEMBER' then
    v_lead := private.direct_lead_of(r.author_id);
    v_n := case when v_lead is null then 0 else 1 end;
  else
    select count(*) into v_n from private.report_reviewers_of(r);
  end if;
  if v_n = 0 then
    raise exception 'CONFLICT: %', case r.kind
      when 'MEMBER' then 'You are not assigned to a Team Lead yet. Ask your Department Head to assign you, then submit again.'
      when 'TEAM_LEAD' then 'No Department Head is set for your department yet. Ask the Super Admin or HR.'
      else 'No active Operations Head is assigned to your department and function yet. Ask the Super Admin to assign one under Operations Heads.' end using errcode = 'P0001';
  end if;
  if r.kind = 'MEMBER' then
    select p.full_name into v_lead_name from public.profiles p where p.id = v_lead;
  end if;
  v_from := r.status;
  v_action := case when v_from = 'REVISION_REQUIRED' then 'RESUBMITTED' else 'SUBMITTED' end;
  -- a (re)submission starts the approval again: the stages are cleared (the earlier decisions and contents stay in the history)
  update public.work_reports
     set status = 'SUBMITTED', submitted_at = now(), updated_at = now(), content = v_content,
         revision = case when v_from = 'REVISION_REQUIRED' then revision + 1 else revision end,
         reviewed_by = null, reviewed_by_name = null, reviewed_at = null, review_comment = null,
         team_lead_id = case when kind = 'MEMBER' then v_lead else team_lead_id end,
         team_lead_name = case when kind = 'MEMBER' then v_lead_name else team_lead_name end,
         tl_status = case when kind = 'MEMBER' then 'PENDING' end, tl_reviewer_id = null, tl_reviewer_name = null, tl_reviewed_at = null, tl_comment = null,
         -- a Team Lead's own report has no Team Lead stage: it waits for the Department Head
         dh_status = case when kind = 'TEAM_LEAD' then 'PENDING' end, dh_reviewer_id = null, dh_reviewer_name = null, dh_reviewed_at = null, dh_comment = null,
         decision_stage = null
   where id = p_id returning * into r;
  perform private.report_event_stage(r.id, v_action, v_from, 'SUBMITTED', null, r.revision, null);
  update public.work_report_events set content = v_content
   where id = (select max(e.id) from public.work_report_events e where e.report_id = r.id);
  for v_reviewer in
    select q.x from (select v_lead as x where r.kind = 'MEMBER'
                     union all select y from private.report_reviewers_of(r) y where r.kind <> 'MEMBER') q loop
    perform private.notify(v_reviewer, case when v_action = 'RESUBMITTED' then 'REPORT_RESUBMITTED' else 'REPORT_SUBMITTED' end,
      format('%s: %s', case when v_action = 'RESUBMITTED' then 'Report resubmitted' else 'New report to review' end, r.author_name),
      format('"%s" (%s) is waiting for your review.', r.title, to_char(r.report_date, 'DD Mon YYYY')),
      'work_report', r.id);
  end loop;
  perform private.write_audit('WORK_REPORT_' || v_action, 'work_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'revision', r.revision));
  return private.report_json(r, true);
end $$;

create or replace function private.report_audience(r public.work_reports)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select r.author_id where r.author_id is not null
  union
  select private.report_lead_of(r) where r.kind = 'MEMBER' and private.report_lead_of(r) is not null
  union
  select p.id from public.profiles p where r.kind in ('MEMBER', 'TEAM_LEAD') and p.role = 'DEPARTMENT_HEAD' and private.head_covers(p.id, r.department_id, r.team_id)
  union
  select x from private.report_oh_ids(r) x
$$;

create or replace function private.package_json(p public.work_report_packages)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then jsonb_build_object('status', 'NOT_SUBMITTED')
    else jsonb_build_object('id', p.id, 'status', p.status, 'title', p.title, 'assignedOverview', p.assigned_overview, 'completedOverview', p.completed_overview,
      'note', p.note, 'revision', p.revision, 'submittedBy', p.submitted_by_name, 'submittedAt', p.submitted_at, 'periodType', p.period_type,
      'periodStart', p.period_start, 'periodEnd', p.period_end, 'stats', p.stats, 'function', coalesce(p.division, 'ALL'),
      'ohReviewer', p.oh_reviewer_name, 'ohReviewedAt', p.oh_reviewed_at, 'ohComment', p.oh_comment,
      'sentToHrAt', p.sent_to_hr_at, 'hrCompletedAt', p.hr_completed_at,
      'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'actor', e.actor_name, 'action', e.action, 'fromStatus', e.from_status,
                            'toStatus', e.to_status, 'comment', e.comment, 'revision', e.revision) order by e.id)
                           from public.work_report_package_events e where e.package_id = p.id), '[]'::jsonb)) end
$$;

create or replace function public.work_reports_operations(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
  v_me uuid := auth.uid();
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the company reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a valid reporting period.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(row_obj order by row_obj ->> 'name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'slug', d.slug, 'function', s.dv,
      'departmentHeads', (select coalesce(jsonb_agg(h.full_name order by h.full_name), '[]'::jsonb) from public.profiles h
                           where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = d.id
                             and (s.dv is null or h.head_division is null or h.head_division = s.dv)),
      'teamLeads', (select count(*) from public.profiles p where p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id and private.team_in_division(p.team_id, s.dv)),
      'teamMembers', (select count(*) from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id and private.team_in_division(p.team_id, s.dv)),
      'counts', jsonb_build_object(
        'submitted', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'memberApproved', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status = 'APPROVED' and r.period_end >= p_from and r.period_start <= p_to),
        'memberPending', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW', 'PENDING_DEPARTMENT_HEAD') and r.period_end >= p_from and r.period_start <= p_to),
        'memberPendingTl', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to),
        'memberPendingDh', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status = 'PENDING_DEPARTMENT_HEAD' and r.period_end >= p_from and r.period_start <= p_to),
        'memberRevision', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status = 'REVISION_REQUIRED' and r.period_end >= p_from and r.period_start <= p_to),
        'memberRejected', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status = 'REJECTED' and r.period_end >= p_from and r.period_start <= p_to),
        'teamLeadReports', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'TEAM_LEAD' and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'headReports', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'DEPARTMENT_HEAD' and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'headPending', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'DEPARTMENT_HEAD' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to)),
      'headReportStatus', (select r.status from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'DEPARTMENT_HEAD' and r.status <> 'DRAFT'
                              and r.period_end >= p_from and r.period_start <= p_to order by r.submitted_at desc limit 1),
      'lastSubmittedAt', (select max(r.submitted_at) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
      'package', private.package_json(private.weekly_package(d.id, s.dv, p_from, p_to))
    ) as row_obj
    from public.departments d
    cross join lateral (select case when private.report_level() = 'SUPER_ADMIN' then null else private.scope_division_in(v_me, d.id) end as dv) s
   where d.id in (select private.report_scope_departments())
  ) q;
  return jsonb_build_object('periodStart', p_from, 'periodEnd', p_to, 'departments', v_rows);
end $$;

create or replace function public.work_reports_operations_department(p_department uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  pk public.work_report_packages;
  v_released boolean;
  v_heads jsonb;
  v_leads jsonb;
  v_div text;
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
  v_div := case when private.report_level() = 'SUPER_ADMIN' then null else private.scope_division_in(auth.uid(), p_department) end;
  pk := private.weekly_package(p_department, v_div, p_from, p_to);
  -- the Super Admin always reads; the Operations Head once the Department Head submitted the week
  v_released := (pk.id is not null and pk.status not in ('DRAFT', 'COMPILING')) or private.report_level() = 'SUPER_ADMIN';
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'designation', nullif(h."position", ''),
      'reports', case when v_released then coalesce((select jsonb_agg(private.report_json(r, true) order by r.report_date desc, r.submitted_at desc)
                         from public.work_reports r where r.kind = 'DEPARTMENT_HEAD' and r.author_id = h.id and r.status <> 'DRAFT'
                          and r.report_date between p_from and p_to), '[]'::jsonb) else '[]'::jsonb end) order by h.full_name), '[]'::jsonb) into v_heads
    from public.profiles h
   where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = p_department
     and (v_div is null or h.head_division is null or h.head_division = v_div);
  select coalesce(jsonb_agg(
      case when v_released then private.team_lead_box(l, p_from, p_to, true)
           else private.team_lead_box(l, p_from, p_to, true) || jsonb_build_object('leadReports', '[]'::jsonb, 'memberReports', '[]'::jsonb) end order by l.full_name), '[]'::jsonb) into v_leads
    from public.profiles l
   where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and private.base_department(l.department_id) = p_department and private.team_in_division(l.team_id, v_div);
  return jsonb_build_object(
    'departmentId', p_department, 'department', (select d.name from public.departments d where d.id = p_department),
    'function', v_div, 'periodStart', p_from, 'periodEnd', p_to, 'package', private.package_json(pk), 'released', v_released,
    'stats', private.report_scope_stats(p_department, null, p_from, p_to, v_div),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'periodType', x.period_type, 'periodStart', x.period_start, 'periodEnd', x.period_end,
                                                              'submittedAt', x.submitted_at, 'status', x.status) order by x.period_end desc, x.submitted_at desc)
                           from (select * from public.work_report_packages k where k.department_id = p_department and k.status not in ('DRAFT', 'COMPILING')
                                    and (v_div is null or k.division is null or k.division = v_div)
                                  order by k.period_end desc, k.submitted_at desc limit 10) x), '[]'::jsonb),
    'departmentHeads', v_heads, 'teamLeads', v_leads);
end $$;

create or replace function public.work_reports_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := private.report_level();
  v_kind text := private.report_kind_of(private.report_level());
  me public.profiles;
  v_pending int := 0;
  v_member_pending int := 0;
  v_revision int := 0;
  v_weekly int := 0;
  v_to jsonb := '[]'::jsonb;
begin
  if v_level is null then
    raise exception 'FORBIDDEN: Reports are not available for this account.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if v_kind is not null then
    select count(*) into v_revision from public.work_reports x where x.author_id = me.id and x.status = 'REVISION_REQUIRED';
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name), '[]'::jsonb) into v_to
      from public.profiles p
     where p.id in (select private.report_reviewer_ids(v_kind, private.base_department(me.department_id), me.team_id) where v_kind <> 'DEPARTMENT_HEAD')
        or p.id in (select private.head_report_reviewer_ids(a.department_id, a.head_division) from private.assigner_department(null) a where v_kind = 'DEPARTMENT_HEAD');
  end if;
  if v_level = 'TEAM_LEAD' then
    select count(*) into v_pending from public.work_reports x where x.kind = 'MEMBER' and x.team_id = me.team_id and x.status in ('SUBMITTED', 'UNDER_REVIEW');
  elsif v_level = 'DEPARTMENT_HEAD' then
    select count(*) into v_pending from public.work_reports x where x.kind = 'TEAM_LEAD' and x.department_id = private.base_department(me.department_id)
       and x.status in ('SUBMITTED', 'UNDER_REVIEW') and private.head_covers(me.id, x.department_id, x.team_id);
    select count(*) into v_member_pending from public.work_reports x where x.kind = 'MEMBER' and x.department_id = private.base_department(me.department_id)
       and x.status = 'PENDING_DEPARTMENT_HEAD' and x.tl_status = 'APPROVED' and private.head_covers(me.id, x.department_id, x.team_id);
    -- a weekly report the Operations Head sent back
    select count(*) into v_weekly from public.work_report_packages k where k.status = 'REVISION_REQUIRED' and me.id in (select private.weekly_scope_heads(k.department_id, k.division));
  elsif v_level in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    select count(*) into v_pending from public.work_reports x where x.kind = 'DEPARTMENT_HEAD' and x.status in ('SUBMITTED', 'UNDER_REVIEW')
       and (v_level = 'SUPER_ADMIN' or me.id in (select private.report_oh_ids(x)));
    select count(*) into v_weekly from public.work_report_packages k where k.status = 'PENDING_OPERATIONS_HEAD'
       and (v_level = 'SUPER_ADMIN' or me.id in (select private.weekly_reviewer_ids(k.department_id, k.division)));
  end if;
  return jsonb_build_object('level', v_level, 'canWrite', v_kind is not null, 'reportsTo', v_to,
    'pendingReview', v_pending + v_member_pending, 'pendingLeadReports', v_pending, 'pendingMemberApprovals', v_member_pending,
    'weeklyPending', v_weekly, 'needsRevision', v_revision, 'badge', v_pending + v_member_pending + v_revision + v_weekly,
    'team', (select t.name from public.teams t where t.id = me.team_id), 'name', me.full_name);
end $$;


-- ---------------------------------------------------------------------------
-- 6. The live signal of a package: its Operations Head(s), its Department Head(s), and HR / the Super Admin once it is open to them
-- ---------------------------------------------------------------------------
create or replace function private.tg_work_report_package_signal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.work_report_signals (recipient_id, report_id, event)
  select distinct u, null::uuid, 'PACKAGE'
    from (select x as u from private.weekly_reviewer_ids(new.department_id, new.division) x
          union
          select h from private.weekly_scope_heads(new.department_id, new.division) h
          union
          select h from private.hr_reviewer_ids() h where private.package_hr_visible(new.status)
          union
          select s from private.super_admin_ids() s where new.status in ('HR_REVIEW_COMPLETED', 'SUBMITTED_TO_SUPERADMIN')) s;
  return new;
end $$;
revoke all on function private.tg_work_report_package_signal() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Department Head: the week of their department and function
-- ---------------------------------------------------------------------------
create or replace function public.work_reports_weekly(p_week_start date, p_division text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
  v_div text;
  v_head_div text;
  pk public.work_report_packages;
  v_to date := p_week_start + 6;
  v_days jsonb;
begin
  if private.report_level() <> 'DEPARTMENT_HEAD' then
    raise exception 'FORBIDDEN: Only a Department Head prepares the weekly department report.' using errcode = '42501';
  end if;
  perform private.week_check(p_week_start);
  select * into me from public.profiles where id = auth.uid();
  select s.department_id, s.division into v_dept, v_div from private.my_weekly_scope(p_division) s;
  select a.head_division into v_head_div from private.assigner_department(null) a;
  pk := private.weekly_package(v_dept, v_div, p_week_start, v_to);
  select coalesce(jsonb_agg(jsonb_build_object('date', d.d, 'workingDay', d.working,
           'stats', case when d.d <= private.office_today() then private.report_scope_stats(v_dept, null, d.d, d.d, v_div) end) order by d.d), '[]'::jsonb) into v_days
    from (select g::date as d, exists (select 1 from public.report_settings s where s.working_days @> array[extract(isodow from g)::integer]) as working
            from generate_series(p_week_start, v_to, interval '1 day') g) d;
  return jsonb_build_object(
    'departmentId', v_dept, 'department', (select d.name from public.departments d where d.id = v_dept), 'departmentHead', me.full_name,
    'function', coalesce(v_div, 'ALL'),
    -- the weekly reports this head sends for the department (a head of both functions in a department with separate Operations Heads: two)
    'functions', (select coalesce(jsonb_agg(coalesce(o.division, 'ALL') order by case when o.division is null then 0 when o.division = 'SALES' then 1 else 2 end), '[]'::jsonb)
                    from private.weekly_scope_options(v_dept, v_head_div) o),
    'reviewers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name), '[]'::jsonb)
                    from public.profiles p where p.id in (select private.weekly_reviewer_ids(v_dept, v_div))),
    'routingIssue', private.weekly_routing_issue(v_dept, v_div),
    'weekStart', p_week_start, 'weekEnd', v_to,
    'package', private.package_json(pk),
    'stats', private.report_scope_stats(v_dept, null, p_week_start, v_to, v_div),
    'days', v_days,
    'canEdit', pk.id is null or pk.status in ('DRAFT', 'COMPILING', 'REVISION_REQUIRED'),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('weekStart', k.period_start, 'status', k.status) order by k.period_start desc)
                         from (select * from public.work_report_packages x where x.department_id = v_dept
                                 and (x.division is not distinct from v_div or x.division is null) order by x.period_start desc limit 12) k), '[]'::jsonb));
end $$;
revoke all on function public.work_reports_weekly(date, text) from public, anon;
grant execute on function public.work_reports_weekly(date, text) to authenticated;

-- The earlier one-argument call: the head's own (or first) function.
create or replace function public.work_reports_weekly(p_week_start date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.work_reports_weekly(p_week_start, null::text)
$$;
revoke all on function public.work_reports_weekly(date) from public, anon;
grant execute on function public.work_reports_weekly(date) to authenticated;

-- Save the week (p_submit false: a draft; the very first save without text only "compiles" it) or submit it to the scope's Operations Head.
create or replace function public.work_report_weekly_save(
  p_week_start date, p_title text, p_assigned_overview text, p_completed_overview text, p_remarks text, p_submit boolean,
  p_division text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
  v_div text;
  pk public.work_report_packages;
  v_to date := p_week_start + 6;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_status text;
  v_from text;
  v_action text;
  v_oh uuid;
  v_stats jsonb;
  v_empty boolean;
  v_issue text;
begin
  if private.report_level() <> 'DEPARTMENT_HEAD' then
    raise exception 'FORBIDDEN: Only a Department Head prepares the weekly department report.' using errcode = '42501';
  end if;
  perform private.week_check(p_week_start);
  if p_week_start > private.office_today() then
    raise exception 'VALIDATION_ERROR: The week has not started yet.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_title, '')) > 200 then
    raise exception 'VALIDATION_ERROR: Keep the title under 200 characters.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_assigned_overview, '')) > 2000 or length(coalesce(p_completed_overview, '')) > 2000 or length(coalesce(p_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep each summary under 2000 characters.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select s.department_id, s.division into v_dept, v_div from private.my_weekly_scope(p_division) s;
  v_empty := v_title is null and nullif(btrim(coalesce(p_assigned_overview, '')), '') is null and nullif(btrim(coalesce(p_completed_overview, '')), '') is null
             and nullif(btrim(coalesce(p_remarks, '')), '') is null;
  if p_submit then
    if v_title is null or length(v_title) < 3 then
      raise exception 'VALIDATION_ERROR: Enter the weekly report title before submitting.' using errcode = 'P0001';
    end if;
    v_issue := private.weekly_routing_issue(v_dept, v_div);
    if v_issue is not null then
      raise exception 'CONFLICT: %', v_issue using errcode = 'P0001';
    end if;
  end if;
  v_stats := private.report_scope_stats(v_dept, null, p_week_start, v_to, v_div);

  select * into pk from public.work_report_packages
   where id = (private.weekly_package(v_dept, v_div, p_week_start, v_to)).id for update;
  if pk.id is not null and pk.status not in ('DRAFT', 'COMPILING', 'REVISION_REQUIRED') then
    raise exception 'CONFLICT: This week was already submitted.' using errcode = 'P0001';
  end if;
  v_from := pk.status;
  v_status := case when p_submit then 'PENDING_OPERATIONS_HEAD' when v_empty and (pk.id is null or pk.status = 'COMPILING') then 'COMPILING'
                   when pk.status = 'REVISION_REQUIRED' then 'REVISION_REQUIRED' else 'DRAFT' end;
  if pk.id is null then
    insert into public.work_report_packages (department_id, division, period_type, period_start, period_end, title, assigned_overview, completed_overview, note,
                                             status, stats, submitted_by, submitted_by_name, submitted_at)
    values (v_dept, v_div, 'WEEKLY', p_week_start, v_to, v_title, nullif(btrim(p_assigned_overview), ''), nullif(btrim(p_completed_overview), ''), nullif(btrim(p_remarks), ''),
            v_status, v_stats, me.id, me.full_name, now())
    returning * into pk;
    perform private.package_event(pk.id, case when v_status = 'COMPILING' then 'COMPILED' when p_submit then 'SUBMITTED' else 'SAVED' end, null, v_status, null, pk.revision);
  else
    update public.work_report_packages
       set title = v_title, assigned_overview = nullif(btrim(p_assigned_overview), ''), completed_overview = nullif(btrim(p_completed_overview), ''),
           note = nullif(btrim(p_remarks), ''), status = v_status, stats = v_stats, submitted_by = me.id, submitted_by_name = me.full_name,
           -- an unsubmitted week made before this migration (whole department) becomes the head's function week
           division = coalesce(division, v_div),
           revision = case when p_submit and v_from = 'REVISION_REQUIRED' then revision + 1 else revision end,
           submitted_at = case when p_submit then now() else submitted_at end,
           oh_reviewer_id = case when p_submit then null else oh_reviewer_id end, oh_reviewer_name = case when p_submit then null else oh_reviewer_name end,
           oh_reviewed_at = case when p_submit then null else oh_reviewed_at end, oh_comment = case when p_submit then null else oh_comment end,
           updated_at = now()
     where id = pk.id returning * into pk;
    perform private.package_event(pk.id, case when p_submit and v_from = 'REVISION_REQUIRED' then 'RESUBMITTED' when p_submit then 'SUBMITTED' when v_status = 'COMPILING' then 'COMPILED' else 'SAVED' end,
                                  v_from, v_status, null, pk.revision);
  end if;
  if p_submit then
    v_action := case when v_from = 'REVISION_REQUIRED' then 'resubmitted' else 'submitted' end;
    for v_oh in select * from private.weekly_reviewer_ids(v_dept, pk.division) loop
      perform private.notify(v_oh, 'REPORT_PACKAGE_SUBMITTED',
        format('Weekly department report: %s%s', (select d.name from public.departments d where d.id = v_dept), coalesce(' ' || private.function_label(pk.division), '')),
        format('%s %s the weekly report for %s to %s and it is waiting for your approval.', me.full_name, v_action, to_char(p_week_start, 'DD Mon'), to_char(v_to, 'DD Mon YYYY')),
        'work_report_package', pk.id);
    end loop;
    perform private.write_audit('WORK_REPORT_PACKAGE_' || upper(v_action), 'department', v_dept, v_dept, null,
      jsonb_build_object('from', p_week_start, 'to', v_to, 'revision', pk.revision, 'function', pk.division));
  end if;
  return private.package_json(pk);
end $$;
revoke all on function public.work_report_weekly_save(date, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.work_report_weekly_save(date, text, text, text, text, boolean, text) to authenticated;

-- The earlier six-argument call (and work_report_package_submit): the head's own (or first) function.
create or replace function public.work_report_weekly_save(
  p_week_start date, p_title text, p_assigned_overview text, p_completed_overview text, p_remarks text, p_submit boolean default false)
returns jsonb language sql security definer set search_path = '' as $$
  select public.work_report_weekly_save(p_week_start, p_title, p_assigned_overview, p_completed_overview, p_remarks, coalesce(p_submit, false), null::text)
$$;
revoke all on function public.work_report_weekly_save(date, text, text, text, text, boolean) from public, anon;
grant execute on function public.work_report_weekly_save(date, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Operations Head: the weekly board, the pending list and the decision - only the scopes they are accountable for
-- ---------------------------------------------------------------------------
-- One box per weekly scope (department and function) of the Operations Head (the Super Admin: all, with any routing issue).
create or replace function public.work_reports_weekly_board(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_to date := p_week_start + 6;
  v_sa boolean := private.report_level() = 'SUPER_ADMIN';
  v_rows jsonb;
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the weekly department reports.' using errcode = '42501';
  end if;
  perform private.week_check(p_week_start);
  select coalesce(jsonb_agg(row_obj order by row_obj ->> 'name', row_obj ->> 'function'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'slug', d.slug, 'function', coalesce(sc.division, 'ALL'),
      'key', d.id::text || ':' || coalesce(sc.division, 'ALL'),
      'departmentHeads', (select coalesce(jsonb_agg(h.full_name order by h.full_name), '[]'::jsonb) from public.profiles h
                           where h.id in (select private.weekly_scope_heads(d.id, sc.division))),
      'reviewers', (select coalesce(jsonb_agg(p.full_name order by p.full_name), '[]'::jsonb) from public.profiles p
                     where p.id in (select private.weekly_reviewer_ids(d.id, sc.division))),
      'routingIssue', case when v_sa then private.weekly_routing_issue(d.id, sc.division) end,
      'stats', private.report_scope_stats(d.id, null, p_week_start, v_to, sc.division),
      'package', private.package_json(private.weekly_package(d.id, sc.division, p_week_start, v_to))) as row_obj
      from (select distinct x.department_id, x.division from private.weekly_scopes() x
            union
            -- a week already sent for a scope no head holds any more stays visible
            select k.department_id, k.division from public.work_report_packages k where k.period_start = p_week_start and k.period_end = v_to) sc
      join public.departments d on d.id = sc.department_id
     where v_sa or auth.uid() in (select private.weekly_reviewer_ids(d.id, sc.division))
  ) q;
  return jsonb_build_object('weekStart', p_week_start, 'weekEnd', v_to, 'departments', v_rows,
    'pendingApprovals', (select count(*) from public.work_report_packages k where k.status = 'PENDING_OPERATIONS_HEAD'
                          and (v_sa or auth.uid() in (select private.weekly_reviewer_ids(k.department_id, k.division)))));
end $$;
revoke all on function public.work_reports_weekly_board(date) from public, anon;
grant execute on function public.work_reports_weekly_board(date) to authenticated;

-- The weekly reports waiting for this Operations Head (any week), newest first.
create or replace function public.work_reports_weekly_pending()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_sa boolean := private.report_level() = 'SUPER_ADMIN';
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the weekly department reports.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('departmentId', d.id, 'department', d.name, 'function', coalesce(k.division, 'ALL'), 'package', private.package_json(k))
                     order by k.period_end desc, d.name, k.division)
      from public.work_report_packages k join public.departments d on d.id = k.department_id
     where k.status = 'PENDING_OPERATIONS_HEAD'
       and (v_sa or auth.uid() in (select private.weekly_reviewer_ids(k.department_id, k.division)))), '[]'::jsonb);
end $$;
revoke all on function public.work_reports_weekly_pending() from public, anon;
grant execute on function public.work_reports_weekly_pending() to authenticated;

-- Approve (it goes to HR) or ask the Department Head for a revision. Only the Operations Head of the package's department AND function.
create or replace function public.work_report_weekly_review(p_package uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  pk public.work_report_packages;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_to uuid;
  v_dept_name text;
begin
  if private.report_level() <> 'OPERATIONS_HEAD' then
    raise exception 'FORBIDDEN: Only the Operations Head decides on the weekly department report.' using errcode = '42501';
  end if;
  if p_decision not in ('APPROVED', 'REVISION_REQUIRED') then
    raise exception 'VALIDATION_ERROR: Choose approve or request a revision.' using errcode = 'P0001';
  end if;
  if p_decision = 'REVISION_REQUIRED' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write a comment so the Department Head knows what to correct.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_comment, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the comment under 2000 characters.' using errcode = 'P0001';
  end if;
  select * into pk from public.work_report_packages where id = p_package for update;
  -- another function's or department's week is "not found" (it is not this Operations Head's to see)
  if pk.id is null or auth.uid() not in (select private.weekly_reviewer_ids(pk.department_id, pk.division)) then
    raise exception 'NOT_FOUND: Weekly report not found.' using errcode = 'P0001';
  end if;
  if pk.status <> 'PENDING_OPERATIONS_HEAD' then
    raise exception 'CONFLICT: This weekly report is not waiting for a decision.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select d.name || coalesce(' ' || private.function_label(pk.division), '') into v_dept_name from public.departments d where d.id = pk.department_id;
  if p_decision = 'APPROVED' then
    -- approved: the statistics are taken again now, so HR reviews what the Operations Head approved
    update public.work_report_packages
       set status = 'SENT_TO_HR', oh_reviewer_id = me.id, oh_reviewer_name = me.full_name, oh_reviewed_at = now(), oh_comment = v_comment,
           sent_to_hr_at = now(), stats = private.report_scope_stats(pk.department_id, null, pk.period_start, pk.period_end, pk.division), updated_at = now()
     where id = pk.id returning * into pk;
    perform private.package_event(pk.id, 'APPROVED', 'PENDING_OPERATIONS_HEAD', 'SENT_TO_HR', v_comment, pk.revision);
    for v_to in select * from private.hr_reviewer_ids() loop
      perform private.notify(v_to, 'REPORT_WEEKLY_SENT_TO_HR', format('Weekly report ready for performance review: %s', v_dept_name),
        format('The Operations Head approved the weekly report for %s to %s. Review each Team Lead and Team Member.', to_char(pk.period_start, 'DD Mon'), to_char(pk.period_end, 'DD Mon YYYY')),
        'work_report_package', pk.id);
    end loop;
  else
    update public.work_report_packages
       set status = 'REVISION_REQUIRED', oh_reviewer_id = me.id, oh_reviewer_name = me.full_name, oh_reviewed_at = now(), oh_comment = v_comment, updated_at = now()
     where id = pk.id returning * into pk;
    perform private.package_event(pk.id, 'REVISION_REQUESTED', 'PENDING_OPERATIONS_HEAD', 'REVISION_REQUIRED', v_comment, pk.revision);
  end if;
  -- the Department Head(s) who prepare this week
  for v_to in select * from private.weekly_scope_heads(pk.department_id, pk.division) loop
    perform private.notify(v_to, case p_decision when 'APPROVED' then 'REPORT_WEEKLY_APPROVED' else 'REPORT_WEEKLY_REVISION' end,
      case p_decision when 'APPROVED' then 'Weekly department report approved' else 'Revision requested on the weekly report' end,
      format('The Operations Head %s the weekly report for %s to %s.%s', case p_decision when 'APPROVED' then 'approved' else 'sent back' end,
             to_char(pk.period_start, 'DD Mon'), to_char(pk.period_end, 'DD Mon YYYY'), coalesce(' ' || left(v_comment, 300), '')),
      'work_report_package', pk.id);
  end loop;
  perform private.write_audit('WORK_REPORT_PACKAGE_' || p_decision, 'department', pk.department_id, pk.department_id, null,
    jsonb_build_object('from', pk.period_start, 'to', pk.period_end, 'revision', pk.revision, 'function', pk.division, 'comment', left(v_comment, 300)));
  return private.package_json(pk);
end $$;
revoke all on function public.work_report_weekly_review(uuid, text, text) from public, anon;
grant execute on function public.work_report_weekly_review(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The Super Admin's routing review: every weekly scope, its Department Head(s), its Operations Head, and what is wrong. Changes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.weekly_report_routing_review()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'departmentId', d.id, 'department', d.name, 'function', coalesce(sc.division, 'ALL'),
        'departmentHeads', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name) order by h.full_name), '[]'::jsonb)
                              from public.profiles h where h.id in (select private.weekly_scope_heads(d.id, sc.division))),
        'operationsHead', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p
                            where p.id = (select x from private.weekly_reviewer_ids(d.id, sc.division) x limit 1)),
        'issue', case
          when exists (select 1 from private.weekly_reviewer_ids(d.id, sc.division)) then
            case when sc.division is not null
                      and exists (select 1 from public.department_function_owner o where o.department_id = d.id and o.division = sc.division)
                      and private.owner_of_department(d.id) is not null
                      and private.owner_of_department(d.id) <> (select x from private.weekly_reviewer_ids(d.id, sc.division) x limit 1)
                      and private.scope_covers(private.owner_of_department(d.id), d.id, sc.division)
                 then 'CONFLICT' end
          when exists (select 1 from public.department_function_owner o join public.profiles p on p.id = o.operations_head_id
                        where o.department_id = d.id and o.division is not distinct from sc.division and p.status <> 'ACTIVE')
            or exists (select 1 from public.department_operations_owner o join public.profiles p on p.id = o.operations_head_id
                        where private.base_department(o.department_id) = d.id and p.status <> 'ACTIVE')
            then 'INACTIVE'
          else 'MISSING' end,
        'detail', case
          when exists (select 1 from private.weekly_reviewer_ids(d.id, sc.division)) then
            case when sc.division is not null
                      and exists (select 1 from public.department_function_owner o where o.department_id = d.id and o.division = sc.division)
                      and private.owner_of_department(d.id) is not null
                      and private.owner_of_department(d.id) <> (select x from private.weekly_reviewer_ids(d.id, sc.division) x limit 1)
                      and private.scope_covers(private.owner_of_department(d.id), d.id, sc.division)
                 then 'The department-level Operations Head also covers this function; the one named for the function decides.' end
          else private.weekly_routing_issue(d.id, sc.division) end)
      order by d.name, sc.division nulls first)
      from (select distinct x.department_id, x.division from private.weekly_scopes() x) sc
      join public.departments d on d.id = sc.department_id), '[]'::jsonb);
end $$;
revoke all on function public.weekly_report_routing_review() from public, anon;
grant execute on function public.weekly_report_routing_review() to authenticated;


notify pgrst, 'reload schema';
