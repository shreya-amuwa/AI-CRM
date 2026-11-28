-- =============================================================================
-- Bugs: shared tracking by the three developers (docs/EMPLOYEE_ISSUES.md "Bugs for the Developers team", docs/BUG_SHARED_TRACKING.md).
-- Run after 20270311000100_recharge_invoices.sql. Additive and safe to run twice; no bug, event, file or assignment is deleted or changed.
--
--   Before (20270122000400): the Team Lead assigned each bug to one developer, the other developer did not even see it, and only the assigned
--   developer (or the lead) could change its status. A bug waited for its single assignee.
--
--   Now: a bug has no mandatory assignee. All three developers (the Team Lead and the two developers on the list) see every bug, and any of
--   them changes its status, progress, replies to the reporter and comments. Assigning is still possible (the Team Lead may name a
--   "primary contact"), but nothing depends on it: it never hides a bug and never blocks anybody.
--
--   * dev_bugs.progress (0-100) and dev_bugs.version (counts every update; used to refuse a change made on an out-of-date screen).
--   * A new status TESTING ("Testing") next to the existing ones (PENDING = Open, UNDER_REVIEW, IN_PROGRESS, NEEDS_INFO, RESOLVED, REJECTED, CLOSED).
--   * bug_dev_add_update(...): "Add Progress Update". Writes one PROGRESS entry to the append-only history: what was worked on, the notes, the status
--     and progress before and after, and WHO did it (taken from the login, never sent by the browser). It never overwrites another person's
--     entry: entries are only ever added. A repeated send of the same form (same request id) is stored once. If the bug was changed by someone
--     else since the screen was loaded (expected version), a status / progress change is refused with CONFLICT instead of overwriting it.
--   * Contributors are derived from the history (everyone who made a progress update, a status change, a comment or a reply), so they cannot
--     drift from what really happened.
--   * Who sees what is one rule (private.bug_visible / bug_team_visible, used by the functions and the row level security policies): the
--     reporter sees their own bug; every developer sees every bug; nobody else sees any.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns, the new status and the new kind of history entry
-- ---------------------------------------------------------------------------
alter table public.dev_bugs add column if not exists progress smallint not null default 0;
alter table public.dev_bugs add column if not exists version integer not null default 1;
alter table public.dev_bugs add column if not exists last_update_at timestamptz;
alter table public.dev_bugs add column if not exists last_update_by uuid references public.profiles (id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dev_bugs_progress_check') then
    alter table public.dev_bugs add constraint dev_bugs_progress_check check (progress between 0 and 100);
  end if;
end $$;
-- bugs that were already finished show 100%
update public.dev_bugs set progress = 100 where status in ('RESOLVED', 'CLOSED') and progress = 0;

alter table public.dev_bugs drop constraint if exists dev_bugs_status_check;
alter table public.dev_bugs add constraint dev_bugs_status_check
  check (status in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'TESTING', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED'));
alter table public.dev_bug_events drop constraint if exists dev_bug_events_kind_check;
alter table public.dev_bug_events add constraint dev_bug_events_kind_check check (kind in ('SUBMITTED', 'ASSIGNED', 'STATUS', 'COMMENT', 'MESSAGE', 'PROGRESS'));

-- the same form sent twice stores one progress update
create unique index if not exists dev_bug_events_progress_request_uidx
  on public.dev_bug_events (bug_id, actor_id, (data ->> 'clientRequestId')) where kind = 'PROGRESS' and data ? 'clientRequestId';
create index if not exists dev_bug_events_actor_idx on public.dev_bug_events (bug_id, actor_id);

-- ---------------------------------------------------------------------------
-- 2. One visibility rule: the reporter, and every developer (no dependence on the assignee)
-- ---------------------------------------------------------------------------
create or replace function private.bug_visible(p_reporter uuid, p_assigned uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (p_reporter = auth.uid() or private.is_developer(auth.uid()))
$$;
create or replace function private.bug_team_visible(p_assigned uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_developer(auth.uid())
$$;

create or replace function private.dev_bug_status_label(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'PENDING' then 'pending' when 'UNDER_REVIEW' then 'under review' when 'IN_PROGRESS' then 'in progress' when 'TESTING' then 'in testing'
                when 'NEEDS_INFO' then 'waiting for information' when 'RESOLVED' then 'resolved' when 'REJECTED' then 'rejected'
                when 'CLOSED' then 'closed' else lower(coalesce(p, '')) end
$$;
create or replace function private.dev_bug_open(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'TESTING', 'NEEDS_INFO')
$$;

-- ---------------------------------------------------------------------------
-- 3. Contributors, JSON
-- ---------------------------------------------------------------------------
-- everyone of the team who did something on the bug: a progress update, a status change (not the reporter's own), a comment or a reply
create or replace function private.dev_bug_contributors(p_bug uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.actor_id, 'name', p.full_name, 'updates', c.n, 'lastAt', c.last_at) order by c.last_at desc, p.full_name), '[]'::jsonb)
    -- one action is counted once: a status change made through an update has its own PROGRESS entry, so STATUS entries count only for people who
    -- have nothing else (a status change written before this migration)
    from (select e.actor_id,
                 case when count(*) filter (where e.kind <> 'STATUS') > 0 then count(*) filter (where e.kind <> 'STATUS') else count(*) end as n,
                 max(e.created_at) as last_at
            from public.dev_bug_events e
           where e.bug_id = p_bug and e.actor_id is not null
             and (e.kind in ('PROGRESS', 'COMMENT')
                  or (e.kind = 'STATUS' and coalesce(e.data ->> 'byReporter', '') <> 'true')
                  or (e.kind = 'MESSAGE' and e.data ->> 'from' = 'DEVELOPER'))
           group by e.actor_id) c
    join public.profiles p on p.id = c.actor_id
$$;
revoke all on function private.dev_bug_contributors(uuid) from public, anon, authenticated;

create or replace function private.dev_bug_json(b public.dev_bugs, p_dev boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'reference', b.reference, 'title', b.title, 'description', b.description, 'steps', b.steps, 'status', b.status,
    'progress', b.progress, 'version', b.version,
    'category', b.category, 'priority', b.priority, 'source', b.source,
    'sourceIssueId', b.source_issue_id, 'sourceIssueReference', (select i.issue_reference from public.employee_issues i where i.id = b.source_issue_id),
    'affectedDepartmentId', b.affected_department_id, 'affectedDepartment', b.affected_department_name,
    'affectedEmployeeId', b.affected_employee_id, 'affectedEmployee', b.affected_employee_name,
    'reporterId', b.reporter_id, 'reporterName', b.reporter_name, 'department', b.department_name, 'designation', b.designation,
    'assigneeId', b.assigned_to, 'assigneeName', (select full_name from public.profiles where id = b.assigned_to),
    'assignmentStatus', b.assignment_status, 'assignedById', b.assigned_by, 'assignedByName', (select full_name from public.profiles where id = b.assigned_by),
    'assignedAt', b.assigned_at,
    'resolutionNote', b.resolution_note, 'resolvedAt', b.resolved_at, 'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'attachments', private.dev_bug_files(b),
    'contributors', case when p_dev then private.dev_bug_contributors(b.id) else '[]'::jsonb end,
    'latestUpdate', case when p_dev then (select jsonb_build_object('by', (select full_name from public.profiles where id = e.actor_id), 'at', e.created_at,
                          'work', left(e.note, 300), 'statusTo', e.data ->> 'statusTo', 'progressTo', (e.data ->> 'progressTo')::integer)
                          from public.dev_bug_events e where e.bug_id = b.id and e.kind = 'PROGRESS' order by e.id desc limit 1) end,
    'assignments', case when p_dev then coalesce((select jsonb_agg(jsonb_build_object('to', (select full_name from public.profiles where id = x.assigned_to),
                    'by', (select full_name from public.profiles where id = x.assigned_by), 'at', x.assigned_at) order by x.id)
                    from public.dev_bug_assignments x where x.bug_id = b.id), '[]'::jsonb) else '[]'::jsonb end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'internal', e.visibility = 'DEV', 'note', e.note, 'data', e.data - 'clientRequestId',
                    'by', (select full_name from public.profiles where id = e.actor_id), 'byId', e.actor_id, 'at', e.created_at) order by e.id)
                    from public.dev_bug_events e where e.bug_id = b.id and (p_dev or e.visibility = 'ALL')), '[]'::jsonb))
$$;

create or replace function private.dev_bug_row(b public.dev_bugs)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'reference', b.reference, 'title', b.title, 'status', b.status, 'progress', b.progress, 'reporterName', b.reporter_name,
    'department', b.department_name, 'designation', b.designation, 'assigneeId', b.assigned_to,
    'assigneeName', (select full_name from public.profiles where id = b.assigned_to), 'assignmentStatus', b.assignment_status,
    'assignedByName', (select full_name from public.profiles where id = b.assigned_by), 'assignedAt', b.assigned_at,
    'category', b.category, 'priority', b.priority, 'source', b.source,
    'sourceIssueReference', (select i.issue_reference from public.employee_issues i where i.id = b.source_issue_id),
    'affectedDepartment', b.affected_department_name, 'affectedEmployee', b.affected_employee_name,
    'attachmentCount', (select count(*) from public.employee_issue_attachments a
                         where a.status = 'READY' and (a.bug_id = b.id or (b.source_issue_id is not null and a.issue_id = b.source_issue_id))),
    'lastMessage', (select jsonb_build_object('from', e.data ->> 'from', 'note', left(e.note, 300), 'by', (select full_name from public.profiles where id = e.actor_id), 'at', e.created_at)
                      from public.dev_bug_events e where e.bug_id = b.id and e.kind = 'MESSAGE' order by e.id desc limit 1),
    -- who of the team worked on it (names only; the reporter's own list never shows them: bug_my_list does not ask for them)
    'contributors', (select coalesce(jsonb_agg(c ->> 'name'), '[]'::jsonb) from jsonb_array_elements(private.dev_bug_contributors(b.id)) c),
    'lastUpdateAt', b.last_update_at, 'lastUpdateBy', (select full_name from public.profiles where id = b.last_update_by),
    'createdAt', b.created_at, 'updatedAt', b.updated_at, 'resolvedAt', b.resolved_at)
$$;

-- ---------------------------------------------------------------------------
-- 4. The team: who may open the section, and the three developers (for the filters and the contributors)
-- ---------------------------------------------------------------------------
create or replace function public.bug_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.is_developer(auth.uid()) then
    return jsonb_build_object('isDeveloper', false, 'isLead', false, 'meId', auth.uid(), 'developers', '[]'::jsonb, 'team', '[]'::jsonb);
  end if;
  return jsonb_build_object('isDeveloper', true, 'isLead', private.is_bug_lead(auth.uid()), 'meId', auth.uid(),
    -- the people the Team Lead may name as a bug's (optional) primary contact: the developers who are not the lead
    'developers', case when private.is_bug_lead(auth.uid()) then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
                              from public.dev_team_members t join public.profiles p on p.id = t.profile_id
                             where not t.is_lead and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb) else '[]'::jsonb end,
    -- the whole team: all of them work on every bug
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'isLead', t.is_lead) order by p.full_name)
                        from public.dev_team_members t join public.profiles p on p.id = t.profile_id
                       where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 5. The list: every developer sees every bug
-- ---------------------------------------------------------------------------
create or replace function public.bug_dev_list(p_status text default null, p_assignee text default null, p_search text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  v_lead boolean := private.is_bug_lead(me.id);
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_who uuid := private.try_uuid(p_assignee);
begin
  if p_status is not null and p_status not in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'TESTING', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED', 'OPEN', 'DONE') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = '22023';
  end if;
  return (
    with f as (
      select b.* from public.dev_bugs b
       where (p_status is null or case p_status when 'OPEN' then private.dev_bug_open(b.status) when 'DONE' then not private.dev_bug_open(b.status)
                                                else b.status = p_status end)
         and (p_assignee is null or case when p_assignee = 'ME' then b.assigned_to = me.id when p_assignee = 'UNASSIGNED' then b.assigned_to is null
                                         when p_assignee = 'CONTRIBUTED' then exists (select 1 from jsonb_array_elements(private.dev_bug_contributors(b.id)) c where (c ->> 'id')::uuid = me.id)
                                         else b.assigned_to = v_who end)
         and (v_term is null or b.title ilike '%' || private.like_escape(v_term) || '%' or b.reference ilike '%' || private.like_escape(v_term) || '%'
              or b.reporter_name ilike '%' || private.like_escape(v_term) || '%' or b.affected_employee_name ilike '%' || private.like_escape(v_term) || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'isLead', v_lead,
      'counts', (select jsonb_build_object('PENDING', count(*) filter (where status = 'PENDING'), 'UNDER_REVIEW', count(*) filter (where status = 'UNDER_REVIEW'),
                   'IN_PROGRESS', count(*) filter (where status = 'IN_PROGRESS'), 'TESTING', count(*) filter (where status = 'TESTING'),
                   'NEEDS_INFO', count(*) filter (where status = 'NEEDS_INFO'),
                   'RESOLVED', count(*) filter (where status = 'RESOLVED'), 'REJECTED', count(*) filter (where status = 'REJECTED'),
                   'CLOSED', count(*) filter (where status = 'CLOSED'), 'OPEN', count(*) filter (where private.dev_bug_open(status)),
                   'MINE', count(*) filter (where assigned_to = me.id and private.dev_bug_open(status)),
                   'UNASSIGNED', count(*) filter (where assigned_to is null and private.dev_bug_open(status))) from public.dev_bugs),
      -- each developer's share: bugs they are the primary contact of, and the progress updates they made
      'byDeveloper', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name,
                         'open', (select count(*) from public.dev_bugs b where b.assigned_to = p.id and private.dev_bug_open(b.status)),
                         'closed', (select count(*) from public.dev_bugs b where b.assigned_to = p.id and not private.dev_bug_open(b.status)),
                         'updates', (select count(*) from public.dev_bug_events e where e.actor_id = p.id and e.kind = 'PROGRESS')) order by p.full_name)
                         from public.dev_team_members t join public.profiles p on p.id = t.profile_id where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(private.dev_bug_row(x) order by x.created_at desc)
                           from (select * from f order by created_at desc offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb))
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6. Add Progress Update (any developer, on any bug)
-- ---------------------------------------------------------------------------
create or replace function public.bug_dev_add_update(p_id uuid, p_work text, p_status text default null, p_progress integer default null,
  p_notes text default null, p_expected_version integer default null, p_client_request_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
  v_work text := btrim(coalesce(p_work, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_key text := nullif(btrim(coalesce(p_client_request_id, '')), '');
  v_was text;
  v_to text;
  v_prog_was integer;
  v_prog integer;
  v_text text;
  v_changed boolean;
  d record;
begin
  if length(v_work) < 3 or length(v_work) > 3000 then
    raise exception 'VALIDATION_ERROR: Write what you worked on (3 to 3000 characters).' using errcode = '22023';
  end if;
  if length(coalesce(v_notes, '')) > 3000 then
    raise exception 'VALIDATION_ERROR: The notes can have at most 3000 characters.' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'TESTING', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Choose Pending, Under Review, In Progress, Testing, Pending Information, Resolved, Rejected or Closed.' using errcode = '22023';
  end if;
  if p_progress is not null and p_progress not between 0 and 100 then
    raise exception 'VALIDATION_ERROR: The progress is a percentage from 0 to 100.' using errcode = '22023';
  end if;
  if v_key is not null and length(v_key) not between 8 and 80 then
    raise exception 'VALIDATION_ERROR: Invalid request id.' using errcode = '22023';
  end if;
  select * into b from public.dev_bugs where id = p_id for update;
  if b.id is null or not private.bug_team_visible(b.assigned_to) then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  -- the same form sent twice (a double click, a retry): the first update, nothing new
  if v_key is not null and exists (select 1 from public.dev_bug_events e where e.bug_id = b.id and e.actor_id = me.id and e.kind = 'PROGRESS' and e.data ->> 'clientRequestId' = v_key) then
    return private.dev_bug_json(b, true) || jsonb_build_object('duplicate', true);
  end if;
  v_was := b.status;
  v_to := coalesce(p_status, b.status);
  v_prog_was := b.progress;
  v_prog := coalesce(p_progress, case when v_to in ('RESOLVED', 'CLOSED') then 100 else b.progress end);
  if v_to = 'RESOLVED' and v_prog <> 100 then
    raise exception 'VALIDATION_ERROR: A resolved bug is 100%% done.' using errcode = '22023';
  end if;
  v_changed := v_to is distinct from v_was or v_prog is distinct from v_prog_was;
  -- somebody else changed the status or the progress since this screen was loaded: do not overwrite it
  if v_changed and p_expected_version is not null and p_expected_version <> b.version then
    raise exception 'CONFLICT: Another developer updated this bug while you were writing. Reload to read their update, then save yours again.' using errcode = 'P0001';
  end if;
  -- the text the reporter reads when a bug is resolved or rejected: the notes, else what was worked on
  v_text := coalesce(v_notes, v_work);
  if v_to in ('RESOLVED', 'REJECTED') and v_to is distinct from v_was and length(v_text) < 5 then
    raise exception 'VALIDATION_ERROR: %', case v_to when 'RESOLVED' then 'Write the resolution note (at least 5 characters). The employee will read it.'
                                                  else 'Write why it is rejected (at least 5 characters). The employee will read it.' end using errcode = '22023';
  end if;

  update public.dev_bugs
     set status = v_to, progress = v_prog,
         resolution_note = case when v_to in ('RESOLVED', 'REJECTED') and v_to is distinct from v_was then v_text
                                when v_to = 'CLOSED' and v_to is distinct from v_was then coalesce(v_notes, resolution_note) else resolution_note end,
         resolved_at = case when v_to in ('RESOLVED', 'REJECTED') then coalesce(case when v_to = v_was then resolved_at end, now())
                            when v_to = 'CLOSED' then coalesce(resolved_at, now()) else null end,
         version = version + 1, last_update_at = now(), last_update_by = me.id
   where id = b.id returning * into b;

  -- the update itself: kept as written, with who and when (the team reads it; the reporter does not)
  perform private.dev_bug_event(b.id, 'PROGRESS', 'DEV', v_work,
    jsonb_build_object('notes', v_notes, 'statusFrom', v_was, 'statusTo', v_to, 'progressFrom', v_prog_was, 'progressTo', v_prog)
    || case when v_key is not null then jsonb_build_object('clientRequestId', v_key) else '{}'::jsonb end);
  if v_to is distinct from v_was then
    perform private.dev_bug_event(b.id, 'STATUS', 'ALL', case when v_to in ('RESOLVED', 'REJECTED', 'CLOSED') then v_text end, jsonb_build_object('from', v_was, 'to', v_to));
    perform private.notify(b.reporter_id, 'DEV_BUG_STATUS', 'Your issue ' || b.reference || ' is ' || private.dev_bug_status_label(v_to),
      coalesce(left(case when v_to in ('RESOLVED', 'REJECTED', 'CLOSED') then v_text end, 200), left(b.title, 120)), 'dev_bug', b.id,
      jsonb_build_object('bugId', b.id, 'status', v_to), 'normal');
    -- an escalated employee issue: the employee follows the developers' progress on their own issue
    perform private.issue_dev_update(b, 'Developer Team: ' || private.dev_bug_status_label(v_to) || '.' ||
      case when v_to in ('RESOLVED', 'REJECTED', 'CLOSED') and b.resolution_note is not null then ' ' || b.resolution_note else '' end);
  end if;
  -- the other developers follow the work
  for d in select t.profile_id from public.dev_team_members t where private.is_developer(t.profile_id) and t.profile_id <> me.id loop
    perform private.notify(d.profile_id, 'DEV_BUG_PROGRESS', 'Bug ' || b.reference || ': update by ' || me.full_name,
      left(v_work, 140) || ' (' || private.dev_bug_status_label(v_to) || ', ' || v_prog || '%)', 'dev_bug', b.id, jsonb_build_object('bugId', b.id, 'status', v_to), 'normal');
  end loop;
  perform private.write_audit('DEV_BUG_PROGRESS_UPDATED', 'dev_bug', b.id, null, null,
    jsonb_build_object('reference', b.reference, 'statusFrom', v_was, 'statusTo', v_to, 'progressFrom', v_prog_was, 'progressTo', v_prog));
  return private.dev_bug_json(b, true) || jsonb_build_object('duplicate', false);
end $$;

-- the quick status change is the same update, written as one line (any developer, any bug)
create or replace function public.bug_dev_set_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_status is null or p_status not in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'TESTING', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Choose Pending, Under Review, In Progress, Testing, Pending Information, Resolved, Rejected or Closed.' using errcode = '22023';
  end if;
  if p_status in ('RESOLVED', 'REJECTED') and (v_note is null or length(v_note) < 5) then
    raise exception 'VALIDATION_ERROR: %', case p_status when 'RESOLVED' then 'Write the resolution note (at least 5 characters). The employee will read it.'
                                                  else 'Write why it is rejected (at least 5 characters). The employee will read it.' end using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 3000 then
    raise exception 'VALIDATION_ERROR: The note can have at most 3000 characters.' using errcode = '22023';
  end if;
  select * into b from public.dev_bugs where id = p_id;
  if b.id is null or not private.bug_team_visible(b.assigned_to) then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  if b.status = p_status and v_note is null then
    return private.dev_bug_json(b, true);
  end if;
  return public.bug_dev_add_update(p_id, coalesce(v_note, 'Status changed to ' || private.dev_bug_status_label(p_status) || '.'), p_status, null, v_note, null, null);
end $$;

-- a reply to the reporter: any developer (asking for information too)
create or replace function public.bug_dev_reply(p_id uuid, p_message text, p_request_info boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
  v_msg text := btrim(coalesce(p_message, ''));
  v_was text;
begin
  if length(v_msg) < 2 or length(v_msg) > 3000 then
    raise exception 'VALIDATION_ERROR: Write the reply (up to 3000 characters). The reporter reads it.' using errcode = '22023';
  end if;
  select * into b from public.dev_bugs where id = p_id for update;
  if b.id is null or not private.bug_team_visible(b.assigned_to) then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  if b.status = 'CLOSED' then
    raise exception 'CONFLICT: This issue is closed.' using errcode = 'P0001';
  end if;
  v_was := b.status;
  update public.dev_bugs set status = case when coalesce(p_request_info, false) then 'NEEDS_INFO' else status end, updated_at = now(),
         version = case when coalesce(p_request_info, false) and status <> 'NEEDS_INFO' then version + 1 else version end
   where id = b.id returning * into b;
  perform private.dev_bug_event(b.id, 'MESSAGE', 'ALL', v_msg, jsonb_build_object('from', 'DEVELOPER', 'requestInfo', coalesce(p_request_info, false)));
  if v_was is distinct from b.status then
    perform private.dev_bug_event(b.id, 'STATUS', 'ALL', null, jsonb_build_object('from', v_was, 'to', b.status));
    perform private.issue_dev_update(b, 'The Developer Team needs more information; HR will contact you if needed.');
  end if;
  perform private.notify(b.reporter_id, 'DEV_BUG_MESSAGE',
    case when coalesce(p_request_info, false) then 'The developers need information on ' else 'Developer reply on ' end || b.reference,
    me.full_name || ': ' || left(v_msg, 160), 'dev_bug', b.id, jsonb_build_object('bugId', b.id, 'status', b.status), 'normal');
  perform private.write_audit('DEV_BUG_REPLIED', 'dev_bug', b.id, null, null, jsonb_build_object('reference', b.reference, 'requestInfo', coalesce(p_request_info, false)));
  return private.dev_bug_json(b, true);
end $$;

-- the reporter's follow-up reaches the whole team (it used to reach the assignee and the lead only)
create or replace function public.bug_my_follow_up(p_id uuid, p_message text, p_attachments uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  b public.dev_bugs;
  v_msg text := btrim(coalesce(p_message, ''));
  v_ids uuid[] := coalesce(p_attachments, '{}'::uuid[]);
  v_n integer;
  v_was text;
  v_to text;
  d record;
begin
  select * into b from public.dev_bugs where id = p_id and reporter_id = me.id for update;
  if b.id is null then
    raise exception 'NOT_FOUND: Issue not found.' using errcode = 'P0002';
  end if;
  if b.status = 'CLOSED' then
    raise exception 'CONFLICT: This issue is closed. Please report a new one.' using errcode = 'P0001';
  end if;
  if length(v_msg) < 2 or length(v_msg) > 3000 then
    raise exception 'VALIDATION_ERROR: Write your message (up to 3000 characters).' using errcode = '22023';
  end if;
  if coalesce(array_length(v_ids, 1), 0) > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    select count(distinct a.id) into v_n from public.employee_issue_attachments a
     where a.id = any (v_ids) and a.uploader_id = me.id and a.status = 'READY' and a.issue_id is null and a.bug_id is null;
    if v_n <> (select count(distinct x) from unnest(v_ids) x) then
      raise exception 'VALIDATION_ERROR: One of the files is not available any more. Please attach it again.' using errcode = '22023';
    end if;
    update public.employee_issue_attachments set bug_id = b.id where id = any (v_ids);
  end if;
  v_was := b.status;
  -- the information asked for, or "it is not fixed": back in the team's hands (In Progress when somebody already worked on it, else Pending)
  v_to := case when b.status in ('NEEDS_INFO', 'RESOLVED')
               then case when exists (select 1 from public.dev_bug_events e where e.bug_id = b.id and e.kind = 'PROGRESS') or b.assigned_to is not null then 'IN_PROGRESS' else 'PENDING' end
               else b.status end;
  update public.dev_bugs set status = v_to, resolved_at = case when private.dev_bug_open(v_to) then null else resolved_at end, updated_at = now(),
         version = case when v_to is distinct from v_was then version + 1 else version end
   where id = b.id returning * into b;
  perform private.dev_bug_event(b.id, 'MESSAGE', 'ALL', v_msg, jsonb_build_object('from', 'REPORTER', 'attachments', coalesce(array_length(v_ids, 1), 0)));
  if v_was is distinct from v_to then
    perform private.dev_bug_event(b.id, 'STATUS', 'ALL', null, jsonb_build_object('from', v_was, 'to', v_to, 'byReporter', true));
  end if;
  for d in select t.profile_id from public.dev_team_members t where private.is_developer(t.profile_id) loop
    perform private.notify_once(d.profile_id, 'DEV_BUG_FOLLOW_UP', 'Follow-up on ' || b.reference, b.reporter_name || ': ' || left(v_msg, 160),
      'dev_bug', b.id, jsonb_build_object('bugId', b.id), 'normal');
  end loop;
  perform private.write_audit('DEV_BUG_FOLLOW_UP', 'dev_bug', b.id, me.department_id, me.team_id, jsonb_build_object('reference', b.reference, 'status', v_to));
  return private.dev_bug_json(b, false);
end $$;

-- the optional primary contact (the Team Lead names one; nothing depends on it, and it never hides the bug from anyone)
create or replace function public.bug_dev_assign(p_id uuid, p_developer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
  v_was uuid;
begin
  if not private.is_bug_lead(me.id) then
    raise exception 'FORBIDDEN: Only the Team Lead of the Developers team names a primary contact.' using errcode = '42501';
  end if;
  select * into b from public.dev_bugs where id = p_id for update;
  if b.id is null then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  if p_developer is not null and (not private.is_developer(p_developer) or private.is_bug_lead(p_developer)) then
    raise exception 'VALIDATION_ERROR: Choose one of the developers of the team.' using errcode = '22023';
  end if;
  if b.assigned_to is not distinct from p_developer then
    return private.dev_bug_json(b, true);   -- nothing changes (a double click)
  end if;
  v_was := b.assigned_to;
  update public.dev_bugs
     set assigned_to = p_developer, assigned_by = me.id, assigned_at = now(), version = version + 1,
         assignment_status = case when p_developer is null then 'UNASSIGNED' else 'ASSIGNED' end
   where id = b.id returning * into b;
  insert into public.dev_bug_assignments (bug_id, assigned_to, assigned_by) values (b.id, p_developer, me.id);
  perform private.dev_bug_event(b.id, 'ASSIGNED', 'ALL', null, jsonb_build_object('from', v_was, 'to', p_developer,
    'toName', (select full_name from public.profiles where id = p_developer)));
  if p_developer is not null then
    perform private.notify(p_developer, 'DEV_BUG_ASSIGNED', 'You are the primary contact of bug ' || b.reference, left(b.title, 120) || ' — named by ' || me.full_name || '. Everyone on the team can still work on it.',
      'dev_bug', b.id, jsonb_build_object('bugId', b.id), 'normal');
  end if;
  perform private.write_audit('DEV_BUG_ASSIGNED', 'dev_bug', b.id, null, null, jsonb_build_object('from', v_was, 'to', p_developer));
  return private.dev_bug_json(b, true);
end $$;

-- an internal comment counts as an update of the bug (version) so a screen loaded before it is told
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

do $$
declare
  f text;
begin
  foreach f in array array['private.dev_bug_json(public.dev_bugs, boolean)', 'private.dev_bug_row(public.dev_bugs)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- used by the row level security policies (they answer only about the signed-in person), as before
  foreach f in array array['private.bug_visible(uuid, uuid)', 'private.bug_team_visible(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.bug_access()', 'public.bug_dev_list(text, text, text, integer, integer)', 'public.bug_dev_add_update(uuid, text, text, integer, text, integer, text)',
    'public.bug_dev_set_status(uuid, text, text)', 'public.bug_dev_reply(uuid, text, boolean)', 'public.bug_my_follow_up(uuid, text, uuid[])',
    'public.bug_dev_assign(uuid, uuid)', 'public.bug_dev_comment(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
