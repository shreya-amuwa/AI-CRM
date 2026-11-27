-- =============================================================================
-- Dashboard Explorer (migration 20270226000100): only the active Managing Director may start a preview, list recent previews and send
-- improvement requests; a CEO, a Department Head and a Team Member are refused. A preview changes no role, no profile, no session; an
-- improvement request lands in the Developer Team's issues with the dashboard / page / viewport, once per request id, and the Managing
-- Director is told when its status changes.
-- Uses rls_test.sql's Super Admin (sa), Wabastore Department Head (dh_wab) and Sales member (tm_a), employee_hierarchy_test.sql's
-- Operations Head / CEO (eh_newoh) and developer_bugs_test.sql's Developer Team (dv_shreya is its Team Lead, dv_ashish a developer).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Dashboard Explorer'
reset role;
\i supabase/migrations/20270226000100_dashboard_explorer.sql
\i supabase/migrations/20270226000100_dashboard_explorer.sql
delete from dev_bugs where source = 'DASHBOARD_EXPLORER' and reporter_id = test.id('sa');
create temp table dx (k text primary key, v jsonb);
grant all on dx to authenticated;
create temp table dx_before as select id, role, status, department_id, team_id, is_operations_head from profiles;

select test.check((select is_operations_head and status = 'ACTIVE' from profiles where id = test.id('eh_newoh')), 'precondition: eh_newoh is an active CEO (Operations Head)');

\echo '   the Managing Director'
set role authenticated;
select test.login('sa');
insert into dx select 'session', dashboard_explorer_session_start('{"dashboardId":"sales-department-head","department":"mpillar","scenario":"normal"}');
select test.check((select v ->> 'sessionId' ~ '^[0-9a-f-]{36}$' from dx where k = 'session'), 'the Managing Director starts a preview and gets a session id');
select test.must_fail($$select dashboard_explorer_session_start('{"dashboardId":"login-as-anyone","department":"mpillar"}')$$, 'a dashboard outside the registry is refused', 'Choose a dashboard');
select test.must_fail($$select dashboard_explorer_session_start('{"dashboardId":"sales-department-head","department":"not-a-dept"}')$$, 'a department outside the list is refused', 'Choose a department');
select dashboard_explorer_session_start('{"dashboardId":"support-team-lead","department":"wabastore","scenario":"escalations"}');
select test.check((select jsonb_array_length(dashboard_explorer_recent()) = 2
                      and dashboard_explorer_recent() -> 0 ->> 'dashboardId' = 'support-team-lead'), 'recently viewed: the two previews, the newest first');
select dashboard_explorer_session_end((select (v ->> 'sessionId')::uuid from dx where k = 'session'));
select dashboard_explorer_session_end((select (v ->> 'sessionId')::uuid from dx where k = 'session'));
select test.must_fail($$select dashboard_explorer_session_end(gen_random_uuid())$$, 'ending an unknown preview is refused', 'NOT_FOUND');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'DASHBOARD_PREVIEW_STARTED' and actor_id = test.id('sa') and entity_id = (select (v ->> 'sessionId')::uuid from dx where k = 'session')
                      and metadata ->> 'dashboardId' = 'sales-department-head' and metadata ->> 'department' = 'mpillar'), 'the start is audited with the real actor, the dashboard and the department');
select test.check((select count(*) = 1 from audit_logs where action = 'DASHBOARD_PREVIEW_ENDED' and entity_id = (select (v ->> 'sessionId')::uuid from dx where k = 'session')),
  'the end is audited once, even when sent twice');
select test.check(not exists (select 1 from dx_before b join profiles p using (id)
                               where (p.role, p.status, p.department_id, p.team_id, p.is_operations_head) is distinct from (b.role, b.status, b.department_id, b.team_id, b.is_operations_head)),
  'a preview changes nobody''s role, status, department, team or CEO flag');
select test.check(not exists (select 1 from audit_logs where actor_id = test.id('sa') and action ~ 'LOGIN|SIGN_IN|IMPERSONAT' and created_at > now() - interval '5 minutes'),
  'no sign-in or impersonation event is written');

\echo '   improvement requests'
set role authenticated;
select test.login('sa');
insert into dx select 'req', dashboard_explorer_suggest('{"dashboardId":"support-department-head","department":"mpillar","page":"/admin/dashboard/mpillar","pageTitle":"Overview",
  "viewport":"mobile","build":"demo-build","title":"Show overdue tickets at the top","description":"Display pending escalations and overdue support tickets above the general statistics.",
  "expected":"Escalations first.","priority":"HIGH","attachmentIds":[],"clientRequestId":"dx-test-request-0001"}');
select test.check((select v ->> 'reference' like 'BUG-%' and v ->> 'duplicate' = 'false' and v ->> 'status' = 'PENDING' from dx where k = 'req'), 'the request is filed as a Developer Team issue');
select test.check((select dashboard_explorer_suggest('{"dashboardId":"support-department-head","department":"mpillar","viewport":"mobile","title":"Show overdue tickets at the top",
  "description":"Display pending escalations and overdue support tickets above the general statistics.","priority":"HIGH","clientRequestId":"dx-test-request-0001"}') ->> 'duplicate') = 'true',
  'the same request sent twice gives the first one back (no duplicate)');
select test.must_fail($$select dashboard_explorer_suggest('{"dashboardId":"support-department-head","department":"mpillar","viewport":"mobile","title":"x","description":"Too short","priority":"HIGH","clientRequestId":"dx-test-request-0002"}')$$,
  'a request without a proper title is refused', 'title');
select test.must_fail($$select dashboard_explorer_suggest('{"dashboardId":"nope","department":"mpillar","viewport":"mobile","title":"A title","description":"Long enough description.","priority":"HIGH","clientRequestId":"dx-test-request-0003"}')$$,
  'a request about a dashboard outside the registry is refused', 'Choose a dashboard');
select test.check((select jsonb_array_length(dashboard_explorer_requests()) = 1 and dashboard_explorer_requests() -> 0 ->> 'page' = 'Overview'), 'the Managing Director sees their request with its page');
reset role;
select test.check((select category = 'FEATURE_REQUEST' and priority = 'HIGH' and source = 'DASHBOARD_EXPLORER' and context ->> 'dashboardId' = 'support-department-head'
                      and context ->> 'viewport' = 'mobile' and steps like '%Page: Overview (/admin/dashboard/mpillar)%' and steps like '%Expected behaviour:%Escalations first.%'
                    from dev_bugs where id = (select (v ->> 'id')::uuid from dx where k = 'req')), 'the issue carries the dashboard, page, viewport and expected behaviour');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('dv_shreya') and type = 'DEV_BUG_REPORTED' and entity_id = (select (v ->> 'id')::uuid from dx where k = 'req')),
  'the Developer Team is notified');
set role authenticated;
select test.login('dv_shreya');
select bug_dev_assign((select (v ->> 'id')::uuid from dx where k = 'req'), test.id('dv_ashish'));
select test.login('dv_ashish');
select bug_dev_set_status((select (v ->> 'id')::uuid from dx where k = 'req'), 'IN_PROGRESS', null);
reset role;
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('sa') and type = 'DEV_BUG_STATUS' and entity_id = (select (v ->> 'id')::uuid from dx where k = 'req')),
  'the Managing Director is told when the Developer Team changes the status');
set role authenticated;
select test.login('sa');
select test.check((select dashboard_explorer_requests() -> 0 ->> 'status') = 'IN_PROGRESS', 'and sees the new status in Dashboard Explorer');

\echo '   everyone else is refused'
select test.login('eh_newoh');
select test.must_fail($$select dashboard_explorer_session_start('{"dashboardId":"ceo-sales","department":"mpillar"}')$$, 'a CEO cannot start a preview', 'FORBIDDEN');
select test.must_fail($$select dashboard_explorer_recent()$$, 'a CEO cannot list previews', 'FORBIDDEN');
select test.must_fail($$select dashboard_explorer_suggest('{"dashboardId":"ceo-sales","department":"mpillar","viewport":"desktop","title":"A title","description":"Long enough description.","priority":"LOW","clientRequestId":"dx-test-request-0004"}')$$,
  'a CEO cannot send executive improvement requests', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select dashboard_explorer_session_start('{"dashboardId":"sales-team-lead","department":"wabastore"}')$$, 'a Department Head cannot start a preview', 'FORBIDDEN');
select test.must_fail($$select dashboard_explorer_requests()$$, 'nor read the Managing Director''s requests', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select dashboard_explorer_session_start('{"dashboardId":"telecaller","department":"mpillar"}')$$, 'a Team Member cannot start a preview', 'FORBIDDEN');
select test.must_fail($$select dashboard_explorer_session_end(gen_random_uuid())$$, 'nor end one', 'FORBIDDEN');
reset role;
set role anon;
select test.must_fail($$select dashboard_explorer_recent()$$, 'a signed-out caller is refused', 'permission denied|FORBIDDEN');
reset role;
-- the application never lets the Super Admin be suspended (tg_protect_super_admin); the test bypasses that trigger for one update only
set session_replication_role = replica;
update profiles set status = 'SUSPENDED' where id = test.id('sa');
set session_replication_role = origin;
set role authenticated;
select test.login('sa');
select test.must_fail($$select dashboard_explorer_session_start('{"dashboardId":"ceo-sales","department":"mpillar"}')$$, 'a Managing Director whose access is suspended is refused', 'FORBIDDEN');
reset role;
set session_replication_role = replica;
update profiles set status = 'ACTIVE' where id = test.id('sa');
set session_replication_role = origin;
select test.check(not has_function_privilege('authenticated', 'private.dashboard_explorer_actor()', 'execute'), 'the private helpers stay closed');
delete from dev_bugs where source = 'DASHBOARD_EXPLORER' and reporter_id = test.id('sa');
