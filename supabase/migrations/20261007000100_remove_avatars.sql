-- =============================================================================
-- Avatars are no longer used anywhere in the CRM. Undo the generated-avatar
-- trigger from 20261007000000 and clear every stored avatar URL.
-- =============================================================================

drop trigger if exists profiles_generated_avatar on public.profiles;
drop function if exists private.tg_profiles_generated_avatar();
drop function if exists private.generated_avatar_url(text);

update public.profiles set avatar_url = null where avatar_url is not null;
