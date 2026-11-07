-- Candidate portal: registration needs no e-mail verification.
--
-- 1. private.career_me_id() no longer refuses a candidate whose e-mail was never verified. It still refuses everyone who is not a
--    candidate-portal account (the candidate_portal marker), and anyone not signed in. Nothing else about it changes.
-- 2. Existing candidate-portal accounts that never verified their e-mail are marked as confirmed, so they can sign in with their password
--    (Supabase refuses a password sign-in for an unconfirmed address). Only accounts that carry the candidate_portal marker and were NOT
--    provisioned as staff or clients are touched; no password, application, assessment or interview record is changed. Safe to run twice.
--
-- New candidates are created already confirmed by POST /api/v1/candidate-auth/register (docs/CANDIDATE_REGISTRATION.md).

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
    insert into public.career_applicants(id) values(u.id) on conflict do nothing;
  end if;
  return u.id;
end $$;
revoke all on function private.career_me_id() from public,anon,authenticated;

update auth.users u
   set email_confirmed_at = now()
 where u.email_confirmed_at is null
   and u.raw_user_meta_data ->> 'candidate_portal' = 'true'
   and not (coalesce(u.raw_app_meta_data,'{}'::jsonb) ?| array['provisioned_by','request_by','bootstrap_super_admin','client_customer_id']);
