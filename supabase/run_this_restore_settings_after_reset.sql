-- =============================================================================
-- Restore the settings rows that "Fresh start" (supabase/maintenance/reset_all_data_keep_super_admin.sql) wiped.
--
-- Symptom: Accounts > a customer > "GST for this order" has an EMPTY GST rate drop-down ("Choose the GST rate" and nothing under it).
-- Cause: the reset empties every table that is not on its keep-list, and these configuration tables were added after the list was written:
--   order_gst_rates, invoice_whatsapp_settings, workflow_settings, usage_alert_settings, reminder_message_templates.
-- This file puts back the same default rows the migrations create. Paste it into the Supabase SQL editor and run it once.
-- It is safe to run again: a row that exists is left exactly as it is (nothing is overwritten, nothing is deleted, nothing is sent).
-- The reset script is fixed too, so a later reset keeps these tables.
-- =============================================================================

-- GST rates Accounts chooses from for an order
insert into public.order_gst_rates (rate, label, sort_order) values
  (0, 'No GST (0%)', 0), (5, '5% GST', 1), (12, '12% GST', 2), (18, '18% GST', 3), (28, '28% GST', 4)
on conflict (rate) do nothing;

-- one settings row each (the defaults the migrations create)
insert into public.invoice_whatsapp_settings (id) values (true) on conflict (id) do nothing;
insert into public.workflow_settings (id) values (true) on conflict (id) do nothing;
insert into public.usage_alert_settings (id) values (true) on conflict (id) do nothing;

-- the subscription reminder wording (draft templates, as created by the migrations)
insert into public.reminder_message_templates (channel, stage, subject, body) values
  ('EMAIL', 7, 'Your {{service}} subscription expires in {{daysLeft}} days',
   E'Dear {{name}},\n\nYour {{service}} subscription with Amuwa will expire on {{expiryDate}}, which is {{daysLeft}} days from now.\n\nTo avoid any break in your service, please renew before that date. Reply to this e-mail or contact our support team and we will help you renew.'),
  ('EMAIL', 3, 'Your {{service}} subscription expires in {{daysLeft}} days',
   E'Dear {{name}},\n\nThis is a reminder that your {{service}} subscription will expire on {{expiryDate}}, in {{daysLeft}} days.\n\nPlease renew soon so that your service continues without interruption. Our support team is happy to help.'),
  ('EMAIL', 1, 'Your {{service}} subscription expires tomorrow',
   E'Dear {{name}},\n\nYour {{service}} subscription will expire tomorrow, on {{expiryDate}}.\n\nPlease renew today to keep your service running. Reply to this e-mail or call our support team and we will help right away.'),
  ('WHATSAPP', 7, null,
   E'Hello {{name}}, your {{service}} subscription with Amuwa expires on {{expiryDate}} ({{daysLeft}} days). Please renew in time to avoid any interruption. Reply here and our team will help you.'),
  ('WHATSAPP', 3, null,
   E'Hello {{name}}, a reminder: your {{service}} subscription expires on {{expiryDate}} ({{daysLeft}} days). Please renew soon so your service continues. Reply here for help.'),
  ('WHATSAPP', 1, null,
   E'Hello {{name}}, your {{service}} subscription expires tomorrow ({{expiryDate}}). Please renew today to keep it running. Reply here and we will help right away.')
on conflict (channel, stage) do nothing;

insert into public.reminder_message_templates (channel, stage, subject, body) values
  ('EMAIL', 15, 'Your {{service}} subscription expires in {{daysLeft}} days',
   E'Dear {{name}},\n\nYour {{service}} subscription with Amuwa will expire on {{expiryDate}}, which is {{daysLeft}} days from now.\n\nPlease plan your renewal so that your service continues without a break. Reply to this e-mail or contact our support team and we will help you renew.'),
  ('EMAIL', 0, 'Your {{service}} subscription expires today',
   E'Dear {{name}},\n\nYour {{service}} subscription with Amuwa expires today, {{expiryDate}}.\n\nPlease renew today to keep your service running. Reply to this e-mail or call our support team and we will help right away.'),
  ('WHATSAPP', 15, null,
   E'Hello {{name}}, your {{service}} subscription with Amuwa expires on {{expiryDate}} ({{daysLeft}} days). Please plan your renewal. Reply here and our team will help you.'),
  ('WHATSAPP', 0, null,
   E'Hello {{name}}, your {{service}} subscription with Amuwa expires today ({{expiryDate}}). Please renew today so your service continues. Reply here for help.')
on conflict (channel, stage) do nothing;

-- what is now in place
select 'order_gst_rates' as what, count(*) as rows from public.order_gst_rates
union all select 'invoice_whatsapp_settings', count(*) from public.invoice_whatsapp_settings
union all select 'workflow_settings', count(*) from public.workflow_settings
union all select 'usage_alert_settings', count(*) from public.usage_alert_settings
union all select 'reminder_message_templates', count(*) from public.reminder_message_templates;
