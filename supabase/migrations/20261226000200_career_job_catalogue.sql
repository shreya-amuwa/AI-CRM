-- Candidate careers portal: the job catalogue (additive; safe to run twice).
--
--   * career_postings gets the fields a candidate expects on a vacancy: a stable job code, the team, the work mode (remote / hybrid / on-site),
--     the pay (free text), responsibilities, benefits and the date it was first published.
--   * career_jobs (public) can be filtered by team / work mode / location and reports the filter values that exist (facets).
--   * career_job(id) (public) reads ONE open job, so a page does not have to page through the list.
--   * hr_career_posting accepts the new fields (all optional: an older form still saves).
-- Everything that was public before stays public; nothing internal (responsible recruiter, openings, status note, approval) is added to the public job.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.career_postings
  add column if not exists code text,
  add column if not exists team text,
  add column if not exists work_mode text,
  add column if not exists salary_text text,
  add column if not exists responsibilities text,
  add column if not exists benefits text,
  add column if not exists published_at timestamptz;

alter table public.career_postings drop constraint if exists career_postings_work_mode_check;
alter table public.career_postings add constraint career_postings_work_mode_check check (work_mode is null or work_mode in ('REMOTE', 'HYBRID', 'ONSITE'));
alter table public.career_postings drop constraint if exists career_postings_catalogue_len_check;
alter table public.career_postings add constraint career_postings_catalogue_len_check
  check (length(team) <= 80 and length(salary_text) <= 120 and length(responsibilities) <= 4000 and length(benefits) <= 4000);

-- ---------------------------------------------------------------------------
-- 2. Job code + first-published date
--    The code is assigned once and never changes. published_at is the first time the job went live (unpublishing and republishing keeps it).
-- ---------------------------------------------------------------------------
create sequence if not exists public.career_posting_code_seq;
revoke all on sequence public.career_posting_code_seq from public, anon, authenticated;

create or replace function private.tg_career_posting_catalogue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.code is not null then
    new.code := old.code;
  elsif new.code is null then
    new.code := 'JOB-' || lpad(nextval('public.career_posting_code_seq')::text, 4, '0');
  end if;
  if tg_op = 'UPDATE' and old.published_at is not null then
    new.published_at := old.published_at;
  elsif new.published and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;
revoke all on function private.tg_career_posting_catalogue() from public, anon, authenticated;
-- Triggers run in name order: this one must see the final `published` that career_postings_status decided, so it is named to sort after it.
drop trigger if exists career_postings_z_catalogue on public.career_postings;
create trigger career_postings_z_catalogue before insert or update on public.career_postings
  for each row execute function private.tg_career_posting_catalogue();

-- Existing jobs: first-published date from when they were created, then a code in creation order.
update public.career_postings set published_at = created_at where published and published_at is null;
with ordered as (select id from public.career_postings where code is null order by created_at, id)
update public.career_postings p set code = 'JOB-' || lpad(nextval('public.career_posting_code_seq')::text, 4, '0')
  from ordered where p.id = ordered.id;
alter table public.career_postings alter column code set not null;
create unique index if not exists career_postings_code_key on public.career_postings (code);

-- ---------------------------------------------------------------------------
-- 3. What a candidate (or anyone) may see of a job. ONE place, used by the list and the single read.
-- ---------------------------------------------------------------------------
create or replace function private.career_job_public(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', p->'id', 'code', p->'code', 'title', p->'title', 'description', p->'description', 'location', p->'location',
    'employment_type', p->'employment_type', 'closes_at', p->'closes_at', 'published_at', p->'published_at',
    'team', p->'team', 'work_mode', p->'work_mode', 'salary_text', p->'salary_text',
    'responsibilities', p->'responsibilities', 'benefits', p->'benefits',
    'skills', p->'skills', 'qualifications', p->'qualifications', 'experience', p->'experience')
$$;
revoke all on function private.career_job_public(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Public list: search + filters + facets. Calls with only (page, search) keep working.
-- ---------------------------------------------------------------------------
drop function if exists public.career_jobs(integer, text);
create or replace function public.career_jobs(
  p_page integer default 1, p_search text default '', p_team text default '', p_mode text default '', p_location text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s text := coalesce(p_search, ''); t text := coalesce(p_team, ''); m text := coalesce(p_mode, ''); l text := coalesce(p_location, ''); pat text;
begin
  if p_page is null or p_page not between 1 and 10000 or length(s) > 120 or length(t) > 80 or length(l) > 200 then
    raise exception 'VALIDATION_ERROR: Invalid page or search.';
  end if;
  if m not in ('', 'REMOTE', 'HYBRID', 'ONSITE') then raise exception 'VALIDATION_ERROR: Choose remote, hybrid or on-site.'; end if;
  -- the search text is matched literally (% and _ are not wildcards)
  pat := '%' || replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return (
    with open as (
      select * from public.career_postings where published and (closes_at is null or closes_at > now())
    ), hit as (
      select * from open o
       where (s = '' or o.title ilike pat or o.code ilike pat or coalesce(o.team, '') ilike pat or o.location ilike pat)
         and (t = '' or lower(coalesce(o.team, '')) = lower(t))
         and (m = '' or o.work_mode = m)
         and (l = '' or lower(o.location) = lower(l))
    )
    select jsonb_build_object(
      'items', (select coalesce(jsonb_agg(private.career_job_public(to_jsonb(x)) order by x.created_at desc, x.id), '[]')
                  from (select * from hit order by created_at desc, id limit 20 offset (p_page - 1) * 20) x),
      'total', (select count(*) from hit),
      'facets', jsonb_build_object(
        'teams', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by v), '[]') from (select team v, count(*) n from open where team is not null group by team) q),
        'locations', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by v), '[]') from (select location v, count(*) n from open group by location) q),
        'modes', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by v), '[]') from (select work_mode v, count(*) n from open where work_mode is not null group by work_mode) q)))
  );
end $$;
revoke all on function public.career_jobs(integer, text, text, text, text) from public;
grant execute on function public.career_jobs(integer, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Public single read: one OPEN job (unpublished, closed and expired jobs are "not found" - they do not reveal that they exist)
-- ---------------------------------------------------------------------------
create or replace function public.career_job(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.career_postings;
begin
  select * into v from public.career_postings where id = p_id and published and (closes_at is null or closes_at > now());
  if v.id is null then raise exception 'NOT_FOUND: This role is no longer open.'; end if;
  return private.career_job_public(to_jsonb(v));
end $$;
revoke all on function public.career_job(uuid) from public;
grant execute on function public.career_job(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. HR saves the new fields (everything else in this function is exactly as before)
-- ---------------------------------------------------------------------------
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
                      where r.id = v_resp and r.status = 'ACTIVE' and d.slug = 'hr' and r.hr_sub_role = 'HR_RECRUITER') then
        raise exception 'VALIDATION_ERROR: Choose an active HR Recruiter.';
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
