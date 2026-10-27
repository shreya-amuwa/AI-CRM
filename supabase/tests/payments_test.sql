-- =============================================================================
-- Conversations, Sales → Accounts payment workflow, verified payments,
-- Get Started eligibility, Part Payments and the accountant follow-up.
-- Runs after rls_test.sql (same database, reuses its `test` helpers and users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 23. Lead conversations'
select test.create_auth_user('acc_m2', 'acc.m2@amuwa.com', '{"full_name":"Accounts Member Two"}',
  jsonb_build_object('provisioned_by', test.id('dh_acc'), 'provisioned_role', 'TEAM_MEMBER',
                     'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('accounts') order by t.created_at limit 1)));
create function test.admin_check(p_sql text, p_label text) returns void language plpgsql security definer as $$
declare v boolean;
begin
  execute p_sql into v;
  perform test.check(v, p_label);
end $$;
grant execute on function test.admin_check(text, text) to authenticated;
create temp table pt (name text primary key, id uuid);
create temp table ptp (name text primary key, id uuid);
grant all on pt, ptp to authenticated;

set role authenticated;
select test.login('tm_a');
insert into pt select 'L1', create_lead(
  '{"name":"Meera Joshi","company":"Joshi Sweets","phone":"+91 98000 10001","notes":"Called once. Wants a WhatsApp API quotation."}', array['AI_CALLING']);
select test.check((select count(*) = 1 and bool_and(source = 'LEAD_NOTE' and note = 'Called once. Wants a WhatsApp API quotation.' and created_by = test.id('tm_a'))
                     from lead_conversations where customer_id = (select id from pt where name = 'L1')),
  'the note typed while creating the lead is stored as the first conversation');
select test.check((select jsonb_array_length(customer_conversations((select id from pt where name = 'L1'))) = 1
                     and customer_conversations((select id from pt where name = 'L1')) -> 0 ->> 'note' = 'Called once. Wants a WhatsApp API quotation.'
                     and customer_conversations((select id from pt where name = 'L1')) -> 0 -> 'author' ->> 'fullName' = 'Member A'),
  'the lead opens with that note as the Last conversation, with who recorded it');
-- Updating the lead (no change to the note) never duplicates the initial conversation.
select update_lead((select id from pt where name = 'L1'), '{"city":"Pune","notes":"Called once. Wants a WhatsApp API quotation."}');
select test.check((select count(*) = 1 from lead_conversations where customer_id = (select id from pt where name = 'L1')), 'saving the lead again does not duplicate the note');

select pg_sleep(0.02);
select add_lead_conversation((select id from pt where name = 'L1'), 'Explained the packages; they asked for a quotation.');
select test.check((select jsonb_array_length(customer_conversations((select id from pt where name = 'L1'))) = 2
                     and customer_conversations((select id from pt where name = 'L1')) -> 0 ->> 'note' like 'Explained the packages%'
                     and customer_conversations((select id from pt where name = 'L1')) -> 1 ->> 'source' = 'LEAD_NOTE'),
  'a new conversation becomes the Last conversation; the earlier one stays below it');
select test.must_fail($$select add_lead_conversation((select id from pt where name = 'L1'), '   ')$$, 'an empty conversation is refused', 'Write what was discussed');
select test.must_fail($$select add_lead_conversation((select id from pt where name = 'L1'), repeat('x', 5001))$$, 'an over-long conversation is refused', 'under 5000');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from pt where name = 'L1') and type = 'CONVERSATION_ADDED'), 'adding a conversation is in the activity log');

-- Edit exactly one record.
create temp table cv (id uuid);
grant all on cv to authenticated;
insert into cv select (c ->> 'id')::uuid from jsonb_array_elements(customer_conversations((select id from pt where name = 'L1'))) c where c ->> 'source' = 'LEAD_NOTE';
select update_lead_conversation((select id from cv), 'Called once. Wants a WhatsApp API and Blue Tick quotation.');
select test.check((select note = 'Called once. Wants a WhatsApp API and Blue Tick quotation.' and edited_at is not null from lead_conversations where id = (select id from cv))
              and (select note like 'Explained the packages%' and edited_at is null from lead_conversations where source = 'MANUAL' and customer_id = (select id from pt where name = 'L1')),
  'editing one conversation changes only that record');
select test.check((select count(*) = 2 from lead_conversations where customer_id = (select id from pt where name = 'L1')), 'no conversation was deleted or duplicated');
select test.check((select notes like '%Blue Tick%' from customers where id = (select id from pt where name = 'L1')), 'the legacy notes column follows the initial note');
select test.must_fail($$insert into lead_conversations (customer_id, note) values ((select id from pt where name = 'L1'), 'direct')$$, 'conversations cannot be written directly', 'permission denied|row-level');
select test.must_fail($$delete from lead_conversations$$, 'conversations cannot be deleted', 'permission denied|row-level');

select test.login('tm_b');
select test.must_fail($$select add_lead_conversation((select id from pt where name = 'L1'), 'sneaky')$$, 'another salesperson cannot add to this lead', 'NOT_FOUND');
select test.must_fail($$select update_lead_conversation((select id from cv), 'hijack')$$, 'another salesperson cannot edit it', 'NOT_FOUND');
select test.must_fail($$select customer_conversations((select id from pt where name = 'L1'))$$, 'another salesperson cannot read it', 'NOT_FOUND');
select test.check((select count(*) = 0 from lead_conversations), 'RLS hides conversations of leads you cannot work on');
select test.login('th_wab');
select test.check((select bool_and((c ->> 'canEdit')::boolean) from jsonb_array_elements(customer_conversations((select id from pt where name = 'L1'))) c), 'the team head may edit the team''s conversations');
select update_lead_conversation((select id from cv), 'Called once. Wants a WhatsApp API and Blue Tick quotation. (checked by team head)');
select test.login('tm_c');
select test.check((select count(*) = 0 from lead_conversations), 'another department sees none');

-- ---------------------------------------------------------------------------
\echo '--- 24. Send to Accounts, payments, confirm / back off'
-- ---------------------------------------------------------------------------
select test.login('tm_a');
insert into pt select 'L2', create_lead('{"name":"Rohan Desai","company":"Desai Clinic","phone":"+91 98000 20002","notes":"Ready to buy this week."}', array['AI_CALLING', 'META_ADS_MANAGEMENT']);
select test.must_fail($$select send_lead_to_accounts((select id from pt where name = 'L2'), 0, null)$$, 'an agreed amount is required', 'agreed amount');
select test.must_fail($$select send_lead_to_accounts((select id from pt where name = 'L2'), 100.5, null)$$, 'whole rupees only', 'whole rupees');
select test.login('tm_b');
select test.must_fail($$select send_lead_to_accounts((select id from pt where name = 'L2'), 50000, null)$$, 'another salesperson cannot send this lead', 'NOT_FOUND');
select test.login('tm_a');
insert into ptp select 'req', send_lead_to_accounts((select id from pt where name = 'L2'), 50000, 'Customer agreed on the 5-lakh package');
select test.check((select payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' and deal_amount = 50000 and lifecycle_stage = 'LEAD' and lead_status = 'READY_TO_BUY'
                     from customers where id = (select id from pt where name = 'L2')), 'sent to Accounts: status is Pending payment confirmation, same lead record');
select test.must_fail($$select send_lead_to_accounts((select id from pt where name = 'L2'), 50000, null)$$, 'a second submission is refused', 'already with Accounts');
select test.check((select count(*) = 1 from customers where company = 'Desai Clinic'), 'still exactly one customer');
-- The Accounts payment desk is emailed (one person); Sales never sees that job
select test.admin_check($Q$select (select count(*) = 1 and bool_and(internal and channel = 'EMAIL' and status = 'QUEUED' and context ->> 'kind' = 'PAYMENT_CONFIRMATION_REQUESTED'
     and context ->> 'to' = (select p.email from profiles p join departments d on d.id = p.department_id where d.slug = 'accounts' and p.status = 'ACTIVE' order by p.created_at, p.id limit 1)
     and context ->> 'customer' = 'Desai Clinic' and context ->> 'from' = 'Member A')
   from automation_jobs where customer_id = (select id from pt where name = 'L2') and stage = 'ACCOUNTS_PAYMENT')$Q$,
  'sending to Accounts queues one email to the longest-serving Accounts person (with who sent it)');
select test.check((select count(*) = 0 from automation_jobs where stage = 'ACCOUNTS_PAYMENT'), 'Sales cannot see the staff email jobs');
select test.must_fail($$select update_lead((select id from pt where name = 'L2'), '{"city":"X"}')$$, 'a lead with Accounts cannot be edited', 'with Accounts');
select test.must_fail($$select move_customer_to_potential((select id from pt where name = 'L2'), 50000, current_date + 3)$$, 'a lead with Accounts cannot be moved to Potential', 'with Accounts');
select test.check((select (customer_pipeline_counts() -> 'leads' ->> 'WITH_ACCOUNTS')::int = 1), 'Sales counts the lead under With Accounts');
select add_lead_conversation((select id from pt where name = 'L2'), 'Customer will pay 20k today by UPI.');
select test.check((select count(*) = 2 from lead_conversations where customer_id = (select id from pt where name = 'L2')), 'Sales can keep recording conversations while it is with Accounts');
-- Sales cannot do any Accounts action.
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L2'), 'PART', 20000, 'UPI', 'UTR-X', null, null, true)$$, 'Sales cannot record a payment', 'Only the Accounts department');
select test.must_fail($$select accounts_confirm_and_return((select id from pt where name = 'L2'), null)$$, 'Sales cannot confirm and return', 'Only the Accounts department');
select test.must_fail($$select accounts_return_to_leads((select id from pt where name = 'L2'), null)$$, 'Sales cannot return a lead', 'Only the Accounts department');
select test.must_fail($$select accounts_payment_requests()$$, 'Sales cannot read the Accounts queue', 'Only the Accounts department');
select test.must_fail($$select accounts_payment_counts()$$, 'Sales cannot read the Accounts counters', 'Only the Accounts department');
select test.must_fail($$insert into customer_payments (customer_id, payment_type, amount, status) values ((select id from pt where name = 'L2'), 'PART', 100, 'VERIFIED')$$, 'payments cannot be inserted directly', 'permission denied');
select test.must_fail($$update customers set amount_received = 50000, amount_verified = 50000 where id = (select id from pt where name = 'L2')$$, 'verified money cannot be edited directly', 'permission denied');

-- Accounts
select test.login('acc_m');
select test.check((select (accounts_payment_requests('PENDING') ->> 'total')::int = 1
                     and accounts_payment_requests('PENDING') -> 'items' -> 0 ->> 'id' = (select id::text from pt where name = 'L2')
                     and (accounts_payment_requests('PENDING') -> 'items' -> 0 ->> 'agreedAmount')::numeric = 50000
                     and accounts_payment_requests('PENDING') -> 'items' -> 0 ->> 'salesperson' = 'Member A'
                     and accounts_payment_requests('PENDING') -> 'items' -> 0 -> 'services' ->> 0 is not null
                     and accounts_payment_requests('PENDING') -> 'items' -> 0 -> 'lastConversation' ->> 'note' like 'Customer will pay%'),
  'Accounts sees the lead with agreed amount, services, salesperson and the last conversation');
select test.check((select (accounts_payment_requests('PENDING', 'desai') ->> 'total')::int = 1 and (accounts_payment_requests('PENDING', 'nomatch') ->> 'total')::int = 0), 'the queue is searchable');
select test.check((select (accounts_payment_counts() ->> 'requestsPending')::int = 1), 'Accounts counter shows one waiting');
select test.must_fail($$select accounts_confirm_and_return((select id from pt where name = 'L2'), null)$$, 'cannot confirm before a payment is verified', 'verify the payment');
-- GST is the order's, chosen by Accounts before any money or invoice: these older checks use 0% so their rupee figures stay as written
select accounts_set_order_gst((select id from pt where name = 'L2'), 0);
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L2'), 'PART', 20000, 'UPI', null, null, null, false)$$, 'UPI needs a transaction reference', 'reference');
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L2'), 'PART', 20000.5, 'UPI', 'U1', null, null, false)$$, 'whole rupees', 'whole rupees');
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L2'), 'FULL', 20000, 'UPI', 'U1', null, null, false)$$, 'a full payment must settle the agreed amount', 'must settle');
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L2'), 'PART', 50000, 'UPI', 'U1', null, null, false)$$, 'a payment that settles is a full payment', 'full payment');
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L2'), 'PART', 60000, 'UPI', 'U1', null, null, false)$$, 'cannot exceed the agreed amount', 'exceed');
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L2'), 'PART', 20000, 'UPI', 'U1', now() + interval '3 days', null, false)$$, 'a future payment date is refused', 'future');
insert into ptp select 'p1', accounts_record_payment((select id from pt where name = 'L2'), 'PART', 20000, 'UPI', 'UTR-0001', null, 'Seen in HDFC', false);
select test.admin_check($Q$select (select amount_received = 20000 and amount_verified = 0 and payment_status = 'PENDING_VERIFICATION' from customers where id = (select id from pt where name = 'L2'))$Q$, 'a recorded but unverified payment is pending: never counted as received money');
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L2'), 'PART', 20000, 'UPI', 'utr-0001', null, null, false)$$, 'the same reference cannot be recorded twice', 'already recorded');
select test.must_fail($$select accounts_confirm_and_return((select id from pt where name = 'L2'), null)$$, 'a pending payment is not enough to confirm', 'verify the payment');
select accounts_update_payment((select id from ptp where name = 'p1'), 'PART', 20000, 'UPI', 'UTR-0001', null, 'Seen in HDFC (edited)');
select test.admin_check($Q$select (select count(*) = 1 and bool_and(note like '%edited%') from customer_payments where customer_id = (select id from pt where name = 'L2'))$Q$, 'editing a payment updates it, it does not create another');
select accounts_verify_payment((select id from ptp where name = 'p1'), null);
select test.admin_check($Q$select (select amount_verified = 20000 and amount_received = 20000 and payment_status = 'PARTIALLY_PAID' from customers where id = (select id from pt where name = 'L2'))$Q$, 'verified part payment: payment status is Partially paid');
select test.must_fail($$select accounts_verify_payment((select id from ptp where name = 'p1'), null)$$, 'cannot verify twice', 'already verified');
select test.must_fail($$select accounts_update_payment((select id from ptp where name = 'p1'), 'PART', 21000, 'UPI', 'UTR-0001', null, null)$$, 'a verified payment cannot be edited', 'still pending');
select test.check((select (select (payments -> 0 ->> 'type') = 'PART' from (select customer_payment_overview((select id from pt where name = 'L2')) -> 'payments' as payments) x)), 'the payment stays a part payment');

select accounts_confirm_and_return((select id from pt where name = 'L2'), 'Part payment received in HDFC');
select test.admin_check($Q$select (select lifecycle_stage = 'ONBOARDING' and payment_workflow = 'PAYMENT_CONFIRMED' and accounts_owner_id = test.id('acc_m')
                     from customers where id = (select id from pt where name = 'L2'))$Q$, 'confirmed: the same record is now in Customer onboarding, with an accountant assigned');
select test.admin_check($Q$select (select accounts_confirmed_at is not null and payment_verified and not get_started and sent_to_accounts_at is null
                     from customer_onboarding where customer_id = (select id from pt where name = 'L2'))$Q$, 'onboarding exists; a verified part payment alone does not make it Get started');
select test.check((select (accounts_payment_requests('CONFIRMED') ->> 'total')::int = 1 and (accounts_payment_requests('PENDING') ->> 'total')::int = 0), 'the request moves to Confirmed');
select test.must_fail($$select accounts_confirm_and_return((select id from pt where name = 'L2'), null)$$, 'cannot confirm twice', 'not waiting');
select test.admin_check($Q$select (select count(*) = 2 from lead_conversations where customer_id = (select id from pt where name = 'L2'))$Q$, 'conversation history survived the move');
select test.admin_check($Q$select (select count(*) = 1 from customer_payments where customer_id = (select id from pt where name = 'L2'))$Q$, 'still exactly one payment');

-- Get Started needs verified documents AND a verified payment AND the Accounts hand-over.
reset role;
create temp table gs_items as select code from private.customer_items((select id from pt where name = 'L2'));
select test.check((select count(*) > 0 from gs_items), 'the customer has required checklist items');
select test.admin_check($Q$select (select not get_started from customer_onboarding where customer_id = (select id from pt where name = 'L2'))$Q$, 'no documents yet: not Get started');
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by, saved_at)
  select (select id from pt where name = 'L2'), code, 'filled', 'SAVED', test.id('tm_a'), now() from gs_items
  on conflict (customer_id, item_code) do update set value = excluded.value;
select private.refresh_onboarding_progress((select id from pt where name = 'L2'));
select test.admin_check($Q$select (select not get_started and items_saved = items_total from customer_onboarding where customer_id = (select id from pt where name = 'L2'))$Q$, 'documents uploaded but not verified: not Get started (payment verified)');
update customer_onboarding_entries set status = 'VERIFIED', reviewed_by = test.id('tm_b'), reviewed_at = now()
 where customer_id = (select id from pt where name = 'L2') and item_code <> (select min(code) from gs_items);
select private.refresh_onboarding_progress((select id from pt where name = 'L2'));
select test.admin_check($Q$select (select not get_started from customer_onboarding where customer_id = (select id from pt where name = 'L2'))$Q$, 'one document still awaiting verification: not Get started');
update customer_onboarding_entries set status = 'REJECTED', review_note = 'blurry' where customer_id = (select id from pt where name = 'L2') and item_code = (select min(code) from gs_items);
select private.refresh_onboarding_progress((select id from pt where name = 'L2'));
select test.admin_check($Q$select (select not get_started from customer_onboarding where customer_id = (select id from pt where name = 'L2'))$Q$, 'a rejected document: not Get started');
update customer_onboarding_entries set status = 'VERIFIED', reviewed_by = test.id('tm_b'), reviewed_at = now() where customer_id = (select id from pt where name = 'L2');
select private.refresh_onboarding_progress((select id from pt where name = 'L2'));
select test.admin_check($Q$select (select get_started from customer_onboarding where customer_id = (select id from pt where name = 'L2'))$Q$, 'all documents verified + verified part payment + through Accounts: Get started');
select test.check((select (customer_pipeline_counts() -> 'onboarding' ->> 'GET_STARTED')::int >= 0) , 'counts still compute for the superuser');
set role authenticated;
select test.login('tm_a');
select test.check((select get_started from customer_onboarding where customer_id = (select id from pt where name = 'L2'))
                    and (customer_pipeline_counts() -> 'onboarding' ->> 'GET_STARTED')::int = (select count(*) from customer_onboarding o join customers c on c.id = o.customer_id where o.get_started and c.lifecycle_stage = 'ONBOARDING'),
  'Sales sees the customer under Get started, and the tab count follows the same rule');
select test.check((select payment_status = 'PARTIALLY_PAID' and amount_verified = 20000 from customers where id = (select id from pt where name = 'L2')),
  'Get started and Partially paid at the same time (separate statuses)');

-- Part payments, both departments, same records.
select test.check((select (part_payments_list() ->> 'total')::int = 1
                     and part_payments_list() -> 'items' -> 0 ->> 'id' = (select id::text from pt where name = 'L2')
                     and (part_payments_list() -> 'items' -> 0 ->> 'balance')::numeric = 30000
                     and (part_payments_list() -> 'items' -> 0 ->> 'amountVerified')::numeric = 20000
                     and part_payments_list() -> 'items' -> 0 -> 'followUp' = 'null'::jsonb
                     and (part_payments_list() -> 'items' -> 0 -> 'onboarding' ->> 'getStarted')::boolean),
  'Sales Part payments: the customer with balance, Get started, and no accountant follow-up notes');
select test.check((select (customer_pipeline_counts() ->> 'partPayments')::int >= 1), 'Sales counter shows the part-paid customer');
select test.check((select customer_payment_overview((select id from pt where name = 'L2')) -> 'followUps' = 'null'::jsonb), 'Sales never receives the Accounts follow-up notes');
select test.login('tm_b');
select test.check((select (part_payments_list() ->> 'total')::int = 0), 'another salesperson sees no part payments of this customer');
select test.must_fail($$select customer_payment_overview((select id from pt where name = 'L2'))$$, 'nor its payment overview', 'NOT_FOUND');
select test.login('tm_c');
select test.check((select (part_payments_list() ->> 'total')::int = 0), 'another department sees none');
select test.login('th_wab');
select test.check((select (part_payments_list() ->> 'total')::int = 1), 'the team head sees the team''s part payments');

select test.login('acc_m');
select test.check((select (part_payments_list() ->> 'total')::int = 1
                     and part_payments_list() -> 'items' -> 0 -> 'followUp' ->> 'status' = 'FOLLOW_UP_REQUIRED'
                     and part_payments_list() -> 'items' -> 0 -> 'accountsOwner' ->> 'fullName' = 'Accounts Member'),
  'Accounts Part payments: the same customer, Follow-up required, assigned to the accountant');
select test.check((select (accounts_payment_counts() ->> 'partPaymentsActive')::int = 1 and (accounts_payment_counts() ->> 'followUpsDue')::int = 1), 'Accounts counters');
select test.check((select (part_payments_list(p_status => 'PAID', p_search => 'desai') ->> 'total')::int = 0), 'not yet fully paid');
select test.check((select (part_payments_list(p_search => 'desai') ->> 'total')::int = 1 and (part_payments_list(p_search => 'zzz') ->> 'total')::int = 0), 'search works');
select test.check((select (part_payments_list(p_from => current_date, p_to => current_date) ->> 'total')::int = 1 and (part_payments_list(p_from => current_date + 1) ->> 'total')::int = 0), 'date range works');
select test.check((select (part_payments_list(p_accounts_owner => test.id('acc_m')) ->> 'total')::int = 1 and (part_payments_list(p_accounts_owner => test.id('acc_m2')) ->> 'total')::int = 0), 'accountant filter works');
select test.check((select (part_payments_list(p_salesperson => test.id('tm_a')) ->> 'total')::int = 1 and (part_payments_list(p_salesperson => test.id('tm_b')) ->> 'total')::int = 0), 'salesperson filter works');
select test.must_fail($$select part_payments_list(p_status => 'bogus')$$, 'unknown status refused', 'Unknown status');
select test.must_fail($$select part_payments_list(p_sort => 'bogus')$$, 'unknown sort refused', 'Unknown sort');

-- Follow-ups belong to the responsible accountant (or a manager).
select add_payment_followup((select id from pt where name = 'L2'), 'AWAITING_PAYMENT', 'Called; will pay the balance on the 15th.', now() + interval '5 days');
select test.check((select part_payments_list() -> 'items' -> 0 -> 'followUp' ->> 'status' = 'AWAITING_PAYMENT'
                     and (part_payments_list() -> 'items' -> 0 -> 'followUp' ->> 'count')::int = 1
                     and (accounts_payment_counts() ->> 'followUpsDue')::int = 0), 'after a follow-up the status is Awaiting payment and it is no longer due');
select test.check((select (part_payments_list(p_followup => 'AWAITING_PAYMENT') ->> 'total')::int = 1 and (part_payments_list(p_followup => 'FOLLOW_UP_REQUIRED') ->> 'total')::int = 0), 'follow-up status filter');
-- A follow-up without a next date still counts as followed up (Awaiting payment), not "required" again.
select add_payment_followup((select id from pt where name = 'L2'), 'AWAITING_PAYMENT', 'Customer said they will pay soon.', null);
select test.check((select part_payments_list() -> 'items' -> 0 -> 'followUp' ->> 'status' = 'AWAITING_PAYMENT' and (accounts_payment_counts() ->> 'followUpsDue')::int = 0), 'a follow-up with no next date keeps the status and is not due again');
select test.must_fail($$select add_payment_followup((select id from pt where name = 'L2'), 'CONTACTED', '', null)$$, 'a follow-up needs a note', 'Write a note');
select test.must_fail($$select add_payment_followup((select id from pt where name = 'L2'), 'BOGUS', 'x', null)$$, 'outcome must be valid', 'outcome');
select test.check((select jsonb_array_length(customer_payment_overview((select id from pt where name = 'L2')) -> 'followUps') = 2), 'Accounts sees the follow-up notes');
select test.admin_check($Q$select (select count(*) = 2 from lead_conversations where customer_id = (select id from pt where name = 'L2'))$Q$, 'follow-up notes are not mixed into the Sales conversations');
select test.login('acc_m2');
select test.must_fail($$select add_payment_followup((select id from pt where name = 'L2'), 'CONTACTED', 'trying', null)$$, 'another accountant cannot follow up a customer assigned to someone else', 'assigned to another');
select test.must_fail($$select assign_payment_owner((select id from pt where name = 'L2'), test.id('acc_m'))$$, 'a team member cannot assign someone else', 'team lead or head');
select test.login('dh_acc');
select assign_payment_owner((select id from pt where name = 'L2'), test.id('acc_m2'));
select test.admin_check($Q$select (select accounts_owner_id = test.id('acc_m2') from customers where id = (select id from pt where name = 'L2'))$Q$, 'the Accounts head reassigns the accountant');
select test.must_fail($$select assign_payment_owner((select id from pt where name = 'L2'), test.id('tm_a'))$$, 'only Accounts staff can be assigned', 'Accounts team member');
select test.login('acc_m2');
select add_payment_followup((select id from pt where name = 'L2'), 'CONTACTED', 'Took over; customer confirmed.', null);
select test.check((select jsonb_array_length(customer_payment_overview((select id from pt where name = 'L2')) -> 'followUps') = 3), 'the new accountant adds follow-up notes');

-- Another part payment, then the full settlement.
select accounts_record_payment((select id from pt where name = 'L2'), 'PART', 10000, 'BANK_TRANSFER', 'NEFT-22', null, null, false);
select test.admin_check($Q$select (select amount_verified = 20000 and amount_received = 30000 and payment_status = 'PARTIALLY_PAID' from customers where id = (select id from pt where name = 'L2'))$Q$, 'a second payment stays pending: the verified total and the balance do not move');
select test.check((select (part_payments_list() -> 'items' -> 0 ->> 'pendingAmount')::numeric = 10000 and (part_payments_list() -> 'items' -> 0 ->> 'balance')::numeric = 30000), 'the list shows the pending amount separately from the balance');
select accounts_verify_payment((select (p ->> 'id')::uuid from jsonb_array_elements(customer_payment_overview((select id from pt where name = 'L2')) -> 'payments') p where p ->> 'status' = 'PENDING'), null);
select test.admin_check($Q$select (select amount_verified = 30000 and payment_status = 'PARTIALLY_PAID' and (select count(*) = 2 from customer_payments where customer_id = customers.id and status = 'VERIFIED')
                     from customers where id = (select id from pt where name = 'L2'))$Q$, 'verifying updates the verified total: balance now 20,000');
select test.check((select (part_payments_list() -> 'items' -> 0 ->> 'balance')::numeric = 20000 and (part_payments_list(p_status => 'PARTIAL') ->> 'total')::int = 1), 'still in the active follow-up list while a balance remains');
select test.admin_check($Q$select (select get_started from customer_onboarding where customer_id = (select id from pt where name = 'L2'))$Q$, 'onboarding progress was not reset by the extra payment');
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L2'), 'FULL', 15000, 'CASH', null, null, null, true)$$, 'a full payment must settle the balance', 'must settle');
select accounts_record_payment((select id from pt where name = 'L2'), 'FULL', 20000, 'CASH', null, null, 'Balance in cash', true);
select test.admin_check($Q$select (select amount_verified = 50000 and payment_status = 'FULLY_PAID' from customers where id = (select id from pt where name = 'L2'))$Q$, 'after the full payment is verified: Fully paid');
select test.check((select (part_payments_list(p_status => 'PARTIAL') ->> 'total')::int = 0 and (part_payments_list(p_status => 'PAID', p_search => 'desai') ->> 'total')::int = 1
                     and (accounts_payment_counts() ->> 'partPaymentsActive')::int = 0 and (accounts_payment_counts() ->> 'followUpsDue')::int = 0),
  'fully paid: gone from the active follow-up list, kept in Paid with its history');
select test.check((select jsonb_array_length(customer_payment_overview((select id from pt where name = 'L2')) -> 'payments') = 3
                     and (customer_payment_overview((select id from pt where name = 'L2')) ->> 'balance')::numeric = 0), 'the complete payment history remains');
select test.admin_check($Q$select (select get_started from customer_onboarding where customer_id = (select id from pt where name = 'L2'))$Q$, 'onboarding still Get started after full payment');
select test.check((select (part_payments_list() ->> 'total')::int = 0), 'Sales Part payments drops the customer once settled');

-- Reversal: Accounts manager only; eligibility is recalculated.
select test.must_fail($$select accounts_reverse_payment((select (p ->> 'id')::uuid from jsonb_array_elements(customer_payment_overview((select id from pt where name = 'L2')) -> 'payments') p limit 1), 'bounced')$$,
  'a member cannot reverse a verified payment', 'team lead or head');
select test.login('dh_acc');
create temp table rev (id uuid);
grant all on rev to authenticated;
insert into rev select (p ->> 'id')::uuid from jsonb_array_elements(customer_payment_overview((select id from pt where name = 'L2')) -> 'payments') p where p ->> 'method' = 'CASH';
select test.must_fail($$select accounts_reverse_payment((select id from rev), '')$$, 'a reversal needs a reason', 'reason');
select accounts_reverse_payment((select id from rev), 'Cash receipt cancelled');
select test.admin_check($Q$select (select amount_verified = 30000 and payment_status = 'PARTIALLY_PAID' from customers where id = (select id from pt where name = 'L2'))$Q$, 'reversal restores the balance');
select test.admin_check($Q$select (select get_started from customer_onboarding where customer_id = (select id from pt where name = 'L2'))$Q$, 'a valid verified payment remains: still Get started');
select test.admin_check($Q$select (select count(*) = 3 from customer_payments where customer_id = (select id from pt where name = 'L2'))$Q$, 'the reversed payment is kept, not deleted');
select test.admin_check($Q$select (select status = 'REVERSED' from customer_payments where id = (select id from rev))$Q$, 'marked reversed');

-- ---------------------------------------------------------------------------
\echo '--- 25. Customer backs off at Accounts'
-- ---------------------------------------------------------------------------
select test.login('tm_a');
insert into pt select 'L3', create_lead('{"name":"Kavya Nair","company":"Nair Bakers","phone":"+91 98000 30003","notes":"Interested."}', array['AI_CALLING']);
select add_lead_conversation((select id from pt where name = 'L3'), 'Second call, pricing discussed.');
select send_lead_to_accounts((select id from pt where name = 'L3'), 30000, null);
select test.login('acc_m');
select test.must_fail($$select accounts_record_payment((select id from pt where name = 'L1'), 'PART', 1000, 'CASH', null, null, null, true)$$, 'Accounts cannot record a payment for a lead that was never sent', 'NOT_FOUND');
select test.must_fail($$select customer_payment_overview((select id from pt where name = 'L1'))$$, 'Accounts cannot read an unrelated customer', 'NOT_FOUND');
-- GST is the order's, chosen by Accounts before any money or invoice: these older checks use 0% so their rupee figures stay as written
select accounts_set_order_gst((select id from pt where name = 'L3'), 0);
select accounts_record_payment((select id from pt where name = 'L3'), 'PART', 10000, 'CASH', null, null, null, false);
select test.must_fail($$select accounts_return_to_leads((select id from pt where name = 'L3'), 'Changed mind')$$, 'cannot return with a payment still pending', 'pending payments');
select accounts_verify_payment((select (p ->> 'id')::uuid from jsonb_array_elements(customer_payment_overview((select id from pt where name = 'L3')) -> 'payments') p limit 1), null);
select test.must_fail($$select accounts_return_to_leads((select id from pt where name = 'L3'), 'Changed mind')$$, 'Return to Leads is refused once a payment is verified', 'already verified');
select test.admin_check($Q$select (select lifecycle_stage = 'LEAD' and payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' from customers where id = (select id from pt where name = 'L3'))$Q$, 'the refused return changed nothing');
-- A verified payment that is reversed no longer counts, so a return is possible again (decided from the persisted rows).
select test.login('dh_acc');
create temp table rev3 (id uuid);
grant all on rev3 to authenticated;
insert into rev3 select (p ->> 'id')::uuid from jsonb_array_elements(customer_payment_overview((select id from pt where name = 'L3')) -> 'payments') p limit 1;
select accounts_reverse_payment((select id from rev3), 'Customer asked for a refund');
select test.login('acc_m');
select accounts_return_to_leads((select id from pt where name = 'L3'), 'Customer decided not to proceed');
select test.admin_check($Q$select (select lifecycle_stage = 'LEAD' and payment_workflow = 'RETURNED_FROM_ACCOUNTS' and lead_status = 'INTERESTED' from customers where id = (select id from pt where name = 'L3'))$Q$, 'backed off: the same lead is back in Leads');
select test.admin_check($Q$select (select status = 'RETURNED' and resolution_note = 'Customer decided not to proceed' and resolved_by = test.id('acc_m') from payment_requests where customer_id = (select id from pt where name = 'L3'))$Q$, 'return reason, who and when are recorded');
select test.admin_check($Q$select (select count(*) = 1 and bool_and(status = 'REVERSED') from customer_payments where customer_id = (select id from pt where name = 'L3'))$Q$, 'the (reversed) payment is preserved, not deleted');
select test.check((select (accounts_payment_requests('RETURNED') ->> 'total')::int = 1), 'Accounts lists it under Returned');
select test.admin_check($Q$select (select count(*) = 1 from customer_activities where customer_id = (select id from pt where name = 'L3') and type = 'RETURNED_FROM_ACCOUNTS')$Q$, 'the return is in the activity log');
select test.admin_check($Q$select (select count(*) = 1 from audit_logs where action = 'PAYMENT_RETURNED_TO_LEADS' and entity_id = (select id from pt where name = 'L3'))$Q$, 'the return is audited');
select test.check((select (part_payments_list(p_status => 'RETURNED', p_search => 'nair') ->> 'total')::int = 0 and (part_payments_list(p_status => 'PARTIAL', p_search => 'nair') ->> 'total')::int = 0), 'the reversed payment leaves no money on record: not in the refund list nor the active balance list');
select test.login('tm_a');
select test.check((select (customer_pipeline_counts() -> 'leads' ->> 'RETURNED')::int = 1 and (customer_pipeline_counts() -> 'leads' ->> 'WITH_ACCOUNTS')::int = 0), 'Sales sees the lead under Returned from Accounts');
select test.check((select jsonb_array_length(customer_conversations((select id from pt where name = 'L3'))) = 2), 'conversation history is intact');
select test.check((select customer_payment_overview((select id from pt where name = 'L3')) -> 'request' ->> 'resolutionNote' = 'Customer decided not to proceed'), 'Sales can read the return reason');
select update_lead((select id from pt where name = 'L3'), '{"leadStatus":"READY_TO_BUY"}');
select send_lead_to_accounts((select id from pt where name = 'L3'), 30000, 'Back again');
select test.admin_check($Q$select (select count(*) = 2 and count(*) filter (where status = 'PENDING') = 1 from payment_requests where customer_id = (select id from pt where name = 'L3'))$Q$, 'a new submission is a new request; history kept');
select test.check((select count(*) = 1 from customers where company = 'Nair Bakers'), 'no duplicate customer');
select test.login('acc_m');
select accounts_record_payment((select id from pt where name = 'L3'), 'FULL', 30000, 'CASH', null, null, null, true);
select accounts_confirm_and_return((select id from pt where name = 'L3'), null);
select test.admin_check($Q$select (select lifecycle_stage = 'ONBOARDING' and payment_status = 'FULLY_PAID' and amount_verified = 30000 from customers where id = (select id from pt where name = 'L3'))$Q$, 'the second round settles the amount: fully paid, now in onboarding');
select test.admin_check($Q$select (select not get_started from customer_onboarding where customer_id = (select id from pt where name = 'L3'))$Q$, 'fully paid but documents not verified: not Get started');

-- Legacy path: the Sales-recorded payment is pending until Accounts verifies it.
select test.login('tm_a');
insert into pt select 'L4', create_lead('{"name":"Imran Khan","company":"Khan Tailors","phone":"+91 98000 40004"}', array['AI_CALLING']);
select move_customer_to_potential((select id from pt where name = 'L4'), 20000, current_date + 5);
select start_customer_onboarding((select id from pt where name = 'L4'), 8000, 'CASH', null);
select test.admin_check($Q$select (select amount_received = 8000 and amount_verified = 0 from customers where id = (select id from pt where name = 'L4'))
              and (select status = 'PENDING' and source = 'SALES' from customer_payments where customer_id = (select id from pt where name = 'L4'))$Q$, 'Sales-recorded payments are pending in the ledger');
select test.check((select not get_started and not payment_verified from customer_onboarding where customer_id = (select id from pt where name = 'L4')), 'not Get started: nothing verified');
reset role;
update customer_onboarding set sent_to_accounts_at = now() where customer_id = (select id from pt where name = 'L4');
set role authenticated;
select test.login('acc_m');
select test.check((select (accounts_payment_counts() ->> 'onboardingPending')::int >= 1 and (accounts_payment_counts() ->> 'paymentsToVerify')::int >= 1), 'Accounts counters include onboarding confirmations and payments to verify');
select confirm_accounts_payment((select id from pt where name = 'L4'), null);
select test.admin_check($Q$select (select amount_verified = 8000 and payment_status = 'PARTIALLY_PAID' from customers where id = (select id from pt where name = 'L4'))$Q$, 'the existing Accounts confirmation also verifies the recorded payment');
select test.admin_check($Q$select (select payment_verified from customer_onboarding where customer_id = (select id from pt where name = 'L4'))$Q$, 'and flags the onboarding payment as verified');

-- ---------------------------------------------------------------------------
\echo '--- 26. Accounts finance: income, expenses, department totals, analytics'
-- ---------------------------------------------------------------------------
create temp table fx (name text primary key, id uuid);
grant all on fx to authenticated;
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select accounts_finance_summary()$$, 'Sales cannot read finance totals', 'Only the Accounts department');
select test.must_fail($$select accounts_finance_by_department()$$, 'Sales cannot read department totals', 'Only the Accounts department');
select test.must_fail($$select accounts_add_expense(current_date, 'x', null, 'Rent', 100, 'PAID', null)$$, 'Sales cannot add an expense', 'Only the Accounts department');
select test.must_fail($$select accounts_income_list()$$, 'Sales cannot read the income list', 'Only the Accounts department');
select test.must_fail($$select accounts_finance_trend()$$, 'Sales cannot read analytics', 'Only the Accounts department');

select test.login('acc_m');
select test.check((select (accounts_finance_summary() ->> 'expenses')::numeric = 0 and (accounts_finance_summary() ->> 'expenseCount')::int = 0), 'no expenses yet: the total is 0, nothing invented');
insert into fx select 'rent', accounts_add_expense(current_date, '  Office rent  ', test.dept('wabastore'), 'Rent', 1200.50, 'PAID', 'October');
insert into fx select 'ads', accounts_add_expense(current_date, 'Facebook ads', null, 'Marketing', 800, 'PENDING', null);
insert into fx select 'sw', accounts_add_expense(current_date, 'Tools', test.dept('whatsbox'), 'Software', 300, 'PAID', null);
select test.admin_check($Q$select (accounts_finance_summary() ->> 'expenses')::numeric = 2300.50 and (accounts_finance_summary() ->> 'expensesPending')::numeric = 800
  and (accounts_finance_summary() ->> 'expensesPaid')::numeric = 1500.50$Q$, 'company totals: all expenses, with the pending part reported separately');
select test.admin_check($Q$select (accounts_finance_summary() ->> 'income')::numeric = (select coalesce(sum(amount), 0) from (select amount, paid_at, customer_id from customer_payments where status = 'VERIFIED' union all select amount, paid_at, customer_id from addon_payments where status = 'VERIFIED') v)
  and (accounts_finance_summary() ->> 'net')::numeric = (accounts_finance_summary() ->> 'income')::numeric - 2300.50$Q$, 'income is exactly the verified payments; net = income - expenses');
select test.admin_check($Q$select (accounts_finance_summary(test.dept('wabastore')) ->> 'expenses')::numeric = 1200.50
  and (accounts_finance_summary(test.dept('whatsbox')) ->> 'expenses')::numeric = 300
  and (accounts_finance_summary(test.dept('digitree')) ->> 'expenses')::numeric = 0$Q$, 'a department shows only its own expenses (company-wide ones are not attributed to it)');
select test.admin_check($Q$select (accounts_finance_summary(test.dept('wabastore')) ->> 'income')::numeric
  = (select coalesce(sum(p.amount), 0) from (select amount, paid_at, customer_id from customer_payments where status = 'VERIFIED' union all select amount, paid_at, customer_id from addon_payments where status = 'VERIFIED') p join customers c on c.id = p.customer_id where c.department_id = test.dept('wabastore'))
  and (accounts_finance_summary(test.dept('whatsbox')) ->> 'income')::numeric = 0$Q$, 'department income comes from that department''s customers only');
select test.admin_check($Q$select jsonb_array_length(accounts_finance_by_department()) = (select count(*) from departments where generates_revenue)$Q$,
  'Department Income has one box per revenue department in the CRM');
select test.admin_check($Q$select bool_and((e ->> 'income')::numeric = (accounts_finance_summary((e ->> 'departmentId')::uuid) ->> 'income')::numeric
                                 and (e ->> 'expenses')::numeric = (accounts_finance_summary((e ->> 'departmentId')::uuid) ->> 'expenses')::numeric)
                         from jsonb_array_elements(accounts_finance_by_department()) e$Q$,
  'every department box matches that department''s own totals');
select test.admin_check($Q$select (select (e ->> 'expenses')::numeric from jsonb_array_elements(accounts_finance_by_department()) e where e ->> 'slug' = 'wabastore') = 1200.50
  and (select (e ->> 'expenses')::numeric from jsonb_array_elements(accounts_finance_by_department()) e where e ->> 'slug' = 'digitree') = 0$Q$,
  'department boxes keep expenses separate; company-wide expenses are not given to any department');
select test.must_fail($$select accounts_add_expense(current_date, 'x', null, 'Rent', -5, 'PAID', null)$$, 'a negative amount is refused', 'Enter the amount');
select test.must_fail($$select accounts_add_expense(current_date, '   ', null, 'Rent', 5, 'PAID', null)$$, 'a description is required', 'Describe the expense');
select test.must_fail($$select accounts_add_expense(current_date, 'x', null, '', 5, 'PAID', null)$$, 'a category is required', 'category');
select test.must_fail($$select accounts_add_expense(current_date, 'x', gen_random_uuid(), 'Rent', 5, 'PAID', null)$$, 'an unknown department is refused', 'department from the list');
select test.must_fail($$select accounts_add_expense(current_date, 'x', null, 'Rent', 5.555, 'PAID', null)$$, 'more than 2 decimals is refused', '2 decimal');
select test.must_fail($$select accounts_add_expense(current_date, 'x', null, 'Rent', 5, 'MAYBE', null)$$, 'status must be paid or pending', 'paid or pending');
select test.check((select (accounts_expenses_list() ->> 'total')::int = 3 and accounts_expenses_list() -> 'items' -> 0 ->> 'description' is not null), 'the list shows the three expenses');
select test.check((select (accounts_expenses_list(p_search => 'rent') ->> 'total')::int = 1 and (accounts_expenses_list(p_status => 'PENDING') ->> 'total')::int = 1
  and (accounts_expenses_list(p_department => test.dept('wabastore')) ->> 'total')::int = 1 and (accounts_expenses_list(p_company_wide => true) ->> 'total')::int = 1
  and (accounts_expenses_list(p_category => 'software') ->> 'total')::int = 1), 'search, status, department, company-wide and category filters');
select test.check((select accounts_expenses_list() -> 'categories' @> '["Marketing","Rent","Software"]'::jsonb), 'categories are suggested from existing records');
select test.check((select bool_and((i ->> 'canChange')::boolean) from jsonb_array_elements(accounts_expenses_list() -> 'items') i), 'the creator can change their expenses');
select accounts_update_expense((select id from fx where name = 'ads'), current_date, 'Facebook ads (paid)', null, 'Marketing', 800, 'PAID', null);
select test.check((select (accounts_finance_summary() ->> 'expensesPending')::numeric = 0), 'marking an expense paid updates the totals');
select test.login('acc_m2');
select test.must_fail($$select accounts_update_expense((select id from fx where name = 'rent'), current_date, 'hijack', null, 'Rent', 1, 'PAID', null)$$, 'another accountant cannot change it', 'only change expenses you added');
select test.must_fail($$select accounts_delete_expense((select id from fx where name = 'rent'))$$, 'nor delete it', 'only delete expenses you added');
select test.must_fail($$select accounts_import_expenses('[{"externalId":"a"}]'::jsonb, 'GOOGLE_SHEET')$$, 'a member cannot import', 'team lead or head');
select test.login('dh_acc');
select accounts_update_expense((select id from fx where name = 'sw'), current_date, 'Tools (annual)', test.dept('whatsbox'), 'Software', 360, 'PAID', null);
select test.admin_check($Q$select (accounts_finance_summary(test.dept('whatsbox')) ->> 'expenses')::numeric = 360$Q$, 'an Accounts head can correct any expense');
select test.must_fail($$select accounts_import_expenses('[{"externalId":"r1","date":"2026-10-02","description":"Courier","departmentSlug":"nope","category":"Logistics","amount":150}]'::jsonb, 'GOOGLE_SHEET')$$, 'an unknown department in an import is refused', 'unknown department');
select test.must_fail($$select accounts_import_expenses('[{"externalId":"r1","date":"2026-10-02","description":"Courier","category":"Logistics","amount":150},{"externalId":"r2","date":"bad","description":"x","category":"y","amount":5}]'::jsonb, 'GOOGLE_SHEET')$$, 'a bad row refuses the whole import', 'Row 2');
select test.admin_check($Q$select not exists (select 1 from department_expenses where external_id = 'r1')$Q$, 'the failed import left nothing behind');
select test.check((select accounts_import_expenses('[{"externalId":"r1","date":"2026-10-02","description":"Courier","departmentSlug":"wabastore","category":"Logistics","amount":150},{"externalId":"r2","date":"2026-10-03","description":"Stationery","category":"Office","amount":75.25,"status":"PENDING"}]'::jsonb, 'GOOGLE_SHEET') = '{"inserted":2,"updated":0}'::jsonb), 'an import adds the rows');
select test.check((select accounts_import_expenses('[{"externalId":"r1","date":"2026-10-02","description":"Courier (revised)","departmentSlug":"wabastore","category":"Logistics","amount":175}]'::jsonb, 'GOOGLE_SHEET') = '{"inserted":0,"updated":1}'::jsonb), 'importing the same external id again updates, never duplicates');
select test.admin_check($Q$select (select count(*) from department_expenses where external_id = 'r1') = 1 and (select amount from department_expenses where external_id = 'r1') = 175$Q$, 'one row per external id');
select accounts_delete_expense((select id from fx where name = 'ads'));
select test.check((select (accounts_expenses_list() ->> 'total')::int = 4), 'an expense is deleted by an Accounts head');
select test.admin_check($Q$select (select count(*) from audit_logs where action in ('EXPENSE_ADDED', 'EXPENSE_EDITED', 'EXPENSE_DELETED', 'EXPENSES_IMPORTED')) >= 8$Q$, 'expense changes are audited');

-- Income list + analytics (real records only)
select test.admin_check($Q$select (accounts_income_list() ->> 'total')::int = (select count(*) from (select amount, paid_at, customer_id from customer_payments where status = 'VERIFIED' union all select amount, paid_at, customer_id from addon_payments where status = 'VERIFIED') v)
  and (accounts_income_list() ->> 'sum')::numeric = (select sum(amount) from (select amount, paid_at, customer_id from customer_payments where status = 'VERIFIED' union all select amount, paid_at, customer_id from addon_payments where status = 'VERIFIED') v)$Q$, 'the income list is exactly the verified payments (original services and add-ons)');
select test.check((select (accounts_income_list(p_search => 'UTR-0001') ->> 'total')::int = 1 and accounts_income_list(p_search => 'UTR-0001') -> 'items' -> 0 ->> 'customer' = 'Desai Clinic'), 'income search by payment reference finds the customer');
select test.check((select (accounts_income_list(p_department => test.dept('whatsbox')) ->> 'total')::int = 0), 'income filtered by another department is empty');
select test.check((select jsonb_array_length(accounts_finance_trend() -> 'months') = 12 and jsonb_array_length(accounts_finance_trend(3) -> 'months') = 3), 'analytics returns one row per month');
select test.admin_check($Q$select (select (m ->> 'income')::numeric from jsonb_array_elements(accounts_finance_trend() -> 'months') m order by m ->> 'month' desc limit 1)
  = (select coalesce(sum(amount), 0) from (select amount, paid_at, customer_id from customer_payments where status = 'VERIFIED' union all select amount, paid_at, customer_id from addon_payments where status = 'VERIFIED') v where date_trunc('month', paid_at) = date_trunc('month', now()))$Q$, 'this month''s income in the trend equals the verified payments of this month');
select test.check((select accounts_finance_trend() -> 'expenseCategories' -> 0 ->> 'category' is not null), 'top expense categories come from the expenses');
select test.check((select not exists (select 1 from jsonb_array_elements(accounts_finance_by_department()) d where d ->> 'slug' in ('accounts', 'edutraining', 'hr'))
                     and exists (select 1 from jsonb_array_elements(accounts_finance_by_department()) d where d ->> 'slug' = 'wabastore')),
  'the department boxes leave out Accounts, Education & Training and HR');
select test.must_fail($$select * from department_expenses$$, 'expenses cannot be read directly', 'permission denied');

-- ---------------------------------------------------------------------------
\echo '--- Invoice status follows the verified payments'
reset role;
create temp table invs (name text primary key, id uuid, cust uuid);
grant all on invs to authenticated;
set session_replication_role = replica; -- set the ledger totals directly, as the verified payments would
update customers set deal_amount = 50000, amount_verified = 10000 where id = (select id from pt where name = 'L2');
set session_replication_role = origin;
insert into invs select 'i1', id, customer_id from member_invoices where false;
with ins as (insert into member_invoices (owner_id, invoice_number, customer_name, amount, status, customer_id, kind)
  values (test.id('acc_m'), 'AUTO/001', 'Desai Clinic', 50000, 'Pending', (select id from pt where name = 'L2'), 'UPLOADED') returning id, customer_id)
insert into invs select 'i1', id, customer_id from ins;
select test.check((select status = 'Pending' and status_source is null from member_invoices where id = (select id from invs where name = 'i1')),
  'an invoice stays Pending while the verified payments do not cover the agreed amount');
set session_replication_role = replica;
update customers set amount_received = 50000, amount_verified = 50000 where id = (select cust from invs where name = 'i1');
set session_replication_role = origin;
select private.sync_invoice_payment_status((select cust from invs where name = 'i1'));
select test.check((select status = 'Paid' and status_source = 'AUTO' and paid_at is not null from member_invoices where id = (select id from invs where name = 'i1')),
  'fully verified payments make the invoice Paid by themselves');
set session_replication_role = replica;
update customers set amount_verified = 40000 where id = (select cust from invs where name = 'i1');
set session_replication_role = origin;
select private.sync_invoice_payment_status((select cust from invs where name = 'i1'));
select test.check((select status = 'Pending' and paid_at is null from member_invoices where id = (select id from invs where name = 'i1')),
  'a reversed payment puts an automatically paid invoice back to Pending');
set session_replication_role = replica;
update customers set amount_received = 50000, amount_verified = 50000 where id = (select cust from invs where name = 'i1');
set session_replication_role = origin;
-- an invoice uploaded after the payment was verified is Paid from the start
with ins as (insert into member_invoices (owner_id, invoice_number, customer_name, amount, status, customer_id, kind)
  values (test.id('acc_m'), 'AUTO/002', 'Desai Clinic', 50000, 'Pending', (select id from pt where name = 'L2'), 'UPLOADED') returning id, customer_id)
insert into invs select 'i2', id, customer_id from ins;
select test.check((select status = 'Paid' and status_source = 'AUTO' from member_invoices where id = (select id from invs where name = 'i2')),
  'an invoice uploaded after the payment was verified is Paid from the start');
-- a status set by hand is never changed by the system
set role authenticated;
select test.login('acc_m');
select test.check((select (accounts_set_invoice_status((select id from invs where name = 'i2'), 'Pending') ->> 'status') = 'Pending'), 'Accounts can still mark it Pending by hand');
reset role;
select private.sync_invoice_payment_status((select cust from invs where name = 'i2'));
select test.check((select status = 'Pending' and status_source = 'MANUAL' from member_invoices where id = (select id from invs where name = 'i2')),
  'a status set by hand is not overwritten by the automatic one');
-- add-on invoices follow their own payment confirmation
with ins as (insert into member_invoices (owner_id, invoice_number, customer_name, amount, status, customer_id, kind)
  values (test.id('acc_m'), 'AUTO/ADDON', 'Desai Clinic', 5000, 'Pending', (select id from pt where name = 'L2'), 'ADDON') returning id, customer_id)
insert into invs select 'i3', id, customer_id from ins;
select private.sync_invoice_payment_status((select cust from invs where name = 'i3'));
select test.check((select status = 'Pending' from member_invoices where id = (select id from invs where name = 'i3')), 'an add-on invoice is not paid by the original-service payments');


-- ---------------------------------------------------------------------------
\echo '--- 25. Super Admin: part payments and onboarding of one sub-department'
-- ---------------------------------------------------------------------------
reset role;
create temp table sub_expect as
select d.slug as dept, t.division::text as division,
       (select count(*) from customers c where c.team_id in (select id from teams x where x.department_id = d.id and x.division = t.division)
           and c.payment_status = 'PARTIALLY_PAID' and c.lifecycle_stage not in ('LEAD', 'LOST')
           and exists (select 1 from customer_payments p where p.customer_id = c.id and p.status = 'VERIFIED' and p.payment_type = 'PART')) as part_list,
       (select count(*) from customers c where c.team_id in (select id from teams x where x.department_id = d.id and x.division = t.division)
           and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and c.payment_status = 'PARTIALLY_PAID'
           and exists (select 1 from customer_payments p where p.customer_id = c.id and p.status = 'VERIFIED' and p.payment_type = 'PART')) as part_count,
       (select count(*) from customers c where c.team_id in (select id from teams x where x.department_id = d.id and x.division = t.division)
           and c.lifecycle_stage = 'ONBOARDING') as onboarding
  from departments d join (select distinct department_id, division from teams) t on t.department_id = d.id
 where d.slug in ('wabastore', 'whatsbox') and t.division in ('SALES', 'SUPPORT');
grant select on sub_expect to authenticated;
set role authenticated;
select test.login('sa');
select test.check((select bool_and((part_payments_list(p_department => (select id from departments where slug = e.dept), p_division => e.division) ->> 'total')::int = e.part_list) from sub_expect e),
  'part_payments_list for one sub-department returns exactly that sub-department''s part payments');
select test.check((select (part_payments_list() ->> 'total')::int >= (select sum(part_list) from sub_expect)), 'without a scope the list is unchanged (all sub-departments)');
select test.check((select bool_and(coalesce((division_leads_overview((select id from departments where slug = e.dept), e.division::team_division) -> 'partPayments')::int, -1) = e.part_count)
                     from sub_expect e where e.division = 'SALES'),
  'overview partPayments equals the sub-department''s part-paid customers');
select test.check((select bool_and((division_leads_overview((select id from departments where slug = e.dept), e.division::team_division) -> 'onboarding' ->> 'all')::int = e.onboarding)
                     from sub_expect e where e.division = 'SALES'),
  'overview onboarding count equals the sub-department''s ONBOARDING customers');
select test.login('tm_a');
select test.check((select (part_payments_list(p_department => test.dept('whatsbox'), p_division => 'SALES') ->> 'total')::int = 0), 'a sales member scoping to another department still sees only what they may work on');
reset role;

-- ---------------------------------------------------------------------------
\echo '--- Who gets the payment-request email'
reset role;
update profiles set payment_desk_order = 1 where id = test.id('acc_m2');
select test.check((select email = (select email from profiles where id = test.id('acc_m2')) from private.payment_desk_email((select id from pt where name = 'L2'))),
  'the payment-desk person (lowest number) gets it when nobody is assigned to the customer');
update profiles set payment_desk_order = 2 where id = test.id('dh_acc');
select test.check((select email = (select email from profiles where id = test.id('acc_m2')) from private.payment_desk_email((select id from pt where name = 'L2'))), 'only one person: number 1 wins over number 2');
update customers set accounts_owner_id = test.id('dh_acc') where id = (select id from pt where name = 'L2');
select test.check((select email = (select email from profiles where id = test.id('dh_acc')) from private.payment_desk_email((select id from pt where name = 'L2'))),
  'the accountant assigned to the customer gets their request');
update profiles set status = 'SUSPENDED' where id = test.id('dh_acc');
select test.check((select email = (select email from profiles where id = test.id('acc_m2')) from private.payment_desk_email((select id from pt where name = 'L2'))),
  'a suspended assignee is skipped: the payment desk gets it');
update profiles set status = 'ACTIVE', payment_desk_order = null where id = test.id('dh_acc');
update profiles set payment_desk_order = null where id = test.id('acc_m2');
update customers set accounts_owner_id = test.id('acc_m') where id = (select id from pt where name = 'L2');

reset role;
\echo '=== ALL PAYMENT WORKFLOW TESTS PASSED ==='

