import React, { useState } from 'react';
import { 
  Globe, Shield, Lock, FileText, CheckCircle2, MessageSquare, 
  Download, ArrowLeft, ExternalLink, HelpCircle
} from 'lucide-react';

interface ClientPortalProps {
  onReturnToAdminLogin: () => void;
}

export const ClientPortal: React.FC<ClientPortalProps> = ({ onReturnToAdminLogin }) => {
  const [clientEmail, setClientEmail] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const mockClientInvoices = [
    { id: 'INV-2026-091', date: '2026-08-01', amount: '$4,250.00', status: 'Paid', title: 'Q3 Enterprise Software Subscription' },
    { id: 'INV-2026-044', date: '2026-07-01', amount: '$4,250.00', status: 'Paid', title: 'Q2 Cloud Infrastructure & API Usage' }
  ];

  const mockClientProjects = [
    { name: 'Custom WhatsApp API Integration', department: 'Whatsbox', progress: 85, status: 'In Testing' },
    { name: 'Managed Tele-Calling Outbound Suite', department: 'D Talk Corporation', progress: 100, status: 'Active Live' }
  ];

  const handleClientLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (clientEmail) setIsLoggedIn(true);
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-slate-100 flex flex-col justify-center items-center px-4 relative overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-emerald-600/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-md w-full text-center mb-6 z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono mb-4">
            <Globe className="w-3.5 h-3.5" />
            <span>EXTERNAL CLIENT PORTAL &bull; ISOLATED ACCESS</span>
          </div>
          <h1 className="text-3xl font-bold font-heading text-white">
            Client Self-Service Portal
          </h1>
          <p className="text-xs text-slate-400 mt-2">
            Secure client access for Amuwa Corporation Group customers. View your project milestones, invoices, and support tickets.
          </p>
        </div>

        <div className="w-full max-w-md glass-panel p-8 rounded-2xl border border-slate-800 shadow-2xl relative z-10">
          <form onSubmit={handleClientLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">
                Client Organization Email
              </label>
              <input
                type="email"
                required
                placeholder="client@partner-company.com"
                value={clientEmail}
                onChange={e => setClientEmail(e.target.value)}
                className="w-full p-2.5 bg-[#0B1120] border border-slate-700 rounded-xl text-slate-100 text-sm font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">
                Client Access Key / Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                defaultValue="clientkey123"
                className="w-full p-2.5 bg-[#0B1120] border border-slate-700 rounded-xl text-slate-100 text-sm font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm font-mono transition-all shadow-lg shadow-emerald-950/40"
            >
              Sign In to Client Portal
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <button
              onClick={onReturnToAdminLogin}
              className="text-xs font-mono text-slate-400 hover:text-cyan-400 flex items-center justify-center gap-1.5 mx-auto"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Switch to Internal Admin Staff Login</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-100 p-6 flex flex-col max-w-6xl mx-auto">
      {/* Client Header */}
      <header className="flex items-center justify-between pb-6 mb-8 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center font-bold text-white shadow-lg shadow-emerald-950/40">
            CP
          </div>
          <div>
            <h1 className="text-xl font-bold font-heading text-white">
              Client Portal &bull; TechSol Global
            </h1>
            <p className="text-xs font-mono text-slate-400">Authenticated Client Account: {clientEmail}</p>
          </div>
        </div>

        <button
          onClick={() => setIsLoggedIn(false)}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition-colors"
        >
          Sign Out
        </button>
      </header>

      {/* Main Client Content */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
        
        {/* Active Projects */}
        <div className="p-6 rounded-2xl glass-panel border border-slate-800">
          <h2 className="text-lg font-bold font-heading text-white mb-4">Your Active Projects</h2>
          <div className="space-y-4">
            {mockClientProjects.map((p, i) => (
              <div key={i} className="p-4 rounded-xl bg-[#0B1120] border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">{p.name}</span>
                  <span className="font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    {p.status}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-500">Unit: {p.department}</div>
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${p.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Invoices */}
        <div className="p-6 rounded-2xl glass-panel border border-slate-800">
          <h2 className="text-lg font-bold font-heading text-white mb-4">Billing & Invoices</h2>
          <div className="space-y-3">
            {mockClientInvoices.map(inv => (
              <div key={inv.id} className="p-4 rounded-xl bg-[#0B1120] border border-slate-800 flex items-center justify-between text-xs">
                <div>
                  <span className="font-mono font-bold text-white block">{inv.id}</span>
                  <span className="text-slate-400">{inv.title}</span>
                  <span className="text-[10px] text-slate-500 block font-mono mt-0.5">{inv.date}</span>
                </div>
                <div className="text-right font-mono">
                  <span className="font-bold text-white text-sm block">{inv.amount}</span>
                  <span className="text-emerald-400 text-[10px] uppercase font-bold">{inv.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      <footer className="mt-12 text-center text-xs font-mono text-slate-500 pt-4 border-t border-slate-800">
        Strict External Isolation &bull; Client Portal &copy; Amuwa Corporation Group 2026
      </footer>
    </div>
  );
};
