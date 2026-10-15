-- =============================================================================
-- Service onboarding checklists from the "Service Onboarding - Step-by-Step Guide".
--
-- When a customer buys a service, Customer onboarding lists what to collect for it. WhatsApp API +
-- Blue Tick already followed the guide; this brings every other service in the guide in line:
--
--   RCS Registration, AI Calling, Voice Message (Bulk), AI QR, Crocodile (Call CRM), Google Business
--   Profile - Setup, Meta Ads Management, Social Media Management, AI CRM
--       -> their checklist becomes exactly the steps of the guide
--   Appointo, AI Website, GMB Ranking, Video Promotion
--       -> new services (they were not in the catalogue) with their checklist
--
-- Name, business name and mobile number are asked for every customer (Business basics), and the GST /
-- Udyam / Aadhaar documents are part of the mandatory "All Important Documents" PDF, so the per-service
-- list only holds what is specific to the service. Items shared by several services (brand logo, brand
-- name, e-mail, location, social URLs ...) are collected once.
--
-- Data only: no table or function changes. Idempotent. Customers already in onboarding keep what they
-- saved; the checklist they see follows the new lists.
-- =============================================================================

-- 1. New services ------------------------------------------------------------
insert into public.crm_services (code, name, category, sort_order) values
  ('APPOINTO', 'Appointo', 'Messaging & AI', 75),
  ('AI_WEBSITE', 'AI Website', 'Messaging & AI', 80),
  ('GMB_RANKING', 'GMB Ranking', 'Google & Social', 170),
  ('VIDEO_PROMOTION', 'Video Promotion', 'Video & Content', 240)
on conflict (code) do update set name = excluded.name, category = excluded.category, is_active = true;

-- Names as the guide writes them
update public.crm_services set name = 'RCS Registration + Platform' where code = 'RCS_REGISTRATION';
update public.crm_services set name = 'Crocodile (Call CRM)' where code = 'CROCODILE_CHANNEL_WEBHOOK';

-- 2. Document types for the new FILE items (2 MB, like every other customer document) ---------------
insert into public.document_types (code, label, description, storage_folder, is_mandatory, allowed_mime_types, max_size_bytes, sort_order) values
  ('RCS_BANNER', 'Banner', '', 'onboarding', false, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], 2097152, 180),
  ('WEBSITE_IMAGES', 'Website images', '', 'onboarding', false, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], 2097152, 190),
  ('INDUSTRY_IMAGES', 'Industry images', '', 'onboarding', false, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], 2097152, 200)
on conflict (code) do nothing;

-- 3. Items -----------------------------------------------------------------------------------------
insert into public.onboarding_items (code, section, label, hint, kind, options, always_required, sort_order, is_optional) values
  -- shared across services
  ('BRAND_NAME', 'SERVICE', 'Brand name', 'The brand name as it should appear', 'DETAILS', null, false, 225, false),
  ('BUSINESS_EMAIL', 'SERVICE', 'E-mail', 'The business e-mail address', 'DETAILS', null, false, 905, false),
  ('BUSINESS_LOCATION', 'SERVICE', 'Location', 'Business location, as it appears on the map', 'DETAILS', null, false, 908, false),
  ('WHATSAPP_MOBILE', 'SERVICE', 'WhatsApp mobile number', 'The number the customer uses on WhatsApp', 'DETAILS', null, false, 405, false),
  -- RCS Registration + Platform
  ('RCS_BANNER', 'SERVICE', 'Banner', 'PNG, JPG or PDF', 'FILE', null, false, 235, false),
  ('RCS_WEBSITE_URL', 'SERVICE', 'Website URL', '', 'DETAILS', null, false, 240, false),
  ('RCS_PRIVACY_URL', 'SERVICE', 'Privacy Policy website link', 'Link to the Privacy Policy page', 'DETAILS', null, false, 242, false),
  ('RCS_TERMS_URL', 'SERVICE', 'Terms & Conditions website link', 'Link to the Terms & Conditions page', 'DETAILS', null, false, 244, false),
  ('RCS_CONTACT_URL', 'SERVICE', 'Contact Us website link', 'Link to the Contact Us page', 'DETAILS', null, false, 246, false),
  -- AI QR
  ('AIQR_MAP_LOCATION', 'SERVICE', 'Google Map location', 'Google Maps link or the exact address', 'DETAILS', null, false, 528, false),
  -- Crocodile (Call CRM)
  ('CROC_EMPLOYEE_DETAILS', 'SERVICE', 'Employee details', 'Name and number of each employee who will use it', 'DETAILS', null, false, 610, false),
  ('CROC_DOMAIN', 'SERVICE', 'Domain', 'Optional - the business domain', 'DETAILS', null, false, 620, true),
  -- Meta Ads Management
  ('WHATSAPP_ACCESS', 'SERVICE', 'WhatsApp access', 'Access granted - note how it was given', 'ACCESS', null, false, 935, false),
  -- AI CRM
  ('AICRM_SERVICES', 'SERVICE', 'Services', 'The services the company offers', 'DETAILS', null, false, 2110, false),
  ('AICRM_CURRENT_CRM', 'SERVICE', 'Current CRM system', 'Optional - the CRM they use today', 'DETAILS', null, false, 2120, true),
  ('AICRM_STAFF_COUNT', 'SERVICE', 'Number of staff', '', 'DETAILS', null, false, 2130, false),
  -- Appointo
  ('APPOINTO_EMAIL_ACCESS', 'SERVICE', 'E-mail access', 'Access to the e-mail account used for Appointo', 'ACCESS', null, false, 2310, false),
  -- GMB Ranking
  ('GMB_LATLONG', 'SERVICE', 'Location (latitude & longitude)', 'e.g. 19.0760, 72.8777', 'DETAILS', null, false, 2510, false),
  ('INDUSTRY_IMAGES', 'SERVICE', 'Industry images', 'Combine into one PDF, or one photo', 'FILE', null, false, 2520, false),
  ('BUSINESS_TIMINGS', 'SERVICE', 'Open & close time', 'Opening and closing time for each day', 'DETAILS', null, false, 2530, false),
  -- AI Website
  ('WEBSITE_IMAGES', 'SERVICE', 'Images', 'Photos for the website, combined into one PDF, or one photo', 'FILE', null, false, 2410, false),
  -- Video Promotion
  ('VIDEO_INSTAGRAM', 'SERVICE', 'Instagram account', 'Account link or handle', 'DETAILS', null, false, 2610, false),
  ('VIDEO_CONTENT_TYPE', 'SERVICE', 'Type of content', 'e.g. product reels, offers, testimonials', 'DETAILS', null, false, 2620, false)
on conflict (code) do update set label = excluded.label, hint = excluded.hint, kind = excluded.kind, sort_order = excluded.sort_order,
  is_optional = excluded.is_optional, is_active = true;

-- Wording / order of items that already exist
update public.onboarding_items set label = 'Domain-based e-mail ID', hint = 'An e-mail address on the business domain', sort_order = 215 where code = 'RCS_DOMAIN_EMAIL';
update public.onboarding_items set label = 'Customer number', hint = 'The number the calls are made for / from', sort_order = 310 where code = 'AI_CALL_CUSTOMER_NUMBER';
update public.onboarding_items set label = 'Business details & caller''s role', hint = 'What the business does and who the AI agent speaks as', sort_order = 320 where code = 'AI_CALL_BUSINESS_ROLE';
update public.onboarding_items set label = 'Instagram, Facebook & WhatsApp URLs', hint = 'Profile links', sort_order = 510 where code = 'SOCIAL_URLS';
update public.onboarding_items set label = 'E-mail & website', hint = 'Shown on the QR page', sort_order = 520 where code = 'AIQR_CONTACT';
update public.onboarding_items set label = 'Payment QR integration', hint = 'Image of the UPI payment QR for the payment QR setup', sort_order = 530 where code = 'AIQR_PAYMENT_SCANNER';
update public.onboarding_items set hint = 'Confirm monthly or yearly billing' where code = 'BILLING_CYCLE';
update public.onboarding_items set sort_order = 915 where code = 'SMM_BUSINESS_AUDIENCE';
update public.onboarding_items set hint = 'Confirm the content library the client provided (link)' where code = 'SMM_CONTENT_LIBRARY';
update public.onboarding_items set label = 'Website URL', hint = 'Optional - the business website, if they have one' where code = 'WA_WEBSITE_URL';

-- 4. Which items each service needs: exactly the guide's steps -------------------------------------
-- One statement (no temporary table), so it also runs in the Supabase SQL editor, which may use a
-- different connection for each statement.
with guide (service_code, item_code) as (values
  -- RCS Registration + Platform
  ('RCS_REGISTRATION', 'RCS_DOMAIN_NAME'), ('RCS_REGISTRATION', 'RCS_DOMAIN_EMAIL'), ('RCS_REGISTRATION', 'RCS_BRAND_NAME'),
  ('RCS_REGISTRATION', 'BRAND_LOGO'), ('RCS_REGISTRATION', 'RCS_BANNER'), ('RCS_REGISTRATION', 'RCS_WEBSITE_URL'),
  ('RCS_REGISTRATION', 'RCS_PRIVACY_URL'), ('RCS_REGISTRATION', 'RCS_TERMS_URL'), ('RCS_REGISTRATION', 'RCS_CONTACT_URL'),
  -- AI Calling
  ('AI_CALLING', 'AI_CALL_CUSTOMER_NUMBER'), ('AI_CALLING', 'AI_CALL_BUSINESS_ROLE'),
  -- Voice Message (Bulk)
  ('VOICE_MESSAGE_BULK', 'WHATSAPP_MOBILE'), ('VOICE_MESSAGE_BULK', 'WA_WEBSITE_URL'),
  -- AI QR
  ('AI_QR', 'SOCIAL_URLS'), ('AI_QR', 'AIQR_CONTACT'), ('AI_QR', 'BRAND_LOGO'), ('AI_QR', 'BRAND_NAME'),
  ('AI_QR', 'AIQR_MAP_LOCATION'), ('AI_QR', 'AIQR_PAYMENT_SCANNER'),
  -- Crocodile (Call CRM)
  ('CROCODILE_CHANNEL_WEBHOOK', 'CROC_EMPLOYEE_DETAILS'), ('CROCODILE_CHANNEL_WEBHOOK', 'CROC_DOMAIN'), ('CROCODILE_CHANNEL_WEBHOOK', 'BILLING_CYCLE'),
  -- Google Business Profile - Setup
  ('GBP_SETUP', 'GBP_NO_EXISTING'), ('GBP_SETUP', 'GBP_LISTING_DETAILS'), ('GBP_SETUP', 'GBP_PHOTOS'),
  -- Meta Ads Management
  ('META_ADS_MANAGEMENT', 'BUSINESS_EMAIL'), ('META_ADS_MANAGEMENT', 'BRAND_LOGO'), ('META_ADS_MANAGEMENT', 'BUSINESS_LOCATION'),
  ('META_ADS_MANAGEMENT', 'FACEBOOK_PAGE_ACCESS'), ('META_ADS_MANAGEMENT', 'INSTAGRAM_PAGE_ACCESS'), ('META_ADS_MANAGEMENT', 'WHATSAPP_ACCESS'),
  -- Social Media Management
  ('SOCIAL_MEDIA_MANAGEMENT', 'SMM_BUSINESS_AUDIENCE'), ('SOCIAL_MEDIA_MANAGEMENT', 'FACEBOOK_PAGE_ACCESS'),
  ('SOCIAL_MEDIA_MANAGEMENT', 'INSTAGRAM_PAGE_ACCESS'), ('SOCIAL_MEDIA_MANAGEMENT', 'SMM_CONTENT_LIBRARY'),
  -- Appointo
  ('APPOINTO', 'APPOINTO_EMAIL_ACCESS'),
  -- AI Website
  ('AI_WEBSITE', 'BRAND_LOGO'), ('AI_WEBSITE', 'BRAND_NAME'), ('AI_WEBSITE', 'BUSINESS_LOCATION'),
  ('AI_WEBSITE', 'BUSINESS_EMAIL'), ('AI_WEBSITE', 'WEBSITE_IMAGES'),
  -- GMB Ranking
  ('GMB_RANKING', 'BRAND_LOGO'), ('GMB_RANKING', 'BRAND_NAME'), ('GMB_RANKING', 'GMB_LATLONG'),
  ('GMB_RANKING', 'SOCIAL_URLS'), ('GMB_RANKING', 'INDUSTRY_IMAGES'), ('GMB_RANKING', 'BUSINESS_TIMINGS'),
  -- Video Promotion
  ('VIDEO_PROMOTION', 'BRAND_LOGO'), ('VIDEO_PROMOTION', 'BRAND_NAME'), ('VIDEO_PROMOTION', 'VIDEO_INSTAGRAM'), ('VIDEO_PROMOTION', 'VIDEO_CONTENT_TYPE'),
  -- AI CRM
  ('AI_CRM', 'BUSINESS_EMAIL'), ('AI_CRM', 'BUSINESS_LOCATION'), ('AI_CRM', 'AICRM_SERVICES'),
  ('AI_CRM', 'AICRM_CURRENT_CRM'), ('AI_CRM', 'AICRM_STAFF_COUNT'), ('AI_CRM', 'BRAND_LOGO')
),
removed as (
  delete from public.onboarding_item_services m
   where m.service_code in (select service_code from guide)
     and not exists (select 1 from guide g where g.service_code = m.service_code and g.item_code = m.item_code)
  returning 1
)
insert into public.onboarding_item_services (item_code, service_code)
select item_code, service_code from guide
on conflict do nothing;
