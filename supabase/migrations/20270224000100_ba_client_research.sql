-- Business Associate: research a client on the web (Tavily, or Claude's web search as a fallback) to suggest the client profile fields.
-- The API does the web calls; the database decides who may research which contact, keeps each result for 30 days (a repeat costs nothing),
-- limits researches per person per day, and remembers when the Tavily credits ran out (so no more Tavily calls are wasted that month).
-- Nothing here changes the profile: the Business Associate reviews the suggestions and saves the ones they keep, as before.
-- Safe to run twice.

create table if not exists public.ba_client_research (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.ba_contacts(id) on delete cascade,
  query_key text not null check (length(query_key) <= 600),           -- company | city | website, normalised: a changed website means a new research
  provider text not null check (provider in ('TAVILY', 'CLAUDE')),
  suggestions jsonb not null check (jsonb_typeof(suggestions) = 'object' and pg_column_size(suggestions) <= 60000),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and pg_column_size(sources) <= 20000),
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object' and pg_column_size(usage) <= 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ba_client_research_contact_idx on public.ba_client_research (contact_id, created_at desc);
create index if not exists ba_client_research_creator_idx on public.ba_client_research (created_by, created_at desc);
alter table public.ba_client_research enable row level security;
revoke all on table public.ba_client_research from public, anon, authenticated;

-- One row: until when Tavily is skipped because its credits ran out (HTTP 432 / 433). Cleared by the next month.
create table if not exists public.ba_research_state (
  id boolean primary key default true check (id),
  tavily_paused_until timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.ba_research_state (id) values (true) on conflict (id) do nothing;
alter table public.ba_research_state enable row level security;
revoke all on table public.ba_research_state from public, anon, authenticated;

create or replace function private.ba_research_json(r public.ba_client_research, p_cached boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'contactId', r.contact_id, 'provider', r.provider, 'suggestions', r.suggestions, 'sources', r.sources,
                            'usage', r.usage, 'createdAt', r.created_at, 'cached', p_cached);
$$;
revoke all on function private.ba_research_json(public.ba_client_research, boolean) from public, anon, authenticated;

create or replace function private.ba_research_key(p_contact public.ba_contacts)
returns text language sql stable security definer set search_path = '' as $$
  select left(lower(regexp_replace(concat_ws('|', coalesce(nullif(trim(l.company), ''), l.name), l.city, p_contact.profile ->> 'website'), '\s+', ' ', 'g')), 600)
    from public.customers l where l.id = p_contact.lead_id;
$$;
revoke all on function private.ba_research_key(public.ba_contacts) from public, anon, authenticated;

-- Before any web call. Returns the stored result when this client was researched in the last 30 days with the same company, city and website
-- (unless p_force), otherwise what may be searched: the business name, city, category and website only (no phone numbers, no e-mail addresses,
-- no notes). Refused after 15 new researches by the same person on the same day (India time); stored results do not count.
create or replace function public.ba_research_begin(p_contact uuid, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  l public.customers;
  r public.ba_client_research;
  v_key text;
  v_today int;
  v_paused timestamptz;
begin
  c := private.ba_my_contact(p_contact);   -- the signed-in Business Associate's own contact (locked: two clicks do not start two researches at once)
  select * into l from public.customers where id = c.lead_id;
  v_key := private.ba_research_key(c);
  if not coalesce(p_force, false) then
    select * into r from public.ba_client_research
     where contact_id = c.id and query_key = v_key and created_at > now() - interval '30 days'
     order by created_at desc limit 1;
    if r.id is not null then return jsonb_build_object('cached', private.ba_research_json(r, true)); end if;
  end if;
  select count(*) into v_today from public.ba_client_research
   where created_by = private.my_id() and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date;
  if v_today >= 15 then
    raise exception 'CONFLICT: You have used today''s 15 client researches. Saved results still open; new ones are possible again tomorrow.' using errcode = 'P0001';
  end if;
  if coalesce(nullif(trim(l.company), ''), nullif(trim(l.name), '')) is null then
    raise exception 'VALIDATION_ERROR: Add the company or business name before researching the client.' using errcode = 'P0001';
  end if;
  select tavily_paused_until into v_paused from public.ba_research_state where id;
  return jsonb_build_object(
    'cached', null,
    'key', v_key,
    'business', coalesce(nullif(trim(l.company), ''), l.name),
    'city', nullif(trim(l.city), ''),
    'businessCategory', nullif(trim(l.business_category), ''),
    'website', nullif(trim(c.profile ->> 'website'), ''),
    'industry', nullif(trim(c.profile ->> 'industry'), ''),
    'tavilyPaused', v_paused is not null and v_paused > now());
end $$;

-- After a successful research: stores it against the contact. p_tavily_exhausted = Tavily answered "credits used up", so Tavily is skipped
-- until the start of next month (India time).
create or replace function public.ba_research_record(p_contact uuid, p_key text, p_provider text, p_suggestions jsonb, p_sources jsonb, p_usage jsonb,
                                                    p_tavily_exhausted boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  r public.ba_client_research;
begin
  c := private.ba_my_contact(p_contact);
  if p_provider is null or p_provider not in ('TAVILY', 'CLAUDE') then raise exception 'VALIDATION_ERROR: Unknown research provider.' using errcode = 'P0001'; end if;
  if p_suggestions is null or jsonb_typeof(p_suggestions) <> 'object' or jsonb_typeof(coalesce(p_sources, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_usage, '{}'::jsonb)) <> 'object' then
    raise exception 'VALIDATION_ERROR: The research result is not valid.' using errcode = 'P0001';
  end if;
  if coalesce(p_tavily_exhausted, false) then
    update public.ba_research_state
       set tavily_paused_until = ((date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month') at time zone 'Asia/Kolkata'), updated_at = now()
     where id;
  end if;
  insert into public.ba_client_research (contact_id, query_key, provider, suggestions, sources, usage, created_by)
  values (c.id, coalesce(left(p_key, 600), private.ba_research_key(c)), p_provider, p_suggestions, coalesce(p_sources, '[]'::jsonb), coalesce(p_usage, '{}'::jsonb), private.my_id())
  returning * into r;
  return private.ba_research_json(r, false);
end $$;

-- When both Tavily and the fallback failed and Tavily said its credits are used up: remember it, so the next research goes straight to the fallback.
create or replace function public.ba_research_pause_tavily(p_contact uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ba_my_contact(p_contact);
  update public.ba_research_state
     set tavily_paused_until = ((date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month') at time zone 'Asia/Kolkata'), updated_at = now()
   where id;
end $$;

-- The last research of a contact (no web call), for whoever may read the contact.
create or replace function public.ba_research_latest(p_contact uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  r public.ba_client_research;
begin
  select * into c from public.ba_contacts where id = p_contact;
  if c.id is null or not private.ba_can_read(c.assigned_to, c.department_id, c.team_id) then
    raise exception 'NOT_FOUND: Contact not found.' using errcode = 'P0001';
  end if;
  select * into r from public.ba_client_research where contact_id = c.id order by created_at desc limit 1;
  if r.id is null then return null; end if;
  return private.ba_research_json(r, true);
end $$;

revoke all on function public.ba_research_begin(uuid, boolean) from public, anon;
revoke all on function public.ba_research_record(uuid, text, text, jsonb, jsonb, jsonb, boolean) from public, anon;
revoke all on function public.ba_research_pause_tavily(uuid) from public, anon;
revoke all on function public.ba_research_latest(uuid) from public, anon;
grant execute on function public.ba_research_begin(uuid, boolean) to authenticated;
grant execute on function public.ba_research_record(uuid, text, text, jsonb, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.ba_research_pause_tavily(uuid) to authenticated;
grant execute on function public.ba_research_latest(uuid) to authenticated;
