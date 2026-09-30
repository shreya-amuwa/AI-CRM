import React from 'react';
import { X, Phone, MessageCircle, Send, CheckCircle2, ArrowRight, Calendar } from 'lucide-react';

interface Lead {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  product: string;
  lastInteraction: string;
  stage: string;
  nextAction: string;
  nextFollowUp: string;
  priority: string;
  assignedTo: string;
  createdAt: string;
  activities: Array<{
    date: string;
    action: string;
    notes: string;
  }>;
}

interface LeadActivityTimelineProps {
  lead: Lead;
  onClose: () => void;
}

export const LeadActivityTimeline: React.FC<LeadActivityTimelineProps> = ({ lead, onClose }) => {
  const getActivityIcon = (action: string) => {
    if (action.toLowerCase().includes('call')) return <Phone className="w-4 h-4" />;
    if (action.toLowerCase().includes('whatsapp') || action.toLowerCase().includes('message')) return <MessageCircle className="w-4 h-4" />;
    if (action.toLowerCase().includes('proposal') || action.toLowerCase().includes('email')) return <Send className="w-4 h-4" />;
    if (action.toLowerCase().includes('demo')) return <CheckCircle2 className="w-4 h-4" />;
    return <ArrowRight className="w-4 h-4" />;
  };

  const getActivityColor = (action: string) => {
    if (action.toLowerCase().includes('won')) return 'text-emerald-600 bg-emerald-50';
    if (action.toLowerCase().includes('lost')) return 'text-red-600 bg-red-50';
    if (action.toLowerCase().includes('demo')) return 'text-indigo-600 bg-indigo-50';
    if (action.toLowerCase().includes('proposal')) return 'text-cyan-600 bg-cyan-50';
    if (action.toLowerCase().includes('follow-up')) return 'text-purple-600 bg-purple-50';
    return 'text-slate-600 bg-slate-50';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center sm:justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-indigo-50 to-indigo-50 border-b border-indigo-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Activity Timeline</h2>
            <p className="text-sm text-slate-600">{lead.name} • {lead.company}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Lead Summary Card */}
          <div className="bg-gradient-to-r from-slate-50 to-slate-50 rounded-2xl border border-slate-200 p-4 mb-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-xs font-semibold text-slate-600 uppercase">Phone</span>
                <p className="font-mono text-slate-900 mt-0.5">{lead.phone}</p>
              </div>
              <div>
                <span className="text-xs font-semibold text-slate-600 uppercase">Email</span>
                <p className="font-mono text-slate-900 mt-0.5 text-xs">{lead.email}</p>
              </div>
              <div>
                <span className="text-xs font-semibold text-slate-600 uppercase">Product</span>
                <p className="text-slate-900 mt-0.5">{lead.product}</p>
              </div>
              <div>
                <span className="text-xs font-semibold text-slate-600 uppercase">Stage</span>
                <p className="text-slate-900 mt-0.5 font-semibold">{lead.stage.toUpperCase().replace('-', ' ')}</p>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-4">Journey</h3>

            {lead.activities.length > 0 ? (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-slate-200 via-slate-300 to-slate-200" />

                {/* Timeline items */}
                <div className="space-y-4">
                  {lead.activities.map((activity, index) => (
                    <div key={index} className="relative pl-16">
                      {/* Timeline dot */}
                      <div className={`absolute left-0 top-1.5 w-14 h-14 rounded-full flex items-center justify-center ${getActivityColor(activity.action)} border-4 border-white shadow-sm`}>
                        {getActivityIcon(activity.action)}
                      </div>

                      {/* Activity card */}
                      <div className="bg-white rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-slate-900">{activity.action}</span>
                              <span className="text-xs font-mono text-slate-500">{activity.date}</span>
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-slate-600">{activity.notes}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-6 text-center">
                <p className="text-slate-600 text-sm">No activities recorded yet</p>
              </div>
            )}
          </div>

          {/* Next Action Card */}
          {lead.nextAction && (
            <div className="mt-8 bg-gradient-to-r from-blue-50 to-blue-50 rounded-2xl border-2 border-blue-200 p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-100 rounded-lg mt-1">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-1">Next Action</div>
                  <h4 className="font-semibold text-slate-900 mb-1">{lead.nextAction}</h4>
                  <p className="text-sm text-slate-600">Scheduled: {lead.nextFollowUp}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
