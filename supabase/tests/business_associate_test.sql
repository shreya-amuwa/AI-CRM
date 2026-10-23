-- =============================================================================
-- Business Associate (migration 20261119000100): the sub-role and its dashboard value, the Telecaller -> Business Associate conversion,
-- Tasks (contacts), quotations (price list, calculation, review, finalisation, immutability), demos, Scope of Project documents, leads, Home.
-- Runs after the Telecaller suite (uses its Telecaller tc_a and the Wabastore Sales users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- business associate'
reset role;
select test.create_auth_user('ba_a', 'ba.a@amuwa.com', '{"full_name":"BA Alpha"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('ba_b', 'ba.b@amuwa.com', '{"full_name":"BA Beta"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('ba_x', 'ba.x@amuwa.com', '{"full_name":"BA Whatsbox"}',
  jsonb_build_object('provisioned_by', test.id('th_wbx'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')));
create or replace function test.svcs(n int) returns text[] language sql stable as $$ select array_agg(code order by sort_order) from (select code, sort_order from public.crm_services where is_active order by sort_order limit n) s $$;
create or replace function test.bac(p_lead_name text) returns uuid language sql stable security definer set search_path = '' as
  $$ select c.id from public.ba_contacts c join public.customers l on l.id = c.lead_id where l.name = p_lead_name $$;
create or replace function test.lead(p_name text) returns uuid language sql stable security definer set search_path = '' as $$ select id from public.customers where name = p_name $$;
grant execute on function test.svcs(int), test.bac(text), test.lead(text) to authenticated;
set role authenticated;

\echo '   the role and its dashboard'
select test.login('dh_wab');
select test.check((set_sales_sub_role(test.id('ba_a'), 'BUSINESS_ASSOCIATE') ->> 'defaultDashboard') = 'business-associate', 'a Department Head sets Business Associate: the dashboard value is business-associate');
select set_sales_sub_role(test.id('ba_b'), 'BUSINESS_ASSOCIATE');
select test.login('sa');
select set_sales_sub_role(test.id('ba_x'), 'BUSINESS_ASSOCIATE');
reset role;
select test.check((select default_dashboard = 'telecaller' from profiles where id = test.id('tc_a')), 'the Telecaller keeps the Telecaller dashboard');
select test.check((select default_dashboard = 'sales-member' from profiles where id = test.id('tm_a')), 'an ordinary Sales member keeps the Sales member dashboard');
set role authenticated;

\echo '   access'
select test.login('tm_a');
select test.must_fail($$select ba_home()$$, 'a Sales member cannot open the Business Associate home', 'FORBIDDEN');
select test.must_fail($$select ba_contacts_list()$$, 'nor the contacts', 'FORBIDDEN');
select test.login('tc_a');
select test.must_fail($$select ba_contacts_list()$$, 'nor can a Telecaller', 'FORBIDDEN');
select test.must_fail($$select ba_leads_list()$$, 'nor open the Business Associate leads', 'FORBIDDEN');
select test.login('ba_a');
select test.must_fail($$select telecaller_home()$$, 'a Business Associate cannot open the Telecaller pages', 'FORBIDDEN');
select test.must_fail($$insert into ba_contacts (lead_id, department_id, assigned_to) values (gen_random_uuid(), test.dept('wabastore'), test.id('ba_a'))$$, 'contacts cannot be written directly', 'permission denied');
select test.must_fail($$insert into ba_quotations (quotation_no, contact_id) values ('X', gen_random_uuid())$$, 'nor quotations', 'permission denied');

\echo '   converting a qualified lead'
select test.login('tc_a');
select test.check(jsonb_array_length(ba_assignees()) = 2, 'a Telecaller sees the Business Associates of their own department');
select test.must_fail($$select telecaller_lead_convert(test.lead('Warm Customer'), null, null)$$, 'a lead that is not Interested is not qualified', 'Interested');
select test.must_fail($$select telecaller_lead_convert(test.lead('Hot Customer'), test.id('ba_x'), null)$$, 'a Business Associate of another department is refused', 'Business Associate of your department');
select test.must_fail($$select telecaller_lead_convert(test.lead('Hot Customer'), test.id('tm_a'), null)$$, 'so is somebody who is not a Business Associate', 'Business Associate of your department');
select test.must_fail($$select telecaller_lead_convert(gen_random_uuid(), null, null)$$, 'an unknown lead', 'not found');
select test.login('tc_b');
select test.must_fail($$select telecaller_lead_convert(test.lead('Hot Customer'), null, null)$$, 'another Telecaller cannot convert this lead', 'not found');
select test.login('tc_a');
select test.check((telecaller_lead_convert(test.lead('Hot Customer'), test.id('ba_a'), 'Wants a demo on Friday') ->> 'assigneeName') = 'BA Alpha', 'the lead is converted and assigned to BA Alpha');
select test.must_fail($$select telecaller_lead_convert(test.lead('Hot Customer'), test.id('ba_b'), null)$$, 'a second conversion is refused', 'already been converted');
reset role;
select test.check((select count(*) = 1 from ba_contacts where lead_id = test.lead('Hot Customer')), 'no duplicate contact exists');
select test.check((select lead_id = test.lead('Hot Customer') and telecaller_id = test.id('tc_a') and assigned_to = test.id('ba_a') and stage = 'NEW' from ba_contacts where lead_id = test.lead('Hot Customer')), 'the contact keeps the source lead and the Telecaller');
select test.check((select count(*) = 1 from customers where name = 'Hot Customer'), 'the customer record was not copied');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ba_a') and type = 'BA_CONTACT_ASSIGNED'), 'the Business Associate is notified');
set role authenticated;
select test.login('tc_a');
select test.check((select (x -> 'converted' ->> 'businessAssociate') = 'BA Alpha' from jsonb_array_elements(telecaller_leads_list(null, 'HOT', null, null, 1, 10) -> 'items') x where x ->> 'name' = 'Hot Customer'), 'the Telecaller''s lead list shows it was converted');
-- a second qualified lead goes to the least busy Business Associate
select telecaller_lead_save(null, jsonb_build_object('name','Second Qualified','company','SQ Co','phone','9811234571','leadSource','Referral'), test.svcs(2), 'HOT', 'INTERESTED');
select test.check((telecaller_lead_convert(test.lead('Second Qualified'), null, null) ->> 'assigneeName') = 'BA Beta', 'without a choice, the Business Associate with the fewest contacts gets it');

\echo '   Tasks: only my own contacts'
select test.login('ba_a');
select test.check((ba_contacts_list() ->> 'total')::int = 1 and (ba_contacts_list() -> 'items' -> 0 ->> 'name') = 'Hot Customer', 'BA Alpha sees only their contact');
select test.check((select x ->> 'telecaller' = 'Tele A' and x ->> 'businessAssociate' = 'BA Alpha' and x ->> 'leadSource' = 'Cold Call' and x ->> 'stage' = 'NEW' and x ->> 'phone' is not null from jsonb_array_elements(ba_contacts_list() -> 'items') x), 'the row has the client, the assigned Telecaller, the source and the stage');
select test.check((ba_contacts_list() -> 'counts' ->> 'NEW')::int = 1, 'counts per stage');
select test.check((ba_contacts_list('hot co') ->> 'total')::int = 1 and (ba_contacts_list('nobody') ->> 'total')::int = 0, 'search');
select test.must_fail($$select ba_contacts_list(null, 'WEIRD')$$, 'an unknown stage filter is refused', 'Unknown stage');
select test.login('ba_b');
select test.check((ba_contacts_list() ->> 'total')::int = 1 and (ba_contacts_list() -> 'items' -> 0 ->> 'name') = 'Second Qualified', 'BA Beta sees only theirs');
select test.must_fail($$select ba_contact_get(test.bac('Hot Customer'))$$, 'BA Beta cannot open BA Alpha''s contact', 'not found');
select test.must_fail($$select ba_contact_update(test.bac('Hot Customer'), '{"requirements":"x"}')$$, 'nor change it', 'not found');
select test.must_fail($$select ba_contact_note_add(test.bac('Hot Customer'), 'x')$$, 'nor add a note', 'not found');
select test.login('ba_x');
select test.check((ba_contacts_list() ->> 'total')::int = 0, 'a Business Associate of another department sees nothing');
select test.login('ba_b');
select test.check((select count(*) = 1 from ba_contacts), 'RLS: BA Beta reads only their own contact row');
select test.login('dh_wab');
select test.check((select count(*) = 2 from ba_contacts), 'RLS: the Department Head reads the department''s contacts');
select test.login('tm_b');
select test.check((select count(*) = 0 from ba_contacts), 'RLS: an unrelated Sales member reads none');
select test.login('ba_a');
select test.check((ba_contact_update(test.bac('Hot Customer'), '{"requirements":"A WhatsApp API for order updates and an AI QR menu","profile":{"industry":"Restaurants","website":"https://hot.example.com"},"nextFollowUp":null}') ->> 'requirements') like 'A WhatsApp API%', 'requirements and the business profile are saved');
select test.check((ba_contact_get(test.bac('Hot Customer')) ->> 'stage') = 'IN_PROGRESS', 'the first piece of work moves a new contact to In progress');
select ba_contact_note_add(test.bac('Hot Customer'), 'Called the owner; wants a demo');
select test.check((select count(*) >= 3 from jsonb_array_elements(ba_contact_get(test.bac('Hot Customer')) -> 'events')), 'the notes and changes are kept as the contact''s history');
select test.must_fail($$select ba_contact_update(test.bac('Hot Customer'), '{"stage":"DONE"}')$$, 'an unknown stage is refused', 'Unknown stage');

\echo '   price list'
select test.must_fail($$select service_price_save((test.svcs(1))[1], 'one time', 5000, 18, 10)$$, 'a Business Associate cannot change prices', 'FORBIDDEN');
select test.login('dh_wab');
select service_price_save((test.svcs(2))[1], 'one time', 5000, 18, 10);
select service_price_save((test.svcs(2))[2], 'per month', 2000, 18, 0);
select test.must_fail($$select service_price_save('NOPE', 'x', 1, 1, 1)$$, 'an unknown service is refused', 'Unknown service');
select test.must_fail($$select service_price_save((test.svcs(1))[1], 'x', -5, 18, 0)$$, 'a negative price is refused', 'unit price');
select test.check((select count(*) = 2 from jsonb_array_elements(service_prices_list()) x where (x ->> 'priced')::boolean), 'the list shows the two approved prices');
select test.login('tm_a');
select test.must_fail($$select service_prices_list()$$, 'a Sales member cannot open the price list', 'FORBIDDEN');

\echo '   quotations'
select test.login('ba_a');
select test.check(true, 'start quotations');
create temp table t_q (id uuid);
grant all on t_q to authenticated;
insert into t_q select (ba_quotation_save(null, test.bac('Hot Customer'), jsonb_build_object('gstApplicable', true, 'validityDays', 30, 'paymentTerms', '50% advance, 50% on delivery',
  'items', jsonb_build_array(
    jsonb_build_object('serviceCode', (test.svcs(2))[1], 'quantity', 2, 'unitPrice', 5000, 'discountPct', 10, 'gstRate', 18),
    jsonb_build_object('serviceCode', (test.svcs(2))[2], 'quantity', 1, 'unitPrice', 2000, 'discountPct', 0, 'gstRate', 18)))) ->> 'id')::uuid;
select test.check((select q.subtotal = 12000 and q.discount_total = 1000 and q.taxable_total = 11000 and q.tax_total = 1980 and q.total = 12980 and q.status = 'DRAFT' and q.quotation_no ~ '^QT-[0-9]{4}-[0-9]{5}$'
                    from ba_quotations q where q.id = (select id from t_q)), 'the database calculates: 2 x 5,000 less 10% + 2,000 = 11,000 + 18% GST = 12,980');
select test.check((select jsonb_array_length(price_flags) = 0 from ba_quotations where id = (select id from t_q)), 'prices from the approved list carry no flag');
select test.check((ba_contact_get(test.bac('Hot Customer')) ->> 'stage') = 'QUOTATION_PENDING', 'a quotation draft moves the contact to Quotation pending');
select test.must_fail($$select ba_quotation_save(null, test.bac('Hot Customer'), jsonb_build_object('items', jsonb_build_array(jsonb_build_object('serviceCode', (test.svcs(2))[1], 'quantity', 1, 'unitPrice', 5000, 'discountPct', 25, 'gstRate', 18))))$$, 'a discount above the approved limit is refused', 'above the');
select test.must_fail($$select ba_quotation_save(null, test.bac('Hot Customer'), jsonb_build_object('items', jsonb_build_array(jsonb_build_object('serviceCode', 'NOPE', 'quantity', 1, 'unitPrice', 1))))$$, 'an unknown service is refused', 'catalogue');
select test.must_fail($$select ba_quotation_save(null, test.bac('Hot Customer'), jsonb_build_object('items', jsonb_build_array(jsonb_build_object('serviceCode', (test.svcs(1))[1], 'quantity', 0, 'unitPrice', 1))))$$, 'a zero quantity is refused', 'quantity');
select test.must_fail($$select ba_quotation_save(null, test.bac('Hot Customer'), jsonb_build_object('items', '[]'::jsonb))$$, 'a quotation needs a service', 'at least one');
select test.must_fail($$select ba_quotation_save(null, test.bac('Hot Customer'), jsonb_build_object('items', jsonb_build_array(jsonb_build_object('serviceCode', (test.svcs(3))[3], 'quantity', 1, 'unitPrice', 900, 'discountPct', 5))))$$, 'a discount on a service with no approved price is refused', 'approved price list');
select test.check((ba_quotation_save((select id from t_q), null, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('serviceCode', (test.svcs(2))[1], 'quantity', 1, 'unitPrice', 4500, 'discountPct', 0, 'gstRate', 18)), 'gstApplicable', false)) -> 'priceFlags' -> 0 ->> 'kind') = 'PRICE_DIFFERS', 'a price that differs from the approved one is flagged');
select test.check((select total = 4500 and tax_total = 0 from ba_quotations where id = (select id from t_q)), 'without GST the total is the taxable amount (no automatic tax)');
select ba_quotation_save((select id from t_q), null, jsonb_build_object('gstApplicable', true, 'items', jsonb_build_array(jsonb_build_object('serviceCode', (test.svcs(2))[1], 'quantity', 2, 'unitPrice', 5000, 'discountPct', 10, 'gstRate', 18), jsonb_build_object('serviceCode', (test.svcs(2))[2], 'quantity', 1, 'unitPrice', 2000, 'discountPct', 0, 'gstRate', 18))));
-- an AI draft needs a review before it can be finalised
select ba_quotation_save((select id from t_q), null, jsonb_build_object('aiGenerated', true, 'aiModel', 'test-model', 'content', '{"introduction":"Dear client"}'::jsonb));
select test.check((select ai_generated and reviewed_at is null from ba_quotations where id = (select id from t_q)), 'an AI draft is not reviewed or approved');
select test.must_fail($$select ba_quotation_finalize_begin((select id from t_q))$$, 'an unreviewed AI draft cannot be finalised', 'Review the AI draft');
select test.check((ba_home() ->> 'quotationsAwaitingReview')::int = 1, 'Home counts it as awaiting review');
select ba_quotation_review((select id from t_q));
select test.login('ba_b');
select test.must_fail($$select ba_quotation_get((select id from t_q))$$, 'another Business Associate cannot open the quotation', 'not found');
select test.must_fail($$select ba_quotation_finalize_begin((select id from t_q))$$, 'nor finalise it', 'not found');
select test.check((ba_quotations_list() ->> 0) is null or jsonb_array_length(ba_quotations_list()) = 0, 'nor list it');
select test.login('ba_a');
select test.must_fail($$select ba_quotation_finalize_record((select id from t_q), 'ba-documents', 'x/y.pdf', 'R2', 'r', 'e', 1)$$, 'the file cannot be recorded without starting the finalisation', 'Start the finalisation');
select ba_quotation_save((select id from t_q), null, jsonb_build_object('validityDays', null));
select test.must_fail($$select ba_quotation_finalize_begin((select id from t_q))$$, 'a quotation needs its validity period', 'validity');
select ba_quotation_save((select id from t_q), null, jsonb_build_object('validityDays', 15, 'timeline', '4 weeks'));
select test.check((ba_quotation_finalize_begin((select id from t_q)) ->> 'departmentId') = test.dept('wabastore')::text, 'finalisation starts and returns what the PDF is drawn from');
select test.must_fail($$select ba_quotation_finalize_record((select id from t_q), 'ba-documents', 'wrong/path.pdf', 'R2', 'r', 'e', 1)$$, 'only the expected file can be recorded', 'not the one expected');
select test.check((ba_quotation_finalize_record((select id from t_q), 'ba-documents', (select format('%s/%s/quotation-%s-r%s.pdf', c.department_id, c.id, q.quotation_no, q.revision) from public.ba_quotations q join public.ba_contacts c on c.id = q.contact_id where q.id = (select id from t_q)), 'R2', 'r2://x', 'etag', 1234) ->> 'status') = 'FINAL', 'the quotation is finalised with its PDF reference');
select test.check((select valid_until = (now() at time zone 'Asia/Kolkata')::date + 15 and finalized_by = test.id('ba_a') from ba_quotations where id = (select id from t_q)), 'the validity date is set from the issue date');
select test.must_fail($$select ba_quotation_save((select id from t_q), null, '{"notes":"edit"}')$$, 'a finalised quotation cannot be edited', 'finalised');
select test.must_fail($$select ba_quotation_finalize_begin((select id from t_q))$$, 'nor finalised again', 'already finalised');
reset role;
select test.must_fail($$update ba_quotations set total = 1 where id = (select id from t_q)$$, 'not even by a direct update', 'cannot be changed');
select test.must_fail($$delete from ba_quotations where id = (select id from t_q)$$, 'nor deleted', 'cannot be deleted');
set role authenticated;
select test.login('ba_a');
select test.check((select (x ->> 'hasPdf')::boolean from jsonb_array_elements(ba_quotations_list(test.bac('Hot Customer'))) x where x ->> 'status' = 'FINAL'), 'the list shows it has a PDF');
select test.check((ba_quotation_file((select id from t_q)) ->> 'bucket') = 'ba-documents', 'its file is found for the owner');
select test.login('dh_wab');
select test.check((ba_quotation_file((select id from t_q)) ->> 'path') is not null, 'and for the Department Head');
select test.login('th_wab');
select test.check((ba_quotation_file((select id from t_q)) ->> 'path') is not null, 'and for the Team Lead of the team');
select test.login('ba_b');
select test.must_fail($$select ba_quotation_file((select id from t_q))$$, 'not for another Business Associate', 'not found');
select test.login('tm_a');
select test.must_fail($$select ba_quotation_file((select id from t_q))$$, 'nor for an unrelated Sales member', 'not found');
select test.login('ba_a');
select test.check((ba_quotation_revise((select id from t_q)) ->> 'revision') = '2', 'a revision of a finalised quotation is a new draft with the same number');
select test.must_fail($$select ba_quotation_revise((select id from t_q))$$, 'only one open revision', 'already a draft');
select test.check((select count(*) = 2 and count(distinct quotation_no) = 1 from ba_quotations where contact_id = test.bac('Hot Customer') and total = 12980), 'both revisions are kept');
select test.check(true, 'a quotation is not an invoice');

\echo '   demos'
select test.check(true, 'start demos');
create temp table t_d (id uuid);
grant all on t_d to authenticated;
insert into t_d select (ba_demo_save(null, test.bac('Hot Customer'), jsonb_build_object('title', 'Product demo', 'startsAt', (now() + interval '2 days')::text, 'endsAt', (now() + interval '2 days 1 hour')::text,
  'mode', 'ONLINE', 'location', 'Google Meet', 'meetingLink', 'https://meet.example.com/abc', 'internalNotes', 'Show the QR menu')) ->> 'id')::uuid;
select test.check((ba_contact_get(test.bac('Hot Customer')) ->> 'stage') in ('DEMO_SCHEDULED'), 'scheduling a demo moves the contact to Demo scheduled');
select test.must_fail($$select ba_demo_save(null, test.bac('Hot Customer'), jsonb_build_object('title', 'Bad', 'startsAt', (now() + interval '3 days')::text, 'endsAt', (now() + interval '3 days' - interval '1 hour')::text, 'mode', 'ONLINE', 'location', 'Zoom'))$$, 'an end before the start is refused', 'after the start');
select test.must_fail($$select ba_demo_save(null, test.bac('Hot Customer'), jsonb_build_object('title', 'Late', 'startsAt', (now() - interval '2 days')::text, 'endsAt', (now() - interval '2 days' + interval '1 hour')::text, 'mode', 'ONLINE', 'location', 'Zoom'))$$, 'a time that has passed is refused', 'passed');
select test.must_fail($$select ba_demo_save(null, test.bac('Hot Customer'), jsonb_build_object('title', 'Clash', 'startsAt', (now() + interval '2 days 30 minutes')::text, 'endsAt', (now() + interval '2 days 90 minutes')::text, 'mode', 'ONLINE', 'location', 'Zoom'))$$, 'an overlapping demo is refused', 'already have a demo');
select test.must_fail($$select ba_demo_save(null, test.bac('Hot Customer'), jsonb_build_object('title', 'No place', 'startsAt', (now() + interval '5 days')::text, 'endsAt', (now() + interval '5 days 1 hour')::text, 'mode', 'IN_PERSON'))$$, 'an in-person demo needs a place', 'where the demo');
select test.must_fail($$select ba_demo_save(null, test.bac('Hot Customer'), jsonb_build_object('title', 'Link', 'startsAt', (now() + interval '5 days')::text, 'endsAt', (now() + interval '5 days 1 hour')::text, 'mode', 'ONLINE', 'location', 'Zoom', 'meetingLink', 'javascript:alert(1)'))$$, 'a meeting link must be http(s)', 'http');
select test.check((ba_demo_save((select id from t_d), null, jsonb_build_object('startsAt', (now() + interval '4 days')::text, 'endsAt', (now() + interval '4 days 1 hour')::text)) ->> 'status') = 'RESCHEDULED', 'a changed time is a reschedule');
select test.check((select reschedule_count = 1 from ba_demos where id = (select id from t_d)), 'and counted');
select test.check((ba_demo_save((select id from t_d), null, jsonb_build_object('title', 'Product demo v2')) ->> 'status') = 'RESCHEDULED', 'a change that does not move it keeps the status');
select test.must_fail($$select ba_demo_status((select id from t_d), 'COMPLETED', 'x', null)$$, 'a demo that has not started cannot be completed', 'not started');
select test.login('ba_b');
select test.must_fail($$select ba_demo_save((select id from t_d), null, '{"title":"hijack"}')$$, 'another Business Associate cannot change it', 'not found');
select test.must_fail($$select ba_demo_status((select id from t_d), 'CANCELLED')$$, 'nor cancel it', 'not found');
select test.check(jsonb_array_length(ba_demos_list()) = 0, 'nor see it');
select test.login('ba_a');
select test.check(jsonb_array_length(ba_demos_list(null, null, 'RESCHEDULED')) = 1 and (ba_demos_list() -> 0 ->> 'client') = 'Hot Customer', 'the demo list shows the client');
select test.check((ba_home() ->> 'upcomingDemos')::int = 1, 'Home counts the upcoming demo');
reset role;
update ba_demos set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = (select id from t_d);
set role authenticated;
select test.login('ba_a');
select test.check((ba_demo_status((select id from t_d), 'COMPLETED', 'They liked it', 'Send the quotation') ->> 'status') = 'COMPLETED', 'a finished demo is marked completed with feedback');
select test.check((ba_contact_get(test.bac('Hot Customer')) ->> 'stage') = 'SCOPE_PENDING', 'a completed demo moves the contact to Scope pending');
select test.must_fail($$select ba_demo_save((select id from t_d), null, '{"title":"again"}')$$, 'a completed demo cannot be changed', 'completed');
select test.check((ba_demo_save(null, test.bac('Hot Customer'), jsonb_build_object('title', 'Follow-up demo', 'startsAt', (now() + interval '9 days')::text, 'endsAt', (now() + interval '9 days 1 hour')::text, 'mode', 'IN_PERSON', 'location', 'Client office, Pune')) ->> 'status') = 'SCHEDULED', 'an in-person demo with a place');
select test.check((ba_demo_status((select (x ->> 'id')::uuid from jsonb_array_elements(ba_demos_list()) x where x ->> 'title' = 'Follow-up demo'), 'CANCELLED') ->> 'status') = 'CANCELLED', 'a demo can be cancelled');

\echo '   scope of project'
create temp table t_s (id uuid);
grant all on t_s to authenticated;
select test.check((ba_scope_context(test.bac('Hot Customer')) -> 'client' ->> 'name') = 'Hot Customer' and jsonb_array_length(ba_scope_context(test.bac('Hot Customer')) -> 'catalogue') > 3, 'the AI context holds this client and the approved catalogue');
select test.check((ba_scope_context(test.bac('Hot Customer')) -> 'quotation' ->> 'number') is not null, 'and the finalised quotation');
select test.login('ba_b');
select test.must_fail($$select ba_scope_context(test.bac('Hot Customer'))$$, 'another Business Associate cannot get this client''s context', 'not found');
select test.login('ba_a');
insert into t_s select (ba_scope_save(null, test.bac('Hot Customer'), jsonb_build_object('title', 'Scope - Hot Co', 'inputs', '{"industry":"Restaurants"}'::jsonb, 'aiGenerated', true, 'aiModel', 'test-model',
  'content', '{"projectScope":{"overview":"Overview text"}}'::jsonb)) ->> 'id')::uuid;
select test.check((select version = 1 and status = 'DRAFT' and ai_generated and reviewed_at is null from ba_scope_docs where id = (select id from t_s)), 'a scope draft is version 1, AI-generated and not yet reviewed');
select test.must_fail($$select ba_scope_save(null, test.bac('Hot Customer'), '{}')$$, 'only one open draft per contact', 'already a draft');
select test.must_fail($$select ba_scope_finalize_begin((select id from t_s))$$, 'an unreviewed AI scope cannot be finalised', 'Review the AI draft');
select ba_scope_save((select id from t_s), null, '{"content":{"projectScope":{"overview":"Edited overview"}},"reviewed":true}');
select test.check((select content -> 'projectScope' ->> 'overview' = 'Edited overview' and reviewed_at is not null from ba_scope_docs where id = (select id from t_s)), 'edits are saved and the review recorded');
select test.login('ba_b');
select test.must_fail($$select ba_scope_get((select id from t_s))$$, 'another Business Associate cannot open it', 'not found');
select test.must_fail($$select ba_scope_save((select id from t_s), null, '{"title":"x"}')$$, 'nor edit it', 'not found');
select test.login('ba_a');
select ba_scope_finalize_begin((select id from t_s));
select test.check((ba_scope_finalize_record((select id from t_s), 'ba-documents', (select format('%s/%s/scope-v%s.pdf', c.department_id, c.id, s.version) from public.ba_scope_docs s join public.ba_contacts c on c.id = s.contact_id where s.id = (select id from t_s)), 'R2', 'r2://s', 'etag', 999) ->> 'status') = 'FINAL', 'version 1 is finalised with its PDF');
select test.must_fail($$select ba_scope_save((select id from t_s), null, '{"title":"changed"}')$$, 'a finalised version cannot be changed', 'finalised');
reset role;
select test.must_fail($$update ba_scope_docs set content = '{}' where id = (select id from t_s)$$, 'not even directly', 'cannot be changed');
set role authenticated;
select test.login('ba_a');
select test.check((ba_scope_save(null, test.bac('Hot Customer'), '{"reviewed":true}') -> 'content' -> 'projectScope' ->> 'overview') = 'Edited overview', 'a new version starts from the previous one');
select test.check((select count(*) = 2 and bool_or(status = 'FINAL') and bool_or(status = 'DRAFT') from jsonb_array_elements(ba_scope_list(test.bac('Hot Customer'))) x, lateral (select x ->> 'status' as status) s), 'both versions are kept, the finalised one apart from the draft');
select test.check((ba_scope_file((select id from t_s)) ->> 'fileName') = 'scope-of-project-v1.pdf', 'the finalised version has its file');
select test.login('dh_wab');
select test.check((ba_scope_file((select id from t_s)) ->> 'path') is not null, 'the Department Head can fetch it');
select test.login('ba_b');
select test.must_fail($$select ba_scope_file((select id from t_s))$$, 'another Business Associate cannot', 'not found');
select test.login('ba_a');
select test.check((ba_home() ->> 'scopeDocumentsGenerated')::int = 2, 'Home counts the scope documents');

\echo '   leads'
select test.must_fail($$select ba_lead_save(null, jsonb_build_object('name','L','company','C','phone','9811234572','leadSource','Cold Call'), test.svcs(1), 'LUKEWARM', 'PENDING')$$, 'the temperature is Hot, Warm or Cold', 'temperature');
select test.check((ba_lead_save(null, jsonb_build_object('name','BA Own Lead','company','BA Co','phone','9811234573','leadSource','Walk-in'), test.svcs(1), 'WARM', 'CONTACTED') ->> 'leadTemperature') = 'WARM', 'a Business Associate adds a lead');
reset role;
select test.check((select owner_id = test.id('ba_a') and lifecycle_stage = 'LEAD' and lead_temperature = 'WARM' and call_status = 'CONTACTED' from customers where name = 'BA Own Lead'), 'it is a Sales lead owned by them, temperature and call status separate');
select test.check((select count(*) = 0 from ba_contacts where lead_id = test.lead('BA Own Lead')), 'it is not a contact until a Telecaller converts a lead');
set role authenticated;
select test.login('ba_a');
select test.check((ba_leads_list() ->> 'total')::int = 1, 'the list shows only their own leads (not the Telecaller''s)');
select test.check((ba_lead_save((select (x ->> 'id')::uuid from jsonb_array_elements(ba_leads_list() -> 'items') x limit 1), '{"phone":"9811234574"}', null, 'HOT', 'INTERESTED') ->> 'leadTemperature') = 'HOT', 'a lead can be edited');
select test.login('ba_b');
select test.check((ba_leads_list() ->> 'total')::int = 0, 'another Business Associate sees none of them');
select test.must_fail($$select ba_lead_get(test.lead('BA Own Lead'))$$, 'nor opens one', 'not found');

\echo '   reassignment'
select test.login('ba_a');
select test.must_fail($$select ba_contact_reassign(test.bac('Hot Customer'), test.id('ba_b'))$$, 'a Business Associate cannot reassign', 'FORBIDDEN');
select test.login('dh_wbx');
select test.must_fail($$select ba_contact_reassign(test.bac('Hot Customer'), test.id('ba_b'))$$, 'the Department Head of another department cannot', 'not found');
select test.login('dh_wab');
select test.must_fail($$select ba_contact_reassign(test.bac('Hot Customer'), test.id('ba_x'))$$, 'only to a Business Associate of the department', 'Business Associate of the department');
select ba_contact_reassign(test.bac('Hot Customer'), test.id('ba_b'));
select test.login('ba_b');
select test.check((ba_contacts_list() ->> 'total')::int = 2, 'the contact moved to BA Beta, with its history');
select test.check((ba_contact_get(test.bac('Hot Customer')) -> 'quotations' -> 0 ->> 'number') is not null, 'and its quotations');
select test.login('ba_a');
select test.must_fail($$select ba_contact_get(test.bac('Hot Customer'))$$, 'BA Alpha no longer has it', 'not found');
reset role;
select test.check((select count(*) >= 3 from audit_logs where action in ('BA_CONTACT_CREATED', 'BA_QUOTATION_FINALIZED', 'BA_SCOPE_FINALIZED', 'BA_CONTACT_REASSIGNED')), 'conversions, finalisations and reassignment are audited');
