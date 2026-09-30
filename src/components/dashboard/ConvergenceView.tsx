import React from 'react';
import { Database, Sparkles } from 'lucide-react';
import { LEAD_SOURCE_LIST } from '../../data/leadSources';
import { useLeadStore } from '../../context/LeadStoreContext';
import { DepartmentId } from '../../types/crm';
import { VisualIngestionStreamAnimation } from './VisualIngestionStreamAnimation';

interface ConvergenceViewProps {
  departmentId: DepartmentId;
}

export const ConvergenceView: React.FC<ConvergenceViewProps> = ({ departmentId }) => {
  const { getLeadsForDepartment } = useLeadStore();

  const deptLeads = getLeadsForDepartment(departmentId);
  const totalLeadCount = deptLeads.length;

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden my-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 relative z-10">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-mono mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>10-SOURCE VISUAL INGESTION STREAM</span>
          </div>
          <h3 className="text-xl font-bold font-heading text-slate-900">
            10 Inbound Webhook Sources &rarr; Unified Lead Store
          </h3>
        </div>

        <div className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-right shrink-0">
          <span className="text-[10px] font-mono text-slate-400 block uppercase">CONVERGED TOTAL STORE</span>
          <span className="text-2xl font-bold font-mono text-blue-600">{totalLeadCount}</span>
          <span className="text-[10px] font-mono text-slate-500 block">LEADS INGESTED</span>
        </div>
      </div>

      {/* 10-Lane Convergence Visual Graphic */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-2 items-center">
        
        {/* Left Side: 10 Labeled Webhook Source Lanes (Cols 1-7) */}
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {LEAD_SOURCE_LIST.map((source, index) => {
            const count = deptLeads.filter(l => l.sourceId === source.id).length;
            const percentage = totalLeadCount > 0 ? ((count / totalLeadCount) * 100).toFixed(1) : '0';

            return (
              <div
                key={source.id}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-blue-400 transition-all flex items-center justify-between relative overflow-hidden group"
              >
                {/* Source Color Side Bar Indicator */}
                <div 
                  className="absolute left-0 top-0 bottom-0 w-1.5"
                  style={{ backgroundColor: source.color }}
                />

                <div className="pl-2 flex items-center gap-2.5">
                  <div 
                    className="w-2.5 h-2.5 rounded-full animate-pulse"
                    style={{ backgroundColor: source.color }}
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-900 group-hover:text-blue-600 transition-colors block">
                      {source.name}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      Webhook Port #{1080 + index}
                    </span>
                  </div>
                </div>

                <div className="text-right font-mono">
                  <span className="text-sm font-bold" style={{ color: source.color }}>
                    {count}
                  </span>
                  <span className="text-[10px] text-slate-400 block">{percentage}%</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Center Animated Streams SVG Pathways (Col 8) */}
        <div className="hidden lg:flex lg:col-span-1 items-center justify-center">
          <VisualIngestionStreamAnimation />
        </div>

        {/* Right Side: Single Unified Vault Destination (Cols 9-12) */}
        <div className="lg:col-span-4 p-6 rounded-2xl bg-gradient-to-b from-blue-50 to-white border border-blue-200 text-center relative overflow-hidden shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-blue-100 border border-blue-200 text-blue-600 mx-auto flex items-center justify-center mb-4 shadow-sm">
            <Database className="w-8 h-8 animate-pulse text-blue-600" />
          </div>

          <span className="text-[11px] font-mono text-blue-700 uppercase tracking-widest block font-bold mb-1">
            SINGLE UNIFIED STORE
          </span>
          <h4 className="text-xl font-bold font-heading text-slate-900">
            Normalized Lead Database
          </h4>
          <p className="text-xs text-slate-500 mt-2 mb-4 leading-relaxed">
            All 10 source payloads are automatically parsed into this single shared table schema.
          </p>

          <div className="p-3 rounded-xl bg-white border border-slate-200 text-left space-y-1.5 text-[11px] font-mono shadow-sm">
            <div className="flex justify-between text-slate-500">
              <span>Active Endpoints:</span>
              <span className="text-emerald-600 font-bold">10 / 10 Active</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Sync Mode:</span>
              <span className="text-blue-600 font-bold">Real-time Push</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
