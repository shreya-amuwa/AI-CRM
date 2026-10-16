-- =============================================================================
-- Amuwa Design Studio services, each with its own onboarding requirements.
--
-- Six new services in the catalogue under the category "Amuwa Design Studio" (codes DS_*):
--   Social Media Marketing, Google My Business Ranking, Meta Ads, AI Video Production,
--   Yearly Creative Package, Graphic Design.
-- They are separate from the existing services with similar names (GMB Ranking, Meta Ads Management,
-- Social Media Management, Yearly ... Creative Package), which are not touched.
--
-- Each service gets its OWN checklist items (codes DS_<service>_*), so what is saved for one service never
-- overwrites another service's details (customer_onboarding_entries is keyed by customer + item). The items use
-- the existing onboarding checklist: Sales fills them in Customer onboarding, the Technical Consultant reviews
-- them, and the existing role checks / RLS on entries and documents apply unchanged.
--
-- Account access is recorded as delegated access (ACCESS items: the account handle / ID and how access was
-- given, e.g. Meta Business partner access, YouTube channel manager, Google Business Profile manager).
-- Passwords are never asked for or stored: an entry that contains one is refused.
--
-- New: an item can be shown only when another item has a given answer (onboarding_items.shown_when_item /
-- shown_when_value). Used for Meta Ads "Creatives required?" -> the creative brief and assets appear only on
-- Yes. More such items can be configured in the same way. Existing items have no condition: unchanged.
--
-- Additive and idempotent (safe to rerun in the Supabase SQL editor). Nothing is deleted.
-- =============================================================================

-- 1. Conditional items -------------------------------------------------------------------------------
alter table public.onboarding_items
  add column if not exists shown_when_item text references public.onboarding_items (code) on delete set null,
  add column if not exists shown_when_value text check (length(shown_when_value) <= 200);

-- Same as before, plus: an item with a condition is part of the checklist only while the condition holds.
create or replace function private.onboarding_item_shown(p_customer uuid, p_item text, p_value text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_item is null or exists (
    select 1 from public.customer_onboarding_entries e
     where e.customer_id = p_customer and e.item_code = p_item and e.value = p_value)
$$;
revoke all on function private.onboarding_item_shown(uuid, text, text) from public, anon, authenticated;

create or replace function private.customer_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
  where i.is_active and i.filled_by = 'SALES' and (i.always_required or exists (
    select 1 from public.onboarding_item_services m
    join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
    where m.item_code = i.code))
    and (not i.is_optional or exists (
      select 1 from public.customer_onboarding_entries e where e.customer_id = p_customer and e.item_code = i.code))
    and private.onboarding_item_shown(p_customer, i.shown_when_item, i.shown_when_value)
$$;

create or replace function private.customer_optional_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
  where i.is_active and i.filled_by = 'SALES' and i.is_optional and (i.always_required or exists (
    select 1 from public.onboarding_item_services m
    join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
    where m.item_code = i.code))
    and not exists (
      select 1 from public.customer_onboarding_entries e where e.customer_id = p_customer and e.item_code = i.code)
    and private.onboarding_item_shown(p_customer, i.shown_when_item, i.shown_when_value)
$$;

create or replace function private.customer_addon_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
   where i.is_active and i.filled_by = 'SALES' and not i.always_required and exists (
     select 1 from public.onboarding_item_services m
      where m.item_code = i.code and m.service_code = any (private.customer_addon_codes(p_customer)))
     and private.onboarding_item_shown(p_customer, i.shown_when_item, i.shown_when_value)
$$;

-- 2. Services --------------------------------------------------------------------------------------
-- Inserted inactive and switched on below: the catalogue trigger announces every INSERTED active service to all
-- clients, and six pop-ups at once is not wanted. A Department Head can announce them with the existing
-- "announce a service" option. Switched on only the first time (before their checklist exists), so a rerun never
-- re-activates a service an administrator has switched off since.
insert into public.crm_services (code, name, category, sort_order, is_active) values
  ('DS_SOCIAL_MEDIA_MARKETING', 'Social Media Marketing', 'Amuwa Design Studio', 310, false),
  ('DS_GMB_RANKING', 'Google My Business Ranking', 'Amuwa Design Studio', 320, false),
  ('DS_META_ADS', 'Meta Ads', 'Amuwa Design Studio', 330, false),
  ('DS_AI_VIDEO_PRODUCTION', 'AI Video Production', 'Amuwa Design Studio', 340, false),
  ('DS_YEARLY_CREATIVE_PACKAGE', 'Yearly Creative Package', 'Amuwa Design Studio', 350, false),
  ('DS_GRAPHIC_DESIGN', 'Graphic Design', 'Amuwa Design Studio', 360, false)
on conflict (code) do nothing;

update public.crm_services s set is_active = true
 where s.code in ('DS_SOCIAL_MEDIA_MARKETING', 'DS_GMB_RANKING', 'DS_META_ADS', 'DS_AI_VIDEO_PRODUCTION',
                  'DS_YEARLY_CREATIVE_PACKAGE', 'DS_GRAPHIC_DESIGN')
   and not s.is_active
   and not exists (select 1 from public.onboarding_item_services m where m.service_code = s.code);

-- 3. Document types for the FILE items (2 MB, like every other customer document) -----------------------
insert into public.document_types (code, label, description, storage_folder, is_mandatory, allowed_mime_types, max_size_bytes, sort_order) values
  ('DS_META_BUSINESS_DOCS', 'Meta Ads - basic business documents', 'Combined into one PDF, or one image', 'onboarding', false,
     array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], 2097152, 310),
  ('DS_META_CREATIVE_ASSETS', 'Meta Ads - creative assets', 'Product photos / references, combined into one PDF, or one image', 'onboarding', false,
     array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], 2097152, 311),
  ('DS_AIV_LOGO', 'AI Video Production - business logo', '', 'onboarding', false,
     array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], 2097152, 320),
  ('DS_YCP_LOGO', 'Yearly Creative Package - business logo', '', 'onboarding', false,
     array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], 2097152, 330),
  ('DS_GD_LOGO', 'Graphic Design - business logo', '', 'onboarding', false,
     array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], 2097152, 340)
on conflict (code) do nothing;

-- 4. Items -----------------------------------------------------------------------------------------
insert into public.onboarding_items (code, section, label, hint, kind, options, always_required, sort_order, is_optional) values
  -- Social Media Marketing
  ('DS_SMM_INSTAGRAM', 'SERVICE', 'Instagram account', 'Username / account ID, and how access was given (collaborator or Meta Business partner access). Never a password.', 'ACCESS', null, false, 3110, false),
  ('DS_SMM_FACEBOOK', 'SERVICE', 'Facebook page access', 'Page name / ID, and how access was given (Meta Business partner access or page role). Never a password.', 'ACCESS', null, false, 3120, false),
  ('DS_SMM_BUSINESS_GMAIL', 'SERVICE', 'Business Gmail ID', 'The business Gmail address', 'DETAILS', null, false, 3130, false),
  ('DS_SMM_YOUTUBE', 'SERVICE', 'YouTube channel access', 'Channel name / link, and how access was given (channel permissions: Manager / Editor). Never a password.', 'ACCESS', null, false, 3140, false),
  -- Google My Business Ranking
  ('DS_GMB_PROFILE_ACCESS', 'SERVICE', 'Google Business Profile access', 'Profile name, and the e-mail added as Manager on the profile. Never a password.', 'ACCESS', null, false, 3210, false),
  ('DS_GMB_PROFILE_DETAILS', 'SERVICE', 'Business profile details', 'Profile link, business category, service area, target keywords and locations', 'DETAILS', null, false, 3220, false),
  -- Meta Ads
  ('DS_META_FACEBOOK_PAGE', 'SERVICE', 'Facebook Page ID & access', 'Page ID, and how access was given (Meta Business partner access). Never a password.', 'ACCESS', null, false, 3310, false),
  ('DS_META_INSTAGRAM', 'SERVICE', 'Instagram account & access', 'Username / account ID, and how access was given (connected in Meta Business). Never a password.', 'ACCESS', null, false, 3320, false),
  ('DS_META_BUSINESS_DOCS', 'SERVICE', 'Basic business documents', 'Combined into one PDF, or one image (2 MB)', 'FILE', null, false, 3330, false),
  ('DS_META_REQUIREMENTS', 'SERVICE', 'Business requirements', 'Goal, audience, locations, budget, offers - what the customer wants from the ads', 'DETAILS', null, false, 3340, false),
  ('DS_META_CREATIVES_REQUIRED', 'SERVICE', 'Creatives required?', 'Should Amuwa make the ad creatives?', 'YES_NO', null, false, 3350, false),
  ('DS_META_CREATIVE_BRIEF', 'SERVICE', 'Creative brief', 'Number of creatives, formats / sizes, message or offer, language, colours', 'DETAILS', null, false, 3360, false),
  ('DS_META_CREATIVE_ASSETS', 'SERVICE', 'Creative assets', 'Optional - product photos or reference creatives, combined into one PDF, or one image', 'FILE', null, false, 3370, true),
  -- AI Video Production
  ('DS_AIV_LOGO', 'SERVICE', 'Business logo', 'PNG, JPG or PDF (2 MB)', 'FILE', null, false, 3410, false),
  ('DS_AIV_BRAND_DETAILS', 'SERVICE', 'Brand details', 'Brand name, colours, fonts, tone and anything the videos must show', 'DETAILS', null, false, 3420, false),
  ('DS_AIV_PHONE', 'SERVICE', 'Business phone number', 'The number to show in the videos', 'DETAILS', null, false, 3430, false),
  ('DS_AIV_ADDRESS', 'SERVICE', 'Business address', 'The address to show in the videos', 'DETAILS', null, false, 3440, false),
  -- Yearly Creative Package
  ('DS_YCP_LOGO', 'SERVICE', 'Business logo', 'PNG, JPG or PDF (2 MB)', 'FILE', null, false, 3510, false),
  ('DS_YCP_BRAND_DETAILS', 'SERVICE', 'Brand details', 'Brand name, colours, fonts, tone and anything the creatives must show', 'DETAILS', null, false, 3520, false),
  ('DS_YCP_PHONE', 'SERVICE', 'Business phone number', 'The number to show on the creatives', 'DETAILS', null, false, 3530, false),
  ('DS_YCP_ADDRESS', 'SERVICE', 'Business address', 'The address to show on the creatives', 'DETAILS', null, false, 3540, false),
  -- Graphic Design
  ('DS_GD_LOGO', 'SERVICE', 'Business logo', 'PNG, JPG or PDF (2 MB)', 'FILE', null, false, 3610, false),
  ('DS_GD_BRAND_DETAILS', 'SERVICE', 'Brand details', 'Brand name, colours, fonts, tone and anything the designs must show', 'DETAILS', null, false, 3620, false),
  ('DS_GD_PHONE', 'SERVICE', 'Business phone number', 'The number to show on the designs', 'DETAILS', null, false, 3630, false),
  ('DS_GD_ADDRESS', 'SERVICE', 'Business address', 'The address to show on the designs', 'DETAILS', null, false, 3640, false)
on conflict (code) do nothing;

-- Meta Ads: the creative brief and assets only when creatives are required.
update public.onboarding_items set shown_when_item = 'DS_META_CREATIVES_REQUIRED', shown_when_value = 'YES'
 where code in ('DS_META_CREATIVE_BRIEF', 'DS_META_CREATIVE_ASSETS') and shown_when_item is null;

-- 5. Which items each service needs --------------------------------------------------------------------
insert into public.onboarding_item_services (item_code, service_code) values
  ('DS_SMM_INSTAGRAM', 'DS_SOCIAL_MEDIA_MARKETING'), ('DS_SMM_FACEBOOK', 'DS_SOCIAL_MEDIA_MARKETING'),
  ('DS_SMM_BUSINESS_GMAIL', 'DS_SOCIAL_MEDIA_MARKETING'), ('DS_SMM_YOUTUBE', 'DS_SOCIAL_MEDIA_MARKETING'),
  ('DS_GMB_PROFILE_ACCESS', 'DS_GMB_RANKING'), ('DS_GMB_PROFILE_DETAILS', 'DS_GMB_RANKING'),
  ('DS_META_FACEBOOK_PAGE', 'DS_META_ADS'), ('DS_META_INSTAGRAM', 'DS_META_ADS'), ('DS_META_BUSINESS_DOCS', 'DS_META_ADS'),
  ('DS_META_REQUIREMENTS', 'DS_META_ADS'), ('DS_META_CREATIVES_REQUIRED', 'DS_META_ADS'),
  ('DS_META_CREATIVE_BRIEF', 'DS_META_ADS'), ('DS_META_CREATIVE_ASSETS', 'DS_META_ADS'),
  ('DS_AIV_LOGO', 'DS_AI_VIDEO_PRODUCTION'), ('DS_AIV_BRAND_DETAILS', 'DS_AI_VIDEO_PRODUCTION'),
  ('DS_AIV_PHONE', 'DS_AI_VIDEO_PRODUCTION'), ('DS_AIV_ADDRESS', 'DS_AI_VIDEO_PRODUCTION'),
  ('DS_YCP_LOGO', 'DS_YEARLY_CREATIVE_PACKAGE'), ('DS_YCP_BRAND_DETAILS', 'DS_YEARLY_CREATIVE_PACKAGE'),
  ('DS_YCP_PHONE', 'DS_YEARLY_CREATIVE_PACKAGE'), ('DS_YCP_ADDRESS', 'DS_YEARLY_CREATIVE_PACKAGE'),
  ('DS_GD_LOGO', 'DS_GRAPHIC_DESIGN'), ('DS_GD_BRAND_DETAILS', 'DS_GRAPHIC_DESIGN'),
  ('DS_GD_PHONE', 'DS_GRAPHIC_DESIGN'), ('DS_GD_ADDRESS', 'DS_GRAPHIC_DESIGN')
on conflict do nothing;

-- 6. Checks on what is saved for these items (only DS_* items; every other item is unchanged) ---------------
create or replace function private.trg_check_design_studio_entry()
returns trigger language plpgsql set search_path = '' as $$
declare
  v text := coalesce(new.value, '');
  v_kind text;
begin
  if new.item_code not like 'DS\_%' or new.value is null then
    return new;
  end if;
  select i.kind into v_kind from public.onboarding_items i where i.code = new.item_code;
  -- Access is delegated, never shared as a password (account / access items only: an address may say "Pin: ...").
  if (v_kind = 'ACCESS' or new.item_code ~ '^DS_(SMM|GMB|META)_')
     and v ~* '(pass\s*word|passwd|pwd|\mpass\M)\s*[:=-]' then
    raise exception 'VALIDATION_ERROR: Do not enter passwords. Give Amuwa delegated access (partner / manager access) and note how it was given.' using errcode = 'P0001';
  end if;
  if v_kind = 'ACCESS' and length(btrim(v)) < 3 then
    raise exception 'VALIDATION_ERROR: Enter the account and how access was given.' using errcode = 'P0001';
  end if;
  if new.item_code = 'DS_SMM_BUSINESS_GMAIL' and btrim(v) !~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  if new.item_code like 'DS\_%\_PHONE' and (btrim(v) !~ '^\+?[0-9 ()-]{7,20}$' or length(regexp_replace(v, '[^0-9]', '', 'g')) not between 10 and 15) then
    raise exception 'VALIDATION_ERROR: Enter a valid phone number (10 to 15 digits).' using errcode = 'P0001';
  end if;
  if new.item_code like 'DS\_%\_ADDRESS' and length(btrim(v)) not between 10 and 500 then
    raise exception 'VALIDATION_ERROR: Enter the full business address (10 to 500 characters).' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.trg_check_design_studio_entry() from public, anon, authenticated;
drop trigger if exists customer_onboarding_entries_design_studio_check on public.customer_onboarding_entries;
create trigger customer_onboarding_entries_design_studio_check
  before insert or update of value on public.customer_onboarding_entries
  for each row execute function private.trg_check_design_studio_entry();

-- 7. Customers already in onboarding: recount with the new rule (nothing changes for existing items).
do $$
declare
  r record;
begin
  for r in select o.customer_id from public.customer_onboarding o
            where exists (select 1 from public.customer_services cs where cs.customer_id = o.customer_id and cs.service_code like 'DS\_%') loop
    perform private.refresh_onboarding_progress(r.customer_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
