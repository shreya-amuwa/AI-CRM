import React, { useState } from 'react';
import {
  FileCheck2,
  CheckCircle2,
  Clock,
  MessageSquare,
  AlertCircle,
  TrendingUp,
  Send,
  X,
  PhoneCall,
  Video,
  DollarSign
} from 'lucide-react';
import { EodSubmissionItem } from '../../types/crm';

interface LeadEodTabProps {
  submissions: EodSubmissionItem[];
  onReviewSubmission: (eodId: string, feedback: string) => void;
}

export const LeadEodTab: React.FC<LeadEodTabProps> = ({
  submissions,
  onReviewSubmission
}) => {
  const [activeReviewEod, setActiveReviewEod] = useState<EodSubmissionItem | null>(null);
  const [feedbackText, setFeedbackText] = useState('');

  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const handleSendFeedback = () => {
    if (!activeReviewEod) return;
    onReviewSubmission(activeReviewEod.id, feedbackText || 'Great effort today. Approved by Team Lead.');
    setActiveReviewEod(null);
    setFeedbackText('');
  };

  const totalRevenueToday = submissions.reduce((s, e) => s + e.revenueBooked, 0);
  const totalCallsReported = submissions.reduce((s, e) => s + e.leadsContacted, 0);
  const totalDemosReported = submissions.reduce((s, e) => s + e.demosConducted, 0);
  const totalClosedReported = submissions.reduce((s, e) => s + e.dealsClosed, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              EOD Daily Reviews & Approvals
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900">
              {submissions.filter(s => s.status === 'Submitted').length} Ready for Review
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Review end-of-day achievements, verify reported closures, and provide supervisory coaching.
          </p>
        </div>
      </div>

      {/* Daily Summary Aggregate Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Revenue Booked Today</span>
          <p className="text-xl font-bold font-mono text-emerald-600 mt-1">
            {formatINR(totalRevenueToday)}
          </p>
          <span className="text-[10px] text-slate-400">Across 5 Pod Reps</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Leads Contacted</span>
          <p className="text-xl font-bold font-mono text-blue-600 mt-1">
            {totalCallsReported}
          </p>
          <span className="text-[10px] text-slate-400">Average 13.8 / rep</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Demos Conducted</span>
          <p className="text-xl font-bold font-mono text-purple-600 mt-1">
            {totalDemosReported}
          </p>
          <span className="text-[10px] text-slate-400">Product walkthroughs</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Deals Closed Today</span>
          <p className="text-xl font-bold font-mono text-indigo-600 mt-1">
            {totalClosedReported} Deals
          </p>
          <span className="text-[10px] text-slate-400">Signed contracts</span>
        </div>
      </div>

      {/* Submissions List */}
      <div className="space-y-4">
        {submissions.map(sub => {
          const isPending = sub.status === 'Pending';
          const isReviewed = sub.status === 'Reviewed';

          return (
            <div
              key={sub.id}
              className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4 hover:border-slate-300 transition-all"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">{sub.repName}</h3>
                    <p className="text-[11px] text-slate-500">{sub.submittedAt}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      isReviewed
                        ? 'bg-emerald-100 text-emerald-800'
                        : isPending
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {sub.status}
                  </span>

                  {!isPending && (
                    <button
                      onClick={() => {
                        setActiveReviewEod(sub);
                        setFeedbackText(sub.leadFeedback || '');
                      }}
                      className="px-3 py-1 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-colors"
                    >
                      {isReviewed ? 'Edit Feedback' : 'Review & Sign Off'}
                    </button>
                  )}
                </div>
              </div>

              {/* Reported Output Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl">
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Contacted</span>
                  <span className="font-mono font-bold text-xs text-slate-800">
                    {sub.leadsContacted} Leads
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Demos</span>
                  <span className="font-mono font-bold text-xs text-slate-800">
                    {sub.demosConducted} Done
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Deals Closed</span>
                  <span className="font-mono font-bold text-xs text-emerald-600">
                    {sub.dealsClosed} Won
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Revenue</span>
                  <span className="font-mono font-bold text-xs text-emerald-700">
                    {formatINR(sub.revenueBooked)}
                  </span>
                </div>
              </div>

              {/* Qualitative notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <span className="font-bold text-slate-700 block">Blockers / Challenges Encountered:</span>
                  <p className="text-slate-600 bg-slate-50/70 p-2.5 rounded-lg border border-slate-100">
                    {sub.challenges || 'No blockers reported.'}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="font-bold text-slate-700 block">Plan for Tomorrow:</span>
                  <p className="text-slate-600 bg-slate-50/70 p-2.5 rounded-lg border border-slate-100">
                    {sub.tomorrowPlan || 'Follow up with active pipeline.'}
                  </p>
                </div>
              </div>

              {/* Existing Lead Feedback Banner */}
              {sub.leadFeedback && (
                <div className="p-3 rounded-xl bg-indigo-50/80 border border-indigo-100 text-xs text-indigo-950 flex items-start gap-2">
                  <MessageSquare className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-indigo-900 block">Team Lead Supervisory Note:</span>
                    <p className="mt-0.5 italic">{sub.leadFeedback}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Review Modal */}
      {activeReviewEod && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <FileCheck2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Sign Off Daily Report</h3>
                  <p className="text-[11px] text-slate-500">{activeReviewEod.repName} • {activeReviewEod.date}</p>
                </div>
              </div>
              <button
                onClick={() => setActiveReviewEod(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-slate-50 text-xs space-y-1">
                <span className="text-slate-500 font-medium">Rep's Stated Highlights:</span>
                <p className="text-slate-800 font-semibold">{activeReviewEod.challenges}</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Managerial Feedback / Next Steps:
                </label>
                <textarea
                  rows={3}
                  value={feedbackText}
                  onChange={e => setFeedbackText(e.target.value)}
                  placeholder="e.g. Excellent job on closing the logistics deal. Let's do a joint call on Monday for the enterprise lead."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-600 resize-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveReviewEod(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendFeedback}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Sign Off & Send Feedback</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
