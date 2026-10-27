-- =============================================================================
-- Lead filters (migration 20261129000100): All Leads, My Leads, Department Leads, To Accounts, Returned by Accounts.
-- Runs after the Business Associate and payments suites (uses their Telecaller / Business Associate / Accounts users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- lead filters'
reset role;
create or replace function test.ls_id(p_name text) returns uuid language sql stable security definer set search_path = '' as $$ select id from public.customers where name = p_name $$;
create or replace function test.ls_count(p_scope text, p_who text) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.customers c where c.lifecycle_stage = 'LEAD' and (
    (p_scope = 'MINE' and c.owner_id = test.id(p_who))
    or (p_scope = 'DEPARTMENT' and c.owner_id <> test.id(p_who)
        and c.department_id = (select department_id from public.profiles where id = test.id(p_who))
        and exists (select 1 from public.teams t where t.id = c.team_id and t.department_id = c.department_id and t.division = 'SALES')))
$$;
grant execute on function test.ls_id(text), test.ls_count(text, text) to authenticated;
set role authenticated;

\echo '   fixtures: a lead for each Business Associate, the Telecaller and another department'
select test.login('ba_a');
select ba_lead_save(null, jsonb_build_object('name','LS Alpha','company','LS Alpha Co','phone','9811300001','leadSource','Walk-in','notes','alpha private note'), test.svcs(1), 'HOT', 'INTERESTED');
select test.login('ba_b');
select ba_lead_save(null, jsonb_build_object('name','LS Beta','company','LS Beta Co','phone','9811300002','leadSource','Referral','notes','beta private note'), test.svcs(1), 'WARM', 'CONTACTED');
select test.login('tc_a');
select telecaller_lead_save(null, jsonb_build_object('name','LS Tele','company','LS Tele Co','phone','9811300003','leadSource','Cold Call'), test.svcs(1), 'COLD', 'PENDING');
select test.login('ba_x');
select ba_lead_save(null, jsonb_build_object('name','LS Elsewhere','company','LS Else Co','phone','9811300004','leadSource','Walk-in'), test.svcs(1), 'HOT', 'INTERESTED');

\echo '   who may use the filters'
select test.login('tm_a');
select test.must_fail($$select lead_scope_counts()$$, 'a Sales member without a Sales role is refused', 'FORBIDDEN');
select test.must_fail($$select lead_scope_list('ALL')$$, 'and the list', 'FORBIDDEN');
select test.login('sup_plain');
select test.must_fail($$select lead_scope_counts()$$, 'a Support member is refused', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select lead_scope_list('ALL')$$, 'a Department Head is refused (they have their own Lead List)', 'FORBIDDEN');
select test.login('ba_a');
select test.must_fail($$select lead_scope_list('EVERYTHING')$$, 'an unknown filter is refused', 'Unknown lead filter');
select test.must_fail($$select lead_scope_list('ALL', null, null, 'WEIRD')$$, 'an unknown status is refused', 'Unknown lead status');

\echo '   what each filter shows'
select test.check((lead_scope_counts() ->> 'mine')::int = test.ls_count('MINE', 'ba_a'), 'My Leads counts the leads the Business Associate owns');
select test.check((lead_scope_counts() ->> 'department')::int = test.ls_count('DEPARTMENT', 'ba_a') and (lead_scope_counts() ->> 'department')::int >= 2, 'Department Leads counts the other people of the department''s Sales teams');
select test.check((lead_scope_counts() ->> 'all')::int = (lead_scope_counts() ->> 'mine')::int + (lead_scope_counts() ->> 'department')::int, 'All Leads is mine plus the department''s, nothing counted twice');
select test.check((lead_scope_list('ALL', null, null, null, 1, 100) ->> 'total')::int = (lead_scope_counts() ->> 'all')::int
               and jsonb_array_length(lead_scope_list('ALL', null, null, null, 1, 100) -> 'items') = (lead_scope_counts() ->> 'all')::int, 'the list shows as many rows as the count says');
select test.check((select count(distinct x ->> 'id') = count(*) from jsonb_array_elements(lead_scope_list('ALL', null, null, null, 1, 100) -> 'items') x), 'a lead appears once');
select test.check((select bool_and((x ->> 'isMine')::boolean) and count(*) = (lead_scope_counts() ->> 'mine')::int from jsonb_array_elements(lead_scope_list('MINE', null, null, null, 1, 100) -> 'items') x), 'My Leads holds only own leads');
select test.check((select bool_and(not (x ->> 'isMine')::boolean) and count(*) = (lead_scope_counts() ->> 'department')::int from jsonb_array_elements(lead_scope_list('DEPARTMENT', null, null, null, 1, 100) -> 'items') x), 'Department Leads holds only the colleagues'' leads');
select test.check((select count(*) = 1 from jsonb_array_elements(lead_scope_list('DEPARTMENT', 'LS Beta') -> 'items') x where x -> 'owner' ->> 'fullName' = 'BA Beta'), 'a colleague''s lead is there, with its owner');
select test.check((select count(*) = 0 from jsonb_array_elements(lead_scope_list('ALL', 'LS Elsewhere') -> 'items') x), 'another department''s lead is in no filter');
select test.check((select count(*) = 0 from jsonb_array_elements(lead_scope_list('DEPARTMENT', 'LS Alpha') -> 'items') x), 'my own lead is not among the department''s');
select test.check((select x ->> 'notes' = 'alpha private note' from jsonb_array_elements(lead_scope_list('MINE', 'LS Alpha') -> 'items') x), 'my own lead carries its notes');
select test.check((select not (x ? 'notes') or x ->> 'notes' is null from jsonb_array_elements(lead_scope_list('DEPARTMENT', 'LS Beta') -> 'items') x), 'a colleague''s lead carries no notes');
select test.check((lead_scope_list('ALL', 'ls ') ->> 'total')::int >= 3, 'search works (not case sensitive)');
select test.check((lead_scope_list('ALL', null, 'Referral') ->> 'total')::int >= 1 and (select bool_and(x ->> 'leadSource' = 'Referral') from jsonb_array_elements(lead_scope_list('ALL', null, 'Referral') -> 'items') x), 'the source filter works');
select test.check((lead_scope_list('ALL', null, null, null, 1, 2) -> 'items' -> 0 ->> 'id') is distinct from (lead_scope_list('ALL', null, null, null, 2, 2) -> 'items' -> 0 ->> 'id'), 'pagination moves through the list');
select test.check((lead_scope_list('ALL') -> 'statusCounts') is not null, 'the status counts of the filter are returned');
select test.login('tc_a');
select test.check((lead_scope_counts() ->> 'mine')::int = test.ls_count('MINE', 'tc_a') and (lead_scope_counts() ->> 'department')::int = test.ls_count('DEPARTMENT', 'tc_a'), 'a Telecaller gets the same filters over the same department');
select test.check((select count(*) = 1 from jsonb_array_elements(lead_scope_list('DEPARTMENT', 'LS Alpha') -> 'items') x), 'a Telecaller sees a Business Associate colleague''s lead (read-only)');
select test.login('ba_x');
select test.check((select count(*) = 0 from jsonb_array_elements(lead_scope_list('ALL', 'LS Alpha') -> 'items') x), 'a Business Associate of another department sees none of this department''s leads');
select test.check((lead_scope_counts() ->> 'department')::int = test.ls_count('DEPARTMENT', 'ba_x'), 'and their own department''s count is their own');

\echo '   the filters give read access only'
select test.login('ba_b');
select test.must_fail($$select telecaller_lead_save(test.ls_id('LS Alpha'), '{"phone":"9811300099"}', null, 'HOT', 'INTERESTED')$$, 'a colleague''s lead cannot be edited through the lead functions', 'not found|FORBIDDEN');
select test.must_fail($$select send_lead_to_accounts(test.ls_id('LS Alpha'), 5000, null)$$, 'nor sent to Accounts', 'not found');
select test.check(test.rows($$update customers set name = 'x' where id = test.ls_id('LS Alpha')$$) = 0, 'nor changed directly (no row is touched)');

\echo '   To Accounts and Returned by Accounts follow the Accounts workflow'
-- the department may already have leads at Accounts from the earlier suites: every check is against a baseline and the lead of this test
select test.login('ba_x');
select (lead_scope_counts() ->> 'toAccounts')::int as x_ta0, (lead_scope_counts() ->> 'returned')::int as x_rt0 \gset
select test.login('ba_b');
select (lead_scope_counts() ->> 'toAccounts')::int as b_ta0 \gset
select test.login('ba_a');
select (lead_scope_counts() ->> 'toAccounts')::int as ta0, (lead_scope_counts() ->> 'returned')::int as rt0 \gset
select test.check((select count(*) = 0 from jsonb_array_elements(lead_scope_list('TO_ACCOUNTS') -> 'items') x where x ->> 'name' = 'LS Alpha')
              and (select count(*) = 0 from jsonb_array_elements(lead_scope_list('RETURNED') -> 'items') x where x ->> 'name' = 'LS Alpha'), 'before it is sent, the lead is in neither Accounts filter');
select send_lead_to_accounts(test.ls_id('LS Alpha'), 5000, 'Customer wants to start this week');
select test.check((lead_scope_counts() ->> 'toAccounts')::int = :ta0 + 1 and (lead_scope_counts() ->> 'returned')::int = :rt0, 'a lead sent to Accounts is counted in To Accounts');
select test.check((select x -> 'accounts' ->> 'status' = 'PENDING' and (x -> 'accounts' ->> 'amount')::numeric = 5000 and x -> 'accounts' ->> 'submittedBy' = 'BA Alpha' and x -> 'accounts' ->> 'submittedAt' is not null
                      and x -> 'accounts' ->> 'salesNote' = 'Customer wants to start this week' and x ->> 'paymentWorkflow' = 'PENDING_PAYMENT_CONFIRMATION' and x ->> 'company' = 'LS Alpha Co' and x ->> 'phone' is not null and x -> 'services' is not null
                 from jsonb_array_elements(lead_scope_list('TO_ACCOUNTS', 'LS Alpha') -> 'items') x where x ->> 'name' = 'LS Alpha'), 'it shows who sent it, when, the amount and the verification status');
select test.check((select bool_and(x ->> 'paymentWorkflow' = 'PENDING_PAYMENT_CONFIRMATION') from jsonb_array_elements(lead_scope_list('TO_ACCOUNTS', null, null, null, 1, 100) -> 'items') x), 'To Accounts holds only leads that are waiting for Accounts');
select test.check((select count(*) = 1 from jsonb_array_elements(lead_scope_list('ALL', 'LS Alpha') -> 'items') x), 'the lead is also in All Leads (still one row)');
select test.check((select count(*) = 0 from jsonb_array_elements(lead_scope_list('RETURNED', 'LS Alpha') -> 'items') x), 'and not in Returned');
select test.login('ba_b');
select test.check((select count(*) = 1 from jsonb_array_elements(lead_scope_list('TO_ACCOUNTS', 'LS Alpha') -> 'items') x where x ->> 'name' = 'LS Alpha' and not (x ->> 'isMine')::boolean) and (lead_scope_counts() ->> 'toAccounts')::int = :b_ta0 + 1, 'a colleague sees it too, as a read-only row');
select test.login('ba_x');
select test.check((lead_scope_counts() ->> 'toAccounts')::int = :x_ta0 and (select count(*) = 0 from jsonb_array_elements(lead_scope_list('TO_ACCOUNTS', 'LS Alpha') -> 'items') x), 'another department does not');
select test.login('acc_m');
select accounts_return_to_leads(test.ls_id('LS Alpha'), 'GST number is missing');
select test.login('ba_a');
select test.check((lead_scope_counts() ->> 'toAccounts')::int = :ta0 and (lead_scope_counts() ->> 'returned')::int = :rt0 + 1, 'returned by Accounts: out of To Accounts, into Returned');
select test.check((select x -> 'accounts' ->> 'status' = 'RETURNED' and x -> 'accounts' ->> 'reason' = 'GST number is missing' and x -> 'accounts' ->> 'returnedBy' is not null and x -> 'accounts' ->> 'returnedAt' is not null
                      and x -> 'owner' ->> 'fullName' = 'BA Alpha' and x ->> 'paymentWorkflow' = 'RETURNED_FROM_ACCOUNTS' and x -> 'accounts' ->> 'submittedBy' = 'BA Alpha'
                 from jsonb_array_elements(lead_scope_list('RETURNED', 'LS Alpha') -> 'items') x where x ->> 'name' = 'LS Alpha'), 'it shows who returned it, when, why, and who is responsible');
select test.check((select bool_and(x ->> 'paymentWorkflow' = 'RETURNED_FROM_ACCOUNTS') from jsonb_array_elements(lead_scope_list('RETURNED', null, null, null, 1, 100) -> 'items') x), 'Returned by Accounts holds only leads Accounts returned');
select test.check((select count(*) = 1 from jsonb_array_elements(lead_scope_list('MINE', 'LS Alpha') -> 'items') x where x ->> 'leadStatus' = 'INTERESTED'), 'its lead status is the one the return set (follow-up needed)');
select send_lead_to_accounts(test.ls_id('LS Alpha'), 5500, 'GST added');
select test.check((lead_scope_counts() ->> 'toAccounts')::int = :ta0 + 1 and (lead_scope_counts() ->> 'returned')::int = :rt0, 'resubmitted: out of Returned, back in To Accounts');
select test.check((select (x -> 'accounts' ->> 'amount')::numeric = 5500 and x -> 'accounts' ->> 'returnedBy' is null from jsonb_array_elements(lead_scope_list('TO_ACCOUNTS', 'LS Alpha') -> 'items') x where x ->> 'name' = 'LS Alpha'), 'the new submission is shown (the earlier one stays in the history)');
reset role;
select test.check((select count(*) = 2 from payment_requests where customer_id = test.ls_id('LS Alpha')), 'both submissions are kept');
select test.check((select count(*) >= 1 from customer_activities where customer_id = test.ls_id('LS Alpha') and type = 'RETURNED_FROM_ACCOUNTS'), 'the return is in the lead''s history');
set role authenticated;
select test.login('acc_m');
select accounts_record_payment(test.ls_id('LS Alpha'), 'FULL', 5500, 'UPI', 'UTR-LS-1', null, null, false);
select accounts_verify_payment((select (p ->> 'id')::uuid from jsonb_array_elements(customer_payment_overview(test.ls_id('LS Alpha')) -> 'payments') p where p ->> 'status' = 'PENDING' limit 1), null);
select accounts_confirm_and_return(test.ls_id('LS Alpha'), 'Received');
select test.login('ba_a');
select test.check((lead_scope_counts() ->> 'toAccounts')::int = :ta0 and (lead_scope_counts() ->> 'returned')::int = :rt0, 'confirmed by Accounts: gone from the active Accounts queue');
select test.check((select count(*) = 0 from jsonb_array_elements(lead_scope_list('ALL', 'LS Alpha') -> 'items') x), 'and no longer a lead (it moved on in the pipeline)');
select test.check((lead_scope_counts() ->> 'all')::int = (lead_scope_counts() ->> 'mine')::int + (lead_scope_counts() ->> 'department')::int, 'the counts still add up');
reset role;
