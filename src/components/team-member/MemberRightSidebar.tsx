import React from 'react';
import { Phone, MessageSquare, Calendar, FileText } from 'lucide-react';
import { TeamMemberActivity, MemberTarget } from '../../types/crm';

interface MemberRightSidebarProps {
  userName: string;
  userRole?: string;
  target: MemberTarget;
  activities: TeamMemberActivity[];
}

export const MemberRightSidebar: React.FC<MemberRightSidebarProps> = ({
  userName,
  userRole = 'Team Member',
  target,
  activities
}) => {
  const getActivityIcon = (type?: string) => {
    switch (type) {
      case 'call':
        return <Phone className="w-3.5 h-3.5 text-blue-600" />;
      case 'message':
        return <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />;
      case 'demo':
        return <Calendar className="w-3.5 h-3.5 text-amber-600" />;
      case 'stage':
      default:
        return <FileText className="w-3.5 h-3.5 text-purple-600" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. PROFILE & TARGET CARD */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-sm font-bold font-heading text-slate-900 leading-tight">
              {userName}
            </h3>
            <p className="text-xs text-slate-500 font-medium leading-tight mt-0.5">
              {userRole}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 pt-3 border-t border-slate-100">
          {target.goal > 0 ? (
            <>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-500 font-medium">Target</span>
                <span className="font-bold text-slate-800">
                  {target.current} / {target.goal} deals
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden relative">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(100, target.percentage)}%` }}
                />
              </div>
              <div className="text-right text-[11px] font-bold text-blue-600 mt-1">
                {target.percentage}%
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Target</span>
              <span className="text-slate-400">No target assigned yet</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. TODAY'S ACTIVITIES */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold font-heading text-slate-900">Today's Activities</h3>
        </div>

        <div className="space-y-3">
          {activities.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">No activities recorded today yet.</p>
          ) : (
            activities.slice(0, 4).map(act => (
              <div key={act.id} className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                  {getActivityIcon(act.type)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800 truncate leading-tight">
                    {act.action}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {act.time}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
