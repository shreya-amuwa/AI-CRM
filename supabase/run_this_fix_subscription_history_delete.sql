-- =============================================================================
-- Fix: deleting a customer failed with "The subscription history is append-only".
-- Paste this whole file into the Supabase SQL editor and run it ONCE, then run the customer cleanup again.
-- It changes two small things (no data is touched) and is safe to run again:
--   1. the history trigger lets the delete of a CUSTOMER cascade through it (editing or deleting a history line directly is still refused);
--   2. a renewal's link to its payment is cleared instead of blocking when the payment is deleted with the customer.
-- =============================================================================
create or replace function private.tg_subscription_history_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(old, new);
  end if;
  raise exception 'The subscription history is append-only.' using errcode = '42501';
end $$;
revoke all on function private.tg_subscription_history_append_only() from public, anon, authenticated;

do $$
declare
  v text;
begin
  select conname into v from pg_constraint where conrelid = 'public.subscription_cycles'::regclass and contype = 'f'
     and confrelid = 'public.customer_payments'::regclass;
  if v is not null and not exists (select 1 from pg_constraint where conname = v and confdeltype = 'n') then
    execute format('alter table public.subscription_cycles drop constraint %I', v);
    alter table public.subscription_cycles add constraint subscription_cycles_payment_id_fkey
      foreign key (payment_id) references public.customer_payments (id) on delete set null;
  end if;
end $$;
