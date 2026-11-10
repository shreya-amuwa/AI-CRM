-- =============================================================================
-- HR Assistants use the existing HR Recruiter workspace (the same vacancies, applications, calls, interviews, assessments and reports), with the
-- same per-record limits as an HR Recruiter. Nothing is duplicated and nobody's designation changes.
--
-- What was there: every recruitment function asks private.recruiter_require() (an HR Recruiter, or HR leadership) and private.recruiter_can_access()
-- (HR leadership: everything; an HR Recruiter: the applications of the vacancies they are responsible for, and the candidates they own).
-- An HR Assistant (hr_sub_role = HR_ASSISTANT) was refused everywhere.
--
-- Now a capability, private.is_recruitment_operator() = an active HR Recruiter OR an active HR Assistant of the HR department, replaces "is an HR
-- Recruiter" in exactly those checks (and in the lists of people a vacancy can be given to). It is NOT leadership:
--   * an HR Assistant sees only the vacancies they are responsible for (or that wait unallocated, as a Recruiter does) and those applications;
--   * a vacancy they create is theirs (they cannot name somebody else);
--   * allocating vacancies to others, correcting final decisions and every other leadership-only action stay with the HR Department Head and the
--     Super Admin (private.is_hr_leadership() is unchanged);
--   * the HR Assistant keeps the HR dashboard (default_dashboard and private.is_hr_staff are unchanged); the HR Recruiter's access is unchanged.
-- The Candidate Portal (registration, profiles, applications, assessments, interviews, decisions, e-mails) is not touched.
-- Functions below are the latest definitions with only those checks changed. Safe to run again.
-- =============================================================================

create or replace function private.is_hr_assistant()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
                  where p.id = auth.uid() and p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and p.hr_sub_role = 'HR_ASSISTANT' and d.slug = 'hr')
$$;
revoke all on function private.is_hr_assistant() from public, anon;
grant execute on function private.is_hr_assistant() to authenticated, service_role;

-- the people who do recruitment work on the records allocated to them (not leadership)
create or replace function private.is_recruitment_operator()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_hr_recruiter() or private.is_hr_assistant()
$$;
revoke all on function private.is_recruitment_operator() from public, anon;
grant execute on function private.is_recruitment_operator() to authenticated, service_role;


-- private.recruiter_can_access: latest definition from 20261222000300_recruiter_workspace.sql
create or replace function private.recruiter_can_access(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_hr_leadership() or (private.is_recruitment_operator() and exists (
    select 1 from public.career_applications a join public.career_postings j on j.id = a.posting_id left join public.hr_candidates hc on hc.id = a.hr_candidate_id
     where a.id = p_application and (j.responsible_id = auth.uid() or hc.owner_id = auth.uid())))
$$;
revoke all on function private.recruiter_can_access(uuid) from public, anon;
grant execute on function private.recruiter_can_access(uuid) to authenticated, service_role;

-- private.recruiter_require: latest definition from 20261222000100_hr_recruiter_role.sql
create or replace function private.recruiter_require()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_recruitment_operator() or private.is_hr_leadership()) then
    raise exception 'FORBIDDEN: Recruitment is for HR Recruiters and HR Assistants.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.recruiter_require() from public, anon;
grant execute on function private.recruiter_require() to authenticated, service_role;

-- public.hr_career_posting: latest definition from 20261226000200_career_job_catalogue.sql
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
    if p_data ? 'work_mode' and coalesce(p_data->>'work_mode','') not in ('','REMOTE','HYBRID','ONSITE') then raise exception 'VALIDATION_ERROR: Choose remote, hybrid or on-site.'; end if;
    if length(coalesce(p_data->>'team','')) > 80 or length(coalesce(p_data->>'salary_text','')) > 120
       or length(coalesce(p_data->>'responsibilities','')) > 4000 or length(coalesce(p_data->>'benefits','')) > 4000 then
      raise exception 'VALIDATION_ERROR: Keep the team, pay, responsibilities and benefits shorter.';
    end if;
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
                      where r.id = v_resp and r.status = 'ACTIVE' and d.slug = 'hr' and r.hr_sub_role in ('HR_RECRUITER', 'HR_ASSISTANT')) then
        raise exception 'VALIDATION_ERROR: Choose an active HR Recruiter or HR Assistant.';
      end if;
    end if;
    if pid is null then
      insert into public.career_postings(position_id,title,description,location,employment_type,published,closes_at,openings,vacancy_status,responsible_id,qualifications,skills,experience,required_steps,team,work_mode,salary_text,responsibilities,benefits)
      values((p_data->>'position_id')::uuid,btrim(p_data->>'title'),p_data->>'description',p_data->>'location',p_data->>'employment_type',coalesce((p_data->>'published')::boolean,false),nullif(p_data->>'closes_at','')::timestamptz,
        coalesce((p_data->>'openings')::int,1), coalesce(nullif(p_data->>'vacancy_status',''),'DRAFT'), v_resp, nullif(btrim(p_data->>'qualifications'),''), nullif(btrim(p_data->>'skills'),''), nullif(btrim(p_data->>'experience'),''), coalesce(v_steps,'{}'),
        nullif(btrim(p_data->>'team'),''), nullif(p_data->>'work_mode',''), nullif(btrim(p_data->>'salary_text'),''), nullif(btrim(p_data->>'responsibilities'),''), nullif(btrim(p_data->>'benefits'),'')) returning * into v;
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
        team=case when p_data ? 'team' then nullif(btrim(p_data->>'team'),'') else team end,
        work_mode=case when p_data ? 'work_mode' then nullif(p_data->>'work_mode','') else work_mode end,
        salary_text=case when p_data ? 'salary_text' then nullif(btrim(p_data->>'salary_text'),'') else salary_text end,
        responsibilities=case when p_data ? 'responsibilities' then nullif(btrim(p_data->>'responsibilities'),'') else responsibilities end,
        benefits=case when p_data ? 'benefits' then nullif(btrim(p_data->>'benefits'),'') else benefits end,
        version=version+1,updated_at=now() where id=pid returning * into v;
    end if;
    perform private.write_audit('CAREER_JOB_SAVED','career_posting',v.id,null,null,jsonb_build_object('version',v.version,'published',v.published,'status',v.vacancy_status));
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.career_postings order by created_at desc limit 200) x),'[]');
end $$;
revoke all on function public.hr_career_posting(jsonb) from public,anon;
grant execute on function public.hr_career_posting(jsonb) to authenticated;

-- public.recruiter_context: latest definition from 20261222000300_recruiter_workspace.sql
create or replace function public.recruiter_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  perform private.recruiter_require();
  select * into me from public.profiles where id = auth.uid();
  return jsonb_build_object(
    'id', me.id, 'name', me.full_name, 'email', me.email, 'designation', case when me.hr_sub_role = 'HR_RECRUITER' then 'HR Recruiter' when me.hr_sub_role = 'HR_ASSISTANT' then 'HR Assistant' else coalesce(nullif(me."position", ''), me.role::text) end,
    'isRecruiter', private.is_hr_recruiter(), 'isAssistant', private.is_hr_assistant(), 'isLeadership', private.is_hr_leadership(),
    'newApplications', (select count(*) from private.recruiter_rows() r where r.career_stage = 'SUBMITTED' and r.pipeline_stage = 'NEW_APPLICATION'),
    'overdueFollowUps', (select count(*) from public.career_applications a cross join lateral private.recruiter_calls_of(a.id) c
                          where c.follow_up_date < private.hr_today() and private.recruiter_can_access(a.id)
                            and not exists (select 1 from private.recruiter_calls_of(a.id) n where n.created_at > c.created_at)),
    'vacanciesInQueue', (select count(*) from public.career_postings j where j.responsible_id is null and j.vacancy_status = 'OPEN'));
end $$;
revoke all on function public.recruiter_context() from public, anon;
grant execute on function public.recruiter_context() to authenticated;

-- public.recruiter_directory: latest definition from 20261222000300_recruiter_workspace.sql
create or replace function public.recruiter_directory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  if not private.is_hr_leadership() then
    raise exception 'FORBIDDEN: Only HR leadership allocates vacancies.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
                     from public.profiles p join public.departments d on d.id = p.department_id
                    where p.status = 'ACTIVE' and d.slug = 'hr' and p.hr_sub_role in ('HR_RECRUITER', 'HR_ASSISTANT')), '[]'::jsonb);
end $$;
revoke all on function public.recruiter_directory() from public, anon;
grant execute on function public.recruiter_directory() to authenticated;

-- public.recruiter_filter_options: latest definition from 20261227000200_recruiter_vacancy_management.sql
create or replace function public.recruiter_filter_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  return jsonb_build_object(
    'vacancies', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'title', j.title) order by j.title) from public.career_postings j where private.is_hr_leadership() or j.responsible_id = auth.uid()), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d where d.facet_of is null), '[]'::jsonb),
    'designations', coalesce((select jsonb_agg(distinct pos.title) from public.career_postings j join public.hr_positions pos on pos.id = j.position_id where private.is_hr_leadership() or j.responsible_id = auth.uid()), '[]'::jsonb),
    'recruiters', case when private.is_hr_leadership() then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name) from public.profiles p where p.hr_sub_role in ('HR_RECRUITER', 'HR_ASSISTANT') and p.status = 'ACTIVE'), '[]'::jsonb) else '[]'::jsonb end,
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name) from public.profiles p where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb));
end $$;
revoke all on function public.recruiter_filter_options() from public, anon;
grant execute on function public.recruiter_filter_options() to authenticated;

-- public.recruiter_vacancy_assign: latest definition from 20261222000300_recruiter_workspace.sql
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
                                              where r.id = p_recruiter and r.status = 'ACTIVE' and d.slug = 'hr' and r.hr_sub_role in ('HR_RECRUITER', 'HR_ASSISTANT')) then
    raise exception 'VALIDATION_ERROR: Choose an active HR Recruiter or HR Assistant.' using errcode = 'P0001';
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

-- public.recruiter_vacancy_save: latest definition from 20261227000200_recruiter_vacancy_management.sql
create or replace function public.recruiter_vacancy_save(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.career_postings;
  v_lead boolean := private.is_hr_leadership();
  v_id uuid;
  v_title text;
  v_dept uuid;
  v_pos uuid;
  v_openings integer;
  v_closes timestamptz;
  v_status text;
  v_resp uuid;
  v_selected integer;
begin
  perform private.recruiter_require();
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'VALIDATION_ERROR: Send the vacancy details.' using errcode = 'P0001';
  end if;
  v_id := nullif(p_data->>'id', '')::uuid;
  v_title := btrim(coalesce(p_data->>'title', ''));
  if length(v_title) not between 2 and 120 then
    raise exception 'VALIDATION_ERROR: Enter the job title / designation (2 to 120 characters).' using errcode = 'P0001';
  end if;
  v_dept := nullif(p_data->>'departmentId', '')::uuid;
  if v_dept is null or not exists (select 1 from public.departments d where d.id = v_dept and d.facet_of is null) then
    raise exception 'VALIDATION_ERROR: Choose the department.' using errcode = 'P0001';
  end if;
  if coalesce(p_data->>'openings', '') !~ '^[0-9]{1,3}$' or (p_data->>'openings')::int not between 1 and 500 then
    raise exception 'VALIDATION_ERROR: The number of openings must be between 1 and 500.' using errcode = 'P0001';
  end if;
  v_openings := (p_data->>'openings')::int;
  if length(btrim(coalesce(p_data->>'description', ''))) not between 20 and 15000 then
    raise exception 'VALIDATION_ERROR: Describe the job in at least 20 characters.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_data->>'responsibilities', '')) > 4000 or length(coalesce(p_data->>'skills', '')) > 4000
     or length(coalesce(p_data->>'qualifications', '')) > 4000 or length(coalesce(p_data->>'experience', '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the responsibilities, skills and qualifications under 4000 characters and the experience under 2000.' using errcode = 'P0001';
  end if;
  if coalesce(p_data->>'employmentType', '') not in ('FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT') then
    raise exception 'VALIDATION_ERROR: Choose the employment type.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_data->>'location', ''))) not between 1 and 200 then
    raise exception 'VALIDATION_ERROR: Enter the job location.' using errcode = 'P0001';
  end if;
  if nullif(p_data->>'workMode', '') is not null and p_data->>'workMode' not in ('REMOTE', 'HYBRID', 'ONSITE') then
    raise exception 'VALIDATION_ERROR: Choose remote, hybrid or on-site.' using errcode = 'P0001';
  end if;
  begin
    v_closes := nullif(p_data->>'closesAt', '')::timestamptz;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter a valid application deadline.' using errcode = 'P0001';
  end;

  -- the designation of the vacancy is an HR position of the chosen department (re-used when it exists, opened again when it was closed)
  insert into public.hr_positions (title, department_id, is_open, created_by) values (v_title, v_dept, true, auth.uid())
  on conflict (lower(btrim(title)), coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
  select p.id into v_pos from public.hr_positions p
   where lower(btrim(p.title)) = lower(v_title) and p.department_id = v_dept;
  update public.hr_positions set is_open = true, updated_at = now() where id = v_pos and not is_open;

  if v_id is null then
    if v_closes is not null and v_closes < now() then
      raise exception 'VALIDATION_ERROR: The application deadline must be in the future.' using errcode = 'P0001';
    end if;
    v_status := coalesce(nullif(p_data->>'status', ''), 'OPEN');
    if v_status not in ('DRAFT', 'OPEN') then
      raise exception 'VALIDATION_ERROR: A new vacancy is saved as a draft or published.' using errcode = 'P0001';
    end if;
    -- a Recruiter is responsible for what they create; HR leadership may name a Recruiter (or leave it in the waiting queue)
    if private.is_recruitment_operator() and not v_lead then
      v_resp := auth.uid();
    elsif nullif(p_data->>'responsibleId', '') is not null then
      v_resp := (p_data->>'responsibleId')::uuid;
      if not exists (select 1 from public.profiles r join public.departments d on d.id = r.department_id
                      where r.id = v_resp and r.status = 'ACTIVE' and d.slug = 'hr' and r.hr_sub_role in ('HR_RECRUITER', 'HR_ASSISTANT')) then
        raise exception 'VALIDATION_ERROR: Choose an active HR Recruiter or HR Assistant.' using errcode = 'P0001';
      end if;
    end if;
    insert into public.career_postings (position_id, title, description, location, employment_type, closes_at, openings, vacancy_status, responsible_id,
                                        responsibilities, qualifications, skills, experience, work_mode)
    values (v_pos, v_title, btrim(p_data->>'description'), btrim(p_data->>'location'), p_data->>'employmentType', v_closes, v_openings, v_status, v_resp,
            nullif(btrim(p_data->>'responsibilities'), ''), nullif(btrim(p_data->>'qualifications'), ''), nullif(btrim(p_data->>'skills'), ''),
            nullif(btrim(p_data->>'experience'), ''), nullif(p_data->>'workMode', ''))
    returning * into j;
    perform private.write_audit('RECRUITER_VACANCY_CREATED', 'career_posting', j.id, v_dept, null,
      jsonb_build_object('title', j.title, 'status', j.vacancy_status, 'openings', j.openings));
    if not v_lead then
      perform private.notify_hr_leadership('RECRUITER_VACANCY_CREATED',
        format('%s: %s', case when j.vacancy_status = 'OPEN' then 'Vacancy published' else 'Vacancy drafted' end, j.title),
        format('%s created this vacancy (%s opening%s).', (select full_name from public.profiles where id = auth.uid()), j.openings, case when j.openings = 1 then '' else 's' end),
        j.id);
    end if;
  else
    select * into j from public.career_postings where id = v_id for update;
    if j.id is null or not (v_lead or j.responsible_id = auth.uid()) then
      raise exception 'NOT_FOUND: Vacancy not found.' using errcode = 'P0001';
    end if;
    if nullif(p_data->>'version', '') is null or (p_data->>'version')::integer is distinct from j.version then
      raise exception 'CONFLICT: This vacancy changed since you opened it. Reload it before saving.' using errcode = 'P0001';
    end if;
    if v_closes is not null and v_closes < now() and v_closes is distinct from j.closes_at then
      raise exception 'VALIDATION_ERROR: The application deadline must be in the future.' using errcode = 'P0001';
    end if;
    select count(*) into v_selected from public.career_applications a where a.posting_id = j.id and a.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED');
    if v_openings < v_selected then
      raise exception 'VALIDATION_ERROR: % candidate% already selected; the openings cannot be fewer.', v_selected, case when v_selected = 1 then ' is' else 's are' end using errcode = 'P0001';
    end if;
    update public.career_postings
       set position_id = v_pos, title = v_title, description = btrim(p_data->>'description'), location = btrim(p_data->>'location'),
           employment_type = p_data->>'employmentType', closes_at = v_closes, openings = v_openings,
           responsibilities = nullif(btrim(p_data->>'responsibilities'), ''), qualifications = nullif(btrim(p_data->>'qualifications'), ''),
           skills = nullif(btrim(p_data->>'skills'), ''), experience = nullif(btrim(p_data->>'experience'), ''), work_mode = nullif(p_data->>'workMode', ''),
           version = version + 1, updated_at = now()
     where id = j.id returning * into j;
    perform private.write_audit('RECRUITER_VACANCY_UPDATED', 'career_posting', j.id, v_dept, null,
      jsonb_build_object('title', j.title, 'version', j.version, 'openings', j.openings));
  end if;
  return private.vacancy_json(j);
end $$;
revoke all on function public.recruiter_vacancy_save(jsonb) from public, anon;
grant execute on function public.recruiter_vacancy_save(jsonb) to authenticated;
