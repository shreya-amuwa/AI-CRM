-- =============================================================================
-- Crocodial field alignment (20270117000200) and the Sales Department Head role-wise sections (20270117000300).
--  - the call figures come only from the Crocodial call log, through the approved mapping in effect at the call (the same helpers for the
--    person's own view, the management view and the head's sections): total, connected, not connected (connected = false only: an empty
--    "connected" is in neither), unique numbers (+91 / 0 prefixes are one number), talk time;
--  - the management view's totals count a number / lead once across people;
--  - a person not connected to Crocodial has no call figures (null), never zeros; demos come from the CRM schedule only;
--  - who may see the head's sections, and their filters.
-- Uses the Wabastore Sales head (sh_head, sales_department_head_test.sql), the Support head (dh_wab), the Team Lead (th_wab), the Whatsbox
-- Business Associate (ba_x), the Telecaller sh_tc and people made here. Runs after the Crocodial suites.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Crocodial field alignment and the Sales head role sections'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270117000200_crocodial_field_alignment.sql
\i supabase/migrations/20270117000200_crocodial_field_alignment.sql
\i supabase/migrations/20270117000300_sales_role_dashboards.sql
\i supabase/migrations/20270117000300_sales_role_dashboards.sql
select test.create_auth_user('rd_tc', 'rd.tc@amuwa.com', '{"full_name":"Role Dash Telecaller"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('rd_tc2', 'rd.tc2@amuwa.com', '{"full_name":"Role Dash Second Caller"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('rd_ba', 'rd.ba@amuwa.com', '{"full_name":"Role Dash Associate"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
update profiles set sales_sub_role = 'TELECALLER' where id in (test.id('rd_tc'), test.id('rd_tc2'));
update profiles set sales_sub_role = 'BUSINESS_ASSOCIATE' where id = test.id('rd_ba');

-- Crocodial for Wabastore Sales: one connection, synced now; rd_tc = Crocodial user 7001, rd_tc2 = 7002. rd_ba is not connected.
insert into crocodial_rollout (department_id, division, allowed) values (test.dept('wabastore'), 'SALES', true)
  on conflict (department_id, division) do update set allowed = true;
insert into crocodial_connections (id, name, credential_ref, enabled, timezone)
  values ('5a1e0000-0000-4000-8000-00000000cc01', 'RD', 'CROCODIAL_TOKEN_RDTEST', true, 'Asia/Kolkata');
insert into crocodial_department_links (connection_id, department_id, division, enabled) values ('5a1e0000-0000-4000-8000-00000000cc01', test.dept('wabastore'), 'SALES', true);
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from) values
  ('5a1e0000-0000-4000-8000-00000000cc01', 7001, 'rd one', test.id('rd_tc'), test.dept('wabastore'), 'SALES', 'APPROVED', now() - interval '60 days', now() - interval '60 days'),
  ('5a1e0000-0000-4000-8000-00000000cc01', 7002, 'rd two', test.id('rd_tc2'), test.dept('wabastore'), 'SALES', 'APPROVED', now() - interval '60 days', now() - interval '60 days');
insert into crocodial_sync_state (connection_id, resource, checkpoint, last_full_at, last_ok_at)
select '5a1e0000-0000-4000-8000-00000000cc01', r, now(), now(), now() from unnest(array['leads', 'call-logs', 'followups', 'remarks']) r;
-- rd_tc today: 5 outgoing (2 connected 60 + 40 s, 2 not connected, 1 with "connected" empty), to 3 numbers (+919811000001 and 09811000001
-- are one number), 1 incoming; a call by an unmapped Crocodial user and one from before the mapping never count.
-- rd_tc2 today: 1 outgoing, connected, to the same number and lead as rd_tc.
-- The calls of "today" must fall on today's India date whenever the suite runs: just after midnight IST, "50 minutes ago" is yesterday
-- and today's row of the daily figures came up short. test.rd_ago keeps each call's offset when there is room since midnight and
-- squeezes the offsets proportionally (same order) when there is not.
create or replace function test.rd_ago(p interval) returns timestamptz language sql stable as $$
  select now() - p * least(1.0, extract(epoch from now() - (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')) / extract(epoch from interval '61 minutes'))::double precision $$;
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, lead_ext, call_type, call_at, duration_seconds, connected, phone_number, contact_name) values
  ('5a1e0000-0000-4000-8000-00000000cc01', 1, 7001, 801, 'outgoing', test.rd_ago(interval '10 minutes'), 60, true, '+919811000001', 'Ravi'),
  ('5a1e0000-0000-4000-8000-00000000cc01', 2, 7001, 801, 'outgoing', test.rd_ago(interval '20 minutes'), 40, true, '09811000001', 'Ravi'),
  ('5a1e0000-0000-4000-8000-00000000cc01', 3, 7001, 802, 'outgoing', test.rd_ago(interval '30 minutes'), 0, false, '9811000002', null),
  ('5a1e0000-0000-4000-8000-00000000cc01', 4, 7001, null, 'outgoing', test.rd_ago(interval '40 minutes'), 0, false, '9811000003', null),
  ('5a1e0000-0000-4000-8000-00000000cc01', 5, 7001, null, 'outgoing', test.rd_ago(interval '50 minutes'), null, null, '9811000003', null),
  ('5a1e0000-0000-4000-8000-00000000cc01', 6, 7001, 801, 'incoming', test.rd_ago(interval '60 minutes'), 30, true, '9811000001', 'Ravi'),
  ('5a1e0000-0000-4000-8000-00000000cc01', 7, 7999, 801, 'outgoing', test.rd_ago(interval '5 minutes'), 500, true, '9811000001', null),
  ('5a1e0000-0000-4000-8000-00000000cc01', 8, 7001, 801, 'outgoing', now() - interval '90 days', 99, true, '9811000001', null),
  ('5a1e0000-0000-4000-8000-00000000cc01', 9, 7002, 801, 'outgoing', test.rd_ago(interval '15 minutes'), 20, true, '9811000001', 'Ravi');
insert into crocodial_ext_leads (connection_id, external_id, name, status, assigned_to_ext) values
  ('5a1e0000-0000-4000-8000-00000000cc01', 801, 'Ravi Kumar', 'Interested', 7001);

-- CRM: two leads rd_tc owns; one converted to rd_ba
insert into customers (owner_id, created_by, name, phone, lifecycle_stage, lead_status, call_status, lead_source)
  values (test.id('rd_tc'), test.id('rd_tc'), 'RD Lead Converted', '+919812100001', 'LEAD', 'INTERESTED', 'INTERESTED', 'Cold Call'),
         (test.id('rd_tc'), test.id('rd_tc'), 'RD Lead Open', '+919812100002', 'LEAD', 'CONTACTED', 'NOT_INTERESTED', 'Cold Call');
insert into ba_contacts (id, lead_id, department_id, assigned_to, telecaller_id, stage)
  select '5a1e0000-0000-4000-8000-0000000000c1', id, test.dept('wabastore'), test.id('rd_ba'), test.id('rd_tc'), 'DEMO_SCHEDULED' from customers where name = 'RD Lead Converted';
-- rd_ba: demos (one completed, one scheduled, one cancelled), one quotation with two final revisions (counted once), the deal closed
insert into ba_demos (contact_id, title, starts_at, ends_at, mode, assigned_to, status) values
  ('5a1e0000-0000-4000-8000-0000000000c1', 'RD demo one', now() - interval '2 hours', now() - interval '1 hour', 'ONLINE', test.id('rd_ba'), 'COMPLETED'),
  ('5a1e0000-0000-4000-8000-0000000000c1', 'RD demo two', now() - interval '50 minutes', now() - interval '20 minutes', 'ONLINE', test.id('rd_ba'), 'SCHEDULED'),
  ('5a1e0000-0000-4000-8000-0000000000c1', 'RD demo three', now() - interval '3 hours', now() - interval '170 minutes', 'ONLINE', test.id('rd_ba'), 'CANCELLED');
insert into ba_quotations (quotation_no, revision, contact_id, status, total, finalized_at)
  values ('RD-Q-1', 1, '5a1e0000-0000-4000-8000-0000000000c1', 'FINAL', 10000, now() - interval '1 hour'),
         ('RD-Q-1', 2, '5a1e0000-0000-4000-8000-0000000000c1', 'FINAL', 12000, now());
update customers set lifecycle_stage = 'ONBOARDING', deal_amount = 12000, amount_received = 5000, stage_changed_at = now() where name = 'RD Lead Converted';

create or replace function test.rd_item(p_list jsonb, p_name text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(p_list -> 'items') x where x ->> 'name' = p_name $$;
grant execute on function test.rd_item(jsonb, text) to authenticated;
create temp table rd (k text primary key, v jsonb);
grant all on rd to authenticated;

\echo '   the call figures from the Crocodial call log (one formula everywhere)'
set role authenticated;
select test.login('rd_tc');
insert into rd select 'own', croc_activity(null, (now() at time zone 'Asia/Kolkata')::date - 6, (now() at time zone 'Asia/Kolkata')::date);
select test.check((select (v -> 'calls' ->> 'made')::int = 5 and (v -> 'calls' ->> 'connected')::int = 2 and (v -> 'calls' ->> 'notConnected')::int = 2
                     from rd where k = 'own'),
  'total 5 outgoing, connected 2, not connected 2: an outgoing call whose "connected" Crocodial left empty is in neither');
select test.check((select (v -> 'calls' ->> 'uniqueNumbers')::int = 3 and (v -> 'calls' ->> 'talkSeconds')::int = 100 and (v -> 'calls' ->> 'incoming')::int = 1
                     and (v -> 'calls' ->> 'connectRate')::numeric = 40 from rd where k = 'own'),
  'unique numbers 3 (+91 98.. and 098.. are one number), talk time of the connected calls 100 s, the incoming call counted apart');
select test.check((select count(*) = 6 and bool_and(c ->> 'phone' like 'XXXXXX%') from rd, jsonb_array_elements(v -> 'recentCalls') c where k = 'own'),
  'the recent calls are the person''s 6 calls of the period, numbers masked; another Crocodial user''s and pre-mapping calls are not there');
select test.check((select (v -> 'demos' ->> 'scheduled')::int = 0 from rd where k = 'own'), 'demos come from the CRM schedule (none for this Telecaller)');
select test.must_fail($$select private.croc_call_summary(test.id('rd_tc'), now() - interval '1 day', now())$$, 'the call helpers cannot be called by a signed-in user', 'permission denied');
select test.must_fail($$select private.croc_person_calls(test.id('rd_tc2'), now() - interval '1 day', now())$$, '... nor the call list', 'permission denied');

\echo '   the management view counts a number once across people'
select test.login('sh_head');
-- the calls above were made 5 to 60 minutes ago: from midnight to 01:00 India time some of them are on yesterday's date, so the period starts 2 hours back
insert into rd select 'team', croc_team_activity((now() at time zone 'Asia/Kolkata' - interval '2 hours')::date, (now() at time zone 'Asia/Kolkata')::date, test.dept('wabastore'));
select test.check((select (v -> 'totals' ->> 'made')::int = 6 and (v -> 'totals' ->> 'connected')::int = 3 and (v -> 'totals' ->> 'notConnected')::int = 2 from rd where k = 'team'),
  'totals: 6 calls, 3 connected, 2 not connected (the sum of the people)');
select test.check((select (v -> 'totals' ->> 'uniqueNumbers')::int = 3 and (v -> 'totals' ->> 'uniqueLeads')::int = 2 from rd where k = 'team'),
  'unique numbers 3 and unique leads 2 across both people: the number and the lead both called count once, not twice');
select test.check((select sum((p -> 'calls' ->> 'uniqueNumbers')::int) = 4 from rd, jsonb_array_elements(v -> 'people') p where k = 'team'),
  '(per person they are 3 and 1: adding them up would have said 4)');

\echo '   who may use the head''s sections'
select test.login('dh_wab');
select test.must_fail($$select sales_role_list('TELECALLER')$$, 'the Support head cannot open the role lists', 'Sales Department Head');
select test.must_fail($$select sales_role_person('TELECALLER', test.id('rd_tc'))$$, 'nor a person''s dashboard', 'Sales Department Head');
select test.login('th_wab');
select test.must_fail($$select sales_role_list('BUSINESS_ASSOCIATE')$$, 'a Team Lead cannot', 'Sales Department Head');
select test.login('rd_tc');
select test.must_fail($$select sales_role_person('TELECALLER', test.id('rd_tc'))$$, 'a Telecaller cannot open the head''s view, not even of themself', 'Sales Department Head');
select test.login('sa');
select test.must_fail($$select sales_role_list('TELECALLER')$$, 'the pages are the Sales head''s own', 'Sales Department Head');
select test.must_fail($$select private.sales_role_people('TELECALLER')$$, 'the helpers cannot be called by a signed-in user', 'permission denied');

\echo '   the lists: only the head''s own Sales people of that role'
select test.login('sh_head');
select test.check((select count(*) filter (where x ->> 'name' = 'Role Dash Telecaller') = 1 and count(*) filter (where x ->> 'name' = 'Role Dash Associate') = 0
                     from jsonb_array_elements(sales_role_list('TELECALLER', p_page_size => 500) -> 'items') x),
  'the Telecaller list has the Telecaller and no Business Associate');
select test.check((select count(*) filter (where (x ->> 'id')::uuid = test.id('rd_ba')) = 1 and count(*) filter (where (x ->> 'id')::uuid = test.id('ba_x')) = 0
                     and count(*) filter (where (x ->> 'id')::uuid = test.id('tm_a')) = 0
                     from jsonb_array_elements(sales_role_list('BUSINESS_ASSOCIATE', p_page_size => 500) -> 'items') x),
  'the Business Associate list has their own Business Associates, not another department''s, nor members without the role');
select test.check((select x ->> 'employeeCode' = 'EMP-' || upper(left(test.id('rd_tc')::text, 8)) and x ->> 'teamLeadName' is not null and x ->> 'status' = 'ACTIVE'
                     from jsonb_array_elements(sales_role_list('TELECALLER', p_search => 'role dash telecaller') -> 'items') x),
  'a row has the Employee ID the HR directory shows, the Team Lead and the account status');

\echo '   Telecaller: Crocodial calls (the same figures as their own view) and CRM leads'
insert into rd select 'tc', test.rd_item(sales_role_list('TELECALLER', p_search => 'role dash'), 'Role Dash Telecaller') -> 'metrics';
select test.check((select v ->> 'crocodial' = 'ON' and (v ->> 'calls')::int = 5 and (v ->> 'connected')::int = 2 and (v ->> 'notConnected')::int = 2
                          and (v ->> 'uniqueNumbers')::int = 3 and (v ->> 'talkSeconds')::int = 100 from rd where k = 'tc'),
  'the head sees exactly the call figures the Telecaller sees in their own Crocodial view');
select test.check((select (v ->> 'leadsCreated')::int = 2 and (v ->> 'convertedLeads')::int = 1 and not (v ? 'totalCalls') and not (v ? 'contactsCalled')
                          and not (v ? 'pendingFollowUps') and not (v ? 'interestedLeads') from rd where k = 'tc'),
  'CRM: leads created 2, converted 1; no call counters made up from CRM fields');
select test.check((select x -> 'metrics' ->> 'crocodial' = 'OFF' and x -> 'metrics' -> 'calls' = 'null'::jsonb and x -> 'metrics' -> 'connected' = 'null'::jsonb
                     from jsonb_array_elements(sales_role_list('TELECALLER', p_page_size => 500) -> 'items') x where (x ->> 'id')::uuid = test.id('sh_tc')),
  'a Telecaller not connected to Crocodial has no call figures (null), not zeros');
insert into rd select 'tcp', sales_role_person('TELECALLER', test.id('rd_tc'));
select test.check((select jsonb_array_length(v -> 'records' -> 'calls') = 6 and v -> 'crocodial' ->> 'state' = 'ON' and jsonb_array_length(v -> 'records' -> 'leads') = 2
                          and jsonb_array_length(v -> 'daily') = 30 and not (v -> 'records' ? 'pendingFollowUps') from rd where k = 'tcp'),
  'the dashboard: the Crocodial call log (6 calls of the period), the CRM leads, 30 days');
select test.check((select bool_and(c ? 'callAt' and c ? 'type' and c ? 'connected' and c ? 'durationSeconds' and c ? 'contactName' and c ? 'phone')
                          and bool_and(c ->> 'phone' like 'XXXXXX%') from rd, jsonb_array_elements(v -> 'records' -> 'calls') c where k = 'tcp'),
  'each call: date and time, type, connected, duration, contact, masked number (the Crocodial fields)');
select test.check((select (d ->> 'calls')::int = 5 and (d ->> 'connected')::int = 2 and (d ->> 'leads')::int = 2 and (d ->> 'converted')::int = 1
                     from rd, jsonb_array_elements(v -> 'daily') d where k = 'tcp' and (d ->> 'day')::date = (now() at time zone 'Asia/Kolkata')::date),
  'today''s row of the daily figures');
select test.check((select (sales_role_person('TELECALLER', test.id('sh_tc')) -> 'daily' -> 0 -> 'calls') = 'null'::jsonb), 'not connected: the daily call figures are empty, not zero');
select test.check((select (sales_role_list('TELECALLER', current_date - 60, current_date - 31, 'role dash telecaller') -> 'items' -> 0 -> 'metrics' ->> 'calls')::int = 0),
  'an earlier period has none of today''s calls');

\echo '   Business Associate: CRM leads, demos (as their own view counts them), quotations, deals'
insert into rd select 'ba', test.rd_item(sales_role_list('BUSINESS_ASSOCIATE', p_search => 'role dash'), 'Role Dash Associate') -> 'metrics';
select test.check((select (v ->> 'leadsAssigned')::int = 1 and (v ->> 'demosScheduled')::int = 2 and (v ->> 'demosCompleted')::int = 1 and (v ->> 'demosCancelled')::int = 1
                          and (v ->> 'quotations')::int = 1 and (v ->> 'dealsClosed')::int = 1 and (v ->> 'dealValue')::numeric = 12000 from rd where k = 'ba'),
  'leads 1, demos scheduled 2 (the cancelled one apart), completed 1, one quotation (not one per revision), the deal closed');
select test.check((select v ->> 'crocodial' = 'OFF' and v -> 'calls' = 'null'::jsonb and not (v ? 'connectedClients') and not (v ? 'revenueReceived') from rd where k = 'ba'),
  'not connected to Crocodial: no call figures; no invented figures');
reset role;
select test.check((select (private.croc_demo_summary(test.id('rd_ba'), now() - interval '1 day', now() + interval '1 day') ->> 'scheduled')::int = 2),
  'the same demo formula as the Business Associate''s own view (private.croc_demo_summary)');
set role authenticated;
select test.login('sh_head');
insert into rd select 'bap', sales_role_person('BUSINESS_ASSOCIATE', test.id('rd_ba'));
select test.check((select jsonb_array_length(v -> 'records' -> 'contacts') = 1 and jsonb_array_length(v -> 'records' -> 'demos') = 3
                          and jsonb_array_length(v -> 'records' -> 'quotations') = 1 and (v -> 'records' -> 'quotations' -> 0 ->> 'revision')::int = 2
                          and jsonb_array_length(v -> 'records' -> 'deals') = 1 and jsonb_array_length(v -> 'records' -> 'calls') = 0
                          and (v -> 'records' -> 'contacts' -> 0 ->> 'telecaller') = 'Role Dash Telecaller' from rd where k = 'bap'),
  'the dashboard: contacts (with the Telecaller), demos, the quotation at its latest revision, the deal; no calls when not connected');

\echo '   filters, sort, pages'
select test.check((sales_role_list('TELECALLER', p_search => 'nobody at all') ->> 'total')::int = 0, 'search by name, Employee ID, e-mail or phone');
select test.check((sales_role_list('TELECALLER', p_search => upper(left(test.id('rd_tc')::text, 8))) ->> 'total')::int = 1, '... by Employee ID');
select test.check((sales_role_list('TELECALLER', p_team_lead => gen_random_uuid()) ->> 'total')::int = 0, 'filter by Team Lead');
select test.check((sales_role_list('TELECALLER', p_status => 'SUSPENDED', p_search => 'role dash') ->> 'total')::int = 0, 'filter by account status');
select test.check((select x ->> 'name' = 'Role Dash Telecaller' from (select sales_role_list('TELECALLER', p_sort => 'calls') -> 'items' -> 0 as x) s),
  'sort by calls: the busiest first, people without Crocodial last');
select test.check((select jsonb_array_length(l -> 'items') = 1 and (l ->> 'total')::int >= 2 from (select sales_role_list('TELECALLER', p_page_size => 1) as l) s),
  'one page at a time, with the total');
select test.check(jsonb_array_length(sales_role_list('TELECALLER') -> 'teamLeads') >= 1, 'the Team Lead choices for the filter');
select test.must_fail($$select sales_role_list('INFLUENCER')$$, 'an unknown role', 'VALIDATION_ERROR');
select test.must_fail($$select sales_role_list('TELECALLER', current_date, current_date - 1)$$, 'a start after the end', 'start date is after');
select test.must_fail($$select sales_role_list('TELECALLER', current_date - 100, current_date)$$, 'more than 93 days (as Crocodial)', 'at most 93 days');
select test.must_fail($$select sales_role_list('TELECALLER', p_status => 'GONE')$$, 'an unknown status', 'VALIDATION_ERROR');

\echo '   someone else''s people'
select test.must_fail($$select sales_role_person('BUSINESS_ASSOCIATE', test.id('ba_x'))$$, 'a Business Associate of another department is not found', 'NOT_FOUND');
select test.must_fail($$select sales_role_person('TELECALLER', test.id('rd_ba'))$$, 'a person under the wrong role is not found', 'NOT_FOUND');
select test.must_fail($$select sales_role_person('TELECALLER', test.id('sup_plain'))$$, 'a Support member is not found', 'NOT_FOUND');
reset role;
select test.check((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('sales_role_list', 'sales_role_person') and has_function_privilege('anon', p.oid, 'execute')),
  'nobody signed out can call them');
select test.check((select count(*) = 9 from crocodial_ext_calls where connection_id = '5a1e0000-0000-4000-8000-00000000cc01'), 'nothing was written to the stored Crocodial records');
-- leave the shared database as it was for the suites after this one
delete from crocodial_connections where id = '5a1e0000-0000-4000-8000-00000000cc01';
update crocodial_rollout set allowed = false where department_id = test.dept('wabastore') and division = 'SALES';
select set_config('request.jwt.claims', '', false);
