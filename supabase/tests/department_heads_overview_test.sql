-- =============================================================================
-- Add Team Member for a Department Head with several departments (migration 20261125000100):
-- the pair check used by the form, and the list of heads who work in a department. Runs after wabatalk_test.sql (same database).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- department access check and heads overview'
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.headers', '', false);
create or replace function test.wtid2() returns uuid language sql stable as $$ select id from public.departments where slug = 'wabatalk' $$;
grant execute on function test.wtid2() to authenticated;
set role authenticated;

select test.login('sa');
select test.check((select department_access_check(jsonb_build_array(jsonb_build_object('departmentId', test.dept('whatsbox'), 'division', 'SUPPORT'),
                                                                 jsonb_build_object('departmentId', test.wtid2(), 'division', 'SUPPORT'),
                                                                 jsonb_build_object('departmentId', test.dept('mpillar'), 'division', 'SALES'))) = '[]'::jsonb), 'valid pairs: nothing to report');
select test.check((select jsonb_array_length(department_access_check(jsonb_build_array(jsonb_build_object('departmentId', test.dept('accounts'), 'division', 'SALES'),
                                                                                  jsonb_build_object('departmentId', test.dept('dtalk'), 'division', 'SUPPORT'),
                                                                                  jsonb_build_object('departmentId', test.wtid2(), 'division', 'SALES')))) = 3), 'three bad pairs are all reported');
select test.check((select (department_access_check(jsonb_build_array(jsonb_build_object('departmentId', test.dept('dtalk'), 'division', 'SUPPORT'))) -> 0 ->> 'problem') like '%Give Wabatalk instead%'), 'the reason names Wabatalk');
select test.check((select (department_access_check('[{"departmentId":"not-a-uuid","division":"SALES"}]'::jsonb) -> 0 ->> 'problem') = 'Invalid department.'), 'a malformed department is reported, not an error');
select test.must_fail($$select department_access_check('[]'::jsonb) from (select 1) x where false union all select department_access_check('{}'::jsonb)$$, 'a non-list is refused', 'Invalid departments');
select test.login('wt_p');
select test.must_fail($$select department_access_check('[]'::jsonb)$$, 'only the Super Admin may use the check', 'FORBIDDEN');

\echo '   heads overview'
select test.login('sa');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dept('whatsbox'))) x where (x ->> 'profileId') = test.id('wt_p')::text), 'Whatsbox lists the shared Support head even though Wabastar is their home');
select test.check((select jsonb_array_length(x -> 'access') = 3 and (select array_agg(a ->> 'department' order by a ->> 'department') = array['Wabastar', 'Wabatalk', 'Whatsbox'] from jsonb_array_elements(x -> 'access') a)
                     and (select bool_and(a ->> 'division' = 'SUPPORT') from jsonb_array_elements(x -> 'access') a)
                     from jsonb_array_elements(department_heads_overview(test.dept('whatsbox'))) x where (x ->> 'profileId') = test.id('wt_p')::text), 'the entry lists every department and function of that head, Wabatalk under its own name');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.wtid2())) x where (x ->> 'profileId') = test.id('wt_p')::text), 'Wabatalk lists the head who has it');
select test.check((select count(*) = 0 from jsonb_array_elements(department_heads_overview(test.wtid2())) x where (x ->> 'profileId') = test.id('ga_s')::text), 'but not D Talk''s Sales head');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dept('dtalk'))) x where (x ->> 'profileId') = test.id('ga_s')::text), 'D Talk lists its Sales head');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dept('dtalk'))) x where (x ->> 'profileId') = test.id('wt_p')::text), 'and the Support head who works its Support side (as Wabatalk): they work on D Talk''s data, their entry says so');
select test.login('wt_p');
select test.check((select jsonb_array_length(department_heads_overview(test.dept('whatsbox'))) >= 1), 'a head sees the heads of a department they work in');
select test.check((select department_heads_overview(test.dept('digitree')) = '[]'::jsonb), 'but nothing for a department they do not work in');
select test.login('ds_p');
select test.check((select department_heads_overview(test.dept('dtalk')) = '[]'::jsonb), 'a team member sees nothing');
select test.login('sa');
-- removing an assignment removes the head from that department's list at once
select department_access_set(test.id('wt_p'), test.dept('whatsbox'), 'SUPPORT', false);
select test.check((select count(*) = 0 from jsonb_array_elements(department_heads_overview(test.dept('whatsbox'))) x where (x ->> 'profileId') = test.id('wt_p')::text), 'withdrawing the department removes the head from its list');
select test.login('wt_p');
select test.hdr(test.dept('whatsbox'));
select test.check((select count(*) = 0 from customers where name like 'SC Whatsbox%'), 'and from its data');
select test.nohdr();
\echo '   done'
