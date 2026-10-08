-- =============================================================================
-- Service onboarding checklists + Technical Consultant verification.
--
--   onboarding_items            what to collect: business basics, per-service
--                               items (from the Service Onboarding guide) and
--                               the two mandatory documents
--   onboarding_item_services    which services need an item (shared items such
--                               as "Brand logo" are collected once)
--   customer_onboarding_entries what was collected for a customer, and its
--                               review state: SAVED → VERIFIED | REJECTED
--
-- Sales (owner / team head / department head) fill the checklist; support-team
-- members of the same department ("Technical Consultants") see customers once
-- they are forwarded to support and verify or reject each item.
-- Additive only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_items (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  section text not null check (section in ('BUSINESS_BASICS', 'SERVICE', 'MANDATORY_DOCUMENTS')),
  label text not null,
  hint text not null default '',
  kind text not null check (kind in ('DETAILS', 'FILE', 'YES_NO', 'APPROVAL', 'ACCESS', 'AMOUNT', 'CHOICE')),
  options text[],
  -- Required for every onboarding regardless of the services sold.
  always_required boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.onboarding_item_services (
  item_code text not null references public.onboarding_items (code) on delete cascade,
  service_code text not null references public.crm_services (code) on delete cascade,
  primary key (item_code, service_code)
);

-- FILE items store their files as customer_documents of the same code.
insert into public.document_types (code, label, description, storage_folder, is_mandatory, allowed_mime_types, max_size_bytes, sort_order) values
  ('GST_CERTIFICATE', 'GST certificate', '', 'onboarding', false, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], 10485760, 100),
  ('UDYAM_CERTIFICATE', 'Udyam certificate', '', 'onboarding', false, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], 10485760, 110),
  ('BRAND_LOGO', 'Brand logo', '', 'onboarding', false, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], 10485760, 120),
  ('AIQR_PAYMENT_SCANNER', 'Payment scanner (UPI QR)', '', 'onboarding', false, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], 10485760, 130),
  ('GBP_PHOTOS', 'Business photos', '', 'onboarding', false, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], 20971520, 140),
  ('VOICE_NUMBER_LIST', 'Mobile number list', '', 'onboarding', false,
     array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf'], 20971520, 150),
  ('VOICE_SCRIPT', 'Voice script or recording', '', 'onboarding', false,
     array['application/pdf', 'audio/mpeg', 'audio/wav', 'audio/mp4'], 20971520, 160),
  ('AICRM_EXISTING_DATA', 'Existing lead data', '', 'onboarding', false,
     array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], 20971520, 170)
on conflict (code) do nothing;

-- The private bucket now also accepts the file types above.
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv',
                                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                  'audio/mpeg', 'audio/wav', 'audio/mp4']
 where id = 'customer-documents';

insert into public.onboarding_items (code, section, label, hint, kind, options, always_required, sort_order) values
  -- Business basics
  ('BUSINESS_NAME_ADDRESS', 'BUSINESS_BASICS', 'Business name & address', 'Registered business name and full address', 'DETAILS', null, true, 10),
  ('CONTACT_PERSON_MOBILE', 'BUSINESS_BASICS', 'Contact person & mobile', 'Who we coordinate with, and their mobile number', 'DETAILS', null, true, 20),
  ('GST_CERTIFICATE', 'BUSINESS_BASICS', 'GST certificate', 'PDF or photo of the GST certificate', 'FILE', null, false, 30),
  ('UDYAM_CERTIFICATE', 'BUSINESS_BASICS', 'Udyam certificate', 'PDF or photo of the Udyam registration', 'FILE', null, false, 40),
  -- 1. WhatsApp API + Blue Tick
  ('FB_BUSINESS_MANAGER', 'SERVICE', 'Facebook Business Manager access', 'Partner access granted — note the BM ID', 'ACCESS', null, false, 110),
  ('WA_API_NUMBER', 'SERVICE', 'Number to register for WhatsApp API', 'The mobile number that will become the API number', 'DETAILS', null, false, 120),
  ('WA_NUMBER_NOT_ON_APP', 'SERVICE', 'Number is not active on the WhatsApp app', 'It must be removed from the WhatsApp / WhatsApp Business app', 'YES_NO', null, false, 130),
  ('WABA_ID', 'SERVICE', 'WABA ID', 'WhatsApp Business Account ID', 'DETAILS', null, false, 140),
  ('WA_PRICING_APPROVED', 'SERVICE', 'Current pricing approved by client', 'The Raksha Bandhan offer price has ended — confirm current pricing', 'APPROVAL', null, false, 150),
  -- 2. RCS
  ('RCS_DOMAIN_NAME', 'SERVICE', 'Domain name', 'e.g. brand.com', 'DETAILS', null, false, 210),
  ('RCS_BRAND_NAME', 'SERVICE', 'Brand name', 'As it should appear to recipients', 'DETAILS', null, false, 220),
  ('BRAND_LOGO', 'SERVICE', 'Brand logo', 'PNG, JPG or PDF', 'FILE', null, false, 230),
  ('RCS_DOMAIN_EMAIL', 'SERVICE', 'Domain mail ID', 'An e-mail address on the business domain', 'DETAILS', null, false, 240),
  ('RCS_MONTHLY_VOLUME', 'SERVICE', 'Expected monthly volume & pricing tier', 'Messages per month; 1-month free trial if applicable', 'DETAILS', null, false, 250),
  -- 3. AI Calling
  ('AI_CALL_BUSINESS_ROLE', 'SERVICE', 'Business details & caller''s role', 'What the business does and who the AI agent speaks as', 'DETAILS', null, false, 310),
  ('AI_CALL_CUSTOMER_NUMBER', 'SERVICE', 'Customer number', 'Number(s) the calls are made for / from', 'DETAILS', null, false, 320),
  ('AI_CALL_SCRIPT', 'SERVICE', 'Input for the AI agent script', 'Key points, offers, questions to ask', 'DETAILS', null, false, 330),
  ('AI_CALL_PLAN', 'SERVICE', 'Calling plan', 'Credit-based or unlimited monthly', 'CHOICE', array['Credit-based', 'Unlimited monthly'], false, 340),
  -- 4. Voice Message (Bulk)
  ('VOICE_SENDER_ID', 'SERVICE', 'Sender ID', 'The ID used for the broadcast', 'DETAILS', null, false, 410),
  ('VOICE_NUMBER_LIST', 'SERVICE', 'Mobile number list', 'CSV, Excel or PDF', 'FILE', null, false, 420),
  ('PORTFOLIO_FB_LINK', 'SERVICE', 'Portfolio & Facebook page link', 'Links to the portfolio and Facebook page', 'DETAILS', null, false, 430),
  ('VOICE_SCRIPT', 'SERVICE', 'Voice script or 15-second recording', 'PDF script or MP3 / WAV / M4A recording', 'FILE', null, false, 440),
  ('VOICE_RATE_VOLUME', 'SERVICE', 'Per-message rate & total send volume', 'e.g. ₹0.20 × 10,000 messages', 'DETAILS', null, false, 450),
  -- 5. AI QR
  ('SOCIAL_URLS', 'SERVICE', 'Instagram & Facebook URLs', 'Profile links', 'DETAILS', null, false, 510),
  ('AIQR_CONTACT', 'SERVICE', 'Name, number, e-mail & website', 'Shown on the QR page', 'DETAILS', null, false, 520),
  ('AIQR_PAYMENT_SCANNER', 'SERVICE', 'Payment scanner (UPI QR)', 'Image of the payment QR code', 'FILE', null, false, 530),
  ('AIQR_DEMO_VIDEO', 'SERVICE', 'Demo video link', 'Video to add to the QR page', 'DETAILS', null, false, 540),
  ('BILLING_CYCLE', 'SERVICE', 'Billing cycle', 'Monthly or yearly', 'CHOICE', array['Monthly', 'Yearly'], false, 550),
  -- 6. Crocodile
  ('CROC_CHANNEL', 'SERVICE', 'Channel details', '', 'DETAILS', null, false, 610),
  ('CROC_WEBHOOK', 'SERVICE', 'Webhook details', 'Endpoint URL and events', 'DETAILS', null, false, 620),
  ('CROC_TRACKING_SHEET', 'SERVICE', 'Notebook / tracking sheet', 'Link to the sheet', 'DETAILS', null, false, 630),
  -- 7. GBP Setup
  ('GBP_NO_EXISTING', 'SERVICE', 'Business has no existing Google Business Profile', 'Search Google Maps to confirm', 'YES_NO', null, false, 710),
  ('GBP_LISTING_DETAILS', 'SERVICE', 'Address, phone, category & timings', 'Exactly as they should appear on Google', 'DETAILS', null, false, 720),
  ('GBP_PHOTOS', 'SERVICE', 'Business photos', 'Combine into one PDF, or one photo', 'FILE', null, false, 730),
  -- 8. GBP Management
  ('GBP_PROFILE_ACCESS', 'SERVICE', 'Access to the existing profile', 'Manager access granted to Amuwa', 'ACCESS', null, false, 810),
  ('GBP_MONTHLY_UPDATES', 'SERVICE', 'Monthly updates', 'Offers, posts and new information for this month', 'DETAILS', null, false, 820),
  -- 9. Meta Ads / 10. Social Media / 11–12. Packages
  ('META_CAMPAIGN_GOAL', 'SERVICE', 'Business type & campaign goal', 'e.g. walk-in leads for Diwali', 'DETAILS', null, false, 910),
  ('FACEBOOK_PAGE_ACCESS', 'SERVICE', 'Facebook page access', 'Partner access to the Amuwa Business Manager', 'ACCESS', null, false, 920),
  ('INSTAGRAM_PAGE_ACCESS', 'SERVICE', 'Instagram page access', 'Account connected / access granted', 'ACCESS', null, false, 930),
  ('META_TARGET_AUDIENCE', 'SERVICE', 'Target audience & leads needed', 'Who to reach and how many leads', 'DETAILS', null, false, 940),
  ('META_AD_BUDGET', 'SERVICE', 'Monthly ad budget', 'Paid by the client directly to Meta', 'AMOUNT', null, false, 950),
  ('SMM_BUSINESS_AUDIENCE', 'SERVICE', 'Business model & target audience', '', 'DETAILS', null, false, 1010),
  ('SMM_CONTENT_LIBRARY', 'SERVICE', 'Client content library', 'Link to photos / videos provided by the client', 'DETAILS', null, false, 1020),
  ('SMM_POSTING_PREFS', 'SERVICE', 'Posting schedule, captions & hashtags', 'Preferences agreed with the client', 'DETAILS', null, false, 1030),
  -- 13. AI Character Video
  ('ACV_CONCEPT', 'SERVICE', 'Concept or story brief', '', 'DETAILS', null, false, 1310),
  ('ACV_CHARACTERS', 'SERVICE', 'Characters & scenes', '', 'DETAILS', null, false, 1320),
  ('ACV_PRICE_APPROVED', 'SERVICE', 'Final price confirmed', 'Based on complexity', 'APPROVAL', null, false, 1330),
  -- 14. Basic Video Editing
  ('REEL_RAW_FOOTAGE', 'SERVICE', 'Raw footage', 'Drive / WeTransfer link to product, live or raw clips', 'DETAILS', null, false, 1410),
  ('REEL_STYLE', 'SERVICE', 'Editing style', 'Cuts, music, transitions, captions', 'DETAILS', null, false, 1420),
  -- 15. Content Shoot
  ('SHOOT_LOCATION_DATE', 'SERVICE', 'Shoot location, date & scope', 'Up to 3–4 hours per location', 'DETAILS', null, false, 1510),
  ('SHOOT_SUBJECT', 'SERVICE', 'Shoot subject', '', 'CHOICE', array['Product', 'Personal branding', 'Business content'], false, 1520),
  -- 16–19. Creatives
  ('CREATIVE_BRIEF', 'SERVICE', 'Creative brief', 'Offer, announcement, festival wish…', 'DETAILS', null, false, 1610),
  ('BRAND_COLOURS', 'SERVICE', 'Brand colours', 'Names or hex codes, e.g. Maroon #7A1F2B', 'DETAILS', null, false, 1620),
  ('FESTIVAL_LIST', 'SERVICE', 'Festival list / calendar for the year', '', 'DETAILS', null, false, 1710),
  ('GOLD_CONFIRM_JEWELLER', 'SERVICE', 'Business is a jeweller / gold business', '', 'YES_NO', null, false, 1810),
  ('GOLD_TEMPLATE_APPROVAL', 'SERVICE', 'Gold-rate template approval', 'Client approved the daily template design', 'APPROVAL', null, false, 1820),
  ('PROMO_PRODUCT_LIST', 'SERVICE', 'Product / service list', '', 'DETAILS', null, false, 1910),
  ('PROMO_CALENDAR', 'SERVICE', 'Promotional calendar', 'Offers, launches, seasonal themes', 'DETAILS', null, false, 1920),
  -- 20. Branding
  ('BRANDING_GOALS', 'SERVICE', 'Business / individual & goals', '', 'DETAILS', null, false, 2010),
  ('BRANDING_VISUAL_DIRECTION', 'SERVICE', 'Visual identity direction', 'Colours and logo direction', 'DETAILS', null, false, 2020),
  ('BRANDING_QUOTE', 'SERVICE', 'Custom quote agreed', 'Amount confirmed with the client', 'AMOUNT', null, false, 2030),
  -- 21. AI CRM
  ('AICRM_BUSINESS', 'SERVICE', 'Industry, address, contact person & website', '', 'DETAILS', null, false, 2110),
  ('AICRM_PURPOSE_FUNNEL', 'SERVICE', 'CRM purpose & current sales funnel stages', '', 'DETAILS', null, false, 2120),
  ('AICRM_LEAD_SOURCES', 'SERVICE', 'Lead sources to connect', 'WhatsApp API, Meta Ads, website forms, Instagram DMs, AI Calling', 'DETAILS', null, false, 2130),
  ('AICRM_AUTOMATION', 'SERVICE', 'Automation setup', 'Follow-up templates, triggers, booking, AI replies, escalation rules', 'DETAILS', null, false, 2140),
  ('AICRM_EXISTING_DATA', 'SERVICE', 'Existing lead data', 'CSV or Excel export', 'FILE', null, false, 2150),
  ('AICRM_USERS_INTEGRATIONS', 'SERVICE', 'Users & integrations', 'Who needs access; accounting, inventory, calling software', 'DETAILS', null, false, 2160),
  -- Mandatory documents (always last)
  ('INVOICE', 'MANDATORY_DOCUMENTS', 'Invoice', 'Invoice issued to the customer', 'FILE', null, true, 9010),
  ('IMPORTANT_DOCUMENTS', 'MANDATORY_DOCUMENTS', 'All Important Documents',
   'Upload the customer''s important business documents, such as Aadhaar Card, PAN Card and other required documents, combined into a single PDF.',
   'FILE', null, true, 9020)
on conflict (code) do nothing;

insert into public.onboarding_item_services (item_code, service_code)
select i, s from (values
  ('GST_CERTIFICATE', 'WHATSAPP_API_BLUE_TICK'), ('GST_CERTIFICATE', 'RCS_REGISTRATION'), ('GST_CERTIFICATE', 'AI_CALLING'), ('GST_CERTIFICATE', 'AI_CRM'),
  ('UDYAM_CERTIFICATE', 'WHATSAPP_API_BLUE_TICK'), ('UDYAM_CERTIFICATE', 'RCS_REGISTRATION'),
  ('FB_BUSINESS_MANAGER', 'WHATSAPP_API_BLUE_TICK'), ('WA_API_NUMBER', 'WHATSAPP_API_BLUE_TICK'), ('WA_NUMBER_NOT_ON_APP', 'WHATSAPP_API_BLUE_TICK'),
  ('WABA_ID', 'WHATSAPP_API_BLUE_TICK'), ('WA_PRICING_APPROVED', 'WHATSAPP_API_BLUE_TICK'),
  ('RCS_DOMAIN_NAME', 'RCS_REGISTRATION'), ('RCS_BRAND_NAME', 'RCS_REGISTRATION'), ('BRAND_LOGO', 'RCS_REGISTRATION'),
  ('RCS_DOMAIN_EMAIL', 'RCS_REGISTRATION'), ('RCS_MONTHLY_VOLUME', 'RCS_REGISTRATION'),
  ('AI_CALL_BUSINESS_ROLE', 'AI_CALLING'), ('AI_CALL_CUSTOMER_NUMBER', 'AI_CALLING'), ('AI_CALL_SCRIPT', 'AI_CALLING'), ('AI_CALL_PLAN', 'AI_CALLING'),
  ('VOICE_SENDER_ID', 'VOICE_MESSAGE_BULK'), ('VOICE_NUMBER_LIST', 'VOICE_MESSAGE_BULK'), ('PORTFOLIO_FB_LINK', 'VOICE_MESSAGE_BULK'),
  ('VOICE_SCRIPT', 'VOICE_MESSAGE_BULK'), ('VOICE_RATE_VOLUME', 'VOICE_MESSAGE_BULK'),
  ('SOCIAL_URLS', 'AI_QR'), ('AIQR_CONTACT', 'AI_QR'), ('BRAND_LOGO', 'AI_QR'), ('AIQR_PAYMENT_SCANNER', 'AI_QR'),
  ('AIQR_DEMO_VIDEO', 'AI_QR'), ('BILLING_CYCLE', 'AI_QR'),
  ('CROC_CHANNEL', 'CROCODILE_CHANNEL_WEBHOOK'), ('CROC_WEBHOOK', 'CROCODILE_CHANNEL_WEBHOOK'),
  ('CROC_TRACKING_SHEET', 'CROCODILE_CHANNEL_WEBHOOK'), ('BILLING_CYCLE', 'CROCODILE_CHANNEL_WEBHOOK'),
  ('GBP_NO_EXISTING', 'GBP_SETUP'), ('GBP_LISTING_DETAILS', 'GBP_SETUP'), ('GBP_PHOTOS', 'GBP_SETUP'),
  ('GBP_PROFILE_ACCESS', 'GBP_MANAGEMENT'), ('GBP_MONTHLY_UPDATES', 'GBP_MANAGEMENT'),
  ('META_CAMPAIGN_GOAL', 'META_ADS_MANAGEMENT'), ('FACEBOOK_PAGE_ACCESS', 'META_ADS_MANAGEMENT'), ('INSTAGRAM_PAGE_ACCESS', 'META_ADS_MANAGEMENT'),
  ('META_TARGET_AUDIENCE', 'META_ADS_MANAGEMENT'), ('META_AD_BUDGET', 'META_ADS_MANAGEMENT'),
  ('SMM_BUSINESS_AUDIENCE', 'SOCIAL_MEDIA_MANAGEMENT'), ('FACEBOOK_PAGE_ACCESS', 'SOCIAL_MEDIA_MANAGEMENT'),
  ('INSTAGRAM_PAGE_ACCESS', 'SOCIAL_MEDIA_MANAGEMENT'), ('SMM_CONTENT_LIBRARY', 'SOCIAL_MEDIA_MANAGEMENT'), ('SMM_POSTING_PREFS', 'SOCIAL_MEDIA_MANAGEMENT'),
  ('SMM_BUSINESS_AUDIENCE', 'STARTER_PACKAGE'), ('FACEBOOK_PAGE_ACCESS', 'STARTER_PACKAGE'), ('INSTAGRAM_PAGE_ACCESS', 'STARTER_PACKAGE'),
  ('SMM_CONTENT_LIBRARY', 'STARTER_PACKAGE'), ('SMM_POSTING_PREFS', 'STARTER_PACKAGE'),
  ('META_TARGET_AUDIENCE', 'STARTER_PACKAGE'), ('META_AD_BUDGET', 'STARTER_PACKAGE'),
  ('SMM_BUSINESS_AUDIENCE', 'GROWTH_PACKAGE'), ('FACEBOOK_PAGE_ACCESS', 'GROWTH_PACKAGE'), ('INSTAGRAM_PAGE_ACCESS', 'GROWTH_PACKAGE'),
  ('SMM_CONTENT_LIBRARY', 'GROWTH_PACKAGE'), ('SMM_POSTING_PREFS', 'GROWTH_PACKAGE'),
  ('META_TARGET_AUDIENCE', 'GROWTH_PACKAGE'), ('META_AD_BUDGET', 'GROWTH_PACKAGE'),
  ('ACV_CONCEPT', 'AI_CHARACTER_VIDEO'), ('ACV_CHARACTERS', 'AI_CHARACTER_VIDEO'), ('ACV_PRICE_APPROVED', 'AI_CHARACTER_VIDEO'),
  ('REEL_RAW_FOOTAGE', 'BASIC_VIDEO_EDITING_REEL'), ('REEL_STYLE', 'BASIC_VIDEO_EDITING_REEL'),
  ('SHOOT_LOCATION_DATE', 'CONTENT_SHOOT'), ('SHOOT_SUBJECT', 'CONTENT_SHOOT'),
  ('CREATIVE_BRIEF', 'SINGLE_CREATIVE_DESIGN'), ('BRAND_LOGO', 'SINGLE_CREATIVE_DESIGN'), ('BRAND_COLOURS', 'SINGLE_CREATIVE_DESIGN'),
  ('BRAND_LOGO', 'YEARLY_FESTIVAL_CREATIVE_PACKAGE'), ('BRAND_COLOURS', 'YEARLY_FESTIVAL_CREATIVE_PACKAGE'), ('FESTIVAL_LIST', 'YEARLY_FESTIVAL_CREATIVE_PACKAGE'),
  ('GOLD_CONFIRM_JEWELLER', 'YEARLY_GOLD_RATE_PACKAGE'), ('BRAND_LOGO', 'YEARLY_GOLD_RATE_PACKAGE'),
  ('BRAND_COLOURS', 'YEARLY_GOLD_RATE_PACKAGE'), ('GOLD_TEMPLATE_APPROVAL', 'YEARLY_GOLD_RATE_PACKAGE'),
  ('BRAND_LOGO', 'YEARLY_PROMOTIONAL_CREATIVE_PACKAGE'), ('BRAND_COLOURS', 'YEARLY_PROMOTIONAL_CREATIVE_PACKAGE'),
  ('PROMO_PRODUCT_LIST', 'YEARLY_PROMOTIONAL_CREATIVE_PACKAGE'), ('PROMO_CALENDAR', 'YEARLY_PROMOTIONAL_CREATIVE_PACKAGE'),
  ('BRANDING_GOALS', 'BRANDING_PERSONAL_BRANDING'), ('BRANDING_VISUAL_DIRECTION', 'BRANDING_PERSONAL_BRANDING'),
  ('BRAND_COLOURS', 'BRANDING_PERSONAL_BRANDING'), ('BRANDING_QUOTE', 'BRANDING_PERSONAL_BRANDING'),
  ('AICRM_BUSINESS', 'AI_CRM'), ('AICRM_PURPOSE_FUNNEL', 'AI_CRM'), ('AICRM_LEAD_SOURCES', 'AI_CRM'),
  ('AICRM_AUTOMATION', 'AI_CRM'), ('AICRM_EXISTING_DATA', 'AI_CRM'), ('AICRM_USERS_INTEGRATIONS', 'AI_CRM')
) v(i, s)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Per-customer entries
-- ---------------------------------------------------------------------------
create table if not exists public.customer_onboarding_entries (
  customer_id uuid not null references public.customers (id) on delete cascade,
  item_code text not null references public.onboarding_items (code) on delete restrict,
  value text check (length(value) <= 4000),
  document_id uuid references public.customer_documents (id) on delete set null,
  status text not null default 'SAVED' check (status in ('SAVED', 'VERIFIED', 'REJECTED')),
  saved_by uuid references public.profiles (id) on delete set null,
  saved_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 1000),
  primary key (customer_id, item_code)
);
create index if not exists customer_onboarding_entries_status_idx on public.customer_onboarding_entries (customer_id, status);

alter table public.customer_onboarding
  add column if not exists items_total integer not null default 0,
  add column if not exists items_saved integer not null default 0,
  add column if not exists items_verified integer not null default 0,
  add column if not exists items_rejected integer not null default 0;
-- Derived states used by list filters (PostgREST cannot compare two columns).
alter table public.customer_onboarding
  add column if not exists onboarding_state text generated always as (
    case when items_saved = 0 then 'WAITING_ON_CLIENT'
         when items_total > 0 and items_saved >= items_total then 'READY_FOR_HANDOVER'
         else 'COLLECTING' end) stored,
  add column if not exists review_state text generated always as (
    case when items_rejected > 0 then 'NEEDS_FIX'
         when items_total > 0 and items_verified >= items_total then 'VERIFIED'
         else 'TO_REVIEW' end) stored;
create index if not exists customer_onboarding_review_idx
  on public.customer_onboarding (forwarded_to_support_at) where forwarded_to_support_at is not null;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- Items that apply to a customer: always-required ones plus those needed by
-- any service sold to them.
create or replace function private.customer_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
  where i.is_active and (i.always_required or exists (
    select 1 from public.onboarding_item_services m
    join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
    where m.item_code = i.code))
$$;
revoke all on function private.customer_items(uuid) from public, anon, authenticated;

-- Support-team member ("Technical Consultant") of the customer's department,
-- for a customer that has been forwarded to support. Department heads and the
-- super admin can review too.
create or replace function private.my_support_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.department_id from public.profiles p join public.teams t on t.id = p.team_id
  where p.id = auth.uid() and p.status = 'ACTIVE' and t.division = 'SUPPORT'
$$;
grant execute on function private.my_support_department_id() to authenticated;

create or replace function private.onboarding_forwarded(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer and o.forwarded_to_support_at is not null)
$$;
grant execute on function private.onboarding_forwarded(uuid) to authenticated;

create or replace function private.can_review_onboarding(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and private.onboarding_forwarded(c.id)
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()))
$$;
grant execute on function private.can_review_onboarding(uuid) to authenticated;

create or replace function private.refresh_onboarding_progress(p_customer uuid)
returns void language sql security definer set search_path = '' as $$
  with items as (select code from private.customer_items(p_customer)),
  e as (
    select e.status from public.customer_onboarding_entries e
    join items i on i.code = e.item_code
    where e.customer_id = p_customer)
  update public.customer_onboarding o set
    mandatory_saved = (
      select count(distinct d.document_type) from public.customer_documents d
      join public.document_types t on t.code = d.document_type and t.is_mandatory
      where d.customer_id = p_customer and d.status = 'UPLOADED'),
    items_total = (select count(*) from items),
    items_saved = (select count(*) from e where status in ('SAVED', 'VERIFIED')),
    items_verified = (select count(*) from e where status = 'VERIFIED'),
    items_rejected = (select count(*) from e where status = 'REJECTED')
  where o.customer_id = p_customer
$$;
revoke all on function private.refresh_onboarding_progress(uuid) from public, anon, authenticated;

-- New onboarding rows get their item count straight away.
create or replace function private.tg_customer_onboarding_init()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_onboarding_progress(new.customer_id);
  return null;
end $$;
drop trigger if exists customer_onboarding_init on public.customer_onboarding;
create trigger customer_onboarding_init after insert on public.customer_onboarding
  for each row execute function private.tg_customer_onboarding_init();

-- File items follow their documents: a finished upload saves the item (and
-- resets any earlier review); deleting the current file clears it.
create or replace function private.tg_customer_documents_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.onboarding_items i where i.code = new.document_type and i.kind = 'FILE') then
    return null;
  end if;
  if new.status = 'UPLOADED' and old.status is distinct from 'UPLOADED' then
    insert into public.customer_onboarding_entries as e (customer_id, item_code, value, document_id, status, saved_by, saved_at)
    values (new.customer_id, new.document_type, new.original_file_name, new.id, 'SAVED', new.uploaded_by, now())
    on conflict (customer_id, item_code) do update
      set value = excluded.value, document_id = excluded.document_id, status = 'SAVED', saved_by = excluded.saved_by,
          saved_at = now(), reviewed_by = null, reviewed_at = null,
          review_note = case when e.status = 'REJECTED' then e.review_note end;
  elsif new.status = 'DELETED' and old.status = 'UPLOADED' then
    delete from public.customer_onboarding_entries where customer_id = new.customer_id and document_id = new.id;
  end if;
  perform private.refresh_onboarding_progress(new.customer_id);
  return null;
end $$;
drop trigger if exists customer_documents_entry on public.customer_documents;
create trigger customer_documents_entry after update of status on public.customer_documents
  for each row execute function private.tg_customer_documents_entry();

-- ---------------------------------------------------------------------------
-- 4. RLS: reviewers can read forwarded customers of their department
-- ---------------------------------------------------------------------------
alter table public.onboarding_items enable row level security;
alter table public.onboarding_item_services enable row level security;
alter table public.customer_onboarding_entries enable row level security;
grant select on public.onboarding_items, public.onboarding_item_services, public.customer_onboarding_entries to authenticated;
revoke insert, update, delete on public.customer_onboarding_entries from authenticated, anon;

drop policy if exists onboarding_items_select on public.onboarding_items;
create policy onboarding_items_select on public.onboarding_items for select to authenticated
  using ((select private.my_id()) is not null);
drop policy if exists onboarding_item_services_select on public.onboarding_item_services;
create policy onboarding_item_services_select on public.onboarding_item_services for select to authenticated
  using ((select private.my_id()) is not null);
drop policy if exists customer_onboarding_entries_select on public.customer_onboarding_entries;
create policy customer_onboarding_entries_select on public.customer_onboarding_entries for select to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));

-- Read-only access for Technical Consultants. Child tables (documents,
-- services, onboarding, activities) follow customer visibility for SELECT.
drop policy if exists customers_select_review on public.customers;
create policy customers_select_review on public.customers for select to authenticated
  using (department_id = (select private.my_support_department_id()) and private.onboarding_forwarded(id));

-- Writes to services and onboarding stay with the sales hierarchy only.
drop policy if exists customer_services_insert on public.customer_services;
create policy customer_services_insert on public.customer_services for insert to authenticated
  with check (private.can_access_customer(customer_id));
drop policy if exists customer_services_delete on public.customer_services;
create policy customer_services_delete on public.customer_services for delete to authenticated
  using (private.can_access_customer(customer_id));
drop policy if exists customer_onboarding_update on public.customer_onboarding;
create policy customer_onboarding_update on public.customer_onboarding for update to authenticated
  using (private.can_access_customer(customer_id)) with check (private.can_access_customer(customer_id));

-- ---------------------------------------------------------------------------
-- 5. Functions
-- ---------------------------------------------------------------------------
-- The checklist for one customer, grouped by section, with each item's state.
create or replace function public.customer_onboarding_checklist(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not (private.can_access_customer(p_customer) or private.can_review_onboarding(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'code', i.code, 'section', i.section, 'label', i.label, 'hint', i.hint, 'kind', i.kind, 'options', i.options,
      -- Shared items are listed under the first sold service that needs them.
      'serviceCode', (select m.service_code from public.onboarding_item_services m
                       join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
                       join public.crm_services s on s.code = m.service_code
                      where m.item_code = i.code order by s.sort_order limit 1),
      'services', (select coalesce(jsonb_agg(m.service_code order by m.service_code), '[]'::jsonb) from public.onboarding_item_services m
                    join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
                   where m.item_code = i.code),
      'allowedMimeTypes', t.allowed_mime_types, 'maxSizeBytes', t.max_size_bytes,
      'entry', case when e.item_code is null then null else jsonb_build_object(
        'status', e.status, 'value', e.value, 'documentId', e.document_id,
        'savedBy', (select full_name from public.profiles where id = e.saved_by), 'savedAt', e.saved_at,
        'reviewedBy', (select full_name from public.profiles where id = e.reviewed_by), 'reviewedAt', e.reviewed_at,
        'reviewNote', e.review_note) end)
    order by case i.section when 'BUSINESS_BASICS' then 0 when 'SERVICE' then 1 else 2 end, i.sort_order), '[]'::jsonb)
  into v_result
  from private.customer_items(p_customer) i
  left join public.document_types t on t.code = i.code and i.kind = 'FILE'
  left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code;
  return v_result;
end $$;

-- Sales saves a non-file item. Saving again resets an earlier review.
create or replace function public.save_onboarding_entry(p_customer uuid, p_item text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  i public.onboarding_items;
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Details are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into i from private.customer_items(p_customer) x where x.code = p_item;
  if i.code is null then
    raise exception 'VALIDATION_ERROR: This item is not part of this customer''s onboarding.' using errcode = 'P0001';
  end if;
  if i.kind = 'FILE' then
    raise exception 'VALIDATION_ERROR: Upload a file for this item.' using errcode = 'P0001';
  end if;
  if v_value is null then
    raise exception 'VALIDATION_ERROR: Enter a value.' using errcode = 'P0001';
  end if;
  if length(v_value) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep it under 4000 characters.' using errcode = 'P0001';
  end if;
  if i.kind = 'YES_NO' and v_value not in ('YES', 'NO') then
    raise exception 'VALIDATION_ERROR: Answer yes or no.' using errcode = 'P0001';
  end if;
  if i.kind = 'AMOUNT' and v_value !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
    raise exception 'VALIDATION_ERROR: Enter an amount in rupees.' using errcode = 'P0001';
  end if;
  if i.kind = 'CHOICE' and not (v_value = any (i.options)) then
    raise exception 'VALIDATION_ERROR: Choose one of the options.' using errcode = 'P0001';
  end if;

  insert into public.customer_onboarding_entries as e (customer_id, item_code, value, status, saved_by, saved_at)
  values (p_customer, p_item, v_value, 'SAVED', (select private.my_id()), now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, status = 'SAVED', saved_by = excluded.saved_by, saved_at = now(),
        reviewed_by = null, reviewed_at = null,
        review_note = case when e.status = 'REJECTED' then e.review_note end;

  perform private.log_customer_activity(p_customer, 'ONBOARDING_ITEM_SAVED', format('%s saved', i.label));
  perform private.write_audit('ONBOARDING_ITEM_SAVED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('item', p_item));
  perform private.refresh_onboarding_progress(p_customer);
end $$;

-- Technical Consultant verifies or rejects one item.
create or replace function public.review_onboarding_entry(p_customer uuid, p_item text, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  i public.onboarding_items;
  e public.customer_onboarding_entries;
  o public.customer_onboarding;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_decision not in ('VERIFIED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose verify or reject.' using errcode = 'P0001';
  end if;
  if p_decision = 'REJECTED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Tell the sales team what needs fixing.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into i from public.onboarding_items where code = p_item;
  select * into e from public.customer_onboarding_entries where customer_id = p_customer and item_code = p_item for update;
  if e.item_code is null then
    raise exception 'CONFLICT: Nothing has been saved for this item yet.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding_entries
     set status = p_decision, reviewed_by = (select private.my_id()), reviewed_at = now(), review_note = left(v_note, 1000)
   where customer_id = p_customer and item_code = p_item;
  perform private.refresh_onboarding_progress(p_customer);

  perform private.log_customer_activity(p_customer,
    case when p_decision = 'VERIFIED' then 'ONBOARDING_ITEM_VERIFIED' else 'ONBOARDING_ITEM_REJECTED' end,
    case when p_decision = 'VERIFIED' then format('%s verified', i.label) else format('%s needs fixing: %s', i.label, v_note) end);
  perform private.write_audit(case when p_decision = 'VERIFIED' then 'ONBOARDING_ITEM_VERIFIED' else 'ONBOARDING_ITEM_REJECTED' end,
    'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('item', p_item, 'note', v_note));

  select * into o from public.customer_onboarding where customer_id = p_customer;
  if p_decision = 'REJECTED' then
    perform private.notify(v.owner_id, 'ONBOARDING_ITEM_REJECTED', format('Needs fixing: %s', coalesce(v.company, v.name)),
      format('%s — %s', i.label, v_note), 'customer', p_customer, '{}'::jsonb, 'urgent');
  elsif o.items_total > 0 and o.items_verified = o.items_total then
    perform private.notify(v.owner_id, 'ONBOARDING_VERIFIED', format('Onboarding verified: %s', coalesce(v.company, v.name)),
      'All documents and details were verified by the technical team.', 'customer', p_customer);
  end if;
end $$;

-- Forwarding now needs every checklist item saved (none missing or rejected),
-- and notifies the whole support team of the department.
create or replace function public.forward_onboarding_to_support(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  v_missing text;
  v_recipient uuid;
begin
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_onboarding where customer_id = p_id and forwarded_to_support_at is not null) then
    raise exception 'CONFLICT: Already forwarded to the support team.' using errcode = 'P0001';
  end if;
  select string_agg(i.label, ', ' order by i.sort_order) into v_missing
  from private.customer_items(p_id) i
  where not exists (select 1 from public.customer_onboarding_entries e
                    where e.customer_id = p_id and e.item_code = i.code and e.status in ('SAVED', 'VERIFIED'));
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: Complete these items first: %.', v_missing using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set stage = 'SETUP', forwarded_to_support_at = now(), forwarded_by = (select private.my_id())
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'FORWARDED_TO_SUPPORT', 'Forwarded to the technical team for verification and setup');
  perform private.write_audit('ONBOARDING_FORWARDED', 'customer', p_id, v.department_id, v.team_id, '{}'::jsonb);

  for v_recipient in
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
    where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
  loop
    perform private.notify(v_recipient, 'ONBOARDING_FORWARDED', format('Verify onboarding: %s', coalesce(v.company, v.name)),
      'Documents and details are ready for verification.', 'customer', p_id);
  end loop;
end $$;

-- Uploads: any file type the item allows; the stored file keeps a matching
-- extension. Paths still contain ids only.
create or replace function public.begin_document_upload(
  p_customer uuid, p_type text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  t public.document_types;
  d public.customer_documents;
  v_id uuid := gen_random_uuid();
  v_ext text;
begin
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Documents are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = p_type;
  if t.code is null then
    raise exception 'VALIDATION_ERROR: Unknown document type.' using errcode = 'P0001';
  end if;
  if p_mime is null or not (p_mime = any (t.allowed_mime_types)) then
    raise exception 'VALIDATION_ERROR: This file type is not accepted for %.', t.label using errcode = 'P0001';
  end if;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File must be smaller than % MB.', t.max_size_bytes / 1048576 using errcode = 'P0001';
  end if;
  v_ext := case p_mime
    when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'text/csv' then 'csv' when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'audio/mpeg' then 'mp3' when 'audio/wav' then 'wav' when 'audio/mp4' then 'm4a' else 'bin' end;

  insert into public.customer_documents (id, customer_id, document_type, version, status, storage_path,
                                         original_file_name, mime_type, size_bytes, uploaded_by)
  values (v_id, p_customer, p_type, null, 'PENDING',
          format('customers/%s/%s/%s.%s', p_customer, t.storage_folder, v_id, v_ext),
          left(regexp_replace(coalesce(nullif(trim(p_file_name), ''), 'document.' || v_ext), '[\r\n\t/\\]', '_', 'g'), 255),
          p_mime, p_size, (select private.my_id()))
  returning * into d;
  return d;
end $$;

-- Viewing/downloading is also allowed for Technical Consultants reviewing the customer.
create or replace function public.authorize_document_access(p_document uuid, p_action text)
returns table (storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
begin
  select * into d from public.customer_documents where id = p_document;
  if d.id is null or d.status not in ('UPLOADED', 'SUPERSEDED')
     or not (private.can_access_customer(d.customer_id) or private.can_review_onboarding(d.customer_id)) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = d.customer_id;
  perform private.write_audit(case when p_action = 'DOWNLOAD' then 'DOCUMENT_DOWNLOADED' else 'DOCUMENT_VIEWED' end,
    'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version));
  return query select d.storage_bucket, d.storage_path, d.original_file_name, d.mime_type;
end $$;

-- Onboarding filters now count every checklist item, not only the two documents.
create or replace function public.customer_pipeline_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with c as (
    select c.lifecycle_stage, c.lead_status, c.amount_received, c.payment_due_date,
           coalesce(o.items_saved, 0) as saved, coalesce(o.items_total, 0) as total
    from public.customers c
    left join public.customer_onboarding o on o.customer_id = c.id
    where c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING')
      and private.can_access_customer(c.id)
  ), m as (select count(*) as n from public.document_types where is_mandatory)
  select jsonb_build_object(
    'leads', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'LEAD'),
      'NEW', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'NEW'),
      'CONTACTED', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'CONTACTED'),
      'INTERESTED', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'INTERESTED'),
      'READY_TO_BUY', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'READY_TO_BUY')),
    'potential', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
      'AWAITING', count(*) filter (where lifecycle_stage = 'POTENTIAL' and amount_received = 0 and payment_due_date >= current_date),
      'PART_PAID', count(*) filter (where lifecycle_stage = 'POTENTIAL' and amount_received > 0 and payment_due_date >= current_date),
      'OVERDUE', count(*) filter (where lifecycle_stage = 'POTENTIAL' and payment_due_date < current_date)),
    'onboarding', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
      'WAITING_ON_CLIENT', count(*) filter (where lifecycle_stage = 'ONBOARDING' and saved = 0),
      'COLLECTING', count(*) filter (where lifecycle_stage = 'ONBOARDING' and saved > 0 and saved < total),
      'READY_FOR_HANDOVER', count(*) filter (where lifecycle_stage = 'ONBOARDING' and total > 0 and saved >= total)),
    'mandatoryDocuments', (select n from m))
  from c
$$;

-- Name of the sales owner, for reviewers who cannot read sales profiles.
create or replace function public.customer_owner_summary(p_customer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'fullName', p.full_name)
  from public.customers c join public.profiles p on p.id = c.owner_id
  where c.id = p_customer and (private.can_access_customer(c.id) or private.can_review_onboarding(c.id))
$$;
revoke all on function public.customer_owner_summary(uuid) from public, anon;
grant execute on function public.customer_owner_summary(uuid) to authenticated;

revoke all on function public.customer_onboarding_checklist(uuid) from public, anon;
revoke all on function public.save_onboarding_entry(uuid, text, text) from public, anon;
revoke all on function public.review_onboarding_entry(uuid, text, text, text) from public, anon;
grant execute on function public.customer_onboarding_checklist(uuid) to authenticated;
grant execute on function public.save_onboarding_entry(uuid, text, text) to authenticated;
grant execute on function public.review_onboarding_entry(uuid, text, text, text) to authenticated;

-- Existing onboarding customers: mandatory documents already uploaded become
-- saved checklist entries, then progress is recomputed.
insert into public.customer_onboarding_entries (customer_id, item_code, value, document_id, status, saved_by, saved_at)
select d.customer_id, d.document_type, d.original_file_name, d.id, 'SAVED', d.uploaded_by, coalesce(d.uploaded_at, now())
from public.customer_documents d
join public.onboarding_items i on i.code = d.document_type and i.kind = 'FILE'
where d.status = 'UPLOADED'
on conflict do nothing;
do $$
declare r record;
begin
  for r in select customer_id from public.customer_onboarding loop
    perform private.refresh_onboarding_progress(r.customer_id);
  end loop;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.customer_onboarding_entries;
exception when duplicate_object then null;
end $$;
