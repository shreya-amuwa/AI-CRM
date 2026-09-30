-- SUPABASE CLOUD SQL SCHEMA FOR AMUWA SALES OS & CRM
-- Run this in https://supabase.com/dashboard/project/sawufdziibpsmpxyerqe/sql/new

CREATE TABLE IF NOT EXISTS public.blueprint_requirements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'Normal',
    status TEXT DEFAULT 'New',
    requester_id TEXT NOT NULL,
    requester_name TEXT NOT NULL,
    requester_email TEXT,
    requester_role TEXT,
    team_id TEXT,
    team_name TEXT,
    team_lead_id TEXT,
    department_id TEXT,
    department_name TEXT,
    client_info JSONB,
    due_time TEXT,
    due_notes TEXT,
    timeline_assigned_at TEXT,
    blueprint_pdf_name TEXT,
    blueprint_pdf_size TEXT,
    blueprint_pdf_url TEXT,
    delivered_at TEXT,
    delivery_notes TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_leads (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    company TEXT,
    channel TEXT,
    department TEXT DEFAULT 'wabastore',
    sub_department TEXT DEFAULT 'sales',
    status TEXT DEFAULT 'New',
    value NUMERIC DEFAULT 0,
    notes TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.blueprint_requirements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_leads;

INSERT INTO storage.buckets (id, name, public) 
VALUES ('blueprint-files', 'blueprint-files', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "Allow all access to blueprint_requirements"
ON public.blueprint_requirements FOR ALL USING (true);

CREATE POLICY IF NOT EXISTS "Allow all access to crm_leads"
ON public.crm_leads FOR ALL USING (true);
