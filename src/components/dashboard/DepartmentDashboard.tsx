import React from 'react';
import { Database, Clock, Users, ArrowUpRight, Radio, ExternalLink } from 'lucide-react';
import { DepartmentId } from '../../types/crm';
import { useAuth } from '../../context/AuthContext';
import { useLeadStore } from '../../context/LeadStoreContext';
import { LEAD_SOURCES, LEAD_SOURCE_LIST } from '../../data/leadSources';
import { ConvergenceView } from './ConvergenceView';
import { sessionManager } from '../../services/sessionManager';

interface DepartmentDashboardProps {
  departmentId: DepartmentId;
  onNavigateToLeads: () => void;
  onOpenWebhookSimulator?: () => void;
}

export const DepartmentDashboard: React.FC<DepartmentDashboardProps> = ({
  departmentId,
  onNavigateToLeads
}) => {
  const { activeDepartment } = useAuth();
  const { getLeadsForDepartment } = useLeadStore();

  const deptLeads = getLeadsForDepartment(departmentId);
  const activeSessions = sessionManager.getDepartmentSessions(departmentId);

  // Stats calculation
  const totalLeadsCount = deptLeads.length;
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const newLeadsCount = deptLeads.filter(l => new Date(l.receivedAt).getTime() > oneDayAgo).length;

  const recentLeads = deptLeads.slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Department Panel Header with Authentic Brand Logo */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200 shadow-sm relative overflow-hidden">
        {/* Top Accent Line */}
        <div 
          className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r"
          style={{
            backgroundImage: `linear-gradient(to right, ${activeDepartment?.accentColor || '#3B82F6'}, ${activeDepartment?.accentColor || '#3B82F6'}88)`
          }}
        />

        <div className="flex items-center gap-4">
          {/* Authentic Department Logo Badge */}
          {activeDepartment?.logoUrl ? (
            <div className="h-14 w-14 rounded-2xl bg-slate-50 p-1 border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
              <img 
                src={activeDepartment.logoUrl} 
                alt={activeDepartment.name}
                className="h-full w-full object-contain"
              />
            </div>
          ) : null}

          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-mono text-emerald-700 font-semibold uppercase">
                {activeDepartment?.name?.toUpperCase()} &bull; LIVE INGESTION ACTIVE
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900">
              {activeDepartment?.name} Panel
            </h2>
            <p className="text-sm text-slate-500 mt-1 max-w-xl">
              {activeDepartment?.description?.trim() || 'No description provided'}
            </p>
            {activeDepartment?.category && (
              <span className="inline-flex items-center mt-2 mr-2 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-mono font-semibold text-slate-600">
                Category: {activeDepartment.category}
              </span>
            )}
            <span className="inline-flex items-center mt-2 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-[11px] font-mono font-semibold text-blue-600">
              Shared Lead Ingestion Framework
            </span>
          </div>
        </div>
      </div>

      {/* Transparency note: this is the shared generic framework used by
          every department without a hand-built specialized panel — never
          cloned from any single other department. All figures below are
          scoped strictly to this department's own id. */}
      <div className="text-xs font-mono text-slate-400 px-1">
        This department has no specialized modules configured yet — showing the shared generic lead-ingestion dashboard, scoped to {activeDepartment?.name || 'this department'} only.
      </div>

      {/* 4 KPI Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Leads Stored */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
          <div>
            <span className="text-xs font-mono text-slate-400 uppercase block">TOTAL LEADS STORED</span>
            <span className="text-3xl font-bold font-mono text-slate-900 mt-1 block">
              {totalLeadsCount}
            </span>
            <span className="text-[11px] text-emerald-600 font-mono flex items-center gap-1 mt-1 font-semibold">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Unified Vault</span>
            </span>
          </div>
          <div className="p-3 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
            <Database className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2: New Leads Count (24h) */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
          <div>
            <span className="text-xs font-mono text-slate-400 uppercase block">NEW LEADS (24H)</span>
            <span className="text-3xl font-bold font-mono text-emerald-600 mt-1 block">
              +{newLeadsCount}
            </span>
            <span className="text-[11px] text-slate-500 font-mono mt-1 block">
              Past 24 Hours Ingress
            </span>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3: Sources Connected */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
          <div>
            <span className="text-xs font-mono text-slate-400 uppercase block">SOURCES CONNECTED</span>
            <span className="text-3xl font-bold font-mono text-blue-600 mt-1 block">
              10 / 10
            </span>
            <span className="text-[11px] text-slate-500 font-mono mt-1 block">
              Webhook Pipeline
            </span>
          </div>
          <div className="p-3 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
            <Radio className="w-6 h-6" />
          </div>
        </div>

        {/* Card 4: Active Session Security Status */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
          <div>
            <span className="text-xs font-mono text-slate-400 uppercase block">ACTIVE SESSIONS</span>
            <span className="text-3xl font-bold font-mono text-amber-600 mt-1 block">
              {activeSessions.length} / 2
            </span>
            <span className="text-[11px] text-slate-500 font-mono mt-1 block">
              Limit Enforced
            </span>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 text-amber-600 border border-amber-100">
            <Users className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Signature Visual Element: "10 Sources -> Unified Store" Live Convergence View */}
      <ConvergenceView departmentId={departmentId} />

      {/* Grid: Lead Sources Volume Breakdown + Recent Ingestion Live Ticker */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Lead Sources Breakdown (Cols 1-7) */}
        <div className="lg:col-span-7 p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold font-heading text-slate-900">Lead Volume by Source</h3>
              <p className="text-xs text-slate-500">Distribution across all 10 connected lead channels</p>
            </div>
            <span className="text-xs font-mono text-slate-500 px-2.5 py-1 rounded bg-slate-100 border border-slate-200 font-semibold">
              10 Channels
            </span>
          </div>

          <div className="space-y-3">
            {LEAD_SOURCE_LIST.map(src => {
              const count = deptLeads.filter(l => l.sourceId === src.id).length;
              const percentage = totalLeadsCount > 0 ? (count / totalLeadsCount) * 100 : 0;

              return (
                <div key={src.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="flex items-center gap-2 text-slate-700 font-medium">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: src.color }} />
                      {src.name}
                    </span>
                    <span className="text-slate-500">
                      <strong className="text-slate-900" style={{ color: src.color }}>{count}</strong> leads ({percentage.toFixed(1)}%)
                    </span>
                  </div>

                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(percentage, 3)}%`, backgroundColor: src.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Live Ingestion Feed Preview (Cols 8-12) */}
        <div className="lg:col-span-5 p-6 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold font-heading text-slate-900">Recent Ingestion Feed</h3>
              </div>
              <button
                onClick={onNavigateToLeads}
                className="text-xs font-mono text-blue-600 hover:underline flex items-center gap-1 font-semibold"
              >
                <span>View All &rarr;</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {recentLeads.map(lead => {
                const srcObj = LEAD_SOURCES[lead.sourceId];
                return (
                  <div
                    key={lead.id}
                    className="p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between gap-3 text-xs transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{lead.name}</span>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold border ${srcObj.bgClass} ${srcObj.textClass} ${srcObj.borderClass}`}
                        >
                          {srcObj.badgeLabel}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 mt-0.5 block">
                        {lead.contact}
                      </span>
                    </div>

                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {new Date(lead.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <button
              onClick={onNavigateToLeads}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-mono font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <span>OPEN UNIFIED LEADS TABLE</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
