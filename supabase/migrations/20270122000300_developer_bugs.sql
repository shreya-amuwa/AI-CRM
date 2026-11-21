-- =============================================================================
-- Report a bug to the Developers team, and the developers' Bugs section (docs/EMPLOYEE_ISSUES.md "Bugs for the Developers team").
-- Run after 20270122000200_client_meetings.sql. Additive and safe to run twice.
--
--   * dev_team_members: the developers who may open the Bugs section. Seeded with Shreya Mande, Ashish Sinha and Siddhesh Shinde, matched by
--     name among the active members of AI Studio (the AI CRM team). The Super Admin can add or remove a developer later (dev_team_set), but
--     does NOT get the Bugs section: only the developers on this list do. Nobody else, in any department, sees a bug except their own.
--   * dev_bugs: one bug, with the reporter's name, department and designation copied from their profile at submission (never sent by the
--     browser), title, description, steps to reproduce, status PENDING / IN_PROGRESS / RESOLVED / REJECTED, the assigned developer and the
--     resolution note. One per form (clientRequestId), at most 20 a day per person.
--   * dev_bug_events: the append-only history (updates and deletes are refused): submitted, assigned, status changes, internal comments
--     (DEV: developers only) and the resolution. The reporter sees status changes and the resolution note, never internal comments.
--   * Screenshots and files: the existing issue attachment pipeline (issue_begin_upload / complete, the private bucket, the type and size
--     checks, short signed links). An attachment now belongs either to an issue or to a bug (employee_issue_attachments.bug_id); its download
--     is allowed to the reporter and the developers, and audited.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The developers
-- ---------------------------------------------------------------------------
create table if not exists public.dev_team_members (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.dev_team_members enable row level security;
revoke all on public.dev_team_members from public, anon, authenticated;

insert into public.dev_team_members (profile_id)
select p.id from public.profiles p join public.departments d on d.id = p.department_id
 where d.slug = 'ai-studio' and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
   and lower(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g')) in ('shreya mande', 'ashish sinha', 'siddhesh shinde')
on conflict do nothing;

create or replace function private.is_developer(p_profile uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dev_team_members t join public.profiles p on p.id = t.profile_id
                  where t.profile_id = coalesce(p_profile, auth.uid()) and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN')
$$;

create or replace function private.require_developer()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or not private.is_developer(me.id) then
    raise exception 'FORBIDDEN: The Bugs section is for the Developers team only.' using errcode = '42501';
  end if;
  return me;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Bugs and their history
-- ---------------------------------------------------------------------------
create sequence if not exists public.dev_bug_reference_seq;
create table if not exists public.dev_bugs (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reporter_name text not null,
  department_name text,
  designation text,
  title text not null check (length(btrim(title)) between 3 and 200),
  description text not null check (length(btrim(description)) between 10 and 5000),
  steps text check (steps is null or length(steps) <= 5000),
  status text not null default 'PENDING' check (status in ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
  assignee_id uuid references public.profiles (id) on delete set null,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 3000),
  client_request_id text not null check (length(client_request_id) between 8 and 80),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reporter_id, client_request_id)
);
create index if not exists dev_bugs_status_idx on public.dev_bugs (status, created_at desc);
create index if not exists dev_bugs_reporter_idx on public.dev_bugs (reporter_id, created_at desc);
create index if not exists dev_bugs_assignee_idx on public.dev_bugs (assignee_id, status) where assignee_id is not null;

create table if not exists public.dev_bug_events (
  id bigint generated always as identity primary key,
  bug_id uuid not null references public.dev_bugs (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('SUBMITTED', 'ASSIGNED', 'STATUS', 'COMMENT')),
  visibility text not null default 'ALL' check (visibility in ('ALL', 'DEV')),
  note text check (note is null or length(note) <= 3000),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists dev_bug_events_bug_idx on public.dev_bug_events (bug_id, id);

alter table public.dev_bugs enable row level security;
alter table public.dev_bug_events enable row level security;
revoke all on public.dev_bugs, public.dev_bug_events from public, anon, authenticated;
revoke all on sequence public.dev_bug_reference_seq from public, anon, authenticated;

drop trigger if exists dev_bugs_set_updated_at on public.dev_bugs;
create trigger dev_bugs_set_updated_at before update on public.dev_bugs for each row execute function public.tg_set_updated_at();

-- the history is kept as it happened
create or replace function private.tg_dev_bug_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'FORBIDDEN: The bug history cannot be changed.' using errcode = '42501';
end $$;
drop trigger if exists dev_bug_events_append_only on public.dev_bug_events;
create trigger dev_bug_events_append_only before update or delete on public.dev_bug_events
  for each row when (pg_trigger_depth() = 0) execute function private.tg_dev_bug_events_append_only();

-- an attachment belongs to an issue or to a bug
alter table public.employee_issue_attachments add column if not exists bug_id uuid references public.dev_bugs (id) on delete cascade;
create index if not exists employee_issue_attachments_bug_idx on public.employee_issue_attachments (bug_id, created_at) where bug_id is not null;

-- issues attach only files not given to a bug (20261210000100 + bug_id)
create or replace function private.issue_attach(p_issue uuid, p_event bigint, p_attachments uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := coalesce(p_attachments, '{}'::uuid[]);
  v_n integer;
begin
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(v_ids, 1) > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files at a time.' using errcode = 'P0001';
  end if;
  select count(distinct a.id) into v_n from public.employee_issue_attachments a
   where a.id = any (v_ids) and a.uploader_id = auth.uid() and a.status = 'READY' and a.issue_id is null and a.bug_id is null;
  if v_n <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'VALIDATION_ERROR: One of the files is not available any more. Please attach it again.' using errcode = 'P0001';
  end if;
  update public.employee_issue_attachments set issue_id = p_issue, event_id = p_event where id = any (v_ids);
  return v_n;
end $$;

-- downloading a file: as before, plus a bug's files for the reporter and the developers (20261210000100 + bugs)
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
    if not (b.reporter_id = auth.uid() or private.is_developer(auth.uid())) then
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
-- 3. JSON
-- ---------------------------------------------------------------------------
create or replace function private.dev_bug_json(b public.dev_bugs, p_dev boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'reference', b.reference, 'title', b.title, 'description', b.description, 'steps', b.steps, 'status', b.status,
    'reporterId', b.reporter_id, 'reporterName', b.reporter_name, 'department', b.department_name, 'designation', b.designation,
    'assigneeId', b.assignee_id, 'assigneeName', (select full_name from public.profiles where id = b.assignee_id),
    'resolutionNote', b.resolution_note, 'resolvedAt', b.resolved_at, 'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime_type, 'size', a.size_bytes) order by a.created_at)
                    from public.employee_issue_attachments a where a.bug_id = b.id and a.status = 'READY'), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'internal', e.visibility = 'DEV', 'note', e.note, 'data', e.data,
                    'by', (select full_name from public.profiles where id = e.actor_id), 'at', e.created_at) order by e.id)
                    from public.dev_bug_events e where e.bug_id = b.id and (p_dev or e.visibility = 'ALL')), '[]'::jsonb))
$$;

create or replace function private.dev_bug_row(b public.dev_bugs)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'reference', b.reference, 'title', b.title, 'status', b.status, 'reporterName', b.reporter_name,
    'department', b.department_name, 'designation', b.designation, 'assigneeId', b.assignee_id,
    'assigneeName', (select full_name from public.profiles where id = b.assignee_id),
    'attachmentCount', (select count(*) from public.employee_issue_attachments a where a.bug_id = b.id and a.status = 'READY'),
    'createdAt', b.created_at, 'updatedAt', b.updated_at, 'resolvedAt', b.resolved_at)
$$;

create or replace function private.dev_bug_event(p_bug uuid, p_kind text, p_visibility text, p_note text, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.dev_bug_events (bug_id, actor_id, kind, visibility, note, data) values (p_bug, auth.uid(), p_kind, p_visibility, p_note, coalesce(p_data, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 4. The employee: report a bug, follow their own bugs
-- ---------------------------------------------------------------------------
create or replace function public.bug_submit(p_title text, p_description text, p_steps text default null, p_attachments uuid[] default null, p_client_request_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  snap jsonb := private.employee_snapshot(me.id);
  v_key text := nullif(btrim(coalesce(p_client_request_id, '')), '');
  v_ids uuid[] := coalesce(p_attachments, '{}'::uuid[]);
  b public.dev_bugs;
  v_n integer;
  d record;
begin
  if v_key is null or length(v_key) not between 8 and 80 then
    raise exception 'VALIDATION_ERROR: Invalid request id.' using errcode = '22023';
  end if;
  -- the same form sent twice: the first bug, nothing new
  select * into b from public.dev_bugs where reporter_id = me.id and client_request_id = v_key;
  if b.id is not null then
    return private.dev_bug_json(b, false) || jsonb_build_object('duplicate', true);
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 3 and 200 then
    raise exception 'VALIDATION_ERROR: Give the issue a title (3-200 characters).' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_description, ''))) not between 10 and 5000 then
    raise exception 'VALIDATION_ERROR: Describe the issue (10-5000 characters).' using errcode = '22023';
  end if;
  if length(coalesce(p_steps, '')) > 5000 then
    raise exception 'VALIDATION_ERROR: The steps to reproduce can have at most 5000 characters.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_ids, 1), 0) > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files.' using errcode = '22023';
  end if;
  if (select count(*) from public.dev_bugs where reporter_id = me.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'VALIDATION_ERROR: You have reported 20 issues today. Please try again tomorrow.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    select count(distinct a.id) into v_n from public.employee_issue_attachments a
     where a.id = any (v_ids) and a.uploader_id = me.id and a.status = 'READY' and a.issue_id is null and a.bug_id is null;
    if v_n <> (select count(distinct x) from unnest(v_ids) x) then
      raise exception 'VALIDATION_ERROR: One of the files is not available any more. Please attach it again.' using errcode = '22023';
    end if;
  end if;

  insert into public.dev_bugs (reference, reporter_id, reporter_name, department_name, designation, title, description, steps, client_request_id)
  values ('BUG-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.dev_bug_reference_seq')::text, 5, '0'),
          me.id, coalesce(snap ->> 'name', me.full_name), snap ->> 'department', snap ->> 'designation',
          btrim(p_title), btrim(p_description), nullif(btrim(coalesce(p_steps, '')), ''), v_key)
  on conflict (reporter_id, client_request_id) do nothing
  returning * into b;
  if b.id is null then
    select * into b from public.dev_bugs where reporter_id = me.id and client_request_id = v_key;
    return private.dev_bug_json(b, false) || jsonb_build_object('duplicate', true);
  end if;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    update public.employee_issue_attachments set bug_id = b.id where id = any (v_ids);
  end if;
  perform private.dev_bug_event(b.id, 'SUBMITTED', 'ALL', null, jsonb_build_object('attachments', coalesce(array_length(v_ids, 1), 0)));
  -- every developer, once (the title only: the description stays in the CRM)
  for d in select t.profile_id from public.dev_team_members t where private.is_developer(t.profile_id) and t.profile_id <> me.id loop
    perform private.notify_once(d.profile_id, 'DEV_BUG_REPORTED', 'New bug ' || b.reference || ': ' || left(b.title, 80),
      'Reported by ' || b.reporter_name || coalesce(' · ' || b.department_name, '') || '.', 'dev_bug', b.id, jsonb_build_object('bugId', b.id), 'normal');
  end loop;
  perform private.write_audit('DEV_BUG_REPORTED', 'dev_bug', b.id, me.department_id, me.team_id, jsonb_build_object('reference', b.reference));
  return private.dev_bug_json(b, false) || jsonb_build_object('duplicate', false);
end $$;

create or replace function public.bug_my_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
begin
  return coalesce((select jsonb_agg(private.dev_bug_row(b) || jsonb_build_object('resolutionNote', b.resolution_note) order by b.created_at desc)
                     from (select * from public.dev_bugs where reporter_id = me.id order by created_at desc limit 200) b), '[]'::jsonb);
end $$;

create or replace function public.bug_my_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  b public.dev_bugs;
begin
  select * into b from public.dev_bugs where id = p_id and reporter_id = me.id;
  if b.id is null then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  return private.dev_bug_json(b, false);
end $$;

-- ---------------------------------------------------------------------------
-- 5. The developers: list, open, assign, status, comments
-- ---------------------------------------------------------------------------
-- who am I for the Bugs section: a developer (and the list of developers to assign to), or not
create or replace function public.bug_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.is_developer(auth.uid()) then
    return jsonb_build_object('isDeveloper', false, 'developers', '[]'::jsonb);
  end if;
  return jsonb_build_object('isDeveloper', true,
    'developers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
                              from public.dev_team_members t join public.profiles p on p.id = t.profile_id
                             where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb));
end $$;

create or replace function public.bug_dev_list(p_status text default null, p_assignee text default null, p_search text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_who uuid := private.try_uuid(p_assignee);
begin
  if p_status is not null and p_status not in ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'OPEN', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = '22023';
  end if;
  return (
    with f as (
      select b.* from public.dev_bugs b
       where (p_status is null or case p_status when 'OPEN' then b.status in ('PENDING', 'IN_PROGRESS') when 'CLOSED' then b.status in ('RESOLVED', 'REJECTED')
                                                else b.status = p_status end)
         and (p_assignee is null or case when p_assignee = 'ME' then b.assignee_id = me.id when p_assignee = 'UNASSIGNED' then b.assignee_id is null
                                         else b.assignee_id = v_who end)
         and (v_term is null or b.title ilike '%' || private.like_escape(v_term) || '%' or b.reference ilike '%' || private.like_escape(v_term) || '%'
              or b.reporter_name ilike '%' || private.like_escape(v_term) || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'counts', (select jsonb_build_object('PENDING', count(*) filter (where status = 'PENDING'), 'IN_PROGRESS', count(*) filter (where status = 'IN_PROGRESS'),
                   'RESOLVED', count(*) filter (where status = 'RESOLVED'), 'REJECTED', count(*) filter (where status = 'REJECTED'),
                   'MINE', count(*) filter (where assignee_id = me.id and status in ('PENDING', 'IN_PROGRESS')),
                   'UNASSIGNED', count(*) filter (where assignee_id is null and status in ('PENDING', 'IN_PROGRESS'))) from public.dev_bugs),
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
  if b.id is null then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  return private.dev_bug_json(b, true);
end $$;

create or replace function public.bug_dev_assign(p_id uuid, p_developer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
  v_was uuid;
begin
  select * into b from public.dev_bugs where id = p_id for update;
  if b.id is null then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  if p_developer is not null and not private.is_developer(p_developer) then
    raise exception 'VALIDATION_ERROR: A bug can only be assigned to a member of the Developers team.' using errcode = '22023';
  end if;
  if b.assignee_id is not distinct from p_developer then
    return private.dev_bug_json(b, true);   -- nothing changes (a double click)
  end if;
  v_was := b.assignee_id;
  update public.dev_bugs set assignee_id = p_developer where id = b.id returning * into b;
  perform private.dev_bug_event(b.id, 'ASSIGNED', 'ALL', null, jsonb_build_object('from', v_was, 'to', p_developer,
    'toName', (select full_name from public.profiles where id = p_developer)));
  if p_developer is not null and p_developer <> me.id then
    perform private.notify(p_developer, 'DEV_BUG_ASSIGNED', 'Bug ' || b.reference || ' assigned to you', left(b.title, 120) || ' — by ' || me.full_name || '.',
      'dev_bug', b.id, jsonb_build_object('bugId', b.id), 'normal');
  end if;
  perform private.write_audit('DEV_BUG_ASSIGNED', 'dev_bug', b.id, null, null, jsonb_build_object('from', v_was, 'to', p_developer));
  return private.dev_bug_json(b, true);
end $$;

-- RESOLVED needs the resolution note and REJECTED the reason (the reporter reads them); PENDING / IN_PROGRESS take an optional note
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
  if b.id is null then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  if b.status = p_status and v_note is null then
    return private.dev_bug_json(b, true);
  end if;
  v_was := b.status;
  update public.dev_bugs
     set status = p_status,
         resolution_note = case when p_status in ('RESOLVED', 'REJECTED') then v_note else resolution_note end,
         resolved_at = case when p_status in ('RESOLVED', 'REJECTED') then now() else null end,
         -- starting work on an unassigned bug takes it
         assignee_id = case when p_status = 'IN_PROGRESS' and assignee_id is null then me.id else assignee_id end
   where id = b.id returning * into b;
  perform private.dev_bug_event(b.id, 'STATUS', 'ALL', v_note, jsonb_build_object('from', v_was, 'to', p_status));
  if v_was is distinct from p_status then
    perform private.notify(b.reporter_id, 'DEV_BUG_STATUS', 'Your bug ' || b.reference || ' is ' ||
        case p_status when 'PENDING' then 'pending' when 'IN_PROGRESS' then 'in progress' when 'RESOLVED' then 'resolved' else 'rejected' end,
      coalesce(left(v_note, 200), left(b.title, 120)), 'dev_bug', b.id, jsonb_build_object('bugId', b.id, 'status', p_status), 'normal');
  end if;
  perform private.write_audit('DEV_BUG_STATUS_CHANGED', 'dev_bug', b.id, null, null, jsonb_build_object('from', v_was, 'to', p_status));
  return private.dev_bug_json(b, true);
end $$;

-- an internal comment: developers only, never shown to the reporter
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
  if b.id is null then
    raise exception 'NOT_FOUND: Bug not found.' using errcode = 'P0002';
  end if;
  perform private.dev_bug_event(b.id, 'COMMENT', 'DEV', v_note, '{}'::jsonb);
  update public.dev_bugs set updated_at = now() where id = b.id returning * into b;
  return private.dev_bug_json(b, true);
end $$;

-- ---------------------------------------------------------------------------
-- 6. The Super Admin keeps the developers list (and has no Bugs section)
-- ---------------------------------------------------------------------------
create or replace function public.dev_team_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'SUPER_ADMIN' and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Only the Super Admin manages the Developers team.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'active', p.status = 'ACTIVE',
            'department', (select name from public.departments where id = p.department_id), 'addedAt', t.created_at) order by p.full_name)
            from public.dev_team_members t join public.profiles p on p.id = t.profile_id), '[]'::jsonb);
end $$;

create or replace function public.dev_team_set(p_profile uuid, p_member boolean)
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
    insert into public.dev_team_members (profile_id, added_by) values (p.id, auth.uid()) on conflict do nothing;
  else
    delete from public.dev_team_members where profile_id = p.id;
  end if;
  perform private.write_audit(case when p_member then 'DEV_TEAM_MEMBER_ADDED' else 'DEV_TEAM_MEMBER_REMOVED' end, 'profile', p.id, p.department_id, p.team_id, '{}'::jsonb);
  return public.dev_team_list();
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['private.is_developer(uuid)', 'private.require_developer()', 'private.dev_bug_json(public.dev_bugs, boolean)',
    'private.dev_bug_row(public.dev_bugs)', 'private.dev_bug_event(uuid, text, text, text, jsonb)', 'private.tg_dev_bug_events_append_only()',
    'private.issue_attach(uuid, bigint, uuid[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.bug_submit(text, text, text, uuid[], text)', 'public.bug_my_list()', 'public.bug_my_detail(uuid)', 'public.bug_access()',
    'public.bug_dev_list(text, text, text, integer, integer)', 'public.bug_dev_detail(uuid)', 'public.bug_dev_assign(uuid, uuid)',
    'public.bug_dev_set_status(uuid, text, text)', 'public.bug_dev_comment(uuid, text)', 'public.dev_team_list()', 'public.dev_team_set(uuid, boolean)',
    'public.issue_attachment_download(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
