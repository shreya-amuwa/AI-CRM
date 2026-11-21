-- =============================================================================
-- Bugs: the Team Lead assigns, and visibility follows the assignment (docs/EMPLOYEE_ISSUES.md "Bugs for the Developers team").
-- Run after 20270122000300_developer_bugs.sql. Additive and safe to run twice; no bug, event or file is deleted or duplicated.
--
--   * The developers list knows its Team Lead (dev_team_members.is_lead): Shreya Mande. Ashish Sinha and Siddhesh Shinde are developers.
--     The names are now matched tolerantly, in every department (letters only, ignoring case, spaces, dots and the common spellings
--     Siddhesh / Siddesh / Sidhesh): the first seeding (20270122000300) only looked in AI Studio for the exact names, which is why a
--     developer whose account is spelled or placed differently never got the Bugs section. The Super Admin can still add, remove and make
--     the lead in Settings.
--   * Each bug has assigned_to (was assignee_id), assigned_by, assigned_at and assignment_status (UNASSIGNED / ASSIGNED); every assignment
--     and un-assignment is kept with its time in dev_bug_assignments (and in the bug's history).
--   * Who sees a bug (the same rule in every function and in the row level security policies):
--       the Team Lead            every bug;
--       another developer        every UNASSIGNED bug, and the bugs assigned to them; never one assigned to the other developer;
--       the employee who reported it, their own bug (its status and resolution; never internal comments).
--   * Only the Team Lead assigns, re-assigns or un-assigns (to a developer who is not the lead). The Team Lead changes the status of any
--     bug; a developer, of the bugs assigned to them. Comments: anyone of the team who sees the bug.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The Team Lead, and the developers matched again (tolerantly)
-- ---------------------------------------------------------------------------
alter table public.dev_team_members add column if not exists is_lead boolean not null default false;

create or replace function private.dev_name_key(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z]', '', 'g')
$$;

with wanted (key_first, key_last, lead) as (values ('shreya', 'mande', true), ('ashish', 'sinha', false), ('sid', 'shinde', false)),
found as (
  select p.id, w.lead
    from public.profiles p, wanted w
   where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
     and private.dev_name_key(split_part(btrim(p.full_name), ' ', 1)) like w.key_first || '%'
     and private.dev_name_key(p.full_name) like '%' || w.key_last
     -- Siddhesh / Siddesh / Sidhesh / Sidesh: the first name starts with "sid" and ends with "esh"
     and (w.key_first <> 'sid' or private.dev_name_key(split_part(btrim(p.full_name), ' ', 1)) ~ '^sidd?h?esh$')
)
insert into public.dev_team_members (profile_id, is_lead)
select id, lead from found
on conflict (profile_id) do update set is_lead = public.dev_team_members.is_lead or excluded.is_lead;

create or replace function private.is_bug_lead(p_profile uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dev_team_members t join public.profiles p on p.id = t.profile_id
                  where t.profile_id = coalesce(p_profile, auth.uid()) and t.is_lead and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN')
$$;

-- ---------------------------------------------------------------------------
-- 2. Assignment fields and their history
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dev_bugs' and column_name = 'assignee_id')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dev_bugs' and column_name = 'assigned_to') then
    alter table public.dev_bugs rename column assignee_id to assigned_to;
  end if;
end $$;
alter table public.dev_bugs add column if not exists assigned_by uuid references public.profiles (id) on delete set null;
alter table public.dev_bugs add column if not exists assigned_at timestamptz;
alter table public.dev_bugs add column if not exists assignment_status text not null default 'UNASSIGNED';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dev_bugs_assignment_status_check') then
    alter table public.dev_bugs add constraint dev_bugs_assignment_status_check check (assignment_status in ('UNASSIGNED', 'ASSIGNED'));
  end if;
end $$;
-- bugs assigned under 20270122000300 keep their developer
update public.dev_bugs set assignment_status = 'ASSIGNED', assigned_at = coalesce(assigned_at, updated_at)
 where assigned_to is not null and assignment_status <> 'ASSIGNED';
update public.dev_bugs set assignment_status = 'UNASSIGNED' where assigned_to is null and assignment_status <> 'UNASSIGNED';
drop index if exists public.dev_bugs_assignee_idx;
create index if not exists dev_bugs_assigned_idx on public.dev_bugs (assigned_to, status) where assigned_to is not null;
create index if not exists dev_bugs_unassigned_idx on public.dev_bugs (created_at desc) where assigned_to is null;

create table if not exists public.dev_bug_assignments (
  id bigint generated always as identity primary key,
  bug_id uuid not null references public.dev_bugs (id) on delete cascade,
  assigned_to uuid references public.profiles (id) on delete set null,     -- null: un-assigned
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now()
);
create index if not exists dev_bug_assignments_bug_idx on public.dev_bug_assignments (bug_id, id);
alter table public.dev_bug_assignments enable row level security;
revoke all on public.dev_bug_assignments from public, anon, authenticated;
-- the assignments made before this migration, from the bug's history (once)
insert into public.dev_bug_assignments (bug_id, assigned_to, assigned_by, assigned_at)
select e.bug_id, nullif(e.data ->> 'to', '')::uuid, e.actor_id, e.created_at from public.dev_bug_events e
 where e.kind = 'ASSIGNED' and not exists (select 1 from public.dev_bug_assignments a where a.bug_id = e.bug_id);

-- ---------------------------------------------------------------------------
-- 3. One visibility rule
-- ---------------------------------------------------------------------------
-- may the signed-in person see a bug reported by p_reporter and assigned to p_assigned (null: unassigned)?
create or replace function private.bug_visible(p_reporter uuid, p_assigned uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    p_reporter = auth.uid()
    or private.is_bug_lead(auth.uid())
    or (private.is_developer(auth.uid()) and (p_assigned is null or p_assigned = auth.uid())))
$$;
-- is the signed-in person one of the team who sees this bug (as a developer, not only as its reporter)?
create or replace function private.bug_team_visible(p_assigned uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_bug_lead(auth.uid()) or (private.is_developer(auth.uid()) and (p_assigned is null or p_assigned = auth.uid()))
$$;

-- row level security: the same rule for anything that reads the tables directly (the functions below apply it too)
grant select on public.dev_bugs, public.dev_bug_events, public.dev_bug_assignments to authenticated;
drop policy if exists dev_bugs_select on public.dev_bugs;
create policy dev_bugs_select on public.dev_bugs for select to authenticated using (private.bug_visible(reporter_id, assigned_to));
drop policy if exists dev_bug_events_select on public.dev_bug_events;
create policy dev_bug_events_select on public.dev_bug_events for select to authenticated
  using (exists (select 1 from public.dev_bugs b where b.id = bug_id
                  and (private.bug_team_visible(b.assigned_to) or (b.reporter_id = auth.uid() and visibility = 'ALL'))));
drop policy if exists dev_bug_assignments_select on public.dev_bug_assignments;
create policy dev_bug_assignments_select on public.dev_bug_assignments for select to authenticated
  using (exists (select 1 from public.dev_bugs b where b.id = bug_id and private.bug_team_visible(b.assigned_to)));
-- nothing is written past the functions
revoke insert, update, delete on public.dev_bugs, public.dev_bug_events, public.dev_bug_assignments from authenticated;

-- ---------------------------------------------------------------------------
-- 4. JSON (assigned_to / assigned_by / assignment_status)
-- ---------------------------------------------------------------------------
create or replace function private.dev_bug_json(b public.dev_bugs, p_dev boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'reference', b.reference, 'title', b.title, 'description', b.description, 'steps', b.steps, 'status', b.status,
    'reporterId', b.reporter_id, 'reporterName', b.reporter_name, 'department', b.department_name, 'designation', b.designation,
    'assigneeId', b.assigned_to, 'assigneeName', (select full_name from public.profiles where id = b.assigned_to),
    'assignmentStatus', b.assignment_status, 'assignedById', b.assigned_by, 'assignedByName', (select full_name from public.profiles where id = b.assigned_by),
    'assignedAt', b.assigned_at,
    'resolutionNote', b.resolution_note, 'resolvedAt', b.resolved_at, 'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime_type, 'size', a.size_bytes) order by a.created_at)
                    from public.employee_issue_attachments a where a.bug_id = b.id and a.status = 'READY'), '[]'::jsonb),
    'assignments', case when p_dev then coalesce((select jsonb_agg(jsonb_build_object('to', (select full_name from public.profiles where id = x.assigned_to),
                    'by', (select full_name from public.profiles where id = x.assigned_by), 'at', x.assigned_at) order by x.id)
                    from public.dev_bug_assignments x where x.bug_id = b.id), '[]'::jsonb) else '[]'::jsonb end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'internal', e.visibility = 'DEV', 'note', e.note, 'data', e.data,
                    'by', (select full_name from public.profiles where id = e.actor_id), 'at', e.created_at) order by e.id)
                    from public.dev_bug_events e where e.bug_id = b.id and (p_dev or e.visibility = 'ALL')), '[]'::jsonb))
$$;

create or replace function private.dev_bug_row(b public.dev_bugs)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'reference', b.reference, 'title', b.title, 'status', b.status, 'reporterName', b.reporter_name,
    'department', b.department_name, 'designation', b.designation, 'assigneeId', b.assigned_to,
    'assigneeName', (select full_name from public.profiles where id = b.assigned_to), 'assignmentStatus', b.assignment_status,
    'assignedByName', (select full_name from public.profiles where id = b.assigned_by), 'assignedAt', b.assigned_at,
    'attachmentCount', (select count(*) from public.employee_issue_attachments a where a.bug_id = b.id and a.status = 'READY'),
    'createdAt', b.created_at, 'updatedAt', b.updated_at, 'resolvedAt', b.resolved_at)
$$;

-- ---------------------------------------------------------------------------
-- 5. The developers' functions with the visibility rule
-- ---------------------------------------------------------------------------
create or replace function public.bug_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.is_developer(auth.uid()) then
    return jsonb_build_object('isDeveloper', false, 'isLead', false, 'meId', auth.uid(), 'developers', '[]'::jsonb);
  end if;
  return jsonb_build_object('isDeveloper', true, 'isLead', private.is_bug_lead(auth.uid()), 'meId', auth.uid(),
    -- the people a bug can be assigned to (the developers who are not the lead), for the lead's dropdown
    'developers', case when private.is_bug_lead(auth.uid()) then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
                              from public.dev_team_members t join public.profiles p on p.id = t.profile_id
                             where not t.is_lead and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.bug_dev_list(p_status text default null, p_assignee text default null, p_search text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  v_lead boolean := private.is_bug_lead(me.id);
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_who uuid := private.try_uuid(p_assignee);
begin
  if p_status is not null and p_status not in ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'OPEN', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = '22023';
  end if;
  return (
    -- what this person may see: the lead every bug; a developer the unassigned ones and their own
    with mine as (select b.* from public.dev_bugs b where v_lead or b.assigned_to is null or b.assigned_to = me.id),
    f as (
      select b.* from mine b
       where (p_status is null or case p_status when 'OPEN' then b.status in ('PENDING', 'IN_PROGRESS') when 'CLOSED' then b.status in ('RESOLVED', 'REJECTED')
                                                else b.status = p_status end)
         and (p_assignee is null or case when p_assignee = 'ME' then b.assigned_to = me.id when p_assignee = 'UNASSIGNED' then b.assigned_to is null
                                         else b.assigned_to = v_who end)
         and (v_term is null or b.title ilike '%' || private.like_escape(v_term) || '%' or b.reference ilike '%' || private.like_escape(v_term) || '%'
              or b.reporter_name ilike '%' || private.like_escape(v_term) || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'isLead', v_lead,
      'counts', (select jsonb_build_object('PENDING', count(*) filter (where status = 'PENDING'), 'IN_PROGRESS', count(*) filter (where status = 'IN_PROGRESS'),
                   'RESOLVED', count(*) filter (where status = 'RESOLVED'), 'REJECTED', count(*) filter (where status = 'REJECTED'),
                   'MINE', count(*) filter (where assigned_to = me.id and status in ('PENDING', 'IN_PROGRESS')),
                   'UNASSIGNED', count(*) filter (where assigned_to is null and status in ('PENDING', 'IN_PROGRESS'))) from mine),
      -- the lead's view of the team's workload: open bugs per developer
      'byDeveloper', case when v_lead then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name,
                         'open', (select count(*) from public.dev_bugs b where b.assigned_to = p.id and b.status in ('PENDING', 'IN_PROGRESS')),
                         'closed', (select count(*) from public.dev_bugs b where b.assigned_to = p.id and b.status in ('RESOLVED', 'REJECTED'))) order by p.full_name)
                         from public.dev_team_members t join public.profiles p on p.id = t.profile_id where not t.is_lead and p.status = 'ACTIVE'), '[]'::jsonb)
                     else '[]'::jsonb end,
      'items', coalesce((select jsonb_agg(private.dev_bug_row(x) order by x.created_at desc)
                           from (select * from f order by created_at desc offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb))
  );
end $$;

create or replace function public.bug_dev_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
begin
  select * into b from public.dev_bugs where id = p_id;
  -- assigned to the other developer: not found for this developer (the lead sees every bug)
  if b.id is null or not private.bug_team_visible(b.assigned_to) then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  return private.dev_bug_json(b, true);
end $$;

-- the Team Lead assigns (re-assigns, or p_developer null: back to unassigned, visible to every developer again)
create or replace function public.bug_dev_assign(p_id uuid, p_developer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
  v_was uuid;
begin
  if not private.is_bug_lead(me.id) then
    raise exception 'FORBIDDEN: Only the Team Lead of the Developers team assigns bugs.' using errcode = '42501';
  end if;
  select * into b from public.dev_bugs where id = p_id for update;
  if b.id is null then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  if p_developer is not null and (not private.is_developer(p_developer) or private.is_bug_lead(p_developer)) then
    raise exception 'VALIDATION_ERROR: Assign the bug to one of the developers of the team.' using errcode = '22023';
  end if;
  if b.assigned_to is not distinct from p_developer then
    return private.dev_bug_json(b, true);   -- nothing changes (a double click)
  end if;
  v_was := b.assigned_to;
  update public.dev_bugs
     set assigned_to = p_developer, assigned_by = me.id, assigned_at = now(),
         assignment_status = case when p_developer is null then 'UNASSIGNED' else 'ASSIGNED' end
   where id = b.id returning * into b;
  insert into public.dev_bug_assignments (bug_id, assigned_to, assigned_by) values (b.id, p_developer, me.id);
  perform private.dev_bug_event(b.id, 'ASSIGNED', 'ALL', null, jsonb_build_object('from', v_was, 'to', p_developer,
    'toName', (select full_name from public.profiles where id = p_developer)));
  if p_developer is not null then
    perform private.notify(p_developer, 'DEV_BUG_ASSIGNED', 'Bug ' || b.reference || ' assigned to you', left(b.title, 120) || ' — by ' || me.full_name || '.',
      'dev_bug', b.id, jsonb_build_object('bugId', b.id), 'normal');
  end if;
  perform private.write_audit('DEV_BUG_ASSIGNED', 'dev_bug', b.id, null, null, jsonb_build_object('from', v_was, 'to', p_developer));
  return private.dev_bug_json(b, true);
end $$;

-- the Team Lead on any bug; a developer on the bugs assigned to them
create or replace function public.bug_dev_set_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
  v_was text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_status not in ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose Pending, In Progress, Resolved or Rejected.' using errcode = '22023';
  end if;
  if p_status in ('RESOLVED', 'REJECTED') and (v_note is null or length(v_note) < 5) then
    raise exception 'VALIDATION_ERROR: %', case p_status when 'RESOLVED' then 'Write the resolution note (at least 5 characters). The employee will read it.'
                                                  else 'Write why it is rejected (at least 5 characters). The employee will read it.' end using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 3000 then
    raise exception 'VALIDATION_ERROR: The note can have at most 3000 characters.' using errcode = '22023';
  end if;
  select * into b from public.dev_bugs where id = p_id for update;
  if b.id is null or not private.bug_team_visible(b.assigned_to) then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  if not private.is_bug_lead(me.id) and b.assigned_to is distinct from me.id then
    raise exception 'FORBIDDEN: Only the developer the bug is assigned to, or the Team Lead, changes its status. Ask the Team Lead to assign it.' using errcode = '42501';
  end if;
  if b.status = p_status and v_note is null then
    return private.dev_bug_json(b, true);
  end if;
  v_was := b.status;
  update public.dev_bugs
     set status = p_status,
         resolution_note = case when p_status in ('RESOLVED', 'REJECTED') then v_note else resolution_note end,
         resolved_at = case when p_status in ('RESOLVED', 'REJECTED') then now() else null end
   where id = b.id returning * into b;
  perform private.dev_bug_event(b.id, 'STATUS', 'ALL', v_note, jsonb_build_object('from', v_was, 'to', p_status));
  if v_was is distinct from p_status then
    perform private.notify(b.reporter_id, 'DEV_BUG_STATUS', 'Your bug ' || b.reference || ' is ' ||
        case p_status when 'PENDING' then 'pending' when 'IN_PROGRESS' then 'in progress' when 'RESOLVED' then 'resolved' else 'rejected' end,
      coalesce(left(v_note, 200), left(b.title, 120)), 'dev_bug', b.id, jsonb_build_object('bugId', b.id, 'status', p_status), 'normal');
    -- the lead follows the team's progress
    if not private.is_bug_lead(me.id) then
      perform private.notify(t.profile_id, 'DEV_BUG_PROGRESS', 'Bug ' || b.reference || ': ' || lower(replace(p_status, '_', ' ')),
        left(b.title, 120) || ' — by ' || me.full_name || '.', 'dev_bug', b.id, jsonb_build_object('bugId', b.id, 'status', p_status), 'normal')
        from public.dev_team_members t where t.is_lead and private.is_developer(t.profile_id);
    end if;
  end if;
  perform private.write_audit('DEV_BUG_STATUS_CHANGED', 'dev_bug', b.id, null, null, jsonb_build_object('from', v_was, 'to', p_status));
  return private.dev_bug_json(b, true);
end $$;

create or replace function public.bug_dev_comment(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_note is null or length(v_note) > 3000 then
    raise exception 'VALIDATION_ERROR: Write a comment (up to 3000 characters).' using errcode = '22023';
  end if;
  select * into b from public.dev_bugs where id = p_id;
  if b.id is null or not private.bug_team_visible(b.assigned_to) then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  perform private.dev_bug_event(b.id, 'COMMENT', 'DEV', v_note, '{}'::jsonb);
  update public.dev_bugs set updated_at = now() where id = b.id returning * into b;
  return private.dev_bug_json(b, true);
end $$;

-- a bug's files: its reporter, and the developers who see the bug (20270122000300 + the assignment rule)
create or replace function public.issue_attachment_download(p_attachment uuid)
returns public.employee_issue_attachments language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issue_attachments;
  i public.employee_issues;
  b public.dev_bugs;
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into r from public.employee_issue_attachments a where a.id = p_attachment and a.status = 'READY';
  if r.id is null then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  if r.bug_id is not null then
    select * into b from public.dev_bugs where id = r.bug_id;
    if not private.bug_visible(b.reporter_id, b.assigned_to) then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
    perform private.write_audit('DEV_BUG_ATTACHMENT_DOWNLOADED', 'dev_bug', b.id, null, null, jsonb_build_object('attachment_id', r.id, 'reference', b.reference));
    return r;
  end if;
  if r.issue_id is null then
    if r.uploader_id <> auth.uid() then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
    return r;
  end if;
  select * into i from public.employee_issues where id = r.issue_id;
  if not (i.employee_id = auth.uid() or (private.is_hr_staff() and i.employee_id <> auth.uid())) then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit('EMPLOYEE_ISSUE_ATTACHMENT_DOWNLOADED', 'employee_issue', i.id, i.department_id, null,
    jsonb_build_object('attachment_id', r.id, 'reference', i.issue_reference));
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 6. The Super Admin keeps the list, and says who the Team Lead is
-- ---------------------------------------------------------------------------
create or replace function public.dev_team_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN' and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Only the Super Admin manages the Developers team.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'active', p.status = 'ACTIVE', 'isLead', t.is_lead,
            'department', (select name from public.departments where id = p.department_id), 'addedAt', t.created_at) order by t.is_lead desc, p.full_name)
            from public.dev_team_members t join public.profiles p on p.id = t.profile_id), '[]'::jsonb);
end $$;

drop function if exists public.dev_team_set(uuid, boolean);
create or replace function public.dev_team_set(p_profile uuid, p_member boolean, p_lead boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN' and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Only the Super Admin manages the Developers team.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = p_profile;
  if p.id is null then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0002';
  end if;
  if p_member then
    if p.status <> 'ACTIVE' or p.role = 'SUPER_ADMIN' then
      raise exception 'VALIDATION_ERROR: Choose an active employee (not the Super Admin).' using errcode = '22023';
    end if;
    insert into public.dev_team_members (profile_id, added_by, is_lead) values (p.id, auth.uid(), coalesce(p_lead, false))
    on conflict (profile_id) do update set is_lead = coalesce(p_lead, public.dev_team_members.is_lead);
  else
    -- their open bugs go back to unassigned, so the rest of the team sees them again
    update public.dev_bugs set assigned_to = null, assignment_status = 'UNASSIGNED', assigned_by = auth.uid(), assigned_at = now()
     where assigned_to = p.id and status in ('PENDING', 'IN_PROGRESS');
    delete from public.dev_team_members where profile_id = p.id;
  end if;
  perform private.write_audit(case when not p_member then 'DEV_TEAM_MEMBER_REMOVED' when p_lead then 'DEV_TEAM_LEAD_SET' else 'DEV_TEAM_MEMBER_ADDED' end,
    'profile', p.id, p.department_id, p.team_id, jsonb_build_object('lead', p_lead));
  return public.dev_team_list();
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['private.dev_name_key(text)', 'private.dev_bug_json(public.dev_bugs, boolean)', 'private.dev_bug_row(public.dev_bugs)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  execute 'revoke all on function private.is_bug_lead(uuid) from public, anon, authenticated';
  -- used by the row level security policies (they answer only about the signed-in person)
  foreach f in array array['private.bug_visible(uuid, uuid)', 'private.bug_team_visible(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.bug_access()', 'public.bug_dev_list(text, text, text, integer, integer)', 'public.bug_dev_detail(uuid)',
    'public.bug_dev_assign(uuid, uuid)', 'public.bug_dev_set_status(uuid, text, text)', 'public.bug_dev_comment(uuid, text)',
    'public.dev_team_list()', 'public.dev_team_set(uuid, boolean, boolean)', 'public.issue_attachment_download(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
