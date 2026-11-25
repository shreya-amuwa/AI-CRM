-- =============================================================================
-- Company-wide late marking (migration 20270211000100): Late only after 10:30 India time, the late minutes counted from 10:30, the same
-- for every department (ten synthetic ones named after the real ones, plus a "future" one), every role and every view; nothing (a personal
-- reminder time, the old grace setting) overrides it; past days are corrected without changing any attendance row.
-- Fixed past Wednesdays are used, so the suite does not depend on when it runs; own rows are removed at the end.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 146. Attendance: Late only after 10:30, company-wide'
reset role;
select set_config('request.jwt.claims', '', false);

delete from attendance_records where profile_id in (select id from test.users where name like 'lr\_%');
delete from attendance_reminder_prefs where profile_id in (select id from test.users where name like 'lr\_%');
delete from auth.users where email like 'lr.%@example.com';
delete from test.users where name like 'lr\_%';
delete from teams where department_id in (select id from departments where slug like 'lr-%');
delete from departments where slug like 'lr-%';

-- the attendance rows before the migration runs again: it must not change one of them
create temp table lr_before as select md5(coalesce(string_agg(a::text, '|' order by a.id), '')) as h, count(*) as n from attendance_records a;
\i supabase/migrations/20270211000100_attendance_late_after_1030.sql
\i supabase/migrations/20270211000100_attendance_late_after_1030.sql
select test.check((select h = (select md5(coalesce(string_agg(a::text, '|' order by a.id), '')) from attendance_records a)
                          and n = (select count(*) from attendance_records) from lr_before),
  'running the migration (twice) changes, adds and removes no attendance record');

\echo '   the rule itself'
create or replace function test.lr_at(p_day date, p_time text) returns timestamptz language sql immutable as $$
  select (p_day + p_time::time) at time zone 'Asia/Kolkata' $$;
select test.check(to_char(private.attendance_reporting_time(), 'HH24:MI') = '10:00' and to_char(private.attendance_late_after(), 'HH24:MI') = '10:30'
                  and private.attendance_late_grace_minutes() = 30, 'reporting time 10:00, Late only after 10:30 (30 minutes'' grace)');
select test.check((select bool_and(private.attendance_late_minutes(test.lr_at(date '2027-02-03', t)) = m)
                     from (values ('09:59', 0), ('10:00', 0), ('10:01', 0), ('10:10', 0), ('10:11', 0), ('10:15', 0), ('10:30', 0), ('10:30:59', 0),
                                  ('10:31', 1), ('10:31:59', 1), ('10:45', 15), ('11:00', 30), ('12:05', 95)) v(t, m)),
  'late minutes: 0 up to 10:30 (seconds ignored), 10:31 = 1, 10:45 = 15, 11:00 = 30, counted from 10:30');
select test.check(private.attendance_late_minutes(null) = 0, 'not punched in: not late');
-- the same instant in UTC: 05:01Z is 10:31 India time
select test.check(private.attendance_late_minutes('2027-02-03 05:01:00+00') = 1 and private.attendance_late_minutes('2027-02-03 05:00:00+00') = 0,
  'India time (Asia/Kolkata), whatever the server''s time zone');
set role authenticated;
select test.must_fail($$select private.attendance_late_minutes(now())$$, 'the rule is not callable from the browser', 'permission denied');
reset role;

\echo '   every department and role'
insert into departments (slug, name) values
  ('lr-sales', 'LR Sales'), ('lr-support', 'LR Support'), ('lr-accounts', 'LR Accounts'), ('lr-tc', 'LR Technical Consultant'),
  ('lr-ai', 'LR AI Studio'), ('lr-aid', 'LR AI Design Studio'), ('lr-intl', 'LR International'), ('lr-res', 'LR Reseller'),
  ('lr-hr', 'LR HR Ops'), ('lr-future', 'LR Future Department');
insert into teams (department_id, name, division) select d.id, 'Core', 'SALES' from departments d where d.slug like 'lr-%';
create or replace function test.lrmk(p_name text, p_role text, p_dept text) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'lr.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'LR ' || substr(p_name, 4)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', case when p_role = 'DEPARTMENT_HEAD' then test.dept(p_dept) end,
      'provisioned_team_id', case when p_role <> 'DEPARTMENT_HEAD' then test.team(p_dept, 'Core') end))) $$;
-- a Team Member in every department, a Team Lead and a Department Head in some
select test.lrmk('lr_m_' || substr(d.slug, 4), 'TEAM_MEMBER', d.slug) from departments d where d.slug like 'lr-%' order by d.slug;
select test.lrmk('lr_tl_sales', 'TEAM_HEAD', 'lr-sales'), test.lrmk('lr_tl_ai', 'TEAM_HEAD', 'lr-ai'), test.lrmk('lr_tl_future', 'TEAM_HEAD', 'lr-future');
select test.lrmk('lr_dh_support', 'DEPARTMENT_HEAD', 'lr-support'), test.lrmk('lr_dh_intl', 'DEPARTMENT_HEAD', 'lr-intl'),
       test.lrmk('lr_dh_hr', 'DEPARTMENT_HEAD', 'lr-hr');
select test.check((select count(*) = 16 from profiles where id in (select id from test.users where name like 'lr\_%') and status = 'ACTIVE'),
  'sixteen employees in ten departments, three roles');
create temp table lr_cfg as select reminder_punch_in, absent_after_minutes, reminder_days, reminders_paused_on, late_grace_minutes from attendance_settings where id;
update attendance_settings set reminder_punch_in = '10:00', absent_after_minutes = 60, reminder_days = '{1,2,3,4,5,6}', reminders_paused_on = null,
       late_grace_minutes = 0 where id;

-- the expected table, each time on its own past Wednesday, for every one of the sixteen
create temp table lr_case as
  select k, t, m, (private.office_today() - ((extract(isodow from private.office_today())::integer + 4) % 7) - 7 * k)::date as day
    from (values (1, '09:59', 0), (2, '10:00', 0), (3, '10:01', 0), (4, '10:10', 0), (5, '10:15', 0), (6, '10:30', 0),
                 (7, '10:31', 1), (8, '10:45', 15), (9, '11:00', 30)) v(k, t, m);
grant select on lr_case to authenticated;
insert into attendance_records (profile_id, attendance_date, punch_in_at)
select u.id, c.day, test.lr_at(c.day, c.t) from test.users u cross join lr_case c where u.name like 'lr\_%';

create temp table lr_team as
  select c.k, c.t, c.m, u.name, r.status, r.late, r.late_minutes
    from lr_case c cross join lateral private.attendance_team_rows(c.day, test.lr_at(c.day, '13:00')) r
    join test.users u on u.id = r.profile_id and u.name like 'lr\_%';
select test.check((select count(*) = 16 * 9 from lr_team), 'team attendance: every employee on every one of the nine days');
select test.check(not exists (select 1 from lr_team where status <> case when m > 0 then 'LATE' else 'PRESENT' end or late <> (m > 0) or late_minutes <> m),
  'team attendance (managers, HR, Super Admin): Present up to 10:30, Late after it with minutes from 10:30, for every department and role');
select test.check((select count(distinct name) = 16 from lr_team where t = '10:15' and status = 'PRESENT' and not late),
  '10:15 is Present (not Late) in all ten departments, for members, Team Leads and Department Heads');
select test.check((select count(distinct name) = 16 from lr_team where t = '10:31' and status = 'LATE' and late_minutes = 1),
  '10:31 is Late by 1 minute everywhere');

create temp table lr_ov as
  select c.k, c.m, u.name, x ->> 'category' as category, (x ->> 'late')::boolean as late, (x ->> 'lateMinutes')::int as late_minutes
    from lr_case c cross join lateral jsonb_array_elements(private.attendance_overview_json(c.day, test.lr_at(c.day, '13:00')) -> 'rows') x
    join test.users u on u.id = (x ->> 'profileId')::uuid and u.name like 'lr\_%';
select test.check((select count(*) = 16 * 9 from lr_ov) and not exists (select 1 from lr_ov where category <> 'PRESENT' or late <> (m > 0) or late_minutes <> m),
  'Today''s Attendance Overview and the 11:00 alert agree with team attendance for every case');
select test.check((select (o -> 'totals' ->> 'late')::int = (select count(*) from lr_team t where t.k = 7 and t.late)
                          and (select (d ->> 'late')::int from jsonb_array_elements(o -> 'departments') d where d ->> 'name' = 'LR Sales') = 2
                     from (select private.attendance_overview_json(day, test.lr_at(day, '13:00')) as o from lr_case where k = 7) s),
  'the overview''s late counts (total and per department) use the same rule');
select test.check((select o ->> 'lateAfter' = '10:30' and o ->> 'reportingTime' = '10:00' and (o ->> 'graceMinutes')::int = 30
                     from (select private.attendance_overview_json(private.office_today()) as o) s), 'the overview states the rule (10:00, Late after 10:30)');

\echo '   nothing overrides it'
-- a personal Punch In reminder (earlier or later than the company's) moves the reminders and "absent", never the late rule
insert into attendance_reminder_prefs (profile_id, punch_in) values (test.id('lr_m_sales'), '09:00'), (test.id('lr_m_ai'), '11:30')
on conflict (profile_id) do update set punch_in = excluded.punch_in;
select test.check((select r.status = 'PRESENT' and not r.late from lr_case c, private.attendance_team_rows(c.day, test.lr_at(c.day, '13:00')) r
                    where c.k = 5 and r.profile_id = test.id('lr_m_sales')), 'a 09:00 personal reminder does not make 10:15 Late');
select test.check((select r.status = 'LATE' and r.late_minutes = 15 from lr_case c, private.attendance_team_rows(c.day, test.lr_at(c.day, '13:00')) r
                    where c.k = 8 and r.profile_id = test.id('lr_m_ai')), 'an 11:30 personal reminder does not excuse 10:45 (Late by 15)');
delete from attendance_reminder_prefs where profile_id in (select id from test.users where name like 'lr\_%');
-- the old company grace setting, at either end, changes nothing
update attendance_settings set late_grace_minutes = 120 where id;
select test.check((select count(*) = 16 from lr_case c, private.attendance_team_rows(c.day, test.lr_at(c.day, '13:00')) r
                    where c.k = 7 and r.profile_id in (select id from test.users where name like 'lr\_%') and r.status = 'LATE' and r.late_minutes = 1),
  'attendance_settings.late_grace_minutes = 120 does not excuse 10:31');
update attendance_settings set late_grace_minutes = 0 where id;
select test.check((select count(*) = 16 from lr_case c, private.attendance_team_rows(c.day, test.lr_at(c.day, '13:00')) r
                    where c.k = 3 and r.profile_id in (select id from test.users where name like 'lr\_%') and r.status = 'PRESENT' and not r.late),
  'attendance_settings.late_grace_minutes = 0 does not make 10:01 Late');

\echo '   through the API functions (HR, a Department Head, a Team Lead)'
set role authenticated;
select test.login('hr_head');
select test.check((select o ->> 'lateAfter' = '10:30' and o ->> 'reportingTime' = '10:00' and (o ->> 'graceMinutes')::int = 30
                     from (select attendance_team_overview((select day from lr_case where k = 8), null, null, null, 'LR ') as o) s),
  'team attendance states the rule (10:00, Late after 10:30)');
select test.check((select (o ->> 'shown')::int = 0 from (select attendance_team_overview((select day from lr_case where k = 6), null, null, 'LATE_ARRIVALS', 'LR ') as o) s),
  'HR: the Late arrivals filter is empty on the day everyone came at 10:30');
select test.check((select (o ->> 'shown')::int = 16 and (o -> 'totals' ->> 'late')::int = 16
                          and not exists (select 1 from jsonb_array_elements(o -> 'rows') x where (x ->> 'lateMinutes')::int <> 15 or x ->> 'status' <> 'LATE')
                     from (select attendance_team_overview((select day from lr_case where k = 8), null, null, 'LATE_ARRIVALS', 'LR ') as o) s),
  'HR: on the 10:45 day all sixteen are Late arrivals, by 15 minutes');
select test.login('lr_dh_support');
select test.check((select bool_and(x ->> 'status' = 'PRESENT' and not (x ->> 'late')::boolean) and count(*) >= 2
                     from jsonb_array_elements((attendance_team_overview((select day from lr_case where k = 4), null, null, null, 'LR ')) -> 'rows') x),
  'a Department Head sees 10:10 as Present for their department');
select test.login('lr_tl_future');
select test.check((select bool_and(x ->> 'status' = 'LATE' and (x ->> 'lateMinutes')::int = 30) and count(*) >= 1
                     from jsonb_array_elements((attendance_team_overview((select day from lr_case where k = 9), null, null, null, 'LR ')) -> 'rows') x),
  'a Team Lead in a new department sees 11:00 as Late by 30 minutes');
select test.login('sa');
select test.check((select (x ->> 'late')::boolean = false
                     from jsonb_array_elements((attendance_today_overview((select day from lr_case where k = 6))) -> 'rows') x
                    where (x ->> 'profileId')::uuid = test.id('lr_m_accounts')), 'the Super Admin''s overview: 10:30 is not Late');
reset role;

\echo '   cleanup'
delete from attendance_records where profile_id in (select id from test.users where name like 'lr\_%');
delete from auth.users where email like 'lr.%@example.com';
delete from test.users where name like 'lr\_%';
delete from teams where department_id in (select id from departments where slug like 'lr-%');
delete from departments where slug like 'lr-%';
update attendance_settings s set reminder_punch_in = v.reminder_punch_in, absent_after_minutes = v.absent_after_minutes, reminder_days = v.reminder_days,
       reminders_paused_on = v.reminders_paused_on, late_grace_minutes = v.late_grace_minutes from lr_cfg v where s.id;
select set_config('request.jwt.claims', '', false);
