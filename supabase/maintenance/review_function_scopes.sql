-- =============================================================================
-- READ-ONLY review of department x function scopes (migration 20261224000100), for an administrator-reviewed correction of existing accounts.
-- Nothing here changes data. Replace the e-mail placeholders, run the blocks, and make the change in the app as the Super Admin
-- (each change there is checked by the database and written to the audit log):
--   * Support-only Operations Head: Team Member Management > Operations Heads > Edit departments > Operations function: Support Operations Head
--   * a second department for a Department Head: Team Member Management > Access Control > choose the head > tick e.g. "Wabatalk - Support" > Save
-- No authorization function refers to a person by name, e-mail or id; this file is only for looking.
-- =============================================================================

-- 1. One person: role, home department and side, and every scope the database gives them now (department + function)
--    Replace OPERATIONS_HEAD_EMAIL (for example the Support Operations Head) and run.
select p.full_name, p.role, p.is_operations_head, p.head_division as function_or_side, p.status,
       (select d.name from public.departments d where d.id = p.department_id) as home_department
  from public.profiles p where lower(p.email) = lower('OPERATIONS_HEAD_EMAIL');
select d.name as department, coalesce(s.division, 'SALES + SUPPORT (whole department)') as reaches
  from private.scopes_of((select id from public.profiles where lower(email) = lower('OPERATIONS_HEAD_EMAIL'))) s
  join public.departments d on d.id = s.department_id order by d.name;
-- where each scope comes from: supervised departments (and a narrower side, if set), older department/function grants
select 'supervised' as source, d.name as department, coalesce(o.division, '(the person''s function)') as side
  from public.operations_head_departments o join public.departments d on d.id = o.department_id
 where o.profile_id = (select id from public.profiles where lower(email) = lower('OPERATIONS_HEAD_EMAIL'))
union all
select 'older grant', d.name, a.division
  from public.department_access a join public.departments d on d.id = a.department_id
 where a.profile_id = (select id from public.profiles where lower(email) = lower('OPERATIONS_HEAD_EMAIL'))
 order by 1, 2;
-- the approvals this person is accountable for (department level, and per side)
select 'department' as level, d.name as department, null::text as side from public.department_operations_owner o join public.departments d on d.id = o.department_id
 where o.operations_head_id = (select id from public.profiles where lower(email) = lower('OPERATIONS_HEAD_EMAIL'))
union all
select 'side', d.name, o.division from public.department_function_owner o join public.departments d on d.id = o.department_id
 where o.operations_head_id = (select id from public.profiles where lower(email) = lower('OPERATIONS_HEAD_EMAIL'));

-- 2. A Department Head who should also head one function of another department (for example D Talk's Support = Wabatalk).
--    Replace DEPARTMENT_HEAD_EMAIL and TARGET_DEPARTMENT_SLUG (for example 'wabatalk'), and TARGET_FUNCTION ('SUPPORT' or 'SALES').
select p.full_name, p.role, p.is_operations_head, p.head_division as side, (select d.name from public.departments d where d.id = p.department_id) as home_department
  from public.profiles p where lower(p.email) = lower('DEPARTMENT_HEAD_EMAIL');
select d.name as department, coalesce(s.division, 'SALES + SUPPORT (whole department)') as reaches
  from private.scopes_of((select id from public.profiles where lower(email) = lower('DEPARTMENT_HEAD_EMAIL'))) s
  join public.departments d on d.id = s.department_id order by d.name;
-- is somebody already the head of that department and function? (if a name comes back, saving the grant is refused: decide first)
select h.full_name as current_head, h.status, (select d.name from public.departments d where d.id = h.department_id) as their_home
  from private.department_function_holder(
         (select id from public.departments where slug = 'TARGET_DEPARTMENT_SLUG'),
         coalesce((select facet_division from public.departments where slug = 'TARGET_DEPARTMENT_SLUG'), 'TARGET_FUNCTION'),
         (select id from public.profiles where lower(email) = lower('DEPARTMENT_HEAD_EMAIL'))) h
 where h.id is not null;

-- 3. Everybody at once (the same report the app's Super Admin can read: function_scope_review(), which needs a Super Admin sign-in)
select p.full_name, case when p.is_operations_head then 'Operations Head' else 'Department Head' end as kind,
       coalesce(p.head_division, 'SALES + SUPPORT') as function_or_side,
       string_agg(d.name || ': ' || coalesce(s.division, 'both'), ', ' order by d.name) as reaches
  from public.profiles p
  cross join lateral private.scopes_of(p.id) s
  join public.departments d on d.id = s.department_id
 where p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE'
 group by p.id, p.full_name, p.is_operations_head, p.head_division
 order by 2, 1;
