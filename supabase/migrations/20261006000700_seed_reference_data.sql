-- =============================================================================
-- Reference data: the official departments (legacy slugs preserved so the
-- existing URLs and department panels keep working) and their teams.
-- Idempotent. No users are seeded — see scripts/bootstrap-super-admin.mjs.
-- =============================================================================

insert into public.departments (slug, name, description, icon_name, accent_color, logo_url) values
  ('amuwa',       'Amuwa Corporation',    'Corporate Holding & International Enterprise Operations',                   'Building2',     '#EF4444', '/logos/amuwa.png'),
  ('designstudio','Amuwa Design Studio',  'A Place Start Creative Solutions & Strategic Design Innovation',            'Sparkles',      '#DC2626', '/logos/designstudio.png'),
  ('wabastar',    'Wabastar',             'WhatsApp Marketing, Automation & Conversational Intelligence',             'Star',          '#16A34A', '/logos/wabastar.png'),
  ('wabastore',   'Wabastore',            'E-Commerce Marketplace & Direct-to-Consumer Retail',                       'ShoppingBag',   '#10B981', '/logos/wabastore.png'),
  ('whatsbox',    'Whatsbox',             '',                                                                         'MessageSquare', '#06B6D4', '/logos/whatsbox.png'),
  ('dtalk',       'D Talk Corporation',   'Enterprise Telecom & Cloud Voice Communications',                          'PhoneCall',     '#8B5CF6', '/logos/dtalk.png'),
  ('digitree',    'Digitree Infotech',    'Digital Solutions, Software Engineering & Cloud Infrastructure',           'Cpu',           '#EC4899', '/logos/digitree.png'),
  ('mpillar',     'M Pillar Corporation', 'Infrastructure, Real Estate & Industrial Project Management',              'Layers',        '#F59E0B', '/logos/mpillar.png'),
  ('edutraining', 'Education & Training', 'Candidate Education Training & Client Product Training Programs',          'GraduationCap', '#0EA5E9', null),
  ('hr',          'HR Department',        'Human Resources & Employee Management',                                    'Users',         '#3B82F6', null),
  ('accounts',    'Accounts Department',  'Corporate Financial Intelligence, Income, Operating Expenses & Invoicing',  'DollarSign',    '#10B981', null)
on conflict (slug) do nothing;

-- Business units with Sales / Support divisions get one team per division.
insert into public.teams (department_id, name, division)
select d.id, v.name, v.division::public.team_division
from public.departments d
cross join (values ('Sales', 'SALES'), ('Support', 'SUPPORT')) as v(name, division)
where d.slug in ('wabastore', 'whatsbox', 'dtalk', 'digitree', 'mpillar')
on conflict do nothing;

-- Every other department gets a general team so members can be placed.
insert into public.teams (department_id, name, division)
select d.id, 'General', 'GENERAL'::public.team_division
from public.departments d
where d.slug not in ('wabastore', 'whatsbox', 'dtalk', 'digitree', 'mpillar')
on conflict do nothing;

insert into public.crm_settings (key, value, description) values
  ('registration.enabled', 'true'::jsonb, 'Allow self-service sign-up (accounts still require approval).'),
  ('customers.page_size_max', '100'::jsonb, 'Maximum page size for customer listings.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Realtime: only where live updates matter. Realtime respects RLS, so each
-- user only receives their own notifications / requests they may decide.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.approval_requests;
  exception when duplicate_object then null;
  end;
end $$;
