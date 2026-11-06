\set ON_ERROR_STOP 1
-- Candidate careers portal: the job catalogue (migration 20261226000100_career_job_catalogue.sql).
begin;
reset role;
create temp table cp(k text primary key,v uuid);
grant all on cp to anon,authenticated,service_role;

select test.login('hr_head');
select hr_career_posting(jsonb_build_object('position_id',(select id from hr_positions where title='Backend Developer'),'title','Catalogue Engineer',
  'description','Build reliable services for the catalogue test suite.','location','Mumbai','employment_type','FULL_TIME','published',true,
  'team','Engineering','work_mode','HYBRID','salary_text','Competitive','responsibilities',E'Ship features\nReview code','benefits',E'Health insurance\nLearning budget',
  'skills','Node.js, SQL','qualifications','B.Tech or equivalent','experience','3+ years'));
select hr_career_posting(jsonb_build_object('position_id',(select id from hr_positions where title='Backend Developer'),'title','Catalogue Designer',
  'description','Design calm interfaces for the catalogue test suite.','location','Bengaluru (Remote)','employment_type','INTERNSHIP','published',true,
  'team','Design','work_mode','REMOTE'));
select hr_career_posting(jsonb_build_object('position_id',(select id from hr_positions where title='Backend Developer'),'title','Hidden Draft Role',
  'description','This job is not published and must stay invisible.','location','Pune','employment_type','FULL_TIME','published',false,'team','Engineering'));
select hr_career_posting(jsonb_build_object('position_id',(select id from hr_positions where title='Backend Developer'),'title','Expired Role',
  'description','This job closed yesterday and must stay invisible.','location','Pune','employment_type','FULL_TIME','published',true,'closes_at',(now()-interval '1 day')::text));
reset role;
insert into cp select 'eng',id from career_postings where title='Catalogue Engineer';
insert into cp select 'des',id from career_postings where title='Catalogue Designer';
insert into cp select 'draft',id from career_postings where title='Hidden Draft Role';
insert into cp select 'expired',id from career_postings where title='Expired Role';
create temp table cc as select code from career_postings where id=(select v from cp where k='eng');
grant all on cc to anon,authenticated,service_role;

-- ---- code and first-published date ----
select test.check((select code ~ '^JOB-[0-9]{4,}$' from career_postings where id=(select v from cp where k='eng')),'a new job gets a JOB-#### code');
select test.check((select count(distinct code)=count(*) from career_postings),'job codes are unique');
select test.check((select published_at is not null from career_postings where id=(select v from cp where k='eng')),'a job published on creation has a first-published date');
select test.check((select published_at is null from career_postings where id=(select v from cp where k='draft')),'an unpublished job has no published date yet');

-- ---- public list ----
set role anon;
select test.check(career_jobs()->>'total'='2','anonymous visitors see exactly the open jobs (old call shape still works)');
select test.check(not exists(select 1 from jsonb_array_elements(career_jobs()->'items') j where j->>'title' in ('Hidden Draft Role','Expired Role')),'unpublished and expired jobs are not listed');
select test.check(career_jobs(1,'Engineer')->>'total'='1','search by title');
select test.check((career_jobs(1,(select code from cc))->>'total')='1','search by job code');
select test.check(career_jobs(1,'design')->>'total'='1','search matches the team');
select test.check(career_jobs(1,'%')->>'total'='0','a % in the search is literal, not a wildcard');
select test.check(career_jobs(1,'_')->>'total'='0','an underscore in the search is literal, not a wildcard');
select test.check(career_jobs(1,'',p_team=>'engineering')->>'total'='1','filter by team (case-insensitive)');
select test.check(career_jobs(1,'',p_mode=>'REMOTE')->'items'->0->>'title'='Catalogue Designer','filter by work mode');
select test.check(career_jobs(1,'',p_location=>'MUMBAI')->>'total'='1','filter by location (case-insensitive)');
select test.check(career_jobs(1,'',p_team=>'Engineering',p_mode=>'REMOTE')->>'total'='0','filters combine');
select test.check(career_jobs(1,'',p_team=>'Nobody')->>'total'='0','an unknown team matches nothing');
select test.must_fail($$select career_jobs(1,'',p_mode=>'SOMETIMES')$$,'an invalid work mode is refused','VALIDATION_ERROR');
select test.must_fail($$select career_jobs(0)$$,'page 0 is refused','VALIDATION_ERROR');
select test.must_fail($$select career_jobs(1,repeat('x',121))$$,'an over-long search is refused','VALIDATION_ERROR');
select test.check(career_jobs()->'facets'->'teams'=jsonb_build_array(jsonb_build_object('value','Design','count',1),jsonb_build_object('value','Engineering','count',1)),'facets list the teams of open jobs with counts (not the hidden ones)');
select test.check(jsonb_array_length(career_jobs()->'facets'->'locations')=2 and career_jobs()->'facets'->'modes'=jsonb_build_array(jsonb_build_object('value','HYBRID','count',1),jsonb_build_object('value','REMOTE','count',1)),'facets list locations and work modes');
select test.check(career_jobs(1,'',p_team=>'Design')->'facets'->'teams'->>1 is not null,'facets stay complete while a filter is active');

-- ---- public fields, and only those ----
select test.check((select j->>'team'='Engineering' and j->>'work_mode'='HYBRID' and j->>'salary_text'='Competitive' and j->>'responsibilities'=E'Ship features\nReview code'
                          and j->>'benefits'=E'Health insurance\nLearning budget' and j->>'skills'='Node.js, SQL' and j->>'qualifications'='B.Tech or equivalent' and j->>'experience'='3+ years'
                          and (j->>'code') ~ '^JOB-' and j->>'published_at' is not null
                     from jsonb_array_elements(career_jobs(1,'Engineer')->'items') j),'the public job carries the catalogue fields');
select test.check((select not (j ?| array['responsible_id','openings','vacancy_status','status_note','approved_at','position_id','version','published','required_steps','created_at','updated_at'])
                     from jsonb_array_elements(career_jobs(1,'Engineer')->'items') j),'the public job never exposes internal recruitment fields');

-- ---- single read ----
select test.check(career_job((select v from cp where k='eng'))->>'title'='Catalogue Engineer','one open job can be read by id, anonymously');
select test.check(not (career_job((select v from cp where k='eng')) ?| array['responsible_id','openings','vacancy_status','status_note','approved_at','position_id','version']),'the single read exposes no internal fields either');
select test.must_fail($$select career_job((select v from cp where k='draft'))$$,'an unpublished job is not found (does not reveal it exists)','NOT_FOUND');
select test.must_fail($$select career_job((select v from cp where k='expired'))$$,'an expired job is not found','NOT_FOUND');
select test.must_fail($$select career_job('00000000-0000-4000-8000-0000000000ff')$$,'an unknown id is not found','NOT_FOUND');
select test.must_fail($$select hr_career_posting()$$,'anonymous visitors cannot manage jobs','permission denied');
select test.must_fail($$select * from career_postings$$,'the table itself stays private to anonymous visitors','permission denied');

-- ---- HR side ----
reset role;
select test.login('hr_head');
select test.must_fail($$select hr_career_posting(jsonb_build_object('position_id',(select id from hr_positions where title='Backend Developer'),'title','Bad Mode','description','A job with an invalid work mode here.','location','Pune','employment_type','FULL_TIME','work_mode','SOMETIMES'))$$,'HR cannot save an invalid work mode','VALIDATION_ERROR');
select test.must_fail($$select hr_career_posting(jsonb_build_object('position_id',(select id from hr_positions where title='Backend Developer'),'title','Long Team','description','A job with a far too long team name.','location','Pune','employment_type','FULL_TIME','team',repeat('x',81)))$$,'HR cannot save an over-long team','VALIDATION_ERROR');
-- an older form (no catalogue fields) re-saves a job without wiping them
select hr_career_posting(jsonb_build_object('id',(select v from cp where k='eng'),'version',(select version from career_postings where id=(select v from cp where k='eng')),
  'position_id',(select id from hr_positions where title='Backend Developer'),'title','Catalogue Engineer II','description','Build reliable services for the catalogue test suite.','location','Mumbai','employment_type','FULL_TIME'));
reset role;
select test.check((select team='Engineering' and work_mode='HYBRID' and salary_text='Competitive' and benefits is not null from career_postings where id=(select v from cp where k='eng')),'an older form saving a job keeps the catalogue fields');
select test.check((select code from career_postings where id=(select v from cp where k='eng'))=(select code from career_postings where title='Catalogue Engineer II'),'the code is stable when the job is edited');
-- the catalogue fields can be cleared on purpose
select test.login('hr_head');
select hr_career_posting(jsonb_build_object('id',(select v from cp where k='eng'),'version',(select version from career_postings where id=(select v from cp where k='eng')),
  'position_id',(select id from hr_positions where title='Backend Developer'),'title','Catalogue Engineer II','description','Build reliable services for the catalogue test suite.','location','Mumbai','employment_type','FULL_TIME','salary_text','','work_mode',''));
reset role;
select test.check((select salary_text is null and work_mode is null and team='Engineering' from career_postings where id=(select v from cp where k='eng')),'sending an empty value clears just that field');
-- unpublish and republish: the first-published date does not move
create temp table pa as select published_at from career_postings where id=(select v from cp where k='eng');
select test.login('hr_head');
select hr_career_posting(jsonb_build_object('id',(select v from cp where k='eng'),'version',(select version from career_postings where id=(select v from cp where k='eng')),
  'position_id',(select id from hr_positions where title='Backend Developer'),'title','Catalogue Engineer II','description','Build reliable services for the catalogue test suite.','location','Mumbai','employment_type','FULL_TIME','published',false));
reset role;
select test.check((select not published from career_postings where id=(select v from cp where k='eng')),'the job can be unpublished');
select test.login('hr_head');
select hr_career_posting(jsonb_build_object('id',(select v from cp where k='eng'),'version',(select version from career_postings where id=(select v from cp where k='eng')),
  'position_id',(select id from hr_positions where title='Backend Developer'),'title','Catalogue Engineer II','description','Build reliable services for the catalogue test suite.','location','Mumbai','employment_type','FULL_TIME','published',true));
reset role;
select test.check((select published and published_at=(select published_at from pa) from career_postings where id=(select v from cp where k='eng')),'republishing keeps the original first-published date');
-- the code cannot be changed from outside
select test.check((select count(*)=0 from career_postings where code is null),'every job has a code');
select test.login('tm_a');
select test.must_fail($$select hr_career_posting(jsonb_build_object('position_id',(select id from hr_positions where title='Backend Developer'),'title','Not Allowed','description','Another department must not manage jobs.','location','Pune','employment_type','FULL_TIME','team','Sales'))$$,'another department cannot save jobs or their catalogue fields','FORBIDDEN');
reset role;
rollback;
