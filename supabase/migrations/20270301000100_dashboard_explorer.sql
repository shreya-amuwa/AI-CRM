-- =============================================================================
-- Dashboard Explorer (docs/DASHBOARD_EXPLORER.md): the Managing Director (SUPER_ADMIN) previews every position's dashboard with
-- demonstration data in an isolated, sandboxed preview that never reaches this database. The ONLY things stored here are:
--   1. the administrative audit of a preview (who, which dashboard / department / scenario, when it started and ended) in audit_logs;
--   2. dashboard improvement requests, filed into the existing Developer Team issues (dev_bugs, source DASHBOARD_EXPLORER, category
--      FEATURE_REQUEST) with the dashboard, page and viewport they are about - the Developer Team handles them like any other issue and the
--      Managing Director is notified of status changes by the existing DEV_BUG_STATUS notification.
-- No demonstration record, no employee account, no session and no token is created; no role, department or permission changes.
-- "Recently viewed" is read from the Managing Director's own audit entries (no extra table).
--
-- Only an ACTIVE SUPER_ADMIN may call these functions. A CEO (is_operations_head) or anyone else gets FORBIDDEN.
-- Safe to run twice (create or replace / add column if not exists / drop constraint if exists). Pasteable as one script.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The allowlist (kept identical to shared/dashboardExplorer.ts; supabase/tests/dashboard_explorer.test.ts compares them)
-- ---------------------------------------------------------------------------
create or replace function private.dashboard_explorer_ids()
returns text[] language sql immutable set search_path = '' as $$
  select array['ceo-sales','ceo-support','ceo-multi','sales-department-head','sales-team-lead','sales-team-member','telecaller','business-associate',
               'visit-sales','influencer','business-partner','support-department-head','support-team-lead','support-team-member','meta-verifier',
               'technical-consultant','hr-department-head','hr-team-lead','hr-assistant','hr-recruiter','accounts-department-head','accounts-team-lead',
               'accounts-team-member','ai-studio-head','ai-studio-lead','ai-studio-member','design-studio-head','design-studio-lead','design-studio-member',
               'unified-head','unified-lead','unified-member','general-team-lead','general-team-member']::text[]
$$;
create or replace function private.dashboard_explorer_departments()
returns text[] language sql immutable set search_path = '' as $$
  select array['mpillar','wabastore','whatsbox','dtalk','digitree','designstudio','edutraining','international','reseller','hr','accounts',
               'ai-studio','ai-design-studio']::text[]
$$;
revoke all on function private.dashboard_explorer_ids() from public, anon, authenticated;
revoke all on function private.dashboard_explorer_departments() from public, anon, authenticated;

-- The caller must be the active Managing Director. is_operations_head (CEO) is a Department Head flag, so a CEO never passes.
create or replace function private.dashboard_explorer_actor()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Dashboard Explorer is only for the Managing Director.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.dashboard_explorer_actor() from public, anon, authenticated;

create or replace function private.dashboard_explorer_check(p jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if not (coalesce(p ->> 'dashboardId', '') = any (private.dashboard_explorer_ids())) then
    raise exception 'VALIDATION_ERROR: Choose a dashboard from the list.' using errcode = '22023';
  end if;
  if not (coalesce(p ->> 'department', '') = any (private.dashboard_explorer_departments())) then
    raise exception 'VALIDATION_ERROR: Choose a department from the list.' using errcode = '22023';
  end if;
end $$;
revoke all on function private.dashboard_explorer_check(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Preview audit: start, end, recently viewed
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_explorer_session_start(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.dashboard_explorer_actor();
  v_session uuid := gen_random_uuid();
  v_scenario text := coalesce(nullif(p ->> 'scenario', ''), 'normal');
begin
  perform private.dashboard_explorer_check(p);
  if v_scenario !~ '^[a-z-]{2,40}$' then
    raise exception 'VALIDATION_ERROR: Choose a scenario from the list.' using errcode = '22023';
  end if;
  -- an administrative record of the Managing Director's own action; it is never an employee sign-in and names no employee
  perform private.write_audit('DASHBOARD_PREVIEW_STARTED', 'dashboard_preview', v_session, null, null,
    jsonb_build_object('dashboardId', p ->> 'dashboardId', 'department', p ->> 'department', 'scenario', v_scenario));
  return jsonb_build_object('sessionId', v_session, 'startedAt', now());
end $$;
revoke all on function public.dashboard_explorer_session_start(jsonb) from public, anon;
grant execute on function public.dashboard_explorer_session_start(jsonb) to authenticated;

create or replace function public.dashboard_explorer_session_end(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.dashboard_explorer_actor();
  started public.audit_logs;
begin
  select * into started from public.audit_logs
   where action = 'DASHBOARD_PREVIEW_STARTED' and entity_id = p_session and actor_id = me.id;
  if started.id is null then
    raise exception 'NOT_FOUND: This preview was not found.' using errcode = 'P0001';
  end if;
  -- ending twice (two tabs, a retry) records it once
  if not exists (select 1 from public.audit_logs where action = 'DASHBOARD_PREVIEW_ENDED' and entity_id = p_session and actor_id = me.id) then
    perform private.write_audit('DASHBOARD_PREVIEW_ENDED', 'dashboard_preview', p_session, null, null,
      jsonb_build_object('dashboardId', started.metadata ->> 'dashboardId', 'department', started.metadata ->> 'department',
                         'seconds', greatest(0, extract(epoch from now() - started.created_at))::integer));
  end if;
  return jsonb_build_object('sessionId', p_session, 'ended', true);
end $$;
revoke all on function public.dashboard_explorer_session_end(uuid) from public, anon;
grant execute on function public.dashboard_explorer_session_end(uuid) to authenticated;

create or replace function public.dashboard_explorer_recent()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.dashboard_explorer_actor();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('dashboardId', r.dashboard_id, 'department', r.department, 'viewedAt', r.viewed_at) order by r.viewed_at desc)
      from (select a.metadata ->> 'dashboardId' as dashboard_id, a.metadata ->> 'department' as department, max(a.created_at) as viewed_at
              from public.audit_logs a
             where a.actor_id = me.id and a.action = 'DASHBOARD_PREVIEW_STARTED'
               and a.created_at > now() - interval '90 days'
               and (a.metadata ->> 'dashboardId') = any (private.dashboard_explorer_ids())
             group by 1, 2
             order by 3 desc
             limit 8) r), '[]'::jsonb);
end $$;
revoke all on function public.dashboard_explorer_recent() from public, anon;
grant execute on function public.dashboard_explorer_recent() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Improvement requests: the existing Developer Team issues, with the dashboard context
-- ---------------------------------------------------------------------------
alter table public.dev_bugs add column if not exists context jsonb;
alter table public.dev_bugs drop constraint if exists dev_bugs_source_check;
alter table public.dev_bugs add constraint dev_bugs_source_check check (source in ('EMPLOYEE', 'HR_REPORT', 'HR_ESCALATION', 'DASHBOARD_EXPLORER'));
create index if not exists dev_bugs_explorer_idx on public.dev_bugs (reporter_id, created_at desc) where source = 'DASHBOARD_EXPLORER';

create or replace function public.dashboard_explorer_suggest(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.dashboard_explorer_actor();
  v_key text := nullif(btrim(coalesce(p ->> 'clientRequestId', '')), '');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_desc text := btrim(coalesce(p ->> 'description', ''));
  v_expected text := nullif(btrim(coalesce(p ->> 'expected', '')), '');
  v_pri text := coalesce(nullif(p ->> 'priority', ''), 'MEDIUM');
  v_viewport text := coalesce(nullif(p ->> 'viewport', ''), 'desktop');
  v_page text := left(btrim(coalesce(p ->> 'page', '')), 300);
  v_page_title text := left(btrim(coalesce(p ->> 'pageTitle', '')), 200);
  v_build text := left(btrim(coalesce(p ->> 'build', '')), 80);
  v_context jsonb;
  v_steps text;
  v_ids uuid[];
  v_n integer;
  b public.dev_bugs;
  d record;
begin
  perform private.dashboard_explorer_check(p);
  if v_key is null or length(v_key) not between 8 and 80 then
    raise exception 'VALIDATION_ERROR: Invalid request id.' using errcode = '22023';
  end if;
  -- the same form sent twice (double click, retry): the first request, nothing new
  select * into b from public.dev_bugs where reporter_id = me.id and client_request_id = v_key;
  if b.id is not null then
    return jsonb_build_object('id', b.id, 'reference', b.reference, 'status', b.status, 'duplicate', true);
  end if;
  if length(v_title) not between 3 and 200 then
    raise exception 'VALIDATION_ERROR: Give the improvement a title (3-200 characters).' using errcode = '22023';
  end if;
  if length(v_desc) not between 10 and 5000 then
    raise exception 'VALIDATION_ERROR: Describe the improvement (10-5000 characters).' using errcode = '22023';
  end if;
  if length(coalesce(v_expected, '')) > 3000 then
    raise exception 'VALIDATION_ERROR: The expected behaviour can have at most 3000 characters.' using errcode = '22023';
  end if;
  if v_pri not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'VALIDATION_ERROR: Choose a priority.' using errcode = '22023';
  end if;
  if v_viewport not in ('desktop', 'tablet', 'mobile') then
    raise exception 'VALIDATION_ERROR: Choose a viewport.' using errcode = '22023';
  end if;
  select coalesce(array_agg(private.try_uuid(x)), '{}'::uuid[]) into v_ids from jsonb_array_elements_text(coalesce(p -> 'attachmentIds', '[]'::jsonb)) x;
  if array_position(v_ids, null) is not null or coalesce(array_length(v_ids, 1), 0) > 5 then
    raise exception 'VALIDATION_ERROR: Attach up to 5 files from the list.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    select count(distinct a.id) into v_n from public.employee_issue_attachments a
     where a.id = any (v_ids) and a.uploader_id = me.id and a.status = 'READY' and a.issue_id is null and a.bug_id is null;
    if v_n <> (select count(distinct x) from unnest(v_ids) x) then
      raise exception 'VALIDATION_ERROR: One of the files is not available any more. Please attach it again.' using errcode = '22023';
    end if;
  end if;
  if (select count(*) from public.dev_bugs where reporter_id = me.id and source = 'DASHBOARD_EXPLORER' and created_at > now() - interval '1 day') >= 30 then
    raise exception 'VALIDATION_ERROR: You have sent 30 improvement requests today. Please try again tomorrow.' using errcode = '22023';
  end if;

  v_context := jsonb_build_object('dashboardId', p ->> 'dashboardId', 'department', p ->> 'department', 'page', v_page, 'pageTitle', v_page_title,
                                  'viewport', v_viewport, 'build', nullif(v_build, ''));
  -- the Developer Team's issue screen shows "steps": the exact dashboard, page and screen size the request is about
  v_steps := format('Dashboard Explorer improvement request%sDashboard: %s%sDepartment: %s%sPage: %s%sViewport: %s%s%s',
    E'\n', p ->> 'dashboardId', E'\n', p ->> 'department', E'\n', coalesce(nullif(v_page_title, '') || ' (' || nullif(v_page, '') || ')', nullif(v_page, ''), 'not recorded'),
    E'\n', v_viewport, case when v_build <> '' then E'\nBuild: ' || v_build else '' end,
    case when v_expected is not null then E'\n\nExpected behaviour:\n' || v_expected else '' end);

  insert into public.dev_bugs (reference, reporter_id, reporter_name, department_name, designation, title, description, steps, client_request_id,
                               category, priority, source, context)
  values ('BUG-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.dev_bug_reference_seq')::text, 5, '0'),
          me.id, me.full_name, 'Management', 'Managing Director', v_title, v_desc, v_steps, v_key, 'FEATURE_REQUEST', v_pri, 'DASHBOARD_EXPLORER', v_context)
  on conflict (reporter_id, client_request_id) do nothing
  returning * into b;
  if b.id is null then
    select * into b from public.dev_bugs where reporter_id = me.id and client_request_id = v_key;
    return jsonb_build_object('id', b.id, 'reference', b.reference, 'status', b.status, 'duplicate', true);
  end if;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    update public.employee_issue_attachments set bug_id = b.id where id = any (v_ids);
  end if;
  perform private.dev_bug_event(b.id, 'SUBMITTED', 'ALL', null, jsonb_build_object('attachments', coalesce(array_length(v_ids, 1), 0), 'source', b.source));
  for d in select t.profile_id from public.dev_team_members t where private.is_developer(t.profile_id) and t.profile_id <> me.id loop
    perform private.notify_once(d.profile_id, 'DEV_BUG_REPORTED', 'Dashboard improvement ' || b.reference || ': ' || left(b.title, 70),
      'From the Managing Director (Dashboard Explorer) · ' || (p ->> 'dashboardId') || ' · ' || initcap(lower(b.priority)) || ' priority.',
      'dev_bug', b.id, jsonb_build_object('bugId', b.id), case when b.priority = 'URGENT' then 'urgent' else 'normal' end);
  end loop;
  perform private.write_audit('DASHBOARD_IMPROVEMENT_REQUESTED', 'dev_bug', b.id, null, null,
    jsonb_build_object('reference', b.reference, 'dashboardId', p ->> 'dashboardId', 'department', p ->> 'department', 'priority', b.priority));
  return jsonb_build_object('id', b.id, 'reference', b.reference, 'status', b.status, 'duplicate', false);
end $$;
revoke all on function public.dashboard_explorer_suggest(jsonb) from public, anon;
grant execute on function public.dashboard_explorer_suggest(jsonb) to authenticated;

-- The Managing Director's own improvement requests and how far the Developer Team got (the status names are the Developer Team's)
create or replace function public.dashboard_explorer_requests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.dashboard_explorer_actor();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'reference', b.reference, 'title', b.title, 'priority', b.priority, 'status', b.status,
                                        'dashboardId', b.context ->> 'dashboardId', 'department', b.context ->> 'department',
                                        'page', b.context ->> 'pageTitle', 'viewport', b.context ->> 'viewport', 'resolutionNote', b.resolution_note,
                                        'createdAt', b.created_at, 'updatedAt', b.updated_at) order by b.created_at desc)
      from (select * from public.dev_bugs where reporter_id = me.id and source = 'DASHBOARD_EXPLORER' order by created_at desc limit 100) b), '[]'::jsonb);
end $$;
revoke all on function public.dashboard_explorer_requests() from public, anon;
grant execute on function public.dashboard_explorer_requests() to authenticated;
