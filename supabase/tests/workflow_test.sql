-- =============================================================================
-- Company workflow (migration 20261112000100). Runs after the other suites on the same database and re-uses their users.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 56. Company workflow: the Super Admin only, and every node and hand-off is a real record'

reset role;
set role authenticated;
select test.login('sa');
create temp table cwf as select company_workflow() as j;
grant all on cwf to authenticated;

select test.admin_check($q$select jsonb_array_length(j -> 'departments') = (select count(*) from departments) from cwf$q$, 'every department is in the diagram, none twice');
select test.admin_check($q$select jsonb_array_length(j -> 'teams') = (select count(*) from teams) from cwf$q$, 'every team (sub-department) is in the diagram');
select test.admin_check($q$select jsonb_array_length(j -> 'people') = (select count(*) from profiles where status = 'ACTIVE' and role in ('TEAM_HEAD', 'TEAM_MEMBER') and team_id is not null) from cwf$q$, 'every active lead and member is listed once');
select test.admin_check($q$select jsonb_array_length(j -> 'heads') = (select count(*) from profiles where status = 'ACTIVE' and role = 'DEPARTMENT_HEAD' and department_id is not null) from cwf$q$, 'every Department Head is listed once');
select test.admin_check($q$select not exists (select 1 from cwf, jsonb_array_elements(j -> 'departments') d where not exists (select 1 from departments x where x.id = (d ->> 'id')::uuid and x.name = d ->> 'name'))
                           from (select 1) y$q$, 'department names come from the table');

-- every hand-off ends on a real node, and a key is never repeated
select test.admin_check($q$select not exists (
    select 1 from cwf, jsonb_array_elements(j -> 'handoffs') h, unnest(array['from', 'to']) e
     where not case h -> e ->> 'kind'
        when 'team' then exists (select 1 from teams t where t.id = (h -> e ->> 'id')::uuid)
        when 'consultants' then exists (select 1 from teams t where t.id = (h -> e ->> 'id')::uuid and t.division = 'SUPPORT'
                                         and exists (select 1 from profiles p where p.team_id = t.id and p.is_technical_consultant))
        when 'head' then exists (select 1 from departments d where d.id = (h -> e ->> 'id')::uuid)
        when 'department' then exists (select 1 from departments d where d.id = (h -> e ->> 'id')::uuid)
        else false end) from (select 1) y$q$, 'no hand-off points at a missing department, team or consultant group');
select test.admin_check($q$select (select count(*) from cwf, jsonb_array_elements(j -> 'handoffs') h)
                             = (select count(distinct h ->> 'key') from cwf, jsonb_array_elements(j -> 'handoffs') h) from (select 1) y$q$, 'no hand-off appears twice');

-- the numbers on the arrows are the real records
select test.admin_check($q$select coalesce((select sum((h ->> 'count')::bigint) from cwf, jsonb_array_elements(j -> 'handoffs') h where h ->> 'key' like 'to-accounts:%'), 0)
                             = (select count(*) from payment_requests pr join customers c on c.id = pr.customer_id join teams t on t.id = c.team_id
                                 where pr.status = 'PENDING' and t.division in ('SALES', 'SUPPORT')) from (select 1) y$q$, 'Send to Accounts shows the requests really waiting for Accounts');
select test.admin_check($q$select coalesce((select sum((h ->> 'count')::bigint) from cwf, jsonb_array_elements(j -> 'handoffs') h where h ->> 'key' like 'from-accounts:%'), 0)
                             = (select count(*) from customers c join teams t on t.id = c.team_id where c.payment_workflow = 'PAYMENT_CONFIRMED' and t.division in ('SALES', 'SUPPORT')) from (select 1) y$q$,
  'Confirm payment and return shows the customers whose payment Accounts confirmed');
select test.admin_check($q$select coalesce((select sum((h ->> 'count')::bigint) from cwf, jsonb_array_elements(j -> 'handoffs') h where h ->> 'key' like 'head-to-lead:%'), 0)
                             = (select count(*) from customer_onboarding o join profiles p on p.id = o.team_lead_id where p.team_id is not null) from (select 1) y$q$, 'Pass to Team Lead shows the customers really passed to a lead');

-- no sensitive field leaves the function
select test.admin_check($q$select j::text !~* '(password|token|secret|"email"|"phone"|authorization)' from cwf$q$, 'no e-mail, phone, password or token is returned');

-- it is live: a new department, team and consultant appear on the next read, and an empty department invents no hand-off
reset role;
insert into departments (slug, name, description) values ('wf-new-dept', 'Workflow Test Department', '');
insert into teams (department_id, name, division) select id, 'Support', 'SUPPORT' from departments where slug = 'wf-new-dept';
insert into teams (department_id, name, division) select id, 'Sales', 'SALES' from departments where slug = 'wf-new-dept';
set role authenticated;
select test.login('sa');
select test.check((select exists (select 1 from jsonb_array_elements(company_workflow() -> 'departments') d where d ->> 'slug' = 'wf-new-dept')
                          and (select count(*) = 2 from jsonb_array_elements(company_workflow() -> 'teams') t where (t ->> 'departmentId')::uuid = test.dept('wf-new-dept'))), 'a new department and its teams appear without any change to the diagram');
select test.check((select not exists (select 1 from jsonb_array_elements(company_workflow() -> 'handoffs') h
                                       where h -> 'from' ->> 'kind' = 'consultants' and (h -> 'from' ->> 'id')::uuid in (select id from teams where department_id = test.dept('wf-new-dept')))
                          and not exists (select 1 from jsonb_array_elements(company_workflow() -> 'handoffs') h
                                           where h ->> 'key' like 'to-consultant:%' and h ->> 'key' like '%' || (select id::text from teams where department_id = test.dept('wf-new-dept') and division = 'SUPPORT'))),
  'a department with no Technical Consultant gets no consultant hand-off');
select test.check((select exists (select 1 from jsonb_array_elements(company_workflow() -> 'handoffs') h where h ->> 'key' like 'to-accounts:%' and (h -> 'from' ->> 'id')::uuid in (select id from teams where department_id = test.dept('wf-new-dept')))),
  'but its Sales team still gets the Send to Accounts hand-off, from the same rule as every other department');
reset role;
delete from teams where department_id = (select id from departments where slug = 'wf-new-dept');
delete from departments where slug = 'wf-new-dept';

-- who may read it
set role authenticated;
select test.login('dh_wab');
select test.must_fail($$select company_workflow()$$, 'a Department Head cannot read the company workflow', 'Super Admin');
select test.login('th_wab');
select test.must_fail($$select company_workflow()$$, 'nor a Team Lead', 'Super Admin');
select test.login('tm_a');
select test.must_fail($$select company_workflow()$$, 'nor a Team Member', 'Super Admin');
select test.login('acc_m');
select test.must_fail($$select company_workflow()$$, 'nor Accounts staff', 'Super Admin');
reset role;
set role anon;
select test.must_fail($$select company_workflow()$$, 'a signed-out visitor cannot read it', 'permission denied');
reset role;
