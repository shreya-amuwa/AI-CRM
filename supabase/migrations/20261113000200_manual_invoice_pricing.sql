-- =============================================================================
-- Invoice builder: Accounts sets the price of every service. The system no longer divides the budget.
--
-- Until now, with two or more services the builder filled in each amount by splitting what Sales agreed (by the catalogue's
-- starting prices, or equally). With a budget of 12 for two services both lines came pre-filled with 6. Accounts decides how
-- the budget is shared, so now:
--   * one service  -> its line carries the whole balance still to be invoiced (nothing is divided);
--   * two or more  -> every amount is left empty and Accounts enters each price (before GST, a different one per service).
-- The cap is unchanged and still enforced by the database when the invoice is issued: the invoices of the agreed services
-- together can never pass the amount Sales agreed.
-- Only private.spread_invoice_total changes; accounts_invoice_prefill calls it exactly as before. Idempotent.
-- Run after 20261113000100_delete_customer.sql. If 20261102000100 or 20261103000100 is ever run again, run this file again after it:
-- they define the same helper (like the other invoice migrations that replace one another).
-- =============================================================================

create or replace function private.spread_invoice_total(p_lines jsonb, p_total numeric)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  n integer := coalesce(jsonb_array_length(p_lines), 0);
  v_total bigint := floor(coalesce(p_total, 0) * 100);
  v_rate numeric;
  v_base numeric;
begin
  if n = 0 or v_total <= 0 then return p_lines; end if;

  -- several services: no amount is chosen by the system
  if n > 1 then
    return (select jsonb_agg(l || jsonb_build_object('baseAmount', null) order by ord)
              from jsonb_array_elements(p_lines) with ordinality as t(l, ord));
  end if;

  -- one service: the whole balance (with GST at the line's rate, as close as possible without passing it)
  v_rate := coalesce(nullif(p_lines -> 0 ->> 'taxRate', '')::numeric, 18);
  v_base := private.invoice_base_for_total(v_total / 100.0, v_rate);
  if v_base is null or v_base <= 0 then return p_lines; end if;
  return jsonb_build_array((p_lines -> 0) || jsonb_build_object('baseAmount', round(v_base, 2)));
end $$;
revoke all on function private.spread_invoice_total(jsonb, numeric) from public, anon, authenticated;
