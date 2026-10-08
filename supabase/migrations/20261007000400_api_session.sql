-- =============================================================================
-- One round trip per API request: the API calls api_session() with the
-- caller's own JWT. PostgREST verifies the token's signature and expiry, and
-- the function returns the caller's profile and consumes their rate-limit
-- buckets in the same call (previously: Auth /user + profiles + rate limit).
--
-- Bucket keys are always prefixed with the caller's own id, so a client
-- calling this directly can only spend its own quota.
-- =============================================================================
create or replace function public.api_session(p_buckets jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile jsonb;
  v_buckets jsonb := '[]'::jsonb;
  b jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: Missing user.' using errcode = '28000';
  end if;
  if jsonb_typeof(p_buckets) <> 'array' or jsonb_array_length(p_buckets) > 5 then
    raise exception 'VALIDATION_ERROR: Invalid rate-limit buckets.' using errcode = 'P0001';
  end if;

  select jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'status', p.status,
                            'department_id', p.department_id, 'team_id', p.team_id)
    into v_profile
    from public.profiles p where p.id = v_uid;
  if v_profile is null then
    return jsonb_build_object('profile', null, 'limits', '[]'::jsonb);
  end if;

  for b in select * from jsonb_array_elements(p_buckets) loop
    v_buckets := v_buckets || jsonb_build_array(jsonb_build_object(
      'key', format('user:%s%s', v_uid, coalesce(left(b ->> 'suffix', 30), '')),
      'limit', greatest(1, least(coalesce((b ->> 'limit')::integer, 120), 100000)),
      'window', greatest(1, least(coalesce((b ->> 'window')::integer, 60), 86400))));
  end loop;

  return jsonb_build_object(
    'profile', v_profile,
    'limits', coalesce((select jsonb_agg(to_jsonb(r)) from public.rate_limit_consume(v_buckets) r), '[]'::jsonb));
end $$;

revoke all on function public.api_session(jsonb) from public, anon;
grant execute on function public.api_session(jsonb) to authenticated;
