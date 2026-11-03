-- =============================================================================
-- The HR Recruiter workspace, on top of the records the CRM already keeps (nothing is copied):
--
--   vacancy        career_postings (the job the Candidate Portal shows) + hr_positions (title, department). New columns: number of openings, vacancy status
--                  (Draft / Pending approval / Open / On hold / Closed / Filled), the responsible recruiter, qualifications, skills, experience and the steps
--                  the vacancy requires before someone can be selected. The Candidate Portal still only accepts applications for an OPEN vacancy:
--                  career_postings.published and the status always agree (a trigger keeps them in step in both directions, so the older HR screen keeps working).
--   application    career_applications (one per candidate and vacancy) with the candidate's original answers in its snapshot, untouched.
--   candidate      hr_candidates (the internal record), hr_candidate_calls (calls), career_attempts (tests), career_interviews (interviews).
--   recruiter's    recruiter_notes (internal notes and evaluations, apart from the candidate's data), recruiter_stage_history (every change: before, after, who,
--   own records    when, why), recruiter_decisions (the final decision, see the previous migration).
--
-- A Recruiter sees the vacancies assigned to them (and the unassigned ones as a queue, without candidate data) and the applications of those vacancies.
-- The Super Admin and the Department Head of HR see everything and allocate vacancies. Every function checks this itself; the tables have no grants.
--
-- Safe to run again. Run after 20261222000200_recruitment_decision_email.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The vacancy
-- ---------------------------------------------------------------------------
alter table public.career_postings
  add column if not exists openings integer not null default 1,
  add column if not exists vacancy_status text not null default 'DRAFT',
  add column if not exists responsible_id uuid references public.profiles (id) on delete set null,
  add column if not exists qualifications text,
  add column if not exists skills text,
  add column if not exists experience text,
  add column if not exists required_steps text[] not null default '{}',
  add column if not exists approved_at timestamptz,
  add column if not exists status_note text;
alter table public.career_postings drop constraint if exists career_postings_openings_check;
alter table public.career_postings add constraint career_postings_openings_check check (openings between 1 and 500);
alter table public.career_postings drop constraint if exists career_postings_vacancy_status_check;
alter table public.career_postings add constraint career_postings_vacancy_status_check check (vacancy_status in ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED'));
alter table public.career_postings drop constraint if exists career_postings_required_steps_check;
alter table public.career_postings add constraint career_postings_required_steps_check check (required_steps <@ array['CALL', 'ASSESSMENT', 'INTERVIEW']::text[]);
alter table public.career_postings drop constraint if exists career_postings_text_len_check;
alter table public.career_postings add constraint career_postings_text_len_check
  check (length(qualifications) <= 4000 and length(skills) <= 4000 and length(experience) <= 2000 and length(status_note) <= 500);
create index if not exists career_postings_responsible_idx on public.career_postings (responsible_id) where responsible_id is not null;
create index if not exists career_postings_status_idx on public.career_postings (vacancy_status);

-- Jobs that are published today are the open vacancies of today (once; a job unpublished later keeps its own status).
update public.career_postings set vacancy_status = 'OPEN', approved_at = coalesce(approved_at, created_at) where published and vacancy_status = 'DRAFT';

-- published and vacancy_status never disagree. Changing the status decides; changing only `published` (the older HR screen) maps onto the status.
create or replace function private.tg_career_posting_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.published and new.vacancy_status = 'DRAFT' then
      new.vacancy_status := 'OPEN';
    end if;
  elsif new.vacancy_status is distinct from old.vacancy_status then
    null;
  elsif new.published is distinct from old.published then
    new.vacancy_status := case when new.published then 'OPEN' when old.vacancy_status = 'OPEN' then 'ON_HOLD' else old.vacancy_status end;
  end if;
  new.published := (new.vacancy_status = 'OPEN');
  if new.vacancy_status = 'OPEN' and new.approved_at is null then
    new.approved_at := now();
  end if;
  return new;
end $$;
revoke all on function private.tg_career_posting_status() from public, anon, authenticated;
drop trigger if exists career_postings_status on public.career_postings;
create trigger career_postings_status before insert or update on public.career_postings
  for each row execute function private.tg_career_posting_status();

-- The job form of the HR Assistant (Recruitment Management) also saves the vacancy fields. Everything it did before is unchanged.
create or replace function public.hr_career_posting(p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.career_postings; pid uuid; v_steps text[]; v_resp uuid;
begin
  perform private.hr_require_staff();
  if p_data is not null then
    pid := nullif(p_data->>'id','')::uuid;
    if length(btrim(coalesce(p_data->>'title',''))) not between 2 and 160 or length(coalesce(p_data->>'description','')) not between 20 and 15000
      or length(btrim(coalesce(p_data->>'location',''))) not between 1 and 200 or p_data->>'employment_type' not in ('FULL_TIME','PART_TIME','INTERNSHIP','CONTRACT') then
      raise exception 'VALIDATION_ERROR: Complete the job title, description, location and employment type.';
    end if;
    if not exists(select 1 from public.hr_positions where id=(p_data->>'position_id')::uuid and is_open) then raise exception 'VALIDATION_ERROR: Choose an open HR position.'; end if;
    if p_data ? 'openings' and ((p_data->>'openings') !~ '^[0-9]{1,3}$' or (p_data->>'openings')::int not between 1 and 500) then raise exception 'VALIDATION_ERROR: The number of openings must be between 1 and 500.'; end if;
    if p_data ? 'vacancy_status' and p_data->>'vacancy_status' not in ('DRAFT','PENDING_APPROVAL','OPEN','ON_HOLD','CLOSED','FILLED') then raise exception 'VALIDATION_ERROR: Choose a valid vacancy status.'; end if;
    if length(coalesce(p_data->>'qualifications','')) > 4000 or length(coalesce(p_data->>'skills','')) > 4000 or length(coalesce(p_data->>'experience','')) > 2000 then raise exception 'VALIDATION_ERROR: Keep the requirements shorter.'; end if;
    if p_data ? 'required_steps' then
      select coalesce(array_agg(distinct s), '{}') into v_steps from jsonb_array_elements_text(case when jsonb_typeof(p_data->'required_steps') = 'array' then p_data->'required_steps' else '[]'::jsonb end) s;
      if not (v_steps <@ array['CALL','ASSESSMENT','INTERVIEW']::text[]) then raise exception 'VALIDATION_ERROR: Choose the required steps from call, assessment and interview.'; end if;
    end if;
    -- allocating a vacancy to a Recruiter is leadership's decision (Super Admin / Department Head of HR); an HR Assistant keeps the existing allocation
    if p_data ? 'responsible_id' and not private.is_hr_leadership()
       and nullif(p_data->>'responsible_id','')::uuid is distinct from (select responsible_id from public.career_postings where id = nullif(p_data->>'id','')::uuid) then
      raise exception 'FORBIDDEN: Only the Super Admin or the Department Head of HR allocates vacancies to a recruiter.';
    end if;
    if p_data ? 'responsible_id' and nullif(p_data->>'responsible_id','') is not null then
      v_resp := (p_data->>'responsible_id')::uuid;
      if not exists (select 1 from public.profiles r join public.departments d on d.id = r.department_id
                      where r.id = v_resp and r.status = 'ACTIVE' and d.slug = 'hr' and r.hr_sub_role = 'HR_RECRUITER') then
        raise exception 'VALIDATION_ERROR: Choose an active HR Recruiter.';
      end if;
    end if;
    if pid is null then
      insert into public.career_postings(position_id,title,description,location,employment_type,published,closes_at,openings,vacancy_status,responsible_id,qualifications,skills,experience,required_steps)
      values((p_data->>'position_id')::uuid,btrim(p_data->>'title'),p_data->>'description',p_data->>'location',p_data->>'employment_type',coalesce((p_data->>'published')::boolean,false),nullif(p_data->>'closes_at','')::timestamptz,
        coalesce((p_data->>'openings')::int,1), coalesce(nullif(p_data->>'vacancy_status',''),'DRAFT'), v_resp, nullif(btrim(p_data->>'qualifications'),''), nullif(btrim(p_data->>'skills'),''), nullif(btrim(p_data->>'experience'),''), coalesce(v_steps,'{}')) returning * into v;
    else
      select * into v from public.career_postings where id=pid for update;
      if v.id is null then raise exception 'NOT_FOUND: Job not found.'; end if;
      if (p_data->>'version')::integer is distinct from v.version then raise exception 'CONFLICT: This job changed. Reload before saving.'; end if;
      update public.career_postings set title=btrim(p_data->>'title'),description=p_data->>'description',location=p_data->>'location',
        employment_type=p_data->>'employment_type',published=coalesce((p_data->>'published')::boolean, published),closes_at=nullif(p_data->>'closes_at','')::timestamptz,
        openings=case when p_data ? 'openings' then (p_data->>'openings')::int else openings end,
        vacancy_status=case when p_data ? 'vacancy_status' then p_data->>'vacancy_status' else vacancy_status end,
        responsible_id=case when p_data ? 'responsible_id' then v_resp else responsible_id end,
        qualifications=case when p_data ? 'qualifications' then nullif(btrim(p_data->>'qualifications'),'') else qualifications end,
        skills=case when p_data ? 'skills' then nullif(btrim(p_data->>'skills'),'') else skills end,
        experience=case when p_data ? 'experience' then nullif(btrim(p_data->>'experience'),'') else experience end,
        required_steps=case when p_data ? 'required_steps' then v_steps else required_steps end,
        version=version+1,updated_at=now() where id=pid returning * into v;
    end if;
    perform private.write_audit('CAREER_JOB_SAVED','career_posting',v.id,null,null,jsonb_build_object('version',v.version,'published',v.published,'status',v.vacancy_status));
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.career_postings order by created_at desc limit 200) x),'[]');
end $$;
revoke all on function public.hr_career_posting(jsonb) from public,anon;
grant execute on function public.hr_career_posting(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Calls and interviews: the outcomes and the details a Recruiter records
-- ---------------------------------------------------------------------------
alter table public.hr_candidate_calls drop constraint if exists hr_candidate_calls_outcome_check;
alter table public.hr_candidate_calls add constraint hr_candidate_calls_outcome_check
  check (outcome in ('ANSWERED', 'NO_ANSWER', 'CALL_BACK', 'NOT_INTERESTED', 'WRONG_NUMBER', 'INTERESTED', 'UNREACHABLE'));

-- A call belongs to ONE application (a candidate who applied to two vacancies of the same position has one HR record but two independent pipelines).
-- Calls HR logged before this column existed (no application) still show on every application of that candidate.
alter table public.hr_candidate_calls add column if not exists application_id uuid references public.career_applications (id) on delete cascade;
create index if not exists hr_candidate_calls_application_idx on public.hr_candidate_calls (application_id) where application_id is not null;

create or replace function private.recruiter_calls_of(p_application uuid)
returns setof public.hr_candidate_calls language sql stable security definer set search_path = '' as $$
  select c.* from public.hr_candidate_calls c join public.career_applications a on a.id = p_application
   where c.application_id = a.id or (c.application_id is null and c.candidate_id = a.hr_candidate_id)
$$;
revoke all on function private.recruiter_calls_of(uuid) from public, anon, authenticated;

alter table public.career_interviews
  add column if not exists interviewer_id uuid references public.profiles (id) on delete set null,
  add column if not exists interviewer_name text,
  add column if not exists mode text,
  add column if not exists booked_by text not null default 'HR',
  add column if not exists confirmed_at timestamptz,
  add column if not exists rescheduled_from uuid references public.career_interviews (id) on delete set null,
  add column if not exists recorded_by uuid references public.profiles (id) on delete set null;
alter table public.career_interviews drop constraint if exists career_interviews_recommendation_check;
alter table public.career_interviews add constraint career_interviews_recommendation_check
  check (recommendation in ('PROCEED', 'REJECT', 'HOLD', 'SHORTLIST', 'FURTHER_EVALUATION'));
alter table public.career_interviews drop constraint if exists career_interviews_mode_check;
alter table public.career_interviews add constraint career_interviews_mode_check check (mode is null or mode in ('IN_PERSON', 'PHONE', 'VIDEO', 'OTHER'));
alter table public.career_interviews drop constraint if exists career_interviews_booked_by_check;
alter table public.career_interviews add constraint career_interviews_booked_by_check check (booked_by in ('HR', 'CANDIDATE'));

-- ---------------------------------------------------------------------------
-- 3. The Recruiter's own records
-- ---------------------------------------------------------------------------
create table if not exists public.recruiter_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.career_applications (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text,
  kind text not null default 'NOTE' check (kind in ('NOTE', 'EVALUATION')),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists recruiter_notes_application_idx on public.recruiter_notes (application_id, created_at desc);

create table if not exists public.recruiter_stage_history (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.career_applications (id) on delete cascade,
  previous_status text,
  new_status text not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  comment text check (length(comment) <= 1000)
);
create index if not exists recruiter_stage_history_application_idx on public.recruiter_stage_history (application_id, id);

-- the one flag a Recruiter raises by hand: "ready for the selection decision"
create table if not exists public.recruiter_applications (
  application_id uuid primary key references public.career_applications (id) on delete cascade,
  selection_review_at timestamptz,
  selection_review_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.recruiter_notes enable row level security;
alter table public.recruiter_stage_history enable row level security;
alter table public.recruiter_applications enable row level security;
revoke all on public.recruiter_notes, public.recruiter_stage_history, public.recruiter_applications from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Who sees what
-- ---------------------------------------------------------------------------
-- The applications a Recruiter works on: those of the vacancies assigned to them, and the candidates HR assigned to them personally. HR leadership: all.
create or replace function private.recruiter_can_access(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_hr_leadership() or (private.is_hr_recruiter() and exists (
    select 1 from public.career_applications a join public.career_postings j on j.id = a.posting_id left join public.hr_candidates hc on hc.id = a.hr_candidate_id
     where a.id = p_application and (j.responsible_id = auth.uid() or hc.owner_id = auth.uid())))
$$;
revoke all on function private.recruiter_can_access(uuid) from public, anon;
grant execute on function private.recruiter_can_access(uuid) to authenticated, service_role;

create or replace function private.recruiter_assert_access(p_application uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  if not private.recruiter_can_access(p_application) then
    raise exception 'NOT_FOUND: Application not found.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.recruiter_assert_access(uuid) from public, anon, authenticated;

-- The pipeline stage of an application, worked out from the real records (the furthest point it has reached).
create or replace function private.recruiter_stage_of(p_application uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  a public.career_applications;
begin
  select * into a from public.career_applications where id = p_application;
  if a.id is null then return null; end if;
  if a.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED') then return 'SELECTED'; end if;
  if a.stage = 'REJECTED' then return 'REJECTED'; end if;
  if a.stage = 'ON_HOLD' then return 'ON_HOLD'; end if;
  if a.stage = 'WITHDRAWN' then return 'WITHDRAWN'; end if;
  if exists (select 1 from public.recruiter_applications r where r.application_id = a.id and r.selection_review_at is not null) then return 'SELECTION_REVIEW'; end if;
  if exists (select 1 from public.career_interviews i where i.application_id = a.id and i.status = 'SCHEDULED') then return 'INTERVIEW_SCHEDULED'; end if;
  if exists (select 1 from public.career_interviews i where i.application_id = a.id and i.status = 'COMPLETED') then return 'INTERVIEW_COMPLETED'; end if;
  if exists (select 1 from public.career_attempts t where t.application_id = a.id and t.training_enrollment_id is null and t.submitted_at is not null) then return 'TEST_COMPLETED'; end if;
  if exists (select 1 from public.career_attempts t where t.application_id = a.id and t.training_enrollment_id is null and t.submitted_at is null) then return 'TEST_PENDING'; end if;
  if exists (select 1 from private.recruiter_calls_of(a.id) c where true and c.called_at is not null) then return 'CALL_COMPLETED'; end if;
  if exists (select 1 from private.recruiter_calls_of(a.id) c where true and c.called_at is null) then return 'CALL_SCHEDULED'; end if;
  if a.stage in ('SCREENING', 'ASSESSMENT', 'INTERVIEW') then return 'INITIAL_SCREENING'; end if;
  return 'NEW_APPLICATION';
end $$;
revoke all on function private.recruiter_stage_of(uuid) from public, anon, authenticated;

-- every change a Recruiter makes writes what the stage was, what it is now, who and why
create or replace function private.recruiter_log(p_application uuid, p_before text, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_after text := private.recruiter_stage_of(p_application);
begin
  if p_before is distinct from v_after or nullif(btrim(coalesce(p_comment, '')), '') is not null then
    insert into public.recruiter_stage_history (application_id, previous_status, new_status, updated_by, updated_by_name, comment)
    select p_application, p_before, v_after, p.id, p.full_name, left(nullif(btrim(p_comment), ''), 1000)
      from (select 1) x left join public.profiles p on p.id = auth.uid();
  end if;
end $$;
revoke all on function private.recruiter_log(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The applications the caller may see, one row each, with their pipeline fields
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'private' and t.typname = 'recruiter_row') then
    create type private.recruiter_row as (
      application_id uuid, applicant_id uuid, hr_candidate_id uuid, posting_id uuid, vacancy_title text, department_id uuid, department text, position_title text,
      name text, email text, phone text, applied_at timestamptz, career_stage text, version integer, pipeline_stage text, test_status text, test_score integer,
      interview_status text, call_status text, next_at timestamptz, next_kind text, assigned_id uuid, assigned_name text, decision text, decided_at timestamptz);
  end if;
end $$;

drop function if exists private.recruiter_rows();
create or replace function private.recruiter_rows()
returns setof private.recruiter_row
language sql stable security definer set search_path = '' as $$
  select a.id, a.applicant_id, a.hr_candidate_id, a.posting_id, j.title, pos.department_id, dep.name, pos.title,
         coalesce(nullif(btrim(ap.name), ''), hc.name), lower(au.email), coalesce(nullif(ap.phone, ''), hc.phone), a.created_at, a.stage, a.version,
         private.recruiter_stage_of(a.id),
         case when not exists (select 1 from public.career_attempts t where t.application_id = a.id and t.training_enrollment_id is null) then 'NONE'
              when exists (select 1 from public.career_attempts t where t.application_id = a.id and t.training_enrollment_id is null and t.submitted_at is null) then 'PENDING'
              when exists (select 1 from public.career_attempts t where t.application_id = a.id and t.training_enrollment_id is null and t.passed) then 'PASSED'
              else 'FAILED' end,
         (select t.score from public.career_attempts t where t.application_id = a.id and t.training_enrollment_id is null and t.submitted_at is not null order by t.submitted_at desc limit 1),
         case when exists (select 1 from public.career_interviews i where i.application_id = a.id and i.status = 'SCHEDULED') then 'SCHEDULED'
              when exists (select 1 from public.career_interviews i where i.application_id = a.id and i.status = 'COMPLETED') then 'COMPLETED'
              when exists (select 1 from public.career_interviews i where i.application_id = a.id) then 'CANCELLED' else 'NONE' end,
         case when exists (select 1 from private.recruiter_calls_of(a.id) c where true and c.called_at is null) then 'SCHEDULED'
              when exists (select 1 from private.recruiter_calls_of(a.id) c where true and c.called_at is not null) then 'COMPLETED' else 'NONE' end,
         nx.at, nx.kind,
         coalesce(hc.owner_id, j.responsible_id), rp.full_name,
         cd.decision, cd.decided_at
    from public.career_applications a
    join public.career_postings j on j.id = a.posting_id
    join public.career_applicants ap on ap.id = a.applicant_id
    join auth.users au on au.id = a.applicant_id
    left join public.hr_candidates hc on hc.id = a.hr_candidate_id
    left join public.hr_positions pos on pos.id = j.position_id
    left join public.departments dep on dep.id = pos.department_id
    left join public.profiles rp on rp.id = coalesce(hc.owner_id, j.responsible_id)
    left join public.recruiter_decisions cd on cd.application_id = a.id and cd.is_current
    left join lateral (
      select x.at, x.kind from (
        select i.scheduled_at as at, 'INTERVIEW' as kind from public.career_interviews i where i.application_id = a.id and i.status = 'SCHEDULED' and i.scheduled_at >= now() - interval '1 day'
        union all
        select c.scheduled_at, 'CALL' from private.recruiter_calls_of(a.id) c where true and c.called_at is null and c.scheduled_at is not null
        union all
        select t.available_until, 'TEST' from public.career_attempts t where t.application_id = a.id and t.training_enrollment_id is null and t.submitted_at is null and t.available_until > now()
      ) x order by x.at limit 1) nx on true
   where private.recruiter_can_access(a.id)
$$;
revoke all on function private.recruiter_rows() from public, anon, authenticated;

create or replace function private.recruiter_row_json(r private.recruiter_row)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'applicationId', r.application_id, 'candidateId', r.hr_candidate_id, 'postingId', r.posting_id, 'vacancy', r.vacancy_title, 'department', r.department,
    'designation', r.position_title, 'name', r.name, 'email', r.email, 'phone', r.phone, 'appliedAt', r.applied_at, 'status', r.career_stage, 'version', r.version,
    'stage', r.pipeline_stage, 'testStatus', r.test_status, 'testScore', r.test_score, 'interviewStatus', r.interview_status, 'callStatus', r.call_status,
    'nextAt', r.next_at, 'nextKind', r.next_kind, 'recruiterId', r.assigned_id, 'recruiter', r.assigned_name, 'decision', r.decision, 'decidedAt', r.decided_at)
$$;

-- the filters every list shares: vacancy, department, designation, dates, text, stage, status, assessment, interview, recruiter, result
create or replace function private.recruiter_filtered(p_filters jsonb)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select private.recruiter_row_json(r)
    from private.recruiter_rows() r
   where (nullif(p_filters ->> 'posting', '') is null or r.posting_id = (p_filters ->> 'posting')::uuid)
     and (nullif(p_filters ->> 'department', '') is null or r.department_id = (p_filters ->> 'department')::uuid)
     and (nullif(p_filters ->> 'designation', '') is null or r.position_title ilike (p_filters ->> 'designation'))
     and (nullif(p_filters ->> 'from', '') is null or r.applied_at >= ((p_filters ->> 'from')::date)::timestamp at time zone 'Asia/Kolkata')
     and (nullif(p_filters ->> 'to', '') is null or r.applied_at < (((p_filters ->> 'to')::date) + 1)::timestamp at time zone 'Asia/Kolkata')
     and (nullif(p_filters ->> 'search', '') is null or r.name ilike '%' || (p_filters ->> 'search') || '%' or r.email ilike '%' || (p_filters ->> 'search') || '%')
     and (nullif(p_filters ->> 'stage', '') is null or r.pipeline_stage = p_filters ->> 'stage')
     and (nullif(p_filters ->> 'status', '') is null or r.career_stage = p_filters ->> 'status')
     and (nullif(p_filters ->> 'assessment', '') is null or r.test_status = p_filters ->> 'assessment')
     and (nullif(p_filters ->> 'interview', '') is null or r.interview_status = p_filters ->> 'interview')
     and (nullif(p_filters ->> 'recruiter', '') is null or r.assigned_id = (p_filters ->> 'recruiter')::uuid)
     and (nullif(p_filters ->> 'result', '') is null
          or (p_filters ->> 'result' = 'SELECTED' and r.pipeline_stage = 'SELECTED')
          or (p_filters ->> 'result' = 'REJECTED' and r.pipeline_stage = 'REJECTED')
          or (p_filters ->> 'result' = 'ON_HOLD' and r.pipeline_stage = 'ON_HOLD')
          or (p_filters ->> 'result' = 'PENDING' and r.pipeline_stage not in ('SELECTED', 'REJECTED', 'ON_HOLD', 'WITHDRAWN')))
$$;
revoke all on function private.recruiter_filtered(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Who am I, and the people a vacancy can be given to
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  perform private.recruiter_require();
  select * into me from public.profiles where id = auth.uid();
  return jsonb_build_object(
    'id', me.id, 'name', me.full_name, 'email', me.email, 'designation', case when me.hr_sub_role = 'HR_RECRUITER' then 'HR Recruiter' else coalesce(nullif(me."position", ''), me.role::text) end,
    'isRecruiter', private.is_hr_recruiter(), 'isLeadership', private.is_hr_leadership(),
    'newApplications', (select count(*) from private.recruiter_rows() r where r.career_stage = 'SUBMITTED' and r.pipeline_stage = 'NEW_APPLICATION'),
    'overdueFollowUps', (select count(*) from public.career_applications a cross join lateral private.recruiter_calls_of(a.id) c
                          where c.follow_up_date < private.hr_today() and private.recruiter_can_access(a.id)
                            and not exists (select 1 from private.recruiter_calls_of(a.id) n where n.created_at > c.created_at)),
    'vacanciesInQueue', (select count(*) from public.career_postings j where j.responsible_id is null and j.vacancy_status = 'OPEN'));
end $$;
revoke all on function public.recruiter_context() from public, anon;
grant execute on function public.recruiter_context() to authenticated;

create or replace function public.recruiter_directory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  if not private.is_hr_leadership() then
    raise exception 'FORBIDDEN: Only HR leadership allocates vacancies.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
                     from public.profiles p join public.departments d on d.id = p.department_id
                    where p.status = 'ACTIVE' and d.slug = 'hr' and p.hr_sub_role = 'HR_RECRUITER'), '[]'::jsonb);
end $$;
revoke all on function public.recruiter_directory() from public, anon;
grant execute on function public.recruiter_directory() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Vacancies
-- ---------------------------------------------------------------------------
create or replace function private.vacancy_json(j public.career_postings)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', j.id, 'title', j.title, 'designation', pos.title, 'departmentId', pos.department_id, 'department', dep.name, 'location', j.location, 'employmentType', j.employment_type,
    'openings', j.openings, 'status', j.vacancy_status, 'createdAt', j.created_at, 'closesAt', j.closes_at, 'approvedAt', j.approved_at,
    'responsibleId', j.responsible_id, 'responsible', r.full_name, 'queue', j.responsible_id is null,
    'applications', (select count(*) from public.career_applications a where a.posting_id = j.id),
    'screening', (select count(*) from public.career_applications a where a.posting_id = j.id and a.stage in ('SCREENING', 'ASSESSMENT')),
    'interviewsScheduled', (select count(*) from public.career_applications a where a.posting_id = j.id and exists (select 1 from public.career_interviews i where i.application_id = a.id and i.status = 'SCHEDULED')),
    'selected', (select count(*) from public.career_applications a where a.posting_id = j.id and a.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED')),
    'remaining', greatest(j.openings - (select count(*) from public.career_applications a where a.posting_id = j.id and a.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED')), 0),
    'requiredSteps', j.required_steps)
  from public.hr_positions pos left join public.departments dep on dep.id = pos.department_id left join public.profiles r on r.id = j.responsible_id
  where pos.id = j.position_id
$$;
revoke all on function private.vacancy_json(public.career_postings) from public, anon, authenticated;

-- A Recruiter: their vacancies and the unassigned ones (a queue: counts only, no candidates). Leadership: all.
create or replace function public.recruiter_vacancies(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  if p_status is not null and p_status not in ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED') then
    raise exception 'VALIDATION_ERROR: Choose a valid vacancy status.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(private.vacancy_json(j) order by (j.vacancy_status = 'OPEN') desc, j.created_at desc)
                     from public.career_postings j
                    where (p_status is null or j.vacancy_status = p_status)
                      and (private.is_hr_leadership() or j.responsible_id = auth.uid() or (j.responsible_id is null and j.vacancy_status <> 'DRAFT'))), '[]'::jsonb);
end $$;
revoke all on function public.recruiter_vacancies(text) from public, anon;
grant execute on function public.recruiter_vacancies(text) to authenticated;

create or replace function public.recruiter_vacancy(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  j public.career_postings;
begin
  perform private.recruiter_require();
  select * into j from public.career_postings where id = p_id;
  if j.id is null or not (private.is_hr_leadership() or j.responsible_id = auth.uid() or (j.responsible_id is null and j.vacancy_status <> 'DRAFT')) then
    raise exception 'NOT_FOUND: Vacancy not found.' using errcode = 'P0001';
  end if;
  return private.vacancy_json(j) || jsonb_build_object(
    'description', j.description, 'qualifications', j.qualifications, 'skills', j.skills, 'experience', j.experience, 'statusNote', j.status_note,
    'canManage', private.is_hr_leadership(), 'canAct', private.is_hr_leadership() or coalesce(j.responsible_id = auth.uid(), false),
    'candidates', coalesce((select jsonb_agg(c order by (c ->> 'appliedAt') desc) from private.recruiter_filtered(jsonb_build_object('posting', j.id)) c), '[]'::jsonb));
end $$;
revoke all on function public.recruiter_vacancy(uuid) from public, anon;
grant execute on function public.recruiter_vacancy(uuid) to authenticated;

-- Allocate (or take away) the responsible Recruiter: HR leadership only. The Recruiter is told.
create or replace function public.recruiter_vacancy_assign(p_id uuid, p_recruiter uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.career_postings;
begin
  perform private.recruiter_require();
  if not private.is_hr_leadership() then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head of HR allocates vacancies.' using errcode = '42501';
  end if;
  select * into j from public.career_postings where id = p_id for update;
  if j.id is null then
    raise exception 'NOT_FOUND: Vacancy not found.' using errcode = 'P0001';
  end if;
  if p_recruiter is not null and not exists (select 1 from public.profiles r join public.departments d on d.id = r.department_id
                                              where r.id = p_recruiter and r.status = 'ACTIVE' and d.slug = 'hr' and r.hr_sub_role = 'HR_RECRUITER') then
    raise exception 'VALIDATION_ERROR: Choose an active HR Recruiter.' using errcode = 'P0001';
  end if;
  update public.career_postings set responsible_id = p_recruiter, version = version + 1, updated_at = now() where id = j.id returning * into j;
  if p_recruiter is not null then
    perform private.notify(p_recruiter, 'RECRUITER_VACANCY_ASSIGNED', format('Vacancy assigned: %s', j.title), 'You are now responsible for the applications of this vacancy.', 'career_posting', j.id);
  end if;
  perform private.write_audit('RECRUITER_VACANCY_ASSIGNED', 'career_posting', j.id, null, null, jsonb_build_object('recruiter', p_recruiter));
  return private.vacancy_json(j);
end $$;
revoke all on function public.recruiter_vacancy_assign(uuid, uuid) from public, anon;
grant execute on function public.recruiter_vacancy_assign(uuid, uuid) to authenticated;

-- Change the status. HR leadership: any change. The responsible Recruiter: send a draft for approval, hold or resume an approved vacancy, and close a
-- vacancy that is filled. Opening or closing anything else is leadership's decision (nothing is closed automatically).
create or replace function public.recruiter_vacancy_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.career_postings;
  v_lead boolean := private.is_hr_leadership();
  v_mine boolean;
  v_ok boolean;
  v_selected integer;
begin
  perform private.recruiter_require();
  if p_status is null or p_status not in ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED') then
    raise exception 'VALIDATION_ERROR: Choose a valid vacancy status.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception 'VALIDATION_ERROR: Keep the note under 500 characters.' using errcode = 'P0001';
  end if;
  select * into j from public.career_postings where id = p_id for update;
  if j.id is null then
    raise exception 'NOT_FOUND: Vacancy not found.' using errcode = 'P0001';
  end if;
  v_mine := j.responsible_id = auth.uid();
  if not v_lead and not v_mine then
    raise exception 'NOT_FOUND: Vacancy not found.' using errcode = 'P0001';
  end if;
  if j.vacancy_status = p_status then
    return private.vacancy_json(j);
  end if;
  v_ok := v_lead
          or (j.vacancy_status = 'DRAFT' and p_status = 'PENDING_APPROVAL')
          or (j.vacancy_status = 'OPEN' and p_status = 'ON_HOLD')
          or (j.vacancy_status = 'ON_HOLD' and p_status = 'OPEN' and j.approved_at is not null)
          or (j.vacancy_status = 'FILLED' and p_status = 'CLOSED');
  if not v_ok then
    raise exception 'FORBIDDEN: This status change needs HR leadership.' using errcode = '42501';
  end if;
  select count(*) into v_selected from public.career_applications a where a.posting_id = j.id and a.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED');
  if p_status = 'OPEN' and v_selected >= j.openings then
    raise exception 'CONFLICT: All the positions of this vacancy are filled. Increase the openings or close it.' using errcode = 'P0001';
  end if;
  update public.career_postings set vacancy_status = p_status, status_note = left(nullif(btrim(p_note), ''), 500), version = version + 1, updated_at = now()
   where id = j.id returning * into j;
  perform private.write_audit('RECRUITER_VACANCY_STATUS', 'career_posting', j.id, null, null, jsonb_build_object('status', p_status, 'note', left(p_note, 200)));
  if p_status = 'PENDING_APPROVAL' then
    perform private.notify(l.id, 'RECRUITER_VACANCY_APPROVAL', format('Vacancy waiting for approval: %s', j.title), 'A vacancy was sent for approval.', 'career_posting', j.id)
      from public.profiles l where l.status = 'ACTIVE' and (l.role = 'SUPER_ADMIN' or (l.role = 'DEPARTMENT_HEAD' and exists (select 1 from public.departments d where d.id = l.department_id and d.slug = 'hr')));
  end if;
  return private.vacancy_json(j);
end $$;
revoke all on function public.recruiter_vacancy_status(uuid, text, text) from public, anon;
grant execute on function public.recruiter_vacancy_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Dashboard overview
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_overview(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_rows jsonb;
  v_by_stage jsonb;
  v_by_vacancy jsonb;
  v_progress jsonb;
begin
  perform private.recruiter_require();
  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_rows from private.recruiter_filtered(f) c;
  select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) into v_by_stage from (select c ->> 'stage' s, count(*) n from jsonb_array_elements(v_rows) c group by 1) q;
  select coalesce(jsonb_agg(jsonb_build_object('postingId', p, 'vacancy', t, 'applications', n) order by n desc), '[]'::jsonb) into v_by_vacancy
    from (select c ->> 'postingId' p, c ->> 'vacancy' t, count(*) n from jsonb_array_elements(v_rows) c group by 1, 2) q;
  select coalesce(jsonb_agg(vacancy_prog order by (vacancy_prog ->> 'applications')::int desc), '[]'::jsonb) into v_progress from (
    select jsonb_build_object('postingId', j.id, 'vacancy', j.title, 'openings', j.openings,
             'applications', count(*) filter (where c.applied is not null), 'screening', count(*) filter (where c.stage in ('INITIAL_SCREENING', 'CALL_SCHEDULED', 'CALL_COMPLETED', 'TEST_PENDING', 'TEST_COMPLETED')),
             'interviews', count(*) filter (where c.stage in ('INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'SELECTION_REVIEW')),
             'selected', count(*) filter (where c.stage = 'SELECTED'), 'rejected', count(*) filter (where c.stage = 'REJECTED')) as vacancy_prog
      from public.career_postings j
      join (select x ->> 'postingId' pid, x ->> 'stage' stage, x ->> 'appliedAt' applied from jsonb_array_elements(v_rows) x) c on c.pid = j.id::text
     group by j.id, j.title, j.openings) q;
  return jsonb_build_object(
    'kpis', jsonb_build_object(
      'vacancies', (select count(*) from public.career_postings j where j.vacancy_status = 'OPEN' and (private.is_hr_leadership() or j.responsible_id = auth.uid())
                       and (nullif(f ->> 'posting', '') is null or j.id = (f ->> 'posting')::uuid)),
      'applied', jsonb_array_length(v_rows),
      'newApplications', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'stage' = 'NEW_APPLICATION'),
      'callsPending', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'callStatus' = 'SCHEDULED'),
      'callsCompleted', (select count(*) from jsonb_array_elements(v_rows) c, private.recruiter_calls_of((c ->> 'applicationId')::uuid) k where k.called_at is not null),
      'testsPending', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'testStatus' = 'PENDING'),
      'interviewsScheduled', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'interviewStatus' = 'SCHEDULED'),
      'interviewsCompleted', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'interviewStatus' = 'COMPLETED'),
      'selected', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'stage' = 'SELECTED'),
      'rejected', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'stage' = 'REJECTED')),
    'byVacancy', v_by_vacancy, 'byStage', v_by_stage, 'vacancyProgress', v_progress,
    'calls', jsonb_build_object(
      'completed', (select count(*) from jsonb_array_elements(v_rows) c, private.recruiter_calls_of((c ->> 'applicationId')::uuid) k where k.called_at is not null),
      'pending', (select count(*) from jsonb_array_elements(v_rows) c, private.recruiter_calls_of((c ->> 'applicationId')::uuid) k where k.called_at is null)),
    'interviews', jsonb_build_object(
      'completed', (select count(*) from jsonb_array_elements(v_rows) c, public.career_interviews i where (c ->> 'applicationId')::uuid = i.application_id and i.status = 'COMPLETED'),
      'scheduled', (select count(*) from jsonb_array_elements(v_rows) c, public.career_interviews i where (c ->> 'applicationId')::uuid = i.application_id and i.status = 'SCHEDULED')),
    'recent', coalesce((select jsonb_agg(c) from (select c from jsonb_array_elements(v_rows) c order by c ->> 'appliedAt' desc limit 10) q), '[]'::jsonb));
end $$;
revoke all on function public.recruiter_overview(jsonb) from public, anon;
grant execute on function public.recruiter_overview(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Applications (paged in the database), the pipeline, and one application in full
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_applications(p_filters jsonb default '{}'::jsonb, p_page integer default 1, p_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_size integer := least(greatest(coalesce(p_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_all jsonb;
begin
  perform private.recruiter_require();
  select coalesce(jsonb_agg(c order by c ->> 'appliedAt' desc), '[]'::jsonb) into v_all from private.recruiter_filtered(coalesce(p_filters, '{}'::jsonb)) c;
  return jsonb_build_object(
    'total', jsonb_array_length(v_all), 'page', v_page, 'pageSize', v_size,
    'items', coalesce((select jsonb_agg(c) from (select c from jsonb_array_elements(v_all) with ordinality t (c, o) order by o limit v_size offset (v_page - 1) * v_size) q), '[]'::jsonb),
    'counts', coalesce((select jsonb_object_agg(s, n) from (select c ->> 'stage' s, count(*) n from jsonb_array_elements(v_all) c group by 1) q), '{}'::jsonb));
end $$;
revoke all on function public.recruiter_applications(jsonb, integer, integer) from public, anon;
grant execute on function public.recruiter_applications(jsonb, integer, integer) to authenticated;

create or replace function public.recruiter_pipeline(p_posting uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_stages text[] := array['NEW_APPLICATION', 'INITIAL_SCREENING', 'CALL_SCHEDULED', 'CALL_COMPLETED', 'TEST_PENDING', 'TEST_COMPLETED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'SELECTION_REVIEW', 'SELECTED', 'REJECTED', 'ON_HOLD'];
  v_out jsonb := '{}'::jsonb;
  s text;
begin
  perform private.recruiter_require();
  foreach s in array v_stages loop
    v_out := v_out || jsonb_build_object(s, jsonb_build_object(
      'count', (select count(*) from private.recruiter_filtered(jsonb_build_object('posting', p_posting, 'stage', s))),
      'cards', coalesce((select jsonb_agg(c) from (select c from private.recruiter_filtered(jsonb_build_object('posting', p_posting, 'stage', s)) c order by c ->> 'appliedAt' desc limit 40) q), '[]'::jsonb)));
  end loop;
  return jsonb_build_object('stages', v_out);
end $$;
revoke all on function public.recruiter_pipeline(uuid) from public, anon;
grant execute on function public.recruiter_pipeline(uuid) to authenticated;

-- One application with everything about it. The candidate's own answers (submitted) are kept apart from what the Recruiter and HR recorded (recruiter).
create or replace function public.recruiter_application(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a public.career_applications;
  j public.career_postings;
  ap public.career_applicants;
  r jsonb;
  v_missing text[] := '{}';
  v_cur public.recruiter_decisions;
  v_selected integer;
begin
  perform private.recruiter_assert_access(p_id);
  select * into a from public.career_applications where id = p_id;
  select * into j from public.career_postings where id = a.posting_id;
  select * into ap from public.career_applicants where id = a.applicant_id;
  select private.recruiter_row_json(x) into r from private.recruiter_rows() x where x.application_id = a.id;
  select * into v_cur from public.recruiter_decisions where application_id = a.id and is_current;
  select count(*) into v_selected from public.career_applications z where z.posting_id = j.id and z.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED');
  if 'CALL' = any (j.required_steps) and not exists (select 1 from private.recruiter_calls_of(a.id) c where true and c.called_at is not null and c.outcome in ('ANSWERED', 'INTERESTED')) then v_missing := array_append(v_missing, 'CALL'); end if;
  if 'ASSESSMENT' = any (j.required_steps) and not exists (select 1 from public.career_attempts t where t.application_id = a.id and t.passed) then v_missing := array_append(v_missing, 'ASSESSMENT'); end if;
  if 'INTERVIEW' = any (j.required_steps) and not exists (select 1 from public.career_interviews i where i.application_id = a.id and i.status = 'COMPLETED' and i.recommendation in ('PROCEED', 'SHORTLIST')) then v_missing := array_append(v_missing, 'INTERVIEW'); end if;
  return jsonb_build_object(
    'summary', r,
    -- what the candidate submitted, as it was (never edited)
    'submitted', jsonb_build_object(
      'applicantId', ap.id, 'name', coalesce(a.snapshot -> 'profile' ->> 'name', ap.name), 'email', a.snapshot -> 'profile' ->> 'email', 'phone', coalesce(a.snapshot -> 'profile' ->> 'phone', ap.phone),
      'city', a.snapshot -> 'profile' ->> 'city', 'state', a.snapshot -> 'profile' ->> 'state', 'education', a.snapshot -> 'profile' ->> 'education',
      'experience', a.snapshot -> 'profile' ->> 'experience', 'skills', a.snapshot -> 'profile' ->> 'skills', 'bio', a.snapshot -> 'profile' ->> 'bio',
      'candidateMessage', a.candidate_message, 'appliedAt', a.created_at, 'applicationId', a.id, 'candidateRecordId', a.hr_candidate_id,
      'resume', (select jsonb_build_object('id', f.id, 'fileName', f.file_name, 'sizeBytes', f.size_bytes) from public.career_files f where f.id = a.resume_id)),
    'vacancy', private.vacancy_json(j) || jsonb_build_object('requiredSteps', j.required_steps, 'qualifications', j.qualifications, 'skills', j.skills, 'experience', j.experience),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'status', d.status) order by d.created_at) from public.career_documents d where d.application_id = a.id), '[]'::jsonb),
    'assessments', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', ct.title, 'status', case when t.submitted_at is not null then 'COMPLETED' when t.started_at is not null then 'IN_PROGRESS' else 'PENDING' end,
                'invitedUntil', t.available_until, 'startedAt', t.started_at, 'completedAt', t.submitted_at, 'score', t.score, 'passed', t.passed, 'passPercent', ct.pass_percent) order by t.available_until)
                 from public.career_attempts t join public.career_tests ct on ct.id = t.test_id where t.application_id = a.id and t.training_enrollment_id is null), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'scheduledAt', c.scheduled_at, 'calledAt', c.called_at, 'outcome', c.outcome, 'note', c.note, 'followUpDate', c.follow_up_date,
                'recruiter', (select p.full_name from public.profiles p where p.id = coalesce(c.made_by, c.created_by))) order by coalesce(c.called_at, c.scheduled_at) desc)
                 from private.recruiter_calls_of(a.id) c where true), '[]'::jsonb),
    'interviews', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'round', i.round, 'scheduledAt', i.scheduled_at, 'location', i.location, 'mode', i.mode, 'interviewer', i.interviewer_name,
                'status', i.status, 'confirmedAt', i.confirmed_at, 'bookedBy', i.booked_by, 'result', i.recommendation, 'feedback', i.internal_feedback, 'version', i.version, 'rescheduledFrom', i.rescheduled_from)
                order by i.scheduled_at desc) from public.career_interviews i where i.application_id = a.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(h order by (h ->> 'at') desc) from (
        select jsonb_build_object('at', s.updated_at, 'previous', s.previous_status, 'new', s.new_status, 'by', s.updated_by_name, 'comment', s.comment) h
          from public.recruiter_stage_history s where s.application_id = a.id
        union all
        select jsonb_build_object('at', e.created_at, 'previous', null, 'new', e.kind, 'by', null, 'comment', null)
          from public.career_events e where e.application_id = a.id and e.kind in ('CAREER_APPLICATION_SUBMITTED', 'CAREER_STAGE_CHANGED', 'CAREER_TEST_INVITED')) q), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'author', n.author_name, 'at', n.created_at) order by n.created_at desc)
                         from public.recruiter_notes n where n.application_id = a.id), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'seq', d.seq, 'decision', d.decision, 'category', d.reason_category, 'reason', d.reason, 'by', d.decided_by_name, 'at', d.decided_at,
                'current', d.is_current, 'correctionReason', d.correction_reason) order by d.seq desc) from public.recruiter_decisions d where d.application_id = a.id), '[]'::jsonb),
    'review', jsonb_build_object('missingSteps', to_jsonb(v_missing), 'selectionReview', exists (select 1 from public.recruiter_applications x where x.application_id = a.id and x.selection_review_at is not null),
      'openings', j.openings, 'selected', v_selected, 'remaining', greatest(j.openings - v_selected, 0)),
    'can', jsonb_build_object('decide', v_cur.id is null and a.stage not in ('WITHDRAWN', 'JOINING', 'TRAINING', 'COMPLETED') and a.stage not in ('SELECTED', 'REJECTED'),
      'correct', private.is_hr_leadership() and (v_cur.id is not null or a.stage in ('SELECTED', 'REJECTED')), 'current', v_cur.decision));
end $$;
revoke all on function public.recruiter_application(uuid) from public, anon;
grant execute on function public.recruiter_application(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Notes and stage moves
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_note_add(p_application uuid, p_kind text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.recruiter_notes;
begin
  perform private.recruiter_assert_access(p_application);
  if p_kind not in ('NOTE', 'EVALUATION') then
    raise exception 'VALIDATION_ERROR: Choose note or evaluation.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'VALIDATION_ERROR: Write the note (up to 2000 characters).' using errcode = 'P0001';
  end if;
  insert into public.recruiter_notes (application_id, author_id, author_name, kind, body)
  select p_application, p.id, p.full_name, p_kind, btrim(p_body) from public.profiles p where p.id = auth.uid() returning * into n;
  return jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'author', n.author_name, 'at', n.created_at);
end $$;
revoke all on function public.recruiter_note_add(uuid, text, text) from public, anon;
grant execute on function public.recruiter_note_add(uuid, text, text) to authenticated;

-- The moves a Recruiter makes by hand: start screening, put on hold, resume, raise or clear "ready for the selection decision". Everything else follows from the
-- calls, tests and interviews. Final decisions have their own function.
create or replace function public.recruiter_stage(p_application uuid, p_action text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.career_applications;
  v_before text;
  v_new text;
begin
  perform private.recruiter_assert_access(p_application);
  if p_action not in ('SCREEN', 'HOLD', 'RESUME', 'REQUEST_REVIEW', 'CLEAR_REVIEW') then
    raise exception 'VALIDATION_ERROR: Choose a valid move.' using errcode = 'P0001';
  end if;
  if p_action in ('HOLD') and length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: Write the reason for putting the application on hold.' using errcode = 'P0001';
  end if;
  select * into a from public.career_applications where id = p_application for update;
  if a.stage in ('SELECTED', 'REJECTED', 'WITHDRAWN', 'JOINING', 'TRAINING', 'COMPLETED') then
    raise exception 'CONFLICT: This application is already closed. A final decision is changed only through a correction by HR leadership.' using errcode = 'P0001';
  end if;
  v_before := private.recruiter_stage_of(a.id);
  if p_action = 'SCREEN' then
    if a.stage <> 'SUBMITTED' then raise exception 'CONFLICT: Screening has already started.' using errcode = 'P0001'; end if;
    v_new := 'SCREENING';
  elsif p_action = 'HOLD' then
    v_new := 'ON_HOLD';
  elsif p_action = 'RESUME' then
    if a.stage <> 'ON_HOLD' then raise exception 'CONFLICT: This application is not on hold.' using errcode = 'P0001'; end if;
    v_new := 'SCREENING';
  end if;
  if v_new is not null then
    update public.career_applications set stage = v_new, version = version + 1, updated_at = now() where id = a.id;
    perform private.career_event(a.applicant_id, a.id, 'CAREER_STAGE_CHANGED', jsonb_build_object('before', a.stage, 'after', v_new));
    perform private.rec_event(a.hr_candidate_id, 'PORTAL_STAGE', format('Portal application: %s', v_new));
  elsif p_action = 'REQUEST_REVIEW' then
    insert into public.recruiter_applications (application_id, selection_review_at, selection_review_by) values (a.id, now(), auth.uid())
    on conflict (application_id) do update set selection_review_at = now(), selection_review_by = auth.uid(), updated_at = now();
  else
    update public.recruiter_applications set selection_review_at = null, updated_at = now() where application_id = a.id;
  end if;
  perform private.recruiter_log(a.id, v_before, p_comment);
  return jsonb_build_object('applicationId', a.id, 'stage', private.recruiter_stage_of(a.id));
end $$;
revoke all on function public.recruiter_stage(uuid, text, text) from public, anon;
grant execute on function public.recruiter_stage(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Calls
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_calls()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.recruiter_require();
  return jsonb_build_object(
    'upcoming', coalesce((select jsonb_agg(x order by x ->> 'scheduledAt') from (
        select jsonb_build_object('id', c.id, 'applicationId', a.id, 'candidate', r.name, 'phone', r.phone, 'vacancy', r.vacancy_title, 'scheduledAt', c.scheduled_at, 'overdue', c.scheduled_at < now()) x
          from public.career_applications a cross join lateral private.recruiter_calls_of(a.id) c join private.recruiter_rows() r on r.application_id = a.id
         where c.called_at is null and r.pipeline_stage not in ('SELECTED', 'REJECTED', 'WITHDRAWN')) q), '[]'::jsonb),
    'followUps', coalesce((select jsonb_agg(x order by x ->> 'followUpDate') from (
        select jsonb_build_object('id', c.id, 'applicationId', a.id, 'candidate', r.name, 'phone', r.phone, 'vacancy', r.vacancy_title, 'followUpDate', c.follow_up_date, 'overdue', c.follow_up_date < v_today,
                 'outcome', c.outcome) x
          from public.career_applications a cross join lateral private.recruiter_calls_of(a.id) c join private.recruiter_rows() r on r.application_id = a.id
         where c.follow_up_date is not null and r.pipeline_stage not in ('SELECTED', 'REJECTED', 'WITHDRAWN')
           and not exists (select 1 from private.recruiter_calls_of(a.id) n where n.created_at > c.created_at)) q), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', c.id, 'applicationId', a.id, 'candidate', r.name, 'vacancy', r.vacancy_title, 'calledAt', c.called_at, 'outcome', c.outcome, 'note', c.note,
                 'recruiter', (select p.full_name from public.profiles p where p.id = coalesce(c.made_by, c.created_by))) x
          from public.career_applications a cross join lateral private.recruiter_calls_of(a.id) c join private.recruiter_rows() r on r.application_id = a.id
         where c.called_at is not null order by c.called_at desc limit 30) q), '[]'::jsonb));
end $$;
revoke all on function public.recruiter_calls() from public, anon;
grant execute on function public.recruiter_calls() to authenticated;

-- Schedule a call, or record the outcome of one (a scheduled call, or a call that simply happened). A call is completed only with an outcome.
create or replace function public.recruiter_call_save(p_application uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.career_applications;
  c public.hr_candidate_calls;
  v_before text;
  v_action text := p_data ->> 'action';
  v_when timestamptz;
  v_follow date;
  v_outcome text := nullif(p_data ->> 'outcome', '');
  v_note text := nullif(btrim(coalesce(p_data ->> 'note', '')), '');
begin
  perform private.recruiter_assert_access(p_application);
  select * into a from public.career_applications where id = p_application for update;
  if a.stage in ('SELECTED', 'REJECTED', 'WITHDRAWN', 'JOINING', 'TRAINING', 'COMPLETED') then
    raise exception 'CONFLICT: This application is closed.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_note, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the call notes under 1000 characters.' using errcode = 'P0001';
  end if;
  v_before := private.recruiter_stage_of(a.id);
  if v_action = 'SCHEDULE' then
    v_when := (p_data ->> 'scheduledAt')::timestamptz;
    if v_when is null then raise exception 'VALIDATION_ERROR: Choose the date and time of the call.' using errcode = 'P0001'; end if;
    insert into public.hr_candidate_calls (candidate_id, application_id, scheduled_at, note, created_by) values (a.hr_candidate_id, a.id, v_when, v_note, auth.uid()) returning * into c;
    perform private.rec_event(a.hr_candidate_id, 'CALL_SCHEDULED', 'Call scheduled');
  elsif v_action = 'RECORD' then
    if v_outcome is null or v_outcome not in ('ANSWERED', 'NO_ANSWER', 'CALL_BACK', 'NOT_INTERESTED', 'WRONG_NUMBER', 'INTERESTED', 'UNREACHABLE') then
      raise exception 'VALIDATION_ERROR: A call is completed only with its outcome. Choose one.' using errcode = 'P0001';
    end if;
    v_follow := nullif(p_data ->> 'followUpDate', '')::date;
    if v_outcome = 'CALL_BACK' and v_follow is null then
      raise exception 'VALIDATION_ERROR: Choose the follow-up date for a call-back.' using errcode = 'P0001';
    end if;
    if nullif(p_data ->> 'callId', '') is not null then
      select * into c from public.hr_candidate_calls where id = (p_data ->> 'callId')::uuid and candidate_id = a.hr_candidate_id and (application_id = a.id or application_id is null) for update;
      if c.id is null then raise exception 'NOT_FOUND: Call not found.' using errcode = 'P0001'; end if;
      if c.called_at is not null then raise exception 'CONFLICT: This call was already recorded.' using errcode = 'P0001'; end if;
      update public.hr_candidate_calls set called_at = now(), outcome = v_outcome, note = coalesce(v_note, note), follow_up_date = v_follow, made_by = auth.uid() where id = c.id returning * into c;
    else
      insert into public.hr_candidate_calls (candidate_id, application_id, called_at, outcome, note, follow_up_date, made_by, created_by) values (a.hr_candidate_id, a.id, now(), v_outcome, v_note, v_follow, auth.uid(), auth.uid()) returning * into c;
    end if;
    perform private.rec_event(a.hr_candidate_id, 'CALL_MADE', format('Call recorded: %s', v_outcome));
  else
    raise exception 'VALIDATION_ERROR: Choose schedule or record.' using errcode = 'P0001';
  end if;
  perform private.recruiter_log(a.id, v_before, null);
  return jsonb_build_object('id', c.id, 'scheduledAt', c.scheduled_at, 'calledAt', c.called_at, 'outcome', c.outcome, 'followUpDate', c.follow_up_date);
end $$;
revoke all on function public.recruiter_call_save(uuid, jsonb) from public, anon;
grant execute on function public.recruiter_call_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11b. Assessments: the tests that exist, and inviting a candidate to one (the same record the HR Assistant's invitation makes)
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_tests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'durationMinutes', t.duration_minutes, 'passPercent', t.pass_percent,
                     'questions', jsonb_array_length(t.questions)) order by t.title) from public.career_tests t), '[]'::jsonb);
end $$;
revoke all on function public.recruiter_tests() from public, anon;
grant execute on function public.recruiter_tests() to authenticated;

create or replace function public.recruiter_assessment_invite(p_application uuid, p_test uuid, p_until timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.career_applications;
  t public.career_attempts;
  v_before text;
begin
  perform private.recruiter_assert_access(p_application);
  select * into a from public.career_applications where id = p_application for update;
  if a.stage not in ('SUBMITTED', 'SCREENING', 'ASSESSMENT', 'ON_HOLD') or p_until is null or p_until <= now() then
    raise exception 'VALIDATION_ERROR: Choose an open application and a deadline in the future.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.career_tests where id = p_test) then
    raise exception 'NOT_FOUND: Test not found.' using errcode = 'P0001';
  end if;
  v_before := private.recruiter_stage_of(a.id);
  insert into public.career_attempts (application_id, test_id, available_until) values (a.id, p_test, p_until)
  on conflict (application_id, test_id) do nothing returning * into t;
  if t.id is null then
    select * into t from public.career_attempts where application_id = a.id and test_id = p_test;
    return jsonb_build_object('id', t.id, 'alreadyInvited', true);
  end if;
  update public.career_applications set stage = 'ASSESSMENT', version = version + 1, updated_at = now() where id = a.id;
  perform private.career_event(a.applicant_id, a.id, 'CAREER_TEST_INVITED', jsonb_build_object('attempt_id', t.id));
  perform private.rec_event(a.hr_candidate_id, 'ASSESSMENT', 'Candidate invited to portal assessment');
  perform private.recruiter_log(a.id, v_before, 'Assessment invitation sent');
  return jsonb_build_object('id', t.id, 'alreadyInvited', false);
end $$;
revoke all on function public.recruiter_assessment_invite(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.recruiter_assessment_invite(uuid, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Interviews
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_interviews()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by (x ->> 'scheduledAt')) from (
      select jsonb_build_object('id', i.id, 'applicationId', a.id, 'candidate', r.name, 'vacancy', r.vacancy_title, 'round', i.round, 'scheduledAt', i.scheduled_at, 'location', i.location,
               'mode', i.mode, 'interviewer', i.interviewer_name, 'status', i.status, 'confirmedAt', i.confirmed_at, 'bookedBy', i.booked_by, 'result', i.recommendation,
               'feedback', i.internal_feedback, 'version', i.version) x
        from public.career_interviews i join public.career_applications a on a.id = i.application_id join private.recruiter_rows() r on r.application_id = a.id) q), '[]'::jsonb));
end $$;
revoke all on function public.recruiter_interviews() from public, anon;
grant execute on function public.recruiter_interviews() to authenticated;

-- action SCHEDULE | CONFIRM | RESCHEDULE | COMPLETE | CANCEL. Every earlier interview and round stays as history (a reschedule cancels the old row and
-- creates a new one that points back at it).
create or replace function public.recruiter_interview_save(p_application uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.career_applications;
  j public.career_postings;
  i public.career_interviews;
  n public.career_interviews;
  v_before text;
  v_action text := p_data ->> 'action';
  v_when timestamptz;
  v_mode text := nullif(p_data ->> 'mode', '');
  v_interviewer text := nullif(btrim(coalesce(p_data ->> 'interviewer', '')), '');
  v_interviewer_id uuid := nullif(p_data ->> 'interviewerId', '')::uuid;
  v_result text := nullif(p_data ->> 'result', '');
begin
  perform private.recruiter_assert_access(p_application);
  select * into a from public.career_applications where id = p_application for update;
  select * into j from public.career_postings where id = a.posting_id;
  if a.stage in ('SELECTED', 'REJECTED', 'WITHDRAWN', 'JOINING', 'TRAINING', 'COMPLETED') then
    raise exception 'CONFLICT: This application is closed.' using errcode = 'P0001';
  end if;
  if v_mode is not null and v_mode not in ('IN_PERSON', 'PHONE', 'VIDEO', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose the interview mode.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_interviewer, '')) > 120 or length(coalesce(p_data ->> 'feedback', '')) > 3000 then
    raise exception 'VALIDATION_ERROR: Keep the interviewer name and the feedback shorter.' using errcode = 'P0001';
  end if;
  if v_interviewer_id is not null then
    select full_name into v_interviewer from public.profiles where id = v_interviewer_id and status = 'ACTIVE';
    if v_interviewer is null then raise exception 'VALIDATION_ERROR: Choose an active employee as the interviewer.' using errcode = 'P0001'; end if;
  end if;
  v_before := private.recruiter_stage_of(a.id);

  if v_action in ('SCHEDULE', 'RESCHEDULE') then
    v_when := (p_data ->> 'scheduledAt')::timestamptz;
    if v_when is null or v_when < now() - interval '1 hour' then
      raise exception 'VALIDATION_ERROR: Choose a date and time that has not passed.' using errcode = 'P0001';
    end if;
    if p_data ->> 'round' not in ('HR', 'DEPARTMENT_HEAD', 'MANAGEMENT') or length(btrim(coalesce(p_data ->> 'location', ''))) not between 1 and 1000 then
      raise exception 'VALIDATION_ERROR: Enter the round and where or how the interview takes place.' using errcode = 'P0001';
    end if;
    -- a required assessment must be passed before interviews
    if 'ASSESSMENT' = any (j.required_steps) and not exists (select 1 from public.career_attempts t where t.application_id = a.id and t.passed) then
      raise exception 'CONFLICT: This vacancy requires a passed assessment before interviews.' using errcode = 'P0001';
    end if;
    if v_action = 'RESCHEDULE' then
      select * into i from public.career_interviews where id = (p_data ->> 'id')::uuid and application_id = a.id for update;
      if i.id is null or i.status <> 'SCHEDULED' then raise exception 'CONFLICT: Only a scheduled interview can be rescheduled.' using errcode = 'P0001'; end if;
      update public.career_interviews set status = 'CANCELLED', version = version + 1 where id = i.id;
    end if;
    insert into public.career_interviews (application_id, round, scheduled_at, location, mode, interviewer_id, interviewer_name, booked_by, rescheduled_from, recorded_by)
    values (a.id, coalesce(p_data ->> 'round', i.round), v_when, p_data ->> 'location', coalesce(v_mode, i.mode), v_interviewer_id, coalesce(v_interviewer, i.interviewer_name), 'HR', i.id, auth.uid())
    on conflict (application_id, round, scheduled_at) where status <> 'CANCELLED' do nothing
    returning * into n;
    if n.id is null then
      raise exception 'CONFLICT: An interview already exists for this round and time.' using errcode = 'P0001';
    end if;
    -- the first interview moves the application into the interview stage the candidate portal shows
    if a.stage in ('SUBMITTED', 'SCREENING', 'ASSESSMENT', 'ON_HOLD') then
      update public.career_applications set stage = 'INTERVIEW', version = version + 1, updated_at = now() where id = a.id;
    end if;
    perform private.career_event(a.applicant_id, a.id, 'CAREER_INTERVIEW_UPDATED', jsonb_build_object('interview_id', n.id, 'status', n.status));
    i := n;
  elsif v_action in ('CONFIRM', 'COMPLETE', 'CANCEL') then
    select * into i from public.career_interviews where id = (p_data ->> 'id')::uuid and application_id = a.id for update;
    if i.id is null then raise exception 'NOT_FOUND: Interview not found.' using errcode = 'P0001'; end if;
    if i.version is distinct from (p_data ->> 'version')::integer then raise exception 'CONFLICT: The interview changed. Reload first.' using errcode = 'P0001'; end if;
    if i.status <> 'SCHEDULED' then raise exception 'CONFLICT: This interview is already %.', lower(i.status) using errcode = 'P0001'; end if;
    if v_action = 'CONFIRM' then
      update public.career_interviews set confirmed_at = now(), version = version + 1 where id = i.id returning * into i;
    elsif v_action = 'CANCEL' then
      update public.career_interviews set status = 'CANCELLED', version = version + 1 where id = i.id returning * into i;
    else
      if i.scheduled_at > now() then raise exception 'VALIDATION_ERROR: Record the interview after it takes place.' using errcode = 'P0001'; end if;
      if v_result is null or v_result not in ('PROCEED', 'SHORTLIST', 'REJECT', 'HOLD', 'FURTHER_EVALUATION') then
        raise exception 'VALIDATION_ERROR: Record the interview result.' using errcode = 'P0001';
      end if;
      update public.career_interviews set status = 'COMPLETED', recommendation = v_result, internal_feedback = left(nullif(btrim(p_data ->> 'feedback'), ''), 3000), recorded_by = auth.uid(),
             version = version + 1 where id = i.id returning * into i;
    end if;
    perform private.career_event(a.applicant_id, a.id, 'CAREER_INTERVIEW_UPDATED', jsonb_build_object('interview_id', i.id, 'status', i.status));
  else
    raise exception 'VALIDATION_ERROR: Choose a valid interview action.' using errcode = 'P0001';
  end if;
  perform private.recruiter_log(a.id, v_before, null);
  return jsonb_build_object('id', i.id, 'round', i.round, 'scheduledAt', i.scheduled_at, 'status', i.status, 'result', i.recommendation, 'version', i.version);
end $$;
revoke all on function public.recruiter_interview_save(uuid, jsonb) from public, anon;
grant execute on function public.recruiter_interview_save(uuid, jsonb) to authenticated;

-- A booking made by someone else (for example the candidate, once slot booking exists) tells the responsible Recruiter through the CRM notifications.
create or replace function private.tg_interview_notify_recruiter()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_to uuid;
  v_name text;
begin
  select coalesce(hc.owner_id, j.responsible_id), ap.name into v_to, v_name
    from public.career_applications a join public.career_postings j on j.id = a.posting_id join public.career_applicants ap on ap.id = a.applicant_id
    left join public.hr_candidates hc on hc.id = a.hr_candidate_id where a.id = new.application_id;
  if v_to is not null then
    perform private.notify(v_to, 'RECRUITER_INTERVIEW_BOOKED', format('Interview booked: %s', coalesce(nullif(v_name, ''), 'candidate')),
      format('%s on %s', new.round, to_char(new.scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')), 'career_application', new.application_id);
  end if;
  return new;
end $$;
revoke all on function private.tg_interview_notify_recruiter() from public, anon, authenticated;
drop trigger if exists career_interviews_notify on public.career_interviews;
create trigger career_interviews_notify after insert on public.career_interviews for each row execute function private.tg_interview_notify_recruiter();

-- A new application tells the responsible Recruiter (or, when the vacancy has none, HR leadership).
create or replace function private.tg_application_notify_recruiter()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_to uuid;
  v_title text;
  v_name text;
  r record;
begin
  select coalesce(hc.owner_id, j.responsible_id), j.title, ap.name into v_to, v_title, v_name
    from public.career_postings j join public.career_applicants ap on ap.id = new.applicant_id left join public.hr_candidates hc on hc.id = new.hr_candidate_id where j.id = new.posting_id;
  if v_to is not null then
    perform private.notify(v_to, 'RECRUITER_NEW_APPLICATION', format('New application: %s', coalesce(nullif(v_name, ''), 'candidate')), format('Applied for %s.', v_title), 'career_application', new.id);
  else
    for r in select p.id from public.profiles p where p.status = 'ACTIVE' and (p.role = 'SUPER_ADMIN' or (p.role = 'DEPARTMENT_HEAD' and exists (select 1 from public.departments d where d.id = p.department_id and d.slug = 'hr'))) loop
      perform private.notify(r.id, 'RECRUITER_NEW_APPLICATION', format('New application (no recruiter yet): %s', coalesce(nullif(v_name, ''), 'candidate')), format('Applied for %s. Allocate the vacancy to a recruiter.', v_title), 'career_application', new.id);
    end loop;
  end if;
  insert into public.recruiter_stage_history (application_id, previous_status, new_status, updated_by_name, comment) values (new.id, null, 'NEW_APPLICATION', 'Candidate', 'Application submitted through the candidate portal');
  return new;
end $$;
revoke all on function private.tg_application_notify_recruiter() from public, anon, authenticated;
drop trigger if exists career_applications_notify on public.career_applications;
create trigger career_applications_notify after insert on public.career_applications for each row execute function private.tg_application_notify_recruiter();

-- ---------------------------------------------------------------------------
-- 13. The final decision (Selected / Rejected): recorded once, then the backend e-mails the candidate
-- ---------------------------------------------------------------------------
-- Repeating the same request returns the decision already recorded (nothing new is queued). A different decision needs a correction by HR leadership.
create or replace function public.recruiter_decide(p_application uuid, p_decision text, p_category text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.career_applications;
  j public.career_postings;
  d public.recruiter_decisions;
  me public.profiles;
  v_before text;
  v_selected integer;
  v_missing text[] := '{}';
  v_filled boolean := false;
  v_dept text;
  v_title text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.recruiter_assert_access(p_application);
  if p_decision not in ('SELECTED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose selected or rejected.' using errcode = 'P0001';
  end if;
  if p_category is not null and p_category not in ('SKILLS_MISMATCH', 'EXPERIENCE', 'ASSESSMENT', 'INTERVIEW', 'NOT_INTERESTED', 'POSITION_FILLED', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose a rejection category.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_reason, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the reason under 1000 characters.' using errcode = 'P0001';
  end if;
  if p_decision = 'REJECTED' and p_category is null and v_reason is null then
    raise exception 'VALIDATION_ERROR: Choose a rejection category or write the reason.' using errcode = 'P0001';
  end if;
  select * into a from public.career_applications where id = p_application for update;
  select * into j from public.career_postings where id = a.posting_id for update;
  select * into me from public.profiles where id = auth.uid();
  -- the same decision again: the one already recorded, no second e-mail
  select * into d from public.recruiter_decisions where application_id = a.id and is_current;
  if d.id is not null then
    if d.decision = p_decision then
      return jsonb_build_object('id', d.id, 'decision', d.decision, 'decidedAt', d.decided_at, 'alreadyRecorded', true);
    end if;
    raise exception 'CONFLICT: A decision was already recorded for this application. Only HR leadership can correct it.' using errcode = 'P0001';
  end if;
  if a.stage in ('WITHDRAWN', 'JOINING', 'TRAINING', 'COMPLETED') then
    raise exception 'CONFLICT: This application can no longer be decided.' using errcode = 'P0001';
  end if;
  if (a.stage = 'REJECTED' and p_decision = 'SELECTED') or (a.stage = 'SELECTED' and p_decision = 'REJECTED') then
    raise exception 'CONFLICT: This application is already %. Only HR leadership can correct it.', lower(a.stage) using errcode = 'P0001';
  end if;
  v_before := private.recruiter_stage_of(a.id);
  if p_decision = 'SELECTED' then
    if 'CALL' = any (j.required_steps) and not exists (select 1 from private.recruiter_calls_of(a.id) c where true and c.called_at is not null and c.outcome in ('ANSWERED', 'INTERESTED')) then v_missing := array_append(v_missing, 'a completed call'); end if;
    if 'ASSESSMENT' = any (j.required_steps) and not exists (select 1 from public.career_attempts t where t.application_id = a.id and t.passed) then v_missing := array_append(v_missing, 'a passed assessment'); end if;
    if 'INTERVIEW' = any (j.required_steps) and not exists (select 1 from public.career_interviews i where i.application_id = a.id and i.status = 'COMPLETED' and i.recommendation in ('PROCEED', 'SHORTLIST')) then v_missing := array_append(v_missing, 'a completed interview'); end if;
    if array_length(v_missing, 1) > 0 then
      raise exception 'CONFLICT: This vacancy requires %.', array_to_string(v_missing, ', ') using errcode = 'P0001';
    end if;
    select count(*) into v_selected from public.career_applications z where z.posting_id = j.id and z.id <> a.id and z.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED');
    if v_selected >= j.openings then
      raise exception 'CONFLICT: All % position% of this vacancy are already filled.', j.openings, case when j.openings = 1 then '' else 's' end using errcode = 'P0001';
    end if;
  end if;
  select pos.title, dep.name into v_title, v_dept from public.hr_positions pos left join public.departments dep on dep.id = pos.department_id where pos.id = j.position_id;
  insert into public.recruiter_decisions (application_id, seq, decision, reason_category, reason, decided_by, decided_by_name, posting_id, position_title, department_name)
  values (a.id, coalesce((select max(seq) from public.recruiter_decisions where application_id = a.id), 0) + 1, p_decision, p_category, v_reason, me.id, me.full_name, j.id, coalesce(j.title, v_title), v_dept)
  returning * into d;
  update public.career_applications set stage = p_decision, version = version + 1, updated_at = now() where id = a.id;
  -- a kind that does not queue the generic portal e-mail: the candidate gets exactly one message, the decision e-mail below
  perform private.career_event(a.applicant_id, a.id, 'CAREER_DECISION_RECORDED', jsonb_build_object('decision', p_decision));
  perform private.rec_event(a.hr_candidate_id, 'DECISION', format('Final decision: %s', p_decision), jsonb_build_object('applicationId', a.id));
  if p_decision = 'SELECTED' then
    update public.hr_candidates set confirmation_status = 'OFFER_PENDING', confirmation_date = private.hr_today(), updated_at = now() where id = a.hr_candidate_id and confirmation_status = 'NOT_STARTED';
  end if;
  update public.recruiter_applications set selection_review_at = null, updated_at = now() where application_id = a.id;
  perform private.recruiter_log(a.id, v_before, coalesce(v_reason, p_category));
  perform private.write_audit('RECRUITER_DECISION', 'career_application', a.id, null, null, jsonb_build_object('decision', p_decision, 'category', p_category, 'seq', d.seq));
  -- the e-mail is queued in this same transaction; the server sends it afterwards
  perform private.recruitment_email_queue(d.id, 'DECISION_RECORDED');
  -- the last position taken: the vacancy is filled (not closed: closing is a separate, authorised step)
  if p_decision = 'SELECTED' then
    select count(*) into v_selected from public.career_applications z where z.posting_id = j.id and z.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED');
    if v_selected >= j.openings and j.vacancy_status in ('OPEN', 'ON_HOLD') then
      update public.career_postings set vacancy_status = 'FILLED', status_note = 'All positions are filled. Ready for closure.', version = version + 1, updated_at = now() where id = j.id;
      v_filled := true;
      perform private.notify(x.id, 'RECRUITER_VACANCY_FILLED', format('Vacancy filled: %s', j.title), 'All positions are filled. The vacancy is ready for closure.', 'career_posting', j.id)
        from public.profiles x where x.status = 'ACTIVE' and (x.id = j.responsible_id or x.role = 'SUPER_ADMIN' or (x.role = 'DEPARTMENT_HEAD' and exists (select 1 from public.departments dd where dd.id = x.department_id and dd.slug = 'hr')));
    end if;
  end if;
  return jsonb_build_object('id', d.id, 'decision', d.decision, 'decidedAt', d.decided_at, 'alreadyRecorded', false, 'vacancyFilled', v_filled);
end $$;
revoke all on function public.recruiter_decide(uuid, text, text, text) from public, anon;
grant execute on function public.recruiter_decide(uuid, text, text, text) to authenticated;

-- Change a recorded decision: HR leadership only, with a reason. The old decision stays in the history and the new one gets its own e-mail.
create or replace function public.recruiter_decision_correct(p_application uuid, p_decision text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.career_applications;
  j public.career_postings;
  old public.recruiter_decisions;
  d public.recruiter_decisions;
  me public.profiles;
  v_before text;
  v_selected integer;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_dept text;
  v_title text;
begin
  perform private.recruiter_require();
  if not private.is_hr_leadership() then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head of HR can correct a decision.' using errcode = '42501';
  end if;
  if p_decision not in ('SELECTED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose selected or rejected.' using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) < 5 or length(v_reason) > 1000 then
    raise exception 'VALIDATION_ERROR: Write why the decision is corrected (at least 5 characters).' using errcode = 'P0001';
  end if;
  select * into a from public.career_applications where id = p_application for update;
  if a.id is null then raise exception 'NOT_FOUND: Application not found.' using errcode = 'P0001'; end if;
  select * into j from public.career_postings where id = a.posting_id for update;
  select * into me from public.profiles where id = auth.uid();
  select * into old from public.recruiter_decisions where application_id = a.id and is_current for update;
  if old.id is null and a.stage not in ('SELECTED', 'REJECTED') then
    raise exception 'CONFLICT: There is no recorded decision to correct.' using errcode = 'P0001';
  end if;
  if (old.id is not null and old.decision = p_decision) or (old.id is null and a.stage = p_decision) then
    raise exception 'CONFLICT: The application already has this decision.' using errcode = 'P0001';
  end if;
  if a.stage in ('JOINING', 'TRAINING', 'COMPLETED', 'WITHDRAWN') then
    raise exception 'CONFLICT: The candidate has moved on (joining, training or withdrawn). A decision can no longer be corrected here.' using errcode = 'P0001';
  end if;
  if p_decision = 'SELECTED' then
    select count(*) into v_selected from public.career_applications z where z.posting_id = j.id and z.id <> a.id and z.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED');
    if v_selected >= j.openings then
      raise exception 'CONFLICT: All the positions of this vacancy are filled.' using errcode = 'P0001';
    end if;
  end if;
  v_before := private.recruiter_stage_of(a.id);
  if old.id is not null then
    update public.recruiter_decisions set is_current = false where id = old.id;
  end if;
  select pos.title, dep.name into v_title, v_dept from public.hr_positions pos left join public.departments dep on dep.id = pos.department_id where pos.id = j.position_id;
  insert into public.recruiter_decisions (application_id, seq, decision, reason, decided_by, decided_by_name, posting_id, position_title, department_name, correction_of, correction_reason)
  values (a.id, coalesce((select max(seq) from public.recruiter_decisions where application_id = a.id), 0) + 1, p_decision, v_reason, me.id, me.full_name, j.id, coalesce(j.title, v_title), v_dept, old.id, v_reason)
  returning * into d;
  update public.career_applications set stage = p_decision, version = version + 1, updated_at = now() where id = a.id;
  perform private.career_event(a.applicant_id, a.id, 'CAREER_DECISION_RECORDED', jsonb_build_object('decision', p_decision, 'corrected', true));
  perform private.rec_event(a.hr_candidate_id, 'DECISION', format('Decision corrected to %s', p_decision), jsonb_build_object('applicationId', a.id));
  perform private.recruiter_log(a.id, v_before, 'Decision corrected: ' || v_reason);
  perform private.write_audit('RECRUITER_DECISION_CORRECTED', 'career_application', a.id, null, null, jsonb_build_object('from', coalesce(old.decision, a.stage), 'to', p_decision));
  perform private.recruitment_email_queue(d.id, 'DECISION_CORRECTED');
  return jsonb_build_object('id', d.id, 'decision', d.decision, 'decidedAt', d.decided_at);
end $$;
revoke all on function public.recruiter_decision_correct(uuid, text, text) from public, anon;
grant execute on function public.recruiter_decision_correct(uuid, text, text) to authenticated;

-- The Selection & Rejection page: the applications ready for a decision, and the decided ones.
create or replace function public.recruiter_decisions_list(p_view text default 'READY')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  if p_view not in ('READY', 'DECIDED') then
    raise exception 'VALIDATION_ERROR: Choose ready or decided.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'sortAt') desc) from (
    select private.recruiter_row_json(r) || jsonb_build_object('sortAt', coalesce(r.decided_at, r.applied_at),
             'missingSteps', (select coalesce(jsonb_agg(s), '[]'::jsonb) from unnest(j.required_steps) s where
                (s = 'CALL' and not exists (select 1 from private.recruiter_calls_of(r.application_id) c where true and c.called_at is not null and c.outcome in ('ANSWERED', 'INTERESTED')))
                or (s = 'ASSESSMENT' and not exists (select 1 from public.career_attempts t where t.application_id = r.application_id and t.passed))
                or (s = 'INTERVIEW' and not exists (select 1 from public.career_interviews i where i.application_id = r.application_id and i.status = 'COMPLETED' and i.recommendation in ('PROCEED', 'SHORTLIST')))),
             'openings', j.openings, 'category', d.reason_category, 'reason', d.reason, 'decidedBy', d.decided_by_name) as x
      from private.recruiter_rows() r join public.career_postings j on j.id = r.posting_id left join public.recruiter_decisions d on d.application_id = r.application_id and d.is_current
     where case when p_view = 'READY' then r.pipeline_stage in ('SELECTION_REVIEW', 'INTERVIEW_COMPLETED', 'TEST_COMPLETED') and r.decision is null
                else r.pipeline_stage in ('SELECTED', 'REJECTED') end
     limit 300) q), '[]'::jsonb);
end $$;
revoke all on function public.recruiter_decisions_list(text) from public, anon;
grant execute on function public.recruiter_decisions_list(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Recruitment reports (aggregates only: no personal data)
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_reports(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_rows jsonb;
begin
  perform private.recruiter_require();
  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_rows from private.recruiter_filtered(f) c;
  return jsonb_build_object(
    'totals', jsonb_build_object(
      'vacancies', (select count(*) from public.career_postings j where (private.is_hr_leadership() or j.responsible_id = auth.uid())
                      and (nullif(f ->> 'posting', '') is null or j.id = (f ->> 'posting')::uuid)),
      'openVacancies', (select count(*) from public.career_postings j where j.vacancy_status = 'OPEN' and (private.is_hr_leadership() or j.responsible_id = auth.uid())
                      and (nullif(f ->> 'posting', '') is null or j.id = (f ->> 'posting')::uuid)),
      'closedVacancies', (select count(*) from public.career_postings j where j.vacancy_status in ('CLOSED', 'FILLED') and (private.is_hr_leadership() or j.responsible_id = auth.uid())
                      and (nullif(f ->> 'posting', '') is null or j.id = (f ->> 'posting')::uuid)),
      'applications', jsonb_array_length(v_rows),
      'screened', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'stage' <> 'NEW_APPLICATION'),
      'callsCompleted', (select count(*) from jsonb_array_elements(v_rows) c, private.recruiter_calls_of((c ->> 'applicationId')::uuid) k where k.called_at is not null),
      'interviewsScheduled', (select count(*) from jsonb_array_elements(v_rows) c, public.career_interviews i where (c ->> 'applicationId')::uuid = i.application_id and i.status = 'SCHEDULED'),
      'interviewsCompleted', (select count(*) from jsonb_array_elements(v_rows) c, public.career_interviews i where (c ->> 'applicationId')::uuid = i.application_id and i.status = 'COMPLETED'),
      'selected', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'stage' = 'SELECTED'),
      'rejected', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'stage' = 'REJECTED'),
      'onHold', (select count(*) from jsonb_array_elements(v_rows) c where c ->> 'stage' = 'ON_HOLD')),
    'byStage', coalesce((select jsonb_object_agg(s, n) from (select c ->> 'stage' s, count(*) n from jsonb_array_elements(v_rows) c group by 1) q), '{}'::jsonb),
    'vacancyProgress', coalesce((select jsonb_agg(jsonb_build_object('postingId', j.id, 'vacancy', j.title, 'department', dep.name, 'status', j.vacancy_status, 'openings', j.openings,
                 'applications', c.n, 'selected', c.sel, 'rejected', c.rej, 'inProgress', c.n - c.sel - c.rej) order by c.n desc)
        from public.career_postings j left join public.hr_positions pos on pos.id = j.position_id left join public.departments dep on dep.id = pos.department_id
        join (select x ->> 'postingId' pid, count(*) n, count(*) filter (where x ->> 'stage' = 'SELECTED') sel, count(*) filter (where x ->> 'stage' = 'REJECTED') rej
                from jsonb_array_elements(v_rows) x group by 1) c on c.pid = j.id::text), '[]'::jsonb),
    -- a Recruiter sees their own performance; HR leadership sees every Recruiter
    'recruiters', coalesce((select jsonb_agg(jsonb_build_object('recruiterId', rid, 'recruiter', rname, 'applications', n, 'selected', sel, 'rejected', rej,
                 'avgDaysToDecision', avg_days) order by n desc)
        from (select x ->> 'recruiterId' rid, x ->> 'recruiter' rname, count(*) n, count(*) filter (where x ->> 'stage' = 'SELECTED') sel, count(*) filter (where x ->> 'stage' = 'REJECTED') rej,
                     round(avg(extract(epoch from ((x ->> 'decidedAt')::timestamptz - (x ->> 'appliedAt')::timestamptz)) / 86400) filter (where x ->> 'decidedAt' is not null)::numeric, 1) avg_days
                from jsonb_array_elements(v_rows) x group by 1, 2) q), '[]'::jsonb),
    'scope', case when private.is_hr_leadership() then 'COMPANY' else 'OWN' end);
end $$;
revoke all on function public.recruiter_reports(jsonb) from public, anon;
grant execute on function public.recruiter_reports(jsonb) to authenticated;

-- The filter choices (departments, designations, vacancies, recruiters) the caller may use.
create or replace function public.recruiter_filter_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  return jsonb_build_object(
    'vacancies', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'title', j.title) order by j.title) from public.career_postings j where private.is_hr_leadership() or j.responsible_id = auth.uid()), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(distinct jsonb_build_object('id', dep.id, 'name', dep.name)) from public.career_postings j join public.hr_positions pos on pos.id = j.position_id join public.departments dep on dep.id = pos.department_id
                              where private.is_hr_leadership() or j.responsible_id = auth.uid()), '[]'::jsonb),
    'designations', coalesce((select jsonb_agg(distinct pos.title) from public.career_postings j join public.hr_positions pos on pos.id = j.position_id where private.is_hr_leadership() or j.responsible_id = auth.uid()), '[]'::jsonb),
    'recruiters', case when private.is_hr_leadership() then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name) from public.profiles p where p.hr_sub_role = 'HR_RECRUITER' and p.status = 'ACTIVE'), '[]'::jsonb) else '[]'::jsonb end,
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name) from public.profiles p where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb));
end $$;
revoke all on function public.recruiter_filter_options() from public, anon;
grant execute on function public.recruiter_filter_options() to authenticated;

-- ---------------------------------------------------------------------------
-- 15. The resume of an application the caller may see (the server signs a short-lived link for it)
-- ---------------------------------------------------------------------------
create or replace function public.career_file(p_id uuid default null,p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid; f public.career_files; vname text;
begin
  if p_data->>'action'='READ_HR' then
    perform private.hr_require_staff();
    select * into f from public.career_files where id=p_id and status='READY';
    if not exists(select 1 from public.career_applications where resume_id=p_id) and not exists(select 1 from public.career_documents where file_id=p_id) then raise exception 'NOT_FOUND: Resume not found.'; end if;
  elsif p_data->>'action'='READ_RECRUITER' then
    perform private.recruiter_require();
    select * into f from public.career_files where id=p_id and status='READY';
    if not exists(select 1 from public.career_applications a where a.resume_id=p_id and private.recruiter_can_access(a.id)) then raise exception 'NOT_FOUND: Resume not found.'; end if;
  else
    me:=private.career_me_id();
    if p_id is null and p_data is not null then
      vname:=p_data->>'file_name';
      if length(vname) not between 1 and 180 or lower(right(vname,4))<>'.pdf' or (p_data->>'size_bytes')::bigint not between 1 and 10485760 or p_data->>'storage_provider' not in ('R2','SUPABASE') then
        raise exception 'VALIDATION_ERROR: Upload a PDF resume of at most 10 MB.';
      end if;
      -- Bound abandoned upload reservations as well as ready file versions.
      if (select count(*) from public.career_files where applicant_id=me and created_at>now()-interval '1 day')>=20 then raise exception 'CONFLICT: Daily upload limit reached. Try again tomorrow.'; end if;
      insert into public.career_files(applicant_id,file_name,size_bytes,storage_provider,storage_path)
      values(me,vname,(p_data->>'size_bytes')::bigint,p_data->>'storage_provider',me::text||'/'||gen_random_uuid()::text||'.pdf') returning * into f;
    elsif p_id is not null then
      select * into f from public.career_files where id=p_id and applicant_id=me for update;
      if f.id is null then raise exception 'NOT_FOUND: Resume not found.'; end if;
      if p_data->>'action'='COMPLETE' then
        raise exception 'FORBIDDEN: Upload completion requires server verification.';
      elsif p_data->>'action'='ABORT' and f.status='PENDING' then
        update public.career_files set status='ABORTED' where id=f.id returning * into f;
      end if;
    else
      return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,file_name,size_bytes,created_at from public.career_files where applicant_id=me and status='READY' and purpose='RESUME' order by created_at desc limit 50) x),'[]');
    end if;
  end if;
  if f.id is null then raise exception 'NOT_FOUND: Resume not found.'; end if;
  return to_jsonb(f);
end $$;
revoke all on function public.career_file(uuid,jsonb) from public,anon;
grant execute on function public.career_file(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
