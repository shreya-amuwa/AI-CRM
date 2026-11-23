-- =============================================================================
-- Crocodial sync without needless writes (migration 20270127000100): a top-up run does not rewrite rows that did not change, scheduled
-- runs never start a full re-read on their own (only Sync now does, and the very first pull), and how often a connection is due is the
-- caller's setting. Uses its own connection (removed at the end). Synthetic data only.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 139b. Crocodial: quiet sync'
reset role;
\i supabase/migrations/20270127000100_crocodial_sync_quiet.sql
\i supabase/migrations/20270127000100_crocodial_sync_quiet.sql
-- its own connection, with a first (full) pull of three calls already stored
delete from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_QUIETTEST';
insert into crocodial_connections (name, credential_ref, enabled) values ('Quiet test', 'CROCODIAL_TOKEN_QUIETTEST', true) returning id as c1 \gset
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar') and division = 'SALES';
insert into crocodial_department_links (connection_id, department_id, division, enabled) values (:'c1', test.dept('mpillar'), 'SALES', true);
select croc_sync_begin(:'c1', 'call-logs');
select croc_sync_store(:'c1', 'call-logs', jsonb_build_array(
  jsonb_build_object('id', 1, 'calledBy', 4138, 'lead', 900, 'callType', 'outgoing', 'callAt', (now() - interval '2 days')::text, 'durationSeconds', 125, 'connected', true),
  jsonb_build_object('id', 2, 'calledBy', 371, 'lead', 901, 'callType', 'incoming', 'callAt', (now() - interval '2 days')::text, 'durationSeconds', 10, 'connected', true),
  jsonb_build_object('id', 3, 'calledBy', 4193, 'lead', 902, 'callType', 'outgoing', 'callAt', (now() - interval '1 day')::text, 'durationSeconds', 60, 'connected', true)), null);
select croc_sync_finish(:'c1', 'call-logs', 'DONE', 1, 0);
update crocodial_sync_state set last_full_at = now() - interval '8 days' where connection_id = :'c1' and resource = 'call-logs';

\echo '   a scheduled run never starts a full re-read on its own'
select test.check((croc_sync_begin(:'c1', 'call-logs', null) ->> 'full')::boolean = false,
  'a week after the last full read, a scheduled run still only asks for what changed');

\echo '   a row that did not change is not written again'
select xmin::text as x1 from crocodial_ext_calls where connection_id = :'c1' and external_id = 1 \gset
select jsonb_build_array(jsonb_build_object('id', 1, 'calledBy', called_by_ext, 'lead', lead_ext, 'phone', phone_number, 'contactName', contact_name,
         'callType', call_type, 'callAt', call_at::text, 'durationSeconds', duration_seconds, 'connected', connected, 'syncedAt', external_synced_at::text)) as same
  from crocodial_ext_calls where connection_id = :'c1' and external_id = 1 \gset
select test.check(croc_sync_store(:'c1', 'call-logs', :'same'::jsonb, null) = 0, 'storing an unchanged call writes no new version');
select test.check((select xmin::text = :'x1' from crocodial_ext_calls where connection_id = :'c1' and external_id = 1), 'the row is left exactly as it was');
select test.check(croc_sync_store(:'c1', 'call-logs', jsonb_set(:'same'::jsonb, '{0,durationSeconds}', to_jsonb((select duration_seconds + 1 from crocodial_ext_calls where connection_id = :'c1' and external_id = 1))), null) = 1,
  'a call that changed is written');
select test.check((select xmin::text <> :'x1' from crocodial_ext_calls where connection_id = :'c1' and external_id = 1), 'and updated');
-- a call marked missing that comes back is written (it is no longer missing)
update crocodial_ext_calls set missing_since = now() where connection_id = :'c1' and external_id = 3;
select jsonb_build_array(jsonb_build_object('id', 3, 'calledBy', called_by_ext, 'lead', lead_ext, 'phone', phone_number, 'contactName', contact_name,
         'callType', call_type, 'callAt', call_at::text, 'durationSeconds', duration_seconds, 'connected', connected, 'syncedAt', external_synced_at::text)) as back
  from crocodial_ext_calls where connection_id = :'c1' and external_id = 3 \gset
select croc_sync_store(:'c1', 'call-logs', :'back'::jsonb, null);
select test.check((select missing_since is null from crocodial_ext_calls where connection_id = :'c1' and external_id = 3), 'a missing call that comes back is no longer missing');
select croc_sync_finish(:'c1', 'call-logs', 'DONE', 1, 0);

\echo '   the same for leads (the longest list of fields)'
select croc_sync_begin(:'c1', 'leads');
select croc_sync_store(:'c1', 'leads', jsonb_build_array(jsonb_build_object('id', 900, 'name', 'Test Lead', 'phone', '+919800000900', 'company', 'Test Co',
  'city', 'Pune', 'status', 'new', 'source', 'web', 'assignedTo', 4138, 'createdBy', 4138, 'called', true, 'dialerOutcome', 'answered', 'remarkCount', 2,
  'nextFollowupAt', (now() + interval '1 day')::text, 'lastInteractionAt', (now() - interval '1 hour')::text, 'createdAt', (now() - interval '5 days')::text,
  'updatedAt', (now() - interval '1 hour')::text)), null);
select croc_sync_finish(:'c1', 'leads', 'DONE', 1, 0);
select croc_sync_begin(:'c1', 'leads', null);
select xmin::text as lx from crocodial_ext_leads where connection_id = :'c1' and external_id = 900 \gset
select jsonb_build_array(jsonb_build_object('id', 900, 'name', name, 'phone', phone_number, 'company', company, 'city', city, 'status', status, 'source', source,
         'assignedTo', assigned_to_ext, 'createdBy', created_by_ext, 'called', called, 'dialerOutcome', dialer_outcome, 'remarkCount', remark_count,
         'nextFollowupAt', next_followup_at::text, 'lastInteractionAt', last_interaction_at::text, 'createdAt', external_created_at::text, 'updatedAt', external_updated_at::text)) as lead_same
  from crocodial_ext_leads where connection_id = :'c1' and external_id = 900 \gset
select test.check(croc_sync_store(:'c1', 'leads', :'lead_same'::jsonb, null) = 0
                  and (select xmin::text = :'lx' from crocodial_ext_leads where connection_id = :'c1' and external_id = 900), 'an unchanged lead gets no new version');
select test.check(croc_sync_store(:'c1', 'leads', jsonb_set(:'lead_same'::jsonb, '{0,remarkCount}', '3'), null) = 1, 'a lead whose remark count changed is written');
select croc_sync_finish(:'c1', 'leads', 'DONE', 1, 0);

\echo '   Sync now still does the weekly full re-read'
update crocodial_sync_state set last_full_at = now() - interval '8 days' where connection_id = :'c1' and resource = 'call-logs';
select test.check((croc_sync_begin(:'c1', 'call-logs') ->> 'full')::boolean, 'Sync now (the default) starts the full re-read when a week has passed');
update crocodial_sync_state set next_page = null, running_since = null, run_full = false where connection_id = :'c1' and resource = 'call-logs';

\echo '   how often a connection is due is the caller''s setting'
update crocodial_sync_state set last_run_at = now() - interval '30 minutes', next_page = null where connection_id = :'c1';
select test.check(not exists (select 1 from jsonb_array_elements(croc_sync_due(interval '60 minutes')) x where (x ->> 'id')::uuid = :'c1'), 'synced 30 minutes ago: not due when the setting is hourly');
select test.check(exists (select 1 from jsonb_array_elements(croc_sync_due(interval '15 minutes')) x where (x ->> 'id')::uuid = :'c1'), 'but due when it is every 15 minutes');

-- clean up
delete from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_QUIETTEST';
