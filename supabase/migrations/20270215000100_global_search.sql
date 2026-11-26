-- =============================================================================
-- Global search (Ctrl / Cmd + K, docs/GLOBAL_SEARCH_ARCHITECTURE.md). Run after every earlier migration. Safe to run twice.
--
-- public.global_search(q, limit) returns the records the SIGNED-IN person may already open, grouped by kind. It never widens what anyone
-- can see:
--   - employees, customers / leads and support tickets are read AS THE CALLER (security invoker): the tables' own row-level rules
--     (private.can_view_profile, the customer policies, the ticket policies) decide, exactly as on the CRM's screens;
--   - meetings and notices have no direct table access; two small helpers read them through their existing visibility rules
--     (private.mtg_can_view, private.notice_visible) and return only the caller's;
--   - departments are limited further than their table rule (any signed-in person may read department names): the Managing Director
--     sees all, a Department Head / CEO the departments of their scopes (private.scopes_of), everyone else their own.
-- Only display fields are returned (name, a subtitle, a status, an id): no notes, amounts or contact details. The query text is not
-- stored or logged here. Results are ranked: exact, then starts with, then a word that starts with it, then contains, then all words,
-- then a close spelling (trigram similarity), then by name; ties are broken by id so the order never changes between two searches.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- digits only (phone numbers are typed in many shapes): immutable, so it can be indexed
create or replace function private.search_digits(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')
$$;

-- the score of one candidate (higher first); 0 = not a match
create or replace function private.search_score(p_title text, p_haystack text, p_q text, p_tokens text[])
returns integer language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_q = '' then 0
    when lower(coalesce(p_title, '')) = p_q then 100
    when lower(coalesce(p_title, '')) like replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' then 80
    when lower(coalesce(p_title, '')) ~ ('(^|[^[:alnum:]])' || regexp_replace(p_q, '([.*+?^${}()|\[\]\\])', '\\\1', 'g')) then 70
    when strpos(lower(coalesce(p_haystack, '')), p_q) > 0 then 55
    when (select bool_and(strpos(lower(coalesce(p_haystack, '')), t) > 0) from unnest(p_tokens) t) then 40
    when length(p_q) >= 4 and p_q !~ '[0-9]' and (select bool_and(case when length(t) >= 4 then extensions.word_similarity(t, lower(coalesce(p_haystack, ''))) >= 0.4
                                                    else strpos(lower(coalesce(p_haystack, '')), t) > 0 end) from unnest(p_tokens) t)
      then 10 + round(extensions.word_similarity(p_q, lower(coalesce(p_haystack, ''))) * 20)::int
    else 0 end
$$;

-- meetings the caller may see (host, organiser, attendee, delegate, the Managing Director's own requests): through mtg_can_view
create or replace function private.search_meetings(p_q text, p_tokens text[], p_limit integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id'), '[]'::jsonb)
    from (
      select jsonb_build_object('type', 'meeting', 'id', m.id, 'title', m.title,
               'subtitle', initcap(replace(lower(m.kind::text), '_', ' ')) || ' · ' || to_char(m.starts_at at time zone coalesce(m.timezone, 'Asia/Kolkata'), 'DD Mon YYYY, HH12:MI AM'),
               'meta', initcap(lower(m.status::text)), 'reference', m.reference,
               'score', private.search_score(m.title, concat_ws(' ', m.title, m.reference, m.kind, m.client_company,
                          to_char(m.starts_at at time zone coalesce(m.timezone, 'Asia/Kolkata'), 'DD Mon YYYY YYYY-MM-DD')), p_q, p_tokens)) as x
        from public.meetings m
       where auth.uid() is not null
         and (lower(m.title) like '%' || p_tokens[1] || '%' or lower(m.reference) like '%' || p_tokens[1] || '%' or lower(coalesce(m.client_company, '')) like '%' || p_tokens[1] || '%'
              or lower(m.kind::text) like '%' || replace(p_tokens[1], ' ', '_') || '%'
              or to_char(m.starts_at at time zone coalesce(m.timezone, 'Asia/Kolkata'), 'DD Mon YYYY YYYY-MM-DD') ilike '%' || p_tokens[1] || '%'
              or (length(p_q) >= 4 and p_q !~ '[0-9]' and p_q operator(extensions.<%) lower(m.title)))
         and private.mtg_can_view(m, auth.uid())
       order by m.starts_at desc
       limit 200
    ) s
   where (x ->> 'score')::int > 0
   limit greatest(p_limit, 0)
$$;

-- notices the caller may read: through notice_visible (never a deleted or a scheduled one that is not theirs)
create or replace function private.search_notices(p_q text, p_tokens text[], p_limit integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id'), '[]'::jsonb)
    from (
      select jsonb_build_object('type', 'notice', 'id', n.id, 'title', n.title,
               'subtitle', initcap(lower(coalesce(n.category::text, 'Notice'))) || coalesce(' · ' || to_char(n.publish_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'), ''),
               'meta', initcap(lower(coalesce(n.priority::text, ''))), 'reference', n.reference,
               'score', private.search_score(n.title, concat_ws(' ', n.title, n.reference, n.category), p_q, p_tokens)) as x
        from public.company_notices n
       where auth.uid() is not null
         and (lower(n.title) like '%' || p_tokens[1] || '%' or lower(coalesce(n.reference, '')) like '%' || p_tokens[1] || '%'
              or (length(p_q) >= 4 and p_q !~ '[0-9]' and p_q operator(extensions.<%) lower(n.title)))
         and private.notice_visible(n)
       order by n.publish_at desc nulls last
       limit 200
    ) s
   where (x ->> 'score')::int > 0
   limit greatest(p_limit, 0)
$$;

-- ---------------------------------------------------------------------------
-- Candidates (speed only, never access): under row-level security PostgreSQL cannot use the trigram indexes for "contains" (LIKE is not
-- leakproof), so a large table would be read whole with every policy evaluated per row. These two helpers find, through the indexes, the
-- best-matching ids (at most p_cap, best first); global_search then reads those rows AS THE CALLER, so the row-level rules still decide what
-- is returned. They live in the private schema, which the API does not expose (PostgREST serves only public), and return ids only.
-- ---------------------------------------------------------------------------
create or replace function private.search_customer_candidates(p_q text, p_tokens text[], p_digits text, p_cap integer)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid[];
begin
  -- 1. exact words (every condition of the OR is indexed); every word must be present. Cheap ordering only (exact, starts with, most
  --    recently updated): the full ranking runs on the caller's rows afterwards
  select coalesce(array_agg(id), '{}') into v from (
    select c.id
      from public.customers c
     where (c.search_text like '%' || p_tokens[1] || '%'
            or lower(c.customer_code) = p_q
            or (p_digits is not null and private.search_digits(c.phone) like '%' || p_digits || '%'))
       and (not exists (select 1 from unnest(p_tokens) t where strpos(c.search_text, t) = 0)
            or lower(c.customer_code) = p_q
            or (p_digits is not null and private.search_digits(c.phone) like '%' || p_digits || '%'))
     order by (lower(coalesce(nullif(c.company, ''), c.name)) = p_q or lower(c.customer_code) = p_q) desc,
              (lower(coalesce(nullif(c.company, ''), c.name)) like p_q || '%' or lower(c.name) like p_q || '%') desc,
              c.updated_at desc, c.id
     limit greatest(p_cap, 0)) x;
  -- 2. nothing found: a close spelling of a name (never for numbers: a phone number is not "close" to another)
  if cardinality(v) = 0 and length(p_q) >= 4 and p_digits is null and p_q !~ '[0-9]' then
    select coalesce(array_agg(id), '{}') into v from (
      select c.id from public.customers c
       where p_q operator(extensions.<%) c.search_text
       order by extensions.word_similarity(p_q, c.search_text) desc, c.id
       limit least(greatest(p_cap, 0), 200)) x;
  end if;
  return v;
end $$;
create or replace function private.search_profile_candidates(p_q text, p_tokens text[], p_digits text, p_cap integer)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid[];
begin
  select coalesce(array_agg(id), '{}') into v from (
    select p.id
      from public.profiles p
      left join public.departments d on d.id = p.department_id
     where p.status <> 'REJECTED'
       and (lower(p.full_name) like '%' || p_tokens[1] || '%' or lower(p.email) like '%' || p_tokens[1] || '%'
            or lower(coalesce(p.position, '')) like '%' || p_tokens[1] || '%' or lower(coalesce(d.name, '')) like '%' || p_tokens[1] || '%'
            or (p_digits is not null and private.search_digits(p.phone) like '%' || p_digits || '%')
            or p.id::text = p_q)
       and (not exists (select 1 from unnest(p_tokens) t where strpos(lower(concat_ws(' ', p.full_name, p.email, p.position, d.name)), t) = 0)
            or (p_digits is not null and private.search_digits(p.phone) like '%' || p_digits || '%') or p.id::text = p_q)
     order by (lower(p.full_name) = p_q) desc, (lower(p.full_name) like p_q || '%') desc, p.full_name, p.id
     limit greatest(p_cap, 0)) x;
  if cardinality(v) = 0 and length(p_q) >= 4 and p_digits is null and p_q !~ '[0-9]' then
    select coalesce(array_agg(id), '{}') into v from (
      select p.id from public.profiles p where p.status <> 'REJECTED' and p_q operator(extensions.<%) lower(p.full_name)
       order by extensions.word_similarity(p_q, lower(p.full_name)) desc, p.id limit 200) x;
  end if;
  return v;
end $$;
revoke all on function private.search_profile_candidates(text, text[], text, integer) from public, anon;
grant execute on function private.search_profile_candidates(text, text[], text, integer) to authenticated;
create or replace function private.search_ticket_candidates(p_q text, p_tokens text[], p_cap integer)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id order by t.created_at desc, t.id), '{}') from (
    select t.id, t.created_at from public.support_tickets t
     where lower(t.subject) like '%' || p_tokens[1] || '%' or lower(coalesce(t.ticket_no, '')) like '%' || p_tokens[1] || '%'
        or (length(p_q) >= 4 and p_q !~ '[0-9]' and p_q operator(extensions.<%) lower(t.subject))
     order by t.created_at desc
     limit greatest(p_cap, 0)) t
$$;
revoke all on function private.search_customer_candidates(text, text[], text, integer) from public, anon;
revoke all on function private.search_ticket_candidates(text, text[], integer) from public, anon;
grant execute on function private.search_customer_candidates(text, text[], text, integer) to authenticated;
grant execute on function private.search_ticket_candidates(text, text[], integer) to authenticated;

-- the caller's own role, department and whether they are active (one row by primary key, without the per-row policy scan)
create or replace function private.search_caller(out o_role text, out o_department uuid, out o_active boolean)
language sql stable security definer set search_path = '' as $$
  select p.role::text, p.department_id, p.status = 'ACTIVE' from public.profiles p where p.id = auth.uid()
$$;
revoke all on function private.search_caller() from public, anon;
grant execute on function private.search_caller() to authenticated;

-- ---------------------------------------------------------------------------
-- The search itself: security INVOKER (the caller's own row-level rules apply to every table read directly here)
-- ---------------------------------------------------------------------------
create or replace function public.global_search(p_query text, p_limit integer default 5)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_q text := lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')));
  v_tokens text[];
  v_digits text;
  v_lim integer := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_role text;
  v_my_dept uuid;
  v_emp jsonb;
  v_cust jsonb;
  v_lead jsonb;
  v_tic jsonb;
  v_dep jsonb;
  v_mtg jsonb;
  v_not jsonb;
  v_cust_ids uuid[];
  v_tic_ids uuid[];
  v_emp_ids uuid[];
  v_active boolean;
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  select c.o_role, c.o_department, coalesce(c.o_active, false) into v_role, v_my_dept, v_active from private.search_caller() c;
  if not coalesce(v_active, false) then
    raise exception 'FORBIDDEN: Your account is not active.' using errcode = '42501';
  end if;
  -- The close-spelling threshold for the trigram "<%" operator, for this transaction only (the helpers below run inside it). It is set here and
  -- not with a function-level "set pg_trgm.word_similarity_threshold" clause: the Supabase SQL editor runs as a role that is not a superuser,
  -- and PostgreSQL refuses that clause from such a role when the pg_trgm library is not yet loaded in the session ("permission denied to set
  -- parameter"), so the migration could not be pasted there.
  perform set_config('pg_trgm.word_similarity_threshold', '0.5', true);
  -- punctuation other than what names, codes, e-mails and numbers use is ignored; at most 100 characters
  v_q := left(btrim(regexp_replace(v_q, '[^[:alnum:]@.+_\- ]', ' ', 'g')), 100);
  v_q := btrim(regexp_replace(v_q, '\s+', ' ', 'g'));
  if length(v_q) < 2 then
    return jsonb_build_object('query', v_q, 'groups', '[]'::jsonb);
  end if;
  v_tokens := array(select t from unnest(string_to_array(v_q, ' ')) t where t <> '' limit 6);
  -- the first word filters through the indexes: a word with digits (an id, a number) first, then the longest; every word must match
  v_tokens := array(select t from unnest(v_tokens) t order by (t ~ '[0-9]') desc, length(t) desc, t);
  v_digits := case when length(private.search_digits(v_q)) >= 4 and v_q ~ '^[0-9+() .\-]+$' then private.search_digits(v_q) end;

  -- the candidates first, as values: the row-level policies then run only on those rows (an id list is a plain, leakproof comparison that
  -- the primary key serves; a function call in the same place would make PostgreSQL apply every policy to every row first)
  v_cust_ids := private.search_customer_candidates(v_q, v_tokens, v_digits, 600);
  v_tic_ids := private.search_ticket_candidates(v_q, v_tokens, 600);
  v_emp_ids := private.search_profile_candidates(v_q, v_tokens, v_digits, 600);

  -- employees (profiles: row-level rule private.can_view_profile)
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id'), '[]'::jsonb) into v_emp
    from (select jsonb_build_object('type', 'employee', 'id', p.id, 'title', p.full_name,
                   'subtitle', concat_ws(' · ', nullif(p.position, ''), d.name),
                   'meta', case when p.status <> 'ACTIVE' then initcap(lower(p.status::text)) end,
                   'score', greatest(private.search_score(p.full_name, concat_ws(' ', p.full_name, p.email, p.position, d.name), v_q, v_tokens),
                                     case when v_digits is not null and private.search_digits(p.phone) like '%' || v_digits || '%' then 75 else 0 end,
                                     case when p.id::text = v_q then 100 else 0 end)) as x
            from public.profiles p
            left join public.departments d on d.id = p.department_id
           where p.id = any(v_emp_ids)
           limit 300) s
   where (x ->> 'score')::int > 0;


  -- customers and leads (customers: the customer row-level policies)
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id') filter (where x ->> 'type' = 'customer'), '[]'::jsonb),
         coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id') filter (where x ->> 'type' = 'lead'), '[]'::jsonb)
    into v_cust, v_lead
    from (select jsonb_build_object('type', case when c.lifecycle_stage = 'LEAD' then 'lead' else 'customer' end, 'id', c.id,
                   'title', coalesce(nullif(c.company, ''), c.name),
                   'subtitle', concat_ws(' · ', case when nullif(c.company, '') is not null then c.name end, c.customer_code, d.name),
                   'meta', initcap(lower(c.status::text)),
                   'score', greatest(private.search_score(coalesce(nullif(c.company, ''), c.name), concat_ws(' ', c.search_text, c.customer_code, d.name), v_q, v_tokens),
                                     private.search_score(c.name, c.name, v_q, v_tokens),
                                     case when lower(coalesce(c.customer_code, '')) = v_q then 100 else 0 end,
                                     case when v_digits is not null and private.search_digits(c.phone) like '%' || v_digits || '%' then 75 else 0 end)) as x
            from public.customers c
            left join public.departments d on d.id = c.department_id
           where c.id = any(v_cust_ids)
           limit 400) s
   where (x ->> 'score')::int > 0;

  -- support tickets (support_tickets: the ticket row-level policies)
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id'), '[]'::jsonb) into v_tic
    from (select jsonb_build_object('type', 'ticket', 'id', t.id, 'title', t.subject,
                   'subtitle', concat_ws(' · ', t.ticket_no, initcap(lower(replace(t.status::text, '_', ' ')))),
                   'meta', initcap(lower(t.priority::text)),
                   'score', greatest(private.search_score(t.subject, concat_ws(' ', t.subject, t.ticket_no, t.category), v_q, v_tokens),
                                     case when lower(coalesce(t.ticket_no, '')) = v_q or lower(coalesce(t.ticket_no, '')) like '%-' || v_q then 100 else 0 end)) as x
            from public.support_tickets t
           where t.id = any(v_tic_ids)
           order by t.created_at desc
           limit 300) s
   where (x ->> 'score')::int > 0;

  -- departments: the Managing Director all, a head / CEO their scopes, others their own
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id'), '[]'::jsonb) into v_dep
    from (select jsonb_build_object('type', 'department', 'id', d.id, 'title', d.name,
                   'subtitle', (select string_agg(h.full_name, ', ' order by h.full_name) from public.profiles h
                                 where h.department_id = d.id and h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE'),
                   'score', private.search_score(d.name, concat_ws(' ', d.name, d.slug), v_q, v_tokens)) as x
            from public.departments d
           where (v_role = 'SUPER_ADMIN'
                  or d.id = v_my_dept
                  or (v_role = 'DEPARTMENT_HEAD' and exists (select 1 from private.scopes_of(auth.uid()) s where s.department_id = d.id)))
             and (lower(d.name) like '%' || v_tokens[1] || '%' or lower(coalesce(d.slug, '')) like '%' || v_tokens[1] || '%'
                  or (length(v_q) >= 4 and extensions.similarity(lower(d.name), v_q) >= 0.45))) s
   where (x ->> 'score')::int > 0;

  v_mtg := private.search_meetings(v_q, v_tokens, v_lim + 1);
  v_not := private.search_notices(v_q, v_tokens, v_lim + 1);

  return jsonb_build_object('query', v_q, 'groups', (
    select coalesce(jsonb_agg(jsonb_build_object('type', g.type, 'items', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(g.items) with ordinality a(e, n) where n <= v_lim) z),
                                                 'hasMore', jsonb_array_length(g.items) > v_lim) order by g.ord), '[]'::jsonb)
      from (values (1, 'employee', v_emp), (2, 'customer', v_cust), (3, 'lead', v_lead), (4, 'meeting', v_mtg), (5, 'ticket', v_tic),
                   (6, 'department', v_dep), (7, 'notice', v_not)) g(ord, type, items)
     where jsonb_array_length(g.items) > 0));
end $$;

-- ---------------------------------------------------------------------------
-- Opening a result: one record's details, read AS THE CALLER again (a record deleted or no longer theirs since the search, or an address
-- typed by hand, answers NOT_FOUND: nothing about it is revealed). Employees, customers / leads, tickets, departments; meetings and notices
-- open on their own pages, which check again themselves.
-- ---------------------------------------------------------------------------
create or replace function public.search_record(p_type text, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v jsonb;
  v_role text;
  v_my_dept uuid;
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  select c.o_role, c.o_department into v_role, v_my_dept from private.search_caller() c where c.o_active;
  if v_role is null then
    raise exception 'FORBIDDEN: Your account is not active.' using errcode = '42501';
  end if;
  if p_type = 'employee' then
    select jsonb_build_object('type', 'employee', 'id', p.id, 'title', p.full_name, 'fields', jsonb_strip_nulls(jsonb_build_object(
             'Designation', nullif(p.position, ''), 'Role', initcap(replace(lower(p.role::text), '_', ' ')), 'Department', d.name, 'Team', t.name,
             'Status', initcap(lower(p.status::text)), 'E-mail', p.email, 'Phone', nullif(p.phone, ''), 'Reports to', m.full_name)))
      into v
      from public.profiles p
      left join public.departments d on d.id = p.department_id
      left join public.teams t on t.id = p.team_id
      left join public.profiles m on m.id = p.manager_id
     where p.id = p_id;
  elsif p_type in ('customer', 'lead') then
    select jsonb_build_object('type', case when c.lifecycle_stage = 'LEAD' then 'lead' else 'customer' end, 'id', c.id,
             'title', coalesce(nullif(c.company, ''), c.name), 'fields', jsonb_strip_nulls(jsonb_build_object(
             'Contact', c.name, 'Customer ID', c.customer_code, 'Stage', initcap(lower(c.lifecycle_stage)), 'Status', initcap(lower(c.status::text)),
             'Phone', c.phone, 'E-mail', c.email, 'Owner', o.full_name, 'Department', d.name, 'Since', to_char(c.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'))))
      into v
      from public.customers c
      left join public.profiles o on o.id = c.owner_id
      left join public.departments d on d.id = c.department_id
     where c.id = p_id;
  elsif p_type = 'ticket' then
    select jsonb_build_object('type', 'ticket', 'id', t.id, 'title', t.subject, 'fields', jsonb_strip_nulls(jsonb_build_object(
             'Ticket', t.ticket_no, 'Status', initcap(lower(replace(t.status::text, '_', ' '))), 'Priority', initcap(lower(t.priority::text)),
             'Category', t.category, 'Customer', coalesce(nullif(c.company, ''), c.name), 'Assigned to', a.full_name,
             'Opened', to_char(t.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'))))
      into v
      from public.support_tickets t
      left join public.customers c on c.id = t.customer_id
      left join public.profiles a on a.id = t.assignee_id
     where t.id = p_id;
  elsif p_type = 'department' then
    select jsonb_build_object('type', 'department', 'id', d.id, 'title', d.name, 'fields', jsonb_strip_nulls(jsonb_build_object(
             'Department Head', (select string_agg(h.full_name, ', ' order by h.full_name) from public.profiles h
                                  where h.department_id = d.id and h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE'),
             'Teams', (select string_agg(t.name, ', ' order by t.name) from public.teams t where t.department_id = d.id),
             'People you can see', (select count(*) from public.profiles x where x.department_id = d.id and x.status = 'ACTIVE')::text)))
      into v
      from public.departments d
     where d.id = p_id
       and (v_role = 'SUPER_ADMIN' or d.id = v_my_dept
            or (v_role = 'DEPARTMENT_HEAD' and exists (select 1 from private.scopes_of(auth.uid()) s where s.department_id = d.id)));
  else
    raise exception 'VALIDATION_ERROR: Unknown kind of record.' using errcode = '22023';
  end if;
  if v is null then
    raise exception 'NOT_FOUND: This record is no longer available, or you do not have access to it.' using errcode = 'P0002';
  end if;
  return v;
end $$;
revoke all on function public.search_record(text, uuid) from public, anon;
grant execute on function public.search_record(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Indexes for the filters above (trigram: "contains" and close spellings; customers.search_text already has one)
-- ---------------------------------------------------------------------------
create index if not exists profiles_full_name_trgm_idx on public.profiles using gin (lower(full_name) extensions.gin_trgm_ops);
create index if not exists profiles_email_trgm_idx on public.profiles using gin (lower(email) extensions.gin_trgm_ops);
create index if not exists profiles_phone_digits_trgm_idx on public.profiles using gin (private.search_digits(phone) extensions.gin_trgm_ops);
create index if not exists customers_phone_digits_trgm_idx on public.customers using gin (private.search_digits(phone) extensions.gin_trgm_ops);
create index if not exists customers_code_lower_idx on public.customers (lower(customer_code));
create index if not exists support_tickets_subject_trgm_idx on public.support_tickets using gin (lower(subject) extensions.gin_trgm_ops);
create index if not exists meetings_title_trgm_idx on public.meetings using gin (lower(title) extensions.gin_trgm_ops);
create index if not exists company_notices_title_trgm_idx on public.company_notices using gin (lower(title) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Grants: the search for signed-in people; the helpers only as part of it
-- ---------------------------------------------------------------------------
revoke all on function public.global_search(text, integer) from public, anon;
grant execute on function public.global_search(text, integer) to authenticated, service_role;
revoke all on function private.search_meetings(text, text[], integer) from public, anon;
revoke all on function private.search_notices(text, text[], integer) from public, anon;
grant execute on function private.search_meetings(text, text[], integer) to authenticated;
grant execute on function private.search_notices(text, text[], integer) to authenticated;
revoke all on function private.search_score(text, text, text, text[]) from public, anon;
grant execute on function private.search_score(text, text, text, text[]) to authenticated, service_role;
revoke all on function private.search_digits(text) from public, anon;
grant execute on function private.search_digits(text) to authenticated, service_role;
