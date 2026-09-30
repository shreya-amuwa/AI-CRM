import React, { useState } from 'react';
import { Settings, Clock, FileText, Radio, ShieldCheck, CheckCircle2, Save, Sparkles, Building2, Bell, Lock } from 'lucide-react';

export const AmuwaSettingsPanel: React.FC = () => {
  const [isSaved, setIsSaved] = useState(false);

  // Settings State
  const [workHours, setWorkHours] = useState('09:30 AM - 06:30 PM (Mon-Sat)');
  const [probationDays, setProbationDays] = useState('60');
  const [noticePeriodDays, setNoticePeriodDays] = useState('60');
  const [requireLeaveMail, setRequireLeaveMail] = useState(true);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      
      {/* Settings Header - Pure Bright Style */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-white text-slate-900 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-amber-100 text-amber-800 border border-amber-300">
            <Settings className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-heading text-slate-900">Amuwa Corporation Settings</h2>
            <p className="text-xs font-mono text-slate-500">Corporate configuration, office timings, offer letter parameters, and policy rules</p>
          </div>
        </div>

        <button
          onClick={handleSaveSettings}
          className={`px-5 py-2.5 rounded-xl font-mono font-bold text-xs flex items-center gap-2 transition-all shadow-sm active:scale-95 ${
            isSaved ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{isSaved ? 'Settings Saved!' : 'Save Settings'}</span>
        </button>
      </div>

      {/* Settings Card - Pure Bright Style */}
      <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-6">
        <form onSubmit={handleSaveSettings} className="space-y-6 text-xs font-mono">
          
          <div className="border-b border-slate-100 pb-4">
            <h3 className="text-base font-bold text-slate-900 font-heading">1. Office Shift &amp; Working Hours</h3>
            <p className="text-xs text-slate-500 font-mono">Default office timings and probation period length</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-700 uppercase mb-1">STANDARD SHIFT TIMINGS</label>
              <input
                type="text"
                value={workHours}
                onChange={e => setWorkHours(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 uppercase mb-1">STANDARD PROBATION DURATION (DAYS)</label>
              <input
                type="number"
                value={probationDays}
                onChange={e => setProbationDays(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
              />
            </div>
          </div>

          <div className="border-b border-slate-100 pb-4 pt-2">
            <h3 className="text-base font-bold text-slate-900 font-heading">2. HR Policies &amp; Appointment Letter Rules</h3>
            <p className="text-xs text-slate-500 font-mono">Notice period defaults and mandatory leave proof</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-700 uppercase mb-1">DEFAULT NOTICE PERIOD (DAYS)</label>
              <input
                type="number"
                value={noticePeriodDays}
                onChange={e => setNoticePeriodDays(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900"
              />
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900 block">Require Mail Proof for Leaves</span>
                <span className="text-[10px] text-slate-500">Mandatory attachment when filing leave</span>
              </div>
              <input
                type="checkbox"
                checked={requireLeaveMail}
                onChange={e => setRequireLeaveMail(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold text-xs shadow-sm"
            >
              Save Configuration
            </button>
          </div>

        </form>
      </div>

    </div>
  );
};
