-- =============================================================================
-- AI-generated avatars. Every profile - new or existing - carries a generated
-- illustrated avatar instead of a personal photo or stock image.
--
--   * private.generated_avatar_url(seed) builds the deterministic avatar URL
--     (mirrors src/lib/avatar.ts).
--   * A BEFORE INSERT/UPDATE trigger replaces any missing or non-generated
--     avatar_url, so every write path (sign-up, provisioning, API, SQL) is
--     covered. Regenerating (a new generated URL) is still allowed.
--   * Existing profiles are backfilled.
-- =============================================================================

create or replace function private.generated_avatar_url(p_seed text)
returns text language sql immutable set search_path = '' as $$
  select 'https://api.dicebear.com/9.x/notionists/svg?seed='
    || replace(replace(replace(p_seed, '%', '%25'), '&', '%26'), ' ', '%20')
    || '&backgroundColor=c0aede,b6e3f4,d1d4f9,ffd5dc,ffdfbf'
$$;

create or replace function private.tg_profiles_generated_avatar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.avatar_url is null
     or new.avatar_url not like 'https://api.dicebear.com/9.x/notionists/svg?seed=%' then
    new.avatar_url := private.generated_avatar_url(new.id::text);
  end if;
  return new;
end $$;

create trigger profiles_generated_avatar
  before insert or update of avatar_url on public.profiles
  for each row execute function private.tg_profiles_generated_avatar();

-- Backfill every existing profile (fires the trigger above).
update public.profiles
set avatar_url = null
where avatar_url is null
   or avatar_url not like 'https://api.dicebear.com/9.x/notionists/svg?seed=%';
