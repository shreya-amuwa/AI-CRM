-- =============================================================================
-- Post-meeting summaries and the CEO's Meeting Decisions (migration 20270124000200).
-- Synthetic departments ms-a (Sales + Support teams) and ms-b (Sales), with Operations Heads, Department Heads, Team Leads and Team Members.
-- Meetings are written straight into the table (past times), as the calendar would have them after they took place.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 140. Meeting summaries: who writes them, who reads them, the lifecycle and the CEO reports'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270124000200_meeting_summaries.sql
\i supabase/migrations/20270124000200_meeting_summaries.sql

delete from meetings where title like 'MS %';
delete from notifications where type like 'MEETING_SUMMARY%' or type = 'MEETING_ACTION_ASSIGNED';
delete from auth.users where email like 'ms.%@example.com';
delete from test.users where name like 'ms\_%';
delete from teams where department_id in (select id from departments where slug like 'ms-%');
delete from departments where slug like 'ms-%';
insert into departments (slug, name) values ('ms-a', 'MS Alpha'), ('ms-b', 'MS Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug in ('ms-a', 'ms-b');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug = 'ms-a';

create or replace function test.msmk(p_name text, p_role text, p_dept text, p_division text default null, p_team text default null, p_ops boolean default false)
returns uuid language sql as $$
  select test.create_auth_user(p_name, 'ms.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'MS ' || substr(p_name, 4)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', case when p_team is null then test.dept(p_dept) end,
      'provisioned_team_id', case when p_team is not null then test.team(p_dept, p_team) end,
      'provisioned_head_division', p_division, 'provisioned_operations_head', case when p_ops then true end))) $$;
-- a meeting that took place: p_ago hours ago, one hour long, everybody invited
create or replace function test.msmeet(p_title text, p_host text, p_invited text[], p_kind text default 'MEETING', p_ago integer default 2)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v uuid;
  n text;
begin
  insert into public.meetings (kind, title, description, host_id, created_by, starts_at, ends_at, status, booked_via, google_sync_status)
  values (p_kind, p_title, 'Agenda of ' || p_title, test.id(p_host), test.id(p_host), now() - make_interval(hours => p_ago),
          now() - make_interval(hours => p_ago) + interval '1 hour', 'SCHEDULED', 'STAFF', 'SKIPPED')
  returning id into v;
  foreach n in array p_invited loop
    insert into public.meeting_attendees (meeting_id, profile_id, role, response) values (v, test.id(n), 'REQUIRED', 'ACCEPTED');
  end loop;
  return v;
end $$;
create or replace function test.msid(p_title text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.meetings where title = p_title $$;
create or replace function test.ids(p text[]) returns uuid[] language sql stable as $$ select array_agg(test.id(x)) from unnest(p) x $$;
create or replace function test.mssum(p_title text) returns public.meeting_summaries language sql stable security definer set search_path = '' as $$
  select s.* from public.meeting_summaries s join public.meetings m on m.id = s.meeting_id where m.title = p_title $$;
create or replace function test.msdec(p_title text) returns uuid language sql stable security definer set search_path = '' as $$
  select d.id from public.meeting_summary_decisions d join public.meeting_summaries s on s.id = d.summary_id join public.meetings m on m.id = s.meeting_id
   where m.title = p_title order by d.position limit 1 $$;
create or replace function test.msact(p_title text) returns uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.meeting_summary_actions a join public.meeting_summaries s on s.id = a.summary_id join public.meetings m on m.id = s.meeting_id
   where m.title = p_title order by a.position limit 1 $$;
create or replace function test.msver(p_title text) returns integer language sql stable security definer set search_path = '' as $$
  select (test.mssum(p_title)).version $$;
-- a complete summary (keys fixed so a retry is the same content)
create or replace function test.msbody(p_assignee uuid, p_extra jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'executiveSummary', 'Reviewed the weekly Sales performance, identified delayed lead follow-ups and agreed on a daily review.',
    'discussionPoints', jsonb_build_array('Weekly sales performance', 'Lead conversion rates'),
    'decisions', jsonb_build_array(jsonb_build_object('key', '00000000-0000-4000-8000-000000000001', 'title', 'Daily lead follow-up review',
        'description', 'Every Sales Team Lead reviews pending follow-ups at the start and end of the day.')),
    'actions', jsonb_build_array(jsonb_build_object('key', '00000000-0000-4000-8000-000000000002', 'title', 'Review pending November leads',
        'assigneeId', p_assignee, 'dueDate', to_char(current_date + 3, 'YYYY-MM-DD'), 'priority', 'HIGH', 'status', 'PENDING',
        'decisionKey', '00000000-0000-4000-8000-000000000001')),
    'blockers', jsonb_build_array(jsonb_build_object('key', '00000000-0000-4000-8000-000000000003', 'category', 'CEO_DECISION',
        'description', 'Budget for two more callers needs the CEO''s approval.', 'needsCeoAttention', true)),
    'nextSteps', 'Track the daily review for two weeks.') || p_extra $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   people'
select test.msmk('ms_ops', 'DEPARTMENT_HEAD', 'ms-a', 'SALES', null, true);
select test.msmk('ms_ops2', 'DEPARTMENT_HEAD', 'ms-a', 'SALES', null, true);
select test.msmk('ms_opp', 'DEPARTMENT_HEAD', 'ms-a', 'SUPPORT', null, true);
select test.msmk('ms_dhs', 'DEPARTMENT_HEAD', 'ms-a', 'SALES');
select test.msmk('ms_dhp', 'DEPARTMENT_HEAD', 'ms-a', 'SUPPORT');
select test.msmk('ms_dhb', 'DEPARTMENT_HEAD', 'ms-b');
select test.msmk('ms_tls', 'TEAM_HEAD', 'ms-a', null, 'Sales');
select test.msmk('ms_tlp', 'TEAM_HEAD', 'ms-a', null, 'Support');
select test.msmk('ms_m1', 'TEAM_MEMBER', 'ms-a', null, 'Sales');
select test.msmk('ms_m2', 'TEAM_MEMBER', 'ms-a', null, 'Sales');
select test.msmk('ms_m3', 'TEAM_MEMBER', 'ms-a', null, 'Sales');
select test.msmk('ms_mp', 'TEAM_MEMBER', 'ms-a', null, 'Support');
select test.msmk('ms_mb', 'TEAM_MEMBER', 'ms-b', null, 'Sales');
set role authenticated;
select test.login('sa');
select operations_head_assign_new(test.id('ms_ops'), array[test.dept('ms-a')]);
select operations_head_assign_new(test.id('ms_ops2'), array[test.dept('ms-a')]);
select operations_head_assign_new(test.id('ms_opp'), array[test.dept('ms-a')]);
reset role;
select test.check((select count(*) = 13 from profiles where id in (select id from test.users where name like 'ms\_%') and status = 'ACTIVE'), 'the people exist');
select test.check(private.mms_rank(test.id('ms_ops')) = 3 and private.mms_rank(test.id('ms_dhs')) = 2 and private.mms_rank(test.id('ms_tls')) = 1
                  and private.mms_rank(test.id('ms_m1')) = 0 and private.mms_rank(test.id('sa')) = 4, 'ranks: CEO > Operations Head > Department Head > Team Lead > member');
select test.check(private.mms_covers(test.id('ms_ops'), test.id('ms_m1')) and not private.mms_covers(test.id('ms_opp'), test.id('ms_m1'))
                  and not private.mms_covers(test.id('ms_dhb'), test.id('ms_m1')) and private.mms_covers(test.id('ms_tls'), test.id('ms_m1'))
                  and not private.mms_covers(test.id('ms_tls'), test.id('ms_mp')),
  'scopes: the Sales Operations Head leads Sales, not Support; a Team Lead only their team');

-- the meetings (all in the past)
select test.msmeet('MS A weekly', 'ms_dhs', array['ms_ops', 'ms_tls', 'ms_m1', 'ms_m2', 'ms_m3']);
select test.msmeet('MS B department', 'ms_dhs', array['ms_tls', 'ms_m1', 'ms_m2']);
select test.msmeet('MS C team', 'ms_tls', array['ms_m1', 'ms_m2']);
select test.msmeet('MS D two heads', 'ms_dhs', array['ms_ops', 'ms_ops2', 'ms_m1']);
select test.msmeet('MS E no-show', 'ms_dhs', array['ms_ops', 'ms_tls', 'ms_m1']);
select test.msmeet('MS F suspended', 'ms_tls', array['ms_m1', 'ms_m2']);
select test.msmeet('MS G cross', 'ms_tls', array['ms_opp', 'ms_m1', 'ms_mb']);
select test.msmeet('MS H members', 'ms_m1', array['ms_m2', 'ms_m3']);
select test.msmeet('MS I overdue', 'ms_tls', array['ms_m1'], 'MEETING', 30);
select test.msmeet('MS J appointment', 'ms_tls', array['ms_m1'], 'APPOINTMENT');
select test.check((select count(*) = 9 from meeting_summaries s join meetings m on m.id = s.meeting_id where m.title like 'MS %'),
  'every internal team meeting gets its (pending) summary row; the appointment does not');
select test.check((test.mssum('MS A weekly')).status = 'PENDING' and (test.mssum('MS A weekly')).owner_id is null,
  'before attendance is confirmed nobody is responsible yet');

\echo '   attendance: only the organiser, only invited colleagues'
set role authenticated;
select test.login('ms_m1');
select test.must_fail($$select mms_confirm_attendance(test.msid('MS A weekly'), test.ids(array['ms_m1']))$$, 'an attendee cannot confirm attendance', 'FORBIDDEN');
select test.login('ms_dhs');
select test.must_fail($$select mms_confirm_attendance(test.msid('MS A weekly'), test.ids(array['ms_dhb']))$$, 'someone not invited cannot be marked present', 'VALIDATION_ERROR');
select test.must_fail($$select mms_confirm_attendance(test.msid('MS A weekly'), '{}')$$, 'at least one person attended', 'VALIDATION_ERROR');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1')), true, test.msver('MS A weekly'))$$,
  'nothing can be submitted before attendance is confirmed', 'FORBIDDEN');

\echo '   1. Operations Head + Department Head + Team Lead -> the Operations Head'
select mms_confirm_attendance(test.msid('MS A weekly'), test.ids(array['ms_dhs', 'ms_ops', 'ms_tls', 'ms_m1', 'ms_m2', 'ms_m3']));
select test.check((test.mssum('MS A weekly')).owner_id = test.id('ms_ops') and (test.mssum('MS A weekly')).owner_method = 'SENIORITY',
  'the Operations Head who attended owns the summary');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ms_ops') and type = 'MEETING_SUMMARY_PENDING'
                    and entity_id = test.msid('MS A weekly')), 'the Operations Head is told the summary is pending');
select test.check((select count(*) = 6 from meeting_summary_attendance a where a.meeting_id = test.msid('MS A weekly') and a.attended
                    and a.confirmed_by = test.id('ms_dhs')), 'attendance is recorded per person with who confirmed it');
select test.check((select count(*) = 1 from audit_logs where action = 'MEETING_ATTENDANCE_CONFIRMED' and entity_id = test.msid('MS A weekly')),
  'and audited');

\echo '   2. Department Head + Team Lead -> the Department Head;  3. Team Lead + members -> the Team Lead'
set role authenticated;
select test.login('ms_dhs');
select mms_confirm_attendance(test.msid('MS B department'), test.ids(array['ms_dhs', 'ms_tls', 'ms_m1', 'ms_m2']));
select test.login('ms_tls');
select mms_confirm_attendance(test.msid('MS C team'), test.ids(array['ms_tls', 'ms_m1', 'ms_m2']));
reset role;
select test.check((test.mssum('MS B department')).owner_id = test.id('ms_dhs'), 'without an Operations Head the Department Head owns it');
select test.check((test.mssum('MS C team')).owner_id = test.id('ms_tls'), 'a Team Lead with their members owns it');

\echo '   4. two Operations Heads -> an organiser picks one of them'
set role authenticated;
select test.login('ms_dhs');
select mms_confirm_attendance(test.msid('MS D two heads'), test.ids(array['ms_dhs', 'ms_ops', 'ms_ops2', 'ms_m1']));
reset role;
select test.check((test.mssum('MS D two heads')).owner_id is null and (test.mssum('MS D two heads')).owner_method = 'SELECTION_REQUIRED'
                  and (test.mssum('MS D two heads')).selection_candidates @> test.ids(array['ms_ops', 'ms_ops2']),
  'neither hosted it: nobody is picked arbitrarily, a selection is required among the two');
set role authenticated;
select test.login('ms_dhs');
select test.must_fail($$select mms_assign_owner(test.msid('MS D two heads'), test.id('ms_m1'))$$, 'a non-candidate cannot be selected', 'FORBIDDEN');
select test.login('ms_m1');
select test.must_fail($$select mms_assign_owner(test.msid('MS D two heads'), test.id('ms_ops2'))$$, 'a member cannot pick', 'FORBIDDEN');
select test.login('ms_dhs');
select mms_assign_owner(test.msid('MS D two heads'), test.id('ms_ops2'), 'Leads the follow-ups');
reset role;
select test.check((test.mssum('MS D two heads')).owner_id = test.id('ms_ops2') and (test.mssum('MS D two heads')).owner_method = 'SELECTED'
                  and (test.mssum('MS D two heads')).owner_assigned_by = test.id('ms_dhs'), 'the selection is recorded: who, by whom');
-- the host breaks the tie when the host is one of them
select test.msmeet('MS D2 host tie', 'ms_ops', array['ms_ops2', 'ms_m1']);
set role authenticated;
select test.login('ms_ops');
select mms_confirm_attendance(test.msid('MS D2 host tie'), test.ids(array['ms_ops', 'ms_ops2', 'ms_m1']));
reset role;
select test.check((test.mssum('MS D2 host tie')).owner_id = test.id('ms_ops') and (test.mssum('MS D2 host tie')).owner_method = 'HOST',
  'two Operations Heads, one of them the host: the host');

\echo '   5. an invited Operations Head who did not attend is never responsible'
set role authenticated;
select test.login('ms_dhs');
select mms_confirm_attendance(test.msid('MS E no-show'), test.ids(array['ms_dhs', 'ms_tls', 'ms_m1']));
reset role;
select test.check((test.mssum('MS E no-show')).owner_id = test.id('ms_dhs'), 'invited but absent: the Department Head who attended owns it');

\echo '   6. a suspended owner: responsibility is transferred, with a reason'
set role authenticated;
select test.login('ms_tls');
select mms_confirm_attendance(test.msid('MS F suspended'), test.ids(array['ms_tls', 'ms_m1', 'ms_m2']));
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('ms_tls');
set role authenticated;
select test.login('ms_tls');
select test.must_fail($$select mms_save(test.msid('MS F suspended'), test.msbody(test.id('ms_m1')), true, test.msver('MS F suspended'))$$,
  'a suspended employee cannot submit', 'FORBIDDEN');
select test.login('ms_dhs');
select test.must_fail($$select mms_assign_owner(test.msid('MS F suspended'), test.id('ms_dhs'))$$, 'a transfer needs a reason', 'VALIDATION_ERROR');
select test.must_fail($$select mms_assign_owner(test.msid('MS F suspended'), test.id('ms_dhb'), 'covering')$$,
  'not to a leader of an unrelated department', 'FORBIDDEN');
select mms_assign_owner(test.msid('MS F suspended'), test.id('ms_dhs'), 'The Team Lead is suspended');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('ms_tls');
select test.check((test.mssum('MS F suspended')).owner_id = test.id('ms_dhs') and (test.mssum('MS F suspended')).owner_method = 'TRANSFERRED'
                  and (test.mssum('MS F suspended')).owner_reason = 'The Team Lead is suspended', 'transferred to the Department Head, reason kept');

\echo '   7. cross-department: a Support Operations Head who sat in a Sales meeting is not made responsible'
set role authenticated;
select test.login('ms_tls');
select mms_confirm_attendance(test.msid('MS G cross'), test.ids(array['ms_tls', 'ms_opp', 'ms_m1', 'ms_mb']));
reset role;
select test.check((test.mssum('MS G cross')).owner_id = test.id('ms_tls'),
  'the Sales Team Lead (who leads someone there) owns it, not the more senior Support Operations Head who leads nobody there');

\echo '   8. no leader attended: the organiser drafts and routes it to a leader of the attendees'
set role authenticated;
select test.login('ms_m1');
select mms_confirm_attendance(test.msid('MS H members'), test.ids(array['ms_m1', 'ms_m2', 'ms_m3']));
reset role;
select test.check((test.mssum('MS H members')).owner_id is null and (test.mssum('MS H members')).owner_method = 'NO_LEADER', 'no leader is invented');
set role authenticated;
select test.login('ms_m1');
select mms_save(test.msid('MS H members'), jsonb_build_object('executiveSummary', 'Draft by the organiser'), false, test.msver('MS H members'));
select test.must_fail($$select mms_save(test.msid('MS H members'), test.msbody(test.id('ms_m1')), true, test.msver('MS H members'))$$,
  'the organiser (a member) cannot submit it', 'FORBIDDEN');
select test.must_fail($$select mms_assign_owner(test.msid('MS H members'), test.id('ms_tlp'), 'route')$$,
  'nor route it to a leader who leads none of the attendees', 'FORBIDDEN');
select mms_assign_owner(test.msid('MS H members'), test.id('ms_tls'), 'Our Team Lead reports for us');
reset role;
select test.check((test.mssum('MS H members')).owner_id = test.id('ms_tls') and (test.mssum('MS H members')).owner_method = 'ROUTED'
                  and (test.mssum('MS H members')).status = 'DRAFT' and (test.mssum('MS H members')).executive_summary = 'Draft by the organiser',
  'routed to the Team Lead with the draft kept');
select test.check((select count(*) = 1 from meeting_summary_events e where e.summary_id = (test.mssum('MS H members')).id and e.kind = 'OWNER_ROUTED'),
  'the routing is in the history');

\echo '   writing: validation, draft, submit'
set role authenticated;
select test.login('ms_tls');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1')), false, test.msver('MS A weekly'))$$,
  'a Team Lead cannot edit the Operations Head''s report', 'FORBIDDEN');
select test.login('ms_m1');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1')), true, test.msver('MS A weekly'))$$,
  'a Team Member cannot submit a leader''s summary', 'FORBIDDEN');
select test.login('ms_ops');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1'), '{"executiveSummary": "   "}'), true, test.msver('MS A weekly'))$$,
  'a blank executive summary is refused', 'executive summary');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1'), '{"executiveSummary": "ok ok ok ok ok ok ok ok ok"}'), true, test.msver('MS A weekly'))$$,
  'so is one without meaningful text', 'executive summary');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1'), '{"decisions": []}'), true, test.msver('MS A weekly'))$$,
  'no decisions without saying "No decisions were made"', 'No decisions');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1'), '{"blockers": []}'), true, test.msver('MS A weekly'))$$,
  'no blockers without saying "No blockers"', 'No blockers');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_mb')), true, test.msver('MS A weekly'))$$,
  'an action item cannot go to someone in an unrelated department', 'FORBIDDEN');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_mp')), true, test.msver('MS A weekly'))$$,
  'nor to the Support side for a Sales Operations Head', 'FORBIDDEN');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1')), true, test.msver('MS A weekly') - 1)$$,
  'a stale version is a conflict', 'CONFLICT');
select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1')), false, test.msver('MS A weekly'));
reset role;
select test.check((test.mssum('MS A weekly')).status = 'DRAFT' and (select status from meetings where title = 'MS A weekly') = 'SCHEDULED',
  'a draft is saved; the meeting is not completed by a draft');
set role authenticated;
select test.login('ms_dhs');
select test.must_fail($$select mtg_complete(test.msid('MS A weekly'))$$, 'the host''s plain "Mark done" no longer completes a team meeting without its summary', 'summary');
select test.login('ms_ops');
select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1')), true, test.msver('MS A weekly'));
reset role;
select test.check((test.mssum('MS A weekly')).status = 'SUBMITTED' and (test.mssum('MS A weekly')).revision_no = 1
                  and (select status from meetings where title = 'MS A weekly') = 'COMPLETED', 'submitted: the meeting is completed in the same step');
select test.check((select count(*) = 1 from meeting_summaries where meeting_id = test.msid('MS A weekly'))
                  and (select count(*) = 1 from meeting_summary_decisions d where d.summary_id = (test.mssum('MS A weekly')).id)
                  and (select count(*) = 1 from meeting_summary_actions d where d.summary_id = (test.mssum('MS A weekly')).id)
                  and (select count(*) = 1 from meeting_summary_revisions r where r.summary_id = (test.mssum('MS A weekly')).id),
  'one summary for the meeting, one decision, one action item, one revision');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_SUMMARY_SUBMITTED'
                    and entity_type = 'meeting_summary' and entity_id = test.msid('MS A weekly')), 'the CEO is told, with a link to the report');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ms_m1') and type = 'MEETING_ACTION_ASSIGNED'),
  'the assignee is told about the action item');
set role authenticated;
select test.login('ms_ops');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1')), true, test.msver('MS A weekly') - 1)$$,
  'submitting the same form again (old version) is refused', 'CONFLICT');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1')), false, test.msver('MS A weekly'))$$,
  'no draft over a submitted report', 'amendment');
reset role;
select test.check((select count(*) = 1 from meeting_summary_decisions d where d.summary_id = (test.mssum('MS A weekly')).id)
                  and (select count(*) = 1 from meeting_summary_revisions r where r.summary_id = (test.mssum('MS A weekly')).id),
  'the retry created nothing');
set role authenticated;
select test.login('ms_dhs');
select test.must_fail($$select mms_confirm_attendance(test.msid('MS A weekly'), test.ids(array['ms_dhs']))$$,
  'attendance cannot change after submission', 'CONFLICT');

\echo '   who reads the report'
select test.login('ms_m1');
select test.check((mms_get(test.msid('MS A weekly')) -> 'summary' ->> 'canRead')::boolean, 'a member who attended reads the submitted report');
select test.login('ms_m3');
select test.check((mms_get(test.msid('MS A weekly')) -> 'summary' -> 'content' ->> 'executiveSummary') like 'Reviewed%', '... every attendee');
select test.login('ms_dhs');
select test.check((mms_get(test.msid('MS A weekly')) -> 'summary' ->> 'canRead')::boolean, 'the Department Head reads it');
select test.login('ms_dhb');
select test.must_fail($$select mms_get(test.msid('MS A weekly'))$$, 'a Department Head of another department cannot', 'NOT_FOUND');
select test.login('ms_opp');
select test.must_fail($$select mms_get(test.msid('MS A weekly'))$$, 'the Support Operations Head cannot read the Sales report', 'NOT_FOUND');
select test.check((select (mms_list('TEAM', 'ALL') -> 'items') @> jsonb_build_array(jsonb_build_object('title', 'MS A weekly'))) is not true,
  '... nor see it in their team list');
select test.login('ms_mp');
select test.must_fail($$select mms_get(test.msid('MS A weekly'))$$, 'a member who was not there cannot', 'NOT_FOUND');
select test.must_fail($$select mms_get(gen_random_uuid())$$, 'a guessed id finds nothing', 'NOT_FOUND');
select test.login('ms_dhs');
select test.check((mms_list('TEAM', 'SUBMITTED') -> 'items') @> jsonb_build_array(jsonb_build_object('title', 'MS A weekly')),
  'the Department Head sees it in their team''s list');
select test.check((mms_get(test.msid('MS B department')) -> 'summary' ->> 'canRead')::boolean, 'an organiser reads the draft of their meeting');
select test.login('ms_tls');
select test.check(not coalesce((mms_get(test.msid('MS B department')) -> 'summary' ->> 'canRead')::boolean, false),
  'an attendee does not read the Department Head''s unsubmitted draft');

\echo '   amendments keep the history'
select test.login('ms_ops');
select test.must_fail($$select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m1')), true, test.msver('MS A weekly'))$$,
  'an amendment says what changed', 'what changed');
select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m2'), '{"nextSteps": "Track for three weeks."}'), true, test.msver('MS A weekly'), 'Longer tracking');
reset role;
select test.check((test.mssum('MS A weekly')).status = 'REVISED' and (test.mssum('MS A weekly')).revision_no = 2
                  and (select count(*) = 2 from meeting_summary_revisions r where r.summary_id = (test.mssum('MS A weekly')).id)
                  and (select snapshot ->> 'nextSteps' = 'Track the daily review for two weeks.' from meeting_summary_revisions r
                        where r.summary_id = (test.mssum('MS A weekly')).id and r.revision_no = 1),
  'revised: the original submission is kept as revision 1');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_SUMMARY_REVISED'),
  'the CEO is told the report changed');
select test.must_fail($$update meeting_summary_revisions set change_note = 'x'$$, 'revisions cannot be edited', 'cannot be changed');

\echo '   the CEO: reports, clarification, follow-up'
set role authenticated;
select test.login('ms_ops');
select test.must_fail($$select mms_reports('{}'::jsonb)$$, 'an Operations Head cannot open the CEO reports', 'FORBIDDEN');
select test.must_fail($$select mms_report(test.msid('MS A weekly'))$$, 'nor a CEO report view', 'FORBIDDEN');
select test.must_fail($$select mms_clarify(test.msid('MS A weekly'), 'Why?')$$, 'nor ask for a clarification', 'FORBIDDEN');
select test.login('sa');
select test.check((mms_report(test.msid('MS A weekly')) -> 'summary' -> 'content' -> 'decisions' -> 0 ->> 'title') = 'Daily lead follow-up review',
  'the CEO reads the report, though not invited');
select test.check(not (mms_report(test.msid('MS A weekly')) -> 'meeting' ? 'meetLink') and not (mms_report(test.msid('MS A weekly'))::text like '%@%'),
  'without the meeting link or anyone''s e-mail');
select test.check((select (r -> 'items') @> jsonb_build_array(jsonb_build_object('title', 'MS A weekly', 'status', 'REVISED'))
                   from mms_reports(jsonb_build_object('status', 'SUBMITTED', 'departmentId', test.dept('ms-a'))) r),
  'the report list filters by status and department (on the server)');
select test.check((select (r -> 'items') @> jsonb_build_array(jsonb_build_object('title', 'MS A weekly'))
                   from mms_reports(jsonb_build_object('attention', true)) r), 'and "requires CEO attention"');
select test.check((select jsonb_array_length(r -> 'items') = 0 from mms_reports(jsonb_build_object('departmentId', test.dept('ms-b'))) r),
  'nothing of ms-b');
select test.check((select (o ->> 'submitted')::int >= 1 and (o ->> 'decisions')::int >= 1 and (o ->> 'openActions')::int >= 1 and (o ->> 'attention')::int >= 1
                   from mms_reports_overview(jsonb_build_object('from', current_date - 7, 'to', current_date)) o), 'the overview counts real records');
select mms_clarify(test.msid('MS A weekly'), 'Which budget line pays the callers?');
select test.check((mms_report(test.msid('MS A weekly')) -> 'summary' ->> 'status') = 'REVISION_REQUESTED', 'clarification requested');
select test.check((mms_report(test.msid('MS A weekly')) -> 'summary' -> 'content' ->> 'nextSteps') = 'Track for three weeks.',
  'the question does not change the report');
select mms_flag(test.msid('MS A weekly'), 'DECISION', test.msdec('MS A weekly'), true, 'Check in two weeks');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ms_ops') and type = 'MEETING_SUMMARY_CLARIFICATION'),
  'the owner is told about the question');
select test.check((select ceo_follow_up from meeting_summary_decisions where summary_id = (test.mssum('MS A weekly')).id), 'the decision is marked for follow-up');
set role authenticated;
select test.login('ms_ops');
select mms_reply(test.msid('MS A weekly'), 'The marketing budget.');
select mms_save(test.msid('MS A weekly'), test.msbody(test.id('ms_m2'), '{"nextSteps": "Track for three weeks, paid from marketing."}'), true,
  test.msver('MS A weekly'), 'Answered the budget question');
reset role;
select test.check((test.mssum('MS A weekly')).status = 'REVISED' and (test.mssum('MS A weekly')).revision_no = 3
                  and (select count(*) = 3 from meeting_summary_comments c where c.summary_id = (test.mssum('MS A weekly')).id),
  'answered and revised; question, follow-up mark and answer are all kept');

\echo '   action items'
set role authenticated;
select test.login('ms_m2');
select mms_action_update(test.msact('MS A weekly'), 'IN_PROGRESS', 'Started');
select test.check((select jsonb_array_length(mms_my_actions()) >= 1), 'the assignee sees their action items');
select test.login('ms_m3');
select test.must_fail($$select mms_action_update(test.msact('MS A weekly'), 'DONE')$$,
  'someone else cannot update it', 'NOT_FOUND');
select test.login('sa');
select test.check((select (r -> 'items' -> 0 ->> 'status') = 'IN_PROGRESS' from mms_report_actions(jsonb_build_object('departmentId', test.dept('ms-a'))) r),
  'the CEO sees the update');

\echo '   overdue, reminders once'
reset role;
select test.check(private.mms_overdue(test.mssum('MS I overdue'), (select m from meetings m where title = 'MS I overdue')),
  'not submitted 24 hours after the meeting: overdue');
select test.check(not private.mms_overdue(test.mssum('MS C team'), (select m from meetings m where title = 'MS C team')), 'two hours after: not yet');
set role service_role;
select mms_sweep();
select mms_sweep();
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ms_tls') and type = 'MEETING_SUMMARY_ATTENDANCE'
                    and entity_id = test.msid('MS I overdue')), 'the organiser is asked to confirm attendance once');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ms_tls') and type = 'MEETING_SUMMARY_OVERDUE'
                    and entity_id = test.msid('MS I overdue')), 'the overdue notice is sent once, not on every run');
set role authenticated;
select test.login('sa');
select test.check((select (r -> 'items') @> jsonb_build_array(jsonb_build_object('title', 'MS I overdue', 'overdue', true))
                   from mms_reports(jsonb_build_object('status', 'OVERDUE')) r), 'the CEO sees it overdue');
select test.login('ms_dhs');
select test.check((mms_list('TEAM', 'OVERDUE') -> 'items') @> jsonb_build_array(jsonb_build_object('title', 'MS I overdue')),
  'so does the Team Lead''s Department Head');
select test.login('authenticated_nobody');
reset role;
set role authenticated;
select test.must_fail($$select mms_sweep()$$, 'the sweep is for the server only', 'permission denied');

\echo '   other meetings keep the old behaviour'
select test.login('ms_tls');
select test.check((mtg_complete(test.msid('MS J appointment')) ->> 'status') = 'COMPLETED', 'an appointment is still marked done as before');
select test.must_fail($$select mms_confirm_attendance(test.msid('MS J appointment'), test.ids(array['ms_m1']))$$, 'and has no summary', 'internal team meetings');
reset role;
set role anon;
select test.must_fail($$select mms_get(test.msid('MS A weekly'))$$, 'signed-out visitors (booking pages) get nothing', 'permission denied');
select test.must_fail($$select * from meeting_summaries$$, 'no direct table access', 'permission denied');
reset role;
set role authenticated;
select test.must_fail($$select * from meeting_summaries$$, 'not for signed-in users either', 'permission denied');
reset role;
