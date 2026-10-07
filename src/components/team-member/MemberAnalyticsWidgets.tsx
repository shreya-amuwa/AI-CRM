import React from 'react';
import { LeadSourceStat } from '../../types/crm';

interface MemberAnalyticsWidgetsProps {
  leadSources: LeadSourceStat[];
  conversionRate: number;
  convertedCount: number;
  totalLeads: number;
}

export const MemberAnalyticsWidgets: React.FC<MemberAnalyticsWidgetsProps> = ({
  leadSources,
  conversionRate,
  convertedCount,
  totalLeads
}) => {
  // SVG Donut calculation
  const size = 120;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Compute strokeDasharrays for donut
  let cumulativeOffset = 0;
  const segments = leadSources.filter(source => source.count > 0).map((source) => {
    const strokeDasharray = `${(source.percentage / 100) * circumference} ${circumference}`;
    const strokeDashoffset = -cumulativeOffset;
    cumulativeOffset += (source.percentage / 100) * circumference;
    return {
      ...source,
      strokeDasharray,
      strokeDashoffset
    };
  });

  return (
    <div className="space-y-4">
      {/* 1. LEAD SOURCE DONUT CARD */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <h3 className="text-xs font-bold font-heading text-slate-900 mb-3">Lead Source</h3>
        
        <div className="flex items-center gap-4">
          {/* Donut Chart */}
          <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#F1F5F9"
                strokeWidth={strokeWidth}
              />
              {segments.map((seg, idx) => (
                <circle
                  key={idx}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={seg.strokeDasharray}
                  strokeDashoffset={seg.strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-500 ease-out"
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-lg font-bold font-heading text-slate-900 leading-tight">
                {totalLeads}
              </span>
              <span className="text-[9px] text-slate-400 font-medium leading-none">
                Total Leads
              </span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-1.5 text-[11px]">
            {leadSources.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-medium text-slate-700">{item.name}</span>
                </div>
                <span className="font-mono text-slate-500 text-[10px]">
                  {item.count} ({item.percentage}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. CONVERSION RATE CARD */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <h3 className="text-xs font-bold font-heading text-slate-900">Conversion Rate</h3>
        <div className="text-2xl font-bold font-heading text-slate-900 mt-2">{conversionRate}%</div>
        <p className="text-[11px] text-slate-500 mt-1">
          {convertedCount} out of {totalLeads} leads converted
        </p>
        <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mt-3">
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.min(100, conversionRate)}%` }} />
        </div>
      </div>
    </div>
  );
};
