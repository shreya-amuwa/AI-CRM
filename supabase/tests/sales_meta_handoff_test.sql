-- =============================================================================
-- Sales sends a WhatsApp-related customer to the Meta Verifier (migration 20261206000200). Runs late (same database): reuses the users of the
-- Meta Verifier suite - tm_a (Sales), late_verifier (Meta Verifier), late_consultant (Technical Consultant), dh_wab (Department Head).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 75. Sales -> Meta Verifier hand-off'
reset role;
\i supabase/migrations/20261206000200_sales_meta_verifier_handoff.sql

delete from customers where company in ('Hand One Traders', 'Hand Two Traders', 'Hand Three Co');
update profiles set status = 'ACTIVE' where id = test.id('late_verifier');
create temp table sh (name text primary key, id uuid);
grant all on sh to authenticated, service_role;
set role authenticated;
select test.login('tm_a');
insert into sh select 'wa', create_lead('{"name":"Hand One","company":"Hand One Traders","email":"hand.one@example.com","whatsapp":"+91 98199 20001","phone":"9819920001","leadSource":"Walk-in"}', array['WHATSAPP_API']);
insert into sh select 'bt', create_lead('{"name":"Hand Two","company":"Hand Two Traders","email":"hand.two@example.com","whatsapp":"+91 98199 20002","phone":"9819920002","leadSource":"Walk-in"}', array['BLUE_TICK']);
insert into sh select 'ai', create_lead('{"name":"Hand Three","company":"Hand Three Co","email":"hand.three@example.com","phone":"9819920003","leadSource":"Walk-in"}', array['AI_CALLING']);
reset role;
update customers set lifecycle_stage = 'POTENTIAL', deal_amount = 1000, amount_received = 1000, stage_changed_at = now() where id in (select id from sh);
set role authenticated;
select test.login('tm_a');
select start_customer_onboarding(id, 0, 'UPI', null) from sh;
reset role;
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_at)
select a.id, i.code, case when i.kind = 'YES_NO' then 'YES' else 'saved' end, 'SAVED', now()
  from sh a cross join lateral private.customer_items(a.id) i
on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress(id) from sh;
-- Accounts has already confirmed the amount: Sales' send now goes straight to the verifier
update customer_onboarding set accounts_confirmed_at = now(), sent_to_accounts_at = now() where customer_id in (select id from sh);

\echo '   Sales is told where each customer will go'
set role authenticated;
select test.login('tm_a');
select test.check((onboarding_handoff_info((select id from sh where name = 'wa')) ->> 'route') = 'META' and (onboarding_handoff_info((select id from sh where name = 'wa')) ->> 'recipient') = 'Meta Verifier'
                  and (onboarding_handoff_info((select id from sh where name = 'wa')) ->> 'recipientAvailable')::boolean, 'WhatsApp API: Meta Verifier, and one is there');
select test.check((onboarding_handoff_info((select id from sh where name = 'bt')) ->> 'route') = 'META', 'Blue Tick is on the Meta route too');
select test.check((onboarding_handoff_info((select id from sh where name = 'ai')) ->> 'route') = 'TECHNICAL' and (onboarding_handoff_info((select id from sh where name = 'ai')) ->> 'recipient') = 'Technical Consultant', 'other services keep the Technical Consultant');
select test.login('tm_b');
select test.must_fail($$select onboarding_handoff_info((select id from sh where name = 'wa'))$$, 'Sales of another team cannot ask about this customer', 'NOT_FOUND');
select test.login('tm_a');

\echo '   with no Meta Verifier in the department: nothing moves, and Sales is told before and after the click'
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('late_verifier');
set role authenticated;
select test.login('tm_a');
select test.check(not (onboarding_handoff_info((select id from sh where name = 'wa')) ->> 'recipientAvailable')::boolean, 'the screen can see that nobody is there');
select test.must_fail($$select forward_onboarding_to_support((select id from sh where name = 'wa'))$$, 'the send is refused', 'no active Meta Verifier');
reset role;
select test.check((select forwarded_to_support_at is null and stage <> 'SETUP' from customer_onboarding where customer_id = (select id from sh where name = 'wa')), 'and the customer has not moved');
update profiles set status = 'ACTIVE' where id = test.id('late_verifier');

\echo '   the send: really in the Meta Verifier queue, with who and when'
set role authenticated;
select test.login('tm_a');
select forward_onboarding_to_support((select id from sh where name = 'wa'));
select forward_onboarding_to_support((select id from sh where name = 'bt'));
select forward_onboarding_to_support((select id from sh where name = 'ai'));
reset role;
select test.check((select verification_route = 'META' and forwarded_to_support_at is not null and forwarded_by = test.id('tm_a') from customer_onboarding where customer_id = (select id from sh where name = 'wa')),
  'persisted: Meta route, sent time, and who sent it');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from sh where name = 'wa') and type = 'FORWARDED_TO_SUPPORT' and note like '%Meta Verifier%'), 'the history says it went to the Meta Verifier');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('late_verifier') and entity_id = (select id from sh where name = 'wa') and type = 'ONBOARDING_FORWARDED')
               and (select count(*) = 0 from notifications where recipient_id = test.id('late_consultant') and entity_id = (select id from sh where name = 'wa')), 'the Meta Verifier is notified, the Technical Consultant is not');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('late_consultant') and entity_id = (select id from sh where name = 'ai')), 'the other service still goes to the Technical Consultant');
select test.check((select count(*) = 1 from customer_services where customer_id = (select id from sh where name = 'wa') and service_code = 'WHATSAPP_API') and (select lifecycle_stage = 'ONBOARDING' from customers where id = (select id from sh where name = 'wa')), 'the service and the order are untouched');

\echo '   duplicates and bypasses'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select forward_onboarding_to_support((select id from sh where name = 'wa'))$$, 'a second send is refused and names the Meta Verifier', 'Already sent to the Meta Verifier');
select test.must_fail($$select forward_onboarding_to_support((select id from sh where name = 'ai'))$$, 'and for the other service it names the Technical Consultant', 'Already sent to the Technical Consultant');
select test.must_fail($$select mark_meta_verification_completed((select id from sh where name = 'wa'))$$, 'Sales cannot complete the Meta verification', 'NOT_FOUND|FORBIDDEN|Only');
select test.must_fail($$select send_to_department_head((select id from sh where name = 'wa'), 'skip')$$, 'nor hand it over to the Department Head', 'NOT_FOUND|FORBIDDEN');
select test.login('late_consultant');
select test.check((select count(*) = 0 from customers where id in (select id from sh where name in ('wa', 'bt'))), 'the Technical Consultant does not get the WhatsApp customers');
select test.login('late_verifier');
select test.check((select count(*) = 2 from customers where id in (select id from sh where name in ('wa', 'bt'))), 'the Meta Verifier has both in their queue');
select test.check((select count(*) = 0 from customers where id = (select id from sh where name = 'ai')), 'and not the Technical Consultant''s customer');
reset role;
