-- =============================================================================
-- Notice Board: the Sales and Support audiences (migration 20270224000100).
-- Runs after notice_board_delete_test.sql. Uses the people of earlier suites: sa (Super Admin), hr_head (HR), dv_ashish (CRM team), tm_a / th_wab (Wabastore
-- Sales), dh_wbx (Whatsbox Department Head, no side set), ga_s / ga_p / ds_s / ds_p (D Talk Sales / Support heads and members, department_scopes_test) and
-- creates its own Whatsbox people (ns_*). Own notices have titles 'NS %'. "22023" -> HTTP 422, "42501" -> 403, "P0002" -> 404.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 145. Notice Board: Sales and Support audiences'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites run older copies of the notice functions again: this migration is applied last, twice (it must be safe to run twice)
\i supabase/migrations/20270224000100_notice_sales_support_audience.sql
\i supabase/migrations/20270224000100_notice_sales_support_audience.sql
delete from company_notices where title like 'NS %';
create or replace function test.ns_fail(p_sql text, p_label text, p_state text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise exception 'TEST FAILED: % (SQLSTATE % instead of %: %)', p_label, sqlstate, p_state, sqlerrm; end if;
    raise notice 'ok - % [%]', p_label, sqlstate;
    return;
  end;
  raise exception 'TEST FAILED: % (statement succeeded)', p_label;
end $$;
create or replace function test.ns(p_title text) returns public.company_notices language sql stable security definer set search_path = '' as $$
  select * from public.company_notices where title = p_title limit 1 $$;
create or replace function test.ns_send(p_title text, p_key text, p_type text, p_depts jsonb default '[]', p_emps jsonb default '[]', p_extra jsonb default '{}') returns jsonb language sql as $$
  select notice_publish(jsonb_build_object('title', p_title, 'body', 'Full text of ' || p_title, 'category', 'GENERAL', 'audienceType', p_type,
                                           'departmentIds', p_depts, 'employeeIds', p_emps, 'clientRequestId', p_key) || p_extra) $$;
-- the recipients of a notice, as the table owner
create or replace function test.ns_rcpt(p_title text) returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(r.profile_id order by r.profile_id), '{}') from public.company_notice_recipients r where r.notice_id = (test.ns(p_title)).id $$;
create or replace function test.ns_bells(p_title text) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications where type = 'COMPANY_NOTICE' and entity_id = (test.ns(p_title)).id $$;
create or replace function test.ns_members(p_dept text, p_div text) returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.profile_id order by m.profile_id), '{}') from private.notice_division_members(test.dept(p_dept), p_div) m $$;
-- one department of the options' Sales / Support list, and the employee ids in it
create or replace function test.ns_opt(p_div text, p_dept text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(notice_audience_options() -> lower(p_div)) x where (x ->> 'id')::uuid = test.dept(p_dept) $$;
create or replace function test.ns_opt_has(p_div text, p_dept text, p_person text) returns boolean language sql stable as $$
  select exists (select 1 from jsonb_array_elements(test.ns_opt(p_div, p_dept) -> 'employees') e where (e ->> 'id')::uuid = test.id(p_person)) $$;
create or replace function test.ns_inbox(p_title text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(notice_list('INBOX', p_limit => 100) -> 'items') x where x ->> 'title' = p_title) $$;
-- does a (base) department have a team of this division? read as the table owner (the publisher's own row-level security hides other departments' teams)
create or replace function test.ns_has_team(p_dept uuid, p_div text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.teams t where private.base_department(t.department_id) = p_dept and t.division::text = p_div) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- Whatsbox people: two Sales members and a Sales lead, one Support member
select test.create_auth_user('ns_s1', 'ns.s1@amuwa.com', '{"full_name":"NS Whatsbox Seller One"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')));
select test.create_auth_user('ns_s2', 'ns.s2@amuwa.com', '{"full_name":"NS Whatsbox Seller Two"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')));
select test.create_auth_user('ns_sl', 'ns.sl@amuwa.com', '{"full_name":"NS Whatsbox Sales Lead"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('whatsbox', 'Sales')));
select test.create_auth_user('ns_p1', 'ns.p1@amuwa.com', '{"full_name":"NS Whatsbox Support One"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Support')));
select test.check((select count(*) = 4 from profiles where id in (test.id('ns_s1'), test.id('ns_s2'), test.id('ns_sl'), test.id('ns_p1')) and status = 'ACTIVE'), 'fixtures: four active Whatsbox employees');

\echo '   who is in one function of one department (from the database, nothing hard-coded)'
select test.check(test.id('ns_s1') = any (test.ns_members('whatsbox', 'SALES')) and test.id('ns_sl') = any (test.ns_members('whatsbox', 'SALES')),
  'Whatsbox Sales: its Sales members and Sales lead');
select test.check(not (test.id('ns_p1') = any (test.ns_members('whatsbox', 'SALES'))), 'not a Whatsbox Support member');
select test.check(not (test.id('tm_a') = any (test.ns_members('whatsbox', 'SALES'))), 'not a Sales member of another department (Wabastore)');
select test.check(test.id('ns_p1') = any (test.ns_members('whatsbox', 'SUPPORT')) and not (test.id('ns_s1') = any (test.ns_members('whatsbox', 'SUPPORT'))),
  'Whatsbox Support: its Support member, not a Sales one');
select test.check(test.id('dh_wbx') = any (test.ns_members('whatsbox', 'SALES')) and test.id('dh_wbx') = any (test.ns_members('whatsbox', 'SUPPORT')),
  'a Department Head with no side set heads both functions of their department');
select test.check(test.id('ga_s') = any (test.ns_members('dtalk', 'SALES')) and not (test.id('ga_s') = any (test.ns_members('dtalk', 'SUPPORT'))),
  'a Sales Department Head is in Sales only');
select test.check(test.id('ga_p') = any (test.ns_members('dtalk', 'SUPPORT')) and not (test.id('ga_p') = any (test.ns_members('dtalk', 'SALES'))),
  'a Support Department Head is in Support only');
select test.check(not (test.id('hr_head') = any (test.ns_members('whatsbox', 'SALES') || test.ns_members('whatsbox', 'SUPPORT'))), 'HR is in neither');

\echo '   the three publishers are offered Sales and Support with the right departments and people'
set role authenticated;
do $$
declare
  r text;
  o jsonb;
begin
  foreach r in array array['sa', 'hr_head', 'dv_ashish'] loop
    perform test.login(r);
    o := notice_audience_options();
    if not ((o ->> 'canPublish')::boolean and o -> 'audiences' @> '["COMPANY","DEPARTMENT","ROLE","EMPLOYEES","SALES","SUPPORT"]') then
      raise exception 'TEST FAILED: % is not offered every audience (Sales and Support next to the existing ones)', r;
    end if;
    if test.ns_opt('SALES', 'whatsbox') is null or test.ns_opt('SUPPORT', 'whatsbox') is null then
      raise exception 'TEST FAILED: % does not see Whatsbox under Sales and Support', r;
    end if;
    if test.ns_opt('SALES', 'hr') is not null or test.ns_opt('SUPPORT', 'hr') is not null then
      raise exception 'TEST FAILED: % sees HR (no Sales or Support team) under Sales or Support', r;
    end if;
    if exists (select 1 from jsonb_array_elements(o -> 'sales') x where not test.ns_has_team((x ->> 'id')::uuid, 'SALES')) then
      raise exception 'TEST FAILED: % sees a Sales department that has no Sales team', r;
    end if;
    if not (test.ns_opt_has('SALES', 'whatsbox', 'ns_s1') and test.ns_opt_has('SALES', 'whatsbox', 'ns_sl') and not test.ns_opt_has('SALES', 'whatsbox', 'ns_p1')
            and not test.ns_opt_has('SALES', 'whatsbox', 'tm_a')) then
      raise exception 'TEST FAILED: % sees the wrong people under Whatsbox Sales', r;
    end if;
    if not (test.ns_opt_has('SUPPORT', 'whatsbox', 'ns_p1') and not test.ns_opt_has('SUPPORT', 'whatsbox', 'ns_s1')) then
      raise exception 'TEST FAILED: % sees the wrong people under Whatsbox Support', r;
    end if;
  end loop;
  raise notice 'ok - Super Admin, HR and the CRM team: Sales lists only Sales departments with their Sales people, Support only Support departments with theirs';
end $$;
select test.login('sa');
select test.check(test.ns_opt('SUPPORT', 'dtalk') ->> 'name' = (select 'Wabatalk (' || name || ')' from departments where slug = 'dtalk'), 'a Support side is shown by its own name under its base department (Wabatalk = D Talk Support)');
select test.check(not exists (select 1 from jsonb_array_elements(notice_audience_options() -> 'support') x where (x ->> 'id')::uuid = test.dept('wabatalk')),
  'and not twice (the side itself is not a second entry)');
select test.check(not test.ns_opt_has('SALES', 'whatsbox', 'sa'), 'the publisher is not offered as their own recipient');

\echo '   nobody else can use them'
select test.login('tm_a');
select test.check((select o -> 'sales' = '[]'::jsonb and o -> 'support' = '[]'::jsonb and not (o ->> 'canPublish')::boolean from (select notice_audience_options() o) x),
  'a Team Member is offered no Sales / Support list');
select test.ns_fail(format($q$select test.ns_send('NS Denied', 'ns-key-denied1', 'SALES', '["%s"]')$q$, test.dept('whatsbox')), 'nor can publish to Sales', '42501');
select test.login('dh_wbx');
select test.ns_fail(format($q$select test.ns_send('NS Denied', 'ns-key-denied2', 'SUPPORT', '["%s"]')$q$, test.dept('whatsbox')), 'nor a Department Head to Support', '42501');

\echo '   the database refuses a wrong selection (not only the screen)'
select test.login('sa');
select test.ns_fail($q$select test.ns_send('NS Bad', 'ns-key-bad-001', 'SALES')$q$, 'Sales needs a department', '22023');
select test.ns_fail(format($q$select test.ns_send('NS Bad', 'ns-key-bad-002', 'SALES', '["%s","%s"]')$q$, test.dept('whatsbox'), test.dept('wabastore')), 'exactly one', '22023');
select test.ns_fail(format($q$select test.ns_send('NS Bad', 'ns-key-bad-003', 'SALES', '["%s"]')$q$, test.dept('hr')), 'HR is not a Sales department', '22023');
select test.ns_fail(format($q$select test.ns_send('NS Bad', 'ns-key-bad-004', 'SALES', '["%s"]', '["%s"]')$q$, test.dept('whatsbox'), test.id('ns_p1')),
  'a Support member cannot be ticked for a Sales notice', '22023');
select test.ns_fail(format($q$select test.ns_send('NS Bad', 'ns-key-bad-005', 'SALES', '["%s"]', '["%s"]')$q$, test.dept('whatsbox'), test.id('tm_a')),
  'nor a Sales member of another department', '22023');
select test.ns_fail(format($q$select test.ns_send('NS Bad', 'ns-key-bad-006', 'SUPPORT', '["%s"]', '["%s"]')$q$, test.dept('whatsbox'), test.id('ns_s1')),
  'nor a Sales member for a Support notice', '22023');
reset role;
select test.check(not exists (select 1 from company_notices where title = 'NS Bad'), 'nothing was saved for a refused selection');

\echo '   a Sales notice reaches the whole Sales function of the department, and only it'
set role authenticated;
select test.login('sa');
select test.check((test.ns_send('NS Whatsbox Sales targets', 'ns-key-sales-1', 'SALES', jsonb_build_array(test.dept('whatsbox'))) ->> 'status') = 'PUBLISHED',
  'the Super Admin publishes to Whatsbox Sales');
reset role;
select test.check((select audience_type = 'SALES' and audience_departments = array[test.dept('whatsbox')] and audience_employees = '{}' from test.ns('NS Whatsbox Sales targets')),
  'stored as Sales, with its department, for the whole function');
select test.check(test.ns_rcpt('NS Whatsbox Sales targets') = (select array_agg(x order by x) from unnest(test.ns_members('whatsbox', 'SALES')) x where x <> test.id('sa')),
  'the recipients are exactly the Whatsbox Sales people');
select test.check(test.id('ns_s1') = any (test.ns_rcpt('NS Whatsbox Sales targets')) and test.id('dh_wbx') = any (test.ns_rcpt('NS Whatsbox Sales targets'))
                  and not (test.id('ns_p1') = any (test.ns_rcpt('NS Whatsbox Sales targets'))) and not (test.id('tm_a') = any (test.ns_rcpt('NS Whatsbox Sales targets')))
                  and not (test.id('hr_head') = any (test.ns_rcpt('NS Whatsbox Sales targets'))),
  'a Sales member and the head get it; Support, another department and HR do not');
select test.check(test.ns_bells('NS Whatsbox Sales targets') = cardinality(test.ns_rcpt('NS Whatsbox Sales targets')), 'one bell per recipient, no more');
set role authenticated;
select test.login('ns_s1');
select test.check(test.ns_inbox('NS Whatsbox Sales targets') and notice_unread_count() >= 1, 'a Sales member sees it in their Notice Board, unread');
select test.check((notice_open((test.ns('NS Whatsbox Sales targets')).id) ->> 'isRecipient')::boolean, 'and opens it');
select test.login('ns_p1');
select test.check(not test.ns_inbox('NS Whatsbox Sales targets'), 'a Support member of the same department does not see it');
select test.ns_fail(format($q$select notice_open('%s')$q$, (test.ns('NS Whatsbox Sales targets')).id), 'nor open it', 'P0002');
select test.login('tm_a');
select test.ns_fail(format($q$select notice_open('%s')$q$, (test.ns('NS Whatsbox Sales targets')).id), 'nor a Sales member of another department', 'P0002');
-- the same form sent twice: the first notice, nobody notified again
select test.login('sa');
select test.check((test.ns_send('NS Whatsbox Sales targets', 'ns-key-sales-1', 'SALES', jsonb_build_array(test.dept('whatsbox'))) ->> 'duplicate')::boolean, 'a double click is the same notice');
reset role;
select test.check((select count(*) = 1 from company_notices where title = 'NS Whatsbox Sales targets') and test.ns_bells('NS Whatsbox Sales targets') = cardinality(test.ns_rcpt('NS Whatsbox Sales targets')),
  'no second notice and no second bell');

\echo '   a Support notice to ticked team members reaches only them'
set role authenticated;
select test.login('hr_head');
select test.check((test.ns_send('NS Whatsbox Support shift', 'ns-key-supp-1', 'SUPPORT', jsonb_build_array(test.dept('whatsbox')), jsonb_build_array(test.id('ns_p1'))) ->> 'publisherRole') = 'HR',
  'HR publishes to one Whatsbox Support member');
reset role;
select test.check(test.ns_rcpt('NS Whatsbox Support shift') = array[test.id('ns_p1')], 'only that member is a recipient (not the head, not Sales)');
set role authenticated;
select test.login('ns_p1');
select test.check(test.ns_inbox('NS Whatsbox Support shift'), 'the Support member sees it');
select test.login('ns_s1');
select test.check(not test.ns_inbox('NS Whatsbox Support shift'), 'a Sales member does not');
select test.login('dv_ashish');
select test.ns_fail(format($q$select notice_open('%s')$q$, (test.ns('NS Whatsbox Support shift')).id), 'another publisher does not read a notice for ticked people (like "selected employees")', 'P0002');
select test.ns_fail(format($q$select notice_receipts('%s')$q$, (test.ns('NS Whatsbox Support shift')).id), 'nor its receipts', 'P0002');
select test.check((notice_open((test.ns('NS Whatsbox Sales targets')).id) ->> 'id') is not null, 'but reads a whole-function notice, like a department notice');
select test.login('sa');
select test.check((notice_receipts((test.ns('NS Whatsbox Support shift')).id) ->> 'total')::integer = 1, 'the Super Admin sees its receipts');

\echo '   the CRM team publishes to D Talk Support (its Wabatalk side)'
select test.login('dv_ashish');
select test.check((test.ns_send('NS DTalk Support', 'ns-key-supp-2', 'SUPPORT', jsonb_build_array(test.dept('dtalk'))) ->> 'publisherRole') = 'CRM_TEAM', 'the CRM team publishes to Support');
reset role;
select test.check(test.id('ga_p') = any (test.ns_rcpt('NS DTalk Support')) and test.id('ds_p') = any (test.ns_rcpt('NS DTalk Support'))
                  and not (test.id('ga_s') = any (test.ns_rcpt('NS DTalk Support'))) and not (test.id('ds_s') = any (test.ns_rcpt('NS DTalk Support'))),
  'D Talk Support head and member get it; D Talk Sales head and member do not');

\echo '   a new Sales employee appears at once, and gets a scheduled Sales notice'
set role authenticated;
select test.login('sa');
select test.check((test.ns_send('NS Scheduled Sales', 'ns-key-sales-2', 'SALES', jsonb_build_array(test.dept('whatsbox')), '[]', jsonb_build_object('publishAt', now() + interval '1 day')) ->> 'status') = 'SCHEDULED',
  'a Sales notice scheduled for tomorrow');
reset role;
select test.create_auth_user('ns_new', 'ns.new@amuwa.com', '{"full_name":"NS Whatsbox New Seller"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')));
set role authenticated;
select test.login('sa');
select test.check(test.ns_opt_has('SALES', 'whatsbox', 'ns_new') and not test.ns_opt_has('SUPPORT', 'whatsbox', 'ns_new'), 'the new Sales member is in the Whatsbox Sales list, not in Support');
reset role;
update company_notices set publish_at = now() - interval '1 minute' where id = (test.ns('NS Scheduled Sales')).id;
select notice_release_due(now(), false);
select test.check(test.id('ns_new') = any (test.ns_rcpt('NS Scheduled Sales')) and not (test.id('ns_p1') = any (test.ns_rcpt('NS Scheduled Sales'))),
  'released at its time: the new Sales member is a recipient, Support is not');
select test.check(not (test.id('ns_new') = any (test.ns_rcpt('NS Whatsbox Sales targets'))), 'a notice released before they joined stays as it was (the existing rule)');

\echo '   the existing audiences are unchanged'
set role authenticated;
select test.login('dv_ashish');
select test.check((test.ns_send('NS Whatsbox department', 'ns-key-dept-1', 'DEPARTMENT', jsonb_build_array(test.dept('whatsbox'))) ->> 'status') = 'PUBLISHED', 'a department notice');
select test.login('hr_head');
select test.check((test.ns_send('NS Team leads', 'ns-key-role-1', 'ROLE', jsonb_build_array(test.dept('whatsbox')), '[]', '{"roles":["TEAM_HEAD"]}') ->> 'status') = 'PUBLISHED', 'a designation notice');
select test.login('sa');
select test.check((test.ns_send('NS Two people', 'ns-key-emps-1', 'EMPLOYEES', '[]', jsonb_build_array(test.id('ns_s2'), test.id('ns_p1'))) ->> 'status') = 'PUBLISHED', 'a selected-employees notice');
select test.check((test.ns_send('NS Everyone', 'ns-key-comp-1', 'COMPANY') ->> 'status') = 'PUBLISHED', 'a company notice');
reset role;
select test.check(test.id('ns_s1') = any (test.ns_rcpt('NS Whatsbox department')) and test.id('ns_p1') = any (test.ns_rcpt('NS Whatsbox department'))
                  and not (test.id('tm_a') = any (test.ns_rcpt('NS Whatsbox department'))), 'Specific department: the whole department, Sales and Support, as before');
select test.check(test.ns_rcpt('NS Team leads') @> array[test.id('ns_sl')] and not (test.id('ns_s1') = any (test.ns_rcpt('NS Team leads'))), 'Specific designation: as before');
select test.check(cardinality(test.ns_rcpt('NS Two people')) = 2, 'Selected employees: as before');
select test.check(cardinality(test.ns_rcpt('NS Everyone')) = (select count(*) - 1 from profiles where status = 'ACTIVE'), 'Entire company: as before');
