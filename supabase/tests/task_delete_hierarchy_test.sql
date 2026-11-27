-- =============================================================================
-- Deleting an assigned task by team and department (migration 20270225000100).
--   Team Lead: their own team members' tasks, whoever gave them. Department Head: their department's tasks, whoever gave them.
--   Super Admin: AI Studio tasks only (as the Department Head of AI Studio). Operations Heads and every other role: unchanged.
-- Reuses the people of earlier suites: Wabastore dh_wab, th_wab -> tm_a / tc_a / ba_a (Sales), sup_th -> sup_b (Support), the Sales Operations Head
-- fvt_sops; Whatsbox dh_wbx, th_wbx; Accounts dh_acc / acc_m; HR hr_head; AI Studio ai_dh, ai_tl1 -> ai_tm1a, ai_tl2 -> ai_tm2a; AI Design Studio
-- ads_dh, ads_l1 -> ads_m1, ads_l2. Own tasks, project and client (titles start with "TDH"); removed at the end.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 200. Deleting assigned tasks by team and department (Team Lead / Department Head / Super Admin for AI Studio)'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites run the older copy again: the base and this migration, this one last and twice (it must be safe to run twice)
\i supabase/migrations/20270220000100_task_deletion.sql
\i supabase/migrations/20270225000100_task_delete_hierarchy.sql
\i supabase/migrations/20270225000100_task_delete_hierarchy.sql

delete from notifications where title like 'TDH %' or title like '%: TDH %';
delete from work_tasks where title like 'TDH %';
delete from ai_studio_tasks where title like 'TDH %';
delete from ai_studio_projects where name like 'TDH %';
delete from ads_assignments where title like 'TDH %';
delete from ads_clients where client_name like 'TDH %';

create temp table tdh (k text primary key, v uuid);
grant all on tdh to authenticated;
create or replace function pg_temp.v(p_k text) returns uuid language sql stable as $$ select v from tdh where k = p_k $$;
-- a Task module task in a department (its team: the assignee's)
create or replace function pg_temp.wt(p_k text, p_title text, p_by text, p_to text) returns void language sql as $$
  with x as (
    insert into public.work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date)
    select coalesce(p.department_id, (select department_id from public.teams where id = p.team_id)), p.team_id, p_title, test.id(p_by), p.id, current_date + 3
      from public.profiles p where p.id = test.id(p_to)
    returning id)
  insert into tdh select p_k, id from x
$$;
create or replace function pg_temp.can(p_k text) returns boolean language sql as $$ select (public.work_task_delete_preview(pg_temp.v(p_k)) ->> 'canDelete')::boolean $$;
create or replace function pg_temp.del(p_k text) returns boolean language sql as $$ select (public.work_task_delete(pg_temp.v(p_k)) ->> 'deleted')::boolean $$;
create or replace function pg_temp.listed(p_k text) returns boolean language sql as $$ select pg_temp.v(p_k) = any (public.work_tasks_deletable(array(select v from tdh))) $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Task module: the Team Lead
-- ---------------------------------------------------------------------------
select pg_temp.wt('L_self', 'TDH lead to own member', 'th_wab', 'tm_a');
select pg_temp.wt('L_dh', 'TDH head to lead member', 'dh_wab', 'tm_a');
select pg_temp.wt('L_otl', 'TDH other lead to my member', 'sup_th', 'tc_a');
select pg_temp.wt('L_ops', 'TDH ops head to my member', 'fvt_sops', 'ba_a');
select pg_temp.wt('L_sa', 'TDH super admin to my member', 'sa', 'tm_a');
select pg_temp.wt('L_other_team', 'TDH other team member', 'sup_th', 'sup_b');
select pg_temp.wt('L_other_dept', 'TDH other department', 'dh_wbx', 'th_wbx');
select pg_temp.wt('L_to_lead', 'TDH given to the lead', 'dh_wab', 'th_wab');
select pg_temp.wt('L_unrelated', 'TDH unrelated employee', 'dh_acc', 'acc_m');
select pg_temp.wt('L_other_lead', 'TDH another lead', 'dh_wab', 'sup_th');

\echo '   01 a Team Lead deletes any task of their own team members, whoever gave it'
set role authenticated;
select test.login('th_wab');
select test.check(pg_temp.can('L_self') and pg_temp.can('L_dh') and pg_temp.can('L_otl') and pg_temp.can('L_ops') and pg_temp.can('L_sa'),
  'the Delete option: tasks given by themselves, their Department Head, another Team Lead, an Operations Head and the Super Admin');
select test.check(pg_temp.listed('L_self') and pg_temp.listed('L_dh') and pg_temp.listed('L_otl') and pg_temp.listed('L_ops') and pg_temp.listed('L_sa'),
  'the card list (one call for every card) says the same');
select test.check(not pg_temp.listed('L_other_team') and not pg_temp.listed('L_other_dept') and not pg_temp.listed('L_to_lead') and not pg_temp.listed('L_unrelated')
                  and not pg_temp.listed('L_other_lead'), '... and no card of another team, department or person, nor their own task');
select test.check(pg_temp.del('L_self'), 'deletes a task they gave their member');
select test.check(pg_temp.del('L_dh'), 'deletes a task the Department Head gave their member');
select test.check(pg_temp.del('L_otl'), 'deletes a task another Team Lead gave their member');
select test.check(pg_temp.del('L_ops') and pg_temp.del('L_sa'), 'deletes tasks other authorised people gave their members');

\echo '   02 ... and nothing outside their team'
select test.must_fail($$select pg_temp.del('L_other_team')$$, 'not a task of another Team Lead''s team', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select pg_temp.del('L_other_dept')$$, 'not a task of another department', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select pg_temp.del('L_unrelated')$$, 'not a task of an unrelated employee', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select pg_temp.del('L_other_lead')$$, 'not a task of another Team Lead', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select pg_temp.del('L_to_lead')$$, 'not a task assigned to themselves', 'FORBIDDEN: You cannot delete a task that was assigned to you');
select test.login('sup_th');
select test.must_fail($$select work_task_delete(pg_temp.v('L_to_lead'))$$, 'the other Team Lead of the department cannot delete the first Team Lead''s task', 'NOT_FOUND|FORBIDDEN');
select test.check(pg_temp.del('L_other_team'), 'but deletes their own member''s task');
reset role;
select test.check(not exists (select 1 from work_tasks where id in (pg_temp.v('L_self'), pg_temp.v('L_dh'), pg_temp.v('L_otl'), pg_temp.v('L_ops'), pg_temp.v('L_sa'), pg_temp.v('L_other_team')))
                  and (select count(*) = 4 from work_tasks where id in (pg_temp.v('L_other_dept'), pg_temp.v('L_to_lead'), pg_temp.v('L_unrelated'), pg_temp.v('L_other_lead'))),
  'exactly the allowed tasks are gone');
select test.check((select count(*) = 1 from audit_logs where action = 'TASK_DELETED' and entity_id = pg_temp.v('L_dh') and actor_id = test.id('th_wab'))
                  and (select count(*) = 1 from notifications where recipient_id = test.id('dh_wab') and type = 'TASK_DELETED' and title = 'Task deleted: TDH head to lead member'),
  'the existing audit entry and notifications (the Department Head who gave it is told)');

-- ---------------------------------------------------------------------------
-- 2. Task module: the Department Head
-- ---------------------------------------------------------------------------
-- dh_wab heads Wabastore's Support side (set by an earlier suite): their authorised scope is that department and function
select pg_temp.wt('D_lead', 'TDH dept head lead task', 'dh_wab', 'sup_th');
select pg_temp.wt('D_member', 'TDH dept lead member task', 'sup_th', 'sup_b');
select pg_temp.wt('D_sa', 'TDH dept super admin task', 'sa', 'sup_b');
select pg_temp.wt('D_ops', 'TDH dept ops head task', 'fvt_supops', 'sup_th');
select pg_temp.wt('D_sales', 'TDH dept sales side', 'th_wab', 'tm_a');
select pg_temp.wt('D_other', 'TDH dept other department', 'dh_wbx', 'th_wbx');
select pg_temp.wt('D_acc', 'TDH dept accounts', 'dh_acc', 'acc_m');

\echo '   03 a Department Head deletes any task of their department (and function), whoever gave it'
set role authenticated;
select test.login('dh_wab');
select test.check(pg_temp.listed('D_lead') and pg_temp.listed('D_member') and pg_temp.listed('D_sa') and pg_temp.listed('D_ops'),
  'the Delete option on their Team Lead''s and members'' tasks, given by themselves, a Team Lead, the Super Admin or an Operations Head');
select test.check(not pg_temp.listed('D_other') and not pg_temp.listed('D_acc'), '... and none of another department');
select test.check(not pg_temp.listed('D_sales'), '... nor of the other function of the department, which they do not head (their authorised scope)');
select test.check(pg_temp.del('D_lead') and pg_temp.del('D_member'), 'deletes their Team Lead''s and a member''s task');
select test.check(pg_temp.del('D_sa'), 'deletes a task the Super Admin gave in their department');
select test.check(pg_temp.del('D_ops'), 'deletes a task an Operations Head gave in their department');
select test.must_fail($$select pg_temp.del('D_other')$$, 'cannot delete a task of another department', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select pg_temp.del('D_acc')$$, 'nor of Accounts', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select pg_temp.del('D_sales')$$, 'nor outside their function', 'NOT_FOUND|FORBIDDEN');
select test.login('dh_wbx');
select test.must_fail($$select pg_temp.del('D_acc')$$, 'another Department Head cannot delete Accounts tasks either', 'NOT_FOUND|FORBIDDEN');
select test.login('dh_acc');
select test.check(pg_temp.listed('D_acc') and pg_temp.del('D_acc'), 'the Accounts Department Head deletes the Accounts task (the same rule in every department)');
reset role;
select test.check((select count(*) = 2 from work_tasks where id in (pg_temp.v('D_other'), pg_temp.v('D_sales'))), 'the tasks outside their scope stay');

\echo '   04 an Operations Head keeps the earlier rule (not a task the Super Admin gave)'
select pg_temp.wt('O_sa', 'TDH ops sa task', 'sa', 'tm_a');
select pg_temp.wt('O_lead', 'TDH ops lead task', 'th_wab', 'tm_a');
set role authenticated;
select test.login('fvt_sops');
select test.must_fail($$select pg_temp.del('O_sa')$$, 'an Operations Head still cannot delete a task the Super Admin gave', 'NOT_FOUND|FORBIDDEN');
select test.check(pg_temp.del('O_lead'), 'and still deletes a Team Lead''s task in their function');

\echo '   05 Team Members and the other roles still delete nothing'
select test.login('tm_a');
select test.check(not pg_temp.listed('O_sa') and work_tasks_deletable(array[pg_temp.v('O_sa')]) = '{}', 'a Team Member gets no Delete option on any card');
select test.must_fail($$select pg_temp.del('O_sa')$$, 'and a direct call is refused', 'FORBIDDEN');
select test.login('tc_a');
select test.must_fail($$select pg_temp.del('O_sa')$$, 'a Telecaller is refused', 'NOT_FOUND|FORBIDDEN');
select test.login('ba_a');
select test.must_fail($$select pg_temp.del('O_sa')$$, 'a Business Associate is refused', 'NOT_FOUND|FORBIDDEN');
select test.login('acc_m');
select test.must_fail($$select pg_temp.del('D_sales')$$, 'an Accounts employee is refused', 'NOT_FOUND|FORBIDDEN');
select test.login('th_wab');
select test.must_fail($$select work_tasks_deletable(array_fill(gen_random_uuid(), array[1001]))$$, 'the card check takes at most 1000 tasks', 'VALIDATION_ERROR');

-- ---------------------------------------------------------------------------
-- 3. Task module: the Super Admin, as the Department Head of AI Studio only
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.wt('S_ai_lead', 'TDH sa ai lead', 'ai_dh', 'ai_tl1');
select pg_temp.wt('S_ai_member', 'TDH sa ai member', 'ai_tl1', 'ai_tm1a');
select pg_temp.wt('S_ai_dh', 'TDH sa ai by head', 'ai_dh', 'ai_tm2a');
select pg_temp.wt('S_sales', 'TDH sa sales', 'th_wab', 'tm_a');
select pg_temp.wt('S_support', 'TDH sa support', 'sup_th', 'sup_b');
select pg_temp.wt('S_acc', 'TDH sa accounts', 'dh_acc', 'acc_m');
select pg_temp.wt('S_ads', 'TDH sa design studio', 'ads_dh', 'ads_m1');
insert into work_tasks (department_id, title, assigned_by, assignee_id, due_date) values (test.dept('hr'), 'TDH sa hr', test.id('sa'), test.id('hr_head'), current_date + 3);
insert into tdh select 'S_hr', id from work_tasks where title = 'TDH sa hr';

\echo '   06 the Super Admin deletes AI Studio tasks and nothing else'
set role authenticated;
select test.login('sa');
select test.check(pg_temp.listed('S_ai_lead') and pg_temp.listed('S_ai_member') and pg_temp.listed('S_ai_dh'), 'the Delete option on AI Studio tasks: a Team Lead''s, a member''s, given by anyone');
select test.check(not pg_temp.listed('S_sales') and not pg_temp.listed('S_support') and not pg_temp.listed('S_acc') and not pg_temp.listed('S_ads') and not pg_temp.listed('S_hr'),
  'none on Sales, Support, Accounts, AI Design Studio or HR tasks');
select test.check((select p ->> 'reason' like 'The Super Admin deletes only AI Studio tasks%' from work_task_delete_preview(pg_temp.v('S_sales')) p), 'and the reason says why');
select test.check(pg_temp.del('S_ai_lead') and pg_temp.del('S_ai_member') and pg_temp.del('S_ai_dh'), 'deletes an AI Studio Team Lead''s and members'' tasks, whoever gave them');
select test.must_fail($$select pg_temp.del('S_sales')$$, 'cannot delete a Sales task', 'FORBIDDEN: The Super Admin deletes only AI Studio tasks');
select test.must_fail($$select pg_temp.del('S_support')$$, 'nor a Support task', 'FORBIDDEN');
select test.must_fail($$select pg_temp.del('S_acc')$$, 'nor an Accounts task', 'FORBIDDEN');
select test.must_fail($$select pg_temp.del('S_ads')$$, 'nor an AI Design Studio task (a separate department)', 'FORBIDDEN');
select test.must_fail($$select pg_temp.del('S_hr')$$, 'nor an HR task, not even one they gave', 'FORBIDDEN');
reset role;
select test.check((select count(*) = 5 from work_tasks where id in (pg_temp.v('S_sales'), pg_temp.v('S_support'), pg_temp.v('S_acc'), pg_temp.v('S_ads'), pg_temp.v('S_hr'))),
  'every task outside AI Studio stays');
select test.check((select count(*) = 3 from audit_logs where action = 'TASK_DELETED' and actor_id = test.id('sa') and entity_id in (pg_temp.v('S_ai_lead'), pg_temp.v('S_ai_member'), pg_temp.v('S_ai_dh'))),
  'each of the Super Admin''s deletes is audited');

-- ---------------------------------------------------------------------------
-- 4. AI Studio project tasks
-- ---------------------------------------------------------------------------
insert into ai_studio_projects (name) values ('TDH Project');
insert into ai_studio_project_members (project_id, profile_id)
select p.id, u.id from ai_studio_projects p, test.users u where p.name = 'TDH Project' and u.name in ('ai_tl1', 'ai_tl2', 'ai_tm1a', 'ai_tm2a');
create or replace function pg_temp.at(p_k text, p_title text, p_by text, p_to text, p_type text default 'STANDARD') returns void language sql as $$
  with x as (
    insert into public.ai_studio_tasks (project_id, title, assigned_by, assignee_id, assignment_type)
    select id, p_title, test.id(p_by), test.id(p_to), p_type from public.ai_studio_projects where name = 'TDH Project'
    returning id)
  insert into tdh select p_k, id from x
$$;
create or replace function pg_temp.page_can(p_k text) returns boolean language sql as $$
  select (x ->> 'canDelete')::boolean from jsonb_array_elements(public.ai_studio_tasks_page('team', null, null, null, 1, 100, null) -> 'items') x where (x ->> 'id')::uuid = pg_temp.v(p_k) $$;
grant execute on all functions in schema pg_temp to authenticated;
select pg_temp.at('A_own', 'TDH ai lead own', 'ai_tl1', 'ai_tm1a');
select pg_temp.at('A_dh', 'TDH ai head to member', 'ai_dh', 'ai_tm1a');
select pg_temp.at('A_cross', 'TDH ai cross team in', 'ai_tl2', 'ai_tm1a', 'CROSS_TEAM');
select pg_temp.at('A_md', 'TDH ai md to member', 'sa', 'ai_tm1a');
select pg_temp.at('A_other', 'TDH ai other team', 'ai_tl2', 'ai_tm2a');
select pg_temp.at('A_lead', 'TDH ai head to lead', 'ai_dh', 'ai_tl1');
select pg_temp.at('A_md2', 'TDH ai md to lead', 'sa', 'ai_tl2');
select pg_temp.at('A_md3', 'TDH ai md to member two', 'sa', 'ai_tm2a');

\echo '   07 AI Studio: the Team Lead (their members, whoever gave it), with canDelete on the list'
set role authenticated;
select test.login('ai_tl1');
select test.check(pg_temp.page_can('A_own') and pg_temp.page_can('A_dh') and pg_temp.page_can('A_cross') and pg_temp.page_can('A_md'),
  'the Team Tasks list marks their members'' tasks deletable: given by themselves, the Department Head, another Team Lead (cross-team), the Managing Director');
select test.check(not pg_temp.page_can('A_lead'), '... but not a task given to them');
select test.check((ai_studio_task_delete(pg_temp.v('A_dh')) ->> 'deleted')::boolean and (ai_studio_task_delete(pg_temp.v('A_cross')) ->> 'deleted')::boolean
                  and (ai_studio_task_delete(pg_temp.v('A_md')) ->> 'deleted')::boolean, 'deletes them');
select test.must_fail($$select ai_studio_task_delete(pg_temp.v('A_other'))$$, 'not another team''s task', 'NOT_FOUND|FORBIDDEN');
select test.login('ai_tl2');
select test.must_fail($$select ai_studio_task_delete(pg_temp.v('A_own'))$$, 'the other Team Lead cannot delete the first team''s task', 'NOT_FOUND|FORBIDDEN');
select test.login('th_wab');
select test.must_fail($$select ai_studio_task_delete(pg_temp.v('A_own'))$$, 'a Team Lead of another department cannot', 'FORBIDDEN');

\echo '   08 AI Studio: the Department Head (any task, whoever gave it)'
select test.login('ai_dh');
select test.check(pg_temp.page_can('A_md2'), 'the Department Head sees the Delete option on a task the Managing Director gave');
select test.check((ai_studio_task_delete(pg_temp.v('A_md2')) ->> 'deleted')::boolean, '... and deletes it');

\echo '   09 AI Studio: the Managing Director as its Department Head'
select test.login('sa');
select test.check(pg_temp.page_can('A_own') and pg_temp.page_can('A_lead') and pg_temp.page_can('A_other'), 'the Delete option on Team Leads'' and members'' AI Studio tasks');
select test.check((ai_studio_task_get(pg_temp.v('A_own')) ->> 'canDelete')::boolean, 'and in the task''s own dialog');
select test.check((ai_studio_task_delete(pg_temp.v('A_own')) ->> 'deleted')::boolean, 'deletes a member''s task a Team Lead gave');
select test.check((ai_studio_task_delete(pg_temp.v('A_lead')) ->> 'deleted')::boolean, 'deletes a Team Lead''s task the Department Head gave');
select test.check((ai_studio_task_delete(pg_temp.v('A_md3')) ->> 'deleted')::boolean, 'deletes a task they gave');
select test.login('ai_tm2a');
select test.check(not (ai_studio_task_get(pg_temp.v('A_other')) ->> 'canDelete')::boolean, 'an AI Studio Team Member still has no Delete option');
select test.must_fail($$select ai_studio_task_delete(pg_temp.v('A_other'))$$, '... and is refused', 'FORBIDDEN');
reset role;
select test.check((select count(*) = 1 from ai_studio_tasks where title like 'TDH %') and exists (select 1 from ai_studio_tasks where id = pg_temp.v('A_other')),
  'only the task nobody allowed deleted stays');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ai_tl1') and type = 'AI_STUDIO_TASK_DELETED' and title = 'Task deleted: TDH ai lead own'),
  'the Team Lead who gave a task the Managing Director deleted is told (existing notifications)');

-- ---------------------------------------------------------------------------
-- 5. AI Design Studio assignments
-- ---------------------------------------------------------------------------
insert into ads_clients (department_id, client_name, created_by) values (test.dept('ai-design-studio'), 'TDH Client', test.id('ads_dh'));
create or replace function pg_temp.ad(p_k text, p_title text, p_by text, p_to text) returns void language sql as $$
  with x as (
    insert into public.ads_assignments (department_id, client_id, title, assigned_by, assignee_id)
    select test.dept('ai-design-studio'), c.id, p_title, test.id(p_by), test.id(p_to) from public.ads_clients c where c.client_name = 'TDH Client'
    returning id)
  insert into tdh select p_k, id from x
$$;
create or replace function pg_temp.ads_can(p_k text) returns boolean language sql as $$
  select (x ->> 'canDelete')::boolean from jsonb_array_elements(public.ads_assignments_list('all', null, null)) x where (x ->> 'id')::uuid = pg_temp.v(p_k) $$;
grant execute on all functions in schema pg_temp to authenticated;
select pg_temp.ad('X_dh', 'TDH ads head to member', 'ads_dh', 'ads_m1');
select pg_temp.ad('X_l2', 'TDH ads other lead to member', 'ads_l2', 'ads_m1');
select pg_temp.ad('X_lead', 'TDH ads head to lead', 'ads_dh', 'ads_l2');

\echo '   10 AI Design Studio: the Team Lead and the Department Head; not the Super Admin'
set role authenticated;
select test.login('ads_l1');
select test.check(pg_temp.ads_can('X_dh') and pg_temp.ads_can('X_l2'), 'the Team Lead''s list marks their member''s work deletable, whoever gave it');
select test.check((ads_assignment_delete(pg_temp.v('X_dh')) ->> 'deleted')::boolean, 'deletes work the Department Head gave their member');
select test.must_fail($$select ads_assignment_delete(pg_temp.v('X_lead'))$$, 'not work of another Team Lead', 'NOT_FOUND|FORBIDDEN');
select test.login('ads_dh');
select test.check(pg_temp.ads_can('X_l2') and pg_temp.ads_can('X_lead'), 'the Department Head''s list marks the department''s work deletable');
select test.check((ads_assignment_delete(pg_temp.v('X_l2')) ->> 'deleted')::boolean, 'deletes work another Team Lead gave');
select test.login('sa');
select test.must_fail($$select ads_assignment_delete(pg_temp.v('X_lead'))$$, 'the Super Admin gets nothing in AI Design Studio', 'FORBIDDEN');
reset role;
select test.check(exists (select 1 from ads_assignments where id = pg_temp.v('X_lead')), 'the work nobody allowed deleted stays');

\echo '   cleanup'
reset role;
select set_config('request.jwt.claims', '', false);
delete from notifications where title like 'TDH %' or title like '%: TDH %';
delete from work_tasks where title like 'TDH %';
delete from ai_studio_tasks where title like 'TDH %';
delete from ai_studio_projects where name like 'TDH %';
delete from ads_assignments where title like 'TDH %';
delete from ads_clients where client_name like 'TDH %';
\echo '=== TASK DELETION BY TEAM AND DEPARTMENT TESTS PASSED ==='
