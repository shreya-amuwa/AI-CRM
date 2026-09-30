import React, { useState } from 'react';
import { Shield, Key, Lock, Globe, CheckCircle2, AlertTriangle, RefreshCw, Copy, Check, Save } from 'lucide-react';
import { useAiqrAuth } from '../../context/AiqrAuthContext';

export const AiqrSecurityPanel: React.FC = () => {
  const { user } = useAiqrAuth();

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  // Security Configuration State
  const [whitelistedDomains, setWhitelistedDomains] = useState('amuwa.com, aiqr.io, qr.nexustech.in');
  const [maxScansPerMin, setMaxScansPerMin] = useState('120');
  const [enableBotHoneypot, setEnableBotHoneypot] = useState(true);
  const [sessionTimeoutMins, setSessionTimeoutMins] = useState('60');

  const handleCopy = (text: string, keyId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto font-sans animate-fade-in">
      
      {/* Security Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-900 border border-slate-800 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <Shield className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-heading text-white">AIQR Security &amp; Access Control</h2>
            <p className="text-xs font-mono text-slate-400">Manage security keys, scanner domain restrictions, and anti-abuse protection</p>
          </div>
        </div>

        <button
          onClick={handleSave}
          className={`px-5 py-2.5 rounded-xl font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 ${
            isSaved ? 'bg-emerald-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
        >
          {isSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{isSaved ? 'Security Rules Saved!' : 'Save Security Rules'}</span>
        </button>
      </div>

      {/* Security Keys Section */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 text-white shadow-lg space-y-4">
        <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold font-heading text-white flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-400" />
              Active System Security Keys
            </h3>
            <p className="text-xs font-mono text-slate-400">Passcode keys used for authenticating into the AIQR Platform</p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            ● 2 Active Keys
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
          
          {/* Master Admin Key */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-indigo-400">SUPER ADMIN MASTER KEY</span>
              <span className="text-[10px] text-slate-500">Tier 1</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-slate-200">
              <span>AIQR-2026-SECURE</span>
              <button
                onClick={() => handleCopy('AIQR-2026-SECURE', 'key-admin')}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-all"
              >
                {copiedKey === 'key-admin' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">Unrestricted full access to all client QR codes &amp; lead ingestion logs.</p>
          </div>

          {/* Agency Manager Key */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-purple-400">AGENCY MANAGER KEY</span>
              <span className="text-[10px] text-slate-500">Tier 2</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-slate-200">
              <span>AIQR-AGENCY-99</span>
              <button
                onClick={() => handleCopy('AIQR-AGENCY-99', 'key-agency')}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-all"
              >
                {copiedKey === 'key-agency' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">Agency access for managing dynamic target URLs &amp; client link builders.</p>
          </div>

        </div>
      </div>

      {/* Domain & Scanner Protection Rules */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 text-white shadow-lg space-y-6">
        <form onSubmit={handleSave} className="space-y-6 text-xs font-mono">
          
          <div className="border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold font-heading text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-indigo-400" />
              Domain &amp; Scanner Anti-Abuse Rules
            </h3>
            <p className="text-xs font-mono text-slate-400">Configure rate-limiting and allowed hostnames for dynamic scan redirection</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5 uppercase">Whitelisted Redirection Domains</label>
              <input
                type="text"
                value={whitelistedDomains}
                onChange={e => setWhitelistedDomains(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">Comma-separated domains allowed for dynamic QR redirection.</p>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1.5 uppercase">Max Scans / Minute / IP</label>
              <input
                type="number"
                value={maxScansPerMin}
                onChange={e => setMaxScansPerMin(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">Prevents DDoS or automated QR scanning bot spam.</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="font-bold text-slate-200">Bot &amp; Honeypot Lead Filtering</div>
              <div className="text-[11px] text-slate-400">Automatically flag or block fake scan submissions generated by Web Crawlers.</div>
            </div>
            <input
              type="checkbox"
              checked={enableBotHoneypot}
              onChange={e => setEnableBotHoneypot(e.target.checked)}
              className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
            />
          </div>

        </form>
      </div>

    </div>
  );
};
