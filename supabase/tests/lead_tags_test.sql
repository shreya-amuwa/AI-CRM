-- =============================================================================
-- Lead tags (migration 20270305000100): the seed tags, the backfill (no lead without a tag, stage totals unchanged), the trigger that keeps
-- lead_status equal to the tag's stage both ways, department checks on a lead's tag, re-seeding when a lead changes department or a CEO
-- loses a department, and private.is_ceo_for_sales ("runs a department" = a CEO whose scope covers its Sales side).
-- Runs at the end (uses sa and sh_head of the earlier suites).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- lead tags'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites re-run older migrations that redefine customers' triggers; this one is safe to run twice
\i supabase/migrations/20270305000100_lead_tags.sql
\i supabase/migrations/20270305000100_lead_tags.sql

do $$
begin
  if not exists (select 1 from test.users where name = 'lt_ceo_a') then
    perform test.create_auth_user('lt_ceo_a', 'lt.ceo.a@example.com', '{"full_name":"LT CEO A"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD',
      'provisioned_department_id', test.dept('whatsbox'), 'provisioned_operations_head', true));
    perform test.create_auth_user('lt_ceo_b', 'lt.ceo.b@example.com', '{"full_name":"LT CEO B"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD',
      'provisioned_department_id', test.dept('whatsbox'), 'provisioned_operations_head', true));
    perform test.create_auth_user('lt_ceo_sup', 'lt.ceo.sup@example.com', '{"full_name":"LT Support CEO"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD',
      'provisioned_department_id', test.dept('whatsbox'), 'provisioned_head_division', 'SUPPORT', 'provisioned_operations_head', true));
    perform test.create_auth_user('lt_wab_tm', 'lt.wab.tm@example.com', '{"full_name":"LT Wabastore Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER',
      'provisioned_team_id', test.team('wabastore', 'Sales')));
    perform test.create_auth_user('lt_wbx_tm', 'lt.wbx.tm@example.com', '{"full_name":"LT Whatsbox Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER',
      'provisioned_team_id', test.team('whatsbox', 'Sales')));
    perform test.create_auth_user('lt_dg_tm', 'lt.dg.tm@example.com', '{"full_name":"LT Digitree Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER',
      'provisioned_team_id', test.team('digitree', 'Sales')));
  end if;
  if not exists (select 1 from test.users where name = 'lt_ceo_c') then
    perform test.create_auth_user('lt_ceo_c', 'lt.ceo.c@example.com', '{"full_name":"LT CEO C"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD',
      'provisioned_department_id', test.dept('wabastore'), 'provisioned_operations_head', true));
  end if;
end $$;
update profiles set status = 'ACTIVE', is_operations_head = true where id in (test.id('lt_ceo_a'), test.id('lt_ceo_b'), test.id('lt_ceo_sup'), test.id('lt_ceo_c'));
update profiles set status = 'ACTIVE' where id in (test.id('lt_wab_tm'), test.id('lt_wbx_tm'), test.id('lt_dg_tm'));
delete from operations_head_departments where profile_id in (test.id('lt_ceo_a'), test.id('lt_ceo_b'), test.id('lt_ceo_sup'), test.id('lt_ceo_c'));
insert into operations_head_departments (profile_id, department_id, division) values
  (test.id('lt_ceo_a'), test.dept('wabastore'), null), (test.id('lt_ceo_a'), test.dept('whatsbox'), null),
  (test.id('lt_ceo_b'), test.dept('whatsbox'), null), (test.id('lt_ceo_b'), test.dept('digitree'), null),
  (test.id('lt_ceo_sup'), test.dept('whatsbox'), 'SUPPORT'),
  (test.id('lt_ceo_c'), test.dept('wabastore'), null), (test.id('lt_ceo_c'), test.dept('whatsbox'), null);
-- a re-run starts lt_ceo_c from its home department again (operations_scope_apply below moves it)
update profiles set department_id = test.dept('wabastore') where id = test.id('lt_ceo_c');
delete from customers where phone like '+9198771%';
delete from lead_tag_departments where tag_id in (select id from lead_tags where label like 'LT %' or created_by in (select id from test.users where name like 'lt\_%'));
delete from lead_tags where label like 'LT %' or created_by in (select id from test.users where name like 'lt\_%');

-- security definer: also used while signed in as the authenticated role, which cannot read the tag tables
create or replace function test.lt_tag(p_label text) returns uuid language sql stable security definer set search_path = '' as $$ select id from public.lead_tags where label = p_label $$;
create or replace function test.lt_seed(p_stage text) returns uuid language sql stable security definer set search_path = '' as $$ select id from public.lead_tags where seed_stage = p_stage $$;
create or replace function test.lt_lead(p_phone text) returns public.customers language sql stable as $$ select * from public.customers where phone = p_phone $$;
create or replace function test.lt_mk_lead(p_owner text, p_phone text, p_fields jsonb default '{}') returns uuid language plpgsql as $$
declare v uuid;
begin
  perform test.login(p_owner);
  v := public.create_lead(jsonb_build_object('name', 'LT ' || p_phone, 'phone', p_phone) || p_fields, array['BLUE_TICK']);
  perform set_config('request.jwt.claims', '', false);
  return v;
end $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   the seed tags'
select test.check((select count(*) = 7 from lead_tags where created_by is null and scope = 'COMPANY' and retired_at is null and ((label, stage, seed_stage) in (
    ('New', 'NEW', 'NEW'), ('Contacted', 'CONTACTED', 'CONTACTED'), ('Interested', 'INTERESTED', 'INTERESTED'), ('Ready to buy', 'READY_TO_BUY', 'READY_TO_BUY'))
    or ((label, stage) in (('Demo done', 'INTERESTED'), ('No response / unreachable', 'CONTACTED'), ('On hold / future prospect', 'CONTACTED')) and seed_stage is null))),
  'the 7 company-wide seed tags exist, the 4 status tags are the seed of their stage');
select test.check((select count(*) = 4 from lead_tags where seed_stage is not null), 'exactly one seed tag per stage');
select test.must_fail($$update lead_tags set retired_at = now() where seed_stage = 'NEW'$$, 'a seed of stage cannot be retired', 'lead_tags_seed_check');
select test.must_fail($$update lead_tags set stage = 'CONTACTED' where seed_stage = 'NEW'$$, 'nor moved to another stage', 'lead_tags_seed_check');
select test.must_fail($$insert into lead_tags (label, colour, stage, scope) values ('LT bad', 'pink', 'NEW', 'COMPANY')$$, 'a colour outside the palette is refused', 'colour');

\echo '   the backfill'
-- leads that lost their tag (as before the migration): the trigger is switched off to make them, the migration fills them again
alter table customers disable trigger customers_lead_tag_sync;
update customers set lead_tag_id = null where id in (select id from customers where lifecycle_stage = 'LEAD' order by id limit 50);
alter table customers enable trigger customers_lead_tag_sync;
create temp table lt_before as select lead_status, count(*) as n from customers group by lead_status;
create temp table lt_untagged as select id, updated_at, updated_by from customers where lead_tag_id is null;
create temp table lt_noise as select (select count(*) from audit_logs) as audits, (select count(*) from notifications) as notes;
select test.check((select count(*) > 0 from customers where lead_tag_id is null), 'some records have no tag before the migration runs');
\i supabase/migrations/20270305000100_lead_tags.sql
select test.check((select count(*) = 0 from customers where lifecycle_stage = 'LEAD' and lead_tag_id is null), 'after the migration every lead has a tag');
select test.check((select count(*) = 0 from customers c join lead_tags t on t.id = c.lead_tag_id where t.stage <> c.lead_status), 'every record''s tag counts as its status');
select test.check(not exists (select lead_status, count(*) from customers group by lead_status except select lead_status, n from lt_before)
                  and not exists (select lead_status, n from lt_before except select lead_status, count(*) from customers group by lead_status),
  'counts by lead_status are the same before and after re-running the migration (reports unchanged)');
select test.check((select count(*) = 0 from lt_untagged u join customers c using (id) where c.updated_at is distinct from u.updated_at or c.updated_by is distinct from u.updated_by),
  'the backfill is not an edit: updated_at / updated_by are unchanged');
select test.check((select (select count(*) from audit_logs) = audits and (select count(*) from notifications) = notes from lt_noise),
  'and it writes no audit entry or notification');

\echo '   creating leads'
insert into lead_tags (label, colour, stage, scope, created_by) values
  ('LT Wab only', 'red', 'CONTACTED', 'DEPARTMENTS', test.id('lt_ceo_a')),
  ('LT Wab and Wbx', 'violet', 'INTERESTED', 'DEPARTMENTS', test.id('lt_ceo_a')),
  ('LT Retired', 'slate', 'CONTACTED', 'COMPANY', null),
  ('LT B Wbx', 'blue', 'NEW', 'DEPARTMENTS', test.id('lt_ceo_b')),
  ('LT C Wab and Wbx', 'amber', 'INTERESTED', 'DEPARTMENTS', test.id('lt_ceo_c'));
insert into lead_tag_departments (tag_id, department_id) values
  (test.lt_tag('LT Wab only'), test.dept('wabastore')), (test.lt_tag('LT Wab and Wbx'), test.dept('wabastore')), (test.lt_tag('LT Wab and Wbx'), test.dept('whatsbox')),
  (test.lt_tag('LT B Wbx'), test.dept('whatsbox')),
  (test.lt_tag('LT C Wab and Wbx'), test.dept('wabastore')), (test.lt_tag('LT C Wab and Wbx'), test.dept('whatsbox'));
update lead_tags set retired_at = now() where label = 'LT Retired';
select test.lt_mk_lead('lt_wab_tm', '+919877100001');
select test.lt_mk_lead('lt_wab_tm', '+919877100002');
select test.lt_mk_lead('lt_wab_tm', '+919877100003');
select test.lt_mk_lead('lt_wab_tm', '+919877100004');
select test.lt_mk_lead('lt_wbx_tm', '+919877100005');
select test.lt_mk_lead('lt_dg_tm', '+919877100006');
select test.lt_mk_lead('lt_wab_tm', '+919877100007', '{"leadStatus":"CONTACTED"}');
select test.lt_mk_lead('lt_wab_tm', '+919877100008');
update customers set lead_tag_id = test.lt_tag('LT C Wab and Wbx') where phone = '+919877100008';
select test.check((select lead_tag_id = test.lt_seed('NEW') and lead_status = 'NEW' from test.lt_lead('+919877100001')), 'create_lead with no tag -> the seed tag of NEW');
select test.check((select lead_tag_id = test.lt_seed('CONTACTED') from test.lt_lead('+919877100007')), 'a lead created with a status gets the seed tag of that stage');

\echo '   status and tag stay in step'
update customers set lead_status = 'INTERESTED' where phone = '+919877100001';
select test.check((select lead_tag_id = test.lt_seed('INTERESTED') from test.lt_lead('+919877100001')), 'writing lead_status sets the seed tag of that stage');
update customers set lead_tag_id = test.lt_tag('Demo done') where phone = '+919877100002';
select test.check((select lead_status = 'INTERESTED' and lead_tag_id = test.lt_tag('Demo done') from test.lt_lead('+919877100002')), 'setting the tag "Demo done" sets lead_status INTERESTED');
update customers set lead_status = 'INTERESTED' where phone = '+919877100002';
select test.check((select lead_tag_id = test.lt_tag('Demo done') from test.lt_lead('+919877100002')), 'writing the status the tag already counts as keeps the tag');
select test.login('lt_wab_tm');
select update_lead((test.lt_lead('+919877100002')).id, '{"leadStatus":"INTERESTED","notes":"still keen"}');
select set_config('request.jwt.claims', '', false);
select test.check((select lead_tag_id = test.lt_tag('Demo done') from test.lt_lead('+919877100002')), 'and so does a lead form that sends the same status');
update customers set lead_status = 'CONTACTED' where phone = '+919877100002';
select test.check((select lead_tag_id = test.lt_seed('CONTACTED') from test.lt_lead('+919877100002')), 'another status replaces the tag with that stage''s seed');
update customers set lead_tag_id = null where phone = '+919877100002';
select test.check((select lead_tag_id = test.lt_seed('CONTACTED') and lead_status = 'CONTACTED' from test.lt_lead('+919877100002')), 'a lead cannot be left without a tag');
update customers set notes = 'touched' where phone = '+919877100001';
select test.check((select lead_tag_id = test.lt_seed('INTERESTED') from test.lt_lead('+919877100001')), 'an unrelated edit leaves the tag alone');

\echo '   department checks'
select test.must_fail($$update customers set lead_tag_id = test.lt_tag('LT Wab only') where phone = '+919877100006'$$,
  'a tag limited to Wabastore cannot be set on a Digitree lead', 'VALIDATION_ERROR: That tag can''t be used in this lead''s department.');
select test.must_fail($$update customers set lead_tag_id = test.lt_tag('LT Retired') where phone = '+919877100006'$$, 'a retired tag cannot be set', 'VALIDATION_ERROR');
update customers set lead_tag_id = test.lt_tag('LT Wab only') where phone = '+919877100003';
select test.check((select lead_status = 'CONTACTED' from test.lt_lead('+919877100003')), 'a Wabastore tag is set on a Wabastore lead');
update customers set owner_id = test.id('lt_dg_tm') where phone = '+919877100003';
select test.check((select department_id = test.dept('digitree') and lead_tag_id = test.lt_seed('CONTACTED') and lead_status = 'CONTACTED' from test.lt_lead('+919877100003')),
  'moving it to a Digitree owner replaces the tag with the seed of the same stage');
update customers set lead_tag_id = test.lt_tag('LT Wab and Wbx') where phone = '+919877100004';
update customers set lead_tag_id = test.lt_tag('LT Wab and Wbx') where phone = '+919877100005';
update customers set lead_tag_id = test.lt_tag('LT Wab only') where phone = '+919877100007';
update customers set owner_id = test.id('lt_wbx_tm') where phone = '+919877100005';
select test.check((select lead_tag_id = test.lt_tag('LT Wab and Wbx') from test.lt_lead('+919877100005')), 'a move to another department the tag covers keeps it');

\echo '   a CEO loses a department'
update customers set lead_tag_id = test.lt_tag('Demo done') where phone = '+919877100001';
delete from operations_head_departments where profile_id = test.id('lt_ceo_a') and department_id = test.dept('wabastore');
select test.check((select array_agg(department_id) = array[test.dept('whatsbox')] from lead_tag_departments where tag_id = test.lt_tag('LT Wab and Wbx')),
  'their tag no longer lists Wabastore');
select test.check(not exists (select 1 from lead_tag_departments where tag_id = test.lt_tag('LT Wab only')), 'nor does their Wabastore-only tag');
select test.check((select lead_tag_id = test.lt_seed('INTERESTED') and lead_status = 'INTERESTED' from test.lt_lead('+919877100004'))
                  and (select lead_tag_id = test.lt_seed('CONTACTED') and lead_status = 'CONTACTED' from test.lt_lead('+919877100007')),
  'its Wabastore leads are re-seeded to the seed of the same stage');
select test.check((select lead_tag_id = test.lt_tag('LT Wab and Wbx') from test.lt_lead('+919877100005')), 'its Whatsbox lead keeps the tag');
select test.check((select lead_tag_id = test.lt_tag('Demo done') from test.lt_lead('+919877100001')), 'a company-wide tag in Wabastore is untouched');
-- only the CEO's own department rows count: the other CEO's home department is Whatsbox, yet without their Whatsbox row it leaves their tag
delete from operations_head_departments where profile_id = test.id('lt_ceo_b') and department_id = test.dept('whatsbox');
select test.check(not exists (select 1 from lead_tag_departments where tag_id = test.lt_tag('LT B Wbx')),
  'the home department does not keep a department on a CEO''s tag');
insert into operations_head_departments (profile_id, department_id, division) values (test.id('lt_ceo_b'), test.dept('whatsbox'), null);
-- the real path: the Super Admin changes a CEO's departments (operations_scope_apply deletes the rows first, then moves the home department)
select test.check((select department_id = test.dept('wabastore') from profiles where id = test.id('lt_ceo_c')), 'a CEO whose home department is Wabastore');
select test.login('sa');
select private.operations_scope_apply(test.id('lt_ceo_c'), array[test.dept('whatsbox')], '{}'::uuid[]);
select set_config('request.jwt.claims', '', false);
select test.check((select department_id = test.dept('whatsbox') from profiles where id = test.id('lt_ceo_c'))
                  and not exists (select 1 from operations_head_departments where profile_id = test.id('lt_ceo_c') and department_id = test.dept('wabastore')),
  'is moved to Whatsbox only');
select test.check((select array_agg(department_id) = array[test.dept('whatsbox')] from lead_tag_departments where tag_id = test.lt_tag('LT C Wab and Wbx')),
  'their tag no longer lists Wabastore');
select test.check((select lead_tag_id = test.lt_seed('INTERESTED') and lead_status = 'INTERESTED' from test.lt_lead('+919877100008')),
  'and its Wabastore lead gets the seed of the same stage');

\echo '   who runs a department'
insert into operations_head_departments (profile_id, department_id, division) values (test.id('lt_ceo_a'), test.dept('wabastore'), null);
select test.login('lt_ceo_a');
select test.check(private.is_ceo_for_sales(test.dept('wabastore')), 'a CEO runs Wabastore (whole department)');
select test.check(not private.is_ceo_for_sales(test.dept('digitree')), 'but not Digitree');
select test.login('lt_ceo_b');
select test.check(private.is_ceo_for_sales(test.dept('digitree')) and private.is_ceo_for_sales(test.dept('whatsbox')), 'the other CEO runs Digitree and Whatsbox');
select test.login('lt_ceo_sup');
select test.check(not private.is_ceo_for_sales(test.dept('whatsbox')), 'a Support-only CEO does not run Whatsbox for leads');
select test.login('sh_head');
select test.check(not private.is_ceo_for_sales(test.dept('wabastore')), 'a plain Department Head is not a CEO');
select set_config('request.jwt.claims', '', false);
select test.check(not private.lead_tag_usable(test.lt_tag('LT Wab only'), test.dept('wabastore')) and private.lead_tag_usable(test.lt_tag('Demo done'), test.dept('digitree'))
                  and private.lead_tag_usable(test.lt_tag('LT Wab and Wbx'), test.dept('whatsbox')) and not private.lead_tag_usable(test.lt_tag('LT Retired'), test.dept('whatsbox')),
  'lead_tag_usable: company-wide or listed, and never retired');

\echo '   the tag tables are not readable directly'
set role authenticated;
select test.login('sh_head');
select test.must_fail($$select * from lead_tags$$, 'lead_tags has no direct grant', 'permission denied');
select test.must_fail($$select * from lead_tag_departments$$, 'nor lead_tag_departments', 'permission denied');
reset role;
select set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------------------
-- Managing tags (lead_tags_list / lead_tag_save / lead_tag_retire / lead_tag_set)
-- ---------------------------------------------------------------------------
create or replace function test.lt_fails_exactly(p_sql text, p_label text, p_message text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm <> p_message then raise exception 'TEST FAILED: % (got: %)', p_label, sqlerrm; end if;
    raise notice 'ok - % [%]', p_label, sqlerrm;
    return;
  end;
  raise exception 'TEST FAILED: % (statement succeeded)', p_label;
end $$;
-- the list as the signed-in person sees it: one tag by label (null when absent)
create or replace function test.lt_listed(p_label text, p_department uuid default null) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.lead_tags_list(p_department)) e where e ->> 'label' = p_label
$$;
grant execute on all functions in schema test to anon, authenticated;
create temp table lt_audit_from as select coalesce(max(created_at), '-infinity') as at from audit_logs;
grant select on lt_audit_from to authenticated;

\echo '   managing tags: a CEO creates a tag for the departments they run'
select test.login('lt_ceo_a');
select test.check((select (r ->> 'scope') = 'DEPARTMENTS' and (r ->> 'stage') = 'INTERESTED' and (r ->> 'colour') = 'red' and (r ->> 'label') = 'Hot'
                          and (r ->> 'canManage')::boolean and not (r ->> 'seed')::boolean and not (r ->> 'retired')::boolean
                     from (select public.lead_tag_save('{"label":"  Hot ","colour":"red","stage":"INTERESTED"}') r) x),
  'a CEO creates "Hot" (the label is trimmed)');
select test.check((select array_agg(department_id order by department_id) = (select array_agg(d order by d) from unnest(array[test.dept('wabastore'), test.dept('whatsbox')]) d)
                     from lead_tag_departments where tag_id = test.lt_tag('Hot')),
  'its departments default to every department the CEO runs (Wabastore and Whatsbox)');
select test.check((select created_by = test.id('lt_ceo_a') and scope = 'DEPARTMENTS' from lead_tags where id = test.lt_tag('Hot')), 'and it is theirs');
select test.lt_fails_exactly(format($$select public.lead_tag_save('{"id":"%s","label":"Hot","colour":"red","stage":"INTERESTED","departmentIds":["%s","%s","%s"]}')$$,
    test.lt_tag('Hot'), test.dept('wabastore'), test.dept('whatsbox'), test.dept('digitree')),
  'the CEO cannot add Digitree, which they do not run', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');
select test.lt_fails_exactly(format($$select public.lead_tag_save('{"label":"LT Elsewhere","colour":"red","stage":"NEW","departmentIds":["%s"]}')$$, test.dept('digitree')),
  'nor create a tag there', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');
select test.lt_fails_exactly($$select public.lead_tag_save('{"label":"LT Company try","colour":"red","stage":"NEW","departmentIds":[]}')$$,
  'a CEO cannot make a company-wide tag', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');
select test.lt_fails_exactly(format($$select public.lead_tag_save('{"id":"%s","label":"Newer","colour":"slate","stage":"NEW"}')$$, test.lt_seed('NEW')),
  'nor rename a company-wide tag', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');
select test.must_fail($$select public.lead_tag_save('{"label":"   ","colour":"red","stage":"NEW"}')$$, 'an empty label is refused', '^VALIDATION_ERROR: ');
select test.must_fail($$select public.lead_tag_save(jsonb_build_object('label', repeat('x', 41), 'colour', 'red', 'stage', 'NEW'))$$, 'a label over 40 characters is refused', '^VALIDATION_ERROR: ');
select test.must_fail($$select public.lead_tag_save('{"label":"LT Pink","colour":"pink","stage":"NEW"}')$$, 'a colour outside the palette is refused', '^VALIDATION_ERROR: ');
select test.must_fail($$select public.lead_tag_save('{"label":"LT Lost","colour":"red","stage":"LOST"}')$$, 'an unknown stage is refused', '^VALIDATION_ERROR: ');
select test.must_fail($$select public.lead_tag_save('{"id":"00000000-0000-0000-0000-000000000000","label":"LT None","colour":"red","stage":"NEW"}')$$, 'an unknown tag', '^NOT_FOUND: ');

\echo '   another CEO sharing one department'
select test.login('lt_ceo_b');
select test.check((select not (test.lt_listed('Hot', test.dept('whatsbox')) ->> 'canManage')::boolean), 'the other CEO sees "Hot" in Whatsbox, not as theirs to manage');
select test.lt_fails_exactly(format($$select public.lead_tag_save('{"id":"%s","label":"Hotter","colour":"red","stage":"INTERESTED"}')$$, test.lt_tag('Hot')),
  'they cannot rename it (it is not all theirs)', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');
select test.lt_fails_exactly(format($$select public.lead_tag_retire('%s', true)$$, test.lt_tag('Hot')),
  'nor retire it', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');
select test.must_fail($$select public.lead_tag_save('{"label":" hot ","colour":"blue","stage":"NEW"}')$$, '" hot " in Whatsbox is a duplicate (case-insensitive)', '^CONFLICT: ');
select test.must_fail($$select public.lead_tag_save('{"label":"interested","colour":"blue","stage":"NEW"}')$$, 'so is the label of a company-wide tag', '^CONFLICT: ');
select test.check((select (r ->> 'label') = 'hot' from (select public.lead_tag_save(format('{"label":"hot","colour":"blue","stage":"NEW","departmentIds":["%s"]}', test.dept('digitree'))::jsonb) r) x),
  'but "hot" only in Digitree, where "Hot" is not visible, is allowed');
select test.check((select count(*) = 1 from lead_tags where label = 'hot' and created_by = test.id('lt_ceo_b')), 'it is saved');

\echo '   nobody else manages tags'
select test.login('tm_a');
select test.lt_fails_exactly($$select public.lead_tag_save('{"label":"LT Mine","colour":"red","stage":"NEW"}')$$,
  'a team member cannot save a tag', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');
select test.lt_fails_exactly(format($$select public.lead_tag_retire('%s', true)$$, test.lt_tag('Demo done')),
  'nor retire one', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');
select test.login('sh_head');
select test.lt_fails_exactly($$select public.lead_tag_save('{"label":"LT Mine","colour":"red","stage":"NEW"}')$$,
  'nor can a plain Department Head', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');
select test.login('lt_ceo_sup');
select test.lt_fails_exactly($$select public.lead_tag_save('{"label":"LT Mine","colour":"red","stage":"NEW"}')$$,
  'nor a Support-only CEO', 'FORBIDDEN: Only the Managing Director or the department''s Operations Head can manage lead tags.');

\echo '   the Managing Director'
select test.login('sa');
select test.lt_fails_exactly(format($$select public.lead_tag_retire('%s', true)$$, test.lt_seed('NEW')),
  'retiring the New seed is refused', 'VALIDATION_ERROR: A stage''s basic tag can''t be retired.');
select test.must_fail(format($$select public.lead_tag_save('{"id":"%s","label":"New","colour":"slate","stage":"CONTACTED"}')$$, test.lt_seed('NEW')),
  'a seed keeps its stage', '^VALIDATION_ERROR: ');
select test.must_fail($$select public.lead_tag_save('{"label":"HOT","colour":"red","stage":"NEW"}')$$, 'a company-wide "HOT" would be a duplicate of "Hot"', '^CONFLICT: ');
select test.check((select (r ->> 'scope') = 'COMPANY' and (r ->> 'departmentIds') = '[]' and (r ->> 'canManage')::boolean
                     from (select public.lead_tag_save('{"label":"LT Company","colour":"green","stage":"READY_TO_BUY"}') r) x),
  'the MD creates a company-wide tag (no departments)');
select test.check((select (r ->> 'scope') = 'DEPARTMENTS' and jsonb_array_length(r -> 'departmentIds') = 1
                     from (select public.lead_tag_save(format('{"label":"LT MD Digitree","colour":"amber","stage":"NEW","departmentIds":["%s"]}', test.dept('digitree'))::jsonb) r) x),
  'and a tag for one department');
select test.check((select (r ->> 'label') = 'Newly met' from (select public.lead_tag_save(format('{"id":"%s","label":"Newly met","colour":"slate","stage":"NEW"}', test.lt_seed('NEW'))::jsonb) r) x),
  'the MD renames a seed');
select public.lead_tag_save(format('{"id":"%s","label":"New","colour":"slate","stage":"NEW"}', test.lt_seed('NEW'))::jsonb);
select test.check((select jsonb_array_length(public.lead_tags_list()) = (select count(*) from lead_tags)), 'the MD lists every tag');

\echo '   tagging a lead (lead_tag_set: the lead''s own rules decide who may)'
reset role;
select set_config('request.jwt.claims', '', false);
select test.lt_mk_lead('lt_wab_tm', '+919877100101');
select test.lt_mk_lead('lt_wbx_tm', '+919877100102');
select test.lt_mk_lead('lt_dg_tm', '+919877100103');
set role authenticated;
select test.login('lt_wab_tm');
select public.lead_tag_set((test.lt_lead('+919877100101')).id, test.lt_tag('Hot'));
select test.check((select lead_tag_id = test.lt_tag('Hot') and lead_status = 'INTERESTED' from test.lt_lead('+919877100101')), 'a Wabastore member tags their lead "Hot"');
reset role;
select set_config('request.jwt.claims', '', false);
create temp table lt_ids as select phone, id from customers where phone in ('+919877100102', '+919877100103');
grant select on lt_ids to authenticated;
set role authenticated;
select test.login('lt_wab_tm');
select test.must_fail(format($$select public.lead_tag_set('%s', '%s')$$, (select id from lt_ids where phone = '+919877100102'), test.lt_tag('Hot')),
  'they cannot tag another member''s lead', '^NOT_FOUND: ');
select test.login('lt_dg_tm');
select test.lt_fails_exactly(format($$select public.lead_tag_set('%s', '%s')$$, (select id from lt_ids where phone = '+919877100103'), test.lt_tag('Hot')),
  'a Digitree lead cannot take a Wabastore / Whatsbox tag', 'VALIDATION_ERROR: That tag can''t be used in this lead''s department.');
select test.login('lt_wbx_tm');
select public.lead_tag_set((select id from lt_ids where phone = '+919877100102'), test.lt_tag('Hot'));
reset role;
select set_config('request.jwt.claims', '', false);
select test.check((select lead_tag_id = test.lt_tag('Hot') from test.lt_lead('+919877100102')), 'a Whatsbox member tags theirs too');

\echo '   a stage change moves the tag''s leads; narrowing re-seeds the leads left outside'
select test.login('lt_ceo_a');
select test.check((test.lt_listed('Hot') ->> 'leadCount')::int = 2, 'the CEO sees 2 leads using "Hot"');
select public.lead_tag_save(format('{"id":"%s","label":"Hot","colour":"orange","stage":"CONTACTED"}', test.lt_tag('Hot'))::jsonb);
select test.check((select count(*) = 2 from customers where phone in ('+919877100101', '+919877100102') and lead_tag_id = test.lt_tag('Hot') and lead_status = 'CONTACTED'),
  'changing "Hot" from INTERESTED to CONTACTED moves its leads'' lead_status (they keep the tag)');
select test.check((select array_length(array_agg(department_id), 1) = 2 from lead_tag_departments where tag_id = test.lt_tag('Hot')), 'saving without departments keeps them');
select public.lead_tag_save(format('{"id":"%s","label":"Hot","colour":"orange","stage":"CONTACTED","departmentIds":["%s"]}', test.lt_tag('Hot'), test.dept('whatsbox'))::jsonb);
select test.check((select lead_tag_id = test.lt_seed('CONTACTED') and lead_status = 'CONTACTED' from test.lt_lead('+919877100101')),
  'narrowing "Hot" to Whatsbox gives its Wabastore lead the seed of the same stage');
select test.check((select lead_tag_id = test.lt_tag('Hot') from test.lt_lead('+919877100102')), 'its Whatsbox lead keeps "Hot"');

\echo '   who sees which tags'
select test.login('lt_wab_tm');
select test.check(test.lt_listed('Hot') is null and test.lt_listed('hot') is null and test.lt_listed('LT MD Digitree') is null,
  'a Wabastore member does not see other departments'' tags');
select test.check(test.lt_listed('Demo done') is not null and test.lt_listed('LT Company') is not null and not (test.lt_listed('Demo done') ->> 'canManage')::boolean,
  'but sees the company-wide tags, read-only');
select test.check(test.lt_listed('Hot', test.dept('whatsbox')) is null, 'and cannot list another department''s tags by asking for it');
select test.login('lt_wbx_tm');
select test.check(test.lt_listed('Hot') is not null and test.lt_listed('hot') is null, 'a Whatsbox member sees "Hot"');
select test.login('lt_ceo_b');
select test.check((test.lt_listed('Hot') ->> 'canManage')::boolean and test.lt_listed('hot') is not null and test.lt_listed('LT MD Digitree') is not null,
  'now that "Hot" is Whatsbox only, the Whatsbox / Digitree CEO may manage it, and sees their Digitree tags');
select test.check(test.lt_listed('hot', test.dept('whatsbox')) is null and test.lt_listed('Hot', test.dept('whatsbox')) is not null, 'a department filter narrows the list');

\echo '   retire and restore'
select test.login('lt_ceo_a');
select public.lead_tag_save('{"label":"LT Cold","colour":"slate","stage":"NEW"}');
select test.check((select (r ->> 'retired')::boolean from (select public.lead_tag_retire(test.lt_tag('LT Cold'), true) r) x), 'a CEO retires their tag');
select test.check((test.lt_listed('LT Cold') ->> 'retired')::boolean, 'it stays in the CEO''s list, marked retired');
select test.login('lt_wab_tm');
select test.check(test.lt_listed('LT Cold') is null, 'a retired tag is absent from the lists of non-managers');
set role authenticated;
select test.must_fail(format($$select public.lead_tag_set('%s', '%s')$$, (select id from public.customers where phone = '+919877100101'), test.lt_tag('LT Cold')),
  'and cannot be chosen', '^VALIDATION_ERROR: ');
reset role;
select test.login('lt_ceo_a');
select public.lead_tag_save('{"label":"lt cold","colour":"blue","stage":"NEW"}');
select test.must_fail(format($$select public.lead_tag_retire('%s', false)$$, test.lt_tag('LT Cold')), 'restoring it while an active "lt cold" exists is a duplicate', '^CONFLICT: ');
select public.lead_tag_retire(test.lt_tag('lt cold'), true);
select test.check((select not (r ->> 'retired')::boolean from (select public.lead_tag_retire(test.lt_tag('LT Cold'), false) r) x), 'then it can be restored');
select test.login('lt_wab_tm');
select test.check(test.lt_listed('LT Cold') is not null, 'and is listed again');
select set_config('request.jwt.claims', '', false);

\echo '   every action is audited'
select test.check((select count(*) = 1 from audit_logs a, lt_audit_from f where a.created_at >= f.at and a.action = 'LEAD_TAG_CREATED' and a.entity_type = 'lead_tag'
                     and a.entity_id = test.lt_tag('Hot') and a.actor_id = test.id('lt_ceo_a')), 'creating "Hot": LEAD_TAG_CREATED');
select test.check((select count(*) = 2 from audit_logs a, lt_audit_from f where a.created_at >= f.at and a.action = 'LEAD_TAG_UPDATED' and a.entity_id = test.lt_tag('Hot')),
  'its stage change and its narrowing: LEAD_TAG_UPDATED');
select test.check((select count(*) = 2 from audit_logs a, lt_audit_from f where a.created_at >= f.at and a.action = 'LEAD_TAG_UPDATED' and a.entity_id = test.lt_seed('NEW')
                     and a.actor_id = test.id('sa')), 'the seed''s rename and its rename back');
select test.check((select count(*) = 1 from audit_logs a, lt_audit_from f where a.created_at >= f.at and a.action = 'LEAD_TAG_RETIRED' and a.entity_id = test.lt_tag('LT Cold')
                     and (a.metadata ->> 'retired')::boolean), 'retiring "LT Cold": LEAD_TAG_RETIRED');
select test.check((select count(*) = 1 from audit_logs a, lt_audit_from f where a.created_at >= f.at and a.action = 'LEAD_TAG_RETIRED' and a.entity_id = test.lt_tag('LT Cold')
                     and not (a.metadata ->> 'retired')::boolean), 'restoring it is recorded too');
select test.check(not exists (select 1 from audit_logs a, lt_audit_from f where a.created_at >= f.at and a.action like 'LEAD_TAG_%' and a.entity_id = test.lt_seed('READY_TO_BUY')),
  'refused attempts change nothing and record nothing');

\echo '   the functions are not open to anonymous callers'
select test.check(not has_function_privilege('anon', 'public.lead_tags_list(uuid)', 'execute') and not has_function_privilege('anon', 'public.lead_tag_save(jsonb)', 'execute')
                  and not has_function_privilege('anon', 'public.lead_tag_retire(uuid, boolean)', 'execute') and not has_function_privilege('anon', 'public.lead_tag_set(uuid, uuid)', 'execute'),
  'anon cannot run them');

delete from customers where phone like '+9198771%';
delete from lead_tag_departments where tag_id in (select id from lead_tags where label like 'LT %' or created_by in (select id from test.users where name like 'lt\_%'));
delete from lead_tags where label like 'LT %' or created_by in (select id from test.users where name like 'lt\_%');
delete from operations_head_departments where profile_id in (test.id('lt_ceo_a'), test.id('lt_ceo_b'), test.id('lt_ceo_sup'), test.id('lt_ceo_c'));
