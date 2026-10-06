-- =============================================================================
-- API rate limiting. Serverless instances share no memory, so counters live
-- in Postgres. Fixed windows, one atomic upsert per bucket.
--
-- Callable ONLY with the service-role key (the API); clients cannot read,
-- reset or inflate other people's counters.
-- =============================================================================

create unlogged table private.rate_limit_counters (
  bucket text not null check (length(bucket) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- p_buckets: [{ "key": "user:<uuid>:write", "limit": 30, "window": 60 }, …]
-- Returns one row per bucket with the post-increment count and window reset.
create or replace function public.rate_limit_consume(p_buckets jsonb)
returns table (bucket text, hits integer, max_hits integer, reset_at timestamptz, allowed boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  b jsonb;
  v_window integer;
  v_start timestamptz;
  v_hits integer;
begin
  if jsonb_typeof(p_buckets) <> 'array' or jsonb_array_length(p_buckets) > 10 then
    raise exception 'VALIDATION_ERROR: Invalid rate-limit buckets.' using errcode = 'P0001';
  end if;

  for b in select * from jsonb_array_elements(p_buckets) loop
    v_window := greatest(1, least(coalesce((b ->> 'window')::integer, 60), 86400));
    v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);

    insert into private.rate_limit_counters as c (bucket, window_start, hits)
    values (b ->> 'key', v_start, 1)
    on conflict (bucket, window_start) do update set hits = c.hits + 1
    returning c.hits into v_hits;

    bucket := b ->> 'key';
    hits := v_hits;
    max_hits := (b ->> 'limit')::integer;
    reset_at := v_start + make_interval(secs => v_window);
    allowed := v_hits <= max_hits;
    return next;
  end loop;

  -- Opportunistic cleanup of expired windows (keeps the table tiny).
  if random() < 0.02 then
    delete from private.rate_limit_counters where window_start < now() - interval '1 day';
  end if;
end $$;

revoke all on function public.rate_limit_consume(jsonb) from public, anon, authenticated;
grant execute on function public.rate_limit_consume(jsonb) to service_role;
revoke all on private.rate_limit_counters from public, anon, authenticated;
