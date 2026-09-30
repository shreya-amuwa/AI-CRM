import React, { useState } from 'react';
import { X, Send, Calendar, Clock, MessageSquare, CheckCircle2 } from 'lucide-react';

interface Lead {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  product: string;
  lastInteraction: string;
  stage: 'new' | 'contacted' | 'qualified' | 'follow-up' | 'demo' | 'proposal' | 'negotiation' | 'won' | 'lost';
  nextAction: string;
  nextFollowUp: string;
  priority: 'high' | 'medium' | 'low';
  assignedTo: string;
  createdAt: string;
  activities: Array<{
    date: string;
    action: string;
    notes: string;
  }>;
}

interface LeadQuickUpdateProps {
  lead: Lead;
  onClose: () => void;
  onUpdate: (leadId: string, updates: Partial<Lead>) => void;
}

type UpdateOutcome = 'interested' | 'call_back' | 'follow_up' | 'demo_required' | 'proposal_required' | 'negotiation' | 'won' | 'lost' | 'not_interested';

const UPDATE_OPTIONS: Array<{
  value: UpdateOutcome;
  label: string;
  description: string;
  icon: string;
  nextStage: Lead['stage'];
}> = [
  { value: 'interested', label: 'Interested', description: 'Customer showed interest', icon: '👍', nextStage: 'qualified' },
  { value: 'call_back', label: 'Call Back', description: 'Customer wants callback', icon: '☎️', nextStage: 'contacted' },
  { value: 'follow_up', label: 'Follow-up Required', description: 'Schedule follow-up', icon: '🔔', nextStage: 'follow-up' },
  { value: 'demo_required', label: 'Demo Required', description: 'Customer wants demo', icon: '📊', nextStage: 'demo' },
  { value: 'proposal_required', label: 'Proposal Required', description: 'Send proposal', icon: '📄', nextStage: 'proposal' },
  { value: 'negotiation', label: 'Negotiation', description: 'Price/terms negotiation', icon: '💬', nextStage: 'negotiation' },
  { value: 'won', label: 'Won', description: 'Deal closed', icon: '🎉', nextStage: 'won' },
  { value: 'lost', label: 'Lost', description: 'Lost to competitor', icon: '❌', nextStage: 'lost' },
  { value: 'not_interested', label: 'Not Interested', description: 'Customer rejected', icon: '👋', nextStage: 'lost' }
];

export const LeadQuickUpdate: React.FC<LeadQuickUpdateProps> = ({ lead, onClose, onUpdate }) => {
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!outcome) {
      alert('Please select an outcome');
      return;
    }

    setIsSubmitting(true);

    setTimeout(() => {
      const selectedOption = UPDATE_OPTIONS.find(opt => opt.value === outcome);
      if (selectedOption) {
        const newActivity = {
          date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          action: selectedOption.label,
          notes: notes || 'No notes added'
        };

        const updates: Partial<Lead> = {
          stage: selectedOption.nextStage,
          lastInteraction: `${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${selectedOption.label}`,
          activities: [...lead.activities, newActivity]
        };

        if (followUpDate && followUpTime) {
          updates.nextFollowUp = `${followUpDate}, ${followUpTime}`;
        }

        onUpdate(lead.id, updates);
      }

      setIsSubmitting(false);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center sm:justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-50 to-blue-50 border-b border-blue-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Update Lead</h2>
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
        <div className="p-6 space-y-6">
          {/* What Happened */}
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-4">
              What happened with this lead?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {UPDATE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => setOutcome(option.value)}
                  className={`p-4 rounded-2xl border-2 text-left transition-all transform hover:scale-105 ${
                    outcome === option.value
                      ? 'border-blue-600 bg-gradient-to-br from-blue-50 to-blue-100 shadow-lg'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  <div className={`text-2xl mb-2 transition-transform ${outcome === option.value ? 'scale-125' : ''}`}>{option.icon}</div>
                  <div className={`font-bold text-sm mb-1 ${outcome === option.value ? 'text-blue-900' : 'text-slate-900'}`}>{option.label}</div>
                  <div className={`text-xs ${outcome === option.value ? 'text-blue-700' : 'text-slate-600'}`}>{option.description}</div>
                </button>
              ))}
            </div>
          </div>

          {outcome && (
            <>
              {/* Schedule Next Follow-up */}
              {(outcome === 'follow_up' || outcome === 'call_back' || outcome === 'interested') && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                  <label className="block text-sm font-bold text-slate-900 mb-3">
                    Schedule Next Follow-up ⏰
                  </label>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Date</label>
                      <input
                        type="date"
                        value={followUpDate}
                        onChange={(e) => setFollowUpDate(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-blue-300 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Time</label>
                      <input
                        type="time"
                        value={followUpTime}
                        onChange={(e) => setFollowUpTime(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-blue-300 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-bold text-slate-900 mb-2">
                  What did the customer say? 💬
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this conversation..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm resize-none h-20"
                />
              </div>

              {/* Summary */}
              <div className="bg-gradient-to-r from-slate-50 to-slate-50 rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Update Summary</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700">Next Stage:</span>
                    <span className="font-semibold text-slate-900">{UPDATE_OPTIONS.find(o => o.value === outcome)?.nextStage?.toUpperCase().replace('-', ' ')}</span>
                  </div>
                  {followUpDate && followUpTime && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-700">Next Action:</span>
                      <span className="font-semibold text-slate-900">{followUpDate} @ {followUpTime}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-4 flex gap-2 sm:justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-semibold text-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!outcome || isSubmitting}
            className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold transition-colors flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Save Update
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
