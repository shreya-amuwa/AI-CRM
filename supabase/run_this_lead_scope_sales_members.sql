-- =============================================================================
-- RUN THIS ONCE in the Supabase SQL editor (Run the whole file; safe to run again). It is migration 20261129000200_lead_scope_sales_members.sql.
-- Run it after run_this_lead_scope_filters.sql. The lead filters also work for a Sales Team Member (no Sales role). Only one function changes.
-- =============================================================================

-- =============================================================================
-- The lead filters (migration 20261129000100) also for a Sales Team Member who works as a Business Associate from the Sales Team Member
-- dashboard (a Team Member of a Sales team with no Sales role of their own: migration 20261127000100).
--
-- Who may use lead_scope_list / lead_scope_counts: an active Team Member of a Sales team who is a Telecaller, a Business Associate or has no Sales
-- role. Influencers, Visit Sales and Business Partners, Support, Department Heads, Team Leads and every other department stay refused.
-- The department's leads are still read-only (view only, no notes), never another department's. Only this function changes. Safe to run again.
-- =============================================================================
create or replace function private.lead_scope_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.teams t on t.id = p.team_id
     where p.id = private.my_id() and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and t.division = 'SALES'
       and (p.sales_sub_role is null or p.sales_sub_role in ('TELECALLER', 'BUSINESS_ASSOCIATE')))
$$;
revoke all on function private.lead_scope_allowed() from public, anon;
grant execute on function private.lead_scope_allowed() to authenticated, service_role;
