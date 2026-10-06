-- =============================================================================
-- Dashboard aggregates for customers. SECURITY INVOKER: the caller's RLS
-- policies apply, so each role gets totals for exactly the customers it can
-- see (own / team / department / organisation). One round-trip, no row data.
-- =============================================================================
create or replace function public.customer_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible as (select status, segment, created_at from public.customers)
  select jsonb_build_object(
    'total', (select count(*) from visible),
    'active', (select count(*) from visible where status = 'ACTIVE'),
    'inactive', (select count(*) from visible where status = 'INACTIVE'),
    'prospect', (select count(*) from visible where status = 'PROSPECT'),
    'newThisMonth', (select count(*) from visible where created_at >= date_trunc('month', now())),
    'newLastMonth', (select count(*) from visible
                     where created_at >= date_trunc('month', now()) - interval '1 month'
                       and created_at < date_trunc('month', now())),
    'bySegment', (select coalesce(jsonb_object_agg(segment, n), '{}'::jsonb)
                  from (select segment, count(*) as n from visible group by segment) s)
  )
$$;

revoke all on function public.customer_summary() from public, anon;
grant execute on function public.customer_summary() to authenticated, service_role;
