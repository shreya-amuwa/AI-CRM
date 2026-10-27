-- =============================================================================
-- Paid invoice on WhatsApp through the WhatsApp Automation Builder webhook (the one the onboarding messages already use).
--
-- The claim function knew two modes: dry_run and live. Live hands a dispatch over only when the invoice WhatsApp settings carry an approved
-- provider template (a Wabastore rule). The Automation Builder keeps its templates on its own side, so there is nothing to approve here:
-- the new mode live_hook is "live" without the template rule. Everything else (the switch, the number check, the lease, the retry of a
-- result that was never recorded) is exactly as in live.
--
-- Safe to run again. Run after 20261129000100_invoice_whatsapp.sql.
-- =============================================================================

create or replace function public.invoice_whatsapp_claim(p_limit integer default 5, p_mode text default 'dry_run', p_lease_seconds integer default 300, p_now timestamptz default null, p_dispatch uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  s public.invoice_whatsapp_settings;
  d public.invoice_whatsapp_dispatches;
  g public.generated_invoices;
  v_ids uuid[] := '{}';
  v_why text;
  v_phone text;
begin
  if p_mode not in ('dry_run', 'live', 'live_hook') then
    raise exception 'VALIDATION_ERROR: Unknown mode.' using errcode = 'P0001';
  end if;
  select * into s from public.invoice_whatsapp_settings where id;

  -- A live attempt whose result was never recorded (the server stopped) is not repeated: it might have been sent.
  update public.invoice_whatsapp_dispatches
     set status = case when p_mode in ('live', 'live_hook') then 'FAILED' else 'PENDING' end,
         detail = case when p_mode in ('live', 'live_hook') then 'The result of the last attempt was not recorded (the server stopped). It was not repeated so the customer is not sent it twice; check the provider and use "Send again".' else detail end,
         failed_at = case when p_mode in ('live', 'live_hook') then v_now else failed_at end, locked_until = null, updated_at = v_now
   where status = 'PROCESSING' and locked_until < v_now;

  for d in
    select * from public.invoice_whatsapp_dispatches x
     where x.status in ('PENDING', 'RETRY') and x.next_attempt_at <= v_now and (p_dispatch is null or x.id = p_dispatch)
     order by x.next_attempt_at, x.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  loop
    select * into g from public.generated_invoices where invoice_id = d.invoice_id;
    v_phone := private.invoice_wa_number(d.customer_id);
    v_why := case
      when g.lifecycle <> 'PAID' or g.paid_pdf_status <> 'STORED' then 'The paid invoice is not ready.'
      when v_phone is null then 'The customer has no valid WhatsApp or mobile number any more.'
      when d.dedupe_key <> format('INVWA|%s|PAID|%s', g.invoice_id, v_phone) then 'The customer''s number changed after this was requested. Send it again to the new number.'
      when not s.enabled then 'Invoice WhatsApp was switched off.'
    end;
    if v_why is not null then
      update public.invoice_whatsapp_dispatches set status = 'SKIPPED', detail = v_why, locked_until = null, updated_at = v_now where id = d.id;
      perform private.invoice_wa_log(d.id, 'SKIPPED', d.attempts, null, v_why);
      continue;
    end if;
    if p_mode = 'live' and (not s.template_approved or s.template_name is null) then
      continue; -- waits until the template is approved
    end if;
    update public.invoice_whatsapp_dispatches set status = 'PROCESSING', attempts = d.attempts + 1, locked_until = v_now + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))), updated_at = v_now
     where id = d.id;
    perform private.invoice_wa_log(d.id, 'ATTEMPT', d.attempts + 1, null, 'Claimed (' || p_mode || ')');
    v_ids := v_ids || d.id;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'attempts', x.attempts, 'invoiceId', g2.invoice_id, 'customerId', g2.customer_id, 'number', g2.invoice_number, 'invoiceDate', g2.invoice_date,
             'total', g2.total_amount, 'customerName', coalesce(nullif(btrim(g2.business_name), ''), g2.customer_name),
             'to', '+91' || private.invoice_wa_number(x.customer_id),
             'file', jsonb_build_object('provider', g2.paid_storage_provider, 'bucket', g2.paid_storage_bucket, 'path', g2.paid_storage_path,
                                        'sizeBytes', g2.paid_size_bytes, 'etag', g2.paid_storage_etag),
             'template', jsonb_build_object('name', s.template_name, 'language', s.template_language, 'approved', s.template_approved)) order by x.created_at)
      from public.invoice_whatsapp_dispatches x join public.generated_invoices g2 on g2.invoice_id = x.invoice_id
     where x.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.invoice_whatsapp_claim(integer, text, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.invoice_whatsapp_claim(integer, text, integer, timestamptz, uuid) to service_role;

notify pgrst, 'reload schema';
