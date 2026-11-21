-- =============================================================================
-- Bugs: developer access by EMAIL (docs/EMPLOYEE_ISSUES.md "Bugs for the Developers team").
-- Run after 20270123000100_incentive_payouts.sql. Additive and safe to run twice; no bug, event, file or profile is changed or deleted.
--
-- ROOT CAUSE. The Bugs section (and every bug the developers see) is decided by one row: dev_team_members. 20270122000300 and 20270122000400
-- filled it ONCE, when they were run, by matching the person's NAME among the ACTIVE profiles. A developer whose profile was not found at
-- that moment (not approved yet, spelled or placed differently, created or renamed afterwards) never got the row, so bug_access() answered
-- isDeveloper = false, the menu hid Bugs, and bug_dev_list refused him (FORBIDDEN) - while Shreya and Ashish, matched in time, saw every bug.
-- Nothing in the visibility rule itself excludes a developer (bug_visible / RLS give every developer every unassigned bug).
--
-- FIX. A developer is now also recognised by the EMAIL of the account, which is stable and unique (profiles.email or the sign-in email in
-- auth.users), kept in dev_team_emails:
--   * siddhesh.amuwa@gmail.com (Siddhesh Shinde, AI Studio - AI CRM team) is a developer (not the Team Lead, never a Super Admin);
--   * the row in dev_team_members is added now, and again automatically whenever a profile with a listed email is created, becomes ACTIVE,
--     or changes its email / role (so an account approved or fixed later is picked up without anyone running SQL);
--   * the Super Admin removing a developer in Settings also removes the email from the list (the removal is not silently undone);
--   * the name matching of 20270122000400 is run once more for the three developers.
-- A profile that is not ACTIVE (pending approval, suspended) or is a Super Admin is NOT given access: this migration reports it as a NOTICE
-- instead of approving an account or changing a role.
-- =============================================================================

create table if not exists public.dev_team_emails (
  email text primary key check (email = lower(btrim(email))),
  is_lead boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.dev_team_emails enable row level security;
revoke all on public.dev_team_emails from public, anon, authenticated;

insert into public.dev_team_emails (email, is_lead) values ('siddhesh.amuwa@gmail.com', false) on conflict (email) do nothing;

-- adds the developers whose account email is listed (one profile, or every profile); returns how many rows it added
create or replace function private.dev_team_sync_emails(p_profile uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  with found as (
    select p.id, e.is_lead
      from public.dev_team_emails e
      join public.profiles p on (p_profile is null or p.id = p_profile)
       and (lower(btrim(coalesce(p.email, ''))) = e.email
            or exists (select 1 from auth.users u where u.id = p.id and lower(btrim(coalesce(u.email, ''))) = e.email))
     where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
  ), added as (
    insert into public.dev_team_members (profile_id, is_lead)
    select id, is_lead from found
    on conflict (profile_id) do nothing
    returning 1
  )
  select count(*) into v_n from added;
  return v_n;
end $$;

create or replace function private.tg_dev_team_sync_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ACTIVE' and new.role <> 'SUPER_ADMIN' then
    perform private.dev_team_sync_emails(new.id);
  end if;
  return null;
end $$;
drop trigger if exists profiles_dev_team_sync_email on public.profiles;
create trigger profiles_dev_team_sync_email after insert or update of email, status, role on public.profiles
  for each row execute function private.tg_dev_team_sync_email();

-- a developer removed from the team (Settings) leaves the email list too, so the next profile update does not bring them back
create or replace function private.tg_dev_team_forget_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.dev_team_emails e
   where e.email in (select lower(btrim(p.email)) from public.profiles p where p.id = old.profile_id and p.email is not null);
  return null;
end $$;
drop trigger if exists dev_team_members_forget_email on public.dev_team_members;
create trigger dev_team_members_forget_email after delete on public.dev_team_members
  for each row execute function private.tg_dev_team_forget_email();

-- now: the listed emails ...
select private.dev_team_sync_emails();

-- ... and the names once more (same rule as 20270122000400): Shreya Mande (lead), Ashish Sinha, Siddhesh Shinde
with wanted (key_first, key_last, lead) as (values ('shreya', 'mande', true), ('ashish', 'sinha', false), ('sid', 'shinde', false)),
found as (
  select p.id, w.lead
    from public.profiles p, wanted w
   where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
     and private.dev_name_key(split_part(btrim(p.full_name), ' ', 1)) like w.key_first || '%'
     and private.dev_name_key(p.full_name) like '%' || w.key_last
     and (w.key_first <> 'sid' or private.dev_name_key(split_part(btrim(p.full_name), ' ', 1)) ~ '^sidd?h?esh$')
)
insert into public.dev_team_members (profile_id, is_lead)
select id, lead from found
on conflict (profile_id) do update set is_lead = public.dev_team_members.is_lead or excluded.is_lead;

-- say plainly what is still wrong, if anything (the SQL editor shows NOTICEs)
do $$
declare
  r record;
begin
  for r in select e.email, p.id, p.status, p.role
             from public.dev_team_emails e
             left join public.profiles p on lower(btrim(coalesce(p.email, ''))) = e.email
                                        or exists (select 1 from auth.users u where u.id = p.id and lower(btrim(coalesce(u.email, ''))) = e.email)
            where p.id is null or p.status <> 'ACTIVE' or p.role = 'SUPER_ADMIN'
              or not exists (select 1 from public.dev_team_members t where t.profile_id = p.id) loop
    raise notice 'Developer % is NOT set up: %', r.email,
      case when r.id is null then 'no profile has this email (the account must be created / its profile email fixed)'
           when r.status <> 'ACTIVE' then 'the profile is ' || r.status || ' (approve / reactivate it; it is added automatically then)'
           when r.role = 'SUPER_ADMIN' then 'the profile is a Super Admin (not a developer role)'
           else 'unknown' end;
  end loop;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['private.dev_team_sync_emails(uuid)', 'private.tg_dev_team_sync_email()', 'private.tg_dev_team_forget_email()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
