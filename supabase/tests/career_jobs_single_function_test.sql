\set ON_ERROR_STOP 1
-- The public job list must work after the older careers migration has been run again (migration 20270101000200).
begin;
reset role;
-- what re-running 20261220010000_candidate_careers_foundation leaves behind: the old two-parameter version next to the catalogue one
create or replace function public.career_jobs(p_page integer default 1, p_search text default '')
returns jsonb language sql security definer set search_path = '' as $$ select '{"old":true}'::jsonb $$;
grant execute on function public.career_jobs(integer, text) to anon, authenticated;
select test.must_fail($$select public.career_jobs(p_page => 1, p_search => '')$$, 'with both versions a plain list call is ambiguous (the live error)', 'is not unique');
\i supabase/migrations/20270101000200_career_jobs_single_function.sql
\i supabase/migrations/20270101000200_career_jobs_single_function.sql
select test.check((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'career_jobs') = 1, 'one career_jobs remains (and the migration is safe to run twice)');
set local role anon;
select test.check(public.career_jobs(p_page => 1, p_search => '') ? 'items', 'anonymous visitors get the job list again with the plain call (page and search only)');
select test.check(public.career_jobs(p_page => 1, p_search => '', p_team => '') ? 'items', 'and with the catalogue filters');
reset role;
rollback;
