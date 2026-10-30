-- =============================================================================
-- Records that need a person's decision after the employee approval hierarchy (migration 20261211000100). READ ONLY - nothing is changed.
-- Run it in the Supabase SQL editor after the migration. Nobody was promoted, nobody lost access, and no history was touched.
-- =============================================================================

-- 1. Departments with NO accountable Operations Head. A Department Head request for them stays pending, and the Super Admin is told, until one is named
--    (Team Member Management > Operations Heads). A department was given an owner automatically only when exactly ONE active Operations Head already
--    covered it.
select d.name as department,
       (select count(*) from public.profiles h where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and private.base_department(h.department_id) = d.id) as active_department_heads
  from public.departments d
 where d.facet_of is null and not d.is_locked and d.slug <> 'hr'
   and not exists (select 1 from public.department_operations_owner o join public.profiles h on h.id = o.operations_head_id
                    where private.base_department(o.department_id) = d.id and h.status = 'ACTIVE' and h.is_operations_head)
 order by d.name;

-- 2. Departments that SEVERAL Operations Heads cover. Only one can be the accountable approver; none was chosen for you.
select d.name as department, string_agg(p.full_name, ', ' order by p.full_name) as operations_heads_covering_it
  from public.departments d
  join public.profiles p on p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head
                        and exists (select 1 from private.scopes_of(p.id) s where s.department_id = d.id)
 where d.facet_of is null
 group by d.id, d.name
having count(*) > 1
 order by d.name;

-- 3. Who is the accountable Operations Head of each department today.
select d.name as department, h.full_name as operations_head, o.assigned_at, assigner.full_name as assigned_by
  from public.department_operations_owner o
  join public.departments d on d.id = o.department_id
  join public.profiles h on h.id = o.operations_head_id
  left join public.profiles assigner on assigner.id = o.assigned_by
 order by d.name;

-- 4. Sign-up requests (people who registered themselves) that are still waiting. They keep their own flow and are decided as before; under the new
--    hierarchy a Department Head would be asked for through HR instead, so check whether any of these is meant to be a head.
select p.full_name, p.email, d.name as department, r.created_at
  from public.approval_requests r
  join public.profiles p on p.id = r.subject_user_id
  left join public.departments d on d.id = r.department_id
 where r.source = 'REGISTRATION' and r.status = 'PENDING'
 order by r.created_at;

-- 5. Department Heads with extra departments but who are not Operations Heads (from the earlier role redesign): still listed for a decision.
select p.full_name, p.email, d.name as home_department, dd.name as extra_department, a.division
  from public.department_access a
  join public.profiles p on p.id = a.profile_id and not p.is_operations_head
  join public.departments d on d.id = p.department_id
  join public.departments dd on dd.id = a.department_id
 where a.transition
 order by p.full_name, dd.name;

-- 6. Active Team Members who are in a department team with no Team Lead (nothing to fix; shown so the Department Head knows who has no Team Lead).
select p.full_name, p.email, d.name as department, t.name as team
  from public.profiles p
  join public.teams t on t.id = p.team_id and not t.is_pool
  join public.departments d on d.id = p.department_id
 where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE'
   and not exists (select 1 from public.profiles l where l.team_id = p.team_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE')
 order by d.name, t.name, p.full_name;
