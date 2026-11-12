-- =============================================================================
-- "Forgot password?" for staff (the CRM sign-in page). Run after 20261231000500_chat_receipts_light.sql. Safe to run again.
--
-- The client dashboard (client_login_for_reset, 20261101000100) and the candidate portal (Supabase recovery e-mail through the auth e-mail
-- hook) already had one. For staff, the API looks the address up here with the service role, and ONLY an active employee's account gets
-- the one-time link; the answer to the caller is the same whatever the address, so nobody can learn which addresses have an account.
-- Pending, suspended, revoked or rejected accounts get nothing (HR / the Super Admin handle those).
-- =============================================================================
create or replace function public.staff_login_for_reset(p_email text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'email', lower(p.email), 'name', p.full_name)
    from public.profiles p
   where lower(p.email) = lower(btrim(coalesce(p_email, '')))
     and p.status = 'ACTIVE'
   limit 1
$$;
revoke all on function public.staff_login_for_reset(text) from public, anon, authenticated;
grant execute on function public.staff_login_for_reset(text) to service_role;

notify pgrst, 'reload schema';
