-- =============================================================================
-- Field Visit live location, Field Visit leads routed through the Sales Department Head to a Telecaller, and the lead create a retry cannot
-- duplicate (migration 20261228000100). Reuses the Sales Department Head suite (sh_head, sh_tc, sh_ba), the RLS suite (th_wab, tm_a, dh_wab,
-- ba_x, sa) and the HR suite (hr_head). Adds a second Sales Team Lead and a Sales and a Support Operations Head.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 130. Field Visit: live location, and field visit leads -> Department Head -> Telecaller'
reset role;
\i supabase/migrations/20261228000100_field_visit_tracking_and_lead_routing.sql
\i supabase/migrations/20261228000100_field_visit_tracking_and_lead_routing.sql

delete from customers where name like 'FVT %';
delete from auth.users where email like 'fvt.%@example.com';
delete from test.users where name like 'fvt\_%';
delete from teams where department_id in (select id from departments where slug like 'fvt-%');
delete from departments where slug like 'fvt-%';
insert into departments (slug, name) values ('fvt-home', 'FVT Home');
insert into teams (department_id, name, division) select id, 'Sales', 'SALES' from departments where slug = 'fvt-home';

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.create_auth_user('fvt_tl2', 'fvt.tl2@example.com', '{"full_name":"FVT Other Lead"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('fvt_sops', 'fvt.sops@example.com', '{"full_name":"FVT Sales Ops"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('fvt-home'), 'provisioned_operations_head', true));
select test.create_auth_user('fvt_supops', 'fvt.supops@example.com', '{"full_name":"FVT Support Ops"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('fvt-home'), 'provisioned_operations_head', true));
reset role;
select set_config('request.jwt.claims', '', false);
-- the Business Associate's direct Team Lead is named (manager_id), so a second lead of the same team is "another Team Lead"
update profiles set manager_id = test.id('th_wab') where id = test.id('sh_ba');
create temp table fvt (k text primary key, v uuid);
grant all on fvt to authenticated;
set role authenticated;
select test.login('sa');
select operations_head_scope_apply(test.id('fvt_sops'), 'SALES', jsonb_build_array(jsonb_build_object('departmentId', test.dept('wabastore'), 'primary', false)));
select operations_head_scope_apply(test.id('fvt_supops'), 'SUPPORT', jsonb_build_array(jsonb_build_object('departmentId', test.dept('wabastore'), 'primary', false)));
reset role;
select test.check(private.scope_covers(test.id('fvt_sops'), test.dept('wabastore'), 'SALES') and not private.scope_covers(test.id('fvt_supops'), test.dept('wabastore'), 'SALES'),
  'fixture: a Sales and a Support Operations Head of the department');
select test.check(private.direct_lead_of(test.id('sh_ba')) = test.id('th_wab'), 'fixture: the Business Associate''s Team Lead is th_wab');

\echo '   a visit in progress; location only after the employee starts it'
set role authenticated;
select test.login('sh_ba');
insert into fvt select 'lead', create_lead('{"name":"FVT Track Shop","company":"FVT Track Co","phone":"9811455501","leadSource":"Walk-in"}'::jsonb, test.svcs(1));
insert into fvt select 'visit', (field_visit_schedule((select v from fvt where k = 'lead'), test.today(), null, 'MG Road', 'Demo') ->> 'id')::uuid;
select test.must_fail($$select field_visit_tracking_start((select v from fvt where k = 'visit'), 18.52, 73.85, 12)$$, 'no location before the visit has started', 'Start the visit first');
select field_visit_start((select v from fvt where k = 'visit'), 18.52, 73.85, 12, null);
select test.login('tm_a');
select test.must_fail($$select field_visit_tracking_start((select v from fvt where k = 'visit'), 18.52, 73.85, 12)$$, 'nobody can share a location for someone else''s visit', 'not found');
select test.login('sh_ba');
select test.check((select field_visit_tracking_start((select v from fvt where k = 'visit'), 18.520001, 73.850001, 15, now()) ->> 'trackingStatus') = 'ACTIVE', 'the employee starts sharing: tracking is ACTIVE');
select test.check((select (field_visit_tracking_start((select v from fvt where k = 'visit'), 18.520001, 73.850001, 15, now()) ->> 'points')::int) = 1, 'starting twice changes nothing (one position, one start)');
-- the session started ten minutes ago (so the positions below can carry real, past times)
reset role;
update lead_visits set tracking_started_at = tracking_started_at - interval '10 minutes' where id = (select v from fvt where k = 'visit');
update lead_visit_locations set recorded_at = recorded_at - interval '10 minutes' where visit_id = (select v from fvt where k = 'visit');
set role authenticated;
select test.login('sh_ba');
select test.check((select (field_visit_tracking_points((select v from fvt where k = 'visit'), jsonb_build_array(
    jsonb_build_object('latitude', 18.5210, 'longitude', 73.8510, 'accuracyMeters', 20, 'recordedAt', now() - interval '570 seconds'),
    jsonb_build_object('latitude', 18.5220, 'longitude', 73.8520, 'accuracyMeters', 20, 'recordedAt', now() - interval '540 seconds'),
    jsonb_build_object('latitude', 18.5221, 'longitude', 73.8521, 'accuracyMeters', 20, 'recordedAt', now() - interval '535 seconds'))) ->> 'saved')::int) = 2,
  'positions are saved, one taken 5 s after the previous one is skipped (no flood of writes)');
select test.check((select (field_visit_tracking_points((select v from fvt where k = 'visit'), jsonb_build_array(
    jsonb_build_object('latitude', 18.53, 'longitude', 73.86, 'accuracyMeters', 20, 'recordedAt', now() + interval '1 hour'),
    jsonb_build_object('latitude', 18.53, 'longitude', 73.86, 'accuracyMeters', 20, 'recordedAt', now() - interval '1 hour'))) ->> 'saved')::int) = 0,
  'a position from the future, or from before tracking started, is not stored');
select test.must_fail($$select field_visit_tracking_points((select v from fvt where k = 'visit'), '[{"latitude": 123, "longitude": 73.8, "accuracyMeters": 10, "recordedAt": "2026-01-01T00:00:00Z"}]')$$, 'an impossible position is refused', 'not valid');
select test.must_fail($$select field_visit_tracking_points((select v from fvt where k = 'visit'), '[]')$$, 'an empty batch is refused', 'between 1 and 50');
select test.check((select count(*) = 3 from lead_visit_locations where visit_id = (select v from fvt where k = 'visit')), 'the employee reads their own three positions');

\echo '   who sees the location'
select test.login('th_wab');
select test.check((select count(*) = 3 from lead_visit_locations where visit_id = (select v from fvt where k = 'visit')), 'the direct Team Lead reads the positions (and Realtime sends them, same row rule)');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_tracking_board() -> 'items') x where (x ->> 'visitId')::uuid = (select v from fvt where k = 'visit')
                     and x -> 'lastLocation' ->> 'latitude' = '18.522000' and x ->> 'teamLead' = (select full_name from profiles where id = test.id('th_wab'))),
  'the board shows the visit with the latest position and the Team Lead');
select test.check((select jsonb_array_length(field_visit_tracking_trail((select v from fvt where k = 'visit')) -> 'locations') = 3), 'and the history of the visit');
select field_visit_tracking_trail((select v from fvt where k = 'visit'));
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'FIELD_VISIT_TRACKING_VIEWED' and actor_id = test.id('th_wab') and entity_id = (select v from fvt where k = 'visit')),
  'viewing a trail is recorded once per half hour (two views, one record)');
set role authenticated;
select test.login('fvt_tl2');
select test.check((select count(*) = 0 from lead_visit_locations where visit_id = (select v from fvt where k = 'visit')), 'another Team Lead of the same team reads no position');
select test.check((select count(*) = 0 from jsonb_array_elements(field_visit_tracking_board() -> 'items') x where (x ->> 'visitId')::uuid = (select v from fvt where k = 'visit')), 'nor sees the visit on the board');
select test.must_fail($$select field_visit_tracking_trail((select v from fvt where k = 'visit'))$$, 'nor opens its trail', 'not found');
select test.login('sh_head');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_tracking_board() -> 'items') x where (x ->> 'visitId')::uuid = (select v from fvt where k = 'visit')), 'the Sales Department Head sees it');
select test.login('fvt_sops');
select test.check((select count(*) = 3 from lead_visit_locations where visit_id = (select v from fvt where k = 'visit')), 'the Sales Operations Head of the department reads it');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_tracking_board() -> 'items') x where (x ->> 'visitId')::uuid = (select v from fvt where k = 'visit')), 'and sees it on the board');
select test.login('fvt_supops');
select test.check((select count(*) = 0 from lead_visit_locations where visit_id = (select v from fvt where k = 'visit')), 'a Support Operations Head reads no Sales position');
select test.check((select count(*) = 0 from jsonb_array_elements(field_visit_tracking_board() -> 'items') x where (x ->> 'visitId')::uuid = (select v from fvt where k = 'visit')), 'nor sees the visit');
select test.must_fail($$select field_visit_tracking_trail((select v from fvt where k = 'visit'))$$, 'nor opens its trail', 'not found');
select test.login('dh_wab');
select test.check((select count(*) = 0 from lead_visit_locations where visit_id = (select v from fvt where k = 'visit')), 'the Support Department Head reads none');
select test.login('hr_head');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_tracking_board() -> 'items') x where (x ->> 'visitId')::uuid = (select v from fvt where k = 'visit')), 'HR sees the work tracking record');
select test.login('tm_a');
select test.check((select count(*) = 0 from lead_visit_locations where visit_id = (select v from fvt where k = 'visit')), 'a colleague reads none');
select test.must_fail($$select field_visit_tracking_board()$$, 'and has no tracking board', 'FORBIDDEN');
select test.login('ba_x');
select test.check((select count(*) = 0 from lead_visit_locations where visit_id = (select v from fvt where k = 'visit')), 'nor does anyone of another department');
reset role;
select test.check((select count(*) = 0 from information_schema.role_table_grants where table_name = 'lead_visit_locations' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  'nobody writes positions directly: only through the functions');
set role authenticated;

\echo '   a lost GPS fix, stopping, resuming, ending the visit'
select test.login('sh_ba');
select test.check((select field_visit_tracking_issue((select v from fvt where k = 'visit'), 'POSITION_UNAVAILABLE') ->> 'issue') = 'POSITION_UNAVAILABLE', 'a GPS failure is recorded (the board shows the last position as not live)');
select test.check((select field_visit_tracking_issue((select v from fvt where k = 'visit'), 'POSITION_UNAVAILABLE') ->> 'trackingStatus') = 'ACTIVE', 'and tracking goes on');
select test.check((select field_visit_tracking_points((select v from fvt where k = 'visit'), jsonb_build_array(
    jsonb_build_object('latitude', 18.5230, 'longitude', 73.8530, 'accuracyMeters', 25, 'recordedAt', now() - interval '480 seconds'))) ->> 'issue') is null, 'a new position clears it');
select test.check((select field_visit_tracking_stop((select v from fvt where k = 'visit')) ->> 'trackingStatus') = 'STOPPED', 'the employee stops sharing');
select test.must_fail($$select field_visit_tracking_points((select v from fvt where k = 'visit'), jsonb_build_array(jsonb_build_object('latitude', 18.53, 'longitude', 73.86, 'accuracyMeters', 20, 'recordedAt', now() - interval '420 seconds')))$$,
  'after stopping no position is accepted', 'has ended');
select test.check((select field_visit_tracking_start((select v from fvt where k = 'visit'), 18.524, 73.854, 15, now() - interval '450 seconds') ->> 'trackingStatus') = 'ACTIVE', 'sharing can be started again while the visit is in progress');
select field_visit_complete((select v from fvt where k = 'visit'), 'COMPLETED', 'Met the owner', null, null, null, null);
reset role;
select test.check((select tracking_status = 'STOPPED' and tracking_stop_reason = 'VISIT_ENDED' from lead_visits where id = (select v from fvt where k = 'visit')), 'finishing the visit ends tracking');
select test.check((select array_agg(event order by created_at, id) = array['STARTED', 'POSITION_UNAVAILABLE', 'STOPPED', 'STARTED', 'VISIT_ENDED']
                     from lead_visit_tracking_events where visit_id = (select v from fvt where k = 'visit')), 'every start, stop and problem is in the tracking history');
select test.check((select count(*) = 2 from audit_logs where action = 'FIELD_VISIT_TRACKING_STARTED' and entity_id = (select v from fvt where k = 'visit')), 'starts are audited');
set role authenticated;
select test.login('sh_ba');
select test.must_fail($$select field_visit_tracking_points((select v from fvt where k = 'visit'), jsonb_build_array(jsonb_build_object('latitude', 18.53, 'longitude', 73.86, 'accuracyMeters', 20, 'recordedAt', now())))$$,
  'no position is accepted once the visit is over', 'has ended');
select test.must_fail($$select field_visit_tracking_start((select v from fvt where k = 'visit'), 18.52, 73.85, 12)$$, 'nor can sharing start again', 'Start the visit first');
select test.login('th_wab');
select test.check((select x ->> 'trackingStatus' = 'STOPPED' and x ->> 'visitStatus' = 'COMPLETED' and x -> 'lastLocation' is not null
                    from jsonb_array_elements(field_visit_tracking_board() -> 'items') x where (x ->> 'visitId')::uuid = (select v from fvt where k = 'visit')),
  'the manager still sees the last known position, marked as ended');

\echo '   a withdrawn location permission'
select test.login('sh_ba');
insert into fvt select 'visit2', (field_visit_schedule((select v from fvt where k = 'lead'), test.today(), null, 'MG Road', 'Second visit') ->> 'id')::uuid;
select field_visit_start((select v from fvt where k = 'visit2'), null, null, null, 'No GPS');
select field_visit_tracking_start((select v from fvt where k = 'visit2'), 18.52, 73.85, 30, now());
select test.check((select field_visit_tracking_issue((select v from fvt where k = 'visit2'), 'PERMISSION_DENIED') ->> 'stopReason') = 'PERMISSION_DENIED', 'a withdrawn permission ends tracking: the last position is shown as not live');
select test.must_fail($$select field_visit_tracking_issue((select v from fvt where k = 'visit2'), 'GONE')$$, 'an unknown problem is refused', 'Unknown location problem');
select field_visit_cancel((select v from fvt where k = 'visit2'), 'test');

\echo '   retention'
select test.login('sh_head');
select test.must_fail($$select purge_field_visit_tracking()$$, 'only the Super Admin runs the clean-up by hand', 'FORBIDDEN');
reset role;
update lead_visit_locations set received_at = now() - interval '100 days' where id = (select min(id) from lead_visit_locations where visit_id = (select v from fvt where k = 'visit'));
set role authenticated;
select test.login('sa');
select test.check((select (purge_field_visit_tracking() ->> 'locationsRemoved')::int >= 1), 'positions older than the retention period (90 days) are removed');
reset role;
select test.check((select count(*) = 4 from lead_visit_locations where visit_id = (select v from fvt where k = 'visit')), 'recent ones stay');
set role authenticated;

\echo '   a field visit lead goes to the Sales Department Head, who gives it to a Telecaller'
select test.login('sh_ba');
insert into fvt select 'fv', create_lead('{"name":"FVT Signboard Shop","company":"FVT Sign Co","phone":"9811455510","leadSource":"Field visit","address":"Shop 4, Camp"}'::jsonb, test.svcs(1));
insert into fvt select 'walk', create_lead('{"name":"FVT Walk-in Shop","company":"FVT Walk Co","phone":"9811455511","leadSource":"Walk-in"}'::jsonb, test.svcs(1));
reset role;
select test.check((select status = 'PENDING' and created_by = test.id('sh_ba') from field_visit_lead_routes where lead_id = (select v from fvt where k = 'fv')), 'a field visit lead waits for the Department Head');
select test.check((select owner_id = test.id('sh_ba') and created_by = test.id('sh_ba') and lead_source = 'Field visit' from customers where id = (select v from fvt where k = 'fv')), 'it is one lead in the pipeline, with its creator and source');
select test.check(not exists (select 1 from field_visit_lead_routes where lead_id = (select v from fvt where k = 'walk')), 'a lead of another source is not routed');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sh_head') and type = 'FIELD_VISIT_LEAD_PENDING' and entity_id = (select v from fvt where k = 'fv')), 'the Sales Department Head is notified once');
select test.check((select count(*) = 0 from notifications where recipient_id in (test.id('dh_wab'), test.id('fvt_sops')) and type = 'FIELD_VISIT_LEAD_PENDING' and entity_id = (select v from fvt where k = 'fv')), 'not the Support head nor an Operations Head');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select v from fvt where k = 'fv') and type = 'FIELD_VISIT_LEAD_SUBMITTED'), 'the lead history says so');
set role authenticated;
select test.login('sh_head');
insert into fvt select 'dhlead', create_lead('{"name":"FVT Head Shop","company":"FVT Head Co","phone":"9811455512","leadSource":"Field visit"}'::jsonb, test.svcs(1));
reset role;
select test.check(not exists (select 1 from field_visit_lead_routes where lead_id = (select v from fvt where k = 'dhlead')), 'a lead the head adds is not routed to themselves');
set role authenticated;

\echo '   nobody but the head decides'
select test.login('sh_ba');
select test.must_fail($$select move_customer_to_potential((select v from fvt where k = 'fv'), 20000, test.today() + 7)$$, 'the employee cannot move it on before the head assigns it', 'waiting for the Sales Department Head');
select test.must_fail($$select field_visit_lead_queue()$$, 'nor read the queue', 'FORBIDDEN');
select test.must_fail($$select field_visit_lead_assign((select v from fvt where k = 'fv'), test.id('sh_tc'), null)$$, 'nor assign it', 'FORBIDDEN');
select test.login('th_wab');
select test.must_fail($$select team_lead_assign_customer((select v from fvt where k = 'fv'), test.id('th_wab'))$$, 'nor can a Team Lead take it', 'waiting for the Sales Department Head|NOT_FOUND|FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select field_visit_lead_assign((select v from fvt where k = 'fv'), test.id('sh_tc'), null)$$, 'the Support head cannot assign it', 'not found');
select test.check((select (field_visit_lead_queue('ALL') ->> 'total')::int = 0), 'and does not see it');
select test.login('fvt_sops');
select test.must_fail($$select field_visit_lead_queue()$$, 'an Operations Head oversees; the Department Head assigns', 'FORBIDDEN');

\echo '   the head assigns it to a Telecaller'
select test.login('sh_head');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_lead_queue() -> 'items') x where (x ->> 'leadId')::uuid = (select v from fvt where k = 'fv')
                     and x -> 'createdBy' ->> 'role' = 'Business Associate' and x ->> 'status' = 'PENDING'), 'the queue shows the lead, who added it and that it waits');
select test.check((select (field_visit_lead_queue() ->> 'pending')::int >= 1), 'with a pending count');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_lead_telecallers((select v from fvt where k = 'fv'))) x where (x ->> 'id')::uuid = test.id('sh_tc')), 'the Telecaller of the department can be chosen');
select test.check((select count(*) = 0 from jsonb_array_elements(field_visit_lead_telecallers((select v from fvt where k = 'fv'))) x where (x ->> 'id')::uuid in (test.id('sh_ba'), test.id('tm_a'), test.id('ba_x'))), 'not a Business Associate, a Sales member or another department');
select test.must_fail($$select field_visit_lead_assign((select v from fvt where k = 'fv'), test.id('sh_ba'), null)$$, 'only a Telecaller', 'Choose an active Telecaller');
select test.must_fail($$select field_visit_lead_assign((select v from fvt where k = 'walk'), test.id('sh_tc'), null)$$, 'only a routed field visit lead', 'not found');
select test.check((select field_visit_lead_assign((select v from fvt where k = 'fv'), test.id('sh_tc'), 'Call them this week') ->> 'changed')::boolean, 'the head assigns it to the Telecaller');
select test.check(not (select field_visit_lead_assign((select v from fvt where k = 'fv'), test.id('sh_tc'), 'Call them this week') ->> 'changed')::boolean, 'a retry of the same assignment changes nothing');
reset role;
select test.check((select owner_id = test.id('sh_tc') and created_by = test.id('sh_ba') and lead_source = 'Field visit' and payment_workflow = 'NONE' and lifecycle_stage = 'LEAD'
                    from customers where id = (select v from fvt where k = 'fv')), 'the Telecaller owns it; the creator, source, stage and Accounts workflow are kept');
select test.check((select status = 'ASSIGNED' and assigned_to = test.id('sh_tc') and assigned_by = test.id('sh_head') and assigned_at is not null from field_visit_lead_routes where lead_id = (select v from fvt where k = 'fv')), 'the route records who, to whom and when');
select test.check((select count(*) = 1 from field_visit_lead_assignment_events where lead_id = (select v from fvt where k = 'fv') and previous_owner = test.id('sh_ba') and note = 'Call them this week'), 'one assignment in the history');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sh_tc') and type = 'LEAD_ASSIGNED' and entity_id = (select v from fvt where k = 'fv')), 'the Telecaller is notified once');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sh_ba') and type = 'FIELD_VISIT_LEAD_ASSIGNED' and entity_id = (select v from fvt where k = 'fv')), 'the employee who added it is told who has it');
select test.check((select count(*) = 1 from audit_logs where action = 'FIELD_VISIT_LEAD_ASSIGNED_TO_TELECALLER' and entity_id = (select v from fvt where k = 'fv')), 'the assignment is audited');
set role authenticated;
select test.login('sh_tc');
select test.check((select count(*) = 1 from jsonb_array_elements(telecaller_leads_list() -> 'items') x where (x ->> 'id')::uuid = (select v from fvt where k = 'fv')), 'the lead is in the Telecaller''s leads');

\echo '   a retried lead create makes one lead'
select test.login('sh_ba');
select create_lead_once('{"name":"FVT Retry Shop","company":"FVT Retry Co","phone":"9811455520","leadSource":"Field visit"}'::jsonb, test.svcs(1), '6f1d8c1e-0000-4000-8000-000000000001');
select test.check((select (create_lead_once('{"name":"FVT Retry Shop","company":"FVT Retry Co","phone":"9811455520","leadSource":"Field visit"}'::jsonb, test.svcs(1), '6f1d8c1e-0000-4000-8000-000000000001') ->> 'existing')::boolean),
  'the same request again returns the first lead');
reset role;
select test.check((select count(*) = 1 from customers where name = 'FVT Retry Shop'), 'one lead, not two');
select test.check((select count(*) = 1 from field_visit_lead_routes r join customers c on c.id = r.lead_id where c.name = 'FVT Retry Shop'), 'and one entry in the head''s queue');
set role authenticated;
select test.login('tm_a');
select test.check(not (create_lead_once('{"name":"FVT Retry Other","company":"FVT Retry Co","phone":"9811455521","leadSource":"Walk-in"}'::jsonb, test.svcs(1), '6f1d8c1e-0000-4000-8000-000000000001') ->> 'existing')::boolean,
  'another person''s request id is their own');
reset role;
