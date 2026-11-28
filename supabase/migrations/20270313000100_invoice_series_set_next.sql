-- =============================================================================
-- Invoice numbering: let the Super Admin continue a series from the real last number (docs/ACCOUNTS_FINANCE_AND_WORKFLOW.md "Invoice numbers").
-- Run after 20270311000100_recharge_invoices.sql. Additive and safe to run twice; no invoice is renumbered, changed or deleted.
--
--   The numbering itself is unchanged (20261209000100 + 20261231000400): GST/26-27/616 and Amuwa/26-27/251, separate counters per type, Indian
--   financial year (April-March) taken from the invoice date, made only inside the database under a row lock, never reused, and used by every
--   invoice the CRM generates (Accounts invoices, part payments, recharge invoices).
--
--   What was missing: a series that starts in the CRM starts at 001. A company whose real numbers are already at, say, GST 615 and Amuwa 250
--   in 26-27 (invoices written elsewhere) needs the next CRM invoice to be 616 / 251. private.invoice_series_set_next does exactly that:
--     * it only RAISES the next number: it refuses a number at or below the highest one already issued in the series (in the counter or in any
--       invoice, including part-payment suffixes), so it can never lower a counter or reuse a number, and never touches an invoice;
--     * type GST / NON_GST, a financial year written 26-27 (consecutive years), a number of at most 5 digits that still fits the 16 characters
--       of an invoice number;
--     * the counter row is locked while it changes, so it is safe next to invoices being issued;
--     * it is audited with the before and after.
--   public.invoice_series_set_next / public.invoice_series_list are for the Super Admin only (enforced inside the functions); the owner can
--   also run   select private.invoice_series_set_next('GST', '26-27', 616);   in the SQL editor.
-- =============================================================================

create or replace function private.invoice_series_set_next(p_type text, p_fy text, p_next integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_was integer;
  v_floor integer;
  v_no text;
begin
  if p_type is null or p_type not in ('GST', 'NON_GST') then
    raise exception 'VALIDATION_ERROR: Choose GST or Non-GST.' using errcode = '22023';
  end if;
  if p_fy is null or p_fy !~ '^[0-9]{2}-[0-9]{2}$' or (substring(p_fy from 4 for 2)::integer) <> (substring(p_fy from 1 for 2)::integer + 1) % 100 then
    raise exception 'VALIDATION_ERROR: Write the financial year as two consecutive years, for example 26-27.' using errcode = '22023';
  end if;
  if p_next is null or p_next < 1 or p_next > 99999 then
    raise exception 'VALIDATION_ERROR: The next number is a whole number from 1 to 99999.' using errcode = '22023';
  end if;
  v_no := private.invoice_number_text(p_type, p_fy, p_next);   -- refuses a number that would pass 16 characters
  -- the counter row of the series: created (empty) or locked, so nothing else moves it meanwhile
  insert into public.invoice_number_series (invoice_type, fy, last_value) values (p_type, p_fy, 0) on conflict (invoice_type, fy) do nothing;
  select s.last_value into v_was from public.invoice_number_series s where s.invoice_type = p_type and s.fy = p_fy for update;
  v_floor := greatest(v_was, private.invoice_series_existing_max(p_type, p_fy));
  if p_next - 1 < v_floor then
    raise exception 'CONFLICT: % numbers up to % are already used in %; the next number must be % or higher. A number is never reused.',
      case p_type when 'GST' then 'GST' else 'Non-GST' end, v_floor, p_fy, v_floor + 1 using errcode = 'P0001';
  end if;
  if exists (select 1 from public.member_invoices x where lower(x.invoice_number) = lower(v_no)) then
    raise exception 'CONFLICT: Invoice number % already exists.', v_no using errcode = 'P0001';
  end if;
  if p_next - 1 <> v_was then
    update public.invoice_number_series set last_value = p_next - 1, updated_at = now() where invoice_type = p_type and fy = p_fy;
    perform private.write_audit('INVOICE_SERIES_SET_NEXT', 'invoice_number_series', null, null, null,
      jsonb_build_object('type', p_type, 'fy', p_fy, 'previousNext', v_was + 1, 'next', p_next, 'nextNumber', v_no));
  end if;
  return jsonb_build_object('type', p_type, 'fy', p_fy, 'lastIssued', p_next - 1, 'nextNumber', v_no);
end $$;
revoke all on function private.invoice_series_set_next(text, text, integer) from public, anon, authenticated;

-- the Super Admin's view of the counters (the next number is a preview: nothing is taken)
create or replace function public.invoice_series_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('type', s.invoice_type, 'fy', s.fy, 'lastIssued', s.last_value, 'updatedAt', s.updated_at,
                     'nextNumber', private.peek_invoice_number(s.invoice_type, make_date(2000 + substring(s.fy from 1 for 2)::integer, 4, 1)))
                   order by s.fy desc, s.invoice_type) from public.invoice_number_series s), '[]'::jsonb);
end $$;

create or replace function public.invoice_series_set_next(p_type text, p_fy text, p_next integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return private.invoice_series_set_next(p_type, p_fy, p_next);
end $$;

revoke all on function public.invoice_series_list() from public, anon;
revoke all on function public.invoice_series_set_next(text, text, integer) from public, anon;
grant execute on function public.invoice_series_list() to authenticated;
grant execute on function public.invoice_series_set_next(text, text, integer) to authenticated;
