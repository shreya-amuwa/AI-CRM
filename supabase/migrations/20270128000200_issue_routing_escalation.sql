-- =============================================================================
-- Raise an Issue for HR, the routing of every issue, HR's escalation to the Developer Team, and the conversation with the developers
-- (docs/EMPLOYEE_ISSUES.md "Issue routing and escalation"). Run after 20270128000100_ceo_meeting_queue.sql. Additive and safe to run twice.
--
--   * Every issue has one recipient: an issue to HR is an employee_issues row (recipient HR); an issue to the Developer Team is a dev_bugs
--     row (recipient Developer Team). Nothing is ever sent to both automatically.
--   * dev_bugs gains category, priority, the affected department / employee (optional), the source (EMPLOYEE, HR_REPORT,
--     HR_ESCALATION) and source_issue_id: the employee issue HR escalated (unique: one escalation per issue, retries return the first).
--     New statuses: UNDER_REVIEW, NEEDS_INFO ("Pending information") and CLOSED, next to PENDING, IN_PROGRESS, RESOLVED and REJECTED.
--   * A conversation between the reporter and the developers (dev_bug_events kind MESSAGE, seen by both): bug_dev_reply (optionally
--     asking for information: NEEDS_INFO) and bug_my_follow_up (the reporter; a follow-up on NEEDS_INFO or RESOLVED goes back to the team).
--   * HR escalates an employee issue (issue_hr_escalate): a linked Developer Team issue whose files are the employee's own (referenced,
--     not copied: the developers who see the bug may open them), the employee is told and sees the developers' status changes on their
--     issue, and every HR person follows the developers' answers on the issue.
--   * issue_hr_list sorts (newest, oldest, priority, status, department, employee) and filters by routing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns and the allowed values
-- ---------------------------------------------------------------------------
alter table public.dev_bugs add column if not exists category text not null default 'BUG';
alter table public.dev_bugs add column if not exists priority text not null default 'MEDIUM';
alter table public.dev_bugs add column if not exists affected_department_id uuid references public.departments (id) on delete set null;
alter table public.dev_bugs add column if not exists affected_department_name text;
alter table public.dev_bugs add column if not exists affected_employee_id uuid references public.profiles (id) on delete set null;
alter table public.dev_bugs add column if not exists affected_employee_name text;
alter table public.dev_bugs add column if not exists source text not null default 'EMPLOYEE';
alter table public.dev_bugs add column if not exists source_issue_id uuid references public.employee_issues (id) on delete set null;
alter table public.dev_bugs drop constraint if exists dev_bugs_category_check;
alter table public.dev_bugs add constraint dev_bugs_category_check
  check (category in ('BUG', 'FEATURE_REQUEST', 'ACCESS_LOGIN', 'DATA_ISSUE', 'PERFORMANCE', 'OTHER'));
alter table public.dev_bugs drop constraint if exists dev_bugs_priority_check;
alter table public.dev_bugs add constraint dev_bugs_priority_check check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT'));
alter table public.dev_bugs drop constraint if exists dev_bugs_source_check;
alter table public.dev_bugs add constraint dev_bugs_source_check check (source in ('EMPLOYEE', 'HR_REPORT', 'HR_ESCALATION'));
alter table public.dev_bugs drop constraint if exists dev_bugs_status_check;
alter table public.dev_bugs add constraint dev_bugs_status_check
  check (status in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED'));
-- one escalation per employee issue, whoever presses the button and however often
create unique index if not exists dev_bugs_source_issue_uidx on public.dev_bugs (source_issue_id) where source_issue_id is not null;

alter table public.dev_bug_events drop constraint if exists dev_bug_events_kind_check;
alter table public.dev_bug_events add constraint dev_bug_events_kind_check check (kind in ('SUBMITTED', 'ASSIGNED', 'STATUS', 'COMMENT', 'MESSAGE'));

alter table public.employee_issues add column if not exists escalated_bug_id uuid references public.dev_bugs (id) on delete set null;
alter table public.employee_issues add column if not exists escalated_at timestamptz;
alter table public.employee_issues add column if not exists escalated_by uuid references public.profiles (id) on delete set null;
create index if not exists employee_issues_escalated_idx on public.employee_issues (escalated_bug_id) where escalated_bug_id is not null;

-- the employee's history shows the escalation and the developers' progress
alter table public.employee_case_events drop constraint if exists employee_case_events_kind_check;
alter table public.employee_case_events add constraint employee_case_events_kind_check check (kind in ('SUBMITTED', 'ASSIGNED', 'STATUS_CHANGED', 'RESPONSE',
  'INFO_REQUESTED', 'EMPLOYEE_REPLY', 'NOTE', 'APPROVED', 'DECLINED', 'ALTERNATIVE_PROPOSED', 'ALTERNATIVE_ACCEPTED', 'ALTERNATIVE_DECLINED', 'RESCHEDULED',
  'CANCELLED', 'COMPLETED', 'ESCALATED', 'DEV_UPDATE'));
alter table public.employee_case_events drop constraint if exists employee_case_events_actor_side_check;
alter table public.employee_case_events add constraint employee_case_events_actor_side_check check (actor_side in ('EMPLOYEE', 'HR', 'DEVELOPER'));

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.dev_bug_status_label(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'PENDING' then 'pending' when 'UNDER_REVIEW' then 'under review' when 'IN_PROGRESS' then 'in progress'
                when 'NEEDS_INFO' then 'waiting for information' when 'RESOLVED' then 'resolved' when 'REJECTED' then 'rejected'
                when 'CLOSED' then 'closed' else lower(coalesce(p, '')) end
$$;
-- the statuses of a bug the team still works on
create or replace function private.dev_bug_open(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'NEEDS_INFO')
$$;

-- the reporter's or a developer's files: a bug's own, and (an escalation) the employee issue's, referenced and never copied
create or replace function private.dev_bug_files(b public.dev_bugs)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime_type, 'size', a.size_bytes, 'fromIssue', a.bug_id is null)
           order by a.created_at, a.id), '[]'::jsonb)
    from public.employee_issue_attachments a
   where a.status = 'READY' and (a.bug_id = b.id or (b.source_issue_id is not null and a.issue_id = b.source_issue_id))
$$;

create or replace function private.dev_bug_json(b public.dev_bugs, p_dev boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'reference', b.reference, 'title', b.title, 'description', b.description, 'steps', b.steps, 'status', b.status,
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
    'category', b.category, 'priority', b.priority, 'source', b.source,
    'sourceIssueReference', (select i.issue_reference from public.employee_issues i where i.id = b.source_issue_id),
    'affectedDepartment', b.affected_department_name, 'affectedEmployee', b.affected_employee_name,
    'attachmentCount', (select count(*) from public.employee_issue_attachments a
                         where a.status = 'READY' and (a.bug_id = b.id or (b.source_issue_id is not null and a.issue_id = b.source_issue_id))),
    -- the last message of the conversation (the reporter's follow-up or a developer's reply)
    'lastMessage', (select jsonb_build_object('from', e.data ->> 'from', 'note', left(e.note, 300), 'by', (select full_name from public.profiles where id = e.actor_id), 'at', e.created_at)
                      from public.dev_bug_events e where e.bug_id = b.id and e.kind = 'MESSAGE' order by e.id desc limit 1),
    'createdAt', b.created_at, 'updatedAt', b.updated_at, 'resolvedAt', b.resolved_at)
$$;

-- an employee issue: the recipient (HR) and, once HR escalated it, the linked Developer Team issue (20261210000100 + routing)
create or replace function private.issue_json(r public.employee_issues, p_full boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'reference', r.issue_reference, 'title', r.title, 'category', r.category, 'priority', r.priority, 'status', r.status,
    'description', case when p_full then r.description end, 'preferredResolution', case when p_full then r.preferred_resolution end,
    'hrResponse', r.hr_response, 'hrResponseAt', r.hr_response_at,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'resolvedAt', r.resolved_at, 'closedAt', r.closed_at,
    'assignedHr', (select jsonb_build_object('id', h.id, 'name', h.full_name) from public.profiles h where h.id = r.assigned_hr_id),
    'employee', jsonb_build_object('id', r.employee_id, 'name', r.employee_name, 'employeeCode', r.employee_code, 'departmentId', r.department_id,
                                   'department', r.department_name, 'designation', r.designation),
    'recipient', 'HR',
    'routing', case when r.escalated_bug_id is not null then 'ESCALATED_TO_DEVELOPERS' else 'WITH_HR' end,
    'escalation', (select jsonb_build_object('bugId', b.id, 'reference', b.reference, 'status', b.status,
                     'assigneeName', (select full_name from public.profiles where id = b.assigned_to), 'resolutionNote', b.resolution_note,
                     'updatedAt', b.updated_at, 'escalatedAt', r.escalated_at, 'escalatedBy', (select full_name from public.profiles where id = r.escalated_by))
                     from public.dev_bugs b where b.id = r.escalated_bug_id))
$$;

-- the developers' progress, written on the escalated employee issue the employee follows
create or replace function private.issue_dev_update(b public.dev_bugs, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issues;
begin
  if b.source_issue_id is null then
    return;
  end if;
  select * into r from public.employee_issues where id = b.source_issue_id;
  if r.id is null then
    return;
  end if;
  insert into public.employee_case_events (issue_id, actor_id, actor_name, actor_side, kind, visibility, body, metadata)
  values (r.id, auth.uid(), (select full_name from public.profiles where id = auth.uid()), 'DEVELOPER', 'DEV_UPDATE', 'EMPLOYEE', left(p_body, 4000),
          jsonb_build_object('bugId', b.id, 'reference', b.reference, 'status', b.status));
  update public.employee_issues set updated_at = now() where id = r.id;
  perform private.notify_once(r.employee_id, 'EMPLOYEE_ISSUE_UPDATED', 'Update on your issue ' || r.issue_reference,
    'Developer Team: ' || private.dev_bug_status_label(b.status) || '.', 'employee_issue', r.id,
    jsonb_build_object('reference', r.issue_reference, 'status', r.status));
  -- HR follows the developers too
  perform private.notify_hr('EMPLOYEE_ISSUE_DEV_UPDATE', 'Developer Team update on ' || r.issue_reference,
    b.reference || ' is ' || private.dev_bug_status_label(b.status) || '.', 'employee_issue', r.id, jsonb_build_object('reference', r.issue_reference), 'normal', r.assigned_hr_id);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Report an issue to the Developer Team (an employee, or HR), with category, priority and the affected department / employee
-- ---------------------------------------------------------------------------
create or replace function public.bug_report(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  snap jsonb := private.employee_snapshot(me.id);
  v_key text := nullif(btrim(coalesce(p ->> 'clientRequestId', '')), '');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_desc text := btrim(coalesce(p ->> 'description', ''));
  v_steps text := nullif(btrim(coalesce(p ->> 'steps', '')), '');
  v_cat text := coalesce(nullif(p ->> 'category', ''), 'BUG');
  v_pri text := coalesce(nullif(p ->> 'priority', ''), 'MEDIUM');
  v_dept uuid;
  v_dept_name text;
  v_emp uuid;
  v_emp_name text;
  v_ids uuid[];
  v_n integer;
  b public.dev_bugs;
  d record;
begin
  if v_key is null or length(v_key) not between 8 and 80 then
    raise exception 'VALIDATION_ERROR: Invalid request id.' using errcode = '22023';
  end if;
  -- the same form sent twice: the first issue, nothing new
  select * into b from public.dev_bugs where reporter_id = me.id and client_request_id = v_key;
  if b.id is not null then
    return private.dev_bug_json(b, false) || jsonb_build_object('duplicate', true);
  end if;
  if length(v_title) not between 3 and 200 then
    raise exception 'VALIDATION_ERROR: Give the issue a title (3-200 characters).' using errcode = '22023';
  end if;
  if length(v_desc) not between 10 and 5000 then
    raise exception 'VALIDATION_ERROR: Describe the issue (10-5000 characters).' using errcode = '22023';
  end if;
  if length(coalesce(v_steps, '')) > 5000 then
    raise exception 'VALIDATION_ERROR: The steps to reproduce can have at most 5000 characters.' using errcode = '22023';
  end if;
  if v_cat not in ('BUG', 'FEATURE_REQUEST', 'ACCESS_LOGIN', 'DATA_ISSUE', 'PERFORMANCE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose a category.' using errcode = '22023';
  end if;
  if v_pri not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'VALIDATION_ERROR: Choose a priority.' using errcode = '22023';
  end if;
  if nullif(p ->> 'affectedDepartmentId', '') is not null then
    select id, name into v_dept, v_dept_name from public.departments where id = private.try_uuid(p ->> 'affectedDepartmentId');
    if v_dept is null then
      raise exception 'VALIDATION_ERROR: Choose the affected department from the list.' using errcode = '22023';
    end if;
  end if;
  if nullif(p ->> 'affectedEmployeeId', '') is not null then
    select id, full_name into v_emp, v_emp_name from public.profiles where id = private.try_uuid(p ->> 'affectedEmployeeId') and status = 'ACTIVE';
    if v_emp is null then
      raise exception 'VALIDATION_ERROR: Choose the affected employee from the list.' using errcode = '22023';
    end if;
  end if;
  select coalesce(array_agg(private.try_uuid(x)), '{}'::uuid[]) into v_ids from jsonb_array_elements_text(coalesce(p -> 'attachmentIds', '[]'::jsonb)) x;
  if array_position(v_ids, null) is not null then
    raise exception 'VALIDATION_ERROR: One of the files is not available any more. Please attach it again.' using errcode = '22023';
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

  insert into public.dev_bugs (reference, reporter_id, reporter_name, department_name, designation, title, description, steps, client_request_id,
                               category, priority, affected_department_id, affected_department_name, affected_employee_id, affected_employee_name, source)
  values ('BUG-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.dev_bug_reference_seq')::text, 5, '0'),
          me.id, coalesce(snap ->> 'name', me.full_name), snap ->> 'department', snap ->> 'designation', v_title, v_desc, v_steps, v_key,
          v_cat, v_pri, v_dept, v_dept_name, v_emp, v_emp_name, case when private.is_hr_staff() then 'HR_REPORT' else 'EMPLOYEE' end)
  on conflict (reporter_id, client_request_id) do nothing
  returning * into b;
  if b.id is null then
    select * into b from public.dev_bugs where reporter_id = me.id and client_request_id = v_key;
    return private.dev_bug_json(b, false) || jsonb_build_object('duplicate', true);
  end if;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    update public.employee_issue_attachments set bug_id = b.id where id = any (v_ids);
  end if;
  perform private.dev_bug_event(b.id, 'SUBMITTED', 'ALL', null, jsonb_build_object('attachments', coalesce(array_length(v_ids, 1), 0), 'source', b.source));
  for d in select t.profile_id from public.dev_team_members t where private.is_developer(t.profile_id) and t.profile_id <> me.id loop
    perform private.notify_once(d.profile_id, 'DEV_BUG_REPORTED', 'New issue ' || b.reference || ': ' || left(b.title, 80),
      'Reported by ' || b.reporter_name || coalesce(' · ' || b.department_name, '') || ' · ' || initcap(lower(b.priority)) || ' priority.',
      'dev_bug', b.id, jsonb_build_object('bugId', b.id), case when b.priority = 'URGENT' then 'urgent' else 'normal' end);
  end loop;
  perform private.write_audit('DEV_BUG_REPORTED', 'dev_bug', b.id, me.department_id, me.team_id,
    jsonb_build_object('reference', b.reference, 'source', b.source, 'category', b.category, 'priority', b.priority));
  return private.dev_bug_json(b, false) || jsonb_build_object('duplicate', false);
end $$;

-- the reporter's own issues to the Developer Team, filtered in the database
drop function if exists public.bug_my_list();
create or replace function public.bug_my_list(p_status text default null, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if p_status is not null and p_status not in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED', 'OPEN', 'DONE') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(private.dev_bug_row(b) || jsonb_build_object('resolutionNote', b.resolution_note) order by b.created_at desc)
                     from (select * from public.dev_bugs x
                            where x.reporter_id = me.id
                              and (p_status is null or case p_status when 'OPEN' then private.dev_bug_open(x.status) when 'DONE' then not private.dev_bug_open(x.status)
                                                                      else x.status = p_status end)
                              and (v_term is null or x.title ilike '%' || private.like_escape(v_term) || '%' or x.reference ilike '%' || private.like_escape(v_term) || '%')
                            order by x.created_at desc limit 200) b), '[]'::jsonb);
end $$;

-- the reporter answers the developers (a request for information, or a follow-up), optionally with files
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
  -- the information asked for, or "it is not fixed": back in the team's hands
  v_to := case when b.status in ('NEEDS_INFO', 'RESOLVED') then case when b.assigned_to is null then 'PENDING' else 'IN_PROGRESS' end else b.status end;
  update public.dev_bugs set status = v_to, resolved_at = case when private.dev_bug_open(v_to) then null else resolved_at end, updated_at = now()
   where id = b.id returning * into b;
  perform private.dev_bug_event(b.id, 'MESSAGE', 'ALL', v_msg, jsonb_build_object('from', 'REPORTER', 'attachments', coalesce(array_length(v_ids, 1), 0)));
  if v_was is distinct from v_to then
    perform private.dev_bug_event(b.id, 'STATUS', 'ALL', null, jsonb_build_object('from', v_was, 'to', v_to, 'byReporter', true));
  end if;
  -- the developer on it, or (not assigned yet) the developers who see it
  for d in select t.profile_id from public.dev_team_members t
            where private.is_developer(t.profile_id) and (t.profile_id = b.assigned_to or (b.assigned_to is null) or t.is_lead) loop
    perform private.notify_once(d.profile_id, 'DEV_BUG_FOLLOW_UP', 'Follow-up on ' || b.reference, b.reporter_name || ': ' || left(v_msg, 160),
      'dev_bug', b.id, jsonb_build_object('bugId', b.id), 'normal');
  end loop;
  perform private.write_audit('DEV_BUG_FOLLOW_UP', 'dev_bug', b.id, me.department_id, me.team_id, jsonb_build_object('reference', b.reference, 'status', v_to));
  return private.dev_bug_json(b, false);
end $$;

-- ---------------------------------------------------------------------------
-- 4. The developers: reply to the reporter, statuses (20270122000400 + the new ones and the escalation's employee)
-- ---------------------------------------------------------------------------
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
  if coalesce(p_request_info, false) and not private.is_bug_lead(me.id) and b.assigned_to is distinct from me.id then
    raise exception 'FORBIDDEN: Only the developer the bug is assigned to, or the Team Lead, asks for information. Ask the Team Lead to assign it.' using errcode = '42501';
  end if;
  v_was := b.status;
  update public.dev_bugs set status = case when coalesce(p_request_info, false) then 'NEEDS_INFO' else status end, updated_at = now()
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

create or replace function public.bug_dev_set_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_developer();
  b public.dev_bugs;
  v_was text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_status is null or p_status not in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Choose Pending, Under Review, In Progress, Pending Information, Resolved, Rejected or Closed.' using errcode = '22023';
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
         resolution_note = case when p_status in ('RESOLVED', 'REJECTED') then v_note when p_status = 'CLOSED' then coalesce(v_note, resolution_note) else resolution_note end,
         resolved_at = case when p_status in ('RESOLVED', 'REJECTED') then now() when p_status = 'CLOSED' then coalesce(resolved_at, now()) else null end
   where id = b.id returning * into b;
  perform private.dev_bug_event(b.id, 'STATUS', 'ALL', v_note, jsonb_build_object('from', v_was, 'to', p_status));
  if v_was is distinct from p_status then
    perform private.notify(b.reporter_id, 'DEV_BUG_STATUS', 'Your issue ' || b.reference || ' is ' || private.dev_bug_status_label(p_status),
      coalesce(left(v_note, 200), left(b.title, 120)), 'dev_bug', b.id, jsonb_build_object('bugId', b.id, 'status', p_status), 'normal');
    if not private.is_bug_lead(me.id) then
      perform private.notify(t.profile_id, 'DEV_BUG_PROGRESS', 'Bug ' || b.reference || ': ' || private.dev_bug_status_label(p_status),
        left(b.title, 120) || ' — by ' || me.full_name || '.', 'dev_bug', b.id, jsonb_build_object('bugId', b.id, 'status', p_status), 'normal')
        from public.dev_team_members t where t.is_lead and private.is_developer(t.profile_id);
    end if;
    -- an escalated employee issue: the employee follows the developers' progress on their own issue
    perform private.issue_dev_update(b, 'Developer Team: ' || private.dev_bug_status_label(p_status) || '.' ||
      case when p_status in ('RESOLVED', 'REJECTED', 'CLOSED') and b.resolution_note is not null then ' ' || b.resolution_note else '' end);
  end if;
  perform private.write_audit('DEV_BUG_STATUS_CHANGED', 'dev_bug', b.id, null, null, jsonb_build_object('from', v_was, 'to', p_status));
  return private.dev_bug_json(b, true);
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
  if p_status is not null and p_status not in ('PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'NEEDS_INFO', 'RESOLVED', 'REJECTED', 'CLOSED', 'OPEN', 'DONE') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = '22023';
  end if;
  return (
    with mine as (select b.* from public.dev_bugs b where v_lead or b.assigned_to is null or b.assigned_to = me.id),
    f as (
      select b.* from mine b
       where (p_status is null or case p_status when 'OPEN' then private.dev_bug_open(b.status) when 'DONE' then not private.dev_bug_open(b.status)
                                                else b.status = p_status end)
         and (p_assignee is null or case when p_assignee = 'ME' then b.assigned_to = me.id when p_assignee = 'UNASSIGNED' then b.assigned_to is null
                                         else b.assigned_to = v_who end)
         and (v_term is null or b.title ilike '%' || private.like_escape(v_term) || '%' or b.reference ilike '%' || private.like_escape(v_term) || '%'
              or b.reporter_name ilike '%' || private.like_escape(v_term) || '%' or b.affected_employee_name ilike '%' || private.like_escape(v_term) || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'isLead', v_lead,
      'counts', (select jsonb_build_object('PENDING', count(*) filter (where status = 'PENDING'), 'UNDER_REVIEW', count(*) filter (where status = 'UNDER_REVIEW'),
                   'IN_PROGRESS', count(*) filter (where status = 'IN_PROGRESS'), 'NEEDS_INFO', count(*) filter (where status = 'NEEDS_INFO'),
                   'RESOLVED', count(*) filter (where status = 'RESOLVED'), 'REJECTED', count(*) filter (where status = 'REJECTED'),
                   'CLOSED', count(*) filter (where status = 'CLOSED'), 'OPEN', count(*) filter (where private.dev_bug_open(status)),
                   'MINE', count(*) filter (where assigned_to = me.id and private.dev_bug_open(status)),
                   'UNASSIGNED', count(*) filter (where assigned_to is null and private.dev_bug_open(status))) from mine),
      'byDeveloper', case when v_lead then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name,
                         'open', (select count(*) from public.dev_bugs b where b.assigned_to = p.id and private.dev_bug_open(b.status)),
                         'closed', (select count(*) from public.dev_bugs b where b.assigned_to = p.id and not private.dev_bug_open(b.status))) order by p.full_name)
                         from public.dev_team_members t join public.profiles p on p.id = t.profile_id where not t.is_lead and p.status = 'ACTIVE'), '[]'::jsonb)
                     else '[]'::jsonb end,
      'items', coalesce((select jsonb_agg(private.dev_bug_row(x) order by x.created_at desc)
                           from (select * from f order by created_at desc offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb))
  );
end $$;

-- removing a developer sends their OPEN bugs (now including under review / waiting for information) back to unassigned (20270122000400)
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
    update public.dev_bugs set assigned_to = null, assignment_status = 'UNASSIGNED', assigned_by = auth.uid(), assigned_at = now()
     where assigned_to = p.id and private.dev_bug_open(status);
    delete from public.dev_team_members where profile_id = p.id;
  end if;
  perform private.write_audit(case when not p_member then 'DEV_TEAM_MEMBER_REMOVED' when p_lead then 'DEV_TEAM_LEAD_SET' else 'DEV_TEAM_MEMBER_ADDED' end,
    'profile', p.id, p.department_id, p.team_id, jsonb_build_object('lead', p_lead));
  return public.dev_team_list();
end $$;

-- downloading a file (20270122000400 + an escalated employee issue's files for the developers who see its Developer Team issue)
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
  if i.employee_id = auth.uid() or (private.is_hr_staff() and i.employee_id <> auth.uid()) then
    perform private.write_audit('EMPLOYEE_ISSUE_ATTACHMENT_DOWNLOADED', 'employee_issue', i.id, i.department_id, null,
      jsonb_build_object('attachment_id', r.id, 'reference', i.issue_reference));
    return r;
  end if;
  -- escalated to the Developer Team: the developers who see that issue open the employee's files (referenced, never copied)
  select * into b from public.dev_bugs where source_issue_id = i.id;
  if b.id is not null and private.bug_team_visible(b.assigned_to) then
    perform private.write_audit('DEV_BUG_ATTACHMENT_DOWNLOADED', 'dev_bug', b.id, null, null,
      jsonb_build_object('attachment_id', r.id, 'reference', b.reference, 'issue', i.issue_reference));
    return r;
  end if;
  raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- 5. HR: escalate an employee issue to the Developer Team (once), follow the developers, sort the list
-- ---------------------------------------------------------------------------
create or replace function private.issue_hr_detail_json(r public.employee_issues)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, true),
    'attachments', private.issue_attachments_json(r.id),
    -- what the developers told the reporter (status changes, replies, requests for information): every HR person follows it here
    'escalationHistory', coalesce((select private.dev_bug_json(b, false) -> 'history' from public.dev_bugs b where b.id = r.escalated_bug_id), '[]'::jsonb))
$$;

create or replace function public.issue_hr_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.employee_issues;
begin
  perform private.require_hr();
  select * into r from public.employee_issues where id = p_id and employee_id <> auth.uid();
  if r.id is null then
    raise exception 'NOT_FOUND: Issue not found.' using errcode = 'P0001';
  end if;
  return private.issue_hr_detail_json(r);
end $$;

create or replace function public.issue_hr_escalate(p_id uuid, p_note text default null, p_category text default null, p_priority text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issues := private.hr_issue_for_update(p_id);   -- HR only, never their own issue; the row is locked
  me public.profiles;
  snap jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_cat text := coalesce(nullif(p_category, ''), 'BUG');
  v_pri text := coalesce(nullif(p_priority, ''), r.priority);
  v_from text := r.status;
  v_files integer;
  b public.dev_bugs;
  d record;
begin
  select * into me from public.profiles where id = auth.uid();
  -- already escalated (a double click, a retry, another HR person): the same Developer Team issue, nothing new
  if r.escalated_bug_id is not null then
    return private.issue_hr_detail_json(r) || jsonb_build_object('duplicate', true);
  end if;
  if r.status = 'CLOSED' then
    raise exception 'CONFLICT: A closed issue cannot be escalated.' using errcode = 'P0001';
  end if;
  if v_cat not in ('BUG', 'FEATURE_REQUEST', 'ACCESS_LOGIN', 'DATA_ISSUE', 'PERFORMANCE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose a category.' using errcode = '22023';
  end if;
  if v_pri not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'VALIDATION_ERROR: Choose a priority.' using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: The note to the developers can have at most 2000 characters.' using errcode = '22023';
  end if;
  snap := private.employee_snapshot(me.id);
  insert into public.dev_bugs (reference, reporter_id, reporter_name, department_name, designation, title, description, client_request_id,
                               category, priority, affected_department_id, affected_department_name, affected_employee_id, affected_employee_name, source, source_issue_id)
  values ('BUG-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.dev_bug_reference_seq')::text, 5, '0'),
          me.id, coalesce(snap ->> 'name', me.full_name), snap ->> 'department', snap ->> 'designation',
          left(r.title, 200),
          left(r.description || case when v_note is not null then E'\n\nNote from HR (' || me.full_name || '): ' || v_note else '' end, 5000),
          'esc-' || r.id::text || '-' || to_char(clock_timestamp(), 'YYMMDDHH24MISS'),
          v_cat, v_pri, r.department_id, r.department_name, r.employee_id, r.employee_name, 'HR_ESCALATION', r.id)
  on conflict (source_issue_id) where source_issue_id is not null do nothing
  returning * into b;
  if b.id is null then
    -- escalated a moment ago by another HR person: link to theirs
    select * into b from public.dev_bugs where source_issue_id = r.id;
  end if;
  update public.employee_issues
     set escalated_bug_id = b.id, escalated_at = coalesce(escalated_at, now()), escalated_by = coalesce(escalated_by, me.id),
         status = case when status = 'NEW' then 'IN_PROGRESS' else status end,
         assigned_hr_id = coalesce(assigned_hr_id, (select p.id from public.profiles p join public.departments dep on dep.id = p.department_id where p.id = me.id and dep.slug = 'hr'))
   where id = r.id returning * into r;
  select count(*) into v_files from public.employee_issue_attachments a where a.issue_id = r.id and a.status = 'READY';
  perform private.dev_bug_event(b.id, 'SUBMITTED', 'ALL', 'Escalated by HR from the employee issue ' || r.issue_reference || '.',
    jsonb_build_object('source', 'HR_ESCALATION', 'issue', r.issue_reference, 'attachments', v_files));
  perform private.case_event(r.id, null, 'HR', 'ESCALATED', 'EMPLOYEE', 'HR escalated this issue to the Developer Team (' || b.reference || ').',
    v_from, r.status, jsonb_build_object('bugId', b.id, 'reference', b.reference));
  perform private.notify_once(r.employee_id, 'EMPLOYEE_ISSUE_UPDATED', 'Update on your issue ' || r.issue_reference,
    'HR escalated it to the Developer Team (' || b.reference || '). You can follow their progress on your issue.', 'employee_issue', r.id,
    jsonb_build_object('reference', r.issue_reference, 'status', r.status));
  for d in select t.profile_id from public.dev_team_members t where private.is_developer(t.profile_id) and t.profile_id <> me.id loop
    perform private.notify_once(d.profile_id, 'DEV_BUG_REPORTED', 'Escalated by HR ' || b.reference || ': ' || left(b.title, 80),
      'From ' || r.employee_name || coalesce(' · ' || r.department_name, '') || ' · ' || initcap(lower(b.priority)) || ' priority.',
      'dev_bug', b.id, jsonb_build_object('bugId', b.id), case when b.priority = 'URGENT' then 'urgent' else 'normal' end);
  end loop;
  perform private.write_audit('EMPLOYEE_ISSUE_ESCALATED', 'employee_issue', r.id, r.department_id, null,
    jsonb_build_object('reference', r.issue_reference, 'bug', b.reference, 'bug_id', b.id, 'priority', b.priority, 'category', b.category));
  return private.issue_hr_detail_json(r) || jsonb_build_object('duplicate', false);
end $$;

create or replace function public.issue_hr_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_hr();
  return (select jsonb_build_object(
    'total', count(*), 'new', count(*) filter (where status = 'NEW'), 'inProgress', count(*) filter (where status = 'IN_PROGRESS'),
    'awaiting', count(*) filter (where status = 'AWAITING_EMPLOYEE'), 'resolved', count(*) filter (where status = 'RESOLVED'),
    'closed', count(*) filter (where status = 'CLOSED'), 'urgent', count(*) filter (where priority = 'URGENT' and status not in ('RESOLVED', 'CLOSED')),
    'escalated', count(*) filter (where escalated_bug_id is not null))
    from public.employee_issues where employee_id <> auth.uid());
end $$;

-- the list (20261210000100) with a sort order and the routing filter
drop function if exists public.issue_hr_list(text, uuid, text, text, uuid, boolean, timestamptz, timestamptz, text, integer, integer);
create or replace function public.issue_hr_list(p_status text default null, p_department uuid default null, p_priority text default null, p_category text default null,
  p_assignee uuid default null, p_unassigned boolean default false, p_from timestamptz default null, p_to timestamptz default null, p_search text default null,
  p_limit integer default 20, p_offset integer default 0, p_sort text default 'NEWEST', p_routing text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_sort text := coalesce(nullif(p_sort, ''), 'NEWEST');
begin
  perform private.require_hr();
  if v_sort not in ('NEWEST', 'OLDEST', 'PRIORITY', 'STATUS', 'DEPARTMENT', 'EMPLOYEE') then
    raise exception 'VALIDATION_ERROR: Unknown sort order.' using errcode = '22023';
  end if;
  if p_routing is not null and p_routing not in ('', 'ALL', 'WITH_HR', 'ESCALATED_TO_DEVELOPERS') then
    raise exception 'VALIDATION_ERROR: Unknown routing.' using errcode = '22023';
  end if;
  return (
    with f as (
      select i.* from public.employee_issues i
       where i.employee_id <> auth.uid()
         and (p_status is null or p_status in ('', 'ALL') or i.status = p_status)
         and (p_department is null or i.department_id = p_department)
         and (p_priority is null or p_priority in ('', 'ALL') or i.priority = p_priority)
         and (p_category is null or p_category in ('', 'ALL') or i.category = p_category)
         and (p_assignee is null or i.assigned_hr_id = p_assignee)
         and (not coalesce(p_unassigned, false) or i.assigned_hr_id is null)
         and (p_from is null or i.created_at >= p_from) and (p_to is null or i.created_at < p_to)
         and (p_routing is null or p_routing in ('', 'ALL') or (p_routing = 'ESCALATED_TO_DEVELOPERS') = (i.escalated_bug_id is not null))
         and (v_q is null or i.employee_name ilike '%' || private.like_escape(v_q) || '%' or i.issue_reference ilike '%' || private.like_escape(v_q) || '%'
              or i.title ilike '%' || private.like_escape(v_q) || '%')),
    pg as (
      select f.id, row_number() over (order by
          case when v_sort = 'PRIORITY' then case f.priority when 'URGENT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end end,
          case when v_sort = 'STATUS' then case f.status when 'NEW' then 0 when 'AWAITING_EMPLOYEE' then 1 when 'IN_PROGRESS' then 2 when 'RESOLVED' then 3 else 4 end end,
          case when v_sort = 'DEPARTMENT' then lower(coalesce(f.department_name, '~')) end,
          case when v_sort = 'EMPLOYEE' then lower(f.employee_name) end,
          case when v_sort = 'OLDEST' then f.created_at end asc,
          f.created_at desc, f.id desc) as rn
        from f)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(private.issue_json(i, false) order by pg.rn)
                           from pg join public.employee_issues i on i.id = pg.id where pg.rn > v_off and pg.rn <= v_off + v_limit), '[]'::jsonb),
      'total', (select count(*) from f), 'limit', v_limit, 'offset', v_off));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.dev_bug_files(public.dev_bugs)', 'private.dev_bug_json(public.dev_bugs, boolean)', 'private.dev_bug_row(public.dev_bugs)',
    'private.issue_dev_update(public.dev_bugs, text)', 'private.issue_hr_detail_json(public.employee_issues)', 'private.issue_json(public.employee_issues, boolean)',
    'private.dev_bug_status_label(text)', 'private.dev_bug_open(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.bug_report(jsonb)', 'public.bug_my_list(text, text)', 'public.bug_my_follow_up(uuid, text, uuid[])',
    'public.bug_dev_reply(uuid, text, boolean)', 'public.bug_dev_set_status(uuid, text, text)', 'public.bug_dev_list(text, text, text, integer, integer)',
    'public.dev_team_set(uuid, boolean, boolean)', 'public.issue_attachment_download(uuid)', 'public.issue_hr_detail(uuid)',
    'public.issue_hr_escalate(uuid, text, text, text)', 'public.issue_hr_overview()',
    'public.issue_hr_list(text, uuid, text, text, uuid, boolean, timestamptz, timestamptz, text, integer, integer, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
