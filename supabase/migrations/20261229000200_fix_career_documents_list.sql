-- Fix: the candidate's list of requested joining documents always failed.
--
-- public.career_documents() (no arguments) is what the candidate dashboard calls to list the documents HR asked for. Its list branch, as
-- shipped in 20261220030000_candidate_joining_training.sql, referred to aliases that do not exist (`doappl.id`, `appl.id`: the tables are
-- aliased `d` and `c`), so PostgreSQL refused it with 42P01 "missing FROM-clause entry for table". The API reports 42P01 as "this feature needs a
-- database update", and the whole dashboard (which loads this list) ended on the "We hit a snag" page for EVERY candidate.
--
-- Only the list branch is corrected (aliases doc / appl, newest requests last). The single-document branch (upload a file against a request)
-- is unchanged, character for character, as are the grants. No data is touched. Safe to run twice.

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
 return coalesce((select jsonb_agg(jsonb_build_object('id',doc.id,'application_id',doc.application_id,'title',doc.title,'file_id',doc.file_id,'status',doc.status,'message',doc.message,'version',doc.version) order by doc.created_at,doc.id)
  from public.career_documents doc join public.career_applications appl on appl.id=doc.application_id where appl.applicant_id=me),'[]');
end $$;
revoke all on function public.career_documents(uuid,uuid) from public,anon;
grant execute on function public.career_documents(uuid,uuid) to authenticated;
