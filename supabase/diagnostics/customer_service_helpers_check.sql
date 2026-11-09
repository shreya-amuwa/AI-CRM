-- Read-only check for "function private.normalize_service_list(jsonb) does not exist" (run in the Supabase SQL editor; changes nothing).
-- 1. The helpers the customer save functions call, with their exact signatures (expected: one row each, schema private).
select n.nspname as schema, p.proname as function, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig as settings
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.proname in ('normalize_service_list', 'normalize_service_details', 'save_customer_services',
                     'create_support_customer', 'update_support_customer')
 order by p.proname, n.nspname;

-- 2. Same check as a yes/no list.
select x.fn, to_regprocedure(x.fn) is not null as present
  from (values ('private.normalize_service_list(jsonb)'), ('private.normalize_service_details(text,jsonb)'),
               ('private.save_customer_services(uuid,jsonb)')) as x (fn);

-- 3. The column the helpers write.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'customer_services' and column_name = 'details';

-- 4. Customers whose primary service has no customer_services row (20261009400000 copied these once; 20261230000100 does not).
select count(*) as customers_primary_service_not_listed
  from public.customers c
 where c.service_code is not null
   and not exists (select 1 from public.customer_services cs where cs.customer_id = c.id and cs.service_code = c.service_code);
