import React, { useState } from 'react';
import { Phone, MessageSquare, Mail, Calendar, MoreVertical, CheckCircle2, Clock } from 'lucide-react';
import { FollowUpTask } from '../../types/crm';

interface MemberFollowUpsTableProps {
  followUps: FollowUpTask[];
  onCall: (task: FollowUpTask) => void;
  onOpenMessage: (task: FollowUpTask) => void;
  onViewDetails: (task: FollowUpTask) => void;
  onToggleComplete: (taskId: string) => void;
}

export const MemberFollowUpsTable: React.FC<MemberFollowUpsTableProps> = ({
  followUps,
  onCall,
  onOpenMessage,
  onViewDetails,
  onToggleComplete
}) => {
  const [activeTab, setActiveTab] = useState<'upcoming' | 'overdue' | 'completed'>('upcoming');

  const upcomingTasks = followUps.filter(f => f.status === 'upcoming');
  const overdueTasks = followUps.filter(f => f.status === 'overdue');
  const completedTasks = followUps.filter(f => f.status === 'completed');

  const displayedTasks =
    activeTab === 'upcoming'
      ? upcomingTasks
      : activeTab === 'overdue'
      ? overdueTasks
      : completedTasks;

  const getInitials = (name: string) => {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getTypeBadge = (type: FollowUpTask['type']) => {
    switch (type) {
      case 'Call':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-100">
            <Phone className="w-2.5 h-2.5" />
            <span>Call</span>
          </span>
        );
      case 'WhatsApp':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
            <MessageSquare className="w-2.5 h-2.5" />
            <span>WhatsApp</span>
          </span>
        );
      case 'Email':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-600 border border-purple-100">
            <Mail className="w-2.5 h-2.5" />
            <span>Email</span>
          </span>
        );
      case 'Meeting':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-600 border border-amber-100">
            <Calendar className="w-2.5 h-2.5" />
            <span>Meeting</span>
          </span>
        );
    }
  };

  const handleActionClick = (task: FollowUpTask) => {
    if (task.type === 'Call') {
      onCall(task);
    } else if (task.type === 'WhatsApp' || task.type === 'Email') {
      onOpenMessage(task);
    } else {
      onViewDetails(task);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
      {/* TABS */}
      <div className="flex items-center gap-6 border-b border-slate-100 pb-3">
        <button
          onClick={() => setActiveTab('upcoming')}
          className={`text-xs font-bold pb-2 relative transition-colors cursor-pointer ${
            activeTab === 'upcoming'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Upcoming Follow-ups
        </button>

        <button
          onClick={() => setActiveTab('overdue')}
          className={`flex items-center gap-1.5 text-xs font-bold pb-2 relative transition-colors cursor-pointer ${
            activeTab === 'overdue'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Overdue</span>
          {overdueTasks.length > 0 && (
            <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
              {overdueTasks.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('completed')}
          className={`text-xs font-bold pb-2 relative transition-colors cursor-pointer ${
            activeTab === 'completed'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Completed
        </button>
      </div>

      {/* TABLE */}
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[11px] font-bold text-slate-400 border-b border-slate-100">
              <th className="pb-2.5 font-medium">Lead / Customer</th>
              <th className="pb-2.5 font-medium">Type</th>
              <th className="pb-2.5 font-medium">Date & Time</th>
              <th className="pb-2.5 font-medium">Notes</th>
              <th className="pb-2.5 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {displayedTasks.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  No {activeTab} follow-ups
                </td>
              </tr>
            ) : (
              displayedTasks.map(task => (
                <tr key={task.id} className="hover:bg-slate-50/70 transition-colors group">
                  {/* Lead / Customer */}
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-[11px] shrink-0">
                        {getInitials(task.leadName)}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 leading-tight">{task.leadName}</div>
                        <div className="text-[11px] text-slate-500 leading-tight">{task.company}</div>
                      </div>
                    </div>
                  </td>

                  {/* Type */}
                  <td className="py-3 pr-3">
                    {getTypeBadge(task.type)}
                  </td>

                  {/* Date & Time */}
                  <td className="py-3 pr-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                    {task.dateTimeStr}
                  </td>

                  {/* Notes */}
                  <td className="py-3 pr-3 text-slate-600 text-xs max-w-xs truncate">
                    {task.notes}
                  </td>

                  {/* Action */}
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleActionClick(task)}
                        className={`
                          px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-xs
                          ${
                            task.type === 'Call'
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : task.type === 'Meeting'
                              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }
                        `}
                      >
                        {task.type === 'Call' ? 'Call' : task.type === 'Meeting' ? 'View' : 'Open'}
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleComplete(task.id)}
                        className="p-1 text-slate-400 hover:text-emerald-600 rounded-md hover:bg-emerald-50 transition-colors"
                        title={task.status === 'completed' ? 'Mark uncompleted' : 'Mark completed'}
                      >
                        <CheckCircle2 className={`w-4 h-4 ${task.status === 'completed' ? 'text-emerald-600 fill-emerald-100' : ''}`} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
