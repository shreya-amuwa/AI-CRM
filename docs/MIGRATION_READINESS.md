# "This feature needs a database update" - which migration is missing?

The CRM shows *"This feature needs a database update that has not been applied yet. Ask an administrator to run the latest migrations."* when **any** database function or table
a screen calls is missing (PostgREST `PGRST202`, Postgres `42883` / `42P01`, mapped in `server/http/errors.ts`). The message does not name the object.

## Find it (read only)

Paste `supabase/diagnostics/migration_readiness.sql` into the Supabase SQL editor. It only reads the catalog, so it is safe on production. Each row is one object a screen needs;
rows with `ok = false` name the migration to run (`run_migration`). It checks the real objects, not the migration history table, because migrations pasted by hand are not recorded there.

## Known case: Add New Lead

Submitting a lead calls `create_lead`, then `set_subscription_terms` once per selected service (the form requires a plan, duration and amount for each). Without
`20261210000200_subscription_activation.sql` the second call fails with the message above - **after the lead row was already created**, so each failed submit leaves a lead without
its subscription terms. After running the migration (then `20261212000100_sales_subscriptions_list.sql` for the Subscriptions list), open such a lead and save its terms, or remove the extra copies.

Both migrations are safe to run again, delete nothing and send nothing. Run each whole file once.

## Full audit of every migration

`supabase/diagnostics/migration_full_audit.sql` (read only) checks, for **every** migration file, that the tables and the functions (schemas `public` and `private`) the file creates exist in the
database, and lists only the migrations that have something missing (oldest first). Run those files, one whole file at a time (each is safe to run again). Functions a later migration deliberately
drops are left out. Regenerate the list when migrations are added.

Known case: the current Add New Lead calls `create_lead_once` (`20261228000100_field_visit_tracking_and_lead_routing.sql`) before `set_subscription_terms`; a customer save needs
`private.normalize_service_list` (`20261009400000_customer_multiple_services.sql`, restored by `20261230000100_restore_customer_service_helpers.sql`). Either missing gives the same generic message.
