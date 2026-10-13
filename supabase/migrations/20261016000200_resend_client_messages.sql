-- =============================================================================
-- Technical Consultant: "Send messages for this step".
--
-- The automatic messages are queued once per stage. This lets the consultant queue the
-- CURRENT stage's email + WhatsApp again, for example:
--   * the customer reached the Technical Consultant before the automations were switched on
--     (their stage was recorded without messages), or
--   * a message went to the wrong address and has been corrected.
-- The stage itself never moves; only the messages of the stage the customer is at are queued.
-- At most one send per stage per minute, and not while one is still waiting to go out.
-- Additive / re-runnable.
-- =============================================================================
create or replace function public.consultant_resend_client_messages(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
  v public.customers;
  ch text;
  v_n integer := 0;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not private.automation_eligible(p_customer) then
    raise exception 'CONFLICT: Automatic messages are not set up for this customer''s services.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.client_status is null then
    raise exception 'CONFLICT: This customer has not reached a message step yet.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.automation_jobs j
              where j.customer_id = p_customer and j.stage = o.client_status and j.status in ('QUEUED', 'SENDING')) then
    raise exception 'CONFLICT: The messages for this step are already waiting to be sent.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.automation_jobs j
              where j.customer_id = p_customer and j.stage = o.client_status and j.created_at > now() - interval '1 minute') then
    raise exception 'CONFLICT: Please wait a minute before sending them again.' using errcode = 'P0001';
  end if;
  foreach ch in array array['EMAIL', 'WHATSAPP'] loop
    insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, created_by)
    values (p_customer, ch, o.client_status,
            format('ONBOARD|%s|%s|%s|RESEND|%s', p_customer, ch, o.client_status, (extract(epoch from clock_timestamp()) * 1000)::bigint),
            jsonb_build_object('resend', true), (select private.my_id()))
    on conflict (dedupe_key) do nothing;
    v_n := v_n + 1;
  end loop;
  perform private.log_customer_activity(p_customer, 'CLIENT_MESSAGES_RESENT',
    format('Messages for %s queued again by the Technical Consultant', initcap(replace(o.client_status, '_', ' '))));
  perform private.write_audit('CLIENT_MESSAGES_RESENT', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('stage', o.client_status));
  return jsonb_build_object('stage', o.client_status, 'queued', v_n);
end $$;
revoke all on function public.consultant_resend_client_messages(uuid) from public, anon;
grant execute on function public.consultant_resend_client_messages(uuid) to authenticated;
