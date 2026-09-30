import React from 'react';
import {
  Plus,
  Phone,
  MessageSquare,
  Handshake,
  Clock,
  Calendar,
  FileText,
  TrendingUp,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { TeamMemberActivity, RecentUpdate, MemberTarget } from '../../types/crm';

interface MemberRightSidebarProps {
  userName: string;
  userRole?: string;
  avatarUrl: string;
  target: MemberTarget;
  activities: TeamMemberActivity[];
  recentUpdates: RecentUpdate[];
  onAddLead: () => void;
  onLogCall: () => void;
  onSendWhatsApp: () => void;
  onCreateDeal: () => void;
  onOpenEndOfDay: () => void;
  isDayCompleted: boolean;
}

export const MemberRightSidebar: React.FC<MemberRightSidebarProps> = ({
  userName,
  userRole = 'Sales Executive',
  avatarUrl,
  target,
  activities,
  recentUpdates,
  onAddLead,
  onLogCall,
  onSendWhatsApp,
  onCreateDeal,
  onOpenEndOfDay,
  isDayCompleted
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

  const getUpdateIcon = (type: RecentUpdate['type']) => {
    switch (type) {
      case 'lead':
        return <Plus className="w-3 h-3 text-blue-500" />;
      case 'deal':
        return <TrendingUp className="w-3 h-3 text-amber-500" />;
      case 'invoice':
        return <FileText className="w-3 h-3 text-emerald-500" />;
      case 'call':
      default:
        return <Phone className="w-3 h-3 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. PROFILE & TARGET CARD */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <img
            src={avatarUrl}
            alt={userName}
            className="w-12 h-12 rounded-full object-cover ring-2 ring-blue-500/20"
          />
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
        </div>
      </div>

      {/* 2. QUICK ACTIONS PANEL */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <h3 className="text-xs font-bold font-heading text-slate-900 mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onAddLead}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 text-slate-700 hover:text-blue-700 text-xs font-semibold transition-all cursor-pointer shadow-2xs"
          >
            <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Plus className="w-3.5 h-3.5" />
            </div>
            <span>Add Lead</span>
          </button>

          <button
            type="button"
            onClick={onLogCall}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 text-slate-700 hover:text-blue-700 text-xs font-semibold transition-all cursor-pointer shadow-2xs"
          >
            <div className="w-6 h-6 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
              <Phone className="w-3.5 h-3.5" />
            </div>
            <span>Log Call</span>
          </button>

          <button
            type="button"
            onClick={onSendWhatsApp}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/50 text-slate-700 hover:text-emerald-700 text-xs font-semibold transition-all cursor-pointer shadow-2xs"
          >
            <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <MessageSquare className="w-3.5 h-3.5" />
            </div>
            <span>Send WhatsApp</span>
          </button>

          <button
            type="button"
            onClick={onCreateDeal}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:border-purple-400 hover:bg-purple-50/50 text-slate-700 hover:text-purple-700 text-xs font-semibold transition-all cursor-pointer shadow-2xs"
          >
            <div className="w-6 h-6 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
              <Handshake className="w-3.5 h-3.5" />
            </div>
            <span>Create Deal</span>
          </button>
        </div>
      </div>

      {/* 3. TODAY'S ACTIVITIES */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold font-heading text-slate-900">Today's Activities</h3>
          <button
            type="button"
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
          >
            View All
          </button>
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

      {/* 4. RECENT UPDATES */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold font-heading text-slate-900">Recent Updates</h3>
          <button
            type="button"
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
          >
            View All
          </button>
        </div>

        <div className="space-y-3">
          {recentUpdates.slice(0, 3).map(update => (
            <div key={update.id} className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                {getUpdateIcon(update.type)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-700 leading-tight">
                  {update.title}
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                  {update.timeAgo}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. COMPLETE MY DAY */}
      <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 text-white shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-100 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>End of Day</span>
          </span>
          {isDayCompleted && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-emerald-700">
              Completed ✓
            </span>
          )}
        </div>
        <p className="text-xs text-emerald-50 mb-3 leading-relaxed">
          {isDayCompleted
            ? 'Your daily report has been saved. Rest well!'
            : 'Wrap up your daily sales activities and submit your progress summary.'}
        </p>
        <button
          type="button"
          onClick={onOpenEndOfDay}
          className="w-full py-2 px-3 bg-white text-emerald-800 rounded-xl font-bold text-xs shadow-sm hover:bg-emerald-50 transition-all cursor-pointer flex items-center justify-center gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>{isDayCompleted ? 'View Day Summary' : 'Complete My Day ✓'}</span>
        </button>
      </div>
    </div>
  );
};
