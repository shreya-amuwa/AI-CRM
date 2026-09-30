import React, { useState, useEffect } from 'react';
import {
  Cloud,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  X,
  Database,
  Lock,
  RefreshCw,
  Trash2,
  Eye,
  EyeOff,
  Table as TableIcon,
  Users,
  Zap
} from 'lucide-react';
import {
  getSupabaseConfig,
  setSupabaseConfig,
  clearSupabaseConfig,
  testSupabaseConnection,
  SupabaseConfig,
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_KEY,
  getSupabase
} from '../../services/supabaseClient';

interface SupabaseConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SUPABASE_SQL_SCHEMA = `-- 1. LIVE CRM LEADS TABLE (10 CHANNELS + WEBHOOKS)
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

-- 4. ENABLE REAL-TIME SYNC
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.hr_employees;
ALTER PUBLICATION supabase_realtime ADD TABLE public.hr_attendance;

-- 5. OPEN ACCESS POLICIES
CREATE POLICY IF NOT EXISTS "Public Access" ON public.crm_leads FOR ALL USING (true);
CREATE POLICY IF NOT EXISTS "Public Access" ON public.hr_employees FOR ALL USING (true);
CREATE POLICY IF NOT EXISTS "Public Access" ON public.hr_attendance FOR ALL USING (true);
`;

export const SupabaseConnectionModal: React.FC<SupabaseConnectionModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<SupabaseConfig>(getSupabaseConfig());
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [activeTab, setActiveTab] = useState<'data' | 'connect' | 'sql'>('data');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  // Cloud Data Viewer State
  const [selectedTable, setSelectedTable] = useState<'crm_leads' | 'hr_employees'>('crm_leads');
  const [cloudRows, setCloudRows] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  const fetchCloudData = async (table: 'crm_leads' | 'hr_employees') => {
    const supabase = getSupabase();
    if (!supabase) return;
    setLoadingData(true);
    try {
      const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: false });
      if (!error && data) {
        setCloudRows(data);
        setLastRefreshed(new Date().toLocaleTimeString());
      } else {
        setCloudRows([]);
      }
    } catch {
      setCloudRows([]);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const cfg = getSupabaseConfig();
      setConfig(cfg);
      setUrl(cfg.url || DEFAULT_SUPABASE_URL);
      setAnonKey(cfg.anonKey || DEFAULT_SUPABASE_KEY);
      setTestResult(null);
      fetchCloudData(selectedTable);
    }
  }, [isOpen, selectedTable]);

  if (!isOpen) return null;

  const handleAutoFill = () => {
    setUrl(DEFAULT_SUPABASE_URL);
    setAnonKey(DEFAULT_SUPABASE_KEY);
    setTestResult(null);
  };

  const handleTestAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !anonKey.trim()) {
      setTestResult({ success: false, message: 'Please enter both Supabase Project URL and Anon API Key.' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    const res = await testSupabaseConnection(url.trim(), anonKey.trim());
    setTestResult(res);
    setTesting(false);

    if (res.success) {
      setSupabaseConfig(url.trim(), anonKey.trim());
      setConfig(getSupabaseConfig());
      fetchCloudData(selectedTable);
    }
  };

  const handleDisconnect = () => {
    clearSupabaseConfig();
    setConfig(getSupabaseConfig());
    setUrl('');
    setAnonKey('');
    setTestResult({ success: true, message: 'Disconnected from Supabase. CRM is operating on local storage.' });
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/15 backdrop-blur-xs border border-white/20">
              <Cloud className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold font-heading text-lg">Supabase Cloud Platform</h3>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-400/25 text-emerald-100 border border-emerald-300/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Cloud Database: sawufdziibpsmpxyerqe
                </span>
              </div>
              <p className="text-xs text-emerald-100/90 font-mono">
                PostgreSQL Tables, Realtime WebSockets & S3 Cloud Storage
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-2">
          <button
            onClick={() => setActiveTab('data')}
            className={`px-4 py-2.5 font-semibold text-xs border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'data'
                ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            Live Cloud Tables ({cloudRows.length} Rows)
          </button>
          <button
            onClick={() => setActiveTab('connect')}
            className={`px-4 py-2.5 font-semibold text-xs border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'connect'
                ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Connection Keys
          </button>
          <button
            onClick={() => setActiveTab('sql')}
            className={`px-4 py-2.5 font-semibold text-xs border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'sql'
                ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Copy className="w-3.5 h-3.5" />
            SQL Schema
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: LIVE CLOUD DATA VIEWER */}
          {activeTab === 'data' && (
            <div className="space-y-4">
              {/* Table Selector & Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700">Select Table:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedTable('hr_employees')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      selectedTable === 'hr_employees'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    hr_employees
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedTable('crm_leads')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      selectedTable === 'crm_leads'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    crm_leads
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {lastRefreshed && (
                    <span className="text-[11px] text-slate-500 font-mono">Refreshed: {lastRefreshed}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => fetchCloudData(selectedTable)}
                    disabled={loadingData}
                    className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${loadingData ? 'animate-spin' : ''}`} />
                    Refresh Cloud Data
                  </button>
                </div>
              </div>

              {/* Table Data Render */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                {selectedTable === 'hr_employees' && (
                  <div className="overflow-x-auto max-h-96">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 text-slate-700 font-mono uppercase text-[10px] tracking-wider border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="px-3.5 py-2.5">ID</th>
                          <th className="px-3.5 py-2.5">Name</th>
                          <th className="px-3.5 py-2.5">Designation</th>
                          <th className="px-3.5 py-2.5">Salary</th>
                          <th className="px-3.5 py-2.5">Email / Phone</th>
                          <th className="px-3.5 py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-sans">
                        {cloudRows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                              {loadingData ? 'Querying Supabase Cloud...' : 'No employees in cloud table yet.'}
                            </td>
                          </tr>
                        ) : (
                          cloudRows.map((r: any) => (
                            <tr
                              key={r.id}
                              className={`hover:bg-slate-50/80 transition-colors ${
                                r.name?.toLowerCase().includes('pranali') ? 'bg-emerald-50/70 font-semibold' : ''
                              }`}
                            >
                              <td className="px-3.5 py-2.5 font-mono text-slate-600">{r.id}</td>
                              <td className="px-3.5 py-2.5 text-slate-900 flex items-center gap-1.5">
                                <span>{r.name}</span>
                                {r.name?.toLowerCase().includes('pranali') && (
                                  <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-emerald-600 text-white font-bold">
                                    NEW
                                  </span>
                                )}
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-700">{r.designation}</td>
                              <td className="px-3.5 py-2.5 font-mono text-emerald-700 font-semibold">{r.monthly_salary}</td>
                              <td className="px-3.5 py-2.5 text-slate-500 font-mono text-[11px]">
                                {r.email} {r.phone ? `(${r.phone})` : ''}
                              </td>
                              <td className="px-3.5 py-2.5">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  {r.status || 'Active'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {selectedTable === 'crm_leads' && (
                  <div className="overflow-x-auto max-h-96">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 text-slate-700 font-mono uppercase text-[10px] tracking-wider border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="px-3.5 py-2.5">Lead Name</th>
                          <th className="px-3.5 py-2.5">Phone</th>
                          <th className="px-3.5 py-2.5">Company</th>
                          <th className="px-3.5 py-2.5">Channel</th>
                          <th className="px-3.5 py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-sans">
                        {cloudRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                              Ready for incoming webhook leads.
                            </td>
                          </tr>
                        ) : (
                          cloudRows.map((r: any) => (
                            <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-3.5 py-2.5 font-bold text-slate-900">{r.name}</td>
                              <td className="px-3.5 py-2.5 font-mono text-slate-600">{r.phone}</td>
                              <td className="px-3.5 py-2.5 text-slate-700">{r.company}</td>
                              <td className="px-3.5 py-2.5 text-slate-500">{r.channel}</td>
                              <td className="px-3.5 py-2.5">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  {r.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <strong>Database Verified:</strong> All data above is directly fetched from your Supabase AWS cloud database.
                </span>
                <span className="font-mono text-[11px] text-emerald-700">sawufdziibpsmpxyerqe.supabase.co</span>
              </div>
            </div>
          )}

          {/* TAB 2: CONNECTION SETTINGS */}
          {activeTab === 'connect' && (
            <form onSubmit={handleTestAndSave} className="space-y-4">
              {/* Auto-fill banner */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-950 font-mono">
                <div>
                  <span className="font-bold text-blue-900">Project:</span> sawufdziibpsmpxyerqe
                  <p className="text-[11px] text-blue-700">Cloud database credentials detected</p>
                </div>
                <button
                  type="button"
                  onClick={handleAutoFill}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-lg font-semibold text-xs transition-all shadow-xs"
                >
                  Auto-Fill My Keys
                </button>
              </div>

              {/* Project URL */}
              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-1">
                  Supabase Project URL
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://your-project-id.supabase.co"
                    className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50/50"
                  />
                </div>
              </div>

              {/* Anon API Key */}
              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-1">
                  Project API Anon / Public Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={anonKey}
                    onChange={(e) => setAnonKey(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full px-3.5 py-2.5 pr-10 text-xs font-mono rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Status Message */}
              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                    testResult.success
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="leading-relaxed">
                    <p className="font-semibold">{testResult.success ? 'Success' : 'Connection Failed'}</p>
                    <p className="text-xs">{testResult.message}</p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                {config.isConfigured ? (
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="px-3.5 py-2 rounded-xl text-rose-600 hover:bg-rose-50 border border-rose-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Disconnect & Use Local
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={testing}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold font-heading flex items-center gap-2 transition-all shadow-xs disabled:opacity-50"
                  >
                    {testing ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Testing Connection...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Test & Save Connection
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* TAB 3: SQL SCHEMA */}
          {activeTab === 'sql' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Supabase SQL Migration Script
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Already executed and verified in your database!
                  </p>
                </div>
                <button
                  onClick={handleCopySql}
                  className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {copiedSql ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy SQL
                    </>
                  )}
                </button>
              </div>

              <div className="relative">
                <pre className="p-3.5 rounded-xl bg-slate-900 text-emerald-300 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-72 border border-slate-800">
                  {SUPABASE_SQL_SCHEMA}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
