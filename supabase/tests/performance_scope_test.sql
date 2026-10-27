-- =============================================================================
-- Performance Management: what the page counts, and what it must not count twice or invent (runs after the other suites).
-- It builds its own department (a Department Head, a Team Lead and two members) so the figures do not depend on what other suites left behind:
--   * the department figure counts a task a Team Lead split between members once, while adding up the people counts it twice;
--   * the month runs from its first to its last day (the 28th and the 1st are in different months);
--   * a department with a team but nobody active has 0 people, 1 team and NO percentages (never 0%);
--   * a task with no deadline cannot be late or on time.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 60. Performance Management: counted once, month boundaries, empty departments'

reset role;
insert into departments (slug, name, description) values ('perf-scope', 'Perf Scope Department', ''), ('perf-empty', 'Perf Empty Department', '');
insert into teams (department_id, name, division) select id, 'General', 'GENERAL' from departments where slug in ('perf-scope', 'perf-empty');
select test.create_auth_user('ps_dh', 'ps.dh@amuwa.com', '{"full_name":"PS Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('perf-scope')));
select test.create_auth_user('ps_tl', 'ps.tl@amuwa.com', '{"full_name":"PS Lead"}',
  jsonb_build_object('provisioned_by', test.id('ps_dh'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('perf-scope', 'General')));
select test.create_auth_user('ps_m1', 'ps.m1@amuwa.com', '{"full_name":"PS Member One"}',
  jsonb_build_object('provisioned_by', test.id('ps_tl'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('perf-scope', 'General')));
select test.create_auth_user('ps_m2', 'ps.m2@amuwa.com', '{"full_name":"PS Member Two"}',
  jsonb_build_object('provisioned_by', test.id('ps_tl'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('perf-scope', 'General')));
select test.create_auth_user('ps_edh', 'ps.edh@amuwa.com', '{"full_name":"Empty DH"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('perf-empty')));

create or replace function test.ps_task(p_title text, p_parent uuid, p_by text, p_who text, p_created timestamptz, p_due date, p_status text, p_completed timestamptz) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into work_tasks (department_id, team_id, parent_id, title, priority, due_date, assigned_by, assignee_id, status, progress, completed_at, created_at)
  values (test.dept('perf-scope'), test.team('perf-scope', 'General'), p_parent, p_title, 'MEDIUM', p_due, test.id(p_by), test.id(p_who), p_status,
          case when p_status = 'COMPLETED' then 100 else 40 end, p_completed, p_created)
  returning id into v;
  return v;
end $$;

-- February 2026: the Department Head gave the Team Lead a task, who split it between the two members (one on time, one late); plus one task due on
-- the last day of February and one due on the first of March, both still open
create temp table ps (name text primary key, id uuid);
grant all on ps to authenticated;
insert into ps select 'parent', test.ps_task('PS parent', null, 'ps_dh', 'ps_tl', timestamptz '2026-02-02 09:00+05:30', date '2026-02-10', 'IN_PROGRESS', null);
select test.ps_task('PS child 1', (select id from ps where name = 'parent'), 'ps_tl', 'ps_m1', timestamptz '2026-02-03 09:00+05:30', date '2026-02-10', 'COMPLETED', timestamptz '2026-02-09 10:00+05:30');
select test.ps_task('PS child 2', (select id from ps where name = 'parent'), 'ps_tl', 'ps_m2', timestamptz '2026-02-03 09:00+05:30', date '2026-02-10', 'COMPLETED', timestamptz '2026-02-12 10:00+05:30');
select test.ps_task('PS end of Feb', null, 'ps_tl', 'ps_m1', timestamptz '2026-02-20 09:00+05:30', date '2026-02-28', 'ASSIGNED', null);
select test.ps_task('PS start of Mar', null, 'ps_tl', 'ps_m1', timestamptz '2026-02-20 09:00+05:30', date '2026-03-01', 'ASSIGNED', null);
-- July 2025: a task completed with no deadline at all
select test.ps_task('PS no deadline', null, 'ps_tl', 'ps_m2', timestamptz '2025-07-08 09:00+05:30', null, 'COMPLETED', timestamptz '2025-07-10 09:00+05:30');

set role authenticated;
select test.login('ps_dh');
create temp table pfe as select performance_people('MONTH', date '2026-02-01', date '2026-02-28') as j;
create temp table pfm as select performance_people('MONTH', date '2026-03-01', date '2026-03-31') as j;
create temp table pfz as select performance_people('MONTH', date '2025-06-01', date '2025-06-30') as j;
create temp table pfn as select performance_people('MONTH', date '2025-07-01', date '2025-07-31') as j;
grant all on pfe, pfm, pfz, pfn to authenticated;

select test.check((select jsonb_array_length(j -> 'people') = 3 and jsonb_array_length(j -> 'teams') = 1 from pfe), 'the Department Head sees the Team Lead and both members, and the one team');
select test.check((select (j -> 'department' -> 'summary' -> 'tasks' ->> 'total')::int = 3 from pfe),
  'the department counts each task once: the 2 tasks the Team Lead split + 1 other = 3 (the parent that was split is not counted)');
select test.check((select sum((p -> 'summary' -> 'tasks' ->> 'total')::int) = 4 from pfe, jsonb_array_elements(j -> 'people') p),
  'while adding up the people gives 4: the Team Lead''s own task is counted for the lead and again through the two members, so the page must not add people up');
select test.check((select (t -> 'summary' -> 'tasks' ->> 'total')::int = 3 from pfe, jsonb_array_elements(j -> 'teams') t), 'the team says the same as the department: 3');
select test.check((select (j -> 'department' -> 'summary' -> 'tasks' ->> 'completed')::int = 2 and (j -> 'department' -> 'summary' ->> 'completionPct')::numeric = 66.7 from pfe),
  'completion is completed eligible tasks over eligible tasks: 2 of 3 = 66.7%');
select test.check((select (j -> 'department' -> 'summary' -> 'timing' ->> 'onTime')::int = 1 and (j -> 'department' -> 'summary' -> 'timing' ->> 'late')::int = 1
                          and (j -> 'department' -> 'summary' -> 'timing' ->> 'onTimePct')::numeric = 50.0 from pfe),
  'on time is completed on or before the deadline over completed with a deadline: 1 of 2 = 50%');
select test.check((select (j -> 'department' -> 'summary' -> 'tasks' ->> 'overdue')::int = 1 from pfe), 'overdue is not completed and past the deadline (the task due 28 February, as of today)');
select test.check((select (j -> 'department' -> 'summary' -> 'tasks' ->> 'total')::int = 1 from pfm), 'the task due on 1 March is in March only (and the 28th stayed in February)');

-- a month with no tasks: no percentage at all, never 0%
select test.check((select (j -> 'department' -> 'summary' -> 'tasks' ->> 'total')::int = 0 and (j -> 'department' -> 'summary' -> 'completionPct') = 'null'::jsonb
                          and (j -> 'department' -> 'summary' -> 'timing' -> 'onTimePct') = 'null'::jsonb from pfz),
  'a period with no tasks has no completion and no on-time percentage (null, not 0%)');
select test.check((select bool_and((p -> 'summary' -> 'completionPct') = 'null'::jsonb) from pfz, jsonb_array_elements(j -> 'people') p), 'and nobody is shown with 0%');

-- completed, but with no deadline: completed, neither on time nor late, no on-time percentage
select test.check((select (j -> 'department' -> 'summary' -> 'tasks' ->> 'completed')::int = 1 and (j -> 'department' -> 'summary' ->> 'completionPct')::numeric = 100.0
                          and (j -> 'department' -> 'summary' -> 'timing' -> 'onTimePct') = 'null'::jsonb
                          and (j -> 'department' -> 'summary' -> 'timing' ->> 'onTime')::int = 0 and (j -> 'department' -> 'summary' -> 'timing' ->> 'late')::int = 0 from pfn),
  'a completed task with no deadline counts as completed but is neither on time nor late (no on-time percentage)');

-- a department with a team and nobody active: 0 people, 1 team, no percentages
select test.login('ps_edh');
create temp table pfd as select performance_people('MONTH', date '2026-02-01', date '2026-02-28') as j;
grant all on pfd to authenticated;
select test.check((select jsonb_array_length(j -> 'people') = 0 and jsonb_array_length(j -> 'teams') = 1 and (j -> 'department' -> 'summary' -> 'tasks' ->> 'total')::int = 0
                          and (j -> 'department' -> 'summary' -> 'completionPct') = 'null'::jsonb from pfd),
  'a department with one team and nobody active: 0 people, 1 team, 0 tasks and no percentages (this is what the page shows, and it is right)');
select test.check((select not exists (select 1 from jsonb_array_elements(j -> 'people') p where p ->> 'name' like 'PS %') from pfd), 'and nobody from another department leaks in');
reset role;
