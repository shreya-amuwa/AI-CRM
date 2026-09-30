import React from 'react';
import { QrCode, Users, BarChart3, Link, Shield, Sparkles, Layers, RefreshCw } from 'lucide-react';

export type AiqrTab = 'studio' | 'clients' | 'analytics' | 'links' | 'security';

interface AiqrSidebarProps {
  activeTab: AiqrTab;
  onSelectTab: (tab: AiqrTab) => void;
  totalClientsCount?: number;
  totalScansCount?: number;
}

export const AiqrSidebar: React.FC<AiqrSidebarProps> = ({
  activeTab,
  onSelectTab,
  totalClientsCount = 2,
  totalScansCount = 61
}) => {
  const navItems: { id: AiqrTab; label: string; icon: React.FC<{ className?: string }>; badge?: string | number }[] = [
    { id: 'studio', label: 'AIQR Studio & Generator', icon: QrCode, badge: 'PRO' },
    { id: 'clients', label: 'Client QR Portfolios', icon: Users, badge: totalClientsCount },
    { id: 'analytics', label: 'Scan Lead Analytics', icon: BarChart3, badge: totalScansCount },
    { id: 'links', label: 'Smart App Links', icon: Link },
    { id: 'security', label: 'Access & Security', icon: Shield }
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 text-slate-300 flex flex-col justify-between shrink-0 font-sans min-h-[calc(100vh-61px)]">
      
      {/* Navigation Links */}
      <div className="p-4 space-y-6">
        <div>
          <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider px-3 mb-2">
            AIQR Core Control
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`w-full px-3 py-2.5 rounded-xl font-mono text-xs flex items-center justify-between transition-all font-medium ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 font-bold'
                      : 'hover:bg-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>

                  {item.badge !== undefined && (
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      isActive
                        ? 'bg-indigo-500/40 text-white'
                        : 'bg-slate-800 text-slate-400 border border-slate-700/60'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Dynamic Scan Ingestion Card */}
        <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold text-indigo-400">LIVE INGESTION</span>
            <RefreshCw className="w-3 h-3 text-emerald-400 animate-spin" />
          </div>
          <p className="text-[10px] text-slate-500 leading-tight">
            Device fingerprints &amp; scan geo-locations auto-synced into CRM.
          </p>
          <div className="pt-1 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Today's Ingested:</span>
            <span className="font-bold text-emerald-400">+19 Leads</span>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 font-mono text-[10px] text-slate-500 space-y-1 text-center">
        <div>AIQR Autonomous Suite &bull; Build 2026.8</div>
        <div className="text-emerald-500 font-bold">● Security Guard Protected</div>
      </div>

    </aside>
  );
};
