-- =============================================================================
-- The member's own contact number is separate from the emergency contact (migration 20261206000200): stored normalised, readable by HR / the
-- Super Admin and the person themselves only, correctable by HR / the Super Admin without touching the other number. Uses users of hr_test.sql.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
reset role;
\echo '--- member contact number'
insert into employee_personal_details (profile_id, designation, emergency_contact) values (test.id('tm_d1'), 'Team Member', '+91 98765 00000')
  on conflict (profile_id) do update set emergency_contact = excluded.emergency_contact, contact_number = null;
select test.must_fail($$update employee_personal_details set contact_number = '98765 43210' where profile_id = test.id('tm_d1')$$, 'a stored contact number must carry its country code', 'check constraint');
select test.must_fail($$update employee_personal_details set contact_number = '+0123456789' where profile_id = test.id('tm_d1')$$, 'and not start with 0', 'check constraint');
select test.must_fail($$update employee_personal_details set contact_number = '+12345' where profile_id = test.id('tm_d1')$$, 'nor be too short', 'check constraint');

set role authenticated;
select test.login('hr_head');
select test.check((select (hr_update_member_contacts(test.id('tm_d1'), '+919811122233', null)) ->> 'contactNumber' = '+919811122233'), 'HR sets the member''s own number');
reset role;
select test.check((select emergency_contact = '+91 98765 00000' and contact_number = '+919811122233' from employee_personal_details where profile_id = test.id('tm_d1')), 'the emergency contact was not touched');
set role authenticated;
select test.login('hr_head');
select test.check((select (hr_update_member_contacts(test.id('tm_d1'), null, '+91 98100 11122')) ->> 'emergencyContact' = '+91 98100 11122'), 'HR corrects the emergency number alone');
reset role;
select test.check((select contact_number = '+919811122233' from employee_personal_details where profile_id = test.id('tm_d1')), 'and the member''s own number stays');
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_update_member_contacts(test.id('tm_d1'), '9811122233', null)$$, 'a number without a country code is refused by the database', 'country code');
select test.must_fail($$select hr_update_member_contacts(test.id('tm_d1'), '', null)$$, 'a number cannot be cleared by accident', 'cannot be cleared');
select test.must_fail($$select hr_update_member_contacts(test.id('tm_d1'), null, 'call me')$$, 'a bad emergency number is refused', 'emergency contact');
select test.must_fail($$select hr_update_member_contacts(test.id('tm_d1'), '+919810011122', null)$$, 'the two numbers cannot be the same', 'different number');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_personal_details()) d where d ->> 'contactNumber' = '+919811122233' and d ->> 'emergencyContact' = '+91 98100 11122'), 'HR reads both numbers, separate');
select test.login('tm_d1');
select test.check((select my_personal_details() ->> 'contactNumber' = '+919811122233' and my_personal_details() ->> 'emergencyContact' = '+91 98100 11122'), 'the member reads their own two numbers');
select test.must_fail($$select hr_personal_details()$$, 'but not other people''s', 'Only HR staff');
select test.must_fail($$select hr_update_member_contacts(test.id('tm_d1'), '+919811122244', null)$$, 'a member cannot change their own numbers through this function', 'Only HR staff');
select test.login('tm_a');
select test.check((select my_personal_details() ->> 'contactNumber' is null), 'another employee sees only their own (none here)');
select test.must_fail($$select hr_update_member_contacts(test.id('tm_d1'), '+919811122244', null)$$, 'an ordinary employee cannot change anybody''s numbers', 'Only HR staff');
select test.must_fail($$select * from employee_personal_details$$, 'the table cannot be read directly', 'permission denied');
reset role;
\echo '=== ALL MEMBER CONTACT TESTS PASSED ==='
