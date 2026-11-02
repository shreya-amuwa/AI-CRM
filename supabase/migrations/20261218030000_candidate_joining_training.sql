-- Offers, requested joining documents and candidate enrollment reuse existing HR training evidence.
alter table public.career_files add column if not exists purpose text not null default 'RESUME' check(purpose in ('RESUME','JOINING'));
create table if not exists public.career_offers (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references public.career_applications(id),
 title text not null, terms text not null, expires_at timestamptz not null, joining_date date not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','RELEASED','ACCEPTED','DECLINED','EXPIRED','WITHDRAWN')),
 version integer not null default 1, released_by uuid references public.profiles(id), released_at timestamptz, responded_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index if not exists career_offers_active_idx on public.career_offers(application_id) where status in ('DRAFT','RELEASED','ACCEPTED');
create table if not exists public.career_documents (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references public.career_applications(id),
 title text not null, file_id uuid references public.career_files(id), status text not null default 'REQUESTED' check(status in ('REQUESTED','UPLOADED','APPROVED','REJECTED')),
 message text, version integer not null default 1, reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(), unique(application_id,title)
);
create index if not exists career_documents_application_idx on public.career_documents(application_id);
alter table public.hr_training_enrollments add column if not exists candidate_application_id uuid references public.career_applications(id);
create unique index if not exists hr_training_candidate_idx on public.hr_training_enrollments(program_id,candidate_application_id) where candidate_application_id is not null;
alter table public.career_applications add column if not exists training_enrollment_id uuid references public.hr_training_enrollments(id);
do $$ declare t text; begin
 foreach t in array array['career_offers','career_documents'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

create or replace function public.hr_career_offer(p_application uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.career_applications; o public.career_offers;
begin
 perform private.hr_require_staff();
 select * into c from public.career_applications where id=p_application for update;
 if c.id is null then raise exception 'NOT_FOUND: Application not found.'; end if;
 if c.stage<>'SELECTED' then raise exception 'CONFLICT: Select the candidate before preparing an offer.'; end if;
 if p_data->>'id' is null then
  if length(btrim(coalesce(p_data->>'title',''))) not between 2 and 160 or length(btrim(coalesce(p_data->>'terms',''))) not between 20 and 15000 or (p_data->>'expires_at')::timestamptz is null or (p_data->>'expires_at')::timestamptz<=now() or nullif(p_data->>'joining_date','') is null then raise exception 'VALIDATION_ERROR: Complete the offer title, terms, joining date and future expiry.'; end if;
  insert into public.career_offers(application_id,title,terms,expires_at,joining_date)
   values(c.id,p_data->>'title',p_data->>'terms',(p_data->>'expires_at')::timestamptz,(p_data->>'joining_date')::date) returning * into o;
 else
  select * into o from public.career_offers where id=(p_data->>'id')::uuid and application_id=c.id for update;
  if o.id is null then raise exception 'NOT_FOUND: Offer not found.'; end if;
  if o.version is distinct from (p_data->>'version')::integer then raise exception 'CONFLICT: Offer changed. Reload first.'; end if;
  if private.my_role() not in ('SUPER_ADMIN','DEPARTMENT_HEAD','TEAM_HEAD') then raise exception 'FORBIDDEN: An HR head or team head must approve or withdraw an offer.'; end if;
  if p_data->>'action'='RELEASE' and o.status='DRAFT' and o.expires_at>now() then
   update public.career_offers set status='RELEASED',released_at=now(),released_by=private.my_id(),version=version+1 where id=o.id returning * into o;
  elsif p_data->>'action'='WITHDRAW' and o.status in ('DRAFT','RELEASED') then
   update public.career_offers set status='WITHDRAWN',version=version+1 where id=o.id returning * into o;
  else raise exception 'CONFLICT: This offer can no longer be released or withdrawn.'; end if;
 end if;
 perform private.career_event(c.applicant_id,c.id,'CAREER_OFFER_UPDATED',jsonb_build_object('offer_id',o.id,'status',o.status));
 perform private.rec_event(c.hr_candidate_id,'OFFER',format('Portal offer: %s',o.status));
 return to_jsonb(o);
end $$;
revoke all on function public.hr_career_offer(uuid,jsonb) from public,anon;
grant execute on function public.hr_career_offer(uuid,jsonb) to authenticated;

create or replace function public.career_offers(p_id uuid default null,p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.career_me_id(); o public.career_offers; c public.career_applications;
begin
 if p_id is not null then
  select a.* into c from public.career_applications a join public.career_offers x on x.application_id=a.id where x.id=p_id and a.applicant_id=me for update of a;
  if c.id is null then raise exception 'NOT_FOUND: Offer not found.'; end if;
  select * into o from public.career_offers where id=p_id and status<>'DRAFT' for update;
  if o.id is null then raise exception 'NOT_FOUND: Offer not found.'; end if;
  if p_data is not null then
   if o.status in ('ACCEPTED','DECLINED') and o.status=p_data->>'response' then return to_jsonb(o); end if;
   if c.stage<>'SELECTED' or o.status<>'RELEASED' or o.expires_at<=clock_timestamp() then raise exception 'CONFLICT: This offer is no longer available.'; end if;
   if o.version is distinct from (p_data->>'version')::integer or p_data->>'response' not in ('ACCEPTED','DECLINED') then raise exception 'CONFLICT: Offer changed. Reload before responding.'; end if;
   update public.career_offers set status=p_data->>'response',responded_at=now(),version=version+1 where id=o.id returning * into o;
   if o.status='ACCEPTED' then update public.career_applications set stage='JOINING',version=version+1,updated_at=now() where id=c.id; end if;
   perform private.career_event(me,c.id,'CAREER_OFFER_RESPONDED',jsonb_build_object('offer_id',o.id,'response',o.status));
   perform private.rec_event(c.hr_candidate_id,'OFFER_RESPONSE',format('Candidate %s the portal offer',lower(o.status)));
  end if;
  return to_jsonb(o);
 end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select offr.id,offr.application_id,offr.title,offr.terms,offr.expires_at,offr.joining_date,
   case when offr.status='RELEASED' and offr.expires_at<=now() then 'EXPIRED' else offr.status end as status,offr.version,offr.released_at,offr.responded_at
   from public.career_offers offr join public.career_applications appl on appl.id=offr.application_id where appl.applicant_id=me and offr.status<>'DRAFT' order by offr.created_at desc) x),'[]');
end $$;
revoke all on function public.career_offers(uuid,jsonb) from public,anon;
grant execute on function public.career_offers(uuid,jsonb) to authenticated;

create or replace function public.hr_career_documents(p_application uuid,p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.career_applications; d public.career_documents; f public.career_files;
begin
 perform private.hr_require_staff();
 select * into c from public.career_applications where id=p_application for update;
 if c.id is null then raise exception 'NOT_FOUND: Application not found.'; end if;
 if c.stage not in ('SELECTED','JOINING','TRAINING') then raise exception 'CONFLICT: Documents are requested only for selected candidates.'; end if;
 if p_data is not null then
  if p_data->>'id' is null then
   if length(btrim(coalesce(p_data->>'title',''))) not between 2 and 160 then raise exception 'VALIDATION_ERROR: Enter a document request title.'; end if;
   insert into public.career_documents(application_id,title,message) values(c.id,btrim(p_data->>'title'),left(p_data->>'message',1000))
    on conflict(application_id,title) do nothing returning * into d;
   if d.id is null then return public.hr_career_documents(p_application,null); end if;
  else
   select * into d from public.career_documents where id=(p_data->>'id')::uuid and application_id=c.id for update;
   if d.id is null then raise exception 'NOT_FOUND: Document request not found.'; end if;
   select * into f from public.career_files where id=d.file_id;
   if d.version is distinct from (p_data->>'version')::integer or d.status<>'UPLOADED' or f.status<>'READY' then raise exception 'CONFLICT: This document is not ready for review. Reload first.'; end if;
   if p_data->>'status' not in ('APPROVED','REJECTED') or (p_data->>'status'='REJECTED' and nullif(btrim(p_data->>'message'),'') is null) then raise exception 'VALIDATION_ERROR: Reject with a reason, or approve the document.'; end if;
   update public.career_documents set status=p_data->>'status',message=left(p_data->>'message',1000),reviewed_by=private.my_id(),reviewed_at=now(),version=version+1 where id=d.id returning * into d;
  end if;
  perform private.career_event(c.applicant_id,c.id,'CAREER_DOCUMENT_UPDATED',jsonb_build_object('document_id',d.id,'status',d.status));
 end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from public.career_documents x where application_id=c.id),'[]');
end $$;
revoke all on function public.hr_career_documents(uuid,jsonb) from public,anon;
grant execute on function public.hr_career_documents(uuid,jsonb) to authenticated;

create or replace function public.career_documents(p_id uuid default null,p_file uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.career_me_id(); d public.career_documents; c public.career_applications; f public.career_files;
begin
 if p_id is not null then
  select a.* into c from public.career_applications a join public.career_documents x on x.application_id=a.id where x.id=p_id and a.applicant_id=me for update of a;
  if c.id is null then raise exception 'NOT_FOUND: Document request not found.'; end if;
  select * into d from public.career_documents where id=p_id for update;
  if p_file is not null then
   if d.file_id=p_file and d.status='UPLOADED' then return to_jsonb(d); end if;
   if c.stage not in ('SELECTED','JOINING','TRAINING') or d.status='APPROVED' then raise exception 'CONFLICT: This request is no longer accepting uploads.'; end if;
   select * into f from public.career_files where id=p_file and applicant_id=me and status='READY' for update;
   if f.id is null or exists(select 1 from public.career_applications where resume_id=f.id) or exists(select 1 from public.career_documents where file_id=f.id and id<>d.id) then raise exception 'VALIDATION_ERROR: Upload a new PDF for this document request.'; end if;
   update public.career_files set purpose='JOINING' where id=f.id;
   update public.career_documents set file_id=f.id,status='UPLOADED',reviewed_by=null,reviewed_at=null,version=version+1 where id=d.id returning * into d;
   perform private.career_event(me,c.id,'CAREER_DOCUMENT_SUBMITTED',jsonb_build_object('document_id',d.id));
  end if;
  return to_jsonb(d);
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',doappl.id,'application_id',doappl.application_id,'title',doappl.title,'file_id',doappl.file_id,'status',doappl.status,'message',doappl.message,'version',doappl.version))
  from public.career_documents d join public.career_applications c on appl.id=doappl.application_id where appl.applicant_id=me),'[]');
end $$;
revoke all on function public.career_documents(uuid,uuid) from public,anon;
grant execute on function public.career_documents(uuid,uuid) to authenticated;

create or replace function public.hr_career_training(p_application uuid,p_program uuid default null,p_complete boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.career_applications; p public.hr_training_programs; e public.hr_training_enrollments;
begin
 perform private.hr_require_staff();
 select * into c from public.career_applications where id=p_application for update;
 if c.id is null then raise exception 'NOT_FOUND: Application not found.'; end if;
 if p_complete then
  if c.stage='COMPLETED' then return jsonb_build_object('application_id',c.id,'enrollment_id',c.training_enrollment_id); end if;
  select * into e from public.hr_training_enrollments where id=c.training_enrollment_id for update;
  if c.stage<>'TRAINING' or e.status<>'COMPLETED' or not exists(select 1 from public.hr_training_day_reports where enrollment_id=e.id and day_no=3 and assessment_result='PASS') then raise exception 'CONFLICT: Complete all training days and pass the final assessment first.'; end if;
  if (select count(distinct training_day) from public.career_attempts where training_enrollment_id=e.id and passed=true)<>3 then raise exception 'CONFLICT: Pass the online assessment for all three training days first.'; end if;
  if private.my_role() not in ('SUPER_ADMIN','DEPARTMENT_HEAD','TEAM_HEAD') then raise exception 'FORBIDDEN: HR leadership must approve final placement.'; end if;
  update public.career_applications set stage='COMPLETED',version=version+1,updated_at=now() where id=c.id;
  perform private.career_event(c.applicant_id,c.id,'CAREER_PLACEMENT_APPROVED',jsonb_build_object('enrollment_id',e.id));
  perform private.rec_event(c.hr_candidate_id,'PLACEMENT','Training complete; HR approved department placement. Staff activation is a separate authorized process.');
 elsif p_program is not null then
  if c.stage='TRAINING' and exists(select 1 from public.hr_training_enrollments where id=c.training_enrollment_id and program_id=p_program) then return jsonb_build_object('application_id',c.id,'enrollment_id',c.training_enrollment_id); end if;
  if c.stage not in ('JOINING','TRAINING') or not exists(select 1 from public.career_offers where application_id=c.id and status='ACCEPTED') then raise exception 'CONFLICT: An accepted offer is required before training.'; end if;
  if exists(select 1 from public.career_documents where application_id=c.id and status<>'APPROVED') then raise exception 'CONFLICT: Verify every requested document first.'; end if;
  select * into p from public.hr_training_programs where id=p_program and not is_cancelled;
  if p.id is null then raise exception 'NOT_FOUND: Active training program not found.'; end if;
  insert into public.hr_training_enrollments(program_id,employee_key,employee_name,department_name,designation,enrolled_by,candidate_application_id)
   values(p.id,'CANDIDATE:'||c.id::text,c.snapshot#>>'{profile,name}',null,c.snapshot#>>'{job,title}',private.my_id(),c.id)
   on conflict(program_id,employee_key) do nothing;
  select * into e from public.hr_training_enrollments where program_id=p.id and candidate_application_id=c.id;
  update public.career_applications set training_enrollment_id=e.id,stage='TRAINING',version=version+1,updated_at=now() where id=c.id;
  perform private.career_event(c.applicant_id,c.id,'CAREER_TRAINING_ENROLLED',jsonb_build_object('enrollment_id',e.id));
 end if;
 return jsonb_build_object('application_id',c.id,'enrollment_id',e.id);
end $$;
revoke all on function public.hr_career_training(uuid,uuid,boolean) from public,anon;
grant execute on function public.hr_career_training(uuid,uuid,boolean) to authenticated;

create or replace function public.career_training()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.career_me_id();
begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'application_id',c.id,'title',p.name,'start_date',p.start_date,'status',e.status,
  'days',(select coalesce(jsonb_agg(jsonb_build_object('day_no',d.day_no,'title',d.title,'topics',d.topics,'trainer_name',d.trainer_name,'attendance',r.attendance,'assessment_result',r.assessment_result,'completed',r.day_completed) order by d.day_no),'[]')
    from public.hr_training_days d left join public.hr_training_day_reports r on r.enrollment_id=e.id and r.day_no=d.day_no where d.program_id=p.id)))
  from public.career_applications c join public.hr_training_enrollments e on e.id=c.training_enrollment_id join public.hr_training_programs p on p.id=e.program_id where c.applicant_id=me),'[]');
end $$;
revoke all on function public.career_training() from public,anon;
grant execute on function public.career_training() to authenticated;

create or replace function public.career_withdraw(p_application uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.career_me_id(); c public.career_applications;
begin
 select * into c from public.career_applications where id=p_application and applicant_id=me for update;
 if c.id is null then raise exception 'NOT_FOUND: Application not found.'; end if;
 if c.stage='WITHDRAWN' then return; end if;
 if c.stage in ('JOINING','TRAINING','COMPLETED','REJECTED') then raise exception 'CONFLICT: Contact HR to discuss leaving this stage.'; end if;
 update public.career_applications set stage='WITHDRAWN',version=version+1,updated_at=now() where id=c.id;
 update public.career_offers set status='WITHDRAWN',version=version+1 where application_id=c.id and status in ('DRAFT','RELEASED');
 perform private.career_event(me,c.id,'CAREER_APPLICATION_WITHDRAWN',jsonb_build_object('before',c.stage));
 perform private.rec_event(c.hr_candidate_id,'WITHDRAWN','Candidate withdrew the portal application');
end $$;
revoke all on function public.career_withdraw(uuid) from public,anon;
grant execute on function public.career_withdraw(uuid) to authenticated;

-- Service-only maintenance; candidate read/save paths also enforce deadlines independently.
create or replace function public.career_expire_attempts()
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
 for a in select id from public.career_attempts where deadline<=now() and submitted_at is null loop perform private.career_finish(a.id); end loop;
 update public.career_offers set status='EXPIRED',version=version+1 where status='RELEASED' and expires_at<=now();
end $$;
revoke all on function public.career_expire_attempts() from public,anon,authenticated;
grant execute on function public.career_expire_attempts() to service_role;

-- Keep requested joining documents out of the reusable resume picker.
create or replace function public.career_file(p_id uuid default null,p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid; f public.career_files; vname text;
begin
  if p_data->>'action'='READ_HR' then
    perform private.hr_require_staff();
    select * into f from public.career_files where id=p_id and status='READY';
    if not exists(select 1 from public.career_applications where resume_id=p_id) and not exists(select 1 from public.career_documents where file_id=p_id) then raise exception 'NOT_FOUND: Resume not found.'; end if;
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
  perform 1 from public.career_files where id=p_resume and applicant_id=me and status='READY' and purpose='RESUME' for share;
  if not found then raise exception 'VALIDATION_ERROR: Choose your uploaded resume.'; end if;
  select lower(email) into email_address from auth.users where id=me;
  -- Existing HR candidates are never claimed by matching email. HR must resolve a pre-existing application explicitly.
  select h.id into cid from public.career_applications prior join public.hr_candidates h on h.id=prior.hr_candidate_id where prior.applicant_id=me and h.position_id=j.position_id limit 1;
  if cid is null and exists(select 1 from public.hr_candidates where lower(email)=email_address and position_id=j.position_id) then
    raise exception 'CONFLICT: An application for this position already exists. Contact HR to link your existing application.';
  end if;
  if cid is null then
  insert into public.hr_candidates(name,email,phone,position_id,source)
  values(a.name,email_address,a.phone,j.position_id,'Candidate portal') returning id into cid;
  end if;
  insert into public.career_applications(applicant_id,posting_id,resume_id,hr_candidate_id,snapshot)
  values(me,j.id,p_resume,cid,jsonb_build_object('profile',to_jsonb(a)||jsonb_build_object('email',email_address),'job',to_jsonb(j),'resume_id',p_resume)) returning * into app;
  perform private.career_event(me,app.id,'CAREER_APPLICATION_SUBMITTED',jsonb_build_object('stage',app.stage));
  perform private.rec_event(cid,'PORTAL_APPLICATION','Application submitted through the candidate portal');
  return to_jsonb(app);
end $$;
revoke all on function public.career_apply(uuid,uuid) from public,anon;
grant execute on function public.career_apply(uuid,uuid) to authenticated;


create or replace function public.hr_career_applications(p_page integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 perform private.hr_require_staff();
 if p_page not between 1 and 10000 then raise exception 'VALIDATION_ERROR: Invalid page.'; end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
   select c.*,j.title,(select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc),'[]') from public.career_offers o where o.application_id=c.id) as offers,(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.career_documents d where d.application_id=c.id) as documents,(select coalesce(jsonb_agg((to_jsonb(a)-'answers')||jsonb_build_object('title',testrow.title)),'[]') from public.career_attempts a join public.career_tests testrow on testrow.id=a.test_id where a.application_id=c.id) as attempts,
     (select coalesce(jsonb_agg(to_jsonb(i) order by i.scheduled_at),'[]') from public.career_interviews i where i.application_id=c.id) as interviews
    from public.career_applications c join public.career_postings j on j.id=c.posting_id order by c.created_at desc,c.id limit 20 offset (p_page-1)*20) x),
    'total',(select count(*) from public.career_applications));
end $$;
revoke all on function public.hr_career_applications(integer) from public,anon;
grant execute on function public.hr_career_applications(integer) to authenticated;


notify pgrst,'reload schema';

alter table public.career_attempts add column if not exists training_enrollment_id uuid references public.hr_training_enrollments(id);
alter table public.career_attempts add column if not exists training_day integer check(training_day between 1 and 3);
create index if not exists career_attempts_training_idx on public.career_attempts(training_enrollment_id,training_day);
create or replace function public.hr_career_training_invite(p_application uuid,p_test uuid,p_until timestamptz,p_day integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.career_applications; a public.career_attempts;
begin
 perform private.hr_require_staff();
 select * into c from public.career_applications where id=p_application for update;
 if c.id is null then raise exception 'NOT_FOUND: Application not found.'; end if;
 if c.stage<>'TRAINING' or c.training_enrollment_id is null or p_day not between 1 and 3 or p_day is null or p_until is null or p_until<=now() then raise exception 'CONFLICT: Choose an enrolled candidate, training day and future deadline.'; end if;
 if not exists(select 1 from public.career_tests where id=p_test) then raise exception 'NOT_FOUND: Assessment not found.'; end if;
 insert into public.career_attempts(application_id,test_id,available_until,training_enrollment_id,training_day)
  values(c.id,p_test,p_until,c.training_enrollment_id,p_day) on conflict(application_id,test_id) do nothing returning * into a;
 if a.id is null then
  select * into a from public.career_attempts where application_id=c.id and test_id=p_test;
  if a.training_enrollment_id is distinct from c.training_enrollment_id or a.training_day is distinct from p_day then raise exception 'CONFLICT: Use a separate assessment version for each training day.'; end if;
  return to_jsonb(a)-'answers';
 end if;
 perform private.career_event(c.applicant_id,c.id,'CAREER_TRAINING_TEST_INVITED',jsonb_build_object('attempt_id',a.id,'day',p_day));
 return to_jsonb(a)-'answers';
end $$;
revoke all on function public.hr_career_training_invite(uuid,uuid,timestamptz,integer) from public,anon;
grant execute on function public.hr_career_training_invite(uuid,uuid,timestamptz,integer) to authenticated;

create or replace function public.career_assessment(p_id uuid default null,p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.career_me_id(); a public.career_attempts; t public.career_tests; k text; qs jsonb;
begin
 -- Finalize expired attempts before returning a candidate's state. Every save/submit also checks the server deadline.
 for a in select x.* from public.career_attempts x join public.career_applications c on c.id=x.application_id
   where c.applicant_id=me and x.started_at is not null and x.submitted_at is null and x.deadline<=clock_timestamp() loop
  perform private.career_finish(a.id);
 end loop;
 if p_id is null then
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'application_id',x.application_id,'title',testrow.title,'duration_minutes',testrow.duration_minutes,'available_until',x.available_until,
    'started_at',x.started_at,'deadline',x.deadline,'submitted_at',x.submitted_at,'score',x.score,'passed',x.passed,'question_count',jsonb_array_length(testrow.questions),'version',x.version))
    from public.career_attempts x join public.career_tests testrow on testrow.id=x.test_id join public.career_applications c on c.id=x.application_id where c.applicant_id=me),'[]');
 end if;
 select x.* into a from public.career_attempts x join public.career_applications c on c.id=x.application_id where x.id=p_id and c.applicant_id=me for update of x;
 if a.id is null then raise exception 'NOT_FOUND: Assessment not found.'; end if;
 select * into t from public.career_tests where id=a.test_id;
 if p_data->>'action'='START' and a.started_at is null then
  if a.available_until<=clock_timestamp() or not exists(select 1 from public.career_applications where id=a.application_id and ((stage='ASSESSMENT' and a.training_enrollment_id is null) or (stage='TRAINING' and training_enrollment_id=a.training_enrollment_id))) then raise exception 'CONFLICT: This assessment is no longer available.'; end if;
  if a.training_day is not null and exists(select 1 from public.hr_training_enrollments e join public.hr_training_programs p on p.id=e.program_id where e.id=a.training_enrollment_id and (p.is_cancelled or private.hr_today()<p.start_date+(a.training_day-1))) then raise exception 'CONFLICT: This training day has not started or its program was cancelled.'; end if;
  update public.career_attempts set started_at=now(),deadline=least(available_until,now()+make_interval(mins=>t.duration_minutes)),version=version+1 where id=a.id returning * into a;
 elsif p_data->>'action' in ('SAVE','SUBMIT') and a.submitted_at is null then
  if a.started_at is null then raise exception 'CONFLICT: Start the test first.'; end if;
  if not exists(select 1 from public.career_applications where id=a.application_id and ((stage='ASSESSMENT' and a.training_enrollment_id is null) or (stage='TRAINING' and training_enrollment_id=a.training_enrollment_id))) then raise exception 'CONFLICT: This application is no longer in assessment.'; end if;
  if clock_timestamp()<a.deadline then
   if (p_data->>'version')::integer is distinct from a.version then raise exception 'CONFLICT: Answers changed in another window. Reload the test.'; end if;
   if jsonb_typeof(p_data->'answers') is distinct from 'object' or pg_column_size(p_data->'answers')>20000 then raise exception 'VALIDATION_ERROR: Invalid answers.'; end if;
   for k in select jsonb_object_keys(p_data->'answers') loop
    if k !~ '^(0|[1-9][0-9]{0,2})$' or k::integer>=jsonb_array_length(t.questions) or jsonb_typeof(p_data->'answers'->k)<>'number'
      or (p_data->'answers'->>k)::numeric<>trunc((p_data->'answers'->>k)::numeric)
      or (p_data->'answers'->>k)::integer not between 0 and jsonb_array_length(t.questions->(k::integer)->'options')-1 then raise exception 'VALIDATION_ERROR: Invalid question or answer.'; end if;
   end loop;
   update public.career_attempts set answers=p_data->'answers',version=version+1 where id=a.id returning * into a;
  end if;
  if p_data->>'action'='SUBMIT' or clock_timestamp()>=a.deadline then perform private.career_finish(a.id); end if;
 end if;
 select * into a from public.career_attempts where id=p_id;
 select coalesce(jsonb_agg(jsonb_build_object('prompt',q->>'prompt','options',q->'options')),'[]') into qs from jsonb_array_elements(t.questions) q;
 return (to_jsonb(a)-'test_id')||jsonb_build_object('title',t.title,'server_time',clock_timestamp(),'questions',case when a.started_at is not null and a.submitted_at is null then qs else '[]'::jsonb end);
end $$;
revoke all on function public.career_assessment(uuid,jsonb) from public,anon;
grant execute on function public.career_assessment(uuid,jsonb) to authenticated;


notify pgrst,'reload schema';

create table if not exists public.career_mail_jobs (
 id uuid primary key default gen_random_uuid(), event_id uuid not null unique references public.career_events(id),
 applicant_id uuid not null references public.career_applicants(id), recipient text not null,
 status text not null default 'PENDING' check(status in ('PENDING','SENDING','SENT','FAILED','DRY_RUN')),
 claimed_at timestamptz, finished_at timestamptz
);
alter table public.career_mail_jobs enable row level security;
revoke all on public.career_mail_jobs from public,anon,authenticated;
create index if not exists career_mail_pending_idx on public.career_mail_jobs(status,id);

create or replace function private.career_event(p_applicant uuid,p_application uuid,p_kind text,p_detail jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare eid uuid; recipient text;
begin
 insert into public.career_events(applicant_id,application_id,actor_auth_id,kind,detail) values(p_applicant,p_application,auth.uid(),p_kind,p_detail) returning id into eid;
 perform private.write_audit(p_kind,'career_application',p_application,null,null,jsonb_build_object('actor_auth_id',auth.uid(),'applicant_id',p_applicant,'changes',p_detail));
 if p_kind in ('CAREER_APPLICATION_SUBMITTED','CAREER_TEST_INVITED','CAREER_STAGE_CHANGED','CAREER_INTERVIEW_UPDATED','CAREER_DOCUMENT_UPDATED','CAREER_TRAINING_ENROLLED','CAREER_TRAINING_TEST_INVITED','CAREER_PLACEMENT_APPROVED')
  or (p_kind='CAREER_OFFER_UPDATED' and p_detail->>'status' in ('RELEASED','WITHDRAWN')) then
  select email into recipient from auth.users where id=p_applicant and email_confirmed_at is not null;
  if recipient is not null then insert into public.career_mail_jobs(event_id,applicant_id,recipient) values(eid,p_applicant,recipient) on conflict(event_id) do nothing; end if;
 end if;
end $$;
revoke all on function private.career_event(uuid,uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.career_notifications()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.career_me_id();
begin
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,application_id,kind,created_at from public.career_events where applicant_id=me
   and kind not in ('CANDIDATE_PROFILE_UPDATED') and not (kind='CAREER_OFFER_UPDATED' and detail->>'status'='DRAFT') order by created_at desc limit 100) x),'[]');
end $$;
revoke all on function public.career_notifications() from public,anon;
grant execute on function public.career_notifications() to authenticated;

create or replace function public.career_mail_claim(p_live boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 -- A worker that died after sending has an ambiguous delivery outcome. Do not resend automatically.
 update public.career_mail_jobs set status='FAILED',finished_at=now() where status='SENDING' and claimed_at<now()-interval '10 minutes';
 with next as (select id from public.career_mail_jobs where status='PENDING' order by id limit 10 for update skip locked),
 claimed as (update public.career_mail_jobs j set status=case when p_live then 'SENDING' else 'DRY_RUN' end,claimed_at=now() from next where j.id=next.id returning j.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'recipient',recipient)),'[]') into result from claimed;
 return result;
end $$;
revoke all on function public.career_mail_claim(boolean) from public,anon,authenticated;
grant execute on function public.career_mail_claim(boolean) to service_role;

create or replace function public.career_mail_finish(p_id uuid,p_sent boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.career_mail_jobs set status=case when p_sent then 'SENT' else 'FAILED' end,finished_at=now() where id=p_id and status='SENDING';
end $$;
revoke all on function public.career_mail_finish(uuid,boolean) from public,anon,authenticated;
grant execute on function public.career_mail_finish(uuid,boolean) to service_role;
notify pgrst,'reload schema';

create or replace function public.career_applications()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := private.career_me_id();
begin
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select a.id,a.posting_id,a.stage,a.candidate_message,a.version,a.created_at,a.snapshot,
      (select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'created_at',e.created_at) order by e.created_at),'[]') from public.career_events e where e.application_id=a.id and not (e.kind='CAREER_OFFER_UPDATED' and e.detail->>'status'='DRAFT')) as timeline
    from public.career_applications a where a.applicant_id=me order by a.created_at desc limit 100) x),'[]');
end $$;
revoke all on function public.career_applications() from public,anon;
grant execute on function public.career_applications() to authenticated;


-- Retain the temporary upload path only until the sealed version is complete and cleanup succeeds.
alter table public.career_files add column if not exists upload_path text;
alter table public.career_files add column if not exists purged_at timestamptz;
create or replace function public.career_file_verified(p_id uuid,p_size bigint,p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.career_files;
begin
 select * into f from public.career_files where id=p_id for update;
 if f.id is null then raise exception 'NOT_FOUND: Resume not found.'; end if;
 if f.status='READY' then return to_jsonb(f); end if;
 if f.status<>'PENDING' or f.created_at<now()-interval '2 hours' or f.size_bytes is distinct from p_size then raise exception 'VALIDATION_ERROR: Upload expired or size changed.'; end if;
 if p_path is null or p_path not like f.applicant_id::text||'/sealed/%.pdf' then raise exception 'VALIDATION_ERROR: Invalid sealed file path.'; end if;
 update public.career_files set status='READY',upload_path=storage_path,storage_path=p_path where id=p_id returning * into f;
 return to_jsonb(f);
end $$;
revoke all on function public.career_file_verified(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.career_file_verified(uuid,bigint,text) to service_role;

create or replace function public.career_upload_cleanup()
returns jsonb language sql security definer set search_path = '' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
  select id,storage_bucket,storage_provider,case when status='READY' then upload_path else storage_path end as path
  from public.career_files where (status='READY' and upload_path is not null) or (status in ('PENDING','ABORTED') and purged_at is null and created_at<now()-interval '2 hours')
  order by created_at limit 50) x
$$;
revoke all on function public.career_upload_cleanup() from public,anon,authenticated;
grant execute on function public.career_upload_cleanup() to service_role;

create or replace function public.career_upload_purged(p_id uuid,p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.career_files set upload_path=null where id=p_id and status='READY' and upload_path=p_path;
 update public.career_files set status='ABORTED',purged_at=now() where id=p_id and status in ('PENDING','ABORTED') and storage_path=p_path and created_at<now()-interval '2 hours';
end $$;
revoke all on function public.career_upload_purged(uuid,text) from public,anon,authenticated;
grant execute on function public.career_upload_purged(uuid,text) to service_role;
notify pgrst,'reload schema';
