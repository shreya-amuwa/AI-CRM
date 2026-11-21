-- =============================================================================
-- Department Head dashboard (migration 20270124000100): overview, team attendance, leads, customers and invoices of the head's OWN department.
-- Reuses the fixtures of weekly_report_routing_test.sql and task_hierarchy_test.sql: department wkr-a with the Sales head wkr_dhs and the Support head wkr_dhp,
-- Sales Team Lead tsk_tls, Sales member wkr_tms, Support Team Lead tsk_tl1, Support member tsk_m1; department wkr-b (Sales + Support teams) with its head
-- wkr_dhb; Accounts head dh_acc; Team Lead / Team Member / Super Admin as the other roles. "42501" is the SQLSTATE the API turns into HTTP 403.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 143. Department Head dashboard: attendance, leads, customers and invoices of the head''s own department'
reset role;
\i supabase/migrations/20270124000100_department_head_dashboard.sql
\i supabase/migrations/20270124000100_department_head_dashboard.sql

-- a clean slate for this suite (re-runnable): only the rows this suite makes
delete from member_invoices where invoice_number like 'DHD-%';
delete from customers where name like 'DHD %';
delete from leave_requests where reason like 'DHD %';
delete from auth.users where email like 'dhd.%@example.com';
delete from test.users where name like 'dhd\_%';

create or replace function test.must_fail_state(p_sql text, p_label text, p_state text) returns void language plpgsql as $$
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
create or replace function test.dhdmk(p_name text, p_dept text, p_team text) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'dhd.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'DHD ' || substr(p_name, 5)),
    jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team(p_dept, p_team))) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- wkr-a Sales: a1 never punches in (absent), a2 is on approved leave, a3 has only a pending leave request (so absent); wkr-b Sales: b1 punches in
select test.service(); select test.dhdmk('dhd_a1', 'wkr-a', 'Sales');
select test.service(); select test.dhdmk('dhd_a2', 'wkr-a', 'Sales');
select test.service(); select test.dhdmk('dhd_a3', 'wkr-a', 'Sales');
select test.service(); select test.dhdmk('dhd_b1', 'wkr-b', 'Sales');
reset role;
select set_config('request.jwt.claims', '', false);
update profiles set status = 'ACTIVE' where id in (test.id('dhd_a1'), test.id('dhd_a2'), test.id('dhd_a3'), test.id('dhd_b1'), test.id('wkr_tms'), test.id('tsk_tls'), test.id('tsk_tl1'), test.id('tsk_m1'));
select test.check((select count(*) = 4 from profiles where id in (test.id('dhd_a1'), test.id('dhd_a2'), test.id('dhd_a3'), test.id('dhd_b1')) and status = 'ACTIVE'), 'fixture: four new employees');

-- attendance: manual punches (attendance_records), approved leave (leave_requests); CRM sign-in is deliberately NOT a signal
delete from attendance_records where profile_id in (test.id('dhd_a1'), test.id('dhd_a2'), test.id('dhd_a3'), test.id('dhd_b1'), test.id('wkr_tms'), test.id('tsk_tls'), test.id('tsk_m1'), test.id('tsk_tl1'))
  and attendance_date in (private.office_today(), private.office_today() - 1);
insert into attendance_records (profile_id, attendance_date, punch_in_at, punch_out_at) values
  (test.id('wkr_tms'), private.office_today(), now() - interval '3 hours', null),
  (test.id('tsk_tls'), private.office_today(), now() - interval '8 hours', now() - interval '1 hour'),
  (test.id('dhd_b1'), private.office_today(), now() - interval '2 hours', null),
  (test.id('dhd_a1'), private.office_today() - 1, (private.office_today() - 1)::timestamp at time zone 'Asia/Kolkata' + interval '10 hours', (private.office_today() - 1)::timestamp at time zone 'Asia/Kolkata' + interval '18 hours');
-- a1 signed in to the CRM today but never punched in: still absent
insert into audit_logs (actor_id, action, entity_type) values (test.id('dhd_a1'), 'SESSION_STARTED', 'session');
insert into leave_requests (employee_id, leave_type, start_date, end_date, half_day_shift, reason, status) values
  (test.id('dhd_a2'), 'FULL_DAY', private.office_today(), private.office_today() + 1, null, 'DHD approved leave', 'APPROVED'),
  (test.id('dhd_a3'), 'FULL_DAY', private.office_today(), private.office_today(), null, 'DHD pending leave', 'PENDING_HR');

-- customers: wkr-a (Support member tsk_m1 owns them) and wkr-b; invoices for both
insert into customers (owner_id, name, company, phone, email, status) values
  (test.id('tsk_m1'), 'DHD Alpha One', 'DHD Alpha Traders', '9100000001', 'dhd.alpha1@example.com', 'ACTIVE'),
  (test.id('tsk_m1'), 'DHD Alpha Two', 'DHD Alpha Foods', '9100000002', 'dhd.alpha2@example.com', 'INACTIVE'),
  (test.id('dhd_b1'), 'DHD Beta One', 'DHD Beta Traders', '9100000003', 'dhd.beta1@example.com', 'ACTIVE');
insert into member_invoices (owner_id, invoice_number, customer_name, company, amount, status, issue_date, due_date, customer_id, kind, details)
select test.id('sa'), v.n, c.name, c.company, v.amt, v.st, v.issued, v.due, c.id, 'UPLOADED', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('description', v.svc)))
  from (values
    ('DHD-A1', 'DHD Alpha One', 1000, 'Paid', (current_date - 30)::text, (current_date - 20)::text, 'WhatsApp API'),
    ('DHD-A2', 'DHD Alpha One', 2000, 'Pending', (current_date - 10)::text, (current_date - 2)::text, 'AI Calling'),
    ('DHD-A3', 'DHD Alpha Two', 4000, 'Pending', (current_date - 1)::text, (current_date + 20)::text, 'Meta Ads'),
    ('DHD-A4', 'DHD Alpha Two', 500, 'Cancelled', (current_date - 40)::text, (current_date - 30)::text, 'Old'),
    ('DHD-B1', 'DHD Beta One', 9000, 'Pending', (current_date - 5)::text, (current_date - 1)::text, 'Beta service')) v (n, cn, amt, st, issued, due, svc)
  join customers c on c.name = v.cn;
select test.check((select count(*) = 5 from member_invoices where invoice_number like 'DHD-%'), 'fixture: five invoices (four of wkr-a customers, one of wkr-b)');

-- ---------------------------------------------------------------------------
\echo '   1. team attendance (Sales head wkr_dhs of wkr-a)'
set role authenticated;
select test.login('wkr_dhs');
create temp table dhd (k text primary key, v jsonb);
grant all on dhd to authenticated;
insert into dhd select 'att', head_attendance_list();
select test.check((select (v -> 'summary' ->> 'employees')::int = (v -> 'summary' ->> 'present')::int + (v -> 'summary' ->> 'absent')::int + (v -> 'summary' ->> 'onLeave')::int from dhd where k = 'att'),
  'the numbers add up: employees = present + absent + on leave');
select test.check((select (v ->> 'total')::int = (v -> 'summary' ->> 'employees')::int and jsonb_array_length(v -> 'items') = (v ->> 'total')::int from dhd where k = 'att'),
  'the list has one row per employee of the department');
select test.check((select x ->> 'status' = 'PRESENT' and x ->> 'punchIn' is not null and x ->> 'punchOut' is null and (x ->> 'workedMinutes')::int between 170 and 200
                     from dhd, jsonb_array_elements(v -> 'items') x where k = 'att' and x ->> 'profileId' = test.id('wkr_tms')::text),
  'a member who punched in 3 hours ago is Present with the punch-in time, no punch-out and about 180 minutes worked');
select test.check((select x ->> 'status' = 'PRESENT' and x ->> 'punchIn' is not null and x ->> 'punchOut' is not null
                     from dhd, jsonb_array_elements(v -> 'items') x where k = 'att' and x ->> 'profileId' = test.id('tsk_tls')::text),
  'a Team Lead who punched in and out shows both times');
select test.check((select x ->> 'status' = 'ABSENT' and x ->> 'punchIn' is null from dhd, jsonb_array_elements(v -> 'items') x where k = 'att' and x ->> 'profileId' = test.id('dhd_a1')::text),
  'an employee with no punch-in is Absent, even though they signed in to the CRM today (CRM sign-in is not attendance)');
select test.check((select x ->> 'status' = 'ON_LEAVE' and x -> 'leave' ->> 'type' = 'FULL_DAY' from dhd, jsonb_array_elements(v -> 'items') x where k = 'att' and x ->> 'profileId' = test.id('dhd_a2')::text),
  'an approved leave shows as On leave with its type');
select test.check((select x ->> 'status' = 'ABSENT' from dhd, jsonb_array_elements(v -> 'items') x where k = 'att' and x ->> 'profileId' = test.id('dhd_a3')::text),
  'a leave request that is still pending does not count: Absent');
select test.check((select bool_and(x ? 'designation' and x ? 'name' and x ? 'punchIn' and x ? 'punchOut' and x ? 'date' and x ? 'status') from dhd, jsonb_array_elements(v -> 'items') x where k = 'att'), 'every row carries name, designation, status, date and the punch times');
select test.check((select not exists (select 1 from dhd, jsonb_array_elements(v -> 'items') x, profiles p
                                      where k = 'att' and p.id = (x ->> 'profileId')::uuid and private.base_department(p.department_id) is distinct from private.base_department(test.dept('wkr-a')))),
  'no employee of another department is listed (wkr-b is not)');
select test.check((select not exists (select 1 from dhd, jsonb_array_elements(v -> 'items') x where k = 'att' and x ->> 'profileId' = test.id('dhd_b1')::text)), 'the wkr-b member who punched in is not visible to the wkr-a head');
select test.check((select not (v::text like '%latitude%' or v::text like '%longitude%' or v::text like '%place%') from dhd where k = 'att'), 'no punch location is returned');
select test.check((select (v -> 'summary' ->> 'rate')::numeric = round(100.0 * (v -> 'summary' ->> 'present')::int / nullif((v -> 'summary' ->> 'employees')::int - (v -> 'summary' ->> 'onLeave')::int, 0), 1) from dhd where k = 'att'),
  'the attendance percentage is present out of those expected to work (everyone except approved leave)');
-- filters
select test.check((select jsonb_array_length(x -> 'items') > 0 and not exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'status' <> 'ABSENT')
                     and exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'profileId' = test.id('dhd_a1')::text)
                     from (select head_attendance_list(null, 'ABSENT') x) q), 'the Absent filter lists only absent people (a1 among them)');
select test.check((select not exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'status' <> 'ON_LEAVE') and jsonb_array_length(x -> 'items') >= 1
                     from (select head_attendance_list(null, 'ON_LEAVE') x) q), 'the On leave filter lists only people on approved leave');
select test.check((select not exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'status' <> 'PRESENT') and jsonb_array_length(x -> 'items') >= 2
                     from (select head_attendance_list(null, 'PRESENT') x) q), 'the Present filter lists only people who punched in');
select test.check((select jsonb_array_length(x -> 'items') = 1 and x -> 'items' -> 0 ->> 'profileId' = test.id('dhd_a1')::text from (select head_attendance_list(null, null, 'DHD A1') x) q), 'search finds an employee by name');
select test.check((select (x -> 'summary' ->> 'present')::int >= 1 and x ->> 'date' = (private.office_today() - 1)::text and
                          exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'profileId' = test.id('dhd_a1')::text and i ->> 'status' = 'PRESENT' and i ->> 'punchOut' is not null)
                     from (select head_attendance_list(private.office_today() - 1) x) q), 'a past date shows that day: a1 was present yesterday with both punches');
select test.must_fail($$select head_attendance_list(private.office_today() + 1)$$, 'a future date is refused', 'up to today');
select test.must_fail($$select head_attendance_list(private.office_today() - 800)$$, 'a date two years back is refused', 'two years');
select test.must_fail($$select head_attendance_list(null, 'LATE')$$, 'an unknown status is refused', 'Choose Present');
-- the Support head sees the Support side only (division scope), not the Sales people
select test.login('wkr_dhp');
select test.check((select not exists (select 1 from jsonb_array_elements((head_attendance_list() -> 'items')) i where i ->> 'profileId' in (test.id('wkr_tms')::text, test.id('tsk_tls')::text, test.id('dhd_a1')::text))
                          and exists (select 1 from jsonb_array_elements((head_attendance_list() -> 'items')) i where i ->> 'profileId' = test.id('tsk_tl1')::text)),
  'the Support head sees their Support people and none of the Sales people');
-- the head of the other department sees their own
select test.login('wkr_dhb');
select test.check((select exists (select 1 from jsonb_array_elements((head_attendance_list() -> 'items')) i where i ->> 'profileId' = test.id('dhd_b1')::text and i ->> 'status' = 'PRESENT')
                          and not exists (select 1 from jsonb_array_elements((head_attendance_list() -> 'items')) i where i ->> 'profileId' in (test.id('wkr_tms')::text, test.id('dhd_a1')::text, test.id('dhd_a2')::text))),
  'the head of wkr-b sees their own people and none of wkr-a''s');

-- ---------------------------------------------------------------------------
\echo '   2. overview numbers'
select test.login('wkr_dhs');
insert into dhd select 'ov', head_dashboard_overview();
select test.check((select v -> 'department' ->> 'id' = test.dept('wkr-a')::text from dhd where k = 'ov'), 'the overview is for the head''s own department');
select test.check((select (o.v -> 'attendance' ->> 'employees')::int = (a.v -> 'summary' ->> 'employees')::int and (o.v -> 'attendance' ->> 'present')::int = (a.v -> 'summary' ->> 'present')::int
                          and (o.v -> 'attendance' ->> 'absent')::int = (a.v -> 'summary' ->> 'absent')::int and (o.v -> 'attendance' ->> 'onLeave')::int = (a.v -> 'summary' ->> 'onLeave')::int
                     from dhd o, dhd a where o.k = 'ov' and a.k = 'att'), 'the overview''s attendance card matches the attendance list for today');
select test.check((select (o.v -> 'customers') = (head_customer_list() -> 'summary') and (o.v -> 'invoices') = (head_invoice_list() -> 'summary') and (o.v -> 'leads') = (head_lead_list() -> 'summary') from dhd o where o.k = 'ov'),
  'the overview''s customer, invoice and lead numbers are the same as the lists'' summaries');
select test.login('wkr_dhp');
insert into dhd select 'ovp', head_dashboard_overview();
select test.check((select (v -> 'customers') = (head_customer_list() -> 'summary') and (v -> 'invoices') = (head_invoice_list() -> 'summary') from dhd where k = 'ovp'),
  'for the Support head too: the overview numbers are the lists'' summaries');
select test.check((select (v -> 'customers' ->> 'total')::int >= 2 and (v -> 'customers' ->> 'inactive')::int >= 1 and (v -> 'customers' ->> 'new')::int >= 2 and (v -> 'customers' ->> 'withPendingInvoices')::int >= 2
                          and (v -> 'invoices' ->> 'overdue')::int >= 1 and (v -> 'invoices' ->> 'paid')::int >= 1 and (v -> 'invoices' ->> 'pending')::int >= 2 from dhd where k = 'ovp'),
  'the overview counts this suite''s customers (one inactive, both new, both with a pending invoice) and invoices (paid, pending, overdue)');
select test.login('wkr_dhs');

-- ---------------------------------------------------------------------------
\echo '   3. leads: the head creates one (existing flow), it lands in the department; other departments are refused'
insert into dhd select 'L0', to_jsonb(create_lead('{"name":"DHD Lead Own","phone":"9200000009","leadSource":"Walk-in"}'::jsonb, array['AI_CALLING']));
select test.check((select c.owner_id = test.id('wkr_dhs') and c.department_id = test.dept('wkr-a') and c.lifecycle_stage = 'LEAD'
                     from customers c where c.id = (select (v #>> '{}')::uuid from dhd where k = 'L0')),
  'a lead the head adds without choosing an owner is the head''s own, in the head''s department');
select test.must_fail_state(format($$select create_lead('{"name":"DHD Lead Foreign","phone":"9200000008","leadSource":"Walk-in","ownerId":"%s"}', array['AI_CALLING'])$$, test.id('dhd_b1')),
  'a lead cannot be given to an employee of another department', '42501');
select test.check((select jsonb_array_length(head_lead_owners()) >= 3 and head_lead_owners() -> 0 ->> 'id' = test.id('wkr_dhs')::text and head_lead_owners() -> 0 ->> 'role' = 'Myself'
                          and exists (select 1 from jsonb_array_elements(head_lead_owners()) x where x ->> 'id' = test.id('tsk_tls')::text)
                          and exists (select 1 from jsonb_array_elements(head_lead_owners()) x where x ->> 'id' = test.id('wkr_tms')::text)
                          and not exists (select 1 from jsonb_array_elements(head_lead_owners()) x where x ->> 'id' in (test.id('dhd_b1')::text, test.id('tsk_tl1')::text, test.id('tsk_m1')::text))),
  'the people a lead can be given to: the head first (Myself), then the Sales Team Leads and members of the department, no one from another department or from Support');
insert into dhd select 'L1', to_jsonb(create_lead(format('{"name":"DHD Lead One","company":"DHD Lead Co","phone":"9200000001","leadSource":"Referral","ownerId":"%s"}', test.id('tsk_tls'))::jsonb, array['AI_CALLING']));
reset role;
select test.check((select c.department_id = test.dept('wkr-a') and c.owner_id = test.id('tsk_tls') and c.lifecycle_stage = 'LEAD' and c.lead_status = 'NEW'
                     from customers c where c.id = (select (v #>> '{}')::uuid from dhd where k = 'L1')),
  'the lead is created in the head''s department, owned by the chosen Team Lead, as a new lead');
-- a lead that is being worked, a potential one, a lost one and one converted from a lead
insert into customers (owner_id, name, company, phone, lifecycle_stage, lead_status, lead_source) values
  (test.id('wkr_tms'), 'DHD Lead Two', 'DHD Lead Two Co', '9200000002', 'LEAD', 'INTERESTED', 'Walk-in'),
  (test.id('wkr_tms'), 'DHD Lead Three', 'DHD Lead Three Co', '9200000003', 'LEAD', 'READY_TO_BUY', 'Referral'),
  (test.id('wkr_tms'), 'DHD Lead Four', 'DHD Lead Four Co', '9200000004', 'LEAD', 'NEW', 'Walk-in');
update customers set lifecycle_stage = 'POTENTIAL' where name = 'DHD Lead Three';
update customers set lifecycle_stage = 'LOST' where name = 'DHD Lead Four';
insert into customers (owner_id, name, company, phone, lifecycle_stage, lead_source) values (test.id('wkr_tms'), 'DHD Lead Five', 'DHD Lead Five Co', '9200000005', 'LEAD', 'Walk-in');
insert into customer_activities (customer_id, type, note) select id, 'LEAD_CREATED', 'Lead added' from customers where name = 'DHD Lead Five';
update customers set lifecycle_stage = 'POTENTIAL' where name = 'DHD Lead Five';
update customers set lifecycle_stage = 'ONBOARDING' where name = 'DHD Lead Five';
update customers set lifecycle_stage = 'CUSTOMER' where name = 'DHD Lead Five';
-- a lead of the other department, created by its own head
select test.login('wkr_dhb');
set role authenticated;
select test.check((select create_lead(format('{"name":"DHD Beta Lead","phone":"9200000007","leadSource":"Walk-in","ownerId":"%s"}', test.id('dhd_b1'))::jsonb, array['AI_CALLING']) is not null),
  'the head of wkr-b creates a lead in their own department');
select test.login('wkr_dhs');
insert into dhd select 'leads', head_lead_list(null, null, null, 50, 0);
select test.check((select (v -> 'summary' ->> 'new')::int >= 1 and (v -> 'summary' ->> 'inProgress')::int >= 2 and (v -> 'summary' ->> 'converted')::int >= 1 and (v -> 'summary' ->> 'lost')::int >= 1
                          and (v -> 'summary' ->> 'total')::int = (v -> 'summary' ->> 'new')::int + (v -> 'summary' ->> 'inProgress')::int + (v -> 'summary' ->> 'converted')::int + (v -> 'summary' ->> 'lost')::int
                     from dhd where k = 'leads'), 'lead summary: new, in progress, converted and lost, adding up to the total');
select test.check((select exists (select 1 from jsonb_array_elements(v -> 'items') x where x ->> 'name' = 'DHD Lead One' and x ->> 'state' = 'NEW' and x -> 'owner' ->> 'id' = test.id('tsk_tls')::text and x ->> 'source' = 'Referral')
                     from dhd where k = 'leads'), 'the new lead appears in the head''s lead list with its state, owner and source');
select test.check((select not exists (select 1 from jsonb_array_elements(v -> 'items') x where x ->> 'name' = 'DHD Beta Lead') from dhd where k = 'leads'), 'the other department''s lead is not in the list');
select test.check((select exists (select 1 from jsonb_array_elements(v -> 'sources') s where s ->> 'source' = 'Referral') and exists (select 1 from jsonb_array_elements(v -> 'sources') s where s ->> 'source' = 'Walk-in') from dhd where k = 'leads'),
  'lead sources are summarised');
select test.check((select not exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'state' <> 'IN_PROGRESS') and jsonb_array_length(x -> 'items') >= 2 from (select head_lead_list(null, 'IN_PROGRESS') x) q), 'the In progress filter');
select test.check((select jsonb_array_length(x -> 'items') = 1 and x -> 'items' -> 0 ->> 'name' = 'DHD Lead One' from (select head_lead_list('dhd lead one') x) q), 'search finds a lead by name');
select test.check((select not exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'source' <> 'Referral') and jsonb_array_length(x -> 'items') >= 2 from (select head_lead_list(null, null, 'Referral') x) q), 'the source filter');
select test.must_fail($$select head_lead_list(null, 'WON')$$, 'an unknown lead status is refused', 'Choose New');
select test.login('wkr_dhb');
select test.check((select exists (select 1 from jsonb_array_elements((head_lead_list() -> 'items')) x where x ->> 'name' = 'DHD Beta Lead')
                          and not exists (select 1 from jsonb_array_elements((head_lead_list(null, null, null, 100, 0) -> 'items')) x where x ->> 'name' like 'DHD Lead %')), 'the head of wkr-b sees their lead and none of wkr-a''s');
select test.login('dh_acc');
select test.check((select jsonb_array_length(head_lead_list() -> 'items') = 0 or not exists (select 1 from jsonb_array_elements(head_lead_list(null, null, null, 100, 0) -> 'items') x where x ->> 'name' like 'DHD %')),
  'the Accounts head sees none of these leads');

-- ---------------------------------------------------------------------------
\echo '   4. customers (Support head wkr_dhp; the Sales head''s side does not include Support customers)'
select test.login('wkr_dhp');
insert into dhd select 'cust', head_customer_list(null, null, 50, 0);
select test.check((select (v ->> 'total')::int >= 2 and exists (select 1 from jsonb_array_elements(v -> 'items') x where x ->> 'name' = 'DHD Alpha One')
                          and exists (select 1 from jsonb_array_elements(v -> 'items') x where x ->> 'name' = 'DHD Alpha Two')
                          and not exists (select 1 from jsonb_array_elements(v -> 'items') x where x ->> 'name' = 'DHD Beta One') from dhd where k = 'cust'),
  'the head sees every customer of their department and none of another');
select test.check((select x ->> 'status' = 'ACTIVE' and x -> 'relationshipManager' ->> 'id' = test.id('tsk_m1')::text and (x ->> 'pendingInvoices')::int = 1 and x ->> 'createdAt' is not null and x ->> 'department' is not null
                     from dhd, jsonb_array_elements(v -> 'items') x where k = 'cust' and x ->> 'name' = 'DHD Alpha One'), 'a row shows status, relationship manager, pending invoices, creation date and department');
select test.check((select jsonb_array_length(x -> 'items') = 1 and x -> 'items' -> 0 ->> 'company' = 'DHD Alpha Foods' from (select head_customer_list('alpha foods') x) q), 'search by company');
select test.check((select jsonb_array_length(x -> 'items') >= 1 and not exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'status' <> 'INACTIVE') from (select head_customer_list(null, 'INACTIVE') x) q), 'filter by status');
select test.must_fail($$select head_customer_list(null, 'GONE')$$, 'an unknown customer status is refused', 'Choose Active');
insert into dhd select 'cd', head_customer_detail((select id from customers where name = 'DHD Alpha One'));
select test.check((select v -> 'customer' ->> 'name' = 'DHD Alpha One' and v -> 'customer' ->> 'department' is not null and jsonb_array_length(v -> 'invoices') = 2
                          and (v -> 'invoiceSummary' ->> 'invoiced')::numeric = 3000 and (v -> 'invoiceSummary' ->> 'paid')::numeric = 1000 and (v -> 'invoiceSummary' ->> 'outstanding')::numeric = 2000
                     from dhd where k = 'cd'), 'customer detail: profile, department, its invoices and the payment summary');
select test.check((select exists (select 1 from jsonb_array_elements(v -> 'invoices') i where i ->> 'number' = 'DHD-A2' and (i ->> 'overdue')::boolean) from dhd where k = 'cd'), 'a pending invoice past its due date is marked overdue');
select test.must_fail($$select head_customer_detail((select id from customers where name = 'DHD Beta One'))$$, 'a customer of another department cannot be opened', 'not found');
select test.login('wkr_dhs');
select test.check((select not exists (select 1 from jsonb_array_elements(head_customer_list(null, null, 100, 0) -> 'items') x where x ->> 'name' like 'DHD Alpha%' or x ->> 'name' like 'DHD Beta%')), 'the Sales head, on the Sales side, sees none of the Support team''s customers');
select test.login('wkr_dhp');
select test.login('wkr_dhb');
select test.check((select exists (select 1 from jsonb_array_elements(head_customer_list(null, null, 100, 0) -> 'items') x where x ->> 'name' = 'DHD Beta One')
                          and not exists (select 1 from jsonb_array_elements(head_customer_list(null, null, 100, 0) -> 'items') x where x ->> 'name' like 'DHD Alpha%')), 'the head of wkr-b sees their customer and none of wkr-a''s');
select test.must_fail($$select head_customer_detail((select id from customers where name = 'DHD Alpha One'))$$, 'and cannot open a wkr-a customer', 'not found');

-- ---------------------------------------------------------------------------
\echo '   5. invoices (read only)'
select test.login('wkr_dhp');
select test.check((select (x ->> 'total')::int = 4 and not exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'number' = 'DHD-B1')
                          and (select sum((i ->> 'amount')::numeric) from jsonb_array_elements(x -> 'items') i where i ->> 'status' <> 'Cancelled') = 7000
                     from (select head_invoice_list('DHD-', null, null, null, 100, 0) x) q), 'the head sees the four invoices of their customers (one cancelled, 7000 otherwise) and not the other department''s');
select test.check((select x -> 'items' -> 0 ?& array['number', 'customer', 'amount', 'issueDate', 'dueDate', 'status', 'paidAmount', 'outstanding', 'services']
                     from (select head_invoice_list('DHD-A2') x) q), 'an invoice row has number, customer, amount, dates, status, paid and outstanding amounts and its service');
select test.check((select jsonb_array_length(x -> 'items') = 1 and (x -> 'items' -> 0 ->> 'overdue')::boolean and (x -> 'items' -> 0 ->> 'outstanding')::numeric = 2000 and x -> 'items' -> 0 -> 'services' ->> 0 = 'AI Calling'
                     from (select head_invoice_list('DHD-A2') x) q), 'search by number: pending, overdue, outstanding 2000, related service');
select test.check((select jsonb_array_length(x -> 'items') = 1 and x -> 'items' -> 0 ->> 'number' = 'DHD-A1' and (x -> 'items' -> 0 ->> 'paidAmount')::numeric = 1000 and (x -> 'items' -> 0 ->> 'outstanding')::numeric = 0 from (select head_invoice_list('DHD-', 'PAID') x) q), 'the Paid filter, with the paid amount');
select test.check((select not exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'status' <> 'Pending') and (select count(*) = 2 from jsonb_array_elements(x -> 'items') i where i ->> 'number' like 'DHD-%') from (select head_invoice_list(null, 'PENDING', null, null, 100, 0) x) q), 'the Pending filter');
select test.check((select jsonb_array_length(x -> 'items') = 1 and x -> 'items' -> 0 ->> 'number' = 'DHD-A2' from (select head_invoice_list('DHD-', 'OVERDUE') x) q), 'the Overdue filter: only a pending invoice past its due date');
select test.check((select jsonb_array_length(x -> 'items') = 1 and x -> 'items' -> 0 ->> 'number' = 'DHD-A4' from (select head_invoice_list('DHD-', 'CANCELLED') x) q), 'cancelled invoices are available as their own filter');
select test.check((select jsonb_array_length(x -> 'items') = 2 and not exists (select 1 from jsonb_array_elements(x -> 'items') i where i ->> 'number' not in ('DHD-A2', 'DHD-A3'))
                     from (select head_invoice_list('DHD-', null, current_date - 12, current_date) x) q), 'the date range is on the invoice date');
select test.check((select (x ->> 'total')::int = 2 from (select head_invoice_list('alpha foods') x) q), 'search by customer or company');
select test.must_fail($$select head_invoice_list(null, null, current_date, current_date - 5)$$, 'an end date before the start date is refused', 'end date');
select test.must_fail($$select head_invoice_list(null, 'LATE')$$, 'an unknown invoice status is refused', 'Choose Paid');
-- the existing document permissions still decide who opens an invoice
select test.check((select invoice_detail((select id from member_invoices where invoice_number = 'DHD-A2')) ->> 'number' = 'DHD-A2'), 'the head opens an invoice of a department customer (existing invoice_detail)');
select test.must_fail($$select invoice_detail((select id from member_invoices where invoice_number = 'DHD-B1'))$$, 'but not an invoice of another department''s customer', 'not found');
select test.must_fail($$select invoice_file_access((select id from member_invoices where invoice_number = 'DHD-B1'), 'PAID', 'VIEW')$$, 'nor its document', 'not found');
-- no accounting rights came with the dashboard
select test.must_fail($$select accounts_set_invoice_status((select id from member_invoices where invoice_number = 'DHD-A2'), 'Paid')$$, 'the head cannot mark an invoice paid (Accounts only)', 'accounts|only|forbidden');
-- a direct update attempt by the head (refused or matching no row: either way nothing changes)
do $$ begin update public.member_invoices set status = 'Paid' where invoice_number = 'DHD-A3'; exception when others then null; end $$;
reset role;
select test.check((select status = 'Pending' from member_invoices where invoice_number = 'DHD-A3'), 'after the head''s direct update attempt the invoice is still pending');
set role authenticated;
select test.login('wkr_dhb');
select test.check((select (x ->> 'total')::int = 1 and x -> 'items' -> 0 ->> 'number' = 'DHD-B1' from (select head_invoice_list(null, null, null, null, 100, 0) x) q), 'the head of wkr-b sees only their own department''s invoice');

-- ---------------------------------------------------------------------------
\echo '   6. only a Department Head, and never another department''s numbers'
select test.login('dh_acc');
select test.check((select head_dashboard_overview() -> 'department' ->> 'id' <> test.dept('wkr-a')::text), 'the Accounts head''s overview is their own department''s, not wkr-a''s');
select test.check((select not exists (select 1 from jsonb_array_elements(head_invoice_list(null, null, null, null, 100, 0) -> 'items') x where x ->> 'number' like 'DHD-%')), 'the Accounts head sees none of these invoices through the dashboard');
select test.login('tsk_tls');
select test.must_fail_state($$select head_dashboard_overview()$$, 'a Team Lead is refused the overview', '42501');
select test.must_fail_state($$select head_attendance_list()$$, 'a Team Lead is refused the attendance list', '42501');
select test.must_fail_state($$select head_customer_list()$$, 'a Team Lead is refused the customer list', '42501');
select test.must_fail_state($$select head_invoice_list()$$, 'a Team Lead is refused the invoice list', '42501');
select test.login('wkr_tms');
select test.must_fail_state($$select head_lead_list()$$, 'a Team Member is refused the lead list', '42501');
select test.must_fail_state($$select head_lead_owners()$$, 'a Team Member is refused the owners list', '42501');
select test.login('sa');
select test.must_fail_state($$select head_dashboard_overview()$$, 'the Super Admin keeps their own pages and is refused here', '42501');
reset role;
set role anon;
select test.must_fail($$select head_dashboard_overview()$$, 'a signed-out caller cannot call it', 'permission denied');
reset role;
select test.check((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('head_dept', 'head_iso_date', 'head_attendance_rows', 'head_customers', 'head_leads', 'head_lead_state', 'head_invoices')
                     and has_function_privilege('authenticated', p.oid, 'execute')), 'none of this migration''s private helpers can be called by a signed-in user');

-- ---------------------------------------------------------------------------
\echo '   7. nothing existing changed'
select test.check((select count(*) = 3 from customers where name like 'DHD Alpha%' or name like 'DHD Beta%'), 'the customers made for this suite are all still there');
select test.check((select count(*) = 5 from member_invoices where invoice_number like 'DHD-%'), 'and so are the invoices (nothing was written by the dashboard functions)');
\echo '   done'
