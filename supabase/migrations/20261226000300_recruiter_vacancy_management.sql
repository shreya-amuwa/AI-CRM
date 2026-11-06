-- =============================================================================
-- HR Recruiter: create, edit and publish their own vacancies, and a Department filter that lists the real departments.
--
-- WHAT WAS WRONG
--   * A Recruiter had no way to create a vacancy: the only save function, hr_career_posting, is for HR staff WITHOUT the Recruiter designation
--     (private.hr_require_staff). The Recruiter's Vacancies page could only show vacancies HR leadership had created and allocated.
--   * recruiter_filter_options() built the Department list from the vacancies the caller is responsible for, so a Recruiter with no vacancy (or HR
--     leadership before any vacancy exists) saw an empty list.
--
-- WHAT THIS DOES (additive; nothing is deleted; existing vacancies, applications and decisions are unchanged)
--   1. public.recruiter_vacancy_save(p_data): a Recruiter creates a vacancy (they become its responsible recruiter) or edits one they are responsible
--      for; HR leadership (Super Admin / Department Head of HR) creates or edits any. The department is chosen from the departments table; the job
--      title becomes the HR position (designation) of that department, re-using an existing one. Every field is validated here.
--   2. public.recruiter_vacancy_status: the responsible Recruiter may now publish (Open), put On hold, Close, mark Filled and reopen their own vacancy
--      (decision of the owner, 6 Nov 2026: Recruiters publish directly). HR leadership is notified when a Recruiter publishes or reopens one, and every
--      change is audited. Leadership keeps every change.
--   3. public.recruiter_vacancies(p_status, p_department): the list can be filtered by department in the database.
--   4. public.recruiter_vacancy(p_id): the detail also returns the fields the edit form needs (version, responsibilities, work mode, department id).
--   5. public.recruiter_filter_options(): departments come from the departments table (every department, not the "side" records of another).
--
-- Run after 20261226000200_career_job_catalogue.sql. Safe to run again.
-- =============================================================================

-- the HR people who are told about a vacancy a Recruiter creates or publishes (the same people the approval request went to)
create or replace function private.notify_hr_leadership(p_type text, p_title text, p_body text, p_entity_id uuid)
returns void language sql security definer set search_path = '' as $$
  select private.notify(l.id, p_type, p_title, p_body, 'career_posting', p_entity_id)
    from public.profiles l
   where l.status = 'ACTIVE' and l.id is distinct from auth.uid()
     and (l.role = 'SUPER_ADMIN' or (l.role = 'DEPARTMENT_HEAD' and not l.is_operations_head
                                     and exists (select 1 from public.departments d where d.id = l.department_id and d.slug = 'hr')))
$$;
revoke all on function private.notify_hr_leadership(text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Create / edit a vacancy
-- ---------------------------------------------------------------------------
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
    if private.is_hr_recruiter() and not v_lead then
      v_resp := auth.uid();
    elsif nullif(p_data->>'responsibleId', '') is not null then
      v_resp := (p_data->>'responsibleId')::uuid;
      if not exists (select 1 from public.profiles r join public.departments d on d.id = r.department_id
                      where r.id = v_resp and r.status = 'ACTIVE' and d.slug = 'hr' and r.hr_sub_role = 'HR_RECRUITER') then
        raise exception 'VALIDATION_ERROR: Choose an active HR Recruiter.' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- 2. Status: the responsible Recruiter publishes, holds, closes, marks filled and reopens their own vacancy
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_vacancy_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.career_postings;
  v_lead boolean := private.is_hr_leadership();
  v_mine boolean;
  v_before text;
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
  if not v_lead and not coalesce(v_mine, false) then
    raise exception 'NOT_FOUND: Vacancy not found.' using errcode = 'P0001';
  end if;
  if j.vacancy_status = p_status then
    return private.vacancy_json(j);
  end if;
  -- a published vacancy does not go back to a draft (candidates may already have seen it); leadership keeps every change
  if not v_lead and p_status = 'DRAFT' then
    raise exception 'FORBIDDEN: A published vacancy cannot become a draft again. Put it on hold or close it.' using errcode = '42501';
  end if;
  select count(*) into v_selected from public.career_applications a where a.posting_id = j.id and a.stage in ('SELECTED', 'JOINING', 'TRAINING', 'COMPLETED');
  if p_status = 'OPEN' and v_selected >= j.openings then
    raise exception 'CONFLICT: All the positions of this vacancy are filled. Increase the openings or close it.' using errcode = 'P0001';
  end if;
  v_before := j.vacancy_status;
  update public.career_postings set vacancy_status = p_status, status_note = left(nullif(btrim(p_note), ''), 500), version = version + 1, updated_at = now()
   where id = j.id returning * into j;
  perform private.write_audit('RECRUITER_VACANCY_STATUS', 'career_posting', j.id, null, null,
    jsonb_build_object('from', v_before, 'status', p_status, 'note', left(p_note, 200)));
  if p_status = 'PENDING_APPROVAL' then
    perform private.notify_hr_leadership('RECRUITER_VACANCY_APPROVAL', format('Vacancy waiting for approval: %s', j.title), 'A vacancy was sent for approval.', j.id);
  elsif p_status = 'OPEN' and not v_lead then
    perform private.notify_hr_leadership('RECRUITER_VACANCY_PUBLISHED', format('Vacancy %s: %s', case when v_before = 'DRAFT' then 'published' else 'reopened' end, j.title),
      format('%s set it to Open (was %s).', (select full_name from public.profiles where id = auth.uid()), replace(lower(v_before), '_', ' ')), j.id);
  end if;
  return private.vacancy_json(j);
end $$;
revoke all on function public.recruiter_vacancy_status(uuid, text, text) from public, anon;
grant execute on function public.recruiter_vacancy_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The list, with a department filter applied in the database
-- ---------------------------------------------------------------------------
drop function if exists public.recruiter_vacancies(text);
create or replace function public.recruiter_vacancies(p_status text default null, p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  if p_status is not null and p_status not in ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED') then
    raise exception 'VALIDATION_ERROR: Choose a valid vacancy status.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(private.vacancy_json(j) order by (j.vacancy_status = 'OPEN') desc, j.created_at desc)
                     from public.career_postings j
                     left join public.hr_positions pos on pos.id = j.position_id
                    where (p_status is null or j.vacancy_status = p_status)
                      and (p_department is null or pos.department_id = p_department)
                      and (private.is_hr_leadership() or j.responsible_id = auth.uid() or (j.responsible_id is null and j.vacancy_status <> 'DRAFT'))), '[]'::jsonb);
end $$;
revoke all on function public.recruiter_vacancies(text, uuid) from public, anon;
grant execute on function public.recruiter_vacancies(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The detail carries what the edit form needs
-- ---------------------------------------------------------------------------
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
    'responsibilities', j.responsibilities, 'workMode', j.work_mode, 'version', j.version, 'code', j.code,
    'canManage', private.is_hr_leadership(), 'canAct', private.is_hr_leadership() or coalesce(j.responsible_id = auth.uid(), false),
    'candidates', coalesce((select jsonb_agg(c order by (c ->> 'appliedAt') desc) from private.recruiter_filtered(jsonb_build_object('posting', j.id)) c), '[]'::jsonb));
end $$;
revoke all on function public.recruiter_vacancy(uuid) from public, anon;
grant execute on function public.recruiter_vacancy(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Filter options: every department of the company (not only the departments of the caller's vacancies)
-- ---------------------------------------------------------------------------
create or replace function public.recruiter_filter_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.recruiter_require();
  return jsonb_build_object(
    'vacancies', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'title', j.title) order by j.title) from public.career_postings j where private.is_hr_leadership() or j.responsible_id = auth.uid()), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d where d.facet_of is null), '[]'::jsonb),
    'designations', coalesce((select jsonb_agg(distinct pos.title) from public.career_postings j join public.hr_positions pos on pos.id = j.position_id where private.is_hr_leadership() or j.responsible_id = auth.uid()), '[]'::jsonb),
    'recruiters', case when private.is_hr_leadership() then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name) from public.profiles p where p.hr_sub_role = 'HR_RECRUITER' and p.status = 'ACTIVE'), '[]'::jsonb) else '[]'::jsonb end,
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name) from public.profiles p where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb));
end $$;
revoke all on function public.recruiter_filter_options() from public, anon;
grant execute on function public.recruiter_filter_options() to authenticated;

notify pgrst, 'reload schema';
