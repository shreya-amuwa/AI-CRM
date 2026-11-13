-- =============================================================================
-- Super Admin Overview by department (migration 20270101000100): who is absent in each department, and each department's business.
-- Runs late in the shared test database: re-uses its users (sa, acc_m, dh_wab, th_wab, tm_a) and its payments and expenses, and adds
-- its own synthetic departments and people for attendance.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 95. Super Admin Overview: attendance and business by department'
reset role;
\i supabase/migrations/20270101000100_superadmin_overview_departments.sql

delete from leave_requests where employee_id in (select id from test.users where name like 'sao\_%');
delete from auth.users where email like 'sao.%@example.com';
delete from test.users where name like 'sao\_%';
delete from teams where department_id in (select id from departments where slug like 'sao-%');
delete from departments where slug like 'sao-%';
insert into departments (slug, name) values ('sao-a', 'SAO Alpha'), ('sao-b', 'SAO Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'sao-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.saomk(p_name text, p_dept text) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'sao.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'SAO ' || substr(p_name, 5)),
    jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER',
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', test.team(p_dept, 'Sales')))
$$;
grant execute on all functions in schema test to anon, authenticated;

select test.service();
select test.saomk('sao_present', 'sao-a');
select test.service();
select test.saomk('sao_leave', 'sao-a');
select test.service();
select test.saomk('sao_absent', 'sao-a');
select test.service();
select test.saomk('sao_crmonly', 'sao-a');
select test.service();
select test.saomk('sao_beta', 'sao-b');
reset role;
select test.check((select count(*) = 5 from profiles where id in (select id from test.users where name like 'sao\_%') and status = 'ACTIVE'),
  'the synthetic people exist and are active');

-- today: one punched in, one on approved leave, one simply absent, one only signed in to the CRM (not punched in), Beta's one punched in
insert into attendance_records (profile_id, attendance_date, punch_in_at) values
  (test.id('sao_present'), private.office_today(), now()), (test.id('sao_beta'), private.office_today(), now());
insert into attendance_records (profile_id, attendance_date, rm_login_at) values (test.id('sao_crmonly'), private.office_today(), now());
insert into leave_requests (employee_id, department_id, leave_type, start_date, end_date, reason, status)
values (test.id('sao_leave'), test.dept('sao-a'), 'FULL_DAY', private.office_today() - 1, private.office_today() + 1, 'test', 'APPROVED');

set role authenticated;
select test.login('sa');
create temp table sao (k text primary key, j jsonb);
grant all on sao to authenticated;
insert into sao select 'today', dashboard_overview_departments();
insert into sao select 'all', dashboard_overview_departments(private.office_today() - 3650, private.office_today(), null);
insert into sao select 'yesterday', dashboard_overview_departments(null, null, private.office_today() - 1);
insert into sao select 'register', hr_attendance_register(private.office_today(), test.dept('sao-a'));

\echo '   attendance'
select test.check((select (j ->> 'attendanceDate')::date = private.office_today() from sao where k = 'today'), 'attendance is for today unless a date is chosen');
select test.check((select (a ->> 'staff')::int = 4 and (a ->> 'present')::int = 1 and (a ->> 'absentCount')::int = 3
                     from sao, jsonb_array_elements(j -> 'attendance') a where k = 'today' and a ->> 'slug' = 'sao-a'),
  'Alpha: four staff, one present, three absent');
select test.check((select array(select x ->> 'name' from jsonb_array_elements(a -> 'absent') x order by 1) = array['SAO absent', 'SAO crmonly', 'SAO leave']
                     from sao, jsonb_array_elements(j -> 'attendance') a where k = 'today' and a ->> 'slug' = 'sao-a'),
  'the absent names are listed under their own department, and the person who punched in is not among them');
select test.check((select bool_and((x ->> 'onLeave')::boolean = (x ->> 'name' = 'SAO leave'))
                     from sao, jsonb_array_elements(j -> 'attendance') a, jsonb_array_elements(a -> 'absent') x where k = 'today' and a ->> 'slug' = 'sao-a'),
  'approved leave is flagged, nobody else is');
select test.check((select (a ->> 'absentCount')::int = 0 and jsonb_array_length(a -> 'absent') = 0
                     from sao, jsonb_array_elements(j -> 'attendance') a where k = 'today' and a ->> 'slug' = 'sao-b'),
  'Beta: everyone present, so no one is listed (the screen shows "No employees absent")');
select test.check((select not exists (select 1 from sao, jsonb_array_elements(j -> 'attendance') a, jsonb_array_elements(a -> 'absent') x
                                       where k = 'today' and x ->> 'name' like 'SAO %' and a ->> 'slug' not like 'sao-%')),
  'no one is listed under another department');
select test.check((select (select array_agg(x ->> 'name' order by x ->> 'name') from jsonb_array_elements(a -> 'absent') x)
                        = (select array_agg(r ->> 'name' order by r ->> 'name') from sao s2, jsonb_array_elements(s2.j -> 'rows') r
                            where s2.k = 'register' and r ->> 'status' = 'NOT_PUNCHED_IN')
                     from sao, jsonb_array_elements(j -> 'attendance') a where k = 'today' and a ->> 'slug' = 'sao-a'),
  'the absent list is exactly who HR''s attendance register shows as not punched in');
select test.check((select coalesce(sum((a ->> 'staff')::int), 0) = (select count(*) from profiles where status = 'ACTIVE' and role <> 'SUPER_ADMIN'
                                                                       and (created_at at time zone 'Asia/Kolkata')::date <= private.office_today())
                     from sao, jsonb_array_elements(j -> 'attendance') a where k = 'today'),
  'every active employee is counted once, in one department');
select test.check((select not exists (select 1 from sao, jsonb_array_elements(j -> 'attendance') a, jsonb_array_elements(a -> 'absent') x
                                       where k = 'yesterday' and x ->> 'name' like 'SAO %')),
  'people who joined today are not counted absent for yesterday');

\echo '   business by department'
select test.check((select (j -> 'period' ->> 'from')::date = date_trunc('month', private.office_today())::date
                          and (j -> 'period' ->> 'to')::date = private.office_today() from sao where k = 'today'),
  'the default period is this month to date');
select test.login('acc_m');
select test.admin_check($Q$select (select array_agg(e ->> 'departmentId' order by e ->> 'departmentId') from jsonb_array_elements(accounts_finance_by_department()) e)
                                = (select array_agg(p ->> 'departmentId' order by p ->> 'departmentId') from sao, jsonb_array_elements(j -> 'performance') p where k = 'today')$Q$,
  'the same departments as Accounts'' Department Income, each once');
select test.admin_check($Q$select bool_and((p ->> 'departmentIncome')::numeric = (e ->> 'income')::numeric
                                       and (p ->> 'departmentIncomeCount')::int = (e ->> 'incomeCount')::int)
                             from jsonb_array_elements(accounts_finance_by_department()) e
                             join (select p from sao, jsonb_array_elements(j -> 'performance') p where k = 'today') x on x.p ->> 'departmentId' = e ->> 'departmentId'$Q$,
  'Department Income equals Accounts'' Department Income for every department');
select test.admin_check($Q$select bool_and((p ->> 'income')::numeric = (accounts_finance_summary((p ->> 'departmentId')::uuid, (j -> 'period' ->> 'from')::date, (j -> 'period' ->> 'to')::date) ->> 'income')::numeric
                                       and (p ->> 'expenses')::numeric = (accounts_finance_summary((p ->> 'departmentId')::uuid, (j -> 'period' ->> 'from')::date, (j -> 'period' ->> 'to')::date) ->> 'expenses')::numeric)
                             from sao, jsonb_array_elements(j -> 'performance') p where k in ('today', 'all')$Q$,
  'income and expenses in the period equal Accounts'' figures for that department and those dates');
select test.admin_check($Q$select coalesce(sum((p ->> 'income')::numeric), 0) <= (select coalesce(sum(amount), 0) from private.verified_income())
                             from sao, jsonb_array_elements(j -> 'performance') p where k = 'all'$Q$,
  'department income never adds up to more than the verified income: nothing is counted twice');
select test.admin_check($Q$select coalesce(sum((p ->> 'expenses')::numeric), 0)
                                = (select coalesce(sum(a.amount), 0) from expense_allocations a join department_expenses e on e.id = a.expense_id
                                    join departments d on d.id = a.department_id
                                   where d.generates_revenue and e.expense_date between private.office_today() - 3650 and private.office_today())
                             from sao, jsonb_array_elements(j -> 'performance') p where k = 'all'$Q$,
  'each department counts only its own share of a shared expense');
select test.admin_check($Q$select bool_and((p ->> 'onboarded')::int
                                    = (select count(*) from customer_onboarding o join customers c on c.id = o.customer_id
                                        where c.department_id = (p ->> 'departmentId')::uuid and o.onboarding_completed_at is not null
                                          and (o.onboarding_completed_at at time zone 'Asia/Kolkata')::date between (j -> 'period' ->> 'from')::date and (j -> 'period' ->> 'to')::date))
                             from sao, jsonb_array_elements(j -> 'performance') p where k in ('today', 'all')$Q$,
  'customer onboarding counts the department''s customers whose onboarding was completed in the period');
select test.admin_check($Q$select bool_and((p ->> 'recharges')::int = coalesce(l.n, 0) and (p ->> 'rechargeAmount')::numeric = coalesce(l.amount, 0))
                             from sao, jsonb_array_elements(j -> 'performance') p
                             left join (select department_id, count(*) n, sum(amount) amount from private.business_ledger()
                                         where tx_type in ('SUBSCRIPTION', 'RENEWAL') and status = 'COLLECTED'
                                           and (occurred_at at time zone 'Asia/Kolkata')::date between private.office_today() - 3650 and private.office_today()
                                         group by department_id) l on l.department_id = (p ->> 'departmentId')::uuid
                            where k = 'all'$Q$,
  'recharges are the completed plan purchases and renewals of the business ledger, by department');
select test.admin_check($Q$select not exists (select 1 from sao, jsonb_array_elements(j -> 'performance') p
                                         where (p ->> 'departmentId')::uuid in (select id from departments where not generates_revenue))$Q$,
  'departments that do not earn revenue are not in the business figures');

\echo '   who may read it'
select test.must_fail($$select dashboard_overview_departments()$$, 'Accounts staff cannot read the Super Admin overview', 'Super Admin');
select test.login('dh_wab');
select test.must_fail($$select dashboard_overview_departments()$$, 'nor a Department Head', 'Super Admin');
select test.login('th_wab');
select test.must_fail($$select dashboard_overview_departments()$$, 'nor a Team Lead', 'Super Admin');
select test.login('tm_a');
select test.must_fail($$select dashboard_overview_departments()$$, 'nor a Team Member', 'Super Admin');
reset role;
set role anon;
select test.must_fail($$select dashboard_overview_departments()$$, 'nor a signed-out visitor', 'permission denied');
reset role;
set role authenticated;
select test.login('sa');
select test.must_fail($$select dashboard_overview_departments(current_date, current_date - 1)$$, 'a period that ends before it starts is refused', 'VALIDATION_ERROR');
select test.must_fail($$select dashboard_overview_departments(null, null, private.office_today() + 1)$$, 'attendance for a future day is refused', 'VALIDATION_ERROR');
reset role;
select test.check((select count(*) = 3 from attendance_records where profile_id in (select id from test.users where name like 'sao\_%')),
  'reading the overview changes no attendance');

delete from leave_requests where employee_id in (select id from test.users where name like 'sao\_%');
delete from auth.users where email like 'sao.%@example.com';
delete from test.users where name like 'sao\_%';
delete from teams where department_id in (select id from departments where slug like 'sao-%');
delete from departments where slug like 'sao-%';
