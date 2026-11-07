\set ON_ERROR_STOP 1
-- Candidate portal: registration needs no verification (migration 20261229000100_candidate_direct_registration.sql).
-- Re-runs the migration on crafted accounts: it must confirm only never-verified candidate-portal accounts, touch nothing else, and be safe to run twice.
begin;
reset role;
create temp table dr(k text primary key,v uuid);
grant all on dr to authenticated,service_role;
create temp table dr_counts as select
  (select count(*) from public.career_applicants) applicants, (select count(*) from public.career_applications) applications,
  (select count(*) from public.career_files) files, (select count(*) from public.career_events) events, (select count(*) from public.profiles) profiles;
insert into auth.users(email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) values
 ('dr.unverified@example.com',null,'{"candidate_portal":true}','{}'),
 ('dr.verified@example.com','2026-01-01 00:00:00+00','{"candidate_portal":true}','{}'),
 ('dr.staffinvite@example.com',null,'{"candidate_portal":true}','{}'),
 ('dr.client@example.com',null,'{"candidate_portal":true}','{"client_customer_id":"c1"}'),
 ('dr.notcandidate@example.com',null,'{}','{}'),
 ('dr.flagfalse@example.com',null,'{"candidate_portal":false}','{}');
set constraints all immediate;
-- (the staff-provisioning marker is set after the insert: inserting it directly would run the real provisioning path)
update auth.users set raw_app_meta_data='{"provisioned_by":"x"}' where email='dr.staffinvite@example.com';
insert into dr select 'unverified',id from auth.users where email='dr.unverified@example.com';
delete from dr_counts;
insert into dr_counts select
  (select count(*) from public.career_applicants), (select count(*) from public.career_applications),
  (select count(*) from public.career_files), (select count(*) from public.career_events), (select count(*) from public.profiles);
select test.check((select email_confirmed_at is null from auth.users where email='dr.unverified@example.com'),'before: the candidate has never verified their e-mail');
\i supabase/migrations/20261229000100_candidate_direct_registration.sql
select test.check((select email_confirmed_at is not null from auth.users where email='dr.unverified@example.com'),'an existing unverified candidate account is confirmed, so it can sign in with its password');
select test.check((select email_confirmed_at='2026-01-01 00:00:00+00' from auth.users where email='dr.verified@example.com'),'an already verified account keeps its original confirmation date');
select test.check(not exists(select 1 from auth.users where email in('dr.staffinvite@example.com','dr.client@example.com') and email_confirmed_at is not null),'accounts provisioned as staff or clients are not touched');
select test.check(not exists(select 1 from auth.users where email in('dr.notcandidate@example.com','dr.flagfalse@example.com') and email_confirmed_at is not null),'accounts that are not candidate-portal accounts are not touched');
select test.check((select count(*)=0 from public.profiles where id in (select id from auth.users where email in('dr.unverified@example.com','dr.verified@example.com'))),'the migration gives no candidate a staff profile');
-- safe to run twice: the second run changes nothing
create temp table dr_stamp as select email,email_confirmed_at from auth.users where email like 'dr.%';
\i supabase/migrations/20261229000100_candidate_direct_registration.sql
select test.check(not exists(select 1 from auth.users u join dr_stamp s using(email) where u.email_confirmed_at is distinct from s.email_confirmed_at),'running the migration again changes nothing');
select test.check((select applicants=(select count(*) from public.career_applicants) and applications=(select count(*) from public.career_applications) and files=(select count(*) from public.career_files) and events=(select count(*) from public.career_events) and profiles=(select count(*) from public.profiles) from dr_counts),'no application, file, event or profile record was created or removed');
-- the confirmed account now works end to end
select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from dr where k='unverified'),'role','authenticated')::text,true);
set role authenticated;
select test.check(career_profile()->>'name'='','the formerly unverified candidate opens their profile');
select test.check((career_jobs()->>'total') is not null,'...and sees the open vacancies');
reset role;
-- an anonymous caller still cannot reach candidate data
set role anon;
select test.must_fail($$select career_profile()$$,'an anonymous visitor still cannot read candidate data','permission denied|Sign in');
reset role;
rollback;
