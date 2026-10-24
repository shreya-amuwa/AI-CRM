-- =============================================================================
-- FRESH START: delete every person and every record except the Super Admin(s), so the whole workflow can be tested from the beginning.
--
--   KEPT     the audit log (the database refuses to delete it by design - it is the security record; it only shows who did what, with no
--            customer data), the Super Admin account(s) (login, profile), departments (incl. Wabatalk), teams, the service catalogue and prices, monthly plans,
--            GST states, document types, onboarding checklist templates, and the system settings (SLA, reminder, attribution rule, crm_settings).
--   DELETED  everyone else (Department Heads, Team Leads, Team Members, HR, Accounts, ... and their logins), all customers / leads / clients
--            (and their client logins), services, payments, invoices, add-ons, tickets, tasks, chat, notifications, HR / recruitment / training
--            data, attendance, telecaller sheets, business-associate data, expenses, revenue attribution, rate-limit counters.
--            Counters start again (customer codes, ticket numbers, invoice numbers INV-YYYY-00001, ...).
--
-- THIS CANNOT BE UNDONE.  Take a backup first (Supabase: Database > Backups) and run it on the right project.
-- SQL cannot delete uploaded files: afterwards run  node scripts/purge-all-files.mjs  (Supabase Storage + Cloudflare R2). See docs/FRESH_START.md.
--
-- How to run in the Supabase SQL editor:
--   1. Run STEP 1 (select it and run). It only shows what would happen.
--   2. Run STEP 2 after changing  v_confirm  to exactly:  DELETE EVERYTHING EXCEPT SUPER ADMIN
--      Any other text is refused and nothing is deleted. The whole step is one transaction: it deletes everything or nothing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 - PREVIEW (changes nothing)
-- ---------------------------------------------------------------------------
with keep_tables(t) as (
  values ('departments'), ('teams'), ('crm_services'), ('service_prices'), ('crm_settings'), ('document_types'), ('gst_states'),
         ('onboarding_items'), ('onboarding_item_services'), ('reminder_call_settings'), ('revenue_attribution_settings'),
         ('ticket_sla_settings'), ('monthly_plans'), ('monthly_plan_services'), ('profiles'), ('audit_logs')
)
select 'KEPT: super admin' as what, p.email as detail, p.role::text as extra from public.profiles p where p.role = 'SUPER_ADMIN'
union all
select 'DELETED: people', count(*)::text, string_agg(distinct p.role::text, ', ') from public.profiles p where p.role <> 'SUPER_ADMIN'
union all
select 'DELETED: logins (auth.users)', count(*)::text, '' from auth.users u where u.id not in (select id from public.profiles where role = 'SUPER_ADMIN')
union all
select 'DELETED: rows in ' || c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', c.relname), false, true, '')))[1]::text, ''
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname not in (select t from keep_tables)
 order by 1, 2;

-- ---------------------------------------------------------------------------
-- STEP 2 - DELETE (edit v_confirm, then run)
-- ---------------------------------------------------------------------------
do $reset$
declare
  v_confirm constant text := '';     -- <- type exactly: DELETE EVERYTHING EXCEPT SUPER ADMIN
  v_keep_tables constant text[] := array['departments', 'teams', 'crm_services', 'service_prices', 'crm_settings', 'document_types', 'gst_states',
    'onboarding_items', 'onboarding_item_services', 'reminder_call_settings', 'revenue_attribution_settings', 'ticket_sla_settings',
    'monthly_plans', 'monthly_plan_services', 'profiles', 'audit_logs'];
  v_admins uuid[];
  v_list text;
  v_people integer;
  s record;
begin
  if v_confirm is distinct from 'DELETE EVERYTHING EXCEPT SUPER ADMIN' then
    raise exception 'Nothing was deleted. To delete, set v_confirm to exactly: DELETE EVERYTHING EXCEPT SUPER ADMIN';
  end if;

  -- the accounts that stay: Super Admins that can actually sign in
  select array_agg(p.id) into v_admins
    from public.profiles p
   where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE' and exists (select 1 from auth.users u where u.id = p.id);
  if v_admins is null then
    raise exception 'Nothing was deleted: there is no active Super Admin with a login, so nobody could sign in afterwards.';
  end if;

  -- 1. every table that is not configuration, in one statement (so the links between them never block it)
  select string_agg(format('public.%I', c.relname), ', ') into v_list
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> all (v_keep_tables);
  execute 'truncate table ' || v_list || ' restart identity';
  if to_regclass('private.rate_limit_counters') is not null then
    execute 'truncate table private.rate_limit_counters';
  end if;

  -- 2. everyone but the Super Admin(s): the login and, with it, the profile
  select count(*) into v_people from auth.users where id <> all (v_admins);
  delete from auth.users where id <> all (v_admins);
  delete from public.profiles where id <> all (v_admins);

  -- 3. the Super Admin keeps the account, not the old placement
  update public.profiles set team_id = null where id = any (v_admins) and team_id is not null;

  -- 4. counters start again (customer codes, ticket numbers, invoice numbers, ...): the sequences that belong to no column.
  --    (The numbering of an emptied table restarts with TRUNCATE ... RESTART IDENTITY above; the numbering of a table that is KEPT -
  --    the audit log - must go on after its last row, never back to 1, or the next audit entry would collide with an old one.)
  for s in select sequencename, start_value from pg_sequences q
            where schemaname = 'public'
              and not exists (select 1 from pg_depend d join pg_class c on c.oid = d.objid
                               where c.relname = q.sequencename and c.relnamespace = 'public'::regnamespace and d.deptype in ('a', 'i')) loop
    execute format('select setval(%L, %s, false)', 'public.' || s.sequencename, s.start_value);
  end loop;
  for s in select format('%I.%I', n.nspname, t.relname) as tbl, a.attname as col, pg_get_serial_sequence(format('%I.%I', n.nspname, t.relname), a.attname) as seq
             from pg_class t join pg_namespace n on n.oid = t.relnamespace
             join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
            where n.nspname = 'public' and t.relkind = 'r' and t.relname = any (v_keep_tables) and pg_get_serial_sequence(format('%I.%I', n.nspname, t.relname), a.attname) is not null loop
    execute format('select setval(%L, coalesce((select max(%I) from %s), 0) + 1, false)', s.seq, s.col, s.tbl);
  end loop;

  raise notice 'Done. Kept % Super Admin account(s); removed % other login(s) and emptied % tables. Now run: node scripts/purge-all-files.mjs --apply', cardinality(v_admins), v_people, cardinality(string_to_array(v_list, ', '));
end
$reset$;
