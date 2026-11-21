-- Read-only. Run in the Supabase SQL editor to see why a developer does (not) get the Bugs section.
-- Change the email on the first line. Nothing is written.
with target as (select lower('siddhesh.amuwa@gmail.com') as email)
select 'auth user' as what, u.id::text as id, u.email, u.email_confirmed_at is not null as ok, to_jsonb(u.banned_until) as detail
  from auth.users u, target t where lower(u.email) = t.email
union all
select 'profile', p.id::text, p.email, p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN',
       jsonb_build_object('name', p.full_name, 'role', p.role, 'status', p.status, 'department', d.name, 'team', tm.name,
                          'idMatchesAuthUser', exists (select 1 from auth.users u where u.id = p.id))
  from public.profiles p left join public.departments d on d.id = p.department_id left join public.teams tm on tm.id = p.team_id, target t
 where lower(p.email) = t.email or p.id in (select u.id from auth.users u where lower(u.email) = t.email)
union all
select 'dev_team_members', m.profile_id::text, null, true, jsonb_build_object('isLead', m.is_lead, 'since', m.created_at)
  from public.dev_team_members m
 where m.profile_id in (select p.id from public.profiles p, target t where lower(p.email) = t.email)
union all
select 'is_developer()', p.id::text, p.email, private.is_developer(p.id), jsonb_build_object('isBugLead', private.is_bug_lead(p.id))
  from public.profiles p, target t where lower(p.email) = t.email
union all
select 'bugs this developer sees (unassigned + own)', null, null, true,
       jsonb_build_object('unassigned', (select count(*) from public.dev_bugs where assigned_to is null),
                          'assignedToThem', (select count(*) from public.dev_bugs b join public.profiles p on p.id = b.assigned_to, target t where lower(p.email) = t.email),
                          'total', (select count(*) from public.dev_bugs))
order by 1;
-- The three developers at a glance:
select p.full_name, p.email, p.role, p.status, m.is_lead, private.is_developer(p.id) as is_developer
  from public.dev_team_members m join public.profiles p on p.id = m.profile_id order by m.is_lead desc, p.full_name;
