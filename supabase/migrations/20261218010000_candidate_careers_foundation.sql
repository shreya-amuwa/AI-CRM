-- Candidate membership is independent of CRM staff and client memberships.
create table if not exists public.career_applicants (
  id uuid primary key references auth.users(id) on delete restrict,
  name text not null default '', phone text not null default '', city text not null default '',
  state text not null default '', education text not null default '', experience text not null default '',
  skills text not null default '', bio text not null default '', updated_at timestamptz not null default now(),
  version integer not null default 1
);
create table if not exists public.career_postings (
  id uuid primary key default gen_random_uuid(), position_id uuid not null references public.hr_positions(id),
  title text not null, description text not null, location text not null, employment_type text not null,
  published boolean not null default false, closes_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), version integer not null default 1
);
create index if not exists career_postings_published_idx on public.career_postings(published,created_at desc);
create table if not exists public.career_files (
  id uuid primary key default gen_random_uuid(), applicant_id uuid not null references public.career_applicants(id),
  file_name text not null, size_bytes bigint not null check(size_bytes between 1 and 10485760),
  status text not null default 'PENDING' check(status in ('PENDING','READY','ABORTED')),
  storage_bucket text not null default 'career-resumes', storage_path text not null,
  storage_provider text not null check(storage_provider in ('SUPABASE','R2')),
  created_at timestamptz not null default now()
);
create index if not exists career_files_applicant_idx on public.career_files(applicant_id,created_at desc);
create table if not exists public.career_applications (
  id uuid primary key default gen_random_uuid(), applicant_id uuid not null references public.career_applicants(id),
  posting_id uuid not null references public.career_postings(id), resume_id uuid not null references public.career_files(id),
  hr_candidate_id uuid not null references public.hr_candidates(id), snapshot jsonb not null,
  stage text not null default 'SUBMITTED' check(stage in ('SUBMITTED','SCREENING','ASSESSMENT','INTERVIEW','SELECTED','ON_HOLD','REJECTED','WITHDRAWN','JOINING','TRAINING','COMPLETED')),
  candidate_message text, version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(applicant_id,posting_id)
);
create index if not exists career_applications_hr_idx on public.career_applications(hr_candidate_id);
create index if not exists career_applications_stage_idx on public.career_applications(stage,created_at desc);
create table if not exists public.career_events (
  id uuid primary key default gen_random_uuid(), applicant_id uuid not null references public.career_applicants(id),
  application_id uuid references public.career_applications(id), actor_auth_id uuid references auth.users(id),
  kind text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create index if not exists career_events_application_idx on public.career_events(application_id,created_at);
do $$ declare t text; begin
  foreach t in array array['career_applicants','career_postings','career_files','career_applications','career_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Opting out of staff provisioning conveys NO staff privilege. Preserve all existing trusted provisioning paths.
create or replace function private.tg_handle_new_auth_user_deferred()
returns trigger language plpgsql security definer set search_path = '' as $$
declare u auth.users;
begin
  select * into u from auth.users where id=new.id;
  if u.raw_app_meta_data ? 'client_customer_id' then return null; end if;
  if u.raw_user_meta_data ->> 'candidate_portal' = 'true'
     and not (coalesce(u.raw_app_meta_data,'{}') ?| array['provisioned_by','request_by','bootstrap_super_admin']) then
    return null;
  end if;
  perform private.provision_auth_user(new.id);
  return null;
end $$;
revoke all on function private.tg_handle_new_auth_user_deferred() from public,anon,authenticated;

create or replace function private.career_me_id()
returns uuid language plpgsql security definer set search_path = '' as $$
declare u auth.users;
begin
  select * into u from auth.users where id=auth.uid();
  if u.id is null then raise exception 'FORBIDDEN: Sign in to your candidate account.'; end if;
  if not exists(select 1 from public.career_applicants where id=u.id) then
    if u.raw_user_meta_data ->> 'candidate_portal' is distinct from 'true' then
      raise exception 'FORBIDDEN: This account is not registered for the candidate portal.';
    end if;
    if u.email_confirmed_at is null then raise exception 'FORBIDDEN: Verify your email before continuing.'; end if;
    insert into public.career_applicants(id) values(u.id) on conflict do nothing;
  end if;
  if u.email_confirmed_at is null then raise exception 'FORBIDDEN: Verify your email before continuing.'; end if;
  return u.id;
end $$;
revoke all on function private.career_me_id() from public,anon,authenticated;

create or replace function private.career_event(p_applicant uuid,p_application uuid,p_kind text,p_detail jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.career_events(applicant_id,application_id,actor_auth_id,kind,detail)
    values(p_applicant,p_application,auth.uid(),p_kind,p_detail);
  perform private.write_audit(p_kind,'career_application',p_application,null,null,
    jsonb_build_object('actor_auth_id',auth.uid(),'applicant_id',p_applicant,'changes',p_detail));
end $$;
revoke all on function private.career_event(uuid,uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.career_profile(p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := private.career_me_id(); old public.career_applicants; v public.career_applicants; k text;
begin
  select * into old from public.career_applicants where id=me for update;
  if p_data is not null then
    if jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) x where x not in ('name','phone','city','state','education','experience','skills','bio','version')) then
      raise exception 'VALIDATION_ERROR: Invalid profile fields.';
    end if;
    if nullif(btrim(p_data->>'name'),'') is null or length(p_data->>'name')>160 or nullif(btrim(p_data->>'phone'),'') is null or length(p_data->>'phone')>40 then
      raise exception 'VALIDATION_ERROR: Enter your name and mobile number.';
    end if;
    if private.mobile10(p_data->>'phone') is null or (p_data->>'phone') ~ '[^0-9+().[:space:]-]' then raise exception 'VALIDATION_ERROR: Enter a valid mobile number.'; end if;
    for k in select jsonb_object_keys(p_data) loop
      if k<>'version' and (jsonb_typeof(p_data->k)<>'string' or length(p_data->>k)>2000) then raise exception 'VALIDATION_ERROR: Profile field is too long or invalid.'; end if;
    end loop;
    if (p_data->>'version')::integer is distinct from old.version then raise exception 'CONFLICT: Your profile changed. Reload before saving.'; end if;
    update public.career_applicants set name=btrim(p_data->>'name'), phone=btrim(p_data->>'phone'),
      city=coalesce(p_data->>'city',''),state=coalesce(p_data->>'state',''),education=coalesce(p_data->>'education',''),
      experience=coalesce(p_data->>'experience',''),skills=coalesce(p_data->>'skills',''),bio=coalesce(p_data->>'bio',''),
      version=version+1,updated_at=now() where id=me returning * into v;
    perform private.career_event(me,null,'CANDIDATE_PROFILE_UPDATED',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(v)));
  else v:=old;
  end if;
  return to_jsonb(v) || jsonb_build_object('email',(select email from auth.users where id=me));
end $$;
revoke all on function public.career_profile(jsonb) from public,anon;
grant execute on function public.career_profile(jsonb) to authenticated;

create or replace function public.career_jobs(p_page integer default 1,p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_page not between 1 and 10000 or length(p_search)>120 then raise exception 'VALIDATION_ERROR: Invalid page or search.'; end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,title,description,location,employment_type,closes_at from public.career_postings
    where published and (closes_at is null or closes_at>now()) and title ilike '%'||p_search||'%'
    order by created_at desc,id limit 20 offset (p_page-1)*20) x),
    'total',(select count(*) from public.career_postings where published and (closes_at is null or closes_at>now()) and title ilike '%'||p_search||'%'));
end $$;
revoke all on function public.career_jobs(integer,text) from public;
grant execute on function public.career_jobs(integer,text) to anon,authenticated;

create or replace function public.hr_career_posting(p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.career_postings; pid uuid;
begin
  perform private.hr_require_staff();
  if p_data is not null then
    pid := nullif(p_data->>'id','')::uuid;
    if length(btrim(coalesce(p_data->>'title',''))) not between 2 and 160 or length(coalesce(p_data->>'description','')) not between 20 and 15000
      or length(btrim(coalesce(p_data->>'location',''))) not between 1 and 200 or p_data->>'employment_type' not in ('FULL_TIME','PART_TIME','INTERNSHIP','CONTRACT') then
      raise exception 'VALIDATION_ERROR: Complete the job title, description, location and employment type.';
    end if;
    if not exists(select 1 from public.hr_positions where id=(p_data->>'position_id')::uuid and is_open) then raise exception 'VALIDATION_ERROR: Choose an open HR position.'; end if;
    if pid is null then
      insert into public.career_postings(position_id,title,description,location,employment_type,published,closes_at)
      values((p_data->>'position_id')::uuid,btrim(p_data->>'title'),p_data->>'description',p_data->>'location',p_data->>'employment_type',coalesce((p_data->>'published')::boolean,false),nullif(p_data->>'closes_at','')::timestamptz) returning * into v;
    else
      select * into v from public.career_postings where id=pid for update;
      if v.id is null then raise exception 'NOT_FOUND: Job not found.'; end if;
      if (p_data->>'version')::integer is distinct from v.version then raise exception 'CONFLICT: This job changed. Reload before saving.'; end if;
      update public.career_postings set title=btrim(p_data->>'title'),description=p_data->>'description',location=p_data->>'location',
        employment_type=p_data->>'employment_type',published=(p_data->>'published')::boolean,closes_at=nullif(p_data->>'closes_at','')::timestamptz,
        version=version+1,updated_at=now() where id=pid returning * into v;
    end if;
    perform private.write_audit('CAREER_JOB_SAVED','career_posting',v.id,null,null,jsonb_build_object('version',v.version,'published',v.published));
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.career_postings order by created_at desc limit 200) x),'[]');
end $$;
revoke all on function public.hr_career_posting(jsonb) from public,anon;
grant execute on function public.hr_career_posting(jsonb) to authenticated;

create or replace function public.career_file(p_id uuid default null,p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid; f public.career_files; vname text;
begin
  if p_data->>'action'='READ_HR' then
    perform private.hr_require_staff();
    select * into f from public.career_files where id=p_id and status='READY';
    if not exists(select 1 from public.career_applications where resume_id=p_id) then raise exception 'NOT_FOUND: Resume not found.'; end if;
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
      return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,file_name,size_bytes,created_at from public.career_files where applicant_id=me and status='READY' order by created_at desc limit 50) x),'[]');
    end if;
  end if;
  if f.id is null then raise exception 'NOT_FOUND: Resume not found.'; end if;
  return to_jsonb(f);
end $$;
revoke all on function public.career_file(uuid,jsonb) from public,anon;
grant execute on function public.career_file(uuid,jsonb) to authenticated;

create or replace function public.career_apply(p_posting uuid,p_resume uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := private.career_me_id(); a public.career_applicants; j public.career_postings; app public.career_applications; cid uuid; email_address text;
begin
  select * into a from public.career_applicants where id=me for update;
  select * into app from public.career_applications where applicant_id=me and posting_id=p_posting;
  if app.id is not null then return to_jsonb(app); end if;
  select * into j from public.career_postings where id=p_posting for share;
  if j.id is null or not j.published or j.closes_at<=now() then raise exception 'NOT_FOUND: This job is no longer accepting applications.'; end if;
  if length(btrim(a.name))<2 or nullif(a.phone,'') is null then raise exception 'VALIDATION_ERROR: Complete your profile first.'; end if;
  if not exists(select 1 from public.career_files where id=p_resume and applicant_id=me and status='READY') then raise exception 'VALIDATION_ERROR: Choose your uploaded resume.'; end if;
  select lower(email) into email_address from auth.users where id=me;
  -- Existing HR candidates are never claimed by matching email. HR must resolve a pre-existing application explicitly.
  if exists(select 1 from public.hr_candidates where lower(email)=email_address and position_id=j.position_id) then
    raise exception 'CONFLICT: An application for this position already exists. Contact HR to link your existing application.';
  end if;
  insert into public.hr_candidates(name,email,phone,position_id,source)
  values(a.name,email_address,a.phone,j.position_id,'Candidate portal') returning id into cid;
  insert into public.career_applications(applicant_id,posting_id,resume_id,hr_candidate_id,snapshot)
  values(me,j.id,p_resume,cid,jsonb_build_object('profile',to_jsonb(a)||jsonb_build_object('email',email_address),'job',to_jsonb(j),'resume_id',p_resume)) returning * into app;
  perform private.career_event(me,app.id,'CAREER_APPLICATION_SUBMITTED',jsonb_build_object('stage',app.stage));
  perform private.rec_event(cid,'PORTAL_APPLICATION','Application submitted through the candidate portal');
  return to_jsonb(app);
end $$;
revoke all on function public.career_apply(uuid,uuid) from public,anon;
grant execute on function public.career_apply(uuid,uuid) to authenticated;

create or replace function public.career_applications()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := private.career_me_id();
begin
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select a.id,a.posting_id,a.stage,a.candidate_message,a.version,a.created_at,a.snapshot,
      (select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'created_at',e.created_at) order by e.created_at),'[]') from public.career_events e where e.application_id=a.id) as timeline
    from public.career_applications a where a.applicant_id=me order by a.created_at desc limit 100) x),'[]');
end $$;
revoke all on function public.career_applications() from public,anon;
grant execute on function public.career_applications() to authenticated;

-- Supabase storage is private; authorization/signing is performed by the existing server storage driver.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('career-resumes','career-resumes',false,10485760,array['application/pdf']) on conflict(id) do nothing;
notify pgrst,'reload schema';

-- Only the server can attest content/size verification; the candidate RPC cannot mark a file ready.
create or replace function public.career_file_verified(p_id uuid,p_size bigint,p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.career_files;
begin
  select * into f from public.career_files where id=p_id for update;
  if f.id is null then raise exception 'NOT_FOUND: Resume not found.'; end if;
  if f.status='READY' then return to_jsonb(f); end if;
  if f.status<>'PENDING' or f.created_at<now()-interval '2 hours' or f.size_bytes is distinct from p_size then raise exception 'VALIDATION_ERROR: Upload expired or size changed.'; end if;
  if p_path is null or p_path not like f.applicant_id::text||'/sealed/%.pdf' then raise exception 'VALIDATION_ERROR: Invalid sealed file path.'; end if;
  update public.career_files set status='READY',storage_path=p_path where id=p_id returning * into f;
  return to_jsonb(f);
end $$;
revoke all on function public.career_file_verified(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.career_file_verified(uuid,bigint,text) to service_role;
