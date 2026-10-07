import React from 'react';
import { QrCode, ShieldCheck, LogOut, Sparkles, ExternalLink, Activity, User } from 'lucide-react';
import { useAiqrAuth } from '../../context/AiqrAuthContext';

interface AiqrHeaderProps {
  onOpenPublicScanDemo: () => void;
}

export const AiqrHeader: React.FC<AiqrHeaderProps> = ({ onOpenPublicScanDemo }) => {
  const { user, logout } = useAiqrAuth();

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 px-6 py-3 flex items-center justify-between sticky top-0 z-40 shadow-lg font-sans">
      
      {/* Left: Branding */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            <QrCode className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-lg tracking-tight font-heading text-white">AIQR STUDIO</span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                PRO PLATFORM
              </span>
            </div>
            <p className="text-[11px] font-mono text-slate-400">Autonomous Dynamic QR & Lead Ingestion Engine</p>
          </div>
        </div>

        {/* Live Status Indicator */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-300">Engine Live</span>
          <span className="text-slate-600">|</span>
          <Activity className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-slate-400">Lead Stream Active</span>
        </div>
      </div>

      {/* Right: Actions & User Info */}
      <div className="flex items-center gap-3">

        {/* Public Visitor Scan Demo Button */}
        <button
          onClick={onOpenPublicScanDemo}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-indigo-300 flex items-center gap-1.5 transition-all"
          title="Simulate scanning a physical QR code as a visitor"
        >
          <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden sm:inline">Simulate Visitor Scan</span>
        </button>

        {/* Security Tier Badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs font-mono">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{user?.role || 'Super Admin'}</span>
        </div>

        {/* User Avatar & Logout */}
        <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
              {user?.name?.[0] || 'U'}
            </div>
            <div className="hidden lg:block text-left font-mono">
              <div className="text-xs font-bold text-slate-200">{user?.name || 'Operator'}</div>
              <div className="text-[10px] text-slate-400">{user?.email || 'admin@aiqr.io'}</div>
            </div>
          </div>

          <button
            onClick={logout}
            className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/50 hover:text-rose-400 text-slate-400 transition-all border border-slate-700/60"
            title="Log out from AIQR Platform"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

      </div>

    </header>
  );
};
