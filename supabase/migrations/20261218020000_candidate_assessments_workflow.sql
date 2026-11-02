create table if not exists public.career_tests (
 id uuid primary key default gen_random_uuid(), title text not null, duration_minutes integer not null check(duration_minutes between 1 and 180),
 pass_percent integer not null check(pass_percent between 1 and 100), questions jsonb not null, created_at timestamptz not null default now(), created_by uuid references public.profiles(id)
);
create table if not exists public.career_attempts (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references public.career_applications(id),
 test_id uuid not null references public.career_tests(id), available_until timestamptz not null,
 started_at timestamptz, deadline timestamptz, submitted_at timestamptz, answers jsonb not null default '{}',
 score integer, passed boolean, version integer not null default 1, unique(application_id,test_id)
);
create index if not exists career_attempts_application_idx on public.career_attempts(application_id);
create index if not exists career_attempts_deadline_idx on public.career_attempts(deadline) where submitted_at is null;
create table if not exists public.career_interviews (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references public.career_applications(id),
 round text not null check(round in ('HR','DEPARTMENT_HEAD','MANAGEMENT')),
 scheduled_at timestamptz not null, location text not null, status text not null default 'SCHEDULED' check(status in ('SCHEDULED','COMPLETED','CANCELLED')),
 recommendation text check(recommendation in ('PROCEED','REJECT','HOLD')), internal_feedback text,
 version integer not null default 1, created_at timestamptz not null default now()
);
create unique index if not exists career_interviews_slot_idx on public.career_interviews(application_id,round,scheduled_at) where status<>'CANCELLED';
create index if not exists career_interviews_application_idx on public.career_interviews(application_id,scheduled_at);
do $$ declare t text; begin
 foreach t in array array['career_tests','career_attempts','career_interviews'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

create or replace function public.hr_career_tests(p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q jsonb; v_id uuid;
begin
 perform private.hr_require_staff();
 if p_data is not null then
  if length(btrim(coalesce(p_data->>'title',''))) not between 2 and 160 or (p_data->>'duration_minutes')::integer not between 1 and 180 or (p_data->>'pass_percent')::integer not between 1 and 100
    or jsonb_typeof(p_data->'questions') is distinct from 'array' or jsonb_array_length(p_data->'questions') not between 1 and 100 then raise exception 'VALIDATION_ERROR: Complete the test configuration.'; end if;
  for q in select value from jsonb_array_elements(p_data->'questions') loop
   if length(coalesce(q->>'prompt','')) not between 1 and 2000 or jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options') not between 2 and 8
    or (q->>'correct')::integer is null or (q->>'correct')::integer not between 0 and jsonb_array_length(q->'options')-1
    or exists(select 1 from jsonb_array_elements(q->'options') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 500)
    then raise exception 'VALIDATION_ERROR: Every question needs text, choices and a valid correct choice.'; end if;
  end loop;
  insert into public.career_tests(title,duration_minutes,pass_percent,questions,created_by)
    values(p_data->>'title',(p_data->>'duration_minutes')::integer,(p_data->>'pass_percent')::integer,p_data->'questions',private.my_id()) returning id into v_id;
  perform private.write_audit('CAREER_TEST_PUBLISHED','career_test',v_id,null,null,jsonb_build_object('title',p_data->>'title'));
 end if;
 -- Published tests are immutable. A change creates a new test version/id.
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,title,duration_minutes,pass_percent,jsonb_array_length(questions) as question_count from public.career_tests order by created_at desc limit 200) x),'[]');
end $$;
revoke all on function public.hr_career_tests(jsonb) from public,anon;
grant execute on function public.hr_career_tests(jsonb) to authenticated;

create or replace function private.career_finish(p_attempt uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.career_attempts; t public.career_tests; c public.career_applications; n integer;
begin
 select * into a from public.career_attempts where id=p_attempt for update;
 if a.submitted_at is not null or a.started_at is null then return; end if;
 select * into t from public.career_tests where id=a.test_id;
 select count(*) into n from jsonb_array_elements(t.questions) with ordinality q(value,idx)
   where a.answers->>((idx-1)::text) = q.value->>'correct';
 update public.career_attempts set submitted_at=now(),score=n,passed=(100*n >= t.pass_percent*jsonb_array_length(t.questions)),version=version+1 where id=a.id;
 select * into c from public.career_applications where id=a.application_id;
 perform private.career_event(c.applicant_id,c.id,'CAREER_TEST_SUBMITTED',jsonb_build_object('attempt_id',a.id,'score',n));
end $$;
revoke all on function private.career_finish(uuid) from public,anon,authenticated;

create or replace function public.hr_career_invite(p_application uuid,p_test uuid,p_until timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.career_applications; a public.career_attempts;
begin
 perform private.hr_require_staff();
 select * into c from public.career_applications where id=p_application for update;
 if c.id is null then raise exception 'NOT_FOUND: Application not found.'; end if;
 if c.stage not in ('SUBMITTED','SCREENING','ASSESSMENT','ON_HOLD') or p_until is null or p_until<=now() then raise exception 'VALIDATION_ERROR: Choose an active application and future deadline.'; end if;
 if not exists(select 1 from public.career_tests where id=p_test) then raise exception 'NOT_FOUND: Test not found.'; end if;
 insert into public.career_attempts(application_id,test_id,available_until) values(c.id,p_test,p_until) on conflict(application_id,test_id) do nothing returning * into a;
 if a.id is null then select * into a from public.career_attempts where application_id=c.id and test_id=p_test; return to_jsonb(a)-'answers'; end if;
 update public.career_applications set stage='ASSESSMENT',version=version+1,updated_at=now() where id=c.id;
 perform private.career_event(c.applicant_id,c.id,'CAREER_TEST_INVITED',jsonb_build_object('attempt_id',a.id));
 perform private.rec_event(c.hr_candidate_id,'ASSESSMENT','Candidate invited to portal assessment');
 return to_jsonb(a)-'answers';
end $$;
revoke all on function public.hr_career_invite(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.hr_career_invite(uuid,uuid,timestamptz) to authenticated;

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
  if a.available_until<=clock_timestamp() or not exists(select 1 from public.career_applications where id=a.application_id and stage='ASSESSMENT') then raise exception 'CONFLICT: This assessment is no longer available.'; end if;
  update public.career_attempts set started_at=now(),deadline=least(available_until,now()+make_interval(mins=>t.duration_minutes)),version=version+1 where id=a.id returning * into a;
 elsif p_data->>'action' in ('SAVE','SUBMIT') and a.submitted_at is null then
  if a.started_at is null then raise exception 'CONFLICT: Start the test first.'; end if;
  if not exists(select 1 from public.career_applications where id=a.application_id and stage='ASSESSMENT') then raise exception 'CONFLICT: This application is no longer in assessment.'; end if;
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

create or replace function public.hr_career_applications(p_page integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 perform private.hr_require_staff();
 if p_page not between 1 and 10000 then raise exception 'VALIDATION_ERROR: Invalid page.'; end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
   select c.*,j.title,(select coalesce(jsonb_agg(to_jsonb(a)-'answers'),'[]') from public.career_attempts a where a.application_id=c.id) as attempts,
     (select coalesce(jsonb_agg(to_jsonb(i) order by i.scheduled_at),'[]') from public.career_interviews i where i.application_id=c.id) as interviews
    from public.career_applications c join public.career_postings j on j.id=c.posting_id order by c.created_at desc,c.id limit 20 offset (p_page-1)*20) x),
    'total',(select count(*) from public.career_applications));
end $$;
revoke all on function public.hr_career_applications(integer) from public,anon;
grant execute on function public.hr_career_applications(integer) to authenticated;

create or replace function public.hr_career_stage(p_application uuid,p_stage text,p_version integer,p_message text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.career_applications;
begin
 perform private.hr_require_staff();
 select * into c from public.career_applications where id=p_application for update;
 if c.id is null then raise exception 'NOT_FOUND: Application not found.'; end if;
 if c.version is distinct from p_version then raise exception 'CONFLICT: Application changed. Reload first.'; end if;
 if p_stage not in ('SCREENING','INTERVIEW','SELECTED','ON_HOLD','REJECTED') or c.stage in ('WITHDRAWN','REJECTED','JOINING','TRAINING','COMPLETED') then raise exception 'CONFLICT: This transition is not permitted.'; end if;
 if not ((c.stage='SUBMITTED' and p_stage in ('SCREENING','ON_HOLD','REJECTED'))
   or (c.stage='SCREENING' and p_stage in ('ON_HOLD','REJECTED'))
   or (c.stage='ASSESSMENT' and p_stage in ('INTERVIEW','ON_HOLD','REJECTED'))
   or (c.stage='INTERVIEW' and p_stage in ('SELECTED','ON_HOLD','REJECTED'))
   or (c.stage='ON_HOLD' and p_stage in ('SCREENING','INTERVIEW','REJECTED'))
   or (c.stage='SELECTED' and p_stage in ('ON_HOLD','REJECTED'))) then raise exception 'CONFLICT: This recruitment stage cannot be skipped or moved backwards.'; end if;
 if p_stage='INTERVIEW' and not exists(select 1 from public.career_attempts where application_id=c.id and passed=true) then raise exception 'CONFLICT: A passed assessment is required before interviews.'; end if;
 if p_stage='SELECTED' and (c.stage<>'INTERVIEW' or (select count(distinct round) from public.career_interviews where application_id=c.id and status='COMPLETED' and recommendation='PROCEED' and round in ('HR','DEPARTMENT_HEAD'))<2) then raise exception 'CONFLICT: Complete the HR and Department Head interviews before selection.'; end if;
 if length(coalesce(p_message,''))>1000 then raise exception 'VALIDATION_ERROR: Message is too long.'; end if;
 update public.career_applications set stage=p_stage,candidate_message=nullif(btrim(p_message),''),version=version+1,updated_at=now() where id=c.id;
 perform private.career_event(c.applicant_id,c.id,'CAREER_STAGE_CHANGED',jsonb_build_object('before',c.stage,'after',p_stage));
 perform private.rec_event(c.hr_candidate_id,'PORTAL_STAGE',format('Portal application: %s',p_stage));
end $$;
revoke all on function public.hr_career_stage(uuid,text,integer,text) from public,anon;
grant execute on function public.hr_career_stage(uuid,text,integer,text) to authenticated;

create or replace function public.hr_career_interview(p_application uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.career_applications; i public.career_interviews;
begin
 perform private.hr_require_staff();
 select * into c from public.career_applications where id=p_application for update;
 if c.id is null then raise exception 'NOT_FOUND: Application not found.'; end if;
 if c.stage<>'INTERVIEW' then raise exception 'CONFLICT: Move a qualified application to interviews first.'; end if;
 if p_data->>'id' is null then
  if p_data->>'round' not in ('HR','DEPARTMENT_HEAD','MANAGEMENT') or (p_data->>'scheduled_at')::timestamptz is null or length(btrim(coalesce(p_data->>'location',''))) not between 1 and 1000 then raise exception 'VALIDATION_ERROR: Enter the round, schedule and meeting details.'; end if;
  insert into public.career_interviews(application_id,round,scheduled_at,location) values(c.id,p_data->>'round',(p_data->>'scheduled_at')::timestamptz,p_data->>'location')
   on conflict(application_id,round,scheduled_at) where status<>'CANCELLED' do nothing returning * into i;
  if i.id is null then
   select * into i from public.career_interviews where application_id=c.id and round=p_data->>'round' and scheduled_at=(p_data->>'scheduled_at')::timestamptz and status<>'CANCELLED';
   if i.location is distinct from p_data->>'location' then raise exception 'CONFLICT: An interview already exists for this round and time. Cancel it before rescheduling.'; end if;
   return to_jsonb(i);
  end if;
 else
  select * into i from public.career_interviews where id=(p_data->>'id')::uuid and application_id=c.id for update;
  if i.id is null then raise exception 'NOT_FOUND: Interview not found.'; end if;
  if i.version is distinct from (p_data->>'version')::integer then raise exception 'CONFLICT: Interview changed. Reload first.'; end if;
  if p_data->>'status' not in ('COMPLETED','CANCELLED') or (p_data->>'status'='COMPLETED' and (i.scheduled_at>now() or p_data->>'recommendation' not in ('PROCEED','REJECT','HOLD'))) then raise exception 'VALIDATION_ERROR: Record the interview after it occurs, with a recommendation.'; end if;
  update public.career_interviews set status=p_data->>'status',recommendation=p_data->>'recommendation',internal_feedback=left(p_data->>'internal_feedback',3000),version=version+1 where id=i.id returning * into i;
 end if;
 perform private.career_event(c.applicant_id,c.id,'CAREER_INTERVIEW_UPDATED',jsonb_build_object('interview_id',i.id,'status',i.status));
 return to_jsonb(i);
end $$;
revoke all on function public.hr_career_interview(uuid,jsonb) from public,anon;
grant execute on function public.hr_career_interview(uuid,jsonb) to authenticated;

create or replace function public.career_interviews()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.career_me_id();
begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'application_id',i.application_id,'round',i.round,'scheduled_at',i.scheduled_at,'location',i.location,'status',i.status) order by i.scheduled_at)
   from public.career_interviews i join public.career_applications c on c.id=i.application_id where c.applicant_id=me),'[]');
end $$;
revoke all on function public.career_interviews() from public,anon;
grant execute on function public.career_interviews() to authenticated;
notify pgrst,'reload schema';
