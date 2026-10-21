-- =============================================================================
-- Dashboards and security events (migrations 20261110000100 / 20261110000200). Runs after the other suites on the same database and
-- re-uses their users (sa, dh_wab, th_wab, tm_a, tm_b, dh_wbx, th_wbx, tm_c, dh_acc, acc_m, sup_plain, sup_b, pending_d, ...).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 49. Company dashboard: the Super Admin only, and the figures are the real records'

reset role;
set role authenticated;
select test.login('sa');
create temp table cov as select dashboard_company_overview() as j;
grant all on cov to authenticated;

select test.admin_check($q$select (j -> 'customers' ->> 'total')::bigint = (select count(*) from customers)
                                  and (j -> 'customers' ->> 'leads')::bigint = (select count(*) from customers where lifecycle_stage = 'LEAD')
                                  and (j -> 'customers' ->> 'onboarding')::bigint = (select count(*) from customers where lifecycle_stage = 'ONBOARDING')
                                  and (j -> 'customers' ->> 'customers')::bigint = (select count(*) from customers where lifecycle_stage = 'CUSTOMER')
                                  and (j -> 'customers' ->> 'lost')::bigint = (select count(*) from customers where lifecycle_stage = 'LOST') from cov$q$,
  'customers by stage equal the records (each customer counted once)');
select test.admin_check($q$select (select coalesce(sum((d ->> 'records')::bigint), 0) from cov, jsonb_array_elements(j -> 'departments') d)
                                  = (select count(*) from customers where department_id is not null) from (select 1) x$q$,
  'the department rows add up to the customers: no customer is counted twice by a join');
select test.admin_check($q$select (j -> 'money' ->> 'incomeTotal')::numeric = (select coalesce(sum(amount), 0) from private.verified_income()) from cov$q$,
  'income is verified payments only');
select test.admin_check($q$select (j -> 'money' ->> 'unverifiedPaymentsAmount')::numeric = (select coalesce(sum(amount), 0) from customer_payments where status = 'PENDING')
                                  and (j -> 'money' ->> 'unverifiedPayments')::bigint = (select count(*) from customer_payments where status = 'PENDING') from cov$q$,
  'payments waiting for verification are shown apart and are not income');
select test.admin_check($q$select (j -> 'money' ->> 'pendingConfirmations')::bigint = (select count(*) from payment_requests where status = 'PENDING') from cov$q$,
  'pending payment confirmations are the requests Accounts has not answered');
select test.admin_check($q$select (j -> 'money' ->> 'outstandingBalance')::numeric
                                  = (select coalesce(sum(greatest(deal_amount - amount_verified, 0)), 0) from customers
                                      where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(deal_amount, 0) > 0) from cov$q$,
  'the outstanding balance is the total payable less verified payments, never below zero');
select test.admin_check($q$select (j -> 'invoices' ->> 'count')::bigint = (select count(*) from member_invoices)
                                  and (j -> 'invoices' ->> 'paidAmount')::numeric = (select coalesce(sum(amount) filter (where status = 'Paid'), 0) from member_invoices)
                                  and (j -> 'invoices' ->> 'pending')::bigint = (select count(*) from member_invoices where status = 'Pending') from cov$q$,
  'invoice totals come from the invoice list, each invoice once');
select test.admin_check($q$select (j -> 'tickets' ->> 'open')::bigint = (select count(*) from support_tickets where status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED')) from cov$q$,
  'open tickets are the tickets not resolved or closed');
select test.admin_check($q$select (j -> 'onboarding' ->> 'inProgress')::bigint = (select count(*) from customers c join customer_onboarding o on o.customer_id = c.id where c.lifecycle_stage = 'ONBOARDING') from cov$q$,
  'onboarding in progress is the customers in onboarding (one row each)');
select test.check((select jsonb_array_length(j -> 'trend') = 12 from cov), 'the trend has twelve months, from the same query Accounts uses');
select test.check((select bool_and((m ->> 'net')::numeric = (m ->> 'income')::numeric - (m ->> 'expenses')::numeric) from cov, jsonb_array_elements(j -> 'trend') m), 'every month is income - expenses');
select test.check((select jsonb_typeof(j -> 'alerts') = 'array' and jsonb_typeof(j -> 'recentActivity') = 'array' and jsonb_array_length(j -> 'recentActivity') <= 12 from cov), 'alerts and recent activity are lists');
select test.check((select not exists (select 1 from cov, jsonb_array_elements(j -> 'alerts') a where (a ->> 'count')::int <= 0) from (select 1) x), 'an alert is listed only when something needs attention');

select test.login('dh_wab');
select test.must_fail($$select dashboard_company_overview()$$, 'a Department Head cannot read the company dashboard', 'Super Admin');
select test.login('th_wab');
select test.must_fail($$select dashboard_company_overview()$$, 'nor a Team Lead', 'Super Admin');
select test.login('tm_a');
select test.must_fail($$select dashboard_company_overview()$$, 'nor a Team Member', 'Super Admin');
select test.login('acc_m');
select test.must_fail($$select dashboard_company_overview()$$, 'nor Accounts staff', 'Super Admin');
reset role;
set role anon;
select test.must_fail($$select dashboard_company_overview()$$, 'nor a signed-out visitor', 'permission denied');
reset role;

\echo '--- 50. Scoped dashboards: a Team Lead sees the team, a Department Head the department, a member nothing here'
set role authenticated;
select test.login('th_wab');
create temp table sov_th as select dashboard_scope_overview() as j;
select test.login('dh_wab');
create temp table sov_dh as select dashboard_scope_overview() as j;
select test.login('sa');
create temp table sov_sa_w as select dashboard_scope_overview(test.dept('wabastore')) as j;
create temp table sov_sa_all as select dashboard_scope_overview() as j;
grant all on sov_th, sov_dh, sov_sa_w, sov_sa_all to authenticated;

select test.admin_check($q$select (j -> 'customers' ->> 'total')::bigint = (select count(*) from customers where team_id = test.team('wabastore', 'Sales')) from sov_th$q$,
  'a Team Lead counts only the customers of their team');
select test.admin_check($q$select (j -> 'customers' ->> 'total')::bigint = (select count(*) from customers where department_id = test.dept('wabastore')) from sov_dh$q$,
  'a Department Head counts the customers of their department');
select test.admin_check($q$select (select j -> 'customers' from sov_sa_w) = (select j -> 'customers' from sov_dh) from (select 1) x$q$,
  'the Super Admin asking for a department sees the same customers as its head');
select test.admin_check($q$select (j -> 'customers' ->> 'total')::bigint = (select count(*) from customers) from sov_sa_all$q$, 'the Super Admin without a department sees all');
select test.admin_check($q$select bool_and((m ->> 'teamId')::uuid = test.team('wabastore', 'Sales')) from sov_th, jsonb_array_elements(j -> 'members') m$q$,
  'a Team Lead''s member list is the team only');
select test.admin_check($q$select not exists (select 1 from sov_dh, jsonb_array_elements(j -> 'members') m
                                                 where (select department_id from profiles where id = (m ->> 'id')::uuid) is distinct from test.dept('wabastore')) from (select 1) x$q$,
  'a Department Head''s member list holds only their department''s people');
select test.admin_check($q$select (select count(*) from sov_dh, jsonb_array_elements(j -> 'members') m) = (select count(distinct m ->> 'id') from sov_dh, jsonb_array_elements(j -> 'members') m) from (select 1) x$q$,
  'each person appears once');
select test.admin_check($q$select (select coalesce(sum((m ->> 'records')::bigint), 0) from sov_th, jsonb_array_elements(j -> 'members') m)
                                  = (select count(*) from customers where team_id = test.team('wabastore', 'Sales') and lifecycle_stage <> 'LOST'
                                        and owner_id in (select id from profiles where status = 'ACTIVE' and team_id = test.team('wabastore', 'Sales'))) from (select 1) x$q$,
  'the members'' customers add up to the team''s customers (nothing counted twice)');
select test.admin_check($q$select not exists (select 1 from sov_dh, jsonb_array_elements(j -> 'teams') t where (select department_id from teams where id = (t ->> 'id')::uuid) <> test.dept('wabastore')) from (select 1) x$q$,
  'a Department Head sees only the teams of their department');
select test.admin_check($q$select (j -> 'tickets' ->> 'open')::bigint >= 0 and jsonb_typeof(j -> 'tasks') = 'object' from sov_th$q$, 'tickets and tasks are part of the scope');

select test.login('dh_wbx');
create temp table sov_other as select dashboard_scope_overview() as j;
grant all on sov_other to authenticated;
select test.admin_check($q$select (j -> 'customers' ->> 'total')::bigint = (select count(*) from customers where department_id = test.dept('whatsbox'))
                                  and not exists (select 1 from sov_other, jsonb_array_elements(j -> 'members') m where (m ->> 'id')::uuid in (test.id('th_wab'), test.id('tm_a'))) from sov_other$q$,
  'another department''s head sees their own scope and none of Wabastore''s people');
select test.login('tm_a');
select test.must_fail($$select dashboard_scope_overview()$$, 'a Team Member has no scoped overview', 'Team Leads');
select test.login('th_wab');
select test.check((select (dashboard_scope_overview(test.dept('whatsbox')) -> 'scope' ->> 'departmentId')::uuid = test.dept('wabastore')), 'a Team Lead naming another department still gets their own');
reset role;
set role anon;
select test.must_fail($$select dashboard_scope_overview()$$, 'a signed-out visitor gets nothing', 'permission denied');
reset role;

\echo '--- 51. Security events: every audit row is scrubbed, stamped and cannot be changed'
-- a writer that inserts directly is scrubbed and stamped like every other
select set_config('request.headers', '{"x-request-id":"req-abc-123"}', false);
insert into audit_logs (actor_id, action, entity_type, metadata)
values (test.id('sa'), 'TEST_STAMPED', 'test', '{"password":"hunter2","nested":{"api_key":"k","token":"t","ok":1},"note":"fine"}');
select test.check((select metadata = '{"nested":{"ok":1},"note":"fine"}'::jsonb from audit_logs where action = 'TEST_STAMPED'), 'secrets are removed from a directly inserted event');
select test.check((select request_id = 'req-abc-123' and actor_role = 'SUPER_ADMIN' and actor_label like 'Root%' and outcome = 'SUCCESS' from audit_logs where action = 'TEST_STAMPED'),
  'the request id, the actor''s role and name are stamped');
select set_config('request.headers', '{"x-request-id":"bad id with spaces!"}', false);
insert into audit_logs (actor_id, action, entity_type) values (test.id('sa'), 'TEST_BADID', 'test');
select test.check((select request_id is null from audit_logs where action = 'TEST_BADID'), 'a request id that is not a plain label is not stored');
select set_config('request.headers', '', false);
insert into audit_logs (actor_id, action, entity_type) values (null, 'LOGIN_FAILED', 'user'), (null, 'LOGIN_LOCKED', 'user'), (null, 'WEBHOOK_REJECTED', 'webhook');
select test.check((select outcome = 'FAILURE' from audit_logs where action = 'LOGIN_FAILED' order by id desc limit 1)
                  and (select outcome = 'DENIED' from audit_logs where action = 'LOGIN_LOCKED' order by id desc limit 1)
                  and (select outcome = 'DENIED' from audit_logs where action = 'WEBHOOK_REJECTED' order by id desc limit 1), 'failed and refused sign-ins and webhooks are marked as such');

-- append-only, for everybody (even the table's owner)
select test.must_fail($$update audit_logs set action = 'CHANGED' where action = 'TEST_STAMPED'$$, 'an audit row cannot be edited', 'cannot be changed');
select test.must_fail($$update audit_logs set metadata = '{}' where action = 'TEST_STAMPED'$$, 'nor its details removed', 'cannot be changed');
select test.must_fail($$delete from audit_logs where action = 'TEST_STAMPED'$$, 'nor deleted', 'cannot be deleted');
select test.must_fail($$truncate audit_logs$$, 'nor the table emptied', 'cannot be deleted');
set role authenticated;
select test.login('sa');
select test.must_fail($$delete from audit_logs$$, 'the Super Admin''s API role cannot delete audit rows either', 'permission denied');
select test.must_fail($$update audit_logs set action = 'X'$$, 'nor edit them', 'permission denied');
reset role;

-- removing a person keeps who did what
select test.create_auth_user('aud_tmp', 'aud.tmp@amuwa.com', '{"full_name":"Audit Temp"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
insert into audit_logs (actor_id, action, entity_type) values (test.id('aud_tmp'), 'TEST_BY_TEMP', 'test');
select test.check((select actor_label like 'Audit Temp%' and actor_role = 'TEAM_MEMBER' from audit_logs where action = 'TEST_BY_TEMP'), 'the name and role are kept on the row');
delete from auth.users where id = test.id('aud_tmp');
select test.check((select actor_id is null and actor_label like 'Audit Temp%' from audit_logs where action = 'TEST_BY_TEMP'),
  'deleting the person clears the reference only: the row still says who it was');
-- a deliberate clean-up says so
select set_config('amuwa.audit_purge', 'on', false);
delete from audit_logs where action in ('TEST_STAMPED', 'TEST_BADID', 'TEST_BY_TEMP');
select set_config('amuwa.audit_purge', '', false);
select test.check((select count(*) = 0 from audit_logs where action in ('TEST_STAMPED', 'TEST_BADID', 'TEST_BY_TEMP')), 'a deliberate, declared clean-up is still possible');
select test.must_fail($$delete from audit_logs where action = 'LOGIN_FAILED'$$, 'and only then', 'cannot be deleted');

\echo '--- 52. Events recorded by the API server'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select record_server_event('ACCESS_DENIED', 'request', null, null, 'DENIED', 'r', '1.2.3.4', 'k1', '{}')$$, 'a signed-in user cannot write server events', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select record_server_event('ACCESS_DENIED', 'request', null, null, 'DENIED', 'r', '1.2.3.4', 'k1', '{}')$$, 'nor a signed-out visitor', 'permission denied');
reset role;
set role service_role;
create temp table sev (n int primary key, r boolean);
grant all on sev to service_role;
insert into sev select 1, record_server_event('ACCESS_DENIED', 'request', null, test.id('tm_a'), 'DENIED', 'req-srv-1', '203.0.113.9', 'test:denied:1',
  '{"method":"GET","route":"/audit-logs","status":403,"code":"FORBIDDEN","token":"abc","authorization":"Bearer x"}');
insert into sev select 2, record_server_event('ACCESS_DENIED', 'request', null, test.id('tm_a'), 'DENIED', 'req-srv-2', '203.0.113.9', 'test:denied:1', '{"method":"GET"}');
insert into sev select 3, record_server_event('SESSION_STARTED', 'session', null, test.id('th_wab'), 'SUCCESS', 'req-srv-3', '203.0.113.10', 'test:session:1', '{"method":"password"}');
reset role;
select test.check((select r from sev where n = 1) and not (select r from sev where n = 2) and (select r from sev where n = 3), 'a repeated event (same key) is recorded once');
select test.check((select count(*) = 1 from audit_logs where dedupe_key = 'test:denied:1'), 'and stored once');
select test.check((select outcome = 'DENIED' and request_id = 'req-srv-1' and ip = '203.0.113.9' and actor_id = test.id('tm_a') and actor_role = 'TEAM_MEMBER'
                          and department_id = test.dept('wabastore') and team_id = test.team('wabastore', 'Sales')
                          and metadata = '{"method":"GET","route":"/audit-logs","status":403,"code":"FORBIDDEN"}'::jsonb
                     from audit_logs where dedupe_key = 'test:denied:1'), 'the event names who, where from, what was refused, in which department, with secrets removed');
set role service_role;
select test.must_fail($$select record_server_event('not an action', 'request', null, null, 'DENIED', null, null, 'k', '{}')$$, 'an invalid event name is refused', 'Unknown event');
select test.must_fail($$select record_server_event('ACCESS_DENIED', 'request', null, null, 'MAYBE', null, null, 'k', '{}')$$, 'and an unknown outcome', 'Unknown outcome');
select test.check((select record_server_event('ACCESS_DENIED', 'request', null, null, 'DENIED', null, null, 'test:big:1', jsonb_build_object('x', repeat('a', 5000)))), 'an oversize event is stored (cut down)');
reset role;
select test.check((select metadata = '{"truncated": true}'::jsonb from audit_logs where dedupe_key = 'test:big:1'), 'its details are replaced by a marker, not stored in full');

\echo '--- 53. Exports are recorded'
set role authenticated;
select test.login('tm_a');
select record_data_export('customers', 42, 'leads csv');
select record_data_export('customers', -5, null);
select test.must_fail($$select record_data_export('Customers!', 1, null)$$, 'an unknown dataset name is refused', 'Unknown dataset');
reset role;
select test.check((select count(*) = 2 and bool_and(actor_id = test.id('tm_a') and entity_type = 'export' and department_id = test.dept('wabastore')) from audit_logs where action = 'DATA_EXPORTED' and actor_id = test.id('tm_a')),
  'who exported, from which department');
select test.check((select metadata ->> 'rows' = '42' and metadata ->> 'dataset' = 'customers' from audit_logs where action = 'DATA_EXPORTED' and metadata ->> 'note' = 'leads csv'), 'what and how many rows');
select test.check((select count(*) = 1 from audit_logs where action = 'DATA_EXPORTED' and metadata ->> 'rows' = '0'), 'a negative row count is recorded as zero');
select test.create_auth_user('aud_pending', 'aud.pending@amuwa.com',
  jsonb_build_object('full_name', 'Audit Pending', 'department_id', test.dept('wabastore'), 'team_id', test.team('wabastore', 'Sales')), '{}');
select test.check((select status = 'PENDING' from profiles where id = test.id('aud_pending')), 'a self-registered person waits for approval');
set role authenticated;
select test.login('aud_pending');
select test.must_fail($$select record_data_export('customers', 1, null)$$, 'a person whose account is not active cannot record exports', 'Sign in');
reset role;
set role anon;
select test.must_fail($$select record_data_export('customers', 1, null)$$, 'nor a signed-out visitor', 'permission denied');
reset role;

\echo '--- 54. Chat group membership is audited'
set role authenticated;
select test.login('sup_plain');
create temp table cg as select chat_create_group('Audit huddle', array[test.id('sup_b')]) as j;
grant all on cg to authenticated;
select chat_group_add_members((select (j ->> 'id')::uuid from cg), array[test.id('sup_th')]);
select chat_group_set_admin((select (j ->> 'id')::uuid from cg), test.id('sup_b'), true);
select chat_group_remove_member((select (j ->> 'id')::uuid from cg), test.id('sup_th'));
select test.login('sup_b');
select chat_group_leave((select (j ->> 'id')::uuid from cg));
reset role;
select test.check((select count(*) filter (where action = 'CHAT_MEMBER_ADDED') >= 3
                          and count(*) filter (where action = 'CHAT_MEMBER_ROLE_CHANGED') = 1
                          and count(*) filter (where action = 'CHAT_MEMBER_REMOVED') = 1
                          and count(*) filter (where action = 'CHAT_MEMBER_LEFT') = 1
                     from audit_logs where entity_id = (select (j ->> 'id')::uuid from cg)), 'adding, promoting, removing and leaving a group are each recorded');
select test.check((select actor_id = test.id('sup_plain') from audit_logs where action = 'CHAT_MEMBER_REMOVED' and entity_id = (select (j ->> 'id')::uuid from cg)), 'with the person who did it');
select test.check((select not exists (select 1 from audit_logs where action like 'CHAT_MEMBER_%' and (metadata ? 'body' or metadata ? 'message' or metadata::text ilike '%huddle message%'))), 'no message text is ever recorded');
select test.check((select count(*) = 0 from audit_logs a join chat_conversations c on c.id = a.entity_id where a.action like 'CHAT_MEMBER_%' and c.kind <> 'GROUP'), 'direct and client chats are system-made and not audited here');

\echo '--- 55. The audit viewer: search, filters, pages, and who may read what'
set role authenticated;
select test.login('sa');
create temp table asr as select audit_log_search() as j;
grant all on asr to authenticated;
select test.check((select (j ->> 'total')::bigint > 5 and jsonb_array_length(j -> 'items') = 25 and (j ->> 'pageSize')::int = 25 from asr), 'the Super Admin reads the log in pages of 25');
select test.check((select (audit_log_search(null, null, 'DENIED') ->> 'total')::bigint >= 3
                          and not exists (select 1 from jsonb_array_elements(audit_log_search(null, null, 'DENIED', null, null, null, 1, 100) -> 'items') i where i ->> 'outcome' <> 'DENIED')), 'filtering by outcome returns only that outcome');
select test.check((select (audit_log_search('member a') ->> 'total')::bigint >= 1
                          and not exists (select 1 from jsonb_array_elements(audit_log_search('member a', null, null, null, null, null, 1, 100) -> 'items') i where lower(coalesce(i ->> 'actor', '')) not like '%member a%' and lower(i ->> 'action') not like '%member a%'
                                                                   and lower(coalesce(i ->> 'requestId', '')) not like '%member a%')), 'searching finds events by the actor''s name');
select test.check((select (audit_log_search(null, 'DATA_EXPORTED') ->> 'total')::bigint >= 2 and (audit_log_search(null, 'PAYMENT_VERIFIED', null, null, '2999-01-01', null) ->> 'total')::bigint = 0), 'filtering by event type and by date works');
select test.check((select (audit_log_search(null, null, null, null, null, null, 2, 5) ->> 'page')::int = 2 and jsonb_array_length(audit_log_search(null, null, null, null, null, null, 2, 5) -> 'items') = 5), 'paging moves through the log');
select test.check((select (audit_log_actions() ? 'SESSION_STARTED') and (audit_log_actions() ? 'DATA_EXPORTED') from (select 1) x), 'the event types can be listed for the filter');
select test.check((select not exists (select 1 from jsonb_array_elements(audit_log_search(null, null, null, null, null, null, 1, 100) -> 'items') i where i -> 'metadata' ? 'password' or i -> 'metadata' ? 'token' or i -> 'metadata' ? 'authorization')), 'no returned event carries a secret');
select test.must_fail($$select audit_log_search(null, null, 'MAYBE')$$, 'an unknown outcome is refused', 'Unknown outcome');
select test.login('dh_wab');
select test.check((select (audit_log_search(null, null, null, null, null, null, 1, 100) ->> 'total')::bigint > 0
                          and not exists (select 1 from jsonb_array_elements(audit_log_search(null, null, null, null, null, null, 1, 100) -> 'items') i where (i ->> 'departmentId')::uuid is distinct from test.dept('wabastore'))),
  'a Department Head reads only their own department''s events');
select test.login('th_wab');
select test.check((select not exists (select 1 from jsonb_array_elements(audit_log_search(null, null, null, null, null, null, 1, 100) -> 'items') i where (i ->> 'departmentId')::uuid is distinct from test.dept('wabastore'))), 'and a Team Lead only the team''s');
select test.login('tm_a');
select test.must_fail($$select audit_log_search()$$, 'a Team Member cannot read the audit log', 'managers');
select test.must_fail($$select audit_log_actions()$$, 'nor list its event types', 'managers');
select test.check((select count(*) = 0 from audit_logs), 'row-level security shows them no rows even by direct query');
reset role;
set role anon;
select test.must_fail($$select audit_log_search()$$, 'a signed-out visitor cannot read it', 'permission denied');
reset role;
