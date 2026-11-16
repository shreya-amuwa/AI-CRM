-- =============================================================================
-- Upload Leads (migration 20270104000100): every Sales employee uploads leads; each lead is made by create_lead and owned by the uploader unless the
-- existing assignment rule allows another owner; duplicates and invalid rows are reported and never created; a retried chunk creates nothing twice.
-- Runs at the end of run.sh (uses the Wabastore / Whatsbox users of the earlier suites).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- upload leads'
reset role;
select test.create_auth_user('lu_m1', 'lu.m1@amuwa.com', '{"full_name":"Upload Member One"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('lu_m2', 'lu.m2@amuwa.com', '{"full_name":"Upload Member Two"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('lu_tc', 'lu.tc@amuwa.com', '{"full_name":"Upload Telecaller"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('lu_inf', 'lu.inf@amuwa.com', '{"full_name":"Upload Influencer"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('lu_x', 'lu.x@amuwa.com', '{"full_name":"Upload Elsewhere"}',
  jsonb_build_object('provisioned_by', test.id('th_wbx'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')));

create or replace function test.lu_svc(n int) returns text language sql stable as $$ select name from public.crm_services where is_active order by sort_order offset n - 1 limit 1 $$;
create or replace function test.lu_lead(p_phone text) returns public.customers language sql stable security definer set search_path = '' as
  $$ select * from public.customers where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = p_phone order by created_at limit 1 $$;
create or replace function test.lu_count(p_phone text) returns bigint language sql stable security definer set search_path = '' as
  $$ select count(*) from public.customers where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = p_phone $$;
create or replace function test.lu_notes(p_who text, p_type text) returns bigint language sql stable security definer set search_path = '' as
  $$ select count(*) from public.notifications where recipient_id = test.id(p_who) and type = p_type $$;
create or replace function test.lu_titled(p_title text) returns bigint language sql stable security definer set search_path = '' as
  $$ select count(*) from public.notifications where type = 'CUSTOMER_CREATED' and title = p_title $$;
create or replace function test.lu_audit(p_id uuid) returns bigint language sql stable security definer set search_path = '' as
  $$ select count(*) from public.audit_logs where action = 'LEAD_UPLOAD_COMPLETED' and entity_id = p_id $$;
-- a row as the API sends it (already checked with the Add Lead rules)
create or replace function test.lu_row(p_row int, p_name text, p_phone text, p_extra jsonb default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object('row', p_row, 'name', p_name, 'company', p_name || ' Co', 'phone', p_phone, 'leadSource', 'Referral',
    'services', jsonb_build_array(test.lu_svc(1)), 'assignee', '', 'problem', null, 'raw', jsonb_build_object('name', p_name, 'phone', p_phone)) || p_extra
$$;
grant execute on function test.lu_audit(uuid), test.lu_titled(text), test.lu_svc(int), test.lu_lead(text), test.lu_count(text), test.lu_notes(text, text), test.lu_row(int, text, text, jsonb) to authenticated;
set role authenticated;
select test.login('dh_wab');
select set_sales_sub_role(test.id('lu_tc'), 'TELECALLER');
select set_sales_sub_role(test.id('lu_inf'), 'INFLUENCER');

\echo '   who may upload'
select test.login('sup_plain');
select test.must_fail($$select lead_upload_check(jsonb_build_array(test.lu_row(2, 'Nope', '9711100001')))$$, 'a Support member cannot upload leads', 'FORBIDDEN');
select test.must_fail($$select lead_upload_start(gen_random_uuid(), 'x.csv', 'CSV', repeat('a', 64), 1)$$, 'nor start an upload', 'FORBIDDEN');
select test.login('acc_m');
select test.must_fail($$select lead_upload_history()$$, 'an Accounts member cannot', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select lead_upload_history()$$, 'the Super Admin is not a Sales employee (no upload)', 'FORBIDDEN');
select test.login('lu_inf');
select test.check(jsonb_typeof(lead_upload_history()) = 'array', 'an Influencer (a Sales role without a dashboard yet) may upload');
select test.login('lu_tc');
select test.check(jsonb_typeof(lead_upload_history()) = 'array', 'a Telecaller may upload');
select test.login('th_wab');
select test.check(jsonb_typeof(lead_upload_history()) = 'array', 'a Sales Team Lead may upload');
select test.login('sh_head');
select test.check(jsonb_typeof(lead_upload_history()) = 'array', 'the Sales Department Head may upload');

\echo '   the preview: new, duplicate and invalid rows, saving nothing'
select test.login('lu_m1');
create temporary table lu_check as select lead_upload_check(jsonb_build_array(
  test.lu_row(2, 'LU Alpha', '9711100001', jsonb_build_object('email', 'lu.alpha@example.com', 'city', 'Surat', 'nextFollowUpAt', '2027-01-05T10:00:00+05:30', 'notes', 'Contact person: Sunil')),
  test.lu_row(3, 'LU Beta', '9711100002', jsonb_build_object('services', jsonb_build_array(lower(test.lu_svc(1)), test.lu_svc(2)))),
  test.lu_row(4, 'LU Again', '+91 97111 00001'),
  test.lu_row(5, 'LU Bad', '9711100005', jsonb_build_object('problem', 'Mobile Number: Enter a 10-digit mobile number.')),
  test.lu_row(6, 'LU Service', '9711100006', jsonb_build_object('services', jsonb_build_array('No Such Service'))),
  test.lu_row(7, 'LU Assigned', '9711100007', jsonb_build_object('assignee', 'lu.m2@amuwa.com')),
  test.lu_row(8, '', '9711100008'),
  test.lu_row(9, 'LU Phone', '12345'),
  test.lu_row(10, 'LU Mail', '9711100010', jsonb_build_object('email', 'lu.alpha@example.com'))
)) v;
select test.check((select (v -> 'summary') = '{"total": 9, "new": 2, "duplicates": 2, "invalid": 5}'::jsonb from lu_check), 'the summary counts new, duplicate and invalid rows');
select test.check((select x ->> 'outcome' = 'DUPLICATE' and x ->> 'message' ~ 'earlier in this file' from lu_check, jsonb_array_elements(v -> 'rows') x where (x ->> 'row')::int = 4), 'the same mobile number twice in the file is a duplicate (other spelling)');
select test.check((select x ->> 'outcome' = 'DUPLICATE' from lu_check, jsonb_array_elements(v -> 'rows') x where (x ->> 'row')::int = 10), 'the same e-mail twice in the file is a duplicate');
select test.check((select x ->> 'message' ~ '10-digit' from lu_check, jsonb_array_elements(v -> 'rows') x where (x ->> 'row')::int = 5), 'a problem the API found is reported with its row');
select test.check((select x ->> 'message' ~ 'Unknown service' from lu_check, jsonb_array_elements(v -> 'rows') x where (x ->> 'row')::int = 6), 'an unknown service is invalid');
select test.check((select x ->> 'message' ~ 'cannot assign' from lu_check, jsonb_array_elements(v -> 'rows') x where (x ->> 'row')::int = 7), 'a Team Member cannot give a lead to a colleague');
select test.check((select x ->> 'message' ~ 'name is required' from lu_check, jsonb_array_elements(v -> 'rows') x where (x ->> 'row')::int = 8), 'the database checks the name again');
select test.check((select x ->> 'message' ~ 'mobile' from lu_check, jsonb_array_elements(v -> 'rows') x where (x ->> 'row')::int = 9), 'and the mobile number');
select test.check((select x ->> 'ownerName' = 'Upload Member One' from lu_check, jsonb_array_elements(v -> 'rows') x where (x ->> 'row')::int = 2), 'a new row shows its owner: the uploader');
select test.check(test.lu_count('9711100001') = 0 and test.lu_count('9711100002') = 0, 'the preview saves nothing');
drop table lu_check;
select test.must_fail($$select lead_upload_check('[]'::jsonb)$$, 'an empty file is refused', 'no lead rows');

\echo '   the import: chunks, retries, the summary'
select test.must_fail($$select lead_upload_start(null, 'x.csv', 'CSV', repeat('a', 64), 1)$$, 'an upload needs a request id', 'VALIDATION_ERROR');
select test.must_fail($$select lead_upload_start(gen_random_uuid(), 'x.xls', 'XLS', repeat('a', 64), 1)$$, 'only XLSX or CSV', 'VALIDATION_ERROR');
select test.must_fail($$select lead_upload_start(gen_random_uuid(), 'x.csv', 'CSV', repeat('a', 64), 5001)$$, 'at most 5,000 rows', 'VALIDATION_ERROR');
create temporary table lu_b (id uuid);
grant all on lu_b to authenticated;
insert into lu_b select (lead_upload_start('11111111-1111-4111-8111-111111111111', 'expo leads.xlsx', 'XLSX', repeat('b', 64), 5) ->> 'id')::uuid;
select test.check((lead_upload_start('11111111-1111-4111-8111-111111111111', 'expo leads.xlsx', 'XLSX', repeat('b', 64), 5) ->> 'id')::uuid = (select id from lu_b), 'the same request id returns the same upload (a double click starts nothing twice)');
select test.check((select (lead_upload_rows(id, jsonb_build_array(
    test.lu_row(2, 'LU Alpha', '9711100001', jsonb_build_object('email', 'lu.alpha@example.com', 'city', 'Surat', 'nextFollowUpAt', '2027-01-05T10:00:00+05:30', 'notes', 'Contact person: Sunil')),
    test.lu_row(3, 'LU Beta', '9711100002'),
    test.lu_row(4, 'LU Again', '9711100001'))) -> 'batch' ->> 'processedRows')::int = 3 from lu_b), 'a chunk of three rows is processed');
select test.check(test.lu_count('9711100001') = 1 and test.lu_count('9711100002') = 1, 'two leads were created, the duplicate was not');
select test.check((select (lead_upload_rows(id, jsonb_build_array(test.lu_row(2, 'LU Alpha', '9711100001'), test.lu_row(3, 'LU Beta', '9711100002'))) -> 'results') = '[]'::jsonb from lu_b),
  'the same chunk sent again does nothing');
select test.check(test.lu_count('9711100001') = 1 and test.lu_count('9711100002') = 1, 'so a retry creates no second lead');
select test.must_fail($$select lead_upload_finish((select id from lu_b))$$, 'an upload cannot be finished before every row was sent', '3 of 5 rows');
select test.must_fail($$select lead_upload_rows((select id from lu_b), jsonb_build_array(test.lu_row(20, 'A', '9711100020'), test.lu_row(21, 'B', '9711100021'), test.lu_row(22, 'C', '9711100022')))$$,
  'more rows than the file has are refused', 'More rows');
select test.check((select (lead_upload_rows(id, jsonb_build_array(
    test.lu_row(5, 'LU Bad', '9711100005', jsonb_build_object('problem', 'Mobile Number: Enter a 10-digit mobile number.')),
    test.lu_row(6, 'LU Assigned', '9711100007', jsonb_build_object('assignee', 'lu.m2@amuwa.com')))) -> 'batch' ->> 'processedRows')::int = 5 from lu_b), 'the last chunk');
create temporary table lu_sum as select lead_upload_finish((select id from lu_b)) v;
select test.check((select (v ->> 'status') = 'COMPLETED' and (v ->> 'totalRows')::int = 5 and (v ->> 'created')::int = 2 and (v ->> 'duplicates')::int = 1
                      and (v ->> 'invalid')::int = 2 and (v ->> 'failed')::int = 0 from lu_sum), 'the summary: 5 rows, 2 created, 1 duplicate, 2 invalid');
select test.check((lead_upload_finish((select id from lu_b)) ->> 'created')::int = 2, 'finishing again returns the same summary');
drop table lu_sum;
select test.must_fail($$select lead_upload_rows((select id from lu_b), jsonb_build_array(test.lu_row(9, 'Late', '9711100099')))$$, 'a finished upload takes no more rows', 'already finished');

\echo '   the leads: the Add Lead record, owned by the uploader'
select test.check((select c.owner_id = test.id('lu_m1') and c.created_by = test.id('lu_m1') and c.lifecycle_stage = 'LEAD' and c.lead_status = 'NEW'
                      and c.team_id = test.team('wabastore', 'Sales') and c.department_id = test.dept('wabastore') and c.lead_source = 'Referral'
                      and c.email = 'lu.alpha@example.com' and c.city = 'Surat' and c.next_follow_up_at = '2027-01-05T10:00:00+05:30'::timestamptz
                      and c.notes = 'Contact person: Sunil' and c.lead_upload_batch_id = (select id from lu_b) and c.call_status = 'PENDING'
                    from test.lu_lead('9711100001') c), 'the lead has its owner, creator, team, department, source, follow-up and Upload Batch ID');
select test.check(exists (select 1 from public.customer_services s where s.customer_id = (test.lu_lead('9711100002')).id), 'the lead has its service');
select test.check((select count(*) from public.customers where name in ('LU Alpha', 'LU Beta')) = 2, 'the uploader sees the leads (their own pipeline)');
select test.check(exists (select 1 from public.customer_activities a where a.customer_id = (test.lu_lead('9711100001')).id and a.type = 'LEAD_CREATED')
              and exists (select 1 from public.customer_activities a where a.customer_id = (test.lu_lead('9711100001')).id and a.type = 'LEAD_UPLOADED'), 'the timeline says it was added and uploaded');
select test.check(test.lu_audit((select id from lu_b)) = 1, 'the upload is in the audit log');
select test.check((select jsonb_array_length(v -> 'rows') = 3 and (v -> 'rows' -> 0 ->> 'row')::int = 4 and v -> 'rows' -> 0 ->> 'outcome' = 'DUPLICATE'
                      and v -> 'rows' -> 0 -> 'data' ->> 'name' = 'LU Again' and v -> 'rows' -> 1 ->> 'message' ~ '10-digit'
                    from (select lead_upload_issues((select id from lu_b)) v) q), 'the rows that were not created keep their values and the reason');
select test.check((select x ->> 'id' = (select id::text from lu_b) and (x ->> 'created')::int = 2 from jsonb_array_elements(lead_upload_history()) x limit 1), 'the upload is in the history');
select test.must_fail($$select lead_upload_start(gen_random_uuid(), 'expo leads copy.xlsx', 'XLSX', repeat('b', 64), 5)$$, 'the same file cannot be imported twice', 'already uploaded');

\echo '   another person''s upload'
select test.login('lu_m2');
select test.must_fail($$select lead_upload_issues((select id from lu_b))$$, 'a colleague cannot read the upload', 'NOT_FOUND');
select test.must_fail($$select lead_upload_rows((select id from lu_b), jsonb_build_array(test.lu_row(2, 'X', '9711100030')))$$, 'nor add rows to it', 'NOT_FOUND');
select test.check(not exists (select 1 from jsonb_array_elements(lead_upload_history()) x where x ->> 'id' = (select id::text from lu_b)), 'nor see it in their history');
select test.check((select count(*) from public.customers where name = 'LU Alpha') = 0, 'and does not see the uploader''s lead (visibility unchanged)');
-- a colleague's existing lead is a duplicate, named only vaguely (they may not open it)
select test.check((select v -> 'rows' -> 0 ->> 'outcome' = 'DUPLICATE' and v -> 'rows' -> 0 ->> 'message' ~ 'already exists in the CRM' and v -> 'rows' -> 0 ->> 'message' !~ 'LU Alpha'
                    from (select lead_upload_check(jsonb_build_array(test.lu_row(2, 'Someone', '9711100001'))) v) q), 'a lead already in the department is a duplicate, without revealing it');
select test.login('lu_m1');
select test.check((select v -> 'rows' -> 0 ->> 'message' ~ 'LU Alpha' from (select lead_upload_check(jsonb_build_array(test.lu_row(2, 'Someone', '9711100001'))) v) q),
  'the owner is told which record it is');
select test.login('lu_x');
select test.check((select v -> 'rows' -> 0 ->> 'outcome' = 'NEW' from (select lead_upload_check(jsonb_build_array(test.lu_row(2, 'Other Dept', '9711100001'))) v) q),
  'another department''s duplicate rule is its own (the existing per-department rule)');

\echo '   Team Lead and Department Head: the existing assignment rules'
select test.login('th_wab');
select test.check(private.can_assign_customer_owner(test.id('lu_m2')), 'fixture: the Team Lead leads Upload Member Two');
insert into lu_b select (lead_upload_start(gen_random_uuid(), 'team.csv', 'CSV', repeat('c', 64), 3) ->> 'id')::uuid;
create temporary table lu_tl as select lead_upload_rows((select id from lu_b order by ctid desc limit 1), jsonb_build_array(
  test.lu_row(2, 'LU TL Own', '9711100101'),
  test.lu_row(3, 'LU TL Member', '9711100102', jsonb_build_object('assignee', 'LU.M2@amuwa.com')),
  test.lu_row(4, 'LU TL Elsewhere', '9711100103', jsonb_build_object('assignee', 'lu.x@amuwa.com')))) v;
select test.check((test.lu_lead('9711100101')).owner_id = test.id('th_wab'), 'a Team Lead''s lead is their own when no one is named');
select test.check((test.lu_lead('9711100102')).owner_id = test.id('lu_m2') and (test.lu_lead('9711100102')).created_by = test.id('th_wab'), 'a Team Lead can give a lead to their own member (any case of the e-mail)');
select test.check(test.lu_count('9711100103') = 0 and (select x ->> 'outcome' = 'INVALID' from lu_tl, jsonb_array_elements(v -> 'results') x where (x ->> 'row')::int = 4),
  'but not to someone of another department');
drop table lu_tl;
select test.check((lead_upload_finish((select id from lu_b order by ctid desc limit 1)) ->> 'created')::int = 2, 'the Team Lead''s upload: 2 created');
select test.login('lu_m2');
select test.check(test.lu_notes('lu_m2', 'LEADS_UPLOADED') >= 1, 'the member who was given leads is told once');
select test.check(test.lu_titled('New customer: LU Alpha') = 0 and test.lu_titled('New customer: LU Beta') = 0, 'no per-lead "New customer" note during an upload');

select test.login('lu_m1');
select test.check(test.lu_notes('th_wab', 'LEADS_UPLOADED') >= 1, 'the Team Lead gets one summary of the member''s upload');

select test.login('sh_head');
insert into lu_b select (lead_upload_start(gen_random_uuid(), 'head.xlsx', 'XLSX', repeat('d', 64), 3) ->> 'id')::uuid;
select lead_upload_rows((select id from lu_b order by ctid desc limit 1), jsonb_build_array(
  test.lu_row(2, 'LU Head Own', '9711100201'),
  test.lu_row(3, 'LU Head Member', '9711100202', jsonb_build_object('assignee', 'Upload Member One')),
  test.lu_row(4, 'LU Head Elsewhere', '9711100203', jsonb_build_object('assignee', 'lu.x@amuwa.com'))));
select test.check((test.lu_lead('9711100201')).owner_id = test.id('sh_head') and (test.lu_lead('9711100201')).department_id = test.dept('wabastore'),
  'the Sales Department Head''s own lead sits in their department (the Department Head lead rule)');
select test.check((test.lu_lead('9711100202')).owner_id = test.id('lu_m1'), 'the Department Head can give a lead to an employee of the department (by full name)');
select test.check(test.lu_count('9711100203') = 0, 'but not to another department');
select test.check((lead_upload_finish((select id from lu_b order by ctid desc limit 1)) ->> 'invalid')::int = 1, 'the head''s upload counts the refused row as invalid');

\echo '   Telecaller and other Sales roles'
select test.login('lu_tc');
insert into lu_b select (lead_upload_start(gen_random_uuid(), 'calls.csv', 'CSV', repeat('e', 64), 1) ->> 'id')::uuid;
select lead_upload_rows((select id from lu_b order by ctid desc limit 1), jsonb_build_array(test.lu_row(2, 'LU Tele Lead', '9711100301')));
select lead_upload_finish((select id from lu_b order by ctid desc limit 1));
select test.check((test.lu_lead('9711100301')).owner_id = test.id('lu_tc'), 'a Telecaller''s uploaded lead is theirs');
select test.check((telecaller_leads_list(null, null, null, null, 1, 50) ->> 'total')::int >= 1
              and exists (select 1 from jsonb_array_elements(telecaller_leads_list(null, null, null, null, 1, 50) -> 'items') x where x ->> 'name' = 'LU Tele Lead'), 'and appears in the Telecaller''s Leads page');
select test.login('lu_inf');
insert into lu_b select (lead_upload_start(gen_random_uuid(), 'inf.csv', 'CSV', repeat('f', 64), 1) ->> 'id')::uuid;
select lead_upload_rows((select id from lu_b order by ctid desc limit 1), jsonb_build_array(test.lu_row(2, 'LU Influencer Lead', '9711100401', jsonb_build_object('assignee', 'lu.inf@amuwa.com'))));
select test.check((test.lu_lead('9711100401')).owner_id = test.id('lu_inf'), 'an Influencer''s lead is theirs (naming themselves is allowed)');

\echo '   a row that fails while saving leaves nothing half-made'
select test.login('lu_m1');
insert into lu_b select (lead_upload_start(gen_random_uuid(), 'race.csv', 'CSV', repeat('9', 64), 2) ->> 'id')::uuid;
reset role;
-- an owner who stops being active between the check and the save: create_lead refuses that row only
create or replace function test.lu_fail_trigger() returns trigger language plpgsql as $$
begin
  if new.name = 'LU Will Fail' then raise exception 'VALIDATION_ERROR: Simulated save failure.' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger lu_fail before insert on public.customers for each row execute function test.lu_fail_trigger();
set role authenticated;
select test.login('lu_m1');
create temporary table lu_f as select lead_upload_rows((select id from lu_b order by ctid desc limit 1), jsonb_build_array(
  test.lu_row(2, 'LU Will Fail', '9711100501'), test.lu_row(3, 'LU Will Pass', '9711100502'))) v;
select test.check((select x ->> 'outcome' = 'FAILED' and x ->> 'message' = 'Simulated save failure.' from lu_f, jsonb_array_elements(v -> 'results') x where (x ->> 'row')::int = 2), 'the failed row is reported with a clear reason');
select test.check(test.lu_count('9711100501') = 0 and test.lu_count('9711100502') = 1, 'only that row is missing; the next one is created');
select test.check(not exists (select 1 from public.customer_activities a join public.customers c on c.id = a.customer_id where c.name = 'LU Will Fail'), 'nothing of the failed lead is left behind');
select test.check((lead_upload_finish((select id from lu_b order by ctid desc limit 1)) ->> 'failed')::int = 1, 'the summary counts it as failed');
drop table lu_f;
reset role;
drop trigger lu_fail on public.customers;
drop function test.lu_fail_trigger();

\echo '   nothing else can set the Upload Batch ID'
set role authenticated;
select test.login('lu_m1');
select test.check((select public.create_lead(jsonb_build_object('name', 'LU Plain', 'company', 'LU Plain Co', 'phone', '9711100601', 'leadSource', 'Walk-in'), test.svcs(1))) is not null, 'Add Lead still works');
select test.check((test.lu_lead('9711100601')).lead_upload_batch_id is null and (test.lu_lead('9711100601')).call_status is null, 'and its lead has no Upload Batch ID');
select test.check(test.lu_titled('New customer: LU Plain') >= 1, 'and the Team Lead still gets the per-lead note for Add Lead');
do $$ begin
  perform set_config('crm.lead_upload_batch', (select id::text from lu_b limit 1), true);
  perform public.create_lead(jsonb_build_object('name', 'LU Sneaky', 'company', 'LU Sneaky Co', 'phone', '9711100602', 'leadSource', 'Walk-in'), test.svcs(1));
end $$;
select test.check(test.lu_count('9711100602') = 1 and (test.lu_lead('9711100602')).lead_upload_batch_id is null, 'a finished upload cannot be attached to another lead');
select test.must_fail($$update public.customers set lead_upload_batch_id = (select id from lu_b limit 1) where name = 'LU Plain'$$, 'the browser cannot write the column', 'permission denied');
select test.must_fail($$select * from public.lead_upload_batches$$, 'the upload tables are not readable directly', 'permission denied');
select test.must_fail($$select * from public.lead_upload_rows$$, 'nor the row log', 'permission denied');

reset role;
drop table lu_b;
\echo '   upload leads: all checks passed'
