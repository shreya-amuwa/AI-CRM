-- =============================================================================
-- Business Associate: client research on the web (migration 20270223000100). Who may research which contact, what is handed to the web search
-- (no phone, no e-mail), the 30-day stored result, the daily limit, the "Tavily credits used up" pause, and who reads the last result.
-- Runs after the Business Associate suite (uses its contact "Hot Customer", by then assigned to BA Beta).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- business associate: client research'
reset role;
delete from public.ba_client_research;
update public.ba_research_state set tavily_paused_until = null;
update public.customers set city = 'Pune', business_category = 'Bakery' where id = test.lead('Hot Customer');
update public.ba_contacts set profile = profile || '{"website":"hotco.example.com"}'::jsonb where id = test.bac('Hot Customer');
set role authenticated;

\echo '   access'
select test.login('ba_a');
select test.must_fail($$select ba_research_begin(test.bac('Hot Customer'))$$, 'a Business Associate cannot research another Business Associate''s contact', 'not found');
select test.must_fail($$select ba_research_record(test.bac('Hot Customer'), 'k', 'TAVILY', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)$$, 'nor store a result against it', 'not found');
select test.login('tc_a');
select test.must_fail($$select ba_research_begin(test.bac('Hot Customer'))$$, 'a Telecaller cannot research', 'FORBIDDEN');
select test.login('sup_plain');
select test.must_fail($$select ba_research_latest(test.bac('Hot Customer'))$$, 'a Support member cannot read the research', 'not found');
select test.login('ba_b');
select test.must_fail($$select * from ba_client_research$$, 'the stored research cannot be read directly', 'permission denied');
select test.must_fail($$update ba_research_state set tavily_paused_until = null$$, 'nor the Tavily state changed directly', 'permission denied');

\echo '   what may be searched'
select test.check((ba_research_begin(test.bac('Hot Customer')) -> 'cached') = 'null'::jsonb, 'nothing is stored yet: a new research is needed');
select test.check((select x ->> 'business' = 'Hot Co' and x ->> 'city' = 'Pune' and x ->> 'businessCategory' = 'Bakery' and x ->> 'website' = 'hotco.example.com'
                     and x ->> 'tavilyPaused' = 'false' and x ->> 'key' like 'hot co|pune|hotco.example.com%' from ba_research_begin(test.bac('Hot Customer')) x),
  'the web search gets the company, city, category and website');
select test.check((select not (x::text ilike '%9822222221%') and not (x::text ilike '%hot@example.com%') and not (x::text ilike '%1 Main St%') and not (x::text ilike '%Keen%')
                     from ba_research_begin(test.bac('Hot Customer')) x), 'and never the phone number, e-mail address, street address or notes');
select test.must_fail($$select ba_research_record(test.bac('Hot Customer'), 'k', 'OPENAI', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)$$, 'an unknown provider is refused', 'Unknown research provider');
select test.must_fail($$select ba_research_record(test.bac('Hot Customer'), 'k', 'TAVILY', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$$, 'a result that is not an object is refused', 'not valid');

\echo '   storing a result and the 30-day reuse'
select test.check((select x ->> 'provider' = 'TAVILY' and (x ->> 'cached')::boolean = false and x -> 'usage' ->> 'tavilyCredits' = '2'
                     from ba_research_record(test.bac('Hot Customer'), (ba_research_begin(test.bac('Hot Customer')) ->> 'key'), 'TAVILY',
                          '{"summary":"A bakery in Pune.","fields":{"industry":{"value":"Bakery","basis":"VERIFIED","sources":[1]}}}'::jsonb,
                          '[{"url":"https://hotco.example.com","title":"Hot Co"}]'::jsonb, '{"tavilyCredits":2}'::jsonb) x), 'a result is stored');
select test.check((select (x -> 'cached' ->> 'cached')::boolean and x -> 'cached' -> 'suggestions' ->> 'summary' = 'A bakery in Pune.' from ba_research_begin(test.bac('Hot Customer')) x),
  'researching again within 30 days returns the stored result (no new web call)');
select test.check((ba_research_begin(test.bac('Hot Customer'), true) -> 'cached') = 'null'::jsonb, '"Search again" (force) asks for a new research');
reset role;
update public.ba_contacts set profile = profile || '{"website":"hotco-new.example.com"}'::jsonb where id = test.bac('Hot Customer');
set role authenticated;
select test.login('ba_b');
select test.check((ba_research_begin(test.bac('Hot Customer')) -> 'cached') = 'null'::jsonb, 'a changed website needs a new research');
reset role;
update public.ba_contacts set profile = profile || '{"website":"hotco.example.com"}'::jsonb where id = test.bac('Hot Customer');
update public.ba_client_research set created_at = now() - interval '31 days' where contact_id = test.bac('Hot Customer');
set role authenticated;
select test.login('ba_b');
select test.check((ba_research_begin(test.bac('Hot Customer')) -> 'cached') = 'null'::jsonb, 'a result older than 30 days is not reused');

\echo '   who reads the last result'
select test.check((ba_research_latest(test.bac('Hot Customer')) ->> 'provider') = 'TAVILY', 'the Business Associate reads the last result');
select test.login('dh_wab');
select test.check((ba_research_latest(test.bac('Hot Customer')) ->> 'provider') = 'TAVILY', 'so does the Department Head of the department');
select test.must_fail($$select ba_research_begin(test.bac('Hot Customer'))$$, 'but only the Business Associate starts a research', 'FORBIDDEN');
select test.login('ba_b');
select test.check(ba_research_latest(test.bac('Second Qualified')) is null, 'a contact never researched has no result');

\echo '   the daily limit'
reset role;
insert into public.ba_client_research (contact_id, query_key, provider, suggestions, created_by)
select test.bac('Hot Customer'), 'old-' || g, 'TAVILY', '{}'::jsonb, test.id('ba_b') from generate_series(1, 15) g;   -- the result stored above is 31 days old now: 15 new ones today
update public.ba_client_research set created_at = now() where contact_id = test.bac('Hot Customer') and query_key like 'old-%';
set role authenticated;
select test.login('ba_b');
select test.must_fail($$select ba_research_begin(test.bac('Second Qualified'))$$, 'the 16th new research of the day is refused', 'today''s 15 client researches');
reset role;
update public.ba_client_research set created_at = now() where contact_id = test.bac('Hot Customer') and query_key not like 'old-%';
set role authenticated;
select test.login('ba_b');
select test.check(((ba_research_begin(test.bac('Hot Customer')) -> 'cached' ->> 'cached')::boolean), 'a stored result still opens after the limit (it costs nothing)');
reset role;
delete from public.ba_client_research where query_key like 'old-%';
set role authenticated;

\echo '   Tavily credits used up'
select test.login('ba_b');
select ba_research_record(test.bac('Hot Customer'), 'claude-key', 'CLAUDE', '{"summary":"x"}'::jsonb, '[]'::jsonb, '{"fallbackReason":"TAVILY_CREDITS_USED_UP"}'::jsonb, true);
reset role;
select test.check((select tavily_paused_until > now() and tavily_paused_until <= now() + interval '32 days'
                     and (tavily_paused_until at time zone 'Asia/Kolkata')::time = '00:00' and extract(day from tavily_paused_until at time zone 'Asia/Kolkata') = 1 from ba_research_state),
  'Tavily is paused until the 1st of next month (India time)');
set role authenticated;
select test.login('ba_b');
select test.check((ba_research_begin(test.bac('Second Qualified')) ->> 'tavilyPaused')::boolean, 'the next research knows to skip Tavily');
reset role;
update public.ba_research_state set tavily_paused_until = null;
set role authenticated;
select test.login('ba_b');
select ba_research_pause_tavily(test.bac('Second Qualified'));
select test.check((ba_research_begin(test.bac('Second Qualified')) ->> 'tavilyPaused')::boolean, 'a failed research with no fallback also pauses Tavily');
select test.login('ba_a');
select test.must_fail($$select ba_research_pause_tavily(test.bac('Second Qualified'))$$, 'only for one''s own contact', 'not found');
reset role;
update public.ba_research_state set tavily_paused_until = null;
delete from public.ba_client_research where contact_id in (test.bac('Hot Customer'), test.bac('Second Qualified'));
update public.ba_contacts set profile = profile - 'website' where id = test.bac('Hot Customer');
