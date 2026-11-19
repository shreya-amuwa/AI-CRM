-- =============================================================================
-- Crocodial: "Sync now" may be used again after 1 minute (was 5). Run after 20270115000400_crocodial_team_activity.sql. Safe to run twice.
-- Why: the first full read of an account (about 40 pages) needs one or two Sync now runs; a 5-minute wait between them made the first
-- read look stuck. Crocodial's own limit (60 requests a minute per token) is still kept by the client, which spaces every request.
-- =============================================================================
create or replace function public.croc_sync_request(p_connection uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.crocodial_connections;
begin
  perform private.croc_require_admin();
  select * into c from public.crocodial_connections where id = p_connection for update;
  if c.id is null then
    raise exception 'NOT_FOUND: Connection not found.' using errcode = 'P0002';
  end if;
  if not private.croc_connection_syncable(c.id) then
    raise exception 'VALIDATION_ERROR: Switch the connection and its department on before syncing.' using errcode = '22023';
  end if;
  if c.last_manual_sync_at > now() - interval '1 minute' then
    raise exception 'CONFLICT: A sync was started less than a minute ago. Try again shortly.' using errcode = 'P0001';
  end if;
  update public.crocodial_connections set last_manual_sync_at = now() where id = c.id;
  perform private.write_audit('CROCODIAL_SYNC_REQUESTED', 'crocodial_connection', c.id, null, null, '{}'::jsonb);
  return jsonb_build_object('id', c.id, 'credentialRef', c.credential_ref);
end $$;
revoke all on function public.croc_sync_request(uuid) from public, anon;
grant execute on function public.croc_sync_request(uuid) to authenticated, service_role;
