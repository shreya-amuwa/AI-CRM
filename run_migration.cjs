const { Client } = require('./node_modules/pg');

const fullSql = `
-- 1. BLUEPRINT REQUIREMENTS TABLE
CREATE TABLE IF NOT EXISTS public.blueprint_requirements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'Normal',
    status TEXT DEFAULT 'New',
    requester_id TEXT,
    requester_name TEXT,
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

-- 2. LIVE CRM LEADS TABLE (10 CHANNELS + WEBHOOKS)
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

-- 3. HR EMPLOYEES & STAFF TABLE
CREATE TABLE IF NOT EXISTS public.hr_employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    designation TEXT,
    department_id TEXT,
    status TEXT DEFAULT 'Full-Time',
    joining_date TEXT,
    monthly_salary TEXT,
    working_hours TEXT DEFAULT '09:30 AM - 06:30 PM (Mon-Sat)',
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. HR ATTENDANCE & BIOMETRIC PUNCHES TABLE
CREATE TABLE IF NOT EXISTS public.hr_attendance (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    emp_id TEXT NOT NULL,
    name TEXT,
    role TEXT,
    time TEXT,
    status TEXT,
    device TEXT,
    date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. HR LEAVE APPLICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.hr_leave_applications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    employee_id TEXT NOT NULL,
    employee_name TEXT,
    leave_type TEXT,
    date TEXT,
    reason TEXT,
    status TEXT DEFAULT 'Pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. STORAGE BUCKETS FOR BLUEPRINTS AND HR DOCS
INSERT INTO storage.buckets (id, name, public) 
VALUES ('blueprint-files', 'blueprint-files', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) 
VALUES ('amuwa-docs', 'amuwa-docs', true)
ON CONFLICT (id) DO NOTHING;

-- 7. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.blueprint_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_applications ENABLE ROW LEVEL SECURITY;

-- 8. OPEN ACCESS POLICIES FOR CRM OPERATIONS
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'blueprint_requirements' AND policyname = 'Public Access') THEN
    CREATE POLICY "Public Access" ON public.blueprint_requirements FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crm_leads' AND policyname = 'Public Access') THEN
    CREATE POLICY "Public Access" ON public.crm_leads FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_employees' AND policyname = 'Public Access') THEN
    CREATE POLICY "Public Access" ON public.hr_employees FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_attendance' AND policyname = 'Public Access') THEN
    CREATE POLICY "Public Access" ON public.hr_attendance FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_leave_applications' AND policyname = 'Public Access') THEN
    CREATE POLICY "Public Access" ON public.hr_leave_applications FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 9. ADD TABLES TO REALTIME PUBLICATION
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.blueprint_requirements;
  EXCEPTION WHEN duplicate_object THEN END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_leads;
  EXCEPTION WHEN duplicate_object THEN END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hr_employees;
  EXCEPTION WHEN duplicate_object THEN END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hr_attendance;
  EXCEPTION WHEN duplicate_object THEN END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hr_leave_applications;
  EXCEPTION WHEN duplicate_object THEN END;
END $$;
`;

async function migrate() {
  const client = new Client({
    host: 'db.sawufdziibpsmpxyerqe.supabase.co',
    port: 5432,
    user: 'postgres',
    password: 'ShreyaAmuwa',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL! Executing schema...');
    await client.query(fullSql);
    console.log('Migration successfully completed!');

    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('Active Tables in Supabase:', res.rows.map(r => r.table_name));

    await client.end();
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
